import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import { evaluateMathExpression } from '../components/MathTools';
import {
  buildPracticeSession,
  buildTestPlan,
  estimateScaledScore,
  filterQuestions,
  formatClock,
  routeModule,
  summarizeTest,
} from './examEngine';
import { checkAnswer, parseNumeric } from './grading';
import { isDue, scheduleReview } from './sm2';
import {
  applyAttempt,
  applyFlashcardReview,
  emptyProfile,
  purchaseItem,
  toggleSaved,
} from './storage';
import type { Question } from './types';

const questions = (bankJson as unknown as { questions: Question[] }).questions;

describe('grading engine', () => {
  it('parses integer, decimal, and fractional student-produced responses', () => {
    expect(parseNumeric('9')).toBe(9);
    expect(parseNumeric('9.0')).toBe(9);
    expect(parseNumeric('18/2')).toBe(9);
    expect(parseNumeric('3/4')).toBeCloseTo(0.75);
    expect(parseNumeric('0/0')).toBeNull();
    expect(parseNumeric('')).toBeNull();
  });

  it('grades multiple-choice and SPR items accurately', () => {
    const mc = questions.find((q) => q.format === 'multiple_choice')!;
    expect(checkAnswer(mc, mc.correct_answer)).toBe(true);
    expect(checkAnswer(mc, mc.correct_answer.toLowerCase())).toBe(true);
    const wrongChoice = ['A', 'B', 'C', 'D'].find((c) => c !== mc.correct_answer)!;
    expect(checkAnswer(mc, wrongChoice)).toBe(false);

    const spr = questions.find((q) => q.id === 'M-ALG-002')!;
    expect(checkAnswer(spr, '9')).toBe(true);
    expect(checkAnswer(spr, '9.0')).toBe(true);
    expect(checkAnswer(spr, '18/2')).toBe(true);
    expect(checkAnswer(spr, '8')).toBe(false);
  });
});

describe('SM-2 spaced repetition scheduler', () => {
  it('resets repetitions on low quality (<3) and expands intervals on high quality', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    const first = scheduleReview(undefined, 4, now);
    expect(first.repetitions).toBe(1);
    expect(first.intervalDays).toBe(1);
    expect(first.stage).toBe('review');

    const second = scheduleReview(
      {
        cardId: 'V-001',
        ...first,
        lastQuality: 4,
        lastReviewedAt: now.toISOString(),
      },
      5,
      now
    );
    expect(second.repetitions).toBe(2);
    expect(second.intervalDays).toBe(3);

    const reset = scheduleReview(
      {
        cardId: 'V-001',
        ...second,
        lastQuality: 5,
        lastReviewedAt: now.toISOString(),
      },
      1,
      now
    );
    expect(reset.repetitions).toBe(0);
    expect(reset.intervalDays).toBe(1);
    expect(reset.stage).toBe('learning');
    expect(isDue(undefined, now)).toBe(true);
  });
});

