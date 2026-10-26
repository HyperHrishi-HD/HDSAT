// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildFamilyHistory,
  buildPracticeSession,
  buildTestPlan,
  isFamilyFresh,
  questionFamilyKeys,
  templateMasteryIds,
} from './examEngine';
import bankJson from '../data/questionBank.json';
import { buildChatPool, buildRunePool } from './arcadeGames';
import { questQuestionIds } from './daily';
import type { Question, QuestionProgress } from './types';

const bank = (bankJson as unknown as { questions: Question[] }).questions;

/**
 * Near-duplicates are the failure mode a large generated bank invites: two
 * rewordings of one template look like two questions to the scheduler and one
 * question to the student. These tests pin the family rule across every mode.
 */

let counter = 0;

/** A non-numeric tag: digits are normalised away in template keys. */
function tag(index: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return `${letters[index % 26]}${letters[Math.floor(index / 26) % 26]}`;
}

function makeQuestion(overrides: Partial<Question> & { prompt: string }): Question {
  counter += 1;
  const id = overrides.id ?? `TEST-${counter}`;
  return {
    id,
    external_id: null,
    assessments: ['SAT'],
    section: 'Reading and Writing',
    domain: 'Craft and Structure',
    skill: `Skill ${counter % 7}`,
    difficulty: 'Medium',
    format: 'multiple_choice',
    stimulus: null,
    choices: [
      { id: 'A', text: 'alpha' },
      { id: 'B', text: 'beta' },
      { id: 'C', text: 'gamma' },
      { id: 'D', text: 'delta' },
    ],
    figure_metadata: null,
    source_id: 'hdsat-open-core-2026',
    source_name: 'HDSAT Open Core',
    license: 'CC-BY-4.0',
    attribution: 'HDSAT',
    is_released_practice_set: false,
    correct_answer: 'A',
    acceptable_answers: ['alpha'],
    explanation: 'because',
    distractor_rationales: {},
    ...overrides,
  };
}

function progressFor(question: Question, status: QuestionProgress['status'], consecutive = 2): QuestionProgress {
  return {
    questionId: question.id,
    attemptCount: consecutive,
    correctCount: consecutive,
    consecutiveCorrect: consecutive,
    status,
    lastResponse: 'A',
    lastIsCorrect: status !== 'incorrect',
    lastAttemptedAt: '2026-10-20T12:00:00.000Z',
  };
}

/** A math template: identical wording, different numbers. */
const templateA1 = makeQuestion({
  id: 'MATH-T1-A',
  section: 'Math',
  prompt: 'If 3x + 5 = 20, what is the value of x?',
});
const templateA2 = makeQuestion({
  id: 'MATH-T1-B',
  section: 'Math',
  prompt: 'If 8x + 2 = 42, what is the value of x?',
});
const templateB1 = makeQuestion({
  id: 'MATH-T2-A',
  section: 'Math',
  prompt: 'A line passes through (0, 4) and (2, 10). What is its slope?',
});

const sharedPassage = 'A long passage about migratory birds crossing the Gulf of Mexico each autumn.';
const passageQ1 = makeQuestion({
  id: 'RW-P1-A',
  stimulus: sharedPassage,
  prompt: 'Which choice best states the main idea of the text?',
});
const passageQ2 = makeQuestion({
  id: 'RW-P1-B',
  stimulus: sharedPassage,
  prompt: 'According to the text, how long does the migration take?',
});
const otherRw1 = makeQuestion({
  id: 'RW-O1',
  stimulus: 'A different passage entirely, about the history of the bicycle.',
  prompt: 'Which choice best describes the structure of the text?',
  skill: 'Text Structure and Purpose',
});
/** The R&W equivalent of a math template: same question, different numbers. */
const rwTwinA = makeQuestion({
  id: 'RW-TWIN-A',
  stimulus: 'A tide pool survey counted 4 species in the upper zone and 7 in the lower zone.',
  prompt: 'Which choice best states the main idea of the text?',
});
const rwTwinB = makeQuestion({
  id: 'RW-TWIN-B',
  stimulus: 'A tide pool survey counted 9 species in the upper zone and 3 in the lower zone.',
  prompt: 'Which choice best states the main idea of the text?',
});
const rwExtra = makeQuestion({
  id: 'RW-EXTRA',
  stimulus: 'A short history of the geared bicycle and its effect on city planning.',
  prompt: 'Which choice best describes the overall structure of the text?',
  skill: 'Text Structure and Purpose',
});

beforeEach(() => {
  localStorage.clear();
});

