import { describe, expect, it } from 'vitest';
import bank from '../data/questionBank.json';
import { buildTestPlan } from './examEngine';
import type { Question } from './types';

const questions = (bank as unknown as { questions: Question[] }).questions;
const ASSESSMENTS = ['SAT', 'PSAT/NMSQT & PSAT 10', 'PSAT 10', 'PSAT 8/9'];
const rank = { Easy: 0, Medium: 1, Hard: 2 } as const;
const avg = (arr: Question[]) =>
  arr.reduce((n, q) => n + rank[q.difficulty], 0) / Math.max(1, arr.length);

describe('adaptive blueprint sweep', () => {
  it('keeps every blueprint sound across seeds and assessments', () => {
    const failures: string[] = [];
    for (const assessment of ASSESSMENTS) {
      for (let s = 0; s < 12; s += 1) {
        const seed = `sweep:${assessment}:${s}`;
        const plan = buildTestPlan(questions, { assessment, seed });
        for (const sec of plan.sections) {
          const target = sec.section === 'Math' ? 22 : 27;
          const mods = [sec.module1, sec.upper, sec.lower];
          for (const mod of mods) {
            if (mod.questions.length !== target) failures.push(`${seed} ${sec.section} len ${mod.questions.length}`);
            if (new Set(mod.questions.map((q) => q.id)).size !== mod.questions.length) failures.push(`${seed} duplicate id`);
          }
          const ids = mods.flatMap((m) => m.questions.map((q) => q.id));
          if (new Set(ids).size !== ids.length) failures.push(`${seed} ${sec.section} cross-module duplicate`);
          if (avg(sec.upper.questions) < avg(sec.lower.questions)) {
            failures.push(`${seed} ${sec.section} upper easier than lower (${avg(sec.upper.questions).toFixed(2)} < ${avg(sec.lower.questions).toFixed(2)})`);
          }
          const hardUp = sec.upper.questions.filter((q) => q.difficulty === 'Hard').length;
          const hardLow = sec.lower.questions.filter((q) => q.difficulty === 'Hard').length;
          if (hardUp < hardLow) failures.push(`${seed} ${sec.section} upper hard ${hardUp} < lower ${hardLow}`);
          if (assessment === 'PSAT 8/9' && mods.some((m) => m.questions.some((q) => q.difficulty === 'Hard'))) {
            failures.push(`${seed} PSAT 8/9 hard item`);
          }
          if (assessment === 'SAT' && sec.section === 'Math') {
            if (hardUp < 2) failures.push(`${seed} SAT math upper hard ${hardUp}`);
          }
          if (sec.section === 'Math') {
            const domains = new Set(sec.module1.questions.map((q) => q.domain));
            if (!domains.has('Algebra') || !domains.has('Advanced Math')) failures.push(`${seed} math domains ${[...domains]}`);
          }
        }
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  });
});
