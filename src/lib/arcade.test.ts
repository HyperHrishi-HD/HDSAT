// @vitest-environment jsdom
/**
 * The Arcade pays HDCoins, so its rules deserve the same coverage as practice.
 * These tests pin the deterministic daily content, the 30-question quest
 * allowance, and the per-category reward caps that mirror the database.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import {
  DAILY_QUESTS,
  DAILY_QUEST_QUESTION_CAP,
  QUEST_MATH_COUNT,
  QUEST_RW_COUNT,
  dailyHardQuestion,
  dismissQuestionOfTheDay,
  isQuestionOfTheDayDismissed,
  isQuestionOfTheDaySolved,
  loadQuestState,
  markQuestionOfTheDaySolved,
  questQuestionIds,
  saveQuestProgress,
} from './daily';
import {
  ARCADE_EVENT_LEDGER_KEY,
  SESSION_LEDGER_KEY,
  awardArcadeEventCoins,
  awardSessionCoins,
  emptyProfile,
  sessionCoinReward,
} from './storage';
import {
  ARCADE_COIN_MAX_EVENT,
  ARCADE_DAILY_COIN_CAP,
  clampArcadeCoins,
} from './arcadeCoins';
import {
  buildInterceptWave,
  describeRoom,
  firstShipWave,
  generateRoom,
  targetPosition,
  targetsOnAim,
  targetsOnLine,
} from './arcadeGames';
import type { Question } from './types';

const questions = (bankJson as unknown as { questions: Question[] }).questions;
const byId = new Map(questions.map((q) => [q.id, q]));

beforeEach(() => {
  localStorage.clear();
});

describe('daily quests', () => {
  it('builds three quests of five Reading & Writing plus five Math items', () => {
    expect(DAILY_QUESTS).toHaveLength(3);
    expect(DAILY_QUEST_QUESTION_CAP).toBe(30);
    for (const quest of DAILY_QUESTS) {
      const ids = questQuestionIds(questions, quest.id, 'SAT', '2026-10-22');
      const resolved = ids.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q));
      expect(resolved).toHaveLength(QUEST_RW_COUNT + QUEST_MATH_COUNT);
      expect(resolved.filter((q) => q.section === 'Reading and Writing')).toHaveLength(
        QUEST_RW_COUNT
      );
      expect(resolved.filter((q) => q.section === 'Math')).toHaveLength(QUEST_MATH_COUNT);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps a quest stable all day and changes it the next day', () => {
    const today = questQuestionIds(questions, 'warmup', 'SAT', '2026-10-22');
    expect(questQuestionIds(questions, 'warmup', 'SAT', '2026-10-22')).toEqual(today);
    const tomorrow = questQuestionIds(questions, 'warmup', 'SAT', '2026-10-23');
    expect(tomorrow).not.toEqual(today);
  });

  it('gives the three quests different sets so a day is not three copies of one drill', () => {
    const warmup = questQuestionIds(questions, 'warmup', 'SAT', '2026-10-22');
    const gauntlet = questQuestionIds(questions, 'gauntlet', 'SAT', '2026-10-22');
    expect(warmup).not.toEqual(gauntlet);
    const overlap = warmup.filter((id) => gauntlet.includes(id)).length;
    expect(overlap).toBeLessThan(warmup.length);
  });

  it('persists per-quest progress for one date only', () => {
    saveQuestProgress('warmup', (current) => ({
      ...current,
      answered: ['q-1'],
      correct: 1,
    }), '2026-10-22');
    expect(loadQuestState('2026-10-22').warmup.answered).toEqual(['q-1']);
    expect(loadQuestState('2026-10-23').warmup).toBeUndefined();
  });
});

describe('question of the day', () => {
  it('picks one Hard item and keeps it for the whole date', () => {
    const first = dailyHardQuestion(questions, 'SAT', '2026-10-22');
    expect(first).not.toBeNull();
    expect(first?.difficulty).toBe('Hard');
    expect(dailyHardQuestion(questions, 'SAT', '2026-10-22')?.id).toBe(first?.id);
  });

  it('serves a genuinely Hard item on Friday 2026-11-13', () => {
    // The old pick was RW-M15-WB-D130-SP2006, a one-step graph read that had
    // been labelled Hard. Difficulty is now corrected at the source and the
    // QOTD must not fall back to an easier cached item.
    const friday = dailyHardQuestion(questions, 'SAT', '2026-11-13');
    expect(friday).not.toBeNull();
    expect(friday?.difficulty).toBe('Hard');
    expect(friday?.id).not.toBe('RW-M15-WB-D130-SP2006');
  });

  it('tracks dismissal and solving per date', () => {
    expect(isQuestionOfTheDayDismissed('2026-10-22')).toBe(false);
    dismissQuestionOfTheDay('2026-10-22');
    expect(isQuestionOfTheDayDismissed('2026-10-22')).toBe(true);
    expect(isQuestionOfTheDayDismissed('2026-10-23')).toBe(false);

    markQuestionOfTheDaySolved('2026-10-22');
    expect(isQuestionOfTheDaySolved('2026-10-22')).toBe(true);
    expect(isQuestionOfTheDaySolved('2026-10-23')).toBe(false);
  });
});

describe('arcade session rewards mirror the cloud caps', () => {
  it('pays a Practice Rush for at most four runs a day', () => {
    let profile = emptyProfile();
    let paid = 0;
    for (let run = 0; run < 6; run += 1) {
      const outcome = awardSessionCoins(
        profile,
        {
          activityType: 'practice_rush',
          questions: 10,
          correct: 6,
          sessionId: `r-${run}`,
          random: () => 0,
        },
        new Date('2026-10-22T12:00:00')
      );
      profile = outcome.profile;
      paid += outcome.coinsAwarded;
    }
    // Four rewarded runs at the 5-coin floor, then the cap stops paying.
    expect(paid).toBe(20);
    expect(profile.hdCoins).toBe(20);
  });

  it('pays Practice Rush a flat five, matching the cloud exactly', () => {
    expect(
      sessionCoinReward({ activityType: 'practice_rush', questions: 3, correct: 1 })
    ).toBe(5);
    expect(
      sessionCoinReward({ activityType: 'practice_rush', questions: 30, correct: 30 })
    ).toBe(5);
    // Two answers are not a run, and neither is a run with no correct answer.
    expect(
      sessionCoinReward({ activityType: 'practice_rush', questions: 2, correct: 2 })
    ).toBe(0);
    expect(
      sessionCoinReward({ activityType: 'practice_rush', questions: 10, correct: 0 })
    ).toBe(0);
  });

  it('caps one arcade event at the largest legitimate payout', () => {
    expect(ARCADE_COIN_MAX_EVENT).toBe(10);
    expect(clampArcadeCoins(-5)).toBe(0);
    expect(clampArcadeCoins(6.9)).toBe(6);
    expect(clampArcadeCoins(1000)).toBe(10);
    expect(clampArcadeCoins(Number.NaN)).toBe(0);
  });

  it('refuses to pay a run that is not a run', () => {
    expect(sessionCoinReward({ activityType: 'mini_game', questions: 2, correct: 2 })).toBe(0);
    expect(sessionCoinReward({ activityType: 'mini_game', questions: 20, correct: 0 })).toBe(0);
    expect(sessionCoinReward({ activityType: 'practice_rush', questions: 1, correct: 1 })).toBe(0);
    expect(sessionCoinReward({ activityType: 'full_simulation', questions: 2, correct: 2 })).toBe(0);
  });

  it('does not pay or count the same completed session twice', () => {
    const args = {
      activityType: 'practice_rush' as const,
      questions: 10,
      correct: 6,
      sessionId: 'same-run',
      random: () => 0,
    };
    const first = awardSessionCoins(emptyProfile(), args, new Date('2026-10-22T12:00:00'));
    const replay = awardSessionCoins(first.profile, args, new Date('2026-10-22T12:01:00'));
    expect(first.coinsAwarded).toBe(5);
    expect(replay.coinsAwarded).toBe(0);
    expect(replay.profile.dailyActivity['2026-10-22'].sessionsCompleted).toBe(1);
    expect(replay.profile.hdCoins).toBe(5);
  });

  it('credits exact arcade events once and respects the daily arcade ceiling', () => {
    let profile = emptyProfile();
    const same = awardArcadeEventCoins(profile, 3, 'event-1', new Date('2026-10-22T12:00:00'));
    profile = same.profile;
    const replay = awardArcadeEventCoins(profile, 3, 'event-1', new Date('2026-10-22T12:01:00'));
    expect(same.coinsAwarded).toBe(3);
    expect(replay.coinsAwarded).toBe(0);
    expect(replay.profile.hdCoins).toBe(3);

    // The ledger stops at the cap even when every event has a fresh id.
    for (let i = 0; i < 20; i += 1) {
      profile = awardArcadeEventCoins(
        profile,
        10,
        `event-${i + 2}`,
        new Date('2026-10-22T12:00:00')
      ).profile;
    }
    expect(profile.dailyActivity['2026-10-22'].coinsEarned).toBe(ARCADE_DAILY_COIN_CAP);
    expect(localStorage.getItem(ARCADE_EVENT_LEDGER_KEY)).toContain('2026-10-22');
  });

  it('records a completed mini-game session for the streak even though exact event coins are zero', () => {
    const outcome = awardSessionCoins(
      emptyProfile(),
      {
        activityType: 'mini_game',
        questions: 1,
        correct: 1,
        sessionId: 'game-streak-1',
        random: () => 0,
      },
      new Date('2026-11-07T12:00:00')
    );
    expect(outcome.coinsAwarded).toBe(0);
    expect(outcome.profile.dailyActivity['2026-11-07'].sessionsCompleted).toBe(1);
    expect(outcome.profile.currentStreak).toBe(1);
    expect(outcome.profile.lastActiveDate).toBe('2026-11-07');
  });

  it('pays a full test up to 25, scaled by coverage and accuracy', () => {
    expect(sessionCoinReward({ activityType: 'full_simulation', questions: 98, correct: 98 })).toBe(25);
    expect(sessionCoinReward({ activityType: 'full_simulation', questions: 90, correct: 45 })).toBe(13);
    // Answering three items and stopping is worth pennies, not the full 25.
    expect(
      sessionCoinReward({ activityType: 'full_simulation', questions: 3, correct: 3 })
    ).toBeLessThanOrEqual(1);
  });

  it('resets the allowance on the next calendar day', () => {
    let profile = emptyProfile();
    for (let run = 0; run < 4; run += 1) {
      profile = awardSessionCoins(
        profile,
        {
          activityType: 'practice_rush',
          questions: 10,
          correct: 6,
          sessionId: `a-${run}`,
          random: () => 0,
        },
        new Date('2026-10-22T12:00:00')
      ).profile;
    }
    const nextDay = awardSessionCoins(
      profile,
      {
        activityType: 'practice_rush',
        questions: 10,
        correct: 6,
        sessionId: 'b-0',
        random: () => 0,
      },
      new Date('2026-10-23T09:00:00')
    );
    expect(nextDay.coinsAwarded).toBe(5);
    expect(localStorage.getItem(SESSION_LEDGER_KEY)).toContain('2026-10-23');
  });
});

describe('coordinate interceptor waves', () => {
  it('puts every target on the wave curve so a wave can always be cleared', () => {
    for (let wave = 1; wave <= 12; wave += 1) {
      const design = buildInterceptWave(wave, 'test-seed');
      expect(design.stage).toBe(wave);
      expect(design.targets.length).toBeGreaterThanOrEqual(2);
      expect(design.targets.length).toBeLessThanOrEqual(5);
      // Ship targets are offset around their anchor by design; only asteroids
      // and the anchor points have to sit exactly on the curve.
      const staticTargets = design.targets.filter((t) => t.kind !== 'ship');
      if (design.kind === 'line') {
        expect(targetsOnLine(staticTargets, design.m, design.b, 0.001)).toHaveLength(
          staticTargets.length
        );
      } else {
        for (const target of staticTargets) {
          expect(
            Math.abs(design.a * (target.x - design.h) ** 2 + design.k - target.y)
          ).toBeLessThan(1e-9);
        }
      }
      for (const target of design.targets) {
        expect(Number.isInteger(target.x)).toBe(true);
        expect(Number.isInteger(target.y)).toBe(true);
        expect(Math.abs(target.x)).toBeLessThanOrEqual(5);
        expect(Math.abs(target.y)).toBeLessThanOrEqual(3);
      }
      expect(new Set(design.targets.map((t) => t.id)).size).toBe(design.targets.length);
    }
  });

  it('introduces silver ships after a couple of waves, never in the first', () => {
    const seed = 'ship-test';
    const first = firstShipWave(seed);
    expect(first === 3 || first === 4).toBe(true);
    for (let wave = 1; wave <= 12; wave += 1) {
      const design = buildInterceptWave(wave, seed);
      const ships = design.targets.filter((t) => t.kind === 'ship');
      if (wave < first || design.targets.length <= 2) {
        expect(ships, `wave ${wave} should not have a ship`).toHaveLength(0);
      } else {
        expect(ships.length, `wave ${wave} should have a ship`).toBeGreaterThanOrEqual(1);
        // A ship nags at its anchor instead of wandering: the drift is real but
        // small enough to stay on the board.
        for (const ship of ships) {
          for (const time of [0, 0.6, 1.4, 2.7]) {
            const at = targetPosition(ship, time);
            expect(Math.abs(at.x - ship.x)).toBeLessThanOrEqual(0.4);
            expect(Math.abs(at.y - ship.y)).toBeLessThanOrEqual(0.6);
          }
        }
      }
    }
  });

  it('rolls the wave kind after the tutorial wave instead of alternating on a fixed beat', () => {
    const kinds = new Set<string>();
    const sequences = new Set<string>();
    for (const seed of ['curve-a', 'curve-b', 'curve-c', 'curve-d', 'curve-e']) {
      let sequence = '';
      for (let wave = 2; wave <= 10; wave += 1) {
        const design = buildInterceptWave(wave, seed);
        kinds.add(design.kind);
        sequence += design.kind === 'parabola' ? 'p' : 'l';
        if (design.kind === 'parabola') {
          expect(Math.abs(design.a)).toBeGreaterThan(0);
          expect(Number.isInteger(design.h)).toBe(true);
          expect(Number.isInteger(design.k)).toBe(true);
          // Every coordinate stays printed: three points are the minimum needed
          // to recover a, h and k.
          expect(design.targets.length).toBeGreaterThanOrEqual(3);
        }
      }
      sequences.add(sequence);
    }
    // Both firing modes still appear, but two runs do not march through them
    // in the same order.
    expect(kinds).toEqual(new Set(['line', 'parabola']));
    expect(sequences.size).toBeGreaterThan(1);
    expect(buildInterceptWave(1, 'curve-a').kind).toBe('line');
  });

  it('hits a drifting ship only when the beam meets it where it is', () => {
    const ship = {
      id: 'ship-0,0',
      x: 0,
      y: 0,
      kind: 'ship' as const,
      drift: { ampX: 0, ampY: 0.5, speedX: 0, speedY: 1, phaseX: 0, phaseY: 0 },
    };
    const aim = { mode: 'linear' as const, m: 0, b: 0 };
    // On the curve: a beam through the origin hits it.
    expect(targetsOnAim([ship], aim, 0.2, 0)).toHaveLength(1);
    // A quarter of a cycle later it has nudged half a unit off, so the same
    // beam misses; at the top of the next cycle it is back under the beam.
    expect(targetsOnAim([ship], aim, 0.2, Math.PI / 2)).toHaveLength(0);
    expect(targetsOnAim([ship], aim, 0.2, Math.PI)).toHaveLength(1);
  });

  it('grows the wave and stays deterministic for a seed', () => {
    expect(buildInterceptWave(4, 'seed-a').targets.length).toBeGreaterThanOrEqual(
      buildInterceptWave(1, 'seed-a').targets.length
    );
    expect(buildInterceptWave(3, 'seed-a')).toEqual(buildInterceptWave(3, 'seed-a'));
    expect(buildInterceptWave(3, 'seed-a').targets).not.toEqual(
      buildInterceptWave(3, 'seed-b').targets
    );
  });

  it('counts a target only when the line really passes through it', () => {
    const line = { id: '2,3', x: 2, y: 3 };
    expect(targetsOnLine([line], 1, 1, 0.05)).toHaveLength(1);
    expect(targetsOnLine([line], 1, 2, 0.05)).toHaveLength(0);
  });
});

describe('rune vault rooms', () => {
  it('gives every door a lever on the same screen and crates on real floor', () => {
    for (let stage = 1; stage <= 30; stage += 1) {
      const room = generateRoom(stage, 'vault-test');
      expect(room.gate.x).toBeGreaterThan(room.width - 200);
      expect(room.platforms.some((p) => p.kind === 'ground' && p.w > 0)).toBe(true);
      for (const door of room.doors) {
        const lever = room.levers.find((l) => l.id === door.leverId);
        expect(lever).toBeDefined();
        expect(lever!.doorId).toBe(door.id);
        expect(lever!.x).toBeLessThan(door.x + door.w);
      }
      for (const crate of room.crates) {
        expect(crate.y + crate.h).toBeLessThanOrEqual(room.groundY);
        expect(room.levers.some((l) => Math.abs(l.x - crate.x) < 76)).toBe(false);
      }
    }
  });

  it('keeps a drawbridge pit too wide to jump and leaves the lever before it', () => {
    const room = generateRoom(6, 'vault-bridge');
    const bridges = room.doors.filter((d) => d.kind === 'bridge');
    for (const bridge of bridges) {
      expect(bridge.w).toBeGreaterThan(180);
      const lever = room.levers.find((l) => l.id === bridge.leverId)!;
      expect(lever.x + 60).toBeLessThanOrEqual(bridge.x + 20);
    }
  });

  it('does not replay a fixed level script: room content changes with the seed', () => {
    const layouts = new Set<string>();
    const contents = new Set<string>();
    for (let index = 0; index < 16; index += 1) {
      const room = generateRoom(1, `variety-${index}`);
      layouts.add(JSON.stringify(room.platforms.map((p) => [p.x, p.y, p.w])));
      contents.add(describeRoom(room));
    }
    // Room one is no longer the same pit + rope + wall in the same order.
    expect(layouts.size).toBeGreaterThan(10);
    expect(contents.size).toBeGreaterThan(4);
    // Two runs with different seeds are different rooms, and the same seed is
    // still reproducible for tests and resumed runs.
    expect(generateRoom(4, 'seed-a')).not.toEqual(generateRoom(4, 'seed-b'));
    expect(generateRoom(4, 'seed-a')).toEqual(generateRoom(4, 'seed-a'));
  });

  it('keeps every room wide enough to play and ends the floor at the gate approach', () => {
    for (let stage = 1; stage <= 10; stage += 1) {
      const room = generateRoom(stage, 'vault-test');
      const lastPlatform = room.platforms.filter((p) => p.kind === 'ground').pop()!;
      expect(lastPlatform.x + lastPlatform.w).toBe(room.width);
      expect(room.width).toBeGreaterThan(1000);
    }
  });
});