describe('question families', () => {
  it('groups a math template regardless of its numbers', () => {
    const a = questionFamilyKeys(templateA1);
    const b = questionFamilyKeys(templateA2);
    expect(a.some((key) => b.includes(key))).toBe(true);
  });

  it('groups items built on the same passage', () => {
    const a = questionFamilyKeys(passageQ1);
    const b = questionFamilyKeys(passageQ2);
    expect(a.some((key) => b.includes(key))).toBe(true);
  });

  it('does not group unrelated items', () => {
    const a = questionFamilyKeys(otherRw1);
    for (const key of questionFamilyKeys(templateB1)) expect(a).not.toContain(key);
  });

  it('treats a sibling as seen once any member of the family is attempted', () => {
    const history = buildFamilyHistory([templateA1, templateA2, templateB1], {
      [templateA1.id]: progressFor(templateA1, 'correct', 1),
    });
    expect(isFamilyFresh(templateA1, history)).toBe(false);
    expect(isFamilyFresh(templateA2, history)).toBe(false);
    expect(isFamilyFresh(templateB1, history)).toBe(true);
  });

  it('lets the family back in once the cooldown has passed', () => {
    const old = progressFor(templateA1, 'correct', 1);
    old.lastAttemptedAt = '2026-09-01T12:00:00.000Z';
    const history = buildFamilyHistory([templateA1, templateA2], { [templateA1.id]: old });
    const now = Date.parse('2026-10-25T12:00:00.000Z');
    expect(isFamilyFresh(templateA2, history, now)).toBe(true);
  });
});

describe('practice draws fresh families first', () => {
  it('prefers an unseen family over a near-duplicate of an answered item', () => {
    const questions = [templateA1, templateA2, templateB1];
    const progress = { [templateA1.id]: progressFor(templateA1, 'correct', 1) };
    const session = buildPracticeSession(
      questions,
      { section: 'Math' },
      { count: 2, progress, seed: 'family:practice' }
    );
    expect(session.map((q) => q.id)).toEqual([templateB1.id, templateA2.id]);
  });

  it('still uses the sibling when nothing else is left', () => {
    const questions = [templateA1, templateA2];
    const progress = { [templateA1.id]: progressFor(templateA1, 'correct', 1) };
    const session = buildPracticeSession(
      questions,
      { section: 'Math' },
      { count: 2, progress, seed: 'family:only' }
    );
    expect(session.map((q) => q.id).sort()).toEqual([templateA1.id, templateA2.id].sort());
  });
});

describe('full tests avoid families the student has met', () => {
  it('does not serve a reworded copy of a seen item while unseen items remain', () => {
    // Enough items to fill both sections at a small item cap, with one family
    // already attempted.
    const rw: Question[] = [];
    for (let i = 0; i < 40; i += 1) {
      rw.push(
        makeQuestion({
          id: `RW-F-${i}`,
          stimulus: `Passage ${tag(i)} about an unrelated topic in marine biology.`,
          prompt: `Question ${tag(i)}: which choice best states the main idea?`,
          skill: `Skill ${i % 5}`,
        })
      );
    }
    const math: Question[] = [];
    for (let i = 0; i < 40; i += 1) {
      math.push(
        makeQuestion({
          id: `M-F-${i}`,
          section: 'Math',
          domain: 'Algebra',
          prompt: `Case ${tag(i)}: a rectangle has area ${i + 4} and width ${i + 1}. What is its length?`,
          skill: `Math skill ${i % 5}`,
        })
      );
    }
    const seenItem = math[3];
    const seenSibling = makeQuestion({
      id: 'M-F-SIBLING',
      section: 'Math',
      domain: 'Algebra',
      prompt: 'If 7x + 4 = 11, what is x?',
      skill: 'Math skill 1',
    });
    // Give the sibling the same template as the seen item.
    seenItem.prompt = 'If 4x + 2 = 10, what is x?';
    seenSibling.prompt = 'If 9x + 6 = 33, what is x?';
    math.push(seenSibling);

    const plan = buildTestPlan([...rw, ...math], {
      assessment: 'SAT',
      itemCap: 6,
      seed: 'family:test',
      seenQuestionIds: [seenItem.id],
    });
    const ids = plan.sections.flatMap((section) => [
      ...section.module1.questions.map((q) => q.id),
      ...section.upper.questions.map((q) => q.id),
      ...section.lower.questions.map((q) => q.id),
    ]);
    expect(ids).not.toContain(seenSibling.id);
  });
});

