// @vitest-environment jsdom
/**
 * The Vault's physics used to live inside the render loop, where only a person
 * with a keyboard could test it. It is a pure function now, so these tests pin
 * the things a player would notice as a glitch: standing, jumping, shoving
 * crates, throwing levers, falling into a chasm, and walking through a door
 * that is only solid in one lever state.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { doorSolid, generateRoom, type Room } from './arcadeGames';
import {
  applyVaultKey,
  createVaultState,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_H,
  PLAYER_W,
  stepVault,
  type VaultInput,
  type VaultState,
} from './vaultPhysics';
import {
  hiddenLabelsFor,
  locksEnabled,
  pulsesFor,
  toleranceFor,
  toX,
  toY,
} from '../components/CoordinateInterceptor';
import { buildInterceptWave, targetsOnAim, targetsOnLine } from './arcadeGames';

const IDLE = { left: false, right: false, jump: false, down: false };
const DT = 1 / 60;

function settle(state: VaultState, room: Room, steps = 40) {
  for (let i = 0; i < steps; i += 1) stepVault(state, room, IDLE, DT);
  return state;
}

function run(state: VaultState, room: Room, input: Partial<typeof IDLE>, steps: number) {
  for (let i = 0; i < steps; i += 1) {
    stepVault(state, room, { ...IDLE, ...input }, DT);
  }
}

/** A hand-built room: flat floor, no machinery, one crate. */
function flatRoom(): Room {
  return {
    stage: 1,
    width: 1200,
    height: 460,
    groundY: 400,
    platforms: [
      { id: 'ground-0', kind: 'ground', x: 0, y: 400, w: 1200, h: 60 },
      { id: 'ledge-0', kind: 'ledge', x: 500, y: 280, w: 140, h: 16 },
    ],
    crates: [{ id: 'crate-0', x: 300, y: 360, w: 40, h: 40, vy: 0 }],
    doors: [],
    levers: [],
    torches: [],
    ladders: [],
    walls: [],
    hazards: [],
    snakes: [],
    spawn: { x: 60, y: 356 },
    gate: { x: 1080, y: 304, w: 54, h: 96 },
  };
}

beforeEach(() => {
  /* nothing global to reset: the state is passed in */
});