describe('adaptive exam engine & filters', () => {
  it('routes module 2 based on 60% accuracy threshold and computes scaled score estimates', () => {
    expect(routeModule(6, 10)).toBe('upper');
    expect(routeModule(5, 10)).toBe('lower');
    expect(routeModule(0, 0)).toBe('lower');

    const upperHigh = estimateScaledScore('upper', 16, 16);
    const lowerMid = estimateScaledScore('lower', 8, 16);
    expect(upperHigh).toBe(800);
    expect(lowerMid).not.toBeNull();
    expect((upperHigh ?? 0) > (lowerMid ?? 0)).toBe(true);

    const summary = summarizeTest([
      { moduleId: 'rw-m1', section: 'Reading and Writing', tier: 'module1', correct: 7, total: 8, timedOut: false, responses: [] },
      { moduleId: 'rw-up', section: 'Reading and Writing', tier: 'upper', correct: 7, total: 8, timedOut: false, responses: [] },
      { moduleId: 'm-m1', section: 'Math', tier: 'module1', correct: 6, total: 8, timedOut: false, responses: [] },
      { moduleId: 'm-up', section: 'Math', tier: 'upper', correct: 6, total: 8, timedOut: false, responses: [] },
    ]);
    expect(summary.totalEstimate).toBe((summary.rwEstimate ?? 0) + (summary.mathEstimate ?? 0));
  });

  it('builds non-overlapping module plans and respects released-set exclusion', () => {
    const plan = buildTestPlan(questions, {
      assessment: 'SAT',
      excludeReleasedPracticeSet: true,
      itemCap: 6,
      seed: 'unit-test-seed',
    });
    expect(plan.sections).toHaveLength(2);
    for (const sec of plan.sections) {
      const m1Ids = new Set(sec.module1.questions.map((q) => q.id));
      sec.upper.questions.forEach((q) => {
        expect(m1Ids.has(q.id)).toBe(false);
        expect(q.is_released_practice_set).toBe(false);
      });
    }

    const session = buildPracticeSession(questions, { assessment: 'SAT', excludeReleasedPracticeSet: true }, { count: 8, seed: 's1' });
    expect(session).toHaveLength(8);
    expect(session.every((q) => !q.is_released_practice_set)).toBe(true);
    expect(formatClock(125)).toBe('02:05');
  });
});

describe('local storage ledger, anti-farming HDCoins, and bookmarks', () => {
  it('awards HDCoins once per first attempt and first correct answer, and blocks duplicate eventIds', () => {
    const q = questions[0];
    const wrong = ['A', 'B', 'C', 'D'].find((c) => c !== q.correct_answer) ?? 'wrong';
    let profile = emptyProfile();

    // First attempt (incorrect) -> +1 coin for completion
    const first = applyAttempt(profile, q, wrong, { mode: 'practice', eventId: 'evt-1' });
    expect(first.isCorrect).toBe(false);
    expect(first.coinsAwarded).toBe(1);
    profile = first.profile;

    // Duplicate eventId -> 0 coins
    const dup = applyAttempt(profile, q, wrong, { mode: 'practice', eventId: 'evt-1' });
    expect(dup.duplicate).toBe(true);
    expect(dup.coinsAwarded).toBe(0);

    // Second attempt (first time correct) -> +1 coin for first correct
    const second = applyAttempt(profile, q, q.correct_answer, { mode: 'practice', eventId: 'evt-2' });
    expect(second.isCorrect).toBe(true);
    expect(second.coinsAwarded).toBe(1);
    profile = second.profile;

    // Third attempt (already solved before) -> 0 coins (no farming)
    const third = applyAttempt(profile, q, q.correct_answer, { mode: 'practice', eventId: 'evt-3' });
    expect(third.isCorrect).toBe(true);
    expect(third.coinsAwarded).toBe(0);
    expect(third.progress.status).toBe('mastered');

    // Exclude previously correct filter
    const filtered = filterQuestions([q], { excludePreviouslyCorrect: true }, third.profile.progress);
    expect(filtered).toHaveLength(0);
  });

  it('handles flashcard review rewards, saved bookmarks, and store purchases', () => {
    let profile = emptyProfile();
    const fc = applyFlashcardReview(profile, 'V-001', 5);
    expect(fc.coinsAwarded).toBe(1);
    profile = { ...fc.profile, hdCoins: 25 };

    profile = toggleSaved(profile, 'RW-INF-001');
    expect(profile.saved).toContain('RW-INF-001');

    const buy = purchaseItem(profile, 'oxford-navy', 15);
    expect(buy.ok).toBe(true);
    expect(buy.profile.hdCoins).toBe(10);
    expect(buy.profile.ownedItems).toContain('oxford-navy');
  });
});

describe('calculator math evaluator', () => {
  it('evaluates algebraic and trigonometric expressions safely', () => {
    expect(evaluateMathExpression('x^2 - 4x + 3', 5)).toBe(8);
    expect(evaluateMathExpression('sqrt(144) + 3', 0)).toBe(15);
    expect(evaluateMathExpression('2x - 2', 5)).toBe(8);
    expect(evaluateMathExpression('alert(1)', 0)).toBeNull();
  });
});
