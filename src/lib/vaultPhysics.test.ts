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
  resetVaultCrates,
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

  it('jumps again while jump stays held, and stops when it is released', () => {
    const room = flatRoom();
    const state = settle(createVaultState(room), room);
    let jumps = 0;
    let landed = false;
    for (let i = 0; i < 240; i += 1) {
      const step = stepVault(state, room, { ...IDLE, jump: true }, DT);
      if (step.jumped) jumps += 1;
      if (i > 10 && state.player.onGround) landed = true;
    }
    // A held jump is a request to keep hopping; 240 frames is long enough for
    // at least two complete jumps on this room.
    expect(landed).toBe(true);
    expect(jumps).toBeGreaterThanOrEqual(2);
    state.player.vy = 0;
    state.player.y = room.groundY - PLAYER_H;
    state.player.onGround = true;
    let afterRelease = 0;
    for (let i = 0; i < 30; i += 1) {
      if (stepVault(state, room, IDLE, DT).jumped) afterRelease += 1;
    }
    expect(afterRelease).toBe(0);
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
    // Machinery is a dice roll now, so find a real room that rolled one rather
    // than assuming room four always has a lever.
    let room = generateRoom(4, 'lever-test');
    for (let index = 0; index < 80 && room.levers.length === 0; index += 1) {
      room = generateRoom(4, `lever-test-${index}`);
    }
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
    // A wave's kind is rolled from the run seed; find a seed that rolls the
    // quadratic mode rather than relying on a fixed odd-wave rule.
    let wave = buildInterceptWave(5, 'lock-check');
    for (const seed of ['lock-a', 'lock-b', 'lock-c', 'lock-d', 'lock-e', 'lock-f']) {
      const candidate = buildInterceptWave(5, seed);
      if (candidate.kind === 'parabola') {
        wave = candidate;
        break;
      }
    }
    expect(wave.kind).toBe('parabola');
    expect(locksEnabled(5, wave.kind)).toBe(true);
    const aim = { mode: 'quadratic' as const, a: wave.a, h: wave.h, k: wave.k };
    const staticTargets = wave.targets.filter((target) => target.kind !== 'ship');
    const locked = targetsOnAim(staticTargets, aim, toleranceFor(5), 0);
    // A silver ship drifts around its anchor by design, so it is judged where it
    // is drawn; the asteroids on the curve must all lock.
    expect(locked.length).toBe(staticTargets.length);
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

  it('draws every mechanic at any depth instead of unlocking them on a script', () => {
    const seen = new Set<string>();
    for (let stage = 1; stage <= 8; stage += 1) {
      for (let index = 0; index < 14; index += 1) {
        const room = generateRoom(stage, `mix-${stage}-${index}`);
        expect(room.stage).toBe(stage);
        if (room.doors.length > 0) seen.add('doors');
        if (room.ladders.length > 0) seen.add('ladders');
        if (room.walls.length > 0) seen.add('walls');
        if (room.hazards.length > 0) seen.add('hazards');
        if (room.snakes.length > 0) seen.add('snakes');
        if (room.crates.length > 0) seen.add('crates');
        // The safety invariants hold regardless of the draw.
        for (const hazard of room.hazards) {
          expect(hazard.x, `stage ${stage}: hazard on the doorstep`).toBeGreaterThan(
            room.spawn.x + 120
          );
        }
      }
    }
    // Nothing is held back to a later room, so a short run can already have
    // met ropes, walls, hazards, snakes and machinery.
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('makes the first room a real room with a safe doorstep', () => {
    for (const seed of ['first', 'alpha', 'bravo', 'charlie', 'delta']) {
      const room = generateRoom(1, seed);
      expect(room.platforms.length).toBeGreaterThan(1);
      expect(room.width).toBeGreaterThan(1000);
      expect(room.gate.x).toBeGreaterThan(room.spawn.x + 300);
      for (const hazard of room.hazards) {
        expect(hazard.x, `seed ${seed}: hazard on the doorstep`).toBeGreaterThan(
          room.spawn.x + 120
        );
      }
      // Every crate that was rolled is there to solve a wall.
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

  it('keeps hopping while jump is held, without a new key press', () => {
    const room = generateRoom(1, 'hold-jump');
    const state = settle(createVaultState(room), room);
    let jumps = 0;
    for (let i = 0; i < 240; i += 1) {
      const step = stepVault(state, room, { ...IDLE, jump: true }, DT);
      if (step.jumped) jumps += 1;
    }
    // A held jump is a request to keep jumping: the player hops again the
    // moment they land, which is what a phone thumb on the Jump key expects.
    expect(jumps).toBeGreaterThan(2);
    expect(state.player.onGround || state.player.vy !== 0).toBe(true);
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

  it('keeps a held jump through auto-repeat and clears only on release', () => {
    const keys: VaultInput = { left: false, right: false, jump: false, down: false };
    applyVaultKey(keys, 'ArrowUp', true, false);
    expect(keys.jump).toBe(true);
    applyVaultKey(keys, 'ArrowUp', true, true);
    expect(keys.jump).toBe(true);
    applyVaultKey(keys, 'ArrowUp', false);
    expect(keys.jump).toBe(false);
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

  it('holds its snakes until the player first moves, then chases at one steady speed', () => {
    const room = flatRoom();
    room.crates = [];
    room.snakes = [
      {
        id: 'snake-test',
        x: 700,
        y: room.groundY - 18,
        w: 46,
        h: 16,
        dir: 1,
        speed: 72,
      },
    ];
    const state = settle(createVaultState(room), room);
    const snake = state.snakes[0];
    const start = snake.x;

    // A quiet room stays quiet: standing still never pulls a snake off its coil.
    settle(state, room, 30);
    expect(state.snakesAwake).toBe(false);
    expect(snake.x).toBe(start);

    // One deliberate step wakes the room. The player is to the right and the
    // floor is clear, so the snake follows at exactly its own speed — not the
    // old half-speed "waiting" crawl.
    state.player.x = 1000;
    run(state, room, { right: true }, 1);
    expect(state.snakesAwake).toBe(true);
    const afterWake = snake.x;
    run(state, room, IDLE, 30);
    expect(snake.x).toBeCloseTo(afterWake + snake.speed * 30 * DT, 3);
  });

  it('will not let a snake cross a spike bed', () => {
    const room = flatRoom();
    room.crates = [];
    room.hazards = [
      { id: 'spikes-test', kind: 'spikes', x: 600, y: room.groundY - 14, w: 80, h: 14 },
    ];
    room.snakes = [
      {
        id: 'snake-test',
        x: 700,
        y: room.groundY - 18,
        w: 46,
        h: 16,
        dir: -1,
        speed: 90,
      },
    ];
    const state = settle(createVaultState(room), room);
    state.player.x = 500;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;
    state.snakesAwake = true;
    run(state, room, IDLE, 180);
    const snake = state.snakes[0];
    expect(snake.x).toBeGreaterThanOrEqual(680);
    expect(snake.x + snake.w).toBeGreaterThan(680);
  });

  it('crosses an open drawbridge and turns back at the same gap when it is raised', () => {
    const room = flatRoom();
    room.platforms = [
      { id: 'ground-a', kind: 'ground', x: 0, y: 400, w: 500, h: 60 },
      { id: 'ground-b', kind: 'ground', x: 620, y: 400, w: 580, h: 60 },
    ];
    room.crates = [];
    room.doors = [
      {
        id: 'bridge-test',
        kind: 'bridge',
        x: 500,
        y: 400,
        w: 120,
        h: 12,
        leverId: 'lever-test',
        solidWhenPulled: true,
      },
    ];
    room.snakes = [
      {
        id: 'snake-test',
        x: 300,
        y: 382,
        w: 46,
        h: 16,
        dir: 1,
        speed: 100,
      },
    ];
    const state = settle(createVaultState(room), room);
    state.player.x = 1000;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;
    state.snakesAwake = true;

    // Raised bridge: the floor ends at 500, so the snake turns before it.
    run(state, room, IDLE, 120);
    expect(state.snakes[0].x + state.snakes[0].w).toBeLessThan(540);

    // Lowered bridge: the same floor is connected, and the snake crosses it.
    state.pulled.add('lever-test');
    run(state, room, IDLE, 240);
    expect(state.snakes[0].x).toBeGreaterThan(620);
    expect(state.snakes[0].y).toBe(382);
  });

  it('stops a two-crate row before a spike without trapping the player, and reset restores it', () => {
    const room = flatRoom();
    room.platforms = [
      { id: 'ground-0', kind: 'ground', x: 0, y: 400, w: 1200, h: 60 },
    ];
    room.crates = [
      { id: 'crate-a', x: 300, y: 360, w: 40, h: 40, vy: 0 },
      { id: 'crate-b', x: 340, y: 360, w: 40, h: 40, vy: 0 },
    ];
    room.hazards = [
      { id: 'spikes-test', kind: 'spikes', x: 400, y: 386, w: 60, h: 14 },
    ];
    const state = settle(createVaultState(room), room);
    state.player.x = 250;
    state.player.y = 356;
    state.player.vy = 0;
    run(state, room, { right: true }, 120);

    // Solid spike: the lead crate stops at its lip, and nothing shares a tile
    // with the hazard. The player is still behind the crates, not inside them.
    for (const crate of state.crates) {
      expect(crate.x + crate.w).toBeLessThanOrEqual(400.5);
      expect(crate.x + crate.w <= 400 || crate.y + crate.h <= 386).toBe(true);
    }
    expect(state.player.x + PLAYER_W).toBeLessThanOrEqual(state.crates[0].x + 0.5);
    expect(state.player.x).toBeGreaterThan(250);

    // Backing away is always possible, so a blocked shove is not a physical
    // trap. The HUD reset then restores the original puzzle.
    run(state, room, { left: true }, 30);
    expect(state.player.x).toBeLessThan(250);
    resetVaultCrates(state, room);
    expect(state.crates.map((crate) => crate.x)).toEqual(
      room.crates.map((crate) => crate.x)
    );
  });

  it('starts a two-crate row moving on the first continuous shove', () => {
    const room = flatRoom();
    room.platforms = [{ id: 'ground-0', kind: 'ground', x: 0, y: 400, w: 1200, h: 60 }];
    room.crates = [
      { id: 'crate-a', x: 300, y: 360, w: 40, h: 40, vy: 0 },
      { id: 'crate-b', x: 340, y: 360, w: 40, h: 40, vy: 0 },
    ];
    const state = settle(createVaultState(room), room);
    state.player.x = 250;
    state.player.y = 356;
    state.player.vy = 0;

    const rowX: number[] = [];
    for (let i = 0; i < 90; i += 1) {
      stepVault(state, room, { ...IDLE, right: true }, DT);
      rowX.push(state.crates[0].x);
    }
    // The row must not wait for a backing-off run-up. It starts moving while
    // the key is still held and never moves backwards during the shove.
    expect(rowX[29]).toBeGreaterThan(300);
    for (let i = 1; i < rowX.length; i += 1) {
      expect(rowX[i]).toBeGreaterThanOrEqual(rowX[i - 1] - 0.001);
    }
    expect(state.crates[1].x - state.crates[0].x).toBeCloseTo(40, 1);
  });

  it('leaves a snake still when it is pinned from both sides', () => {
    const room = flatRoom();
    room.crates = [
      { id: 'crate-pin', x: 590, y: 350, w: 70, h: 50, vy: 0 },
    ];
    room.snakes = [
      {
        id: 'snake-pinned',
        x: 600,
        y: room.groundY - 18,
        w: 46,
        h: 16,
        dir: 1,
        speed: 90,
      },
    ];
    const state = settle(createVaultState(room), room);
    const snake = state.snakes[0];
    const start = snake.x;
    state.player.x = 100;
    state.player.y = room.groundY - PLAYER_H;
    state.player.vy = 0;
    state.snakesAwake = true;

    const dirs = new Set<number>();
    for (let i = 0; i < 90; i += 1) {
      stepVault(state, room, IDLE, DT);
      dirs.add(snake.dir);
    }
    // No left-right vibration: the snake has nowhere legal to go, so it waits.
    expect(dirs.size).toBe(1);
    expect(snake.x).toBeCloseTo(start, 1);
  });

  it('collects a floating coin once and removes it from the room state', () => {
    const room = flatRoom();
    room.crates = [];
    const state = settle(createVaultState(room), room);
    state.coins = [{ id: 'coin-test', x: 70, y: 366, w: 18, h: 18 }];
    state.player.x = 60;
    state.player.y = 356;
    state.player.vy = 0;

    const step = stepVault(state, room, IDLE, DT);
    expect(step.coins).toEqual(['coin-test']);
    expect(state.coins).toHaveLength(0);
    const again = stepVault(state, room, IDLE, DT);
    expect(again.coins).toHaveLength(0);
  });

  it('puts every crate back at its generated position on demand', () => {
    const room = flatRoom();
    const state = createVaultState(room);
    state.crates[0].x = 900;
    resetVaultCrates(state, room);
    expect(state.crates[0].x).toBe(room.crates[0].x);
    expect(state.crates[0].y).toBe(room.crates[0].y);
  });

  it('keeps every crate where it was after a trap sends the player back', () => {
    const room = flatRoom();
    room.hazards = [{ id: 'trap-test', kind: 'trap', x: 90, y: 386, w: 60, h: 14 }];
    const state = settle(createVaultState(room), room);
    state.crates[0].x = 700;
    state.crates[0].y = 360;
    state.crates[0].vy = 0;
    state.player.x = 100;
    state.player.y = 356;
    state.player.vy = 0;

    const step = stepVault(state, room, IDLE, DT);
    expect(step.hurt).toBe('trap');
    expect(state.player.x).toBe(room.spawn.x);
    expect(state.crates[0].x).toBe(700);
  });

  it('only moves a crate that blocks the respawn point, leaving the rest saved', () => {
    const room = flatRoom();
    room.crates = [
      { id: 'crate-door', x: room.spawn.x, y: 360, w: 40, h: 40, vy: 0 },
      { id: 'crate-away', x: 700, y: 360, w: 40, h: 40, vy: 0 },
    ];
    room.hazards = [{ id: 'trap-test', kind: 'trap', x: 90, y: 386, w: 60, h: 14 }];
    const state = settle(createVaultState(room), room);
    state.player.x = 100;
    state.player.y = 356;
    state.player.vy = 0;

    const step = stepVault(state, room, IDLE, DT);
    expect(step.hurt).toBe('trap');
    expect(state.crates[1].x).toBe(700);
    // The door crate is opened clear of the player, not reset across the room.
    expect(Math.abs(state.crates[0].x - room.spawn.x)).toBeGreaterThan(PLAYER_W);
    expect(
      state.crates[0].x + state.crates[0].w <= room.spawn.x ||
        state.crates[0].x >= room.spawn.x + PLAYER_W
    ).toBe(true);
  });

  it('reports a blocked shove as pinned so the HUD can offer the reset', () => {
    const room = flatRoom();
    room.walls = [{ id: 'wall-test', x: 400, y: 288, w: 16, h: 112 }];
    const state = settle(createVaultState(room), room);
    state.crates[0].x = 360;
    state.crates[0].y = 360;
    state.crates[0].vy = 0;
    state.player.x = 330;
    state.player.y = 356;
    state.player.vy = 0;

    let pinned = false;
    for (let i = 0; i < 60; i += 1) {
      pinned = stepVault(state, room, { ...IDLE, right: true }, DT).pinned || pinned;
    }
    expect(pinned).toBe(true);
    expect(state.crates[0].x + state.crates[0].w).toBeLessThanOrEqual(400.5);
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