describe('vault physics', () => {
  it('lands the player on the floor instead of sinking through it', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    expect(state.player.onGround).toBe(true);
    expect(state.player.y + PLAYER_H).toBeCloseTo(400, 5);
    expect(state.player.vy).toBe(0);
  });

  it('jumps about a hundred pixels high and lands again', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    const floorY = state.player.y;
    let peak = floorY;
    stepVault(state, room, { ...IDLE, jump: true }, DT);
    for (let i = 0; i < 120; i += 1) {
      stepVault(state, room, IDLE, DT);
      peak = Math.min(peak, state.player.y);
    }
    const height = floorY - peak;
    expect(height).toBeGreaterThan(90);
    expect(height).toBeLessThan(115);
    expect(state.player.onGround).toBe(true);
  });

  it('walks at the intended speed and stops at the room edge', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    state.crates = []; // a crate in the way would (correctly) stop the walk
    const start = state.player.x;
    run(state, room, { right: true }, 30);
    expect(state.player.x).toBeGreaterThan(start + 100);
    run(state, room, { right: true }, 600);
    expect(state.player.x).toBeCloseTo(room.width - PLAYER_W, 0);
  });

  it('shoves a crate ahead of the player and cannot push it through the far wall', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    state.player.x = 250;
    state.player.y = 356;
    const crate = state.crates[0];
    const before = crate.x;
    run(state, room, { right: true }, 90);
    expect(crate.x).toBeGreaterThan(before + 20);
    expect(crate.x).toBeGreaterThan(state.player.x);

    // A crate wedged against the room edge has nowhere to go, so it stops the
    // player rather than letting them walk through it.
    crate.x = room.width - crate.w;
    state.player.x = crate.x - PLAYER_W - 2;
    run(state, room, { right: true }, 30);
    expect(state.player.x).toBeLessThanOrEqual(crate.x - PLAYER_W + 0.6);
  });

  it('lets the player stand on a crate to reach a high ledge', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    const crate = state.crates[0];
    state.player.x = crate.x;
    state.player.y = crate.y - PLAYER_H;
    run(state, room, IDLE, 4);
    expect(state.player.onGround).toBe(true);
    expect(state.player.y + PLAYER_H).toBeCloseTo(crate.y, 4);
  });

  it('throws a lever on contact and opens its door exactly once', () => {
    const room = generateRoom(4, 'lever-test');
    const lever = room.levers[0];
    expect(lever).toBeDefined();
    const state = settle(createVaultState(room), room);
    state.player.x = lever.x - 6;
    state.player.y = room.groundY - PLAYER_H;
    let thrown = 0;
    for (let i = 0; i < 20; i += 1) {
      const step = stepVault(state, room, IDLE, DT);
      if (step.lever) thrown += 1;
    }
    expect(thrown).toBe(1);
    expect(state.pulled.has(lever.id)).toBe(true);

    const door = room.doors.find((d) => d.id === lever.doorId)!;
    // The lever has to change the door, whether that means a bridge appearing
    // in the walkable surfaces or a portcullis disappearing.
    expect(doorSolid(door, new Set())).not.toBe(doorSolid(door, state.pulled));
  });

  it('blocks the corridor on a closed portcullis and opens it after the lever', () => {
    const room = generateRoom(4, 'portcullis-test');
    const bars = room.doors.find((d) => d.kind === 'portcullis');
    if (!bars) return; // this seed rolled a drawbridge room instead
    const state = settle(createVaultState(room), room);
    state.player.x = bars.x - 40;
    state.player.y = room.groundY - PLAYER_H;
    run(state, room, { right: true }, 60);
    expect(state.player.x + PLAYER_W).toBeLessThanOrEqual(bars.x + 0.5);

    state.pulled.add(bars.leverId);
    run(state, room, { right: true }, 90);
    expect(state.player.x).toBeGreaterThan(bars.x + bars.w);
  });

  it('drops the drawbridge so a wide chasm becomes crossable', () => {
    const room = generateRoom(4, 'bridge-test');
    const bridge = room.doors.find((d) => d.kind === 'bridge');
    if (!bridge) return; // this seed rolled a portcullis room instead
    const state = settle(createVaultState(room), room);
    state.player.x = bridge.x + bridge.w / 2 - PLAYER_W / 2;
    state.player.y = 100;
    // Without the lever the bridge is a hole: the player falls and is reset.
    let fell = false;
    for (let i = 0; i < 200 && !fell; i += 1) {
      fell = stepVault(state, room, IDLE, DT).fell;
    }
    expect(fell).toBe(true);

    state.pulled.add(bridge.leverId);
    state.player.x = bridge.x + 6;
    state.player.y = 100;
    let fellAgain = false;
    for (let i = 0; i < 160; i += 1) {
      if (stepVault(state, room, IDLE, DT).fell) fellAgain = true;
    }
    expect(fellAgain).toBe(false);
    expect(state.player.onGround).toBe(true);
    // Either the bridge itself or a ledge above it is a legal landing spot.
    expect(state.player.y + PLAYER_H).toBeLessThanOrEqual(bridge.y + 0.5);
  });

  it('never sends the player out of the room horizontally', () => {
    const room = generateRoom(7, 'bounds-test');
    const state = createVaultState(room);
    state.player.x = -50;
    stepVault(state, room, { ...IDLE, left: true }, DT);
    expect(state.player.x).toBeGreaterThanOrEqual(0);

    state.player.x = room.width + 50;
    stepVault(state, room, { ...IDLE, right: true }, DT);
    expect(state.player.x).toBeLessThanOrEqual(room.width - PLAYER_W);
  });

  it('keeps a stalled frame from tunnelling through a floor', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    state.player.y = 350;
    state.player.vy = 1400;
    stepVault(state, room, IDLE, 0.033);
    expect(state.player.y + PLAYER_H).toBeLessThanOrEqual(room.groundY + 0.001);
  });

  it('agrees with the jump tuning constants', () => {
    // 104px of jump from these numbers is what the ledge heights are built for.
    const height = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(height).toBeGreaterThan(100);
    expect(height).toBeLessThan(110);
  });
});

