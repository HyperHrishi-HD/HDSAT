import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameShell } from './GameShell';
import { RuneQuestionCard } from './RuneQuestionCard';
import { Badge, Button, Card, Icon, Stat } from './ui';
import {
  buildRunePool,
  describeRoom,
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
  type Wall,
} from '../lib/arcadeGames';
import { useCanvasFit } from '../lib/canvasFit';
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
    const teeth = 8;
    const step = hazard.w / teeth;
    ctx.fillStyle = '#9aa6b8';
    for (let i = 0; i < teeth; i += 1) {
      const sx = x + i * step;
      ctx.beginPath();
      ctx.moveTo(sx, hazard.y + hazard.h);
      ctx.lineTo(sx + step / 2, hazard.y - 4);
      ctx.lineTo(sx + step, hazard.y + hazard.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,120,120,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, hazard.y + hazard.h);
    ctx.lineTo(x + hazard.w, hazard.y + hazard.h);
    ctx.stroke();
    const pulse = 0.16 + Math.sin(time * 4) * 0.05;
    ctx.fillStyle = `rgba(255,90,90,${pulse})`;
    ctx.fillRect(x - 6, hazard.y - 10, hazard.w + 12, 24);
    return;
  }

  // Bear trap: two jaws, teeth inward, one jaw trembling on its spring.
  const tremble = Math.sin(time * 8 + hazard.x) * 0.6;
  const cx = x + hazard.w / 2;
  ctx.strokeStyle = '#8e8175';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, hazard.y + hazard.h + 2, hazard.w / 2, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#a9b3c0';
  for (let i = 0; i < 6; i += 1) {
    const sx = x + 2 + (i * (hazard.w - 4)) / 5;
    ctx.beginPath();
    ctx.moveTo(sx, hazard.y + hazard.h);
    ctx.lineTo(sx + 2.5, hazard.y - 6 + tremble);
    ctx.lineTo(sx + 5, hazard.y + hazard.h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#6b5d50';
  ctx.fillRect(x + 1, hazard.y + hazard.h - 3, hazard.w - 2, 4);
  ctx.fillStyle = 'rgba(255,120,120,0.5)';
  ctx.fillRect(cx - 5, hazard.y + hazard.h + 4, 10, 2);
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
  snakes: Snake[]
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
  const [mechanisms, setMechanisms] = useState(0);
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
  const advanceRef = useRef<() => void>(() => {});
  const openRef = useRef<() => void>(() => {});

  // Frozen at mount so answering a gate question cannot swap the items in
  // rooms the player has not reached yet.
  const [progressAtStart] = useState(() => app.progress);
  const pool: RuneItem[] = useMemo(
    () => (seed ? buildRunePool(app.questions, seed, 40, progressAtStart) : []),
    [app.questions, seed, progressAtStart]
  );
  const poolRef = useRef<RuneItem[]>([]);
  const poolIndexRef = useRef(0);
  useEffect(() => {
    poolRef.current = pool;
  }, [pool]);

  const activeQuestion = useMemo(
    () => (question ? app.questions.find((q) => q.id === question.questionId) ?? null : null),
    [app.questions, question]
  );

  // The intro's "new each room" readout is drawn from a room rolled for this
  // mount, so it is a real sample of the machinery rather than the same line
  // every time the card is opened.
  const previewRoom = useMemo(
    () => generateRoom(1, `preview-${Math.random().toString(36).slice(2, 9)}`),
    []
  );

  const flash = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(null), 2800);
  }, []);

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
    setMechanisms(0);
    camRef.current = 0;
    gateRef.current = false;
    questionOpenRef.current = false;
    setGateOpen(false);
    setQuestion(null);
    setFeedback(null);
    advancingRef.current = false;
    triedRef.current = false;
    stageStartRef.current = Date.now();
  }, [room]);

  useEffect(() => {
    questionOpenRef.current = question !== null;
    if (!question) keysRef.current = { ...NO_KEYS };
  }, [question]);

  const advance = useCallback(() => {
    if (advancingRef.current || !roomRef.current) return;
    advancingRef.current = true;
    const current = roomRef.current.stage;
    const answeredThisStage = stageAnsweredRef.current;
    const correctThisStage = stageCorrectRef.current;
    if (answeredThisStage > 0) {
      void app.actions.completeSession({
        activityType: 'mini_game',
        sessionId: `${sessionRef.current}:${current}`,
        questions: answeredThisStage,
        correct: correctThisStage,
        timeSpentSeconds: Math.max(1, Math.round((Date.now() - stageStartRef.current) / 1000)),
      });
    }
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
  }, [app.actions, best, flash, seed]);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  const openQuestion = useCallback(() => {
    if (questionOpenRef.current) return;
    const items = poolRef.current;
    if (items.length === 0) return;
    const item = items[poolIndexRef.current % items.length];
    poolIndexRef.current += 1;
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
        ['arrowleft', 'a', 'arrowright', 'd', 'arrowup', 'w', 'arrowdown', 's', ' '].includes(
          key
        )
      ) {
        event.preventDefault();
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
        if (step.jumped) keys.jump = false;
        if (step.lever) {
          setMechanisms(state.pulled.size);
          flash(
            step.changed.includes('bridge')
              ? 'The drawbridge drops across the chasm.'
              : 'The portcullis grinds up into the ceiling.'
          );
        }
        if (step.hurt) flash(HURT_TEXT[step.hurt]);
        else if (step.fell) flash('The dark sends you back to the door.');

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
        state.snakes
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
    const nextSeed = `vault:${Date.now()}`;
    sessionRef.current = newEventId();
    poolIndexRef.current = 0;
    stageAnsweredRef.current = 0;
    stageCorrectRef.current = 0;
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
          Every room is generated fresh and packed harder than the last, and the snakes hunt you
          from the moment you land. Falling or touching a trap only walks you back to the door.
        </p>
        <div className="card-grid" style={{ margin: '12px 0' }}>
          <Stat label="Deepest room" value={best > 0 ? best : '—'} />
          <Stat label="Reward" value="5–100 HDCoins" hint="Per room, five rewarded rooms a day" />
          <Stat
            label="New each room"
            value={describeRoom(previewRoom) || 'open floor'}
            hint="Changes with every room and every run"
          />
          <Stat label="Rooms" value="∞" hint="Procedural, never repeats exactly" />
        </div>
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
          <Badge tone={correct > 0 ? 'good' : 'neutral'}>{correct} solved</Badge>
          {mechanisms > 0 ? <Badge tone="neutral">{mechanisms} lever{mechanisms === 1 ? '' : 's'}</Badge> : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
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
        hint={`Room ${stage} · ${room ? describeRoom(room) : 'open floor'} · ${correct} solved`}
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

          <div className="vault-hint">
            {gateOpen
              ? 'The gate is open — walk through.'
              : room
                ? describeRoom(room)
                : 'Reach the rune gate.'}
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
          <div className="vault-dpad">
            <button
              type="button"
              className="vault-key"
              aria-label="Move left"
              onPointerDown={() => {
                keysRef.current.left = true;
              }}
              onPointerUp={() => {
                keysRef.current.left = false;
              }}
              onPointerLeave={() => {
                keysRef.current.left = false;
              }}
            >
              ◀
            </button>
            <button
              type="button"
              className="vault-key"
              aria-label="Move right"
              onPointerDown={() => {
                keysRef.current.right = true;
              }}
              onPointerUp={() => {
                keysRef.current.right = false;
              }}
              onPointerLeave={() => {
                keysRef.current.right = false;
              }}
            >
              ▶
            </button>
            <button
              type="button"
              className="vault-key is-jump"
              aria-label="Jump"
              onPointerDown={() => {
                keysRef.current.jump = true;
              }}
              onPointerUp={() => {
                keysRef.current.jump = false;
              }}
            >
              Jump
            </button>
            <button
              type="button"
              className="vault-key"
              aria-label="Climb down"
              onPointerDown={() => {
                keysRef.current.down = true;
              }}
              onPointerUp={() => {
                keysRef.current.down = false;
              }}
              onPointerLeave={() => {
                keysRef.current.down = false;
              }}
            >
              ▼
            </button>
          </div>
          <span className="muted vault-help">
            {answered} answered · deepest room {Math.max(best, stage)} · WASD / arrows + space
          </span>
        </div>
      </GameShell>
    </Card>
  );
}
