import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameShell } from './GameShell';
import { RuneQuestionCard } from './RuneQuestionCard';
import { Badge, Button, Card, Icon, Stat } from './ui';
import {
  arcadeLevel,
  arcadeLevelLabel,
  markArcadeQuestion,
  noteArcadeRun,
  takeArcadeQuestions,
} from '../lib/arcadeProgress';
import { ARCADE_COINS } from '../lib/arcadeCoins';
import {
  buildRunePool,
  doorSolid,
  generateRoom,
  makeRng,
  type Crate,
  type Door,
  type Hazard,
  type Ladder,
  type Lever,
  type Room,
  type RuneItem,
  type Snake,
  type VaultCoin,
  type Wall,
} from '../lib/arcadeGames';
import { useCanvasFit } from '../lib/canvasFit';
import { useLeaveSave } from '../lib/leaveSave';
import { newEventId } from '../lib/storage';
import { useApp } from '../lib/store';
import {
  applyVaultKey,
  createVaultState,
  PLAYER_H,
  PLAYER_W,
  stepVault,
  type VaultHurt,
  type VaultState,
} from '../lib/vaultPhysics';

/**
 * The Rune Vault — a 2D side-view puzzle platformer.
 *
 * Rooms are generated from the stage number and the run seed, so the vault is
 * endless without shipping any level files. Every room ends in a rune gate
 * that will not open until the student answers the item carved above it, and
 * from room two the vault has machinery: stone crates you can shove (and stand
 * on), a lever that drops a drawbridge over a chasm too wide to jump, and a
 * lever that raises a portcullis barring the corridor. Every lever sits on the
 * near side of its obstacle, so a room can never strand the player.
 *
 * Movement is WASD / arrows plus space, with an on-screen pad for touch. Every
 * lever is thrown by walking into it, so a phone needs no extra button.
 */

const VIEW_W = 900;
const VIEW_H = 460;
const BEST_KEY = 'hdsat.vault.best.v1';
const SEEN_KEY = 'hdsat.vault.seen.v1';
const VAULT_COINS_KEY = 'hdsat.vault.coins.v1';

function loadVaultSeen(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(-600) : [];
  } catch {
    return [];
  }
}

function markVaultSeen(questionId: string): void {
  try {
    const seen = loadVaultSeen();
    if (seen.includes(questionId)) return;
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, questionId].slice(-600)));
  } catch {
    /* storage unavailable: duplicate protection simply lasts for this run */
  }
}

function loadVaultCoins(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(VAULT_COINS_KEY) ?? '0') || 0);
  } catch {
    return 0;
  }
}

function saveVaultCoins(value: number): void {
  try {
    localStorage.setItem(VAULT_COINS_KEY, String(Math.max(0, Math.floor(value))));
  } catch {
    /* storage unavailable: the actual HDCoins balance is still updated */
  }
}

interface Keys {
  left: boolean;
  right: boolean;
  jump: boolean;
  down: boolean;
}

const NO_KEYS: Keys = { left: false, right: false, jump: false, down: false };

const HURT_TEXT: Record<VaultHurt, string> = {
  spikes: 'The spikes catch you — back to the door.',
  trap: 'A bear trap snaps shut — back to the door.',
  snake: 'The snake strikes — back to the door.',
};

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}

/* --------------------------------------------------------------------------
 Rendering
-------------------------------------------------------------------------- */

