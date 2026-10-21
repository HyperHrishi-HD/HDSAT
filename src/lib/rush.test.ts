// @vitest-environment jsdom
/**
 * Practice Rush: the increasing-difficulty curve, its question scheduler, the
 * scoring curve, and the per-combination record that persists in the profile.
 */
import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import {
  chooseRushQuestion,
  describeRushKey,
  describeRushMix,
  emptyRushServed,
  parseRushDuration,
  pickRushDifficulty,
  rushAnswerPoints,
  rushDifficultyMix,
  RUSH_BASE_POINTS,
  rushSetupKey,
} from './rush';
import { emptyProfile, loadProfile, recordRushScore, saveProfile, STORAGE_KEY } from './storage';
import type { Difficulty, Question } from './types';

const questions = (bankJson as unknown as { questions: Question[] }).questions;
const diff = (d: Difficulty) => questions.filter((q) => q.difficulty === d);

describe('increasing difficulty curve', () => {
  it('starts fully Easy and grows the Medium/Hard share 10% → 22% → 35% → 50%', () => {
    const start = rushDifficultyMix(0);
    expect(start.Easy).toBe(1);
    expect(start.Medium).toBe(0);
    expect(start.Hard).toBe(0);

    const oneMinute = rushDifficultyMix(60);
    expect(oneMinute.Medium).toBeCloseTo(0.1, 6);
    expect(oneMinute.Hard).toBe(0);

    expect(rushDifficultyMix(120).Medium + rushDifficultyMix(120).Hard).toBeCloseTo(0.22, 6);
    expect(rushDifficultyMix(180).Medium + rushDifficultyMix(180).Hard).toBeCloseTo(0.35, 6);
    expect(rushDifficultyMix(300).Medium + rushDifficultyMix(300).Hard).toBeCloseTo(0.5, 6);
  });

  it('never slides back toward easy and settles at the SAT module mix', () => {
    let previousShare = 0;
    let previousEasy = 1;
    for (let seconds = 0; seconds <= 900; seconds += 5) {
      const mix = rushDifficultyMix(seconds);
      const combined = mix.Medium + mix.Hard;
      expect(combined).toBeGreaterThanOrEqual(previousShare - 1e-9);
      expect(mix.Easy).toBeLessThanOrEqual(previousEasy + 1e-9);
      expect(combined).toBeLessThanOrEqual(1 + 1e-9);
      previousShare = combined;
      previousEasy = mix.Easy;
    }

    const late = rushDifficultyMix(720);
    expect(late.Easy).toBeCloseTo(0.3, 6);
    expect(late.Medium).toBeCloseTo(0.42, 6);
    expect(late.Hard).toBeCloseTo(0.28, 6);
    // A stopwatch run that never ends keeps the curve flat, not Easy again.
    expect(rushDifficultyMix(60 * 60)).toEqual(late);
  });

  it('interpolates between stages instead of jumping at minute marks', () => {
    expect(rushDifficultyMix(59).Medium).toBeCloseTo(rushDifficultyMix(60).Medium, 2);
    expect(rushDifficultyMix(299).Medium + rushDifficultyMix(299).Hard).toBeCloseTo(0.5, 2);
    // Fractional seconds sit strictly between their neighbouring whole seconds.
    expect(rushDifficultyMix(30.5).Easy).toBeLessThan(rushDifficultyMix(30).Easy);
    expect(rushDifficultyMix(30.5).Easy).toBeGreaterThan(rushDifficultyMix(31).Easy);
    // Odd negative input is clamped safely.
    expect(rushDifficultyMix(-30)).toEqual(rushDifficultyMix(0));
  });

  it('describes the mix for the live badge', () => {
    expect(describeRushMix({ Easy: 0.5, Medium: 0.35, Hard: 0.15 })).toBe(
      'Easy 50% · Medium 35% · Hard 15%'
    );
  });
});

describe('increasing difficulty scheduler', () => {
  it('serves the exact target share over a long run (deficit scheduling, not luck)', () => {
    const served = emptyRushServed();
    const counts: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
    const mix = rushDifficultyMix(300);
    for (let i = 0; i < 400; i += 1) {
      const picked = pickRushDifficulty(mix, served);
      served[picked] += 1;
      counts[picked] += 1;
    }
    expect(counts.Easy / 400).toBeCloseTo(0.5, 1);
    expect(counts.Medium / 400).toBeCloseTo(0.35, 1);
    expect(counts.Hard / 400).toBeCloseTo(0.15, 1);
  });

  it('opens every increasing run with Easy items', () => {
    const served = emptyRushServed();
    for (let i = 0; i < 8; i += 1) {
      expect(pickRushDifficulty(rushDifficultyMix(0), served)).toBe('Easy');
      served.Easy += 1;
    }
  });

  it('lets Hard items in only once the curve calls for them', () => {
    expect(rushDifficultyMix(60).Hard).toBe(0);
    const served = emptyRushServed();
    served.Easy = 5;
    served.Medium = 1;
    expect(pickRushDifficulty(rushDifficultyMix(60), served)).not.toBe('Hard');
  });
});

describe('rush scoring', () => {
  it('pays 10 / 15 / 20 by difficulty and caps the streak bonus at +50%', () => {
    expect(RUSH_BASE_POINTS).toEqual({ Easy: 10, Medium: 15, Hard: 20 });
    expect(rushAnswerPoints('Easy', 1)).toBe(10);
    expect(rushAnswerPoints('Medium', 3)).toBe(18);
    expect(rushAnswerPoints('Hard', 6)).toBe(30);
    expect(rushAnswerPoints('Hard', 50)).toBe(30);
  });
});

