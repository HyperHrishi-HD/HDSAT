import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import type { Question } from './types';
import { buildSprintPool } from '../pages/Arcade';
import { questionFamilyKeys } from './examEngine';

const questions = (bankJson as unknown as { questions: Question[] }).questions;

describe('Equation Sprint pool', () => {
  it('draws Math items only, with exactly one correct option each', () => {
    const pool = buildSprintPool(questions, 'audit-seed');
    expect(pool.length).toBeGreaterThan(20);
    for (const item of pool) {
      const id = item.key.replace(/^sprint-/, '').replace(/-audit-seed$/, '');
      const source = questions.find((q) => q.id === id);
      expect(source?.section, `${id} is not a Math item`).toBe('Math');
      expect(item.options).toHaveLength(4);
      expect(item.options.filter((option) => option === item.correct)).toHaveLength(1);
    }
  });

  it('does not repeat a family or put the same skill back to back', () => {
    const pool = buildSprintPool(questions, 'variety-seed');
    const families = new Set<string>();
    let previousSkill = '';
    for (const item of pool) {
      const source = questions.find((q) => q.id === item.questionId);
      expect(source).toBeDefined();
      for (const key of questionFamilyKeys(source!)) {
        expect(families.has(key), `${source!.id} repeats a family`).toBe(false);
        families.add(key);
      }
      if (previousSkill) expect(source!.skill).not.toBe(previousSkill);
      previousSkill = source!.skill;
    }
  });
});
