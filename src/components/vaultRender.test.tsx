// @vitest-environment jsdom
/**
 * A drawing frame that throws is invisible in a unit test unless something
 * calls it: the render loop simply stops. This walks every new visual path —
 * ground, ledges, a raised and a lowered drawbridge, a closed and an open
 * portcullis, crates, levers, torches, the gate and the player — against a
 * recording 2D context, so a typo in one of them fails the suite.
 */
import { describe, expect, it } from 'vitest';
import { generateRoom } from '../lib/arcadeGames';
import { createVaultState } from '../lib/vaultPhysics';
import { drawScene } from './RuneVault';

interface Recorded {
  calls: string[];
}

function stubContext(recorded: Recorded): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => gradient;
      }
      if (prop === 'measureText') return () => ({ width: 12 });
      if (prop === 'canvas') return { width: 900, height: 460 };
      return (...args: unknown[]) => {
        recorded.calls.push(`${prop}(${args.length})`);
        return undefined;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const KEYS = { left: false, right: false, jump: false, down: false };

describe('vault scene rendering', () => {
  it('draws every room shape and both door states without throwing', () => {
    for (let stage = 1; stage <= 12; stage += 1) {
      const room = generateRoom(stage, 'render-test');
      const state = createVaultState(room);
      for (const pulled of [new Set<string>(), new Set(room.levers.map((l) => l.id))]) {
        for (const gateOpen of [false, true]) {
          const recorded: Recorded = { calls: [] };
          const ctx = stubContext(recorded);
          expect(() =>
            drawScene(
              ctx,
              room,
              state.player,
              0,
              1.25,
              gateOpen,
              KEYS,
              [{ x: 120, y: 200, vx: 0, vy: 0, life: 0.5, max: 1 }],
              state.crates,
              pulled,
              state.snakes
            )
          ).not.toThrow();
          expect(recorded.calls.length).toBeGreaterThan(40);
        }
      }
    }
  });

  it('draws ropes, walls, spikes, traps and snakes through their own paths', () => {
    let room = generateRoom(9, 'render-hazards');
    for (let i = 0; i < 40 && room.snakes.length === 0; i += 1) {
      room = generateRoom(9, `render-hazards-${i}`);
    }
    const state = createVaultState(room);
    const recorded: Recorded = { calls: [] };
    expect(room.walls.length + room.hazards.length + room.snakes.length).toBeGreaterThan(0);
    expect(room.snakes.length).toBeGreaterThan(0);
    // The snake is somewhere down the room, so the camera has to be on it for
    // its coils to be drawn at all.
    const cam = Math.max(0, state.snakes[0].x - 260);
    expect(() =>
      drawScene(
        stubContext(recorded),
        room,
        state.player,
        cam,
        3.5,
        false,
        KEYS,
        [],
        state.crates,
        state.pulled,
        state.snakes
      )
    ).not.toThrow();
    // The snake is drawn as a chain of coils, and the spikes as filled teeth.
    expect(recorded.calls.filter((call) => call.startsWith('ellipse(')).length).toBeGreaterThan(3);
    expect(recorded.calls.filter((call) => call.startsWith('fill(')).length).toBeGreaterThan(10);
  });

  it('follows the camera when the player walks to the far end', () => {
    const room = generateRoom(5, 'render-camera');
    const state = createVaultState(room);
    state.player.x = room.width - 200;
    const recorded: Recorded = { calls: [] };
    expect(() =>
      drawScene(
        stubContext(recorded),
        room,
        state.player,
        Math.max(0, room.width - 900),
        2,
        true,
        KEYS,
        [],
        state.crates,
        state.pulled,
        state.snakes
      )
    ).not.toThrow();
    expect(recorded.calls.some((call) => call.startsWith('arc('))).toBe(true);
    expect(recorded.calls.some((call) => call.startsWith('ellipse('))).toBe(true);
    expect(recorded.calls.length).toBeGreaterThan(60);
  });
});
