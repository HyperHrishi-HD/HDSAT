import { describe, expect, it } from 'vitest';
import {
  HEATMAP_DOMAINS,
  HEATMAP_SKILLS,
  buildMasteryHeatmap,
  buildMasteryRadar,
  canonicalHeatmapSkill,
  heatmapAccuracy,
} from './masteryHeatmap';
import type { Question, QuestionProgress } from './types';

const question = (overrides: Partial<Question>): Question =>
  ({
    id: 'q1',
    external_id: null,
    assessments: ['SAT'],
    section: 'Math',
    domain: 'Algebra',
    skill: 'Linear equations in one variable',
    difficulty: 'Easy',
    format: 'multiple_choice',
    stimulus: null,
    prompt: 'p',
    choices: [],
    figure_metadata: null,
    source_id: 'test',
    source_name: 'test',
    license: 'test',
    attribution: 'test',
    is_released_practice_set: false,
    correct_answer: 'A',
    acceptable_answers: [],
    explanation: '',
    distractor_rationales: {},
    ...overrides,
  }) as Question;

const progress = (attemptCount: number, correctCount: number): QuestionProgress => ({
  questionId: 'q1',
  attemptCount,
  correctCount,
  consecutiveCorrect: 0,
  status: 'correct',
  lastResponse: 'A',
  lastIsCorrect: true,
  lastAttemptedAt: new Date().toISOString(),
});

describe('mastery heatmap', () => {
  it('has 29 canonical skill rows in eight domains', () => {
    expect(HEATMAP_SKILLS).toHaveLength(29);
    expect(HEATMAP_DOMAINS).toHaveLength(8);
  });

  it('aggregates progress and maps legacy skill labels', () => {
    const rows = buildMasteryHeatmap(
      [
        question({ id: 'a', skill: 'Command of Evidence (Quantitative)', domain: 'Information and Ideas', section: 'Reading and Writing', difficulty: 'Hard' }),
        question({ id: 'b', skill: 'Command of Evidence (Textual)', domain: 'Information and Ideas', section: 'Reading and Writing', difficulty: 'Hard' }),
        question({ id: 'c', skill: 'Quadratic functions', domain: 'Advanced Math', difficulty: 'Medium' }),
      ],
      { a: progress(2, 1), b: progress(3, 3), c: progress(1, 1) },
      'SAT'
    );
    const command = rows
      .find((domain) => domain.domain === 'Information and Ideas')!
      .rows.find((row) => row.skill === 'Command of Evidence')!;
    expect(command.cells.Hard).toEqual({ attempts: 5, correct: 4 });
    expect(heatmapAccuracy(command.cells.Hard)).toBe(80);
    expect(canonicalHeatmapSkill('Advanced Math', 'Quadratic functions')).toBe(
      'Quadratic functions and factoring'
    );
  });

  it('collapses the heatmap into one radar axis per domain, sliced by difficulty', () => {
    const rows = buildMasteryHeatmap(
      [
        question({ id: 'a', skill: 'Command of Evidence (Quantitative)', domain: 'Information and Ideas', section: 'Reading and Writing', difficulty: 'Hard' }),
        question({ id: 'b', skill: 'Command of Evidence (Textual)', domain: 'Information and Ideas', section: 'Reading and Writing', difficulty: 'Hard' }),
        question({ id: 'c', skill: 'Quadratic functions', domain: 'Advanced Math', difficulty: 'Medium' }),
      ],
      { a: progress(2, 1), b: progress(3, 3), c: progress(1, 1) },
      'SAT'
    );
    const all = buildMasteryRadar(rows);
    expect(all).toHaveLength(8);
    expect(all.find((axis) => axis.domain === 'Information and Ideas')).toMatchObject({
      attempts: 5,
      correct: 4,
      accuracy: 80,
    });
    expect(all.find((axis) => axis.domain === 'Advanced Math')).toMatchObject({
      attempts: 1,
      correct: 1,
      accuracy: 100,
    });
    const hard = buildMasteryRadar(rows, 'Hard').find(
      (axis) => axis.domain === 'Information and Ideas'
    )!;
    expect(hard).toMatchObject({ attempts: 5, correct: 4, accuracy: 80 });
    expect(
      buildMasteryRadar(rows, 'Easy').find((axis) => axis.domain === 'Algebra')!.accuracy
    ).toBeNull();
  });

  it('does not include questions from another assessment', () => {
    const rows = buildMasteryHeatmap(
      [question({ id: 'psat', assessments: ['PSAT 8/9'], domain: 'Algebra' })],
      { psat: progress(4, 4) },
      'SAT'
    );
    expect(rows[4].rows[0].cells.Easy).toEqual({ attempts: 0, correct: 0 });
  });
});
