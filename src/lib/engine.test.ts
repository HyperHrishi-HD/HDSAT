import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import { DESMOS_CB_GRAPHING_URL } from '../components/MathTools';
import { parseRichText } from '../components/MathText';
import {
  SECTION_BREAK_MINUTES,
  buildPracticeSession,
  buildTestPlan,
  estimateScaledScore,
  filterQuestions,
  formatClock,
  orderModuleQuestions,
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

describe('adaptive exam engine & exact SAT blueprint', () => {
  it('routes module 2 based on 60% accuracy threshold and caps lower-tier scaled scores', () => {
    expect(routeModule(6, 10)).toBe('upper');
    expect(routeModule(5, 10)).toBe('lower');
    expect(routeModule(0, 0)).toBe('lower');

    const upperHigh = estimateScaledScore('upper', 27, 27);
    const lowerPerfect = estimateScaledScore('lower', 27, 27);
    const lowerMid = estimateScaledScore('lower', 14, 27);
    expect(upperHigh).toBe(800);
    expect(lowerPerfect).toBeLessThanOrEqual(620);
    expect(lowerMid).not.toBeNull();
    expect((upperHigh ?? 0) > (lowerPerfect ?? 0)).toBe(true);

    const summary = summarizeTest([
      { moduleId: 'rw-m1', section: 'Reading and Writing', tier: 'module1', correct: 22, total: 27, timedOut: false, responses: [] },
      { moduleId: 'rw-up', section: 'Reading and Writing', tier: 'upper', correct: 21, total: 27, timedOut: false, responses: [] },
      { moduleId: 'm-m1', section: 'Math', tier: 'module1', correct: 18, total: 22, timedOut: false, responses: [] },
      { moduleId: 'm-up', section: 'Math', tier: 'upper', correct: 18, total: 22, timedOut: false, responses: [] },
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
    expect(plan.breakMinutes).toBe(SECTION_BREAK_MINUTES);
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

  it('fills the FULL Digital SAT blueprint (54 R&W + 44 Math = 98 Qs, 92 operational + 6 unscored) across random seeds', () => {
    for (const assessment of ['SAT', 'PSAT/NMSQT', 'PSAT 10', 'PSAT 8/9'] as const) {
      for (const seed of ['sim:1700000000', 'sim:1700001999', 'sim:1700005000', 'sim:1700009999']) {
        const plan = buildTestPlan(questions, {
          assessment,
          excludeReleasedPracticeSet: true,
          seed,
        });
        expect(plan.warnings).toEqual([]);

        for (const sec of plan.sections) {
          const expected = sec.section === 'Reading and Writing' ? 27 : 22;
          const expectedUnscored = sec.section === 'Reading and Writing' ? 2 : 1;
          expect(sec.module1.questions).toHaveLength(expected);
          expect(sec.upper.questions).toHaveLength(expected);
          expect(sec.lower.questions).toHaveLength(expected);
          expect(sec.module1.unscoredQuestionIds).toHaveLength(expectedUnscored);
          expect(sec.upper.unscoredQuestionIds).toHaveLength(expectedUnscored);

          expect(sec.module1.minutes).toBe(sec.section === 'Reading and Writing' ? 32 : 35);

          const m1Ids = new Set(sec.module1.questions.map((q) => q.id));
          const upIds = sec.upper.questions.map((q) => q.id);
          expect(upIds.some((id) => m1Ids.has(id))).toBe(false);
          const runIds = [...m1Ids, ...upIds, ...sec.lower.questions.map((q) => q.id)];
          expect(new Set(runIds).size).toBe(runIds.length);
        }
      }
    }
  });

  it('produces a different item mix per fresh test seed (randomized full-length runs)', () => {
    const idOf = (seed: string) =>
      buildTestPlan(questions, { assessment: 'SAT', seed })
        .sections.flatMap((s) => s.module1.questions.map((q) => q.id))
        .join('|');
    expect(idOf('sim:1700000000')).not.toBe(idOf('sim:1700005000'));
  });

  it('enforces the exact 27-item R&W domain/skill sequence and intra-domain difficulty progression', () => {
    const plan = buildTestPlan(questions, { assessment: 'SAT', excludeReleasedPracticeSet: true, seed: 'flow:rw' });
    const sec = plan.sections.find((s) => s.section === 'Reading and Writing')!;
    const qs = sec.module1.questions;
    expect(qs).toHaveLength(27);

    // Items 1-4 (indices 0-3): Words in Context
    for (let i = 0; i < 4; i += 1) {
      expect(qs[i].domain).toBe('Craft and Structure');
      expect(qs[i].skill).toBe('Words in Context');
    }
    // Items 5-6 (indices 4-5): Text Structure and Purpose
    for (let i = 4; i < 6; i += 1) {
      expect(qs[i].domain).toBe('Craft and Structure');
      expect(qs[i].skill).toBe('Text Structure and Purpose');
    }
    // Item 7 (index 6): Cross-Text Connections
    expect(qs[6].domain).toBe('Craft and Structure');
    expect(qs[6].skill).toBe('Cross-Text Connections');

    // Items 8-10 (indices 7-9): Central Ideas and Details
    for (let i = 7; i < 10; i += 1) {
      expect(qs[i].domain).toBe('Information and Ideas');
      expect(qs[i].skill).toBe('Central Ideas and Details');
    }
    // Items 11-12 (indices 10-11): Command of Evidence
    for (let i = 10; i < 12; i += 1) {
      expect(qs[i].domain).toBe('Information and Ideas');
      expect(qs[i].skill.startsWith('Command of Evidence')).toBe(true);
    }
    // Item 13 (index 12): Inferences
    expect(qs[12].domain).toBe('Information and Ideas');
    expect(qs[12].skill).toBe('Inferences');

    // Items 14-17 (indices 13-16): Boundaries
    for (let i = 13; i < 17; i += 1) {
      expect(qs[i].domain).toBe('Standard English Conventions');
      expect(qs[i].skill).toBe('Boundaries');
    }
    // Items 18-20 (indices 17-19): Form, Structure, and Sense
    for (let i = 17; i < 20; i += 1) {
      expect(qs[i].domain).toBe('Standard English Conventions');
      expect(qs[i].skill).toBe('Form, Structure, and Sense');
    }

    // Items 21-23 (indices 20-22): Transitions
    for (let i = 20; i < 23; i += 1) {
      expect(qs[i].domain).toBe('Expression of Ideas');
      expect(qs[i].skill).toBe('Transitions');
    }
    // Items 24-27 (indices 23-26): Rhetorical Synthesis
    for (let i = 23; i < 27; i += 1) {
      expect(qs[i].domain).toBe('Expression of Ideas');
      expect(qs[i].skill).toBe('Rhetorical Synthesis');
    }

    // Every question in the test plan has a non-empty stimulus, and every Command of Evidence (Quantitative)
    // item carries structured figure_metadata (table, bar_chart, or line_chart).
    for (const q of qs) {
      expect((q.stimulus ?? '').trim().length).toBeGreaterThan(0);
      if (q.skill === 'Command of Evidence (Quantitative)') {
        expect(q.figure_metadata).not.toBeNull();
        const fType = (q.figure_metadata as { type?: string }).type;
        expect(['table', 'bar_chart', 'line_chart']).toContain(fType);
      }
    }
  });

  it('enforces the 22-item Math domain matrix, ~75% MC / ~25% SPR intermixing, continuous difficulty curve, and PSAT 8/9 trig exclusion', () => {
    const plan = buildTestPlan(questions, { assessment: 'SAT', excludeReleasedPracticeSet: true, seed: 'flow:m' });
    const sec = plan.sections.find((s) => s.section === 'Math')!;
    const qs = sec.module1.questions;
    expect(qs).toHaveLength(22);

    // Continuous linear difficulty curve from Item 1 (Easiest) to Item 22 (Hardest)
    const diffRank = (d: string) => ({ Easy: 0, Medium: 1, Hard: 2 }[d] ?? 1);
    for (let i = 1; i < qs.length; i += 1) {
      expect(diffRank(qs[i].difficulty)).toBeGreaterThanOrEqual(diffRank(qs[i - 1].difficulty));
    }

    // ~75% MC (16-17) and ~25% SPR (5-6)
    const sprCount = qs.filter((q) => q.format === 'spr').length;
    const mcCount = qs.filter((q) => q.format === 'multiple_choice').length;
    expect(sprCount).toBeGreaterThanOrEqual(4);
    expect(sprCount).toBeLessThanOrEqual(7);
    expect(mcCount + sprCount).toBe(22);

    // Domain distribution matrix check (Algebra ~7-8, Advanced Math ~7-8, PSDA ~3-4, Geo/Trig ~3-4)
    const byDomain: Record<string, number> = {};
    qs.forEach((q) => {
      byDomain[q.domain] = (byDomain[q.domain] ?? 0) + 1;
    });
    expect(byDomain['Algebra']).toBeGreaterThanOrEqual(7);
    expect(byDomain['Advanced Math']).toBeGreaterThanOrEqual(7);
    expect(byDomain['Problem-Solving and Data Analysis']).toBeGreaterThanOrEqual(3);
    expect(byDomain['Geometry and Trigonometry']).toBeGreaterThanOrEqual(3);

    // PSAT 8/9 excludes trigonometry
    const psat89 = buildTestPlan(questions, { assessment: 'PSAT 8/9', seed: 'psat89:test' });
    const math89 = psat89.sections.find((s) => s.section === 'Math')!;
    for (const q of [...math89.module1.questions, ...math89.upper.questions, ...math89.lower.questions]) {
      expect(q.skill.toLowerCase().includes('trigonometr')).toBe(false);
    }
  });
});

describe('local storage ledger, anti-farming HDCoins, and bookmarks', () => {
  it('awards HDCoins once per first attempt and first correct answer, and blocks duplicate eventIds', () => {
    const q = questions[0];
    const wrong = ['A', 'B', 'C', 'D'].find((c) => c !== q.correct_answer) ?? 'wrong';
    let profile = emptyProfile();

    const first = applyAttempt(profile, q, wrong, { mode: 'practice', eventId: 'evt-1' });
    expect(first.isCorrect).toBe(false);
    expect(first.coinsAwarded).toBe(1);
    profile = first.profile;

    const dup = applyAttempt(profile, q, wrong, { mode: 'practice', eventId: 'evt-1' });
    expect(dup.duplicate).toBe(true);
    expect(dup.coinsAwarded).toBe(0);

    const second = applyAttempt(profile, q, q.correct_answer, { mode: 'practice', eventId: 'evt-2' });
    expect(second.isCorrect).toBe(true);
    expect(second.coinsAwarded).toBe(1);
    profile = second.profile;

    const third = applyAttempt(profile, q, q.correct_answer, { mode: 'practice', eventId: 'evt-3' });
    expect(third.isCorrect).toBe(true);
    expect(third.coinsAwarded).toBe(0);
    expect(third.progress.status).toBe('mastered');

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

describe('module flow ordering', () => {
  const withOverrides = (over: Partial<Question>): Question => ({ ...questions[0], ...over });

  it('orders R&W domains Craft -> Info -> Conventions -> Expression of Ideas', () => {
    const exp = withOverrides({ id: 'ord-1', domain: 'Expression of Ideas', skill: 'Transitions', difficulty: 'Easy' });
    const grammar = withOverrides({ id: 'ord-2', domain: 'Standard English Conventions', skill: 'Boundaries', difficulty: 'Easy' });
    const info = withOverrides({ id: 'ord-3', domain: 'Information and Ideas', skill: 'Inferences', difficulty: 'Hard' });
    const craft = withOverrides({ id: 'ord-4', domain: 'Craft and Structure', skill: 'Words in Context', difficulty: 'Medium' });
    const ordered = orderModuleQuestions([exp, grammar, info, craft], 'Reading and Writing');
    expect(ordered.map((q) => q.domain)).toEqual([
      'Craft and Structure',
      'Information and Ideas',
      'Standard English Conventions',
      'Expression of Ideas',
    ]);
  });

  it('orders Math questions in continuous ascending difficulty Easy -> Medium -> Hard regardless of domain', () => {
    const hardAlg = withOverrides({ id: 'ord-m1', section: 'Math', domain: 'Algebra', difficulty: 'Hard' });
    const easyGeo = withOverrides({ id: 'ord-m2', section: 'Math', domain: 'Geometry and Trigonometry', difficulty: 'Easy' });
    const medAdv = withOverrides({ id: 'ord-m3', section: 'Math', domain: 'Advanced Math', difficulty: 'Medium' });
    const ordered = orderModuleQuestions([hardAlg, easyGeo, medAdv], 'Math');
    expect(ordered.map((q) => q.difficulty)).toEqual(['Easy', 'Medium', 'Hard']);
  });
});

describe('Desmos College Board URL', () => {
  it('points to the official College Board Desmos graphing calculator', () => {
    expect(DESMOS_CB_GRAPHING_URL).toBe('https://www.desmos.com/testing/collegeboard/graphing');
  });
});

describe('rich text parsing', () => {
  const text = (input: string) =>
    parseRichText(input)
      .filter((t) => t.type === 'text')
      .map((t) => (t as { value: string }).value)
      .join('');
  const maths = (input: string) =>
    parseRichText(input)
      .filter((t) => t.type === 'math')
      .map((t) => (t as { value: string }).value);

  it('renders delimited math and leaves surrounding prose intact', () => {
    expect(text('The function $f(x) = 180(x - 2)$ gives the sum.')).toBe(
      'The function  gives the sum.'
    );
    expect(maths('The function $f(x) = 180(x - 2)$ gives the sum.')).toEqual([
      'f(x) = 180(x - 2)',
    ]);
  });

  it('keeps bare currency amounts literal instead of treating them as LaTeX', () => {
    expect(text('A shop raises a price from $80 by 25%.')).toBe(
      'A shop raises a price from $80 by 25%.'
    );
    expect(maths('A shop raises a price from $80 by 25%.')).toEqual([]);
  });

  it('handles a currency amount followed by a math percent segment', () => {
    const input = 'A repair shop raises the price of a tune-up from $40 by 20$\\%$.';
    expect(text(input)).toBe('A repair shop raises the price of a tune-up from $40 by 20.');
    expect(maths(input)).toEqual(['\\%']);
  });

  it('unescapes dollar signs and keeps escaped currency inside math', () => {
    expect(text('It cost \\$5.')).toBe('It cost $5.');
    expect(maths('The list price was $\\$650$ before tax.')).toEqual(['\\$650']);
  });

  it('supports display math and unclosed dollar signs', () => {
    expect(parseRichText('$$x^2$$').some((t) => t.type === 'math' && t.display)).toBe(true);
    expect(text('Only $5 left')).toBe('Only $5 left');
  });
});
