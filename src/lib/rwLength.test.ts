import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import rewrites from '../../tools/rw_length_rewrites.json';

type Choice = { id: string; text: string };
type Question = {
  id: string;
  section: string;
  format: string;
  skill: string;
  choices?: Choice[] | null;
  correct_answer: string;
};

const questions = (bankJson as unknown as { questions: Question[] }).questions;
const changed = rewrites.changes as Array<{ id: string; new: string }>;

function keyIndex(question: Question): number {
  return (question.choices ?? []).findIndex(
    (choice) => choice.id.toUpperCase() === question.correct_answer.toUpperCase()
  );
}

function isUniqueLongest(question: Question): boolean {
  const choices = question.choices ?? [];
  if (choices.length < 2) return false;
  const index = keyIndex(question);
  if (index < 0) return false;
  const lengths = choices.map((choice) => choice.text.trim().length);
  const longestWrong = Math.max(...lengths.filter((_, i) => i !== index));
  return lengths[index] > longestWrong && lengths.filter((n) => n === lengths[index]).length === 1;
}

const prioritySkills = new Set([
  'Rhetorical Synthesis',
  'Central Ideas and Details',
  'Cross-Text Connections',
]);

describe('Reading & Writing choice-length balance', () => {
  it('leaves every rewritten key shorter than or equal to its longest distractor', () => {
    for (const change of changed) {
      const question = questions.find((item) => item.id === change.id);
      expect(question, `${change.id} is missing after the rewrite`).toBeDefined();
      if (!question) continue;
      const index = keyIndex(question);
      expect(question.choices?.[index]?.text.trim(), `${change.id} was not rewritten`).toBe(
        change.new
      );
      expect(isUniqueLongest(question), `${change.id} still has a unique longest key`).toBe(false);
    }
  });

  it('keeps the overall R&W length cue below the 50% regression ceiling', () => {
    const mc = questions.filter(
      (question) =>
        question.section === 'Reading and Writing' && question.format === 'multiple_choice'
    );
    const biased = mc.filter(isUniqueLongest).length;
    expect(biased / mc.length).toBeLessThanOrEqual(0.5);
  });

  it('keeps the priority skills below the 70% regression ceiling', () => {
    const mc = questions.filter(
      (question) =>
        question.section === 'Reading and Writing' &&
        question.format === 'multiple_choice' &&
        prioritySkills.has(question.skill)
    );
    const biased = mc.filter(isUniqueLongest).length;
    expect(biased / mc.length).toBeLessThanOrEqual(0.7);
  });
});
