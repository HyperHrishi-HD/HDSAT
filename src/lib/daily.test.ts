// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { dailyHardQuestion, daysUntilDate, questFocus, questQuestionIds } from './daily';
import type { Difficulty, Question, QuestionProgress, Section } from './types';

let counter = 0;

/** Distinct alphabetic token, so normalising digits cannot merge two stems. */
function token(n: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  let rest = n;
  while (rest >= 0) {
    out = `${letters[rest % 26]}${out}`;
    rest = Math.floor(rest / 26) - 1;
  }
  return out;
}

function q(section: Section, index: number, difficulty: Difficulty = 'Medium', domain?: string): Question {
  counter += 1;
  return {
    id: `${section === 'Math' ? 'M' : 'RW'}-${index}`,
    external_id: `ext-${counter}`,
    assessments: ['SAT'],
    section,
    domain: domain ?? (section === 'Math' ? 'Algebra' : 'Information and Ideas'),
    skill: 'Skill',
    difficulty,
    format: 'multiple_choice',
    stimulus: null,
    prompt: `Which claim about ${token(counter)} is supported, item ${index} (${section})?`,
    choices: [
      { id: 'A', text: 'one' },
      { id: 'B', text: 'two' },
      { id: 'C', text: 'three' },
      { id: 'D', text: 'four' },
    ],
    figure_metadata: null,
    source_id: 'test',
    source_name: 'Test',
    license: 'CC-BY-4.0',
    attribution: 'Test',
    is_released_practice_set: false,
    correct_answer: 'A',
    acceptable_answers: ['A'],
    explanation: 'Because.',
    distractor_rationales: {},
  };
}

function bank(): Question[] {
  const out: Question[] = [];
  for (let i = 0; i < 60; i += 1) out.push(q('Reading and Writing', i, i % 3 === 0 ? 'Hard' : 'Medium'));
  for (let i = 0; i < 60; i += 1) {
    out.push(q('Math', i, i % 3 === 0 ? 'Hard' : 'Medium', i < 30 ? 'Algebra' : 'Geometry'));
  }
  return out;
}

function record(overrides: Partial<QuestionProgress>): QuestionProgress {
  return {
    questionId: 'x',
    attemptCount: 2,
    correctCount: 1,
    consecutiveCorrect: 0,
    status: 'incorrect',
    lastResponse: 'B',
    lastIsCorrect: false,
    lastAttemptedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('personalised daily quests', () => {
  it('is stable for one student and different for another', () => {
    const questions = bank();
    const a = questQuestionIds(questions, 'warmup', 'SAT', '2026-11-01', {}, { seed: 'u:one' });
    const again = questQuestionIds(questions, 'warmup', 'SAT', '2026-11-01', {}, { seed: 'u:one' });
    expect(again).toEqual(a);
    const b = questQuestionIds(questions, 'warmup', 'SAT', '2026-11-01', {}, { seed: 'u:two' });
    expect(b).not.toEqual(a);
  });

  it('fills a quest with ten distinct items, one per family', () => {
    const questions = bank();
    const ids = questQuestionIds(questions, 'gauntlet', 'SAT', '2026-11-02', {}, { seed: 'u:three' });
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it('never starves the warm-up when every Reading & Writing item is a due review', () => {
    const questions = bank().filter((item) => item.section === 'Reading and Writing');
    const progress: Record<string, QuestionProgress> = {};
    for (const item of questions) {
      progress[item.id] = record({ questionId: item.id });
    }
    const ids = questQuestionIds(questions, 'warmup', 'SAT', '2026-11-03', progress, {
      seed: 'u:four',
    });
    expect(ids).toHaveLength(5);
    expect(ids.every((id) => progress[id])).toBe(true);
  });

  it('points precision at the weakest domain, using fresh items there first', () => {
    const questions = bank();
    const weak = questions.filter((item) => item.section === 'Math' && item.domain === 'Algebra');
    const progress: Record<string, QuestionProgress> = {};
    // Ten Algebra misses, and every Geometry item answered well: the weak domain
    // is Algebra, and it still has unseen items for today's drill.
    for (const item of weak.slice(0, 10)) {
      progress[item.id] = record({ questionId: item.id, attemptCount: 5, correctCount: 1 });
    }
    for (const item of questions.filter((item) => item.domain === 'Geometry')) {
      progress[item.id] = record({
        questionId: item.id,
        attemptCount: 5,
        correctCount: 5,
        status: 'mastered',
        consecutiveCorrect: 3,
        lastIsCorrect: true,
      });
    }
    const ids = questQuestionIds(questions, 'precision', 'SAT', '2026-11-04', progress, {
      seed: 'u:five',
    });
    const byId = new Map(questions.map((item) => [item.id, item]));
    const mathPicks = ids.filter((id) => id.startsWith('M-'));
    expect(mathPicks.length).toBeGreaterThan(0);
    expect(mathPicks.every((id) => byId.get(id)?.domain === 'Algebra')).toBe(true);
  });

  it('does not keep serving an easier pick after the bank difficulty is corrected', () => {
    const questions = bank();
    const easier = questions.find((item) => item.difficulty !== 'Hard')!;
    localStorage.setItem(
      'hdsat.qotd.pick.v1',
      JSON.stringify({ date: '2026-11-13', id: easier.id })
    );
    const picked = dailyHardQuestion(questions, 'SAT', '2026-11-13');
    expect(picked?.difficulty).toBe('Hard');
    expect(picked?.id).not.toBe(easier.id);
  });

  it('counts whole calendar days to the test date, not partial days', () => {
    // 21:30 on 27 Oct 2026 to 5 Dec 2026 is 39 calendar days. A 23:59:59 target
    // with Math.ceil used to report 40.
    const evening = new Date(2026, 9, 27, 21, 30);
    expect(daysUntilDate('2026-12-05', evening)).toBe(39);
    expect(daysUntilDate('2026-10-27', evening)).toBe(0);
    expect(daysUntilDate('2026-10-26', evening)).toBe(-1);
    expect(daysUntilDate('not-a-date', evening)).toBeNull();
  });

  it('reports due reviews, weak domains and days to the test', () => {
    const questions = bank();
    const target = questions[0];
    const weak = questions[1];
    const progress = {
      [target.id]: record({ questionId: target.id }),
      [weak.id]: record({ questionId: weak.id, attemptCount: 4, correctCount: 1 }),
    };
    const focus = questFocus(questions, progress, {
      testDate: new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10),
    });
    expect(focus.due).toBe(2);
    expect(focus.weakDomains.length).toBeGreaterThan(0);
    expect(focus.daysToTest).not.toBeNull();
    expect(focus.daysToTest as number).toBeLessThanOrEqual(8);
  });
});