describe('interceptor plane geometry', () => {
  it('uses the same scale on both axes, so one unit of slope is 45 degrees', () => {
    expect(toX(0)).toBe(450);
    expect(toY(0)).toBe(240);
    expect(toX(1) - toX(0)).toBe(75);
    expect(toY(0) - toY(1)).toBe(75);
  });

  it('draws the line where y = mx + b actually is', () => {
    // The regression this guards: the first build started the beam at the
    // ship's y-intercept instead of at x = -6, shifting every visual line by
    // 6m and making a correct read miss.
    const m = 1;
    const b = 0;
    const left = { x: toX(-6), y: toY(b - 6 * m) };
    const right = { x: toX(6), y: toY(b + 6 * m) };
    const midpoint = { x: toX(0), y: toY(b) };
    expect(left.y).toBe(690); // below the board: the line leaves the canvas
    expect(midpoint.y).toBe(240);
    expect(right.y).toBe(-210);
    const slope = (right.y - left.y) / (right.x - left.x);
    expect(slope).toBeCloseTo(-m, 6);
  });

  it('gives the player less help as the waves go on, without making one unfair', () => {
    for (let wave = 1; wave <= 10; wave += 1) {
      const waveData = buildInterceptWave(wave, 'ramp');
      const count = waveData.targets.length;
      expect(count).toBeGreaterThanOrEqual(2);

      // Every wave is still one exact curve away, and two coordinates are
      // always printed so a straight line can be recovered. A parabola keeps
      // every label, because three points are needed for a, h and k.
      const staticTargets = waveData.targets.filter((t) => t.kind !== 'ship');
      if (waveData.kind === 'line') {
        expect(targetsOnLine(staticTargets, waveData.m, waveData.b, 0.001)).toHaveLength(
          staticTargets.length
        );
      }
      const hidden = hiddenLabelsFor(wave, count, waveData.kind);
      expect(hidden).toBeLessThanOrEqual(Math.max(0, count - 2));
      expect(count - hidden).toBeGreaterThanOrEqual(2);
      if (waveData.kind === 'parabola') expect(hidden).toBe(0);
    }

    expect(pulsesFor(1)).toBe(3);
    expect(pulsesFor(9)).toBe(2);
    expect(toleranceFor(1)).toBeGreaterThan(toleranceFor(9));
    // Early waves hand over every label; later ones keep only two.
    expect(hiddenLabelsFor(1, 4)).toBe(0);
    expect(hiddenLabelsFor(3, 4)).toBe(1);
    expect(hiddenLabelsFor(9, 4)).toBe(2);
  });

  it('keeps LOCK for the first parabola waves, then takes it away', () => {
    expect(locksEnabled(1, 'line')).toBe(true);
    expect(locksEnabled(4, 'line')).toBe(true);
    expect(locksEnabled(5, 'line')).toBe(false);
    // Quadratic is introduced at wave 5; the mark must be there to learn it.
    expect(locksEnabled(5, 'parabola')).toBe(true);
    expect(locksEnabled(7, 'parabola')).toBe(true);
    expect(locksEnabled(9, 'parabola')).toBe(false);
  });

  it('locks every target of a real parabola wave when the curve matches', () => {
    const wave = buildInterceptWave(5, 'lock-check');
    expect(wave.kind).toBe('parabola');
    expect(locksEnabled(5, wave.kind)).toBe(true);
    const aim = { mode: 'quadratic' as const, a: wave.a, h: wave.h, k: wave.k };
    const locked = targetsOnAim(wave.targets, aim, toleranceFor(5), 0);
    expect(locked.length).toBe(wave.targets.length);
  });
});

