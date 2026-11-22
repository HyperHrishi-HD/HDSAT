import {
  doorSolid,
  LEVER_REACH,
  type Crate,
  type HazardKind,
  type Ladder,
  type Room,
  type Snake,
  type VaultCoin,
} from './arcadeGames';

/**
 * The Rune Vault's simulation, with no canvas and no React.
 *
 * Keeping the physics pure is what makes it testable: the same step function
 * runs in the browser at 60fps and in the unit tests at a fixed 16ms, so a
 * crate that can be shoved through a wall, a rope that cannot be climbed or a
 * spike strip you can walk through shows up in a test instead of in a player's
 * run.
 */

export const PLAYER_W = 30;
export const PLAYER_H = 44;
export const MOVE_SPEED = 265;
export const GRAVITY = 1900;
export const JUMP_SPEED = 630;
export const MAX_FALL = 1400;
/** Ropes are slower than walking, which is what makes a chase feel like one. */
export const CLIMB_SPEED = 172;

export interface VaultPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  facing: 1 | -1;
  walk: number;
}

export interface VaultState {
  player: VaultPlayer;
  crates: Crate[];
  snakes: Snake[];
  coins: VaultCoin[];
  pulled: Set<string>;
  /**
   * Snakes are asleep until the player first moves. A room opens quiet: cross
   * the floor while standing still and nothing follows; take one step and every
   * snake on the connected floor starts hunting at its own steady speed.
   */
  snakesAwake: boolean;
}

export interface VaultInput {
  left: boolean;
  right: boolean;
  /** Jump on the ground; climb while on a rope or ladder. */
  jump: boolean;
  /** Descend a rope or ladder. */
  down: boolean;
}

/**
 * The four held keys the vault reads, updated from real keyboard events.
 *
 * Holding a key makes the operating system repeat `keydown`. Treating a repeat
 * as a release cut the hold off after the first repeat, so a climb stopped
 * about half a body length up the rope. A repeat is not a release: it changes
 * nothing. The flag stays true until the key is released, which is what lets a
 * held jump keep hopping and a held climb keep climbing.
 */
export function applyVaultKey(
  keys: VaultInput,
  key: string,
  pressed: boolean,
  repeat = false
): void {
  const name = key.toLowerCase();
  if (name === 'arrowleft' || name === 'a') {
    keys.left = pressed;
    return;
  }
  if (name === 'arrowright' || name === 'd') {
    keys.right = pressed;
    return;
  }
  if (name === 'arrowdown' || name === 's') {
    keys.down = pressed;
    return;
  }
  if (name === 'arrowup' || name === 'w' || name === ' ') {
    if (!pressed) keys.jump = false;
    else if (!repeat) keys.jump = true;
  }
}

export type VaultHurt = HazardKind | 'snake';

