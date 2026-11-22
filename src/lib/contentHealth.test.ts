import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import { contentHealth } from './contentHealth';
import type { Question } from './types';

const base: Omit<Question, 'id' | 'section' | 'prompt' | 'difficulty'> = {
  external_id: null,
  assessments: ['SAT'],
  domain: 'Algebra',
  skill: 'Skill',
  format: 'multiple_choice',
  stimulus: null,
  choices: [
    { id: 'A', text: 'one' },
    { id: 'B', text: 'two' },
  ],
  figure_metadata: null,
  source_id: 't',
  source_name: 'T',
  license: 'CC-BY-4.0',
  attribution: 'T',
  is_released_practice_set: false,
  correct_answer: 'A',
  acceptable_answers: ['A'],
  explanation: 'Because.',
  distractor_rationales: {},
};

function item(overrides: Partial<Question> & { id: string }): Question {
  return {
    ...base,
    section: 'Math',
    prompt: `Stem ${overrides.id}`,
    difficulty: 'Medium',
    ...overrides,
  } as Question;
}

describe('content health', () => {
  it('counts bands, gaps and defects', () => {
    const questions = [
      item({ id: '1', difficulty: 'Easy' }),
      item({ id: '2', difficulty: 'Hard', explanation: '' }),
      item({ id: '3', section: 'Reading and Writing', prompt: '', correct_answer: '' }),
    ];
    const health = contentHealth(questions);
    expect(health.total).toBe(3);
    expect(health.sections[0].count).toBe(2);
    expect(health.parityGap).toBe(1);
    expect(health.missingExplanation).toBe(1);
    expect(health.missingKey).toBe(1);
    expect(health.missingPrompt).toBe(1);
  });

  it('counts a family with two members as duplicate debt', () => {
    // Same stem with different digits is one family, the same question to a student.
    const questions = [
      item({ id: '1', prompt: 'If 3x + 5 = 20, what is x?' }),
      item({ id: '2', prompt: 'If 4x + 7 = 31, what is x?' }),
    ];
    const health = contentHealth(questions);
    expect(health.duplicateFamilies).toBe(1);
    expect(health.duplicateItems).toBe(2);
    expect(health.largestFamily).toBe(2);
  });

  it('reports the real bank without nonsense numbers', () => {
    const bank = bankJson as unknown as { questions: Question[] };
    const health = contentHealth(bank.questions);
    expect(health.total).toBe(bank.questions.length);
    expect(health.sections.reduce((sum, entry) => sum + entry.count, 0)).toBe(health.total);
    expect(health.missingKey).toBe(0);
    expect(health.missingPrompt).toBe(0);
    expect(health.multipleChoiceWithoutChoices).toBe(0);
    expect(health.duplicateItems).toBeLessThanOrEqual(health.total);
  });
});
