import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import {
  buildTestPlan,
  questionFamilyKeys,
  questionTaskFamilyKey,
  RW_DOMAIN_ORDER,
} from './examEngine';
import type { Question } from './types';

const bank = (bankJson as unknown as { questions: Question[] }).questions;
const byId = new Map(bank.map((question) => [question.id, question]));
const RANK = { Easy: 0, Medium: 1, Hard: 2 } as const;

function get(id: string): Question {
  const question = byId.get(id);
  if (!question) throw new Error(`missing ${id}`);
  return question;
}

function planIds(plan: ReturnType<typeof buildTestPlan>): string[] {
  return plan.sections.flatMap((section) =>
    [section.module1, section.upper, section.lower].flatMap((module) =>
      module.questions.map((question) => question.id)
    )
  );
}

function operational(module: Question[], unscoredIds: string[]): Question[] {
  const unscored = new Set(unscoredIds);
  return module.filter((question) => !unscored.has(question.id));
}

describe('task family key', () => {
  it('groups all eight generated f(9) siblings', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `M13-DATA-T00${index}`);
    const keys = new Set(ids.map((id) => questionTaskFamilyKey(get(id))));
    expect(keys.size).toBe(1);
  });

  it('does not change the ordinary practice family keys', () => {
    const first = get('M13-DATA-T001');
    const second = get('M13-DATA-T004');
    // Their context sentences differ, so the old template/archetype keys miss
    // the sibling relationship. That is why full tests use the task family.
    expect(questionFamilyKeys(first).some((key) => questionFamilyKeys(second).includes(key))).toBe(
      false
    );
    expect(questionTaskFamilyKey(first)).toBe(questionTaskFamilyKey(second));
  });

  it('groups the generated T and E families', () => {
    const t = ['M13-DATA-T001', 'M13-DATA-T004', 'M13-DATA-T005'].map((id) =>
      questionTaskFamilyKey(get(id))
    );
    const e = ['M13-DATA-E005', 'M13-DATA-E006'].map((id) => questionTaskFamilyKey(get(id)));
    expect(new Set(t).size).toBe(1);
    expect(new Set(e).size).toBe(1);
  });

  it('groups the three cross-text variants by their shared passage', () => {
    expect(questionTaskFamilyKey(get('RW-INF-88807'))).toBe(
      questionTaskFamilyKey(get('RW-INF-88808'))
    );
    expect(questionTaskFamilyKey(get('RW-INF-88808'))).toBe(
      questionTaskFamilyKey(get('RW-INF-88809'))
    );
  });
});

