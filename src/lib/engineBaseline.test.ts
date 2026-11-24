import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import { buildTestPlan, questionTaskFamilyKey, RW_DOMAIN_ORDER } from './examEngine';
import type { TestPlan } from './examEngine';
import type { Question } from './types';

/**
 * Phase 0 baseline. The legacy planner stays available so a saved attempt can
 * replay it; this harness proves which defects the v2 planner actually removes
 * instead of relying on the owner's sample of one test.
 */

const bank = (bankJson as unknown as { questions: Question[] }).questions;
const SEEDS = Array.from({ length: 12 }, (_, index) => `baseline:${index}`);
const ASSESSMENTS = ['SAT', 'PSAT/NMSQT & PSAT 10', 'PSAT 10', 'PSAT 8/9'] as const;

function familyRepeats(module: { questions: Question[] }): number {
  const counts = new Map<string, number>();
  for (const question of module.questions) {
    const key = questionTaskFamilyKey(question);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let repeats = 0;
  for (const count of counts.values()) repeats += Math.max(0, count - 1);
  return repeats;
}

function domainViolations(module: { questions: Question[] }): number {
  let previous = -1;
  let violations = 0;
  for (const question of module.questions) {
    const position = RW_DOMAIN_ORDER[question.domain] ?? 1;
    if (position < previous) violations += 1;
    previous = position;
  }
  return violations;
}

function expressionOfIdeas(plan: TestPlan): number {
  const rw = plan.sections.find((section) => section.section === 'Reading and Writing')!;
  return [...rw.module1.questions, ...rw.upper.questions].filter(
    (question) => question.domain === 'Expression of Ideas'
  ).length;
}

describe('v1 baseline vs v2', () => {
  it('removes the measured defects on the real bank', () => {
    let v1DomainViolations = 0;
    let v2FamilyRepeats = 0;
    let v2DomainViolations = 0;

    for (const assessment of ASSESSMENTS) {
      for (const seed of SEEDS) {
        const v1 = buildTestPlan(bank, { assessment, seed, algorithm: 1 });
        const v2 = buildTestPlan(bank, { assessment, seed });
        expect(v1.algorithmVersion).toBe(1);
        expect(v2.algorithmVersion).toBe(2);

        const v1Rw = v1.sections.find((section) => section.section === 'Reading and Writing')!;
        const v2Rw = v2.sections.find((section) => section.section === 'Reading and Writing')!;
        for (const module of [v1Rw.module1, v1Rw.upper, v1Rw.lower]) {
          v1DomainViolations += domainViolations(module);
        }
        for (const module of [v2Rw.module1, v2Rw.upper, v2Rw.lower]) {
          v2FamilyRepeats += familyRepeats(module);
          v2DomainViolations += domainViolations(module);
        }

        // Legacy Expression of Ideas is 7 per module = 14 per test, above the
        // official 8-12 ceiling. v2 counts 12 operational across the test.
        expect(expressionOfIdeas(v1)).toBe(14);
        expect(expressionOfIdeas(v2)).toBe(12);
      }
    }

    // v1's family keys cannot see the generated siblings (see the task-family
    // key tests); these seeds simply do not draw two of them. The plan-level
    // guarantee below is the one that matters for a student.
    console.log(
      `BASELINE v1DomainViolations=${v1DomainViolations} v2DomainViolations=${v2DomainViolations} v2FamilyRepeats=${v2FamilyRepeats}`
    );
    expect(v1DomainViolations).toBeGreaterThan(0);
    expect(v2FamilyRepeats).toBe(0);
    expect(v2DomainViolations).toBe(0);
  });
});
