// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { buildPracticeSession } from './examEngine';
import {
  isReviewDue,
  poolReadiness,
  reviewIntervalDays,
  reviewState,
} from './review';
import {
  PRACTICE_SESSION_KEY,
  clearPracticeSession,
  loadPracticeSession,
  practiceResumeSummary,
  savePracticeSession,
} from './session';
import { emptyProfile, purchaseItem } from './storage';
import { formatPace, median, paceComparison, timingSamplesFromAttempts, typicalSeconds } from './timing';
import type { Difficulty, Question, QuestionProgress, Section } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-25T12:00:00.000Z');

function progress(overrides: Partial<QuestionProgress> = {}): QuestionProgress {
  return {
    questionId: 'Q0',
    attemptCount: 1,
    correctCount: 1,
    consecutiveCorrect: 1,
    status: 'correct',
    lastResponse: 'A',
    lastIsCorrect: true,
    lastAttemptedAt: NOW.toISOString(),
    ...overrides,
  };
}

function question(index: number, overrides: Partial<Question> = {}): Question {
  return {
    id: `Q${index}`,
    external_id: null,
    assessments: ['SAT'],
    section: 'Math' as Section,
    domain: 'Algebra',
    skill: `Skill ${index}`,
    difficulty: 'Medium' as Difficulty,
    format: 'multiple_choice',
    stimulus: `Stimulus ${index} about quantity number ${index}`,
    prompt: `What is the value of expression ${index} + ${index}?`,
    choices: [
      { id: 'A', text: `${index}` },
      { id: 'B', text: `${index + 1}` },
      { id: 'C', text: `${index + 2}` },
      { id: 'D', text: `${index + 3}` },
    ],
    figure_metadata: null,
    source_id: 'hdsat-open-core-2026',
    source_name: 'HDSAT Open Core',
    license: 'CC-BY-4.0',
    attribution: 'HDSAT',
    is_released_practice_set: false,
    correct_answer: 'A',
    acceptable_answers: [],
    explanation: 'Substitute and simplify.',
    distractor_rationales: { B: 'Off by one.', C: 'Added twice.', D: 'Sign error.' },
    ...overrides,
  };
}

const pool = Array.from({ length: 12 }, (_, index) => question(index));

describe('review spacing', () => {
  it('spaces by how well the item is known', () => {
    expect(reviewIntervalDays(progress({ status: 'incorrect', consecutiveCorrect: 0 }))).toBe(0);
    expect(reviewIntervalDays(progress({ status: 'correct', consecutiveCorrect: 1 }))).toBe(1);
    expect(reviewIntervalDays(progress({ status: 'mastered', consecutiveCorrect: 2 }))).toBe(7);
    expect(reviewIntervalDays(progress({ status: 'mastered', consecutiveCorrect: 3 }))).toBe(14);
    expect(reviewIntervalDays(progress({ status: 'mastered', consecutiveCorrect: 9 }))).toBe(30);
  });

  it('marks a miss due immediately and a mastered item due only after its interval', () => {
    const missed = progress({ status: 'incorrect', lastIsCorrect: false, lastAttemptedAt: NOW.toISOString() });
    expect(isReviewDue(missed, NOW)).toBe(true);

    const masteredYesterday = progress({
      status: 'mastered',
      consecutiveCorrect: 2,
      lastAttemptedAt: new Date(NOW.getTime() - DAY).toISOString(),
    });
    expect(isReviewDue(masteredYesterday, NOW)).toBe(false);

    const masteredLastWeek = progress({
      status: 'mastered',
      consecutiveCorrect: 2,
      lastAttemptedAt: new Date(NOW.getTime() - 8 * DAY).toISOString(),
    });
    expect(isReviewDue(masteredLastWeek, NOW)).toBe(true);
    expect(reviewState(masteredLastWeek, NOW).overdueDays).toBe(1);
  });

  it('counts unseen, due and scheduled items in a filtered pool', () => {
    const progressMap: Record<string, QuestionProgress> = {
      Q0: progress({ questionId: 'Q0', status: 'incorrect', lastIsCorrect: false }),
      Q1: progress({
        questionId: 'Q1',
        status: 'mastered',
        consecutiveCorrect: 2,
        lastAttemptedAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
      }),
    };
    expect(poolReadiness(pool.slice(0, 4), progressMap, NOW)).toEqual({
      unseen: 2,
      due: 1,
      scheduled: 1,
      ready: 3,
    });
  });
});