export interface VaultStep {
  jumped: boolean;
  fell: boolean;
  /** Lever thrown during this step, if any. */
  lever: string | null;
  /** Door kinds that changed state, for the flash message. */
  changed: string[];
  /** Hazard that sent the player back to the door, if any. */
  hurt: VaultHurt | null;
  /** True while the player is holding a rope. */
  climbing: boolean;
  /** A shove was blocked, usually by a wall, hazard or another crate. */
  pinned: boolean;
  /** IDs of floating coins collected during this step. */
  coins: string[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function createVaultState(room: Room): VaultState {
  return {
    player: {
      x: room.spawn.x,
      y: room.spawn.y,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: 1,
      walk: 0,
    },
    crates: room.crates.map((crate) => ({ ...crate })),
    snakes: room.snakes.map((snake) => ({ ...snake })),
    coins: (room.coins ?? []).map((coin) => ({ ...coin })),
    pulled: new Set<string>(),
    snakesAwake: false,
  };
}

/** Restore every crate to the position the room generated it at. */
export function resetVaultCrates(state: VaultState, room: Room): void {
  state.crates = room.crates.map((crate) => ({ ...crate }));
}

/** Everything with a walkable top in the current lever state. */
export function walkableSurfaces(room: Room, pulled: Set<string>): Box[] {
  const boxes: Box[] = room.platforms.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
  for (const door of room.doors) {
    if (door.kind === 'bridge' && doorSolid(door, pulled)) boxes.push(door);
  }
  // A wall's top is a ledge once you get up there.
  for (const wall of room.walls) boxes.push(wall);
  return boxes;
}

/** The climb the player's body is currently inside, if any. */
export function ladderFor(room: Room, box: Box): Ladder | null {
  const centre = box.x + box.w / 2;
  const feet = box.y + box.h;
  for (const ladder of room.ladders) {
    if (centre < ladder.x - 10 || centre > ladder.x + ladder.w + 10) continue;
    // Standing on the ledge above the rope is not climbing it.
    if (feet <= ladder.y + 2) continue;
    if (box.y >= ladder.y + ladder.h) continue;
    return ladder;
  }
  return null;
}

const touchesX = (a: Crate, b: Crate) =>
  a.x + a.w > b.x + 0.5 && a.x < b.x + b.w - 0.5;

/**
 * Every crate the shove has to carry: the row it is touching in the direction
 * of the push, plus anything resting on top of that row.
 *
 * This is the fix for the old "two boxes together cannot be moved" bug: the
 * push test only looked at the one crate the player touched, so as soon as a
 * second crate was against it the player was stopped dead. A row moves as a
 * row, and a stack moves with the crate underneath it.
 */
export function pushGroup(crate: Crate, direction: 1 | -1, crates: Crate[]): Crate[] {
  const group: Crate[] = [crate];

  // The row: crates edge to edge in the push direction with any vertical
  // overlap. The vertical-overlap test also keeps a crate that settled a pixel
  // off its neighbour in the same row, so a shove never jams one into another.
  let lead = crate;
  for (let guard = 0; guard < 24; guard += 1) {
    const next = crates.find(
      (other) =>
        !group.includes(other) &&
        other.y < lead.y + lead.h &&
        other.y + other.h > lead.y &&
        (direction > 0
          ? Math.abs(other.x - (lead.x + lead.w)) < 2
          : Math.abs(other.x + other.w - lead.x) < 2)
    );
    if (!next) break;
    group.push(next);
    lead = next;
  }

  // Anything stacked on any member, however many crates deep.
  for (let guard = 0; guard < 24; guard += 1) {
    const above = crates.find(
      (other) =>
        !group.includes(other) &&
        group.some(
          (base) =>
            touchesX(other, base) && Math.abs(other.y + other.h - base.y) < 2
        )
    );
    if (!above) break;
    group.push(above);
  }

  return group;
}

/**
 * Test a whole crate row's destination.
 *
 * Hazards are solid to a crate, just as they are to the player and the snakes.
 * A crate stops before a spike instead of sliding through it; the row moves as
 * one, so a second crate cannot be shoved into the first one's back. The
 * remaining wedge case — a crate pinned in a corner — is handled by the HUD's
 * explicit Reset crates control, so it can never leave the room permanently
 * unsolvable without the player choosing to reset.
 */
function groupCanMove(
  group: Crate[],
  dx: number,
  room: Room,
  crates: Crate[],
  pulled: Set<string>
): boolean {
  const moved = group.map((crate) => ({ ...crate, x: crate.x + dx }));
  for (const crate of moved) {
    if (crate.x < 0 || crate.x + crate.w > room.width) return false;
    if (crates.some((other) => !group.includes(other) && overlap(crate, other))) {
      return false;
    }
    for (const door of room.doors) {
      if (door.kind !== 'portcullis' || !doorSolid(door, pulled)) continue;
      if (overlap(crate, door)) return false;
    }
    for (const wall of room.walls) {
      if (overlap(crate, wall)) return false;
    }
    if (overlap(crate, room.gate)) return false;
    for (const hazard of room.hazards) {
      if (overlap(crate, hazard)) return false;
    }
  }
  return true;
}

function backToTheDoor(player: VaultPlayer, room: Room) {
  player.x = room.spawn.x;
  player.y = room.spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.onGround = false;
}

/**
 * A crate can be shoved all the way back to the entrance. Since crates now keep
 * their positions across a death (like a thrown lever), the respawn point could
 * otherwise open inside one. Move only the overlapping crate to the nearest free
 * slot; if there is none, put that one crate back at its origin. Every other
 * crate keeps the position the player left it in.
 */
function ensureSpawnClear(state: VaultState, room: Room): void {
  const spawn: Box = { x: room.spawn.x, y: room.spawn.y, w: PLAYER_W, h: PLAYER_H };
  for (const crate of state.crates) {
    if (!overlap(crate, spawn)) continue;
    let moved = false;
    for (const direction of [1, -1]) {
      for (let distance = 40; distance <= 200 && !moved; distance += 40) {
        const candidate: Box = { ...crate, x: crate.x + direction * distance };
        if (candidate.x < 0 || candidate.x + candidate.w > room.width) continue;
        if (overlap(candidate, spawn)) continue;
        const feet = candidate.y + candidate.h;
        const onFloor = walkableSurfaces(room, state.pulled).some(
          (surface) =>
            candidate.x + candidate.w / 2 >= surface.x &&
            candidate.x + candidate.w / 2 <= surface.x + surface.w &&
            Math.abs(feet - surface.y) <= 2
        );
        if (!onFloor) continue;
        if (state.crates.some((other) => other !== crate && overlap(candidate, other))) continue;
        if (room.walls.some((wall) => overlap(candidate, wall))) continue;
        if (room.hazards.some((hazard) => overlap(candidate, hazard))) continue;
        if (
          room.doors.some(
            (door) => doorSolid(door, state.pulled) && overlap(candidate, door)
          )
        ) {
          continue;
        }
        if (overlap(candidate, room.gate)) continue;
        crate.x = candidate.x;
        moved = true;
      }
      if (moved) break;
    }
    if (moved) continue;
    const origin = room.crates.find((original) => original.id === crate.id);
    if (origin) {
      crate.x = origin.x;
      crate.y = origin.y;
      crate.vy = 0;
    }
  }
}

/**
 * Whether a snake's feet are resting on a floor at its current level. Snakes
 * cannot climb, so a bridge counts only while it is down; a rope, a wall top or
 * a crate is not a floor it can reach.
 */
function snakeHasSupport(room: Room, pulled: Set<string>, box: Box): boolean {
  const feet = box.y + box.h;
  // Support is under the body's middle, not its trailing edge: a snake should
  // turn at a ledge instead of hanging half its length over the drop.
  const foot = box.x + box.w / 2;
  const coversX = (surface: { x: number; w: number }) =>
    foot >= surface.x && foot <= surface.x + surface.w;
  for (const platform of room.platforms) {
    if (coversX(platform) && Math.abs(feet - platform.y) <= 6) return true;
  }
  for (const door of room.doors) {
    if (door.kind !== 'bridge' || !doorSolid(door, pulled)) continue;
    if (coversX(door) && Math.abs(feet - door.y) <= 6) return true;
  }
  return false;
}

/** Everything a snake may not slither through at its current floor level. */
function snakeCanOccupy(
  room: Room,
  pulled: Set<string>,
  crates: Crate[],
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const box: Box = { x, y, w, h };
  if (box.x < 0 || box.x + box.w > room.width) return false;
  if (!snakeHasSupport(room, pulled, box)) return false;
  for (const hazard of room.hazards) {
    if (overlap(box, hazard)) return false;
  }
  for (const wall of room.walls) {
    if (overlap(box, wall)) return false;
  }
  for (const door of room.doors) {
    if (doorSolid(door, pulled) && overlap(box, door)) return false;
  }
  for (const crate of crates) {
    if (overlap(box, crate)) return false;
  }
  // The gate is the room's edge; snakes stay inside it.
  if (overlap(box, room.gate)) return false;
  return true;
}

/**
 * A straight walk along the connected floor is the snake's line of sight. If a
 * pit, wall, hazard, crate or closed door breaks that line, the snake cannot
 * reach the player and keeps patrolling instead of pressing into the obstacle.
 */
function snakeCanSeePlayer(
  state: VaultState,
  room: Room,
  snake: Snake,
  pulled: Set<string>
): boolean {
  const player = state.player;
  const snakeFeet = snake.y + snake.h;
  const playerFeet = player.y + PLAYER_H;
  if (Math.abs(playerFeet - snakeFeet) > 64) return false;
  const from = snake.x + snake.w / 2;
  const to = player.x + PLAYER_W / 2;
  const direction = to >= from ? 1 : -1;
  const step = 10;
  for (let x = from; direction > 0 ? x <= to : x >= to; x += direction * step) {
    if (!snakeCanOccupy(room, pulled, state.crates, x - snake.w / 2, snake.y, snake.w, snake.h)) {
      return false;
    }
  }
  return true;
}

/**
 * One fixed step. `dt` is capped by the caller (the renderer uses 33ms) so a
 * stalled tab cannot teleport the player through a wall.
 */
export function stepVault(
  state: VaultState,
  room: Room,
  input: VaultInput,
  dt: number
): VaultStep {
  const step: VaultStep = {
    jumped: false,
    fell: false,
    lever: null,
    changed: [],
    hurt: null,
    climbing: false,
    pinned: false,
    coins: [],
  };
  const player = state.player;
  const pulled = state.pulled;

  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  player.vx = direction * MOVE_SPEED;
  if (direction !== 0) {
    player.facing = direction > 0 ? 1 : -1;
    player.walk += dt;
  }

  const playerBox: Box = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
  const ladder = ladderFor(room, playerBox);

  // The first deliberate movement wakes the room. Down on the floor is not
  // movement; down on a rope is. Until then the snakes hold their ground, which
  // is what lets a player read the room before committing.
  if (!state.snakesAwake && (direction !== 0 || input.jump || (input.down && ladder))) {
    state.snakesAwake = true;
  }

  if (input.jump && player.onGround && !ladder) {
    player.vy = -JUMP_SPEED;
    player.onGround = false;
    step.jumped = true;
  }

  // Horizontal movement, then closed bars and stone walls.
  const dx = player.vx * dt;
  player.x = Math.min(Math.max(player.x + dx, 0), room.width - PLAYER_W);
  playerBox.x = player.x;
  for (const door of room.doors) {
    if (door.kind !== 'portcullis' || !doorSolid(door, pulled)) continue;
    playerBox.x = player.x;
    if (!overlap(playerBox, door)) continue;
    if (dx > 0) player.x = door.x - PLAYER_W;
    else if (dx < 0) player.x = door.x + door.w;
  }
  for (const wall of room.walls) {
    playerBox.x = player.x;
    if (!overlap(playerBox, wall)) continue;
    if (dx > 0) player.x = wall.x - PLAYER_W;
    else if (dx < 0) player.x = wall.x + wall.w;
  }

  // Shoving crates. The whole row (and everything stacked on it) moves or
  // nothing does — a crate wedged against a wall stops the player instead of
  // letting them walk through it. Resolve only the first crate in the walking
  // direction: the old loop could process the same row twice after moving it,
  // which is what made a two-crate row appear to stick until the player backed
  // off and ran at it again.
  if (direction !== 0) {
    playerBox.x = player.x;
    const blocking = state.crates
      .filter((crate) => overlap(playerBox, crate))
      .sort((a, b) => (direction > 0 ? a.x - b.x : b.x - a.x))[0];
    if (blocking) {
      const push =
        direction > 0
          ? player.x + PLAYER_W - blocking.x
          : blocking.x + blocking.w - player.x;
      const group = pushGroup(blocking, direction as 1 | -1, state.crates);
      const shoveDx = direction * Math.max(0, Math.min(18, push));
      if (push > 0 && groupCanMove(group, shoveDx, room, state.crates, pulled)) {
        for (const member of group) member.x += shoveDx;
        player.x += shoveDx;
        player.x =
          direction > 0
            ? blocking.x - PLAYER_W
            : blocking.x + blocking.w;
      } else {
        // Stop at the crate's face. Without this clamp the player could remain
        // a few pixels inside it, so the next frame found less room than the
        // shove needed and the row refused to start moving.
        player.x =
          direction > 0
            ? blocking.x - PLAYER_W
            : blocking.x + blocking.w;
        step.pinned = true;
      }
    }
  }

  if (ladder) {
    // Holding a rope: gravity is off, jump climbs, down descends, and the
    // player is clamped to the rope's own ends. The top is the top of the rope
    // (its feet reach the cap), which is what lets a climb finish on the ledge:
    // the old clamp stopped a body length short and left the player hanging in
    // the middle of the wall.
    step.climbing = true;
    player.onGround = false;
    const climb = input.jump ? -CLIMB_SPEED : input.down ? CLIMB_SPEED : 0;
    player.vy = climb;
    player.y += climb * dt;
    // Feet stop exactly on the ladder's top edge. A two-pixel overshoot used
    // to leave the player hanging just above the ledge with the climb still
    // active, so gravity never took over and the ledge could not be stood on.
    const top = ladder.y - PLAYER_H;
    const bottom = ladder.y + ladder.h - PLAYER_H;
    if (player.y < top) {
      player.y = top;
      player.vy = 0;
    } else if (player.y > bottom) {
      player.y = bottom;
      player.vy = 0;
    }
  } else {
    // Gravity, landing on floors, bridges, wall tops and crate tops.
    player.vy = Math.min(player.vy + GRAVITY * dt, MAX_FALL);
    const previousBottom = player.y + PLAYER_H;
    player.y += player.vy * dt;
    player.onGround = false;
    if (player.vy >= 0) {
      for (const surface of [...walkableSurfaces(room, pulled), ...state.crates]) {
        const bottom = player.y + PLAYER_H;
        const overlapsX = player.x + PLAYER_W > surface.x && player.x < surface.x + surface.w;
        if (!overlapsX) continue;
        if (previousBottom <= surface.y + 1 && bottom >= surface.y) {
          player.y = surface.y - PLAYER_H;
          player.vy = 0;
          player.onGround = true;
        }
      }
    }
  }

  // Crates fall, settle, and leave the room if they drop into a chasm.
  for (let index = state.crates.length - 1; index >= 0; index -= 1) {
    const crate = state.crates[index];
    crate.vy = Math.min(crate.vy + GRAVITY * dt, MAX_FALL);
    const before = crate.y + crate.h;
    crate.y += crate.vy * dt;
    if (crate.vy >= 0) {
      const floors = walkableSurfaces(room, pulled);
      const others = state.crates.filter((other) => other !== crate);
      for (const surface of [...floors, ...others]) {
        const after = crate.y + crate.h;
        const overlapsX = crate.x + crate.w > surface.x && crate.x < surface.x + surface.w;
        if (!overlapsX) continue;
        if (before <= surface.y + 1 && after >= surface.y) {
          crate.y = surface.y - crate.h;
          crate.vy = 0;
        }
      }
    }
    if (crate.y > room.height + 120) state.crates.splice(index, 1);
  }

  // Walking into a lever throws it, once.
  for (const lever of room.levers) {
    if (pulled.has(lever.id)) continue;
    const near =
      Math.abs(player.x + PLAYER_W / 2 - lever.x) < LEVER_REACH &&
      player.y + PLAYER_H > lever.y - 34 &&
      player.y < lever.y + 30;
    if (!near) continue;
    pulled.add(lever.id);
    const door = room.doors.find((d) => d.id === lever.doorId);
    if (door) step.changed.push(door.kind);
    step.lever = lever.id;
  }

  // Snakes hunt only after the player moves. Once awake, every snake moves at
  // the same steady speed. It takes the direct route only when the connected
  // floor is clear; otherwise it patrols its own floor and turns at the first
  // pit, wall, crate, closed door, trap or spike. There are no patrol bounds:
  // an open drawbridge is enough to carry a snake across the whole room.
  if (state.snakesAwake) {
    for (const snake of state.snakes) {
      const centre = snake.x + snake.w / 2;
      const playerCentre = player.x + PLAYER_W / 2;
      if (snakeCanSeePlayer(state, room, snake, pulled)) {
        snake.dir = playerCentre >= centre ? 1 : -1;
      }
      const travel = snake.dir * snake.speed * dt;
      if (snakeCanOccupy(room, pulled, state.crates, snake.x + travel, snake.y, snake.w, snake.h)) {
        snake.x += travel;
      } else {
        // Turn only when the reverse direction is actually free. If a crate or
        // the player has pinned the snake from both sides, leave its facing
        // alone: flipping it every frame made the sprite vibrate left-right.
        const reverseDir = snake.dir === 1 ? -1 : 1;
        const reverse = reverseDir * snake.speed * dt;
        if (snakeCanOccupy(room, pulled, state.crates, snake.x + reverse, snake.y, snake.w, snake.h)) {
          snake.dir = reverseDir;
          snake.x += reverse;
        }
      }
    }
  }

  // Floating coins are collected by touch. They are part of the room state, so
  // a death or a reset restores the uncollected ones deterministically.
  const hitBox: Box = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
  for (let index = state.coins.length - 1; index >= 0; index -= 1) {
    const coin = state.coins[index];
    if (!overlap(hitBox, coin)) continue;
    step.coins.push(coin.id);
    state.coins.splice(index, 1);
  }

  // Danger is a walk back to the door, never a lost run.
  let hurt: VaultHurt | null = null;
  for (const hazard of room.hazards) {
    if (
      overlap(hitBox, {
        x: hazard.x + 2,
        y: hazard.y + 2,
        w: hazard.w - 4,
        h: hazard.h - 2,
      })
    ) {
      hurt = hazard.kind;
      break;
    }
  }
  if (!hurt) {
    for (const snake of state.snakes) {
      if (overlap(hitBox, snake)) {
        hurt = 'snake';
        break;
      }
    }
  }
  if (hurt) {
    step.hurt = hurt;
    backToTheDoor(player, room);
    // Snakes coil again, but the room keeps its progress: levers stay thrown
    // and crates stay where the player left them. The HUD's explicit Reset
    // crates control is the escape hatch if a crate is genuinely pinned.
    state.snakes = room.snakes.map((snake) => ({ ...snake }));
    state.snakesAwake = false;
    ensureSpawnClear(state, room);
  }

  if (player.y > room.height + 140) {
    backToTheDoor(player, room);
    state.snakes = room.snakes.map((snake) => ({ ...snake }));
    state.snakesAwake = false;
    ensureSpawnClear(state, room);
    step.fell = true;
  }

  return step;
}