describe('v2 full-test plan', () => {
  const plan = buildTestPlan(bank, { assessment: 'SAT', seed: 'v2:structure' });

  it('builds 25 operational plus 2 pretest, and 20 plus 2, with official quotas', () => {
    expect(plan.algorithmVersion).toBe(2);
    expect(plan.diagnostics?.algorithmVersion).toBe(2);
    for (const section of plan.sections) {
      const target = section.section === 'Math' ? 22 : 27;
      const expected = section.section === 'Math' ? 20 : 25;
      for (const module of [section.module1, section.upper, section.lower]) {
        expect(module.questions).toHaveLength(target);
        expect(module.unscoredQuestionIds).toHaveLength(2);
        expect(operational(module.questions, module.unscoredQuestionIds)).toHaveLength(expected);

        const counts: Record<string, number> = {};
        for (const question of operational(module.questions, module.unscoredQuestionIds)) {
          counts[question.domain] = (counts[question.domain] ?? 0) + 1;
        }
        expect(counts).toEqual(
          section.section === 'Math'
            ? {
                Algebra: 7,
                'Advanced Math': 7,
                'Problem-Solving and Data Analysis': 3,
                'Geometry and Trigonometry': 3,
              }
            : {
                'Craft and Structure': 7,
                'Information and Ideas': 6,
                'Standard English Conventions': 6,
                'Expression of Ideas': 6,
              }
        );
      }
    }
  });

  it('keeps R&W domains contiguous and SEC difficulty-only', () => {
    const rw = plan.sections.find((section) => section.section === 'Reading and Writing')!;
    for (const module of [rw.module1, rw.upper, rw.lower]) {
      const positions = module.questions.map((question) => RW_DOMAIN_ORDER[question.domain] ?? 1);
      for (let i = 1; i < positions.length; i += 1) {
        expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
      }
      const sec = module.questions.filter(
        (question) => question.domain === 'Standard English Conventions'
      );
      for (let i = 1; i < sec.length; i += 1) {
        expect(RANK[sec[i].difficulty]).toBeGreaterThanOrEqual(RANK[sec[i - 1].difficulty]);
      }
    }
  });

  it('keeps Math in ascending difficulty', () => {
    const math = plan.sections.find((section) => section.section === 'Math')!;
    for (const module of [math.module1, math.upper, math.lower]) {
      for (let i = 1; i < module.questions.length; i += 1) {
        expect(RANK[module.questions[i].difficulty]).toBeGreaterThanOrEqual(
          RANK[module.questions[i - 1].difficulty]
        );
      }
    }
  });

  it('never repeats a task family within a module or more than twice on a path', () => {
    for (const section of plan.sections) {
      for (const module of [section.module1, section.upper, section.lower]) {
        const counts = new Map<string, number>();
        for (const question of module.questions) {
          const key = questionTaskFamilyKey(question);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        expect(Math.max(...counts.values())).toBe(1);
      }
      for (const branch of [section.upper, section.lower]) {
        const counts = new Map<string, number>();
        for (const question of [...section.module1.questions, ...branch.questions]) {
          const key = questionTaskFamilyKey(question);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
      }
    }
  });

  it('serves the reported cross-text triad at most once on an administered path', () => {
    const triad = new Set(['RW-INF-88807', 'RW-INF-88808', 'RW-INF-88809']);
    for (const section of plan.sections) {
      for (const branch of [section.upper, section.lower]) {
        const count = [...section.module1.questions, ...branch.questions].filter((question) =>
          triad.has(question.id)
        ).length;
        expect(count).toBeLessThanOrEqual(1);
      }
    }
  });

  it('replays v1 for saved attempts and is deterministic in both versions', () => {
    const v1a = buildTestPlan(bank, { assessment: 'SAT', seed: 'resume:v1', algorithm: 1 });
    const v1b = buildTestPlan(bank, { assessment: 'SAT', seed: 'resume:v1', algorithm: 1 });
    expect(v1a.algorithmVersion).toBe(1);
    expect(planIds(v1a)).toEqual(planIds(v1b));

    const v2a = buildTestPlan(bank, { assessment: 'SAT', seed: 'resume:v2', algorithm: 2 });
    const v2b = buildTestPlan(bank, { assessment: 'SAT', seed: 'resume:v2' });
    expect(v2a.algorithmVersion).toBe(2);
    expect(planIds(v2a)).toEqual(planIds(v2b));
  });

  it('records diagnostics for every module', () => {
    expect(plan.diagnostics?.sections).toHaveLength(2);
    for (const section of plan.diagnostics?.sections ?? []) {
      expect(section.modules).toHaveLength(3);
      for (const module of section.modules) {
        expect(module.operational).toBe(section.section === 'Math' ? 20 : 25);
        expect(module.pretest).toBe(2);
        expect(module.taskFamilyRepeats).toBe(0);
        expect(module.missingDifficulties).toEqual([]);
        expect(module.missingHard).toBe(false);
        expect(Array.isArray(module.relaxations)).toBe(true);
      }
    }
  });
});

describe('v2 diagnostics', () => {
  const base = bank.find(
    (question) =>
      question.section === 'Math' &&
      question.assessments.includes('SAT') &&
      (question.stimulus ?? '').trim().length > 0
  )!;
  const finalSentence = (text: string | null): string => {
    const parts = (text ?? '')
      .trim()
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);
    return parts[parts.length - 1] ?? '';
  };
  const cloneMath = (
    index: number,
    difficulty: Question['difficulty'],
    context: string
  ): Question => ({
    ...base,
    id: `TEST-DIAGNOSTIC-${index}`,
    difficulty,
    stimulus: `${context}. ${finalSentence(base.stimulus)}`,
  });

  it('records family-cap relaxations when the supply forces them', () => {
    const constrained = Array.from({ length: 8 }, (_, index) =>
      cloneMath(index, base.difficulty, `Synthetic context ${String.fromCharCode(65 + index)}`)
    );
    expect(new Set(constrained.map(questionTaskFamilyKey)).size).toBe(1);

    const constrainedPlan = buildTestPlan(
      [...bank.filter((question) => question.section === 'Reading and Writing'), ...constrained],
      { assessment: 'SAT', seed: 'v2:diagnostics:relax', itemCap: 4 }
    );
    const math = constrainedPlan.diagnostics?.sections.find(
      (section) => section.section === 'Math'
    );
    expect(math?.modules[0].relaxations).toEqual([
      'module-family-cap',
      'plan-family-cap',
    ]);
  });

  it('records missing Hard when an allowed Hard item is blocked', () => {
    const hardDuplicate = cloneMath(3, 'Hard', 'Synthetic context Alpha');
    const pool = [
      cloneMath(0, 'Easy', 'Synthetic context Alpha'),
      cloneMath(1, 'Easy', 'Synthetic context Beta'),
      cloneMath(2, 'Medium', 'Synthetic context Gamma'),
      hardDuplicate,
    ];
    const planWithGap = buildTestPlan(
      [...bank.filter((question) => question.section === 'Reading and Writing'), ...pool],
      { assessment: 'SAT', seed: 'v2:diagnostics:missing-hard', itemCap: 4 }
    );
    const math = planWithGap.diagnostics?.sections.find(
      (section) => section.section === 'Math'
    );
    expect(math?.modules[0].missingDifficulties).toContain('Hard');
    expect(math?.modules[0].missingHard).toBe(true);
  });
});