describe('practice sessions draw by schedule, never as filler', () => {
  it('leads with unseen items and never repeats an item inside a session', () => {
    const session = buildPracticeSession(
      pool,
      { section: 'Math' },
      { count: 6, progress: {}, seed: 'unseen:1', now: NOW }
    );
    expect(session).toHaveLength(6);
    expect(new Set(session.map((q) => q.id)).size).toBe(6);
  });

  it('rejects a mastered item that is not due yet instead of using it as filler', () => {
    const progressMap: Record<string, QuestionProgress> = {};
    for (const item of pool.slice(0, 4)) {
      progressMap[item.id] = progress({
        questionId: item.id,
        status: 'mastered',
        consecutiveCorrect: 2,
        lastAttemptedAt: new Date(NOW.getTime() - DAY).toISOString(),
      });
    }
    const session = buildPracticeSession(
      pool.slice(0, 4),
      { section: 'Math' },
      { count: 4, progress: progressMap, seed: 'mastered:1', now: NOW }
    );
    expect(session).toHaveLength(0);
  });

  it('brings mastered items back once their review date arrives, misses first', () => {
    const progressMap: Record<string, QuestionProgress> = {
      Q0: progress({
        questionId: 'Q0',
        status: 'mastered',
        consecutiveCorrect: 2,
        lastAttemptedAt: new Date(NOW.getTime() - 8 * DAY).toISOString(),
      }),
      Q1: progress({
        questionId: 'Q1',
        status: 'incorrect',
        consecutiveCorrect: 0,
        correctCount: 0,
        lastIsCorrect: false,
        lastAttemptedAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
      }),
    };
    const session = buildPracticeSession(
      pool.slice(0, 2),
      { section: 'Math' },
      { count: 2, progress: progressMap, seed: 'due:1', now: NOW }
    );
    expect(session.map((q) => q.id)).toEqual(['Q1', 'Q0']);
  });

  it('fills the gap with due reviews when the unseen supply runs out', () => {
    const progressMap: Record<string, QuestionProgress> = {};
    for (const item of pool.slice(0, 6)) {
      progressMap[item.id] = progress({
        questionId: item.id,
        status: 'mastered',
        consecutiveCorrect: 2,
        lastAttemptedAt: new Date(NOW.getTime() - 9 * DAY).toISOString(),
      });
    }
    const session = buildPracticeSession(
      pool.slice(0, 6),
      { section: 'Math' },
      { count: 6, progress: progressMap, seed: 'gap:1', now: NOW }
    );
    expect(session).toHaveLength(6);
  });

  it('lets an explicit saved or incorrect drill revisit a scheduled item', () => {
    const progressMap: Record<string, QuestionProgress> = {
      Q0: progress({ questionId: 'Q0' }),
      Q1: progress({ questionId: 'Q1' }),
    };
    const session = buildPracticeSession(
      pool.slice(0, 2),
      { section: 'Math', onlySaved: true },
      {
        count: 2,
        progress: progressMap,
        savedIds: ['Q0', 'Q1'],
        seed: 'saved:1',
        now: NOW,
        allowScheduled: true,
      }
    );
    expect(session.map((q) => q.id).sort()).toEqual(['Q0', 'Q1']);
  });
});