describe('question selection', () => {
  it('honours a fixed difficulty band', () => {
    const pool = [...diff('Easy').slice(0, 3), ...diff('Medium').slice(0, 3)];
    const used = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const q = chooseRushQuestion(pool, 'Medium', 0, emptyRushServed(), used);
      expect(q?.difficulty).toBe('Medium');
      used.add(q!.id);
    }
  });

  it('avoids repeating a question until its slice is exhausted', () => {
    const pool = diff('Easy').slice(0, 4);
    const used = new Set<string>();
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const q = chooseRushQuestion(pool, 'Easy', 0, emptyRushServed(), used)!;
      used.add(q.id);
      seen.push(q.id);
    }
    expect(new Set(seen).size).toBe(4);
    // The slice is used up, so the next draw recycles instead of returning null.
    const recycled = chooseRushQuestion(pool, 'Easy', 0, emptyRushServed(), used);
    expect(recycled).not.toBeNull();
    expect(seen).toContain(recycled!.id);
  });

  it('falls back to the full pool when a difficulty band is empty', () => {
    const pool = diff('Medium').slice(0, 2);
    const q = chooseRushQuestion(pool, 'Easy', 0, emptyRushServed(), new Set());
    expect(q).not.toBeNull();
  });

  it('opens increasing mode on an Easy item and later mixes upward', () => {
    const mixed = questions.slice(0, 600);
    const used = new Set<string>();
    const first = chooseRushQuestion(mixed, 'Increasing', 0, emptyRushServed(), used);
    expect(first?.difficulty).toBe('Easy');

    // No question at all is impossible: every band exists in the bank.
    expect(chooseRushQuestion([], 'Mixed', 0, emptyRushServed(), new Set())).toBeNull();
  });
});

describe('rush setup keys', () => {
  it('keys every combination separately', () => {
    expect(rushSetupKey({ duration: 180, section: 'all', difficulty: 'Mixed' })).toBe('180|all|Mixed');
    expect(rushSetupKey({ duration: 'free', section: 'Math', difficulty: 'Hard' })).toBe('free|Math|Hard');
    const base = rushSetupKey({ duration: 180, section: 'all', difficulty: 'Mixed' });
    expect(rushSetupKey({ duration: 60, section: 'all', difficulty: 'Mixed' })).not.toBe(base);
    expect(rushSetupKey({ duration: 180, section: 'Math', difficulty: 'Mixed' })).not.toBe(base);
    expect(rushSetupKey({ duration: 180, section: 'all', difficulty: 'Increasing' })).not.toBe(base);
  });

  it('describes a stored key back into the student\'s own words', () => {
    expect(describeRushKey('180|all|Mixed')).toBe('3 min · Mixed sections · Mixed');
    expect(describeRushKey('free|Math|Increasing')).toBe('Free · Math · Increasing');
    expect(describeRushKey('60|Reading and Writing|Hard')).toBe(
      '1 min · Reading and Writing · Hard'
    );
    expect(describeRushKey('900|all|Mixed')).toBe('3 min · Mixed sections · Mixed');
  });

  it('parses duration values and refuses unknown ones', () => {
    expect(parseRushDuration('free')).toBe('free');
    expect(parseRushDuration('60')).toBe(60);
    expect(parseRushDuration('300')).toBe(300);
    expect(parseRushDuration('900')).toBe(180);
    expect(parseRushDuration('abc')).toBe(180);
  });
});

describe('persisted rush records', () => {
  it('keeps a best that only moves up while last always shows the latest run', () => {
    let profile = emptyProfile();
    expect(profile.rushScores).toEqual({});

    const key = '180|all|Mixed';
    const first = recordRushScore(profile, key, 240);
    expect(first.record.best).toBe(240);
    expect(first.record.last).toBe(240);
    expect(first.record.plays).toBe(1);
    expect(first.improved).toBe(false);
    profile = first.profile;

    const second = recordRushScore(profile, key, 180);
    expect(second.record.best).toBe(240);
    expect(second.record.last).toBe(180);
    expect(second.record.plays).toBe(2);
    expect(second.improved).toBe(false);
    profile = second.profile;

    const third = recordRushScore(profile, key, 300);
    expect(third.record.best).toBe(300);
    expect(third.improved).toBe(true);
    profile = third.profile;

    // Separate combinations never overwrite each other.
    const other = recordRushScore(profile, 'free|Math|Increasing', 55);
    expect(other.profile.rushScores[key].best).toBe(300);
    expect(other.profile.rushScores['free|Math|Increasing'].best).toBe(55);
  });

  it('round-trips through device storage and tolerates older profiles', () => {
    const key = '60|Reading and Writing|Hard';
    let profile = emptyProfile();
    profile = recordRushScore(profile, key, 410).profile;
    saveProfile(profile);

    const reloaded = loadProfile();
    expect(reloaded.rushScores[key].best).toBe(410);
    expect(reloaded.rushScores[key].plays).toBe(1);

    // A profile saved before rush records existed must still load cleanly.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, hdCoins: 5 }));
    expect(loadProfile().rushScores).toEqual({});
  });
});