describe('vault room layout', () => {
  const SEEDS = ['alpha', 'bravo', 'charlie'];

  it('builds every room so nothing is unreachable or floating', () => {
    for (let stage = 1; stage <= 30; stage += 1) {
      for (const seed of SEEDS) {
        const room = generateRoom(stage, seed);
        const grounds = room.platforms.filter((p) => p.kind === 'ground');

        // Every ledge is held up by a climb that reaches its height and stands
        // on solid ground, and it sits over a floor rather than a chasm.
        for (const ledge of room.platforms.filter((p) => p.kind === 'ledge')) {
          const climb = room.ladders.find(
            (l) =>
              l.x + l.w / 2 > ledge.x &&
              l.x + l.w / 2 < ledge.x + ledge.w &&
              Math.abs(l.y - ledge.y) <= 1
          );
          expect(climb, `stage ${stage} ${seed}: ledge at ${ledge.x} has no rope`).toBeTruthy();
          // A ledge is a bridge over a chasm now: both ends have to land on
          // floor, or the crossing it promises ends in a fall.
          const covers = (x: number) => grounds.some((g) => x >= g.x - 1 && x <= g.x + g.w + 1);
          expect(covers(ledge.x + 30), `stage ${stage} ${seed}: ledge start over a chasm`).toBe(
            true
          );
          expect(
            covers(ledge.x + ledge.w - 30),
            `stage ${stage} ${seed}: ledge end over a chasm`
          ).toBe(true);
        }

        // Every wall is passable: a rope on its face, or a crate on its
        // approach close enough to push against it.
        for (const wall of room.walls) {
          const rope = room.ladders.some(
            (l) => l.x + l.w > wall.x - 46 && l.x < wall.x && l.y <= wall.y + 2
          );
          const crate = room.crates.some(
            (c) => c.x < wall.x && c.x + c.w > wall.x - 260 && c.x > wall.x - 320
          );
          expect(rope || crate, `stage ${stage} ${seed}: wall at ${wall.x} is impassable`).toBe(
            true
          );
        }

        // Nothing lethal is waiting on the doorstep, and every lever stands on
        // a floor that is at least a body wide.
        for (const hazard of room.hazards) {
          expect(hazard.x).toBeGreaterThan(room.spawn.x + 120);
          expect(hazard.x).toBeLessThan(room.gate.x - 20);
        }
        for (const lever of room.levers) {
          const floor = grounds.find((g) => lever.x >= g.x && lever.x <= g.x + g.w);
          expect(floor, `stage ${stage} ${seed}: lever over a gap`).toBeTruthy();
          expect(lever.x - (floor as { x: number }).x).toBeGreaterThan(40);
        }

        // The gate always stands on the last floor slab.
        const gateOnFloor = grounds.some(
          (g) => room.gate.x >= g.x && room.gate.x + room.gate.w <= g.x + g.w
        );
        expect(gateOnFloor, `stage ${stage} ${seed}: gate is not on a floor`).toBe(true);
        expect(room.width).toBeGreaterThan(room.gate.x + room.gate.w);
      }
    }
  });

  it('introduces one mechanic at a time after a real first room', () => {
    const earliest: Record<string, number> = {
      doors: 99,
      ladders: 99,
      walls: 99,
      hazards: 99,
      snakes: 99,
      crates: 99,
    };
    for (let stage = 1; stage <= 12; stage += 1) {
      const room = generateRoom(stage, 'schedule');
      if (room.doors.length > 0) earliest.doors = Math.min(earliest.doors, stage);
      if (room.ladders.length > 0) earliest.ladders = Math.min(earliest.ladders, stage);
      if (room.walls.length > 0) earliest.walls = Math.min(earliest.walls, stage);
      if (room.hazards.length > 0) earliest.hazards = Math.min(earliest.hazards, stage);
      if (room.snakes.length > 0) earliest.snakes = Math.min(earliest.snakes, stage);
      if (room.crates.length > 0) earliest.crates = Math.min(earliest.crates, stage);

      expect(room.stage).toBe(stage);
    }
    // The first descent already has rope work, a wall and a pit; the lethal
    // and mechanical pieces join in the rooms after it.
    expect(earliest.ladders).toBe(1);
    expect(earliest.walls).toBe(1);
    // A crate only exists where a wall needs a step, so whether room one rolls
    // one depends on that wall's flavour; by room two it always can.
    expect(earliest.crates).toBeGreaterThanOrEqual(1);
    expect(earliest.crates).toBeLessThanOrEqual(2);
    expect(earliest.hazards).toBe(2);
    expect(earliest.doors).toBe(3);
    expect(earliest.snakes).toBe(5);
  });

  it('makes the first room a real room, not an empty corridor', () => {
    for (const seed of ['first', 'alpha', 'bravo']) {
      const room = generateRoom(1, seed);
      expect(room.doors).toHaveLength(0);
      expect(room.hazards).toHaveLength(0);
      expect(room.snakes).toHaveLength(0);
      // Room one is still the on-ramp, but it teaches by doing: a wall to get
      // over and a ledge to climb to.
      expect(room.walls.length).toBeGreaterThanOrEqual(1);
      expect(room.ladders.length).toBeGreaterThanOrEqual(1);
      expect(room.platforms.some((p) => p.kind === 'ledge')).toBe(true);
      // And every crate it starts with is there to solve that wall.
      for (const crate of room.crates) {
        const wall = room.walls.find((w) => crate.x < w.x && crate.x + crate.w > w.x - 240);
        expect(wall, `seed ${seed}: crate at ${crate.x} serves no wall`).toBeTruthy();
      }
    }
  });
});