describe('pacing comparison', () => {
  const attempts = Array.from({ length: 8 }, (_, index) => ({
    eventId: `e${index}`,
    questionId: `Q${index}`,
    response: 'A',
    isCorrect: true,
    mode: 'practice' as const,
    difficulty: 'Medium' as Difficulty,
    section: 'Math' as Section,
    timeSpentSeconds: 60 + index * 10,
    createdAt: NOW.toISOString(),
    sessionId: null,
  }));

  it('uses the student median once there is enough evidence, then the official pace', () => {
    const samples = timingSamplesFromAttempts(attempts);
    expect(samples).toHaveLength(8);
    // 60..130 in tens: the median of 8 values sits between 90 and 100
    expect(typicalSeconds(samples, 'Math', 'Medium')).toBe(95);
    expect(typicalSeconds(samples, 'Reading and Writing', 'Hard')).toBe(71);
    expect(typicalSeconds([], 'Math', 'Easy')).toBe(95);
  });

  it('formats a short pace line and ignores unusable samples', () => {
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    expect(formatPace(130)).toBe('2:10');
    expect(formatPace(85)).toBe('1:25');
    expect(paceComparison(130, 85)).toBe('You 2:10 · typical 1:25');
    expect(paceComparison(0, 85)).toBeNull();
    expect(
      timingSamplesFromAttempts([
        { ...attempts[0], timeSpentSeconds: 1 },
        { ...attempts[1], timeSpentSeconds: 5000 },
      ])
    ).toHaveLength(0);
  });
});

describe('practice resume snapshot', () => {
  beforeEach(() => {
    clearPracticeSession();
  });

  it('round-trips a session and summarises the next item', () => {
    savePracticeSession({
      version: 1,
      sessionId: 'session-1',
      questionIds: ['Q0', 'Q1', 'Q2'],
      index: 1,
      responses: { Q0: 'A' },
      flagged: { Q0: true },
      feedback: { Q0: { isCorrect: true, correctAnswer: 'A', explanation: 'Because.' } },
      elapsedSeconds: 125,
      assessment: 'SAT',
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const loaded = loadPracticeSession(new Date(NOW.getTime() + 60_000).getTime());
    expect(loaded?.questionIds).toEqual(['Q0', 'Q1', 'Q2']);
    expect(loaded?.responses.Q0).toBe('A');
    const summary = practiceResumeSummary(loaded);
    expect(summary).toMatchObject({ answered: 1, total: 3, nextNumber: 2, elapsedSeconds: 125 });
  });

  it('drops a finished or stale session and never surfaces one with no answers left', () => {
    savePracticeSession({
      version: 1,
      sessionId: 'done',
      questionIds: ['Q0'],
      index: 0,
      responses: { Q0: 'B' },
      flagged: {},
      feedback: {},
      elapsedSeconds: 30,
      assessment: 'SAT',
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(practiceResumeSummary(loadPracticeSession(NOW.getTime()))).toBeNull();

    localStorage.setItem(
      PRACTICE_SESSION_KEY,
      JSON.stringify({
        version: 1,
        sessionId: 'stale',
        questionIds: ['Q0', 'Q1'],
        index: 0,
        responses: {},
        flagged: {},
        feedback: {},
        elapsedSeconds: 10,
        assessment: 'SAT',
        startedAt: NOW.toISOString(),
        updatedAt: new Date(NOW.getTime() - 9 * DAY).toISOString(),
      })
    );
    expect(loadPracticeSession(NOW.getTime())).toBeNull();
  });
});

describe('emblems cannot be bought', () => {
  it('refuses every legacy emblem id, themes still work', () => {
    const rich = { ...emptyProfile(), hdCoins: 5000 };
    for (const emblemId of ['badge-navigator', 'badge-grapher', 'badge-centurion']) {
      const result = purchaseItem(rich, emblemId, 200);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/earned/i);
      expect(result.profile.ownedItems).toEqual([]);
    }
    const theme = purchaseItem(rich, 'oxford-navy', 20);
    expect(theme.ok).toBe(true);
    expect(theme.profile.settings.activeTheme).toBe('oxford-navy');
    expect(theme.profile.ownedItems).toEqual(['oxford-navy']);
  });
});