describe('arcade pools', () => {
  it('never puts two variants of one family in the same conversation', () => {
    const questions = [rwTwinA, rwTwinB, otherRw1, rwExtra, passageQ1, passageQ2];
    const pool = buildChatPool(questions, 'family:chat', 10);
    const ids = pool.map((item) => item.questionId);
    expect(ids).toContain(otherRw1.id);
    expect(ids.filter((id) => id === passageQ1.id || id === passageQ2.id)).toHaveLength(1);
    expect(ids.filter((id) => id === rwTwinA.id || id === rwTwinB.id)).toHaveLength(1);
  });

  it('puts unseen families ahead of ones already attempted', () => {
    const questions = [rwTwinA, rwTwinB, otherRw1, rwExtra, passageQ1, passageQ2];
    const pool = buildChatPool(questions, 'family:chat-order', 10, {
      [rwTwinA.id]: progressFor(rwTwinA, 'correct', 1),
    });
    // The first thing Hrishi hands over belongs to a fresh family.
    expect([rwTwinA.id, rwTwinB.id]).not.toContain(pool[0]?.questionId);
  });

  it('keeps rune-vault items family-unique and fresh-first', () => {
    const questions = [templateA1, templateA2, templateB1];
    const pool = buildRunePool(questions, 'family:rune', 10, {
      [templateA1.id]: progressFor(templateA1, 'correct', 1),
    });
    const mathIds = pool
      .filter((item) => item.section === 'Math')
      .map((item) => item.questionId);
    expect(mathIds[0]).toBe(templateB1.id);
    // Only one member of the attempted family makes the pool at all.
    expect(mathIds.filter((id) => id === templateA1.id || id === templateA2.id)).toHaveLength(1);
  });
});

describe('daily quests', () => {
  it('avoids a family already attempted when a fresh item exists', () => {
    const questions: Question[] = [];
    for (let i = 0; i < 12; i += 1) {
      questions.push(
        makeQuestion({
          id: `DQ-${i}`,
          prompt: `Passage ${tag(i)} question: which choice completes the text?`,
          stimulus: `Unique passage ${tag(i)} with enough text to be a stimulus.`,
          skill: `Skill ${i}`,
        })
      );
    }
    const seen = questions[0];
    const ids = questQuestionIds(questions, 'warmup', 'SAT', '2026-11-01', {
      [seen.id]: progressFor(seen, 'correct', 1),
    });
    expect(ids).not.toContain(seen.id);
    expect(ids).toHaveLength(5);
  });
});

describe('with the real bank', () => {
  // A student with a long history must still get a full session and a full
  // simulation: the family rule reorders the draw, it never starves it.
  const heavy = (() => {
    const progress: Record<string, QuestionProgress> = {};
    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
    // Spread across the whole bank so both sections are represented.
    const stride = Math.max(1, Math.floor(bank.length / 400));
    for (let i = 0; i < bank.length; i += stride) {
      const q = bank[i];
      progress[q.id] = progressFor(q, 'correct', 1);
      progress[q.id].lastAttemptedAt = recent;
    }
    return progress;
  })();

  it('fills a practice session from questions outside the cooldown', () => {
    const session = buildPracticeSession(bank, {}, { count: 20, progress: heavy, seed: 'heavy:practice' });
    expect(session).toHaveLength(20);
    expect(new Set(session.map((q) => q.id)).size).toBe(20);
    expect(session.filter((q) => q.section === 'Math')).toHaveLength(10);
    expect(session.filter((q) => q.section === 'Reading and Writing')).toHaveLength(10);
  });

  it('still fills every module of a full simulation', () => {
    const plan = buildTestPlan(bank, {
      assessment: 'SAT',
      seed: 'heavy:test',
      seenQuestionIds: Object.keys(heavy),
    });
    for (const section of plan.sections) {
      const target = section.targetItems;
      expect(section.module1.questions.length).toBe(target);
      expect(section.upper.questions.length).toBe(target);
      expect(section.lower.questions.length).toBe(target);
    }
  });
});

describe('template mastery', () => {
  it('marks a direct template duplicate as mastered', () => {
    const questions = [templateA1, templateA2, templateB1];
    const mastered = templateMasteryIds(questions, {
      [templateA1.id]: progressFor(templateA1, 'mastered'),
    });
    expect(mastered.has(templateA1.id)).toBe(true);
    expect(mastered.has(templateA2.id)).toBe(true);
    expect(mastered.has(templateB1.id)).toBe(false);
  });

  it('does not propagate a single correct answer', () => {
    const questions = [templateA1, templateA2];
    const mastered = templateMasteryIds(questions, {
      [templateA1.id]: progressFor(templateA1, 'correct', 1),
    });
    expect(mastered.has(templateA2.id)).toBe(false);
  });
});
