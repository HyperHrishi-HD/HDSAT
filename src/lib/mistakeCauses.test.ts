import { describe, expect, it } from 'vitest';
import { explainMistake } from './mistakeCauses';
import type { Question } from './types';

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'Q-1',
    external_id: null,
    assessments: ['SAT'],
    section: 'Math',
    domain: 'Algebra',
    skill: 'Linear equations',
    difficulty: 'Medium',
    format: 'multiple_choice',
    stimulus: null,
    prompt: 'If 2x + 3 = 11, what is x?',
    choices: [
      { id: 'A', text: '4' },
      { id: 'B', text: '-4' },
      { id: 'C', text: '7' },
      { id: 'D', text: '14' },
    ],
    figure_metadata: null,
    source_id: 'test',
    source_name: 'test',
    license: 'CC-BY-4.0',
    attribution: 'test',
    is_released_practice_set: false,
    correct_answer: 'A',
    acceptable_answers: [],
    explanation: '',
    distractor_rationales: {},
    ...overrides,
  };
}

describe('mistake causes', () => {
  it('treats a blank response as fact, not a guess', () => {
    const cause = explainMistake(question(), null);
    expect(cause?.cause).toBe('blank');
    expect(cause?.confidence).toBe(1);
  });

  it('reads the chosen distractor rationale, not the question', () => {
    const cause = explainMistake(
      question({
        distractor_rationales: {
          B: 'This reverses the sign of the solution.',
          C: 'This is the value of 2x + 3, not x.',
        },
      }),
      'B'
    );
    expect(cause?.cause).toBe('sign');
    expect(cause?.evidence).toContain('reverses the sign');
    expect(cause?.confidence).toBeGreaterThan(0.8);
  });

  it('separates scope, early stop and misread rationales', () => {
    const scope = explainMistake(
      question({
        distractor_rationales: { B: 'This claim is too broad: the passage only supports one city.' },
      }),
      'B'
    );
    expect(scope?.cause).toBe('scope');

    const halfStep = explainMistake(
      question({
        distractor_rationales: { C: 'The student stopped after the first step.' },
      }),
      'C'
    );
    expect(halfStep?.cause).toBe('half-step');

    const misread = explainMistake(
      question({
        distractor_rationales: { D: 'This contradicts the second paragraph.' },
      }),
      'D'
    );
    expect(misread?.cause).toBe('misread');
  });

  it('catches a sign flip and a near miss on numeric answers', () => {
    const flip = explainMistake(
      question({
        format: 'spr',
        choices: null,
        correct_answer: '12',
        distractor_rationales: {},
      }),
      '-12'
    );
    expect(flip?.cause).toBe('sign');

    const near = explainMistake(
      question({
        format: 'spr',
        choices: null,
        correct_answer: '0.25',
        acceptable_answers: ['1/4'],
        distractor_rationales: {},
      }),
      '0.24'
    );
    expect(near?.cause).toBe('calculation');
  });

  it('accepts an exact correct numeric value without inventing a cause', () => {
    const cause = explainMistake(
      question({ format: 'spr', choices: null, correct_answer: '7' }),
      '7'
    );
    // A correct response never reaches review, but the classifier must still be
    // honest: it reports the weakest inference rather than a confident mistake.
    expect(cause?.confidence).toBeLessThan(0.5);
  });

  it('falls back to a low-confidence label when there is no evidence', () => {
    const cause = explainMistake(question({ difficulty: 'Easy' }), 'C');
    expect(cause?.cause).toBe('careless');
    expect(cause?.confidence).toBeLessThan(0.5);
    expect(cause?.evidence).toBe('');
  });

  it('matches rationale keys case-insensitively', () => {
    const cause = explainMistake(
      question({ distractor_rationales: { b: 'This reverses the sign.' } }),
      'B'
    );
    expect(cause?.cause).toBe('sign');
  });
});