function drawBackdrop(ctx: CanvasRenderingContext2D, cam: number, time: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#120d17');
  sky.addColorStop(0.55, '#1b1320');
  sky.addColorStop(1, '#0a070d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const shift = cam * 0.55;
  for (let row = 0; row < 8; row += 1) {
    const y = 18 + row * 52;
    const offset = (row % 2) * 47;
    ctx.fillStyle = row % 3 === 0 ? '#221a2a' : '#1e1726';
    for (let x = -((shift + offset) % 94) - 94; x < VIEW_W + 94; x += 94) {
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, 88, 46, 3);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(10,7,13,0.55)';
    ctx.fillRect(0, y + 48, VIEW_W, 4);
  }

  for (const archX of [260 - cam * 0.55, 760 - cam * 0.55]) {
    if (archX < -200 || archX > VIEW_W + 200) continue;
    ctx.fillStyle = '#0b0810';
    ctx.beginPath();
    ctx.moveTo(archX, 336);
    ctx.lineTo(archX, 190);
    ctx.quadraticCurveTo(archX + 60, 108, archX + 120, 190);
    ctx.lineTo(archX + 120, 336);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,60,0.28)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const fog = ctx.createLinearGradient(0, VIEW_H - 140, 0, VIEW_H);
  fog.addColorStop(0, 'rgba(60,40,70,0)');
  fog.addColorStop(1, 'rgba(18,12,24,0.85)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, VIEW_H - 140, VIEW_W, 140);

  for (let i = 0; i < 26; i += 1) {
    const x = (i * 173 + time * (6 + (i % 5)) + Math.sin(time + i) * 12) % VIEW_W;
    const y = 90 + ((i * 97 + Math.sin(time * 0.6 + i) * 18) % 280);
    ctx.fillStyle = `rgba(255,214,150,${0.05 + (i % 4) * 0.02})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number) {
  const flicker = Math.sin(time * 9 + seed) * 0.5 + Math.sin(time * 13.7 + seed * 2) * 0.5;
  const glow = ctx.createRadialGradient(x, y + 6, 2, x, y + 6, 96 + flicker * 8);
  glow.addColorStop(0, 'rgba(255,186,92,0.42)');
  glow.addColorStop(0.45, 'rgba(255,140,50,0.14)');
  glow.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 110, y - 110, 220, 220);

  ctx.fillStyle = '#2a2030';
  ctx.fillRect(x - 3, y + 14, 6, 22);
  ctx.fillStyle = '#3b2a1e';
  ctx.beginPath();
  ctx.roundRect(x - 7, y + 2, 14, 12, 3);
  ctx.fill();

  const sway = Math.sin(time * 7.3 + seed) * 3;
  const h = 26 + flicker * 5;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.quadraticCurveTo(x + 10 + sway, y - h * 0.4, x + sway * 0.4, y - h);
  ctx.quadraticCurveTo(x - 10 + sway, y - h * 0.3, x, y + 2);
  ctx.fillStyle = 'rgba(255,170,60,0.9)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.quadraticCurveTo(x + 5 + sway * 0.6, y - h * 0.35, x + sway * 0.3, y - h * 0.6);
  ctx.quadraticCurveTo(x - 5 + sway * 0.5, y - h * 0.25, x, y + 2);
  ctx.fillStyle = 'rgba(255,240,190,0.95)';
  ctx.fill();
}

function drawPlatform(
  ctx: CanvasRenderingContext2D,
  platform: { x: number; y: number; w: number; h: number; kind?: string },
  cam: number
) {
  const x = platform.x - cam;
  if (x > VIEW_W || x + platform.w < 0) return;
  const ground = platform.kind === 'ground';
  const body = ctx.createLinearGradient(0, platform.y, 0, platform.y + Math.min(platform.h, 70));
  body.addColorStop(0, '#3a2f42');
  body.addColorStop(1, '#201827');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(x, platform.y, platform.w, platform.h, ground ? 0 : 4);
  ctx.fill();

  ctx.fillStyle = '#5a4a62';
  ctx.fillRect(x + 2, platform.y, Math.max(0, platform.w - 4), 4);
  ctx.fillStyle = 'rgba(120,160,120,0.35)';
  for (let i = 12; i < platform.w - 10; i += 37) {
    ctx.fillRect(x + i, platform.y - 1, 9, 3);
  }
  ctx.strokeStyle = 'rgba(10,7,13,0.6)';
  ctx.lineWidth = 1;
  for (let i = 24; i < platform.w; i += 48) {
    ctx.beginPath();
    ctx.moveTo(x + i, platform.y + 6);
    ctx.lineTo(x + i, platform.y + Math.min(platform.h, 46));
    ctx.stroke();
  }
}

function drawDoor(
  ctx: CanvasRenderingContext2D,
  door: Door,
  cam: number,
  solid: boolean,
  time: number
) {
  const x = door.x - cam;
  if (x > VIEW_W + 220 || x + door.w < -220) return;

  if (door.kind === 'bridge') {
    if (solid) {
      // Lowered: planks across the chasm.
      ctx.fillStyle = '#4b3826';
      ctx.fillRect(x, door.y, door.w, door.h);
      ctx.fillStyle = '#6b5238';
      for (let i = 0; i < door.w; i += 14) {
        ctx.fillRect(x + i + 1, door.y + 1, 11, door.h - 3);
      }
      ctx.strokeStyle = 'rgba(20,12,8,0.6)';
      ctx.strokeRect(x, door.y, door.w, door.h);
      // Chains at both ends.
      ctx.strokeStyle = 'rgba(180,170,160,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, door.y);
      ctx.lineTo(x + 4, door.y - 26);
      ctx.moveTo(x + door.w - 4, door.y);
      ctx.lineTo(x + door.w - 4, door.y - 26);
      ctx.stroke();
    } else {
      // Raised: the bridge stands on its near hinge, catching the torchlight.
      ctx.save();
      ctx.translate(x, door.y);
      ctx.rotate(-Math.PI / 2.35);
      ctx.fillStyle = 'rgba(75,56,38,0.92)';
      ctx.fillRect(0, -door.h, door.w, door.h);
      ctx.fillStyle = 'rgba(110,86,58,0.85)';
      for (let i = 0; i < door.w; i += 14) ctx.fillRect(i + 1, -door.h + 1, 11, door.h - 2);
      ctx.restore();
      const pulse = 0.35 + Math.sin(time * 3) * 0.12;
      ctx.strokeStyle = `rgba(255,190,110,${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + 10, door.y - 18, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  // Portcullis: bars sink into the floor when open.
  const lift = solid ? 0 : door.h - 16;
  ctx.save();
  ctx.translate(0, -lift);
  ctx.fillStyle = '#2c2331';
  ctx.fillRect(x - 6, door.y - 14, door.w + 12, 14);
  for (let i = 0; i < 4; i += 1) {
    const bx = x + 1 + (i * (door.w - 4)) / 3;
    ctx.fillStyle = '#5f6673';
    ctx.fillRect(bx, door.y - 10, 4, door.h + 10);
    ctx.fillStyle = 'rgba(200,220,255,0.28)';
    ctx.fillRect(bx, door.y - 10, 1.6, door.h + 10);
  }
  ctx.fillStyle = '#5f6673';
  ctx.fillRect(x - 2, door.y + door.h * 0.16, door.w + 4, 5);
  ctx.fillRect(x - 2, door.y + door.h * 0.55, door.w + 4, 5);
  ctx.restore();

  if (!solid) {
    ctx.fillStyle = 'rgba(255,210,140,0.1)';
    ctx.fillRect(x - 6, door.y - 14, door.w + 12, 14);
  }
}

function drawCrate(ctx: CanvasRenderingContext2D, crate: Crate, cam: number) {
  const x = crate.x - cam;
  if (x > VIEW_W + 80 || x + crate.w < -80) return;
  const body = ctx.createLinearGradient(0, crate.y, 0, crate.y + crate.h);
  body.addColorStop(0, '#5c4632');
  body.addColorStop(1, '#33261b');
  ctx.fillStyle = body;
  ctx.fillRect(x, crate.y, crate.w, crate.h);
  ctx.strokeStyle = 'rgba(18,12,8,0.8)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, crate.y + 0.5, crate.w - 1, crate.h - 1);
  ctx.fillStyle = 'rgba(150,120,84,0.5)';
  ctx.fillRect(x + 3, crate.y + 3, crate.w - 6, 3);
  ctx.fillRect(x + 3, crate.y + crate.h - 6, crate.w - 6, 3);
  ctx.fillStyle = 'rgba(20,14,10,0.45)';
  ctx.fillRect(x + crate.w / 2 - 1, crate.y + 4, 2, crate.h - 8);
  // Rune mark.
  ctx.strokeStyle = 'rgba(255,196,120,0.5)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x + crate.w / 2, crate.y + crate.h / 2, 8, 0, Math.PI * 2);
  ctx.moveTo(x + crate.w / 2 - 4, crate.y + crate.h / 2);
  ctx.lineTo(x + crate.w / 2 + 4, crate.y + crate.h / 2);
  ctx.stroke();
}

function drawCoin(ctx: CanvasRenderingContext2D, coin: VaultCoin, cam: number, time: number) {
  const x = coin.x - cam + coin.w / 2;
  const y = coin.y + coin.h / 2 + Math.sin(time * 2.4 + coin.x * 0.04) * 4;
  if (x < -40 || x > VIEW_W + 40) return;
  const glow = ctx.createRadialGradient(x, y, 2, x, y, 24);
  glow.addColorStop(0, 'rgba(255,226,122,0.35)');
  glow.addColorStop(1, 'rgba(255,190,65,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.ellipse(x, y, 8.4, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8f5d13';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,247,188,0.9)';
  ctx.beginPath();
  ctx.arc(x - 2.4, y - 3.4, 2.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawLever(ctx: CanvasRenderingContext2D, lever: Lever, cam: number, pulled: boolean, time: number) {
  const x = lever.x - cam;
  if (x > VIEW_W + 90 || x < -90) return;

  if (!pulled) {
    const pulse = 0.22 + Math.sin(time * 3.4) * 0.08;
    const glow = ctx.createRadialGradient(x, lever.y + 6, 3, x, lever.y + 6, 52);
    glow.addColorStop(0, `rgba(255,214,130,${pulse})`);
    glow.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 54, lever.y - 48, 108, 106);
  }

  ctx.fillStyle = '#3b2f45';
  ctx.fillRect(x - 9, lever.y + 18, 18, 8);
  ctx.fillStyle = '#4d3f5a';
  ctx.beginPath();
  ctx.roundRect(x - 5, lever.y - 2, 10, 22, 3);
  ctx.fill();

  const angle = pulled ? Math.PI * 0.42 : -Math.PI * 0.42;
  ctx.save();
  ctx.translate(x, lever.y + 2);
  ctx.rotate(angle);
  ctx.strokeStyle = '#8b7a6a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -22);
  ctx.stroke();
  ctx.fillStyle = pulled ? '#7ce0a6' : '#ffcc7a';
  ctx.beginPath();
  ctx.arc(0, -24, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWall(ctx: CanvasRenderingContext2D, wall: Wall, cam: number) {
  const x = wall.x - cam;
  if (x > VIEW_W + 80 || x + wall.w < -80) return;
  const body = ctx.createLinearGradient(x, wall.y, x + wall.w, wall.y + wall.h);
  body.addColorStop(0, '#4a3c55');
  body.addColorStop(0.5, '#392e44');
  body.addColorStop(1, '#241c2d');
  ctx.fillStyle = body;
  ctx.fillRect(x, wall.y, wall.w, wall.h);
  // Mortar courses, so it reads as masonry rather than a bar.
  ctx.strokeStyle = 'rgba(12,8,18,0.65)';
  ctx.lineWidth = 1;
  for (let y = wall.y + 18; y < wall.y + wall.h; y += 22) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + wall.w, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#6a5977';
  ctx.fillRect(x - 4, wall.y - 6, wall.w + 8, 8);
  ctx.fillStyle = 'rgba(255,214,150,0.16)';
  ctx.fillRect(x - 4, wall.y - 6, wall.w + 8, 2);
  ctx.strokeStyle = 'rgba(150,120,170,0.4)';
  ctx.beginPath();
  ctx.moveTo(x + 4, wall.y + 30);
  ctx.lineTo(x + 9, wall.y + 44);
  ctx.lineTo(x + 5, wall.y + 58);
  ctx.stroke();
}

function drawLadder(ctx: CanvasRenderingContext2D, ladder: Ladder, cam: number, time: number) {
  const x = ladder.x - cam;
  if (x > VIEW_W + 60 || x + ladder.w < -60) return;
  const bottom = ladder.y + ladder.h;

  if (ladder.kind === 'rope') {
    const sway = Math.sin(time * 1.4 + ladder.x * 0.01) * 2.4;
    ctx.strokeStyle = '#b99a6a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 8, ladder.y - 4);
    ctx.quadraticCurveTo(x + 8 + sway, (ladder.y + bottom) / 2, x + 8, bottom);
    ctx.stroke();
    ctx.fillStyle = '#d8b984';
    for (let y = ladder.y + 14; y < bottom - 6; y += 20) {
      ctx.beginPath();
      ctx.arc(x + 8 + sway * ((y - ladder.y) / ladder.h), y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Knots give the eye something to read while climbing.
    ctx.fillStyle = 'rgba(255,230,180,0.5)';
    for (let y = ladder.y + 8; y < bottom; y += 40) {
      ctx.fillRect(x + 4, y, 8, 2);
    }
    return;
  }

  ctx.strokeStyle = '#8c7a5c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 2, ladder.y - 4);
  ctx.lineTo(x + 2, bottom);
  ctx.moveTo(x + ladder.w - 2, ladder.y - 4);
  ctx.lineTo(x + ladder.w - 2, bottom);
  ctx.stroke();
  ctx.strokeStyle = '#a48f6a';
  ctx.lineWidth = 3;
  for (let y = ladder.y + 10; y < bottom - 4; y += 18) {
    ctx.beginPath();
    ctx.moveTo(x + 2, y);
    ctx.lineTo(x + ladder.w - 2, y);
    ctx.stroke();
  }
}

function drawHazard(ctx: CanvasRenderingContext2D, hazard: Hazard, cam: number, time: number) {
  const x = hazard.x - cam;
  if (x > VIEW_W + 90 || x + hazard.w < -90) return;
  if (hazard.kind === 'spikes') {
    // Iron teeth on a dark bed. The old red wash read as a hitbox painted over
    // the level, so the danger is carried by the silhouette, not a glow.
    const teeth = 8;
    const step = hazard.w / teeth;
    ctx.fillStyle = '#303640';
    ctx.fillRect(x - 2, hazard.y + hazard.h - 5, hazard.w + 4, 5);
    ctx.fillStyle = '#9aa6b8';
    for (let i = 0; i < teeth; i += 1) {
      const sx = x + i * step;
      ctx.beginPath();
      ctx.moveTo(sx, hazard.y + hazard.h - 3);
      ctx.lineTo(sx + step / 2, hazard.y - 4);
      ctx.lineTo(sx + step, hazard.y + hazard.h - 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#5f6875';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < teeth; i += 1) {
      const sx = x + i * step;
      ctx.moveTo(sx + step / 2, hazard.y - 4);
      ctx.lineTo(sx + step * 0.68, hazard.y + hazard.h - 3);
    }
    ctx.stroke();
    return;
  }

  // Bear trap: the old head-on jaw silhouette, kept low and wide. A single
  // forged arch beds into a base plate with a hinge at each end; six teeth rise
  // from the plate with their tips following the arch, and the middle pair
  // trembles on the spring. No offset rings and no red wash.
  const tremble = Math.sin(time * 8 + hazard.x) * 0.6;
  const cx = x + hazard.w / 2;
  const baseY = hazard.y + hazard.h - 2;
  const radius = hazard.w / 2 - 1;

  // A soft contact shadow beds the ironwork into the floor.
  ctx.fillStyle = 'rgba(20,14,10,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, baseY + 2, radius + 3, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Base plate first, so the arch and teeth sit on top of it.
  ctx.fillStyle = '#6b5d50';
  ctx.fillRect(x + 1, baseY - 3, hazard.w - 2, 4);

  // Hinge caps at both ends of the jaw.
  for (const hingeX of [x + 1.5, x + hazard.w - 1.5]) {
    ctx.fillStyle = '#4c433b';
    ctx.beginPath();
    ctx.arc(hingeX, baseY + 1, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a4977f';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(hingeX, baseY + 1, 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The jaw arch: one dark rim and a thin lit inner edge.
  ctx.strokeStyle = '#7d7468';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, baseY, radius, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#b3a894';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(cx, baseY, radius - 1.25, Math.PI, Math.PI * 2);
  ctx.stroke();

  // Six teeth: short and wide, tips following the arch, middle pair trembling.
  const toothW = 4.4;
  const toothGap = (hazard.w - toothW - 3) / 5;
  for (let i = 0; i < 6; i += 1) {
    const sx = x + 1.5 + i * toothGap;
    const arch = Math.sin(((i + 0.5) / 6) * Math.PI);
    const wobble = i === 2 || i === 3 ? tremble : 0;
    const tipY = hazard.y + 1 - arch * 5 + wobble;
    ctx.fillStyle = '#a9b3c0';
    ctx.beginPath();
    ctx.moveTo(sx, baseY);
    ctx.lineTo(sx + toothW / 2, tipY);
    ctx.lineTo(sx + toothW, baseY);
    ctx.closePath();
    ctx.fill();
    // One lit edge gives each tooth some section without a glow.
    ctx.strokeStyle = '#6d7988';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(sx + 0.9, baseY - 1);
    ctx.lineTo(sx + toothW / 2, tipY);
    ctx.stroke();
  }
}

function drawSnake(ctx: CanvasRenderingContext2D, snake: Snake, cam: number, time: number) {
  const x = snake.x - cam;
  if (x > VIEW_W + 100 || x + snake.w < -100) return;
  const facing = snake.dir;
  const headX = facing === 1 ? x + snake.w - 8 : x + 8;
  const baseY = snake.y + snake.h - 2;
  const wave = (t: number) => Math.sin(time * 7 + t * 3) * 3;

  // Body: a chain of shrinking coils trailing behind the head.
  for (let i = 5; i >= 0; i -= 1) {
    const t = i / 5;
    const cx = headX - facing * (10 + i * 7);
    const radius = 7 - i * 0.7;
    ctx.fillStyle = i % 2 === 0 ? '#3f7a45' : '#356b3b';
    ctx.beginPath();
    ctx.ellipse(cx, baseY - 3 + wave(t) * (0.4 + t), radius, radius * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head.
  ctx.fillStyle = '#4b8f50';
  ctx.beginPath();
  ctx.ellipse(headX, baseY - 6, 9, 6.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b2a1c';
  ctx.beginPath();
  ctx.arc(headX + facing * 3, baseY - 8, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d8b23a';
  ctx.beginPath();
  ctx.arc(headX + facing * 3, baseY - 8, 0.8, 0, Math.PI * 2);
  ctx.fill();
  // Tongue, flicking on its own rhythm.
  const flick = Math.sin(time * 9 + snake.x * 0.05);
  if (flick > 0.2) {
    ctx.strokeStyle = '#e0556b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(headX + facing * 8, baseY - 5);
    ctx.lineTo(headX + facing * 15, baseY - 7);
    ctx.moveTo(headX + facing * 15, baseY - 7);
    ctx.lineTo(headX + facing * 19, baseY - 10);
    ctx.moveTo(headX + facing * 15, baseY - 7);
    ctx.lineTo(headX + facing * 19, baseY - 4);
    ctx.stroke();
  }
}

function drawGate(
  ctx: CanvasRenderingContext2D,
  gate: { x: number; y: number; w: number; h: number },
  cam: number,
  open: boolean,
  time: number
) {
  const x = gate.x - cam;
  if (x > VIEW_W + 120 || x + gate.w < -120) return;

  if (open) {
    const spill = ctx.createRadialGradient(
      x + gate.w / 2,
      gate.y + gate.h / 2,
      8,
      x + gate.w / 2,
      gate.y + gate.h / 2,
      190
    );
    spill.addColorStop(0, 'rgba(255,206,128,0.34)');
    spill.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = spill;
    ctx.fillRect(x - 190, gate.y - 120, gate.w + 380, gate.h + 240);
  }

  ctx.fillStyle = '#0a070d';
  ctx.beginPath();
  ctx.moveTo(x - 14, gate.y + gate.h);
  ctx.lineTo(x - 14, gate.y + 26);
  ctx.quadraticCurveTo(x + gate.w / 2, gate.y - 26, x + gate.w + 14, gate.y + 26);
  ctx.lineTo(x + gate.w + 14, gate.y + gate.h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#4a3a44';
  ctx.lineWidth = 7;
  ctx.stroke();

  if (open) {
    ctx.fillStyle = 'rgba(255,208,142,0.22)';
    ctx.fillRect(x, gate.y + 20, gate.w, gate.h - 20);
  } else {
    const bars = 4;
    for (let i = 0; i < bars; i += 1) {
      const bx = x + 6 + (i * (gate.w - 12)) / (bars - 1);
      ctx.fillStyle = '#5f6673';
      ctx.fillRect(bx - 2, gate.y + 8, 4, gate.h - 8);
      ctx.fillStyle = 'rgba(200,220,255,0.25)';
      ctx.fillRect(bx - 2, gate.y + 8, 1.5, gate.h - 8);
    }
    ctx.fillStyle = '#5f6673';
    ctx.fillRect(x + 4, gate.y + 44, gate.w - 8, 4);
  }

  const pulse = 0.65 + Math.sin(time * 3) * 0.2;
  ctx.save();
  ctx.translate(x + gate.w / 2, gate.y - 34);
  ctx.rotate(time * 0.5);
  ctx.strokeStyle = open ? `rgba(110,240,160,${pulse})` : `rgba(255,190,90,${pulse})`;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    ctx.lineTo(Math.cos(angle) * 11, Math.sin(angle) * 11);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: { x: number; y: number; vx: number; vy: number; onGround: boolean; facing: 1 | -1; walk: number },
  cam: number,
  time: number,
  keys: Keys
) {
  const x = player.x - cam;
  const y = player.y;
  const bob = player.onGround && (keys.left || keys.right) ? Math.sin(player.walk * 11) * 1.6 : 0;

  const lanternX = x + (player.facing === 1 ? PLAYER_W + 4 : -4);
  const lanternY = y + 22 + bob;
  const glow = ctx.createRadialGradient(lanternX, lanternY, 3, lanternX, lanternY, 92);
  const flame = (0.34 + Math.sin(time * 6.1) * 0.03 + Math.sin(time * 11.7) * 0.02).toFixed(3);
  glow.addColorStop(0, `rgba(255,214,150,${flame})`);
  glow.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(lanternX - 100, lanternY - 100, 200, 200);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + PLAYER_W / 2, y + PLAYER_H + 2, 16, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x + PLAYER_W / 2, y + bob);
  ctx.scale(player.facing, 1);

  const swing = player.onGround ? Math.sin(player.walk * 11) * 6 : 5;
  ctx.strokeStyle = '#2a2233';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-4, 28);
  ctx.lineTo(-4 + swing, 42);
  ctx.moveTo(4, 28);
  ctx.lineTo(4 - swing, 42);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-12, 12);
  ctx.quadraticCurveTo(-16, 32, -10, 36);
  ctx.lineTo(10, 36);
  ctx.quadraticCurveTo(16, 30, 11, 12);
  ctx.closePath();
  ctx.fillStyle = '#3d4a6b';
  ctx.fill();
  ctx.fillStyle = '#2c3550';
  ctx.beginPath();
  ctx.moveTo(-2, 14);
  ctx.lineTo(9, 34);
  ctx.lineTo(2, 34);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 4, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#e9c6a6';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 2, 9, Math.PI * 0.95, Math.PI * 2.05);
  ctx.fillStyle = '#4d5d84';
  ctx.fill();
  ctx.fillStyle = '#221a2a';
  ctx.fillRect(-4, 4, 2, 2);
  ctx.fillRect(3, 4, 2, 2);

  ctx.fillStyle = '#b98a4b';
  ctx.fillRect(11, 20, 7, 10);
  ctx.fillStyle = 'rgba(255,224,160,0.95)';
  ctx.fillRect(12.5, 21.5, 4, 7);
  ctx.restore();
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  room: Room,
  player: { x: number; y: number; vx: number; vy: number; onGround: boolean; facing: 1 | -1; walk: number },
  cam: number,
  time: number,
  gateOpen: boolean,
  keys: Keys,
  embers: Ember[],
  crates: Crate[],
  pulled: Set<string>,
  snakes: Snake[],
  coins: VaultCoin[] = []
) {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawBackdrop(ctx, cam, time);

  for (const wall of room.walls) drawWall(ctx, wall, cam);

  for (const platform of room.platforms) {
    drawPlatform(ctx, platform, cam);
  }

  for (const ladder of room.ladders) {
    drawLadder(ctx, ladder, cam, time);
  }

  for (const hazard of room.hazards) {
    drawHazard(ctx, hazard, cam, time);
  }

  for (const door of room.doors) {
    drawDoor(ctx, door, cam, doorSolid(door, pulled), time);
  }

  for (const crate of crates) drawCrate(ctx, crate, cam);
  for (const coin of coins) drawCoin(ctx, coin, cam, time);

  for (const [i, torch] of room.torches.entries()) {
    const x = torch.x - cam;
    if (x < -120 || x > VIEW_W + 120) continue;
    drawTorch(ctx, x, torch.y, time, i * 1.7);
  }

  for (const lever of room.levers) {
    drawLever(ctx, lever, cam, pulled.has(lever.id), time);
  }

  for (const ember of embers) {
    ctx.fillStyle = `rgba(255,170,80,${Math.max(0, ember.life / ember.max) * 0.8})`;
    ctx.beginPath();
    ctx.arc(ember.x - cam, ember.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const snake of snakes) drawSnake(ctx, snake, cam, time);

  drawGate(ctx, room.gate, cam, gateOpen, time);
  drawPlayer(ctx, player, cam, time, keys);

  const vignette = ctx.createRadialGradient(
    VIEW_W / 2,
    VIEW_H / 2,
    VIEW_H * 0.35,
    VIEW_W / 2,
    VIEW_H / 2,
    VIEW_H * 0.85
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/* --------------------------------------------------------------------------
 Component
-------------------------------------------------------------------------- */

/**
 * The on-screen controls, for more than one finger at a time.
 *
 * A phone player needs to hold right and jump together, and slide a thumb from
 * one key to another without either one sticking. The pad counts pointers per
 * action, so two fingers on the same key never cancel each other. The CSS on
 * `.vault-controls` and `.vault-key` sets `touch-action: none` so the browser
 * does not turn a press into a scroll and cancel the pointer stream.
 */
type PadAction = keyof Keys;

const PAD_KEYS: { action: PadAction; label: string; hint: string; className?: string }[] = [
  { action: 'left', label: '◀', hint: 'Move left' },
  { action: 'right', label: '▶', hint: 'Move right' },
  { action: 'jump', label: 'Jump', hint: 'Jump or climb', className: 'is-jump' },
  { action: 'down', label: '▼', hint: 'Climb down' },
];

function padActionAt(target: EventTarget | null): PadAction | null {
  const element = target instanceof Element ? target : null;
  const node = element?.closest('[data-vault-action]') as HTMLElement | null;
  const action = node?.dataset.vaultAction;
  return action === 'left' || action === 'right' || action === 'jump' || action === 'down'
    ? action
    : null;
}

/**
 * The whole d-pad is one surface, and on a phone it listens to real touch
 * events.
 *
 * Pointer capture was the wrong tool here. On iOS and on several Android
 * browsers a second finger either cancelled the first pointer or arrived
 * without its own move stream, so holding right and jumping at the same time
 * failed, and a thumb that slid from one key to the next kept the old key held.
 * Touch events carry every finger in `changedTouches` with a stable identifier
 * and need no capture. A mouse or a pen still uses the pointer handlers, and a
 * browser without touch support falls back to them too.
 *
 * A held key reports `down` once and stays down until that finger lifts, which
 * is what makes a held jump hop again on landing and keep climbing a rope.
 */
export function VaultPad({ onChange }: { onChange: (action: PadAction, down: boolean) => void }) {
  const padRef = useRef<HTMLDivElement | null>(null);
  /** Every held finger or pointer, keyed by `t<identifier>` or `p<id>`. */
  const active = useRef<Map<string, PadAction>>(new Map());
  const counts = useRef<Record<PadAction, number>>({ left: 0, right: 0, jump: 0, down: 0 });
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const touchFirst = useRef(
    typeof window !== 'undefined' &&
      ('ontouchstart' in window ||
        (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0))
  );

  const apply = useCallback((action: PadAction, delta: number) => {
    const next = Math.max(0, counts.current[action] + delta);
    if (next === counts.current[action]) return;
    counts.current[action] = next;
    changeRef.current(action, next > 0);
  }, []);

  const release = useCallback(
    (id: string) => {
      const action = active.current.get(id);
      if (!action) return;
      active.current.delete(id);
      apply(action, -1);
    },
    [apply]
  );

  const releaseAll = useCallback(() => {
    for (const [id, action] of active.current) {
      active.current.delete(id);
      apply(action, -1);
    }
  }, [apply]);

  const keyAt = useCallback((x: number, y: number, fallback: EventTarget | null) => {
    let element: Element | null = null;
    try {
      element = document.elementFromPoint(x, y);
    } catch {
      element = null;
    }
    return padActionAt(element) ?? padActionAt(fallback);
  }, []);

  // Touch listeners are attached by hand so they can be non-passive: a passive
  // touchstart cannot call preventDefault, and without that the browser turns
  // a press into a scroll or a long-press and cancels the stream mid-run.
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;

    const start = (event: TouchEvent) => {
      event.preventDefault();
      for (const touch of Array.from(event.changedTouches)) {
        const id = `t${touch.identifier}`;
        if (active.current.has(id)) continue;
        const action = keyAt(touch.clientX, touch.clientY, touch.target);
        if (!action) continue;
        active.current.set(id, action);
        apply(action, 1);
      }
    };

    const move = (event: TouchEvent) => {
      if (active.current.size === 0) return;
      event.preventDefault();
      for (const touch of Array.from(event.changedTouches)) {
        const id = `t${touch.identifier}`;
        const previous = active.current.get(id);
        if (!previous) continue;
        const next = keyAt(touch.clientX, touch.clientY, null);
        // Off the pad keeps the last key held, so a thumb can overshoot the
        // edge without dropping a run; sliding onto another key switches.
        if (!next || next === previous) continue;
        apply(previous, -1);
        active.current.set(id, next);
        apply(next, 1);
      }
    };

    const end = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) release(`t${touch.identifier}`);
    };

    // `end` also covers a finger that lifts after the browser has cancelled the
    // stream. Blur and a hidden tab release everything so no key stays held and
    // steals the next gesture.
    pad.addEventListener('touchstart', start, { passive: false });
    pad.addEventListener('touchmove', move, { passive: false });
    pad.addEventListener('touchend', end);
    pad.addEventListener('touchcancel', end);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseAll);
    return () => {
      pad.removeEventListener('touchstart', start);
      pad.removeEventListener('touchmove', move);
      pad.removeEventListener('touchend', end);
      pad.removeEventListener('touchcancel', end);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', releaseAll);
    };
  }, [apply, keyAt, release, releaseAll]);

  return (
    <div
      ref={padRef}
      className="vault-dpad"
      role="group"
      aria-label="Vault controls"
      onPointerDown={(event) => {
        // The touch listener above owns fingers; handling a touch pointer twice
        // made one thumb press look like two and left the other one stuck.
        if (event.pointerType === 'touch' && touchFirst.current) return;
        event.preventDefault();
        const action = padActionAt(event.target);
        if (!action || active.current.has(`p${event.pointerId}`)) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        active.current.set(`p${event.pointerId}`, action);
        apply(action, 1);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === 'touch' && touchFirst.current) return;
        const id = `p${event.pointerId}`;
        const previous = active.current.get(id);
        if (!previous) return;
        event.preventDefault();
        const next = keyAt(event.clientX, event.clientY, null);
        if (!next || next === previous) return;
        apply(previous, -1);
        active.current.set(id, next);
        apply(next, 1);
      }}
      onPointerUp={(event) => release(`p${event.pointerId}`)}
      onPointerCancel={(event) => release(`p${event.pointerId}`)}
      onLostPointerCapture={(event) => release(`p${event.pointerId}`)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {PAD_KEYS.map((key) => (
        <button
          key={key.action}
          type="button"
          className={`vault-key${key.className ? ` ${key.className}` : ''}`}
          aria-label={key.hint}
          data-vault-action={key.action}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}

export function RuneVault() {
  const app = useApp();
  const [phase, setPhase] = useState<'intro' | 'playing'>('intro');
  const [seed, setSeed] = useState('');
  const [stage, setStage] = useState(1);
  const [room, setRoom] = useState<Room | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [question, setQuestion] = useState<RuneItem | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [sprInput, setSprInput] = useState('');
  const [answered, setAnswered] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [vaultCoins, setVaultCoins] = useState<number>(() => loadVaultCoins());
  const [roomProgress, setRoomProgress] = useState(0);
  const [seenAtStart, setSeenAtStart] = useState<string[]>(() => loadVaultSeen());
  const [questionLevel, setQuestionLevel] = useState<number>(() => arcadeLevel('vault'));
  const [message, setMessage] = useState<string | null>(null);
  const [best, setBest] = useState<number>(() => loadBest());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef<Room | null>(null);

  // Same fit as the interceptor: the room fills the stage in full screen
  // instead of sitting at its intrinsic size in the middle of it.
  useCanvasFit(canvasRef, stageRef, VIEW_W, VIEW_H, phase === 'playing');
  const gateRef = useRef(false);
  const questionOpenRef = useRef(false);
  const advancingRef = useRef(false);
  /** The room whose rune has already been paid; a room pays at most once. */
  const paidStageRef = useRef<number | null>(null);
  const keysRef = useRef<Keys>({ ...NO_KEYS });
  const stateRef = useRef<VaultState | null>(null);
  const camRef = useRef(0);
  const timeRef = useRef(0);
  const stageAnsweredRef = useRef(0);
  const stageCorrectRef = useRef(0);
  const stageStartRef = useRef(0);
  const triedRef = useRef(false);
  const sessionRef = useRef(newEventId());
  const messageTimer = useRef<number | null>(null);
  /** Last time the pinned-crate hint was shown, so holding a shove cannot spam it. */
  const pinnedAtRef = useRef(0);
  const roomProgressRef = useRef(0);
  const awardCoinsRef = useRef(app.actions.awardCoins);
  const advanceRef = useRef<() => void>(() => {});
  const openRef = useRef<() => void>(() => {});
  useEffect(() => {
    awardCoinsRef.current = app.actions.awardCoins;
  }, [app.actions.awardCoins]);

  // Frozen at mount so answering a gate question cannot swap the items in
  // rooms the player has not reached yet.
  const [progressAtStart] = useState(() => app.progress);
  const pool: RuneItem[] = useMemo(() => {
    if (!seed) return [];
    // The room number resets, the question history does not. Take a fresh,
    // level-appropriate slice first, then let the existing family/freshness
    // builder interleave R&W and Math without near-duplicates.
    const candidates = takeArcadeQuestions('vault', app.questions, 240, seed);
    return buildRunePool(candidates, seed, 80, progressAtStart, seenAtStart);
  }, [app.questions, seed, progressAtStart, seenAtStart]);
  const poolRef = useRef<RuneItem[]>([]);
  const poolIndexRef = useRef(0);
  useEffect(() => {
    poolRef.current = pool;
  }, [pool]);

  const activeQuestion = useMemo(
    () => (question ? app.questions.find((q) => q.id === question.questionId) ?? null : null),
    [app.questions, question]
  );

  const flash = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(null), 2800);
  }, []);

  /**
   * R is a full level reset, not a crate reset. It restores the player to the
   * door, every crate and snake to its generated position, every lever to its
   * resting state, closes the gate again and clears the current rune panel.
   * The stage and the question history are deliberately untouched.
   */
  const resetLevel = useCallback(() => {
    const current = roomRef.current;
    if (!current) return;
    stateRef.current = createVaultState(current);
    gateRef.current = false;
    setGateOpen(false);
    setQuestion(null);
    setFeedback(null);
    setRoomProgress(0);
    roomProgressRef.current = 0;
    questionOpenRef.current = false;
    camRef.current = 0;
    triedRef.current = false;
    pinnedAtRef.current = 0;
    flash('Level reset — back to the door.');
  }, [flash]);
  const resetLevelRef = useRef(resetLevel);
  useEffect(() => {
    resetLevelRef.current = resetLevel;
  }, [resetLevel]);

  useEffect(
    () => () => {
      if (messageTimer.current) window.clearTimeout(messageTimer.current);
    },
    []
  );

  // A new room always resets the player at its entrance, the crates to their
  // spawn and every lever to its resting position.
  useEffect(() => {
    if (!room) return;
    roomRef.current = room;
    stateRef.current = createVaultState(room);
    setRoomProgress(0);
    roomProgressRef.current = 0;
    camRef.current = 0;
    gateRef.current = false;
    questionOpenRef.current = false;
    setGateOpen(false);
    setQuestion(null);
    setFeedback(null);
    advancingRef.current = false;
    triedRef.current = false;
    pinnedAtRef.current = 0;
    stageStartRef.current = Date.now();
  }, [room]);

  useEffect(() => {
    questionOpenRef.current = question !== null;
    if (!question) keysRef.current = { ...NO_KEYS };
  }, [question]);

  /**
   * Pays the room that is open right now, once. Reaching the gate calls it
   * through `advance`; leaving mid-room (the Leave vault button, a tab switch
   * or a closed app) calls it too, so the rune that was actually answered is
   * saved instead of lost. `paidStageRef` holds the stage already settled.
   */
  const settleRoom = useCallback(() => {
    const current = roomRef.current?.stage;
    if (current === undefined) return;
    if (paidStageRef.current === current) return;
    const answeredThisStage = stageAnsweredRef.current;
    if (answeredThisStage < 1) return;
    paidStageRef.current = current;
    void app.actions.completeSession({
      activityType: 'mini_game',
      sessionId: `${sessionRef.current}:${current}`,
      questions: answeredThisStage,
      correct: stageCorrectRef.current,
      timeSpentSeconds: Math.max(1, Math.round((Date.now() - stageStartRef.current) / 1000)),
    });
  }, [app.actions]);

  useLeaveSave(() => {
    if (phase === 'playing') settleRoom();
  }, phase === 'playing');

  const advance = useCallback(() => {
    if (advancingRef.current || !roomRef.current) return;
    advancingRef.current = true;
    const current = roomRef.current.stage;
    settleRoom();
    const nextBest = Math.max(best, current);
    setBest(nextBest);
    try {
      localStorage.setItem(BEST_KEY, String(nextBest));
    } catch {
      /* device storage unavailable; the run still works */
    }
    stageAnsweredRef.current = 0;
    stageCorrectRef.current = 0;
    triedRef.current = false;
    const next = current + 1;
    setStage(next);
    setRoom(generateRoom(next, seed));
    flash(`Room ${next} — the vault goes deeper.`);
  }, [best, flash, seed, settleRoom]);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  const openQuestion = useCallback(() => {
    if (questionOpenRef.current) return;
    const items = poolRef.current;
    if (items.length === 0) return;
    const item = items[poolIndexRef.current % items.length];
    poolIndexRef.current += 1;
    markVaultSeen(item.questionId);
    questionOpenRef.current = true;
    setQuestion(item);
    setFeedback(null);
    setSprInput('');
    triedRef.current = false;
  }, []);

  useEffect(() => {
    openRef.current = openQuestion;
  }, [openQuestion]);

  // Movement: bound to the window while playing, ignored inside form fields.
  useEffect(() => {
    if (phase !== 'playing' || question) return;
    const isField = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const down = (event: KeyboardEvent) => {
      if (isField(event.target)) return;
      const key = event.key.toLowerCase();
      if (
        ['arrowleft', 'a', 'arrowright', 'd', 'arrowup', 'w', 'arrowdown', 's', ' ', 'r'].includes(
          key
        )
      ) {
        event.preventDefault();
      }
      if (key === 'r') {
        resetLevelRef.current();
        return;
      }
      // Auto-repeat is not a release (see applyVaultKey): a held key must keep
      // climbing for as long as the player holds it.
      applyVaultKey(keysRef.current, key, true, event.repeat);
    };
    const up = (event: KeyboardEvent) => {
      applyVaultKey(keysRef.current, event.key, false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keysRef.current = { ...NO_KEYS };
    };
  }, [phase, question]);

  // The simulation and canvas renderer.
  useEffect(() => {
    if (phase !== 'playing' || !room) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rng = makeRng(`${seed}:embers`);
    const embers: Ember[] = [];
    let frame = 0;
    let last = performance.now();
    let running = true;

    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
      last = now;
      timeRef.current += dt;
      const time = timeRef.current;
      const state = stateRef.current;
      if (!state) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const player = state.player;
      const keys = keysRef.current;
      const paused = questionOpenRef.current;

      if (!paused) {
        const step = stepVault(
          state,
          room,
          { left: keys.left, right: keys.right, jump: keys.jump, down: keys.down },
          dt
        );
        // Do not clear `keys.jump` after a jump: a held key or thumb is a
        // request to keep jumping, and on a rope it is how the climb continues.
        // Releasing the key is what stops it (keyup/pointerup).
        if (step.lever) {
          flash(
            step.changed.includes('bridge')
              ? 'The drawbridge drops across the chasm.'
              : 'The portcullis grinds up into the ceiling.'
          );
        }
        if (step.coins.length > 0) {
          const found = step.coins.length;
          setVaultCoins((previous) => {
            const next = previous + found;
            saveVaultCoins(next);
            return next;
          });
          // One tick can collect several coins. Award the exact total once so a
          // cloud run does not fire one RPC and one full account refresh per coin.
          const coinKey = [...step.coins].sort().join('+');
          void awardCoinsRef.current(found, `${sessionRef.current}:${room.stage}:${coinKey}`);
          flash(found === 1 ? 'A vault coin joins your bank.' : `${found} vault coins join your bank.`);
        }
        if (step.hurt) flash(HURT_TEXT[step.hurt]);
        else if (step.fell) flash('The dark sends you back to the door.');
        else if (step.pinned && time - pinnedAtRef.current > 3) {
          pinnedAtRef.current = time;
          flash('That crate is pinned — press R to reset the level.');
        }

        const gateCentre = room.gate.x + room.gate.w / 2;
        const playerCentre = player.x + PLAYER_W / 2;
        if (!gateRef.current) {
          if (Math.abs(playerCentre - gateCentre) < 74) openRef.current();
        } else if (player.x + PLAYER_W > room.gate.x + 22) {
          advanceRef.current();
        }
      }

      const target = clamp(
        player.x + PLAYER_W / 2 - VIEW_W * 0.42,
        0,
        Math.max(0, room.width - VIEW_W)
      );
      camRef.current += (target - camRef.current) * Math.min(1, dt * 6);
      const nextProgress = Math.round(
        Math.min(100, Math.max(0, ((player.x + PLAYER_W / 2) / (room.gate.x + room.gate.w / 2)) * 100))
      );
      if (nextProgress !== roomProgressRef.current) {
        roomProgressRef.current = nextProgress;
        setRoomProgress(nextProgress);
      }

      if (embers.length < 70) {
        for (const torch of room.torches) {
          if (rng() < dt * 2.4) {
            embers.push({
              x: torch.x + (rng() - 0.5) * 8,
              y: torch.y - 12,
              vx: (rng() - 0.5) * 18,
              vy: -24 - rng() * 30,
              life: 1,
              max: 1,
            });
          }
        }
      }
      for (let i = embers.length - 1; i >= 0; i -= 1) {
        const ember = embers[i];
        ember.life -= dt * 0.5;
        ember.x += ember.vx * dt;
        ember.y += ember.vy * dt;
        ember.vy *= 0.99;
        if (ember.life <= 0) embers.splice(i, 1);
      }

      drawScene(
        ctx,
        room,
        player,
        camRef.current,
        time,
        gateRef.current,
        keys,
        embers,
        state.crates,
        state.pulled,
        state.snakes,
        state.coins
      );
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, [flash, phase, room, seed]);

  const start = () => {
    // Time alone repeats if two runs start in the same millisecond; the extra
    // roll makes every descent a different vault.
    const nextSeed = `vault:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    noteArcadeRun('vault');
    setQuestionLevel(arcadeLevel('vault'));
    sessionRef.current = newEventId();
    poolIndexRef.current = 0;
    stageAnsweredRef.current = 0;
    stageCorrectRef.current = 0;
    paidStageRef.current = null;
    setSeenAtStart(loadVaultSeen());
    setVaultCoins(loadVaultCoins());
    setRoomProgress(0);
    roomProgressRef.current = 0;
    setSeed(nextSeed);
    setStage(1);
    setAnswered(0);
    setCorrect(0);
    setQuestion(null);
    setFeedback(null);
    setMessage(null);
    setRoom(generateRoom(1, nextSeed));
    setPhase('playing');
  };

  const finishStage = (ok: boolean) => {
    if (!question) return;
    if (!triedRef.current) {
      triedRef.current = true;
      stageAnsweredRef.current += 1;
      setAnswered((n) => n + 1);
      if (ok) {
        stageCorrectRef.current += 1;
        setCorrect((n) => n + 1);
      }
      // Only the first answer can pay or raise the tier. A correct retry after
      // a miss opens the gate, but it cannot erase the miss or earn the 3 coins.
      const progress = markArcadeQuestion('vault', question.questionId, ok);
      setQuestionLevel(progress.level);
      if (ok) {
        void awardCoinsRef.current(
          ARCADE_COINS.firstTryQuestion,
          `${sessionRef.current}:rune:${stage}:${question.questionId}`
        );
        if (progress.leveledUp) {
          flash(`Clean rune — question tier ${progress.level} unlocked.`);
        }
      }
    }
    if (!ok) {
      setFeedback({
        ok: false,
        text: `Not this rune. ${question.explanation}`,
      });
      return;
    }
    setFeedback({ ok: true, text: 'The rune accepts you. The gate is open.' });
    gateRef.current = true;
    setGateOpen(true);
    window.setTimeout(() => {
      questionOpenRef.current = false;
      setQuestion(null);
      setFeedback(null);
    }, 950);
  };

  if (phase === 'intro') {
    return (
      <Card>
        <div className="row-between">
          <div className="row">
            <h2 style={{ margin: 0 }}>The Rune Vault</h2>
            <Badge tone="info">2D platformer</Badge>
          </div>
          <Badge tone="neutral">Endless rooms</Badge>
        </div>
        <p className="muted">
          Walk with <strong>WASD</strong> or the arrow keys, jump with <strong>space</strong>, and
          hold <strong>space</strong> on a rope or ladder to climb (▼ or <strong>S</strong> to come
          down). Shove crates in rows, throw levers for the drawbridge and the portcullis, mind the
          spikes, bear traps and snakes, and open each sealed gate by answering the rune above it.
          Every room is generated fresh and packed harder than the last. Snakes stay coiled until
          you move, then follow the connected floor at a steady crawl — they cannot climb ropes and
          will not cross spikes or traps. Crates stop at spikes and traps, and they keep their
          positions when a trap or a fall sends you back, just like a thrown lever. Press
          <strong> R</strong> (or Reset level) to restore the whole room. Floating coins sit
          on the harder line and go straight into your HDCoins bank when you touch them.
        </p>
        <div className="card-grid" style={{ margin: '12px 0' }}>
          <Stat label="Deepest room" value={best > 0 ? best : '—'} />
          <Stat
            label="Question tier"
            value={`${questionLevel}/10`}
            hint={`${arcadeLevelLabel('vault')} · only clean first tries raise it`}
          />
          <Stat
            label="Vault coins"
            value={vaultCoins}
            hint="1 each · 3 for a first-try rune"
          />
          <Stat label="Rooms" value="∞" hint="Procedural, never repeats exactly" />
        </div>
        <p className="muted" style={{ marginTop: -2 }}>
          Each room has one to five coins. Touching one pays 1 HDCoin; a gate answered
          correctly on the first try pays {ARCADE_COINS.firstTryQuestion}.
        </p>
        <Button onClick={start}>
          <Icon name="castle" size={14} /> Enter the vault
        </Button>
      </Card>
    );
  }

  return (
    <Card className="vault-card">
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>The Rune Vault</h2>
          <Badge tone="info">Room {stage}</Badge>
          <Badge tone="neutral">Tier {questionLevel}</Badge>
          <Badge tone={correct > 0 ? 'good' : 'neutral'}>{correct} solved</Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // Leaving mid-room still saves the rune that was answered.
            settleRoom();
            setPhase('intro');
            setQuestion(null);
            setRoom(null);
          }}
        >
          Leave vault
        </Button>
      </div>

      <GameShell
        title="The Rune Vault"
        hint={`Room ${stage} · tier ${questionLevel} · ${correct} solved`}
      >
        <div className="vault-stage" ref={stageRef}>
          <canvas
            ref={canvasRef}
            width={VIEW_W}
            height={VIEW_H}
            className="vault-canvas"
            aria-label="Side-view stone vault. Move with WASD or arrow keys, jump with space, push crates, pull levers and answer the rune to open the gate."
          />

          {message ? <div className="vault-flash">{message}</div> : null}

          <div
            className={`vault-progress${gateOpen ? ' is-open' : ''}`}
            role="progressbar"
            aria-label={gateOpen ? 'Room complete — gate open' : 'Room progress'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={gateOpen ? 100 : roomProgress}
            title={gateOpen ? 'Gate open — walk through' : `${roomProgress}% of the room`}
          >
            <span style={{ width: `${gateOpen ? 100 : roomProgress}%` }} />
          </div>

          {question && activeQuestion ? (
            <RuneQuestionCard
              item={question}
              question={activeQuestion}
              feedback={feedback}
              sprInput={sprInput}
              onSprChange={setSprInput}
              onAnswer={finishStage}
              assessment={app.settings.assessment}
            />
          ) : null}
        </div>

        <div className="vault-controls">
          <VaultPad onChange={(action, down) => (keysRef.current[action] = down)} />
          <button
            type="button"
            className="btn btn-outline btn-sm vault-reset"
            onClick={resetLevel}
            title="Reset the entire level (R)"
          >
            Reset level
          </button>
          <span className="muted vault-help">
            {answered} answered · deepest room {Math.max(best, stage)} · WASD / arrows + space ·
            R resets the level
          </span>
        </div>
      </GameShell>
    </Card>
  );
}