describe('vault hazards and climbing', () => {
  function findRoom(stage: number, predicate: (room: Room) => boolean): Room {
    for (let i = 0; i < 80; i += 1) {
      const room = generateRoom(stage, `hazard-${i}`);
      if (predicate(room)) return room;
    }
    throw new Error(`no room at stage ${stage} matched`);
  }

  function climbRoom() {
    const room = findRoom(4, (r) => {
      const ledge = r.platforms.find((p) => p.kind === 'ledge');
      if (!ledge) return false;
      return r.ladders.some(
        (l) =>
          Math.abs(l.y - ledge.y) <= 1 &&
          l.x + l.w / 2 > ledge.x &&
          l.x + l.w / 2 < ledge.x + ledge.w
      );
    });
    const ledge = room.platforms.find((p) => p.kind === 'ledge')!;
    const ladder = room.ladders.find(
      (l) =>
        Math.abs(l.y - ledge.y) <= 1 &&
        l.x + l.w / 2 > ledge.x &&
        l.x + l.w / 2 < ledge.x + ledge.w
    )!;
    return { room, ledge, ladder };
  }

  it('climbs a rope all the way to the ledge above it and stands there', () => {
    const { room, ledge, ladder } = climbRoom();
    const state = settle(createVaultState(room), room);
    // Start at the far-left edge of the climb band: the worst case, and the one
    // that used to drop the player back to the door.
    state.player.x = ladder.x - PLAYER_W + 5;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;

    let climbed = 0;
    for (let i = 0; i < 300; i += 1) {
      const step = stepVault(state, room, { ...IDLE, jump: true }, DT);
      if (step.climbing) climbed += 1;
      if (state.player.y + PLAYER_H <= ladder.y) break;
    }
    expect(climbed).toBeGreaterThan(0);
    // The feet reach the ledge's own surface, not a point above it.
    expect(state.player.y + PLAYER_H).toBeLessThanOrEqual(ledge.y + 0.5);

    // Let go without touching the movement keys: the ledge is underneath, so
    // the player stands instead of hanging on the rope.
    settle(state, room, 20);
    expect(state.player.onGround).toBe(true);
    expect(state.player.y + PLAYER_H).toBeCloseTo(ledge.y, 0);

    run(state, room, { right: true }, 6);
    expect(state.player.onGround).toBe(true);
    expect(state.player.y + PLAYER_H).toBeCloseTo(ledge.y, 0);
  });

  it('climbs to the ledge with the held key auto-repeating', () => {
    const { room, ledge, ladder } = climbRoom();
    const state = settle(createVaultState(room), room);
    state.player.x = ladder.x - PLAYER_W + 5;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;

    const keys: VaultInput = { ...IDLE };
    applyVaultKey(keys, ' ', true, false);
    for (let i = 0; i < 300; i += 1) {
      // The OS repeats the held key roughly every 30ms; it must not cancel it.
      if (i % 2 === 0) applyVaultKey(keys, ' ', true, true);
      stepVault(state, room, keys, DT);
      if (state.player.y + PLAYER_H <= ladder.y) break;
    }
    settle(state, room, 20);
    expect(state.player.onGround).toBe(true);
    expect(state.player.y + PLAYER_H).toBeCloseTo(ledge.y, 0);
  });

  it('can climb onto every ledge in every generated room', () => {
    for (let stage = 1; stage <= 24; stage += 1) {
      for (const seed of ['alpha', 'bravo', 'charlie']) {
        const room = generateRoom(stage, seed);
        for (const ledge of room.platforms.filter((p) => p.kind === 'ledge')) {
          const ladder = room.ladders.find(
            (l) => Math.abs(l.y - ledge.y) <= 1 && l.x + l.w / 2 > ledge.x && l.x + l.w / 2 < ledge.x + ledge.w
          );
          expect(ladder, `stage ${stage} ${seed}: ledge with no rope`).toBeTruthy();
          const state = createVaultState(room);
          state.player.x = ladder!.x - PLAYER_W + 6;
          state.player.y = room.groundY - PLAYER_H;
          state.player.vy = 0;
          const keys: VaultInput = { ...IDLE };
          applyVaultKey(keys, ' ', true, false);
          for (let i = 0; i < 400; i += 1) {
            if (i % 2 === 0) applyVaultKey(keys, ' ', true, true);
            stepVault(state, room, keys, DT);
            if (state.player.y + PLAYER_H <= ladder!.y) break;
          }
          applyVaultKey(keys, ' ', false);
          settle(state, room, 24);
          expect(
            state.player.onGround,
            `stage ${stage} ${seed}: climb to ledge ${ledge.x} ends in the air`
          ).toBe(true);
          expect(state.player.y + PLAYER_H).toBeCloseTo(ledge.y, 0);
        }
      }
    }
  });

  it('climbs a wall rope above the cap and steps onto the wall top', () => {
    const room = findRoom(6, (r) => {
      const wall = r.walls[0];
      if (!wall) return false;
      return r.ladders.some((l) => l.x < wall.x && l.x > wall.x - 80 && l.y < wall.y - 20);
    });
    const wall = room.walls[0];
    const rope = room.ladders.find(
      (l) => l.x < wall.x && l.x > wall.x - 80 && l.y < wall.y - 20
    )!;
    const state = settle(createVaultState(room), room);
    state.player.x = rope.x - PLAYER_W + 8;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;

    for (let i = 0; i < 300; i += 1) {
      stepVault(state, room, { ...IDLE, jump: true }, DT);
      if (state.player.y + PLAYER_H <= rope.y + 0.5) break;
    }
    // Step right, over the cap, then stop: the wall top is a step, not a wide
    // platform, so walking on would take the player off the far side.
    run(state, room, { right: true }, 10);
    settle(state, room, 30);
    expect(state.player.x + PLAYER_W).toBeGreaterThan(wall.x + 2);
    expect(state.player.onGround).toBe(true);
    expect(state.player.y + PLAYER_H).toBeCloseTo(wall.y, 0);
  });

  it('keeps holding a climb when the keyboard repeats a held key', () => {
    const keys: VaultInput = { left: false, right: false, jump: false, down: false };
    applyVaultKey(keys, ' ', true, false);
    expect(keys.jump).toBe(true);
    // The OS repeats keydown while the key is held. That is not a release.
    applyVaultKey(keys, ' ', true, true);
    expect(keys.jump).toBe(true);
    applyVaultKey(keys, ' ', true, true);
    expect(keys.jump).toBe(true);
    applyVaultKey(keys, ' ', false);
    expect(keys.jump).toBe(false);
  });

  it('does not re-jump from an auto-repeat after a jump was consumed', () => {
    const keys: VaultInput = { left: false, right: false, jump: false, down: false };
    applyVaultKey(keys, 'ArrowUp', true, false);
    expect(keys.jump).toBe(true);
    keys.jump = false; // the jump was used
    applyVaultKey(keys, 'ArrowUp', true, true);
    expect(keys.jump).toBe(false);
    applyVaultKey(keys, 'ArrowUp', false);
    applyVaultKey(keys, 'ArrowUp', true, false);
    expect(keys.jump).toBe(true);
  });

  it('shoves a row of touching crates as one instead of jamming', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    state.crates = [
      { id: 'crate-a', x: 300, y: 360, w: 40, h: 40, vy: 0 },
      { id: 'crate-b', x: 340, y: 360, w: 40, h: 40, vy: 0 },
    ];
    state.player.x = 250;
    state.player.y = 356;
    state.player.vy = 0;
    const [first, second] = state.crates.map((crate) => crate.x);
    run(state, room, { right: true }, 60);
    expect(state.crates[0].x).toBeGreaterThan(first + 10);
    expect(state.crates[1].x).toBeGreaterThan(second + 10);
    // They stay touching: a row moves as a row.
    expect(state.crates[1].x - state.crates[0].x).toBeCloseTo(40, 1);
  });

  it('carries a crate stacked on top of the one being pushed', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    state.crates = [
      { id: 'crate-base', x: 300, y: 360, w: 40, h: 40, vy: 0 },
      { id: 'crate-top', x: 300, y: 320, w: 40, h: 40, vy: 0 },
    ];
    state.player.x = 250;
    state.player.y = 356;
    state.player.vy = 0;
    run(state, room, { right: true }, 60);
    expect(state.crates[0].x).toBeGreaterThan(310);
    expect(state.crates[1].x).toBeCloseTo(state.crates[0].x, 0);
    expect(state.crates[1].y + state.crates[1].h).toBeCloseTo(state.crates[0].y, 0);
  });

  it('will not let a wall be walked or jumped through', () => {
    const room = findRoom(5, (r) => r.walls.length > 0);
    const wall = room.walls[0];
    const state = settle(createVaultState(room), room);
    state.player.x = wall.x - PLAYER_W - 200;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;
    for (let i = 0; i < 240; i += 1) {
      stepVault(state, room, { ...IDLE, right: true, jump: i % 30 === 0 }, DT);
    }
    expect(state.player.x + PLAYER_W).toBeLessThanOrEqual(wall.x + 0.6);
  });

  it('sends the player back to the door on spikes, and the spikes stay put', () => {
    const room = findRoom(6, (r) => r.hazards.some((h) => h.kind === 'spikes'));
    const spikes = room.hazards.find((h) => h.kind === 'spikes')!;
    const state = settle(createVaultState(room), room);
    state.player.x = spikes.x - PLAYER_W - 8;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;

    let hurt: string | null = null;
    for (let i = 0; i < 120 && !hurt; i += 1) {
      hurt = stepVault(state, room, { ...IDLE, right: true }, DT).hurt;
    }
    expect(hurt).toBe('spikes');
    expect(state.player.x).toBe(room.spawn.x);
    expect(state.pulled.size).toBe(0);
  });

  it('snaps a bear trap but leaves the run intact', () => {
    const room = findRoom(7, (r) => r.hazards.some((h) => h.kind === 'trap'));
    const trap = room.hazards.find((h) => h.kind === 'trap')!;
    const state = settle(createVaultState(room), room);
    state.player.x = trap.x - PLAYER_W - 8;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;
    let hurt: string | null = null;
    for (let i = 0; i < 120 && !hurt; i += 1) {
      hurt = stepVault(state, room, { ...IDLE, right: true }, DT).hurt;
    }
    expect(hurt).toBe('trap');
    expect(state.player.x).toBe(room.spawn.x);
  });

  it('sends a snake after the player and bites on contact', () => {
    const room = findRoom(8, (r) => r.snakes.length > 0);
    const state = settle(createVaultState(room), room);
    const snake = state.snakes[0];
    state.player.x = snake.x + snake.w - 4;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;

    let hurt: string | null = null;
    for (let i = 0; i < 180 && !hurt; i += 1) {
      hurt = stepVault(state, room, { ...IDLE, right: true }, DT).hurt;
    }
    expect(hurt).toBe('snake');
    expect(state.player.x).toBe(room.spawn.x);
  });

  it('chases a player who stands still across the floor', () => {
    const room = findRoom(8, (r) => r.snakes.length > 0 && r.snakes[0].to - r.snakes[0].from > 150);
    const state = settle(createVaultState(room), room);
    const snake = state.snakes[0];
    // Stand still, well along the snake's own stretch of floor but out of its
    // reach for the next half second (so it closes the gap without biting).
    state.player.x = Math.min(snake.to - PLAYER_W - 2, state.snakes[0].x + 150);
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;
    const gap = () => Math.abs(state.snakes[0].x + state.snakes[0].w / 2 - (state.player.x + PLAYER_W / 2));
    const before = gap();
    settle(state, room, 30);
    expect(state.player.x).not.toBe(room.spawn.x);
    expect(gap()).toBeLessThan(before - 20);
  });

  it('sends every snake back to its starting point after a bite', () => {
    const room = findRoom(8, (r) => r.snakes.length > 0);
    const state = settle(createVaultState(room), room);
    const snake = state.snakes[0];
    state.player.x = snake.x + snake.w - 4;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;
    let hurt: string | null = null;
    for (let i = 0; i < 180 && !hurt; i += 1) {
      hurt = stepVault(state, room, { ...IDLE, right: true }, DT).hurt;
    }
    expect(hurt).toBe('snake');
    expect(state.snakes.map((s) => s.x)).toEqual(room.snakes.map((s) => s.x));
    expect(state.snakes.map((s) => s.dir)).toEqual(room.snakes.map((s) => s.dir));
  });

  /**
   * A room whose only crossing is the high ledge: a spike bed far wider than a
   * jump, a shelf above it, and a climb from the floor to that shelf.
   */
  function highRouteRoom() {
    return findRoom(4, (r) => {
      const spikes = r.hazards.find((h) => h.kind === 'spikes' && h.w > 240);
      if (!spikes) return false;
      const shelf = r.platforms.find(
        (p) => p.kind === 'step' && Math.abs(p.y - (r.groundY - 214)) <= 1 && p.x < spikes.x
      );
      if (!shelf) return false;
      return r.ladders.some((l) => l.y <= shelf.y + 1 && l.x + l.w > shelf.x);
    });
  }

  it('makes the high route a climb, not decoration: the spikes cannot be jumped', () => {
    const room = highRouteRoom();
    const spikes = room.hazards.find((h) => h.kind === 'spikes' && h.w > 240)!;
    const shelf = room.platforms.find(
      (p) => p.kind === 'step' && Math.abs(p.y - (room.groundY - 214)) <= 1 && p.x < spikes.x
    )!;
    const climb = room.ladders.find((l) => l.y <= shelf.y + 1 && l.x + l.w > shelf.x)!;
    // A running jump carries about 175px: this bed is well past that, so the
    // rope is the only way across and the shelf is the only road.
    expect(spikes.w).toBeGreaterThan(230);
    expect(climb.y).toBe(shelf.y);
    expect(climb.x).toBeGreaterThan(spikes.x - 260);
  });

  it('crosses the high route: climb, hop the broken ledge, land past the spikes', () => {
    const room = highRouteRoom();
    const spikes = room.hazards.find((h) => h.kind === 'spikes' && h.w > 240)!;
    const shelf = room.platforms.find(
      (p) => p.kind === 'step' && Math.abs(p.y - (room.groundY - 214)) <= 1 && p.x < spikes.x
    )!;
    const climb = room.ladders.find((l) => l.y <= shelf.y + 1 && l.x + l.w > shelf.x)!;

    const state = createVaultState(room);
    state.player.x = climb.x - PLAYER_W + 6;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;

    // Up the rope, with the held key auto-repeating like a real keyboard.
    const keys: VaultInput = { ...IDLE };
    applyVaultKey(keys, ' ', true, false);
    for (let i = 0; i < 400; i += 1) {
      if (i % 2 === 0) applyVaultKey(keys, ' ', true, true);
      stepVault(state, room, keys, DT);
      if (state.player.y + PLAYER_H <= climb.y) break;
    }
    applyVaultKey(keys, ' ', false);
    settle(state, room, 24);
    expect(state.player.onGround).toBe(true);
    expect(state.player.y + PLAYER_H).toBeCloseTo(shelf.y, 0);

    // Hop along the shelf, over the gap, and off the far end onto the floor.
    let hurt: string | null = null;
    let crossed = false;
    for (let i = 0; i < 900 && !hurt; i += 1) {
      hurt = stepVault(
        state,
        room,
        { ...IDLE, right: true, jump: state.player.onGround },
        DT
      ).hurt;
      if (
        state.player.x > spikes.x + spikes.w + 40 &&
        state.player.onGround &&
        state.player.y + PLAYER_H > room.groundY - 1
      ) {
        crossed = true;
        break;
      }
    }
    expect(hurt).toBeNull();
    expect(crossed).toBe(true);
  });

  it('never lets a crate be pushed through a wall', () => {
    const room = flatRoom();
    room.walls = [{ id: 'wall', x: 520, y: 288, w: 16, h: 112 }];
    const state = settle(createVaultState(room), room);
    const crate = state.crates[0];
    state.player.x = crate.x - PLAYER_W - 2;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;
    run(state, room, { right: true }, 320);
    expect(crate.x + crate.w).toBeLessThanOrEqual(520.5);
  });
});
