import {
  doorSolid,
  LEVER_REACH,
  type Crate,
  type HazardKind,
  type Ladder,
  type Room,
  type Snake,
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
  pulled: Set<string>;
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
 * as a release — which the component used to do to stop auto-jumping — cut the
 * hold off after the first repeat, so a climb stopped about half a body length
 * up the rope. A repeat is not a release: it changes nothing. Auto-jumping is
 * already prevented because a jump consumes the flag and only a fresh press
 * sets it again.
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
    pulled: new Set<string>(),
  };
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

  // The row: crates at the same level, edge to edge in the push direction.
  let lead = crate;
  for (let guard = 0; guard < 24; guard += 1) {
    const next = crates.find(
      (other) =>
        !group.includes(other) &&
        Math.abs(other.y + other.h - (lead.y + lead.h)) < 2 &&
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
    if (crates.some((other) => !group.includes(other) && overlap(crate, other))) return false;
    for (const door of room.doors) {
      if (door.kind !== 'portcullis' || !doorSolid(door, pulled)) continue;
      if (overlap(crate, door)) return false;
    }
    for (const wall of room.walls) {
      if (overlap(crate, wall)) return false;
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
  // letting them walk through it.
  if (direction !== 0) {
    for (const crate of state.crates) {
      playerBox.x = player.x;
      if (!overlap(playerBox, crate)) continue;
      const push =
        direction > 0
          ? player.x + PLAYER_W - crate.x
          : crate.x + crate.w - player.x;
      if (push <= 0 || push > 18) continue;
      const group = pushGroup(crate, direction as 1 | -1, state.crates);
      const dx = direction * push;
      if (groupCanMove(group, dx, room, state.crates, pulled)) {
        for (const member of group) member.x += dx;
        player.x += dx;
      }
      player.x =
        direction > 0
          ? Math.min(player.x, crate.x - PLAYER_W)
          : Math.max(player.x, crate.x + crate.w);
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

  // Snakes chase. They always turn toward the player and crawl in at their own
  // speed whenever the player is on their stretch of floor (up to a step's
  // height above it — a snake cannot climb a rope); otherwise they edge along
  // at half speed, waiting. They are still slower than a walk, so a chase is
  // something the player can leave behind, and the floor bounds keep them out
  // of chasms.
  for (const snake of state.snakes) {
    const centre = snake.x + snake.w / 2;
    const playerCentre = player.x + PLAYER_W / 2;
    const dx = playerCentre - centre;
    const feet = player.y + PLAYER_H;
    const onItsFloor = feet >= snake.y + snake.h - 200 && feet <= snake.y + snake.h + 8;
    const inRange = playerCentre > snake.from - 40 && playerCentre < snake.to + 40;
    snake.dir = dx >= 0 ? 1 : -1;
    const speed = onItsFloor && inRange ? snake.speed : snake.speed * 0.45;
    snake.x += snake.dir * speed * dt;
    if (snake.x < snake.from) {
      snake.x = snake.from;
    } else if (snake.x + snake.w > snake.to) {
      snake.x = snake.to - snake.w;
    }
  }

  // Danger is a walk back to the door, never a lost run.
  const hitBox: Box = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
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
    // Every snake goes back to where it started, so the next attempt is the
    // same room and not one with a guard already sniffing the door.
    state.snakes = room.snakes.map((snake) => ({ ...snake }));
  }

  if (player.y > room.height + 140) {
    backToTheDoor(player, room);
    state.snakes = room.snakes.map((snake) => ({ ...snake }));
    step.fell = true;
  }

  return step;
}
