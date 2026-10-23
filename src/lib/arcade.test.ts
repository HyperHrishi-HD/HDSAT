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
import { SESSION_LEDGER_KEY, awardSessionCoins, emptyProfile } from './storage';
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
  it('pays a Practice Rush five coins for at most four runs a day', () => {
    let profile = emptyProfile();
    let paid = 0;
    for (let run = 0; run < 6; run += 1) {
      const outcome = awardSessionCoins(
        profile,
        { activityType: 'practice_rush', questions: 10, correct: 6, sessionId: `r-${run}` },
        new Date('2026-10-22T12:00:00')
      );
      profile = outcome.profile;
      paid += outcome.coinsAwarded;
    }
    expect(paid).toBe(20);
    expect(profile.hdCoins).toBe(20);
  });

  it('requires three correct answers before a mini-game pays', () => {
    const weak = awardSessionCoins(
      emptyProfile(),
      { activityType: 'mini_game', questions: 10, correct: 2, sessionId: 'weak' },
      new Date('2026-10-22T12:00:00')
    );
    expect(weak.coinsAwarded).toBe(0);

    const strong = awardSessionCoins(
      emptyProfile(),
      { activityType: 'mini_game', questions: 10, correct: 5, sessionId: 'strong' },
      new Date('2026-10-22T12:00:00')
    );
    expect(strong.coinsAwarded).toBe(4);
    expect(strong.profile.hdCoins).toBe(4);
  });

  it('resets the allowance on the next calendar day', () => {
    let profile = emptyProfile();
    for (let run = 0; run < 4; run += 1) {
      profile = awardSessionCoins(
        profile,
        { activityType: 'practice_rush', questions: 10, correct: 6, sessionId: `a-${run}` },
        new Date('2026-10-22T12:00:00')
      ).profile;
    }
    const nextDay = awardSessionCoins(
      profile,
      { activityType: 'practice_rush', questions: 10, correct: 6, sessionId: 'b-0' },
      new Date('2026-10-23T09:00:00')
    );
    expect(nextDay.coinsAwarded).toBe(5);
    expect(localStorage.getItem(SESSION_LEDGER_KEY)).toContain('2026-10-23');
  });
});
