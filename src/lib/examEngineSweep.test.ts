import { describe, expect, it } from 'vitest';
import bank from '../data/questionBank.json';
import {
  assessmentDifficultyPolicy,
  assessmentMatches,
  buildTestPlan,
  questionTaskFamilyKey,
  RW_DOMAIN_ORDER,
} from './examEngine';
import type { Difficulty, Question } from './types';

const questions = (bank as unknown as { questions: Question[] }).questions;
const ASSESSMENTS = ['SAT', 'PSAT/NMSQT & PSAT 10', 'PSAT 10', 'PSAT 8/9'];
// The normal suite stays fast; the release check runs this file with
// ENGINE_SWEEP_SEEDS=100 to cover 400 plans.
const SEEDS = (() => {
  const raw = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.ENGINE_SWEEP_SEEDS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
})();
const rank = { Easy: 0, Medium: 1, Hard: 2 } as const;
const avg = (arr: Question[]) =>
  arr.reduce((n, q) => n + rank[q.difficulty], 0) / Math.max(1, arr.length);

const RW_OPERATIONAL: Record<string, number> = {
  'Craft and Structure': 7,
  'Information and Ideas': 6,
  'Standard English Conventions': 6,
  'Expression of Ideas': 6,
};

const MATH_OPERATIONAL: Record<string, number> = {
  Algebra: 7,
  'Advanced Math': 7,
  'Problem-Solving and Data Analysis': 3,
  'Geometry and Trigonometry': 3,
};

/** Bands the bank can supply for this section/assessment, after policy exclusions. */
function expectedDifficulties(
  section: Question['section'],
  assessment: string
): Difficulty[] {
  const policy = assessmentDifficultyPolicy(assessment);
  return (['Easy', 'Medium', 'Hard'] as Difficulty[]).filter(
    (difficulty) =>
      (difficulty !== 'Hard' || policy.hardAllowed) &&
      questions.some(
        (question) =>
          question.section === section &&
          assessmentMatches(question, assessment) &&
          question.difficulty === difficulty
      )
  );
}

const SKILL_RANK: Record<string, number> = {
  'Words in Context': 0,
  'Text Structure and Purpose': 1,
  'Cross-Text Connections': 2,
  'Central Ideas and Details': 3,
  'Command of Evidence (Textual)': 4,
  'Command of Evidence (Quantitative)': 4,
  Inferences: 5,
  Boundaries: 6,
  'Form, Structure, and Sense': 7,
  Transitions: 8,
  'Rhetorical Synthesis': 9,
};

function operational(module: Question[], unscoredIds: string[]): Question[] {
  const unscored = new Set(unscoredIds);
  return module.filter((question) => !unscored.has(question.id));
}

describe('adaptive blueprint sweep', () => {
  it('keeps every v2 blueprint sound across seeds and assessments', () => {
    const failures: string[] = [];
    const fail = (message: string) => failures.push(message);

    for (const assessment of ASSESSMENTS) {
      for (let s = 0; s < SEEDS; s += 1) {
        const seed = `sweep:${assessment}:${s}`;
        const plan = buildTestPlan(questions, { assessment, seed });
        if (plan.algorithmVersion !== 2) fail(`${seed} algorithm ${plan.algorithmVersion}`);

        for (const sec of plan.sections) {
          const target = sec.section === 'Math' ? 22 : 27;
          const operationalTarget = sec.section === 'Math' ? 20 : 25;
          const expectedDomains =
            sec.section === 'Math' ? MATH_OPERATIONAL : RW_OPERATIONAL;
          const mods = [sec.module1, sec.upper, sec.lower];
          const sectionDiagnostics = plan.diagnostics?.sections.find(
            (diagnostics) => diagnostics.section === sec.section
          );
          if (!sectionDiagnostics) fail(`${seed} ${sec.section} diagnostics missing`);
          const expected = expectedDifficulties(sec.section, assessment);

          for (const mod of mods) {
            const label = `${seed} ${sec.section} ${mod.tier}`;
            if (mod.questions.length !== target) {
              fail(`${label} len ${mod.questions.length}`);
            }
            if (mod.unscoredQuestionIds.length !== 2) {
              fail(`${label} pretest ${mod.unscoredQuestionIds.length}`);
            }
            const ordered = operational(mod.questions, mod.unscoredQuestionIds);
            if (ordered.length !== operationalTarget) {
              fail(`${label} operational ${ordered.length}`);
            }

            // Every pretest id belongs to the module and is unique.
            const ids = new Set(mod.questions.map((q) => q.id));
            for (const id of mod.unscoredQuestionIds) {
              if (!ids.has(id)) fail(`${label} pretest ${id} missing`);
            }
            if (new Set(mod.unscoredQuestionIds).size !== mod.unscoredQuestionIds.length) {
              fail(`${label} duplicate pretest id`);
            }
            if (new Set(mod.questions.map((q) => q.id)).size !== mod.questions.length) {
              fail(`${label} duplicate id`);
            }

            // Every band the bank can supply must appear in the administered module.
            const presentDifficulties = new Set(mod.questions.map((q) => q.difficulty));
            for (const difficulty of expected) {
              if (!presentDifficulties.has(difficulty)) {
                fail(`${label} missing ${difficulty} (bank allows)`);
              }
            }
            const moduleDiagnostics = sectionDiagnostics?.modules.find(
              (diagnostics) => diagnostics.tier === mod.tier
            );
            if (!moduleDiagnostics) {
              fail(`${label} diagnostics missing`);
            } else {
              if (moduleDiagnostics.missingDifficulties.length > 0) {
                fail(
                  `${label} diagnostics missing ${moduleDiagnostics.missingDifficulties.join(',')}`
                );
              }
              if (moduleDiagnostics.missingHard) fail(`${label} diagnostics missingHard`);
              if (!Array.isArray(moduleDiagnostics.relaxations)) {
                fail(`${label} diagnostics relaxations missing`);
              }
            }

            // Operational domain quotas are the official per-module targets.
            const domainCounts: Record<string, number> = {};
            for (const q of ordered) domainCounts[q.domain] = (domainCounts[q.domain] ?? 0) + 1;
            for (const [domain, count] of Object.entries(expectedDomains)) {
              if ((domainCounts[domain] ?? 0) !== count) {
                fail(`${label} ${domain} ${domainCounts[domain] ?? 0}/${count}`);
              }
            }

            // One member of a task family per module, including pretest items.
            const families = new Map<string, number>();
            for (const q of mod.questions) {
              const key = questionTaskFamilyKey(q);
              families.set(key, (families.get(key) ?? 0) + 1);
            }
            for (const count of families.values()) {
              if (count > 1) {
                fail(`${label} task family repeated ${count}`);
                break;
              }
            }

            if (sec.section === 'Reading and Writing') {
              // Strict domain blocks, no jitter.
              let lastDomain = -1;
              for (const q of mod.questions) {
                const position = RW_DOMAIN_ORDER[q.domain] ?? 1;
                if (position < lastDomain) fail(`${label} domain order regressed`);
                lastDomain = position;
              }
              // SEC is difficulty-only.
              const secItems = mod.questions.filter(
                (q) => q.domain === 'Standard English Conventions'
              );
              for (let i = 1; i < secItems.length; i += 1) {
                if (rank[secItems[i].difficulty] < rank[secItems[i - 1].difficulty]) {
                  fail(`${label} SEC difficulty regressed`);
                  break;
                }
              }
              // The other domains keep skill groups and ascend within each group.
              for (const domain of [
                'Craft and Structure',
                'Information and Ideas',
                'Expression of Ideas',
              ]) {
                const own = mod.questions.filter((q) => q.domain === domain);
                for (let i = 1; i < own.length; i += 1) {
                  const previous = SKILL_RANK[own[i - 1].skill] ?? 99;
                  const current = SKILL_RANK[own[i].skill] ?? 99;
                  if (current < previous) {
                    fail(`${label} ${domain} skill order regressed`);
                    break;
                  }
                  if (
                    current === previous &&
                    rank[own[i].difficulty] < rank[own[i - 1].difficulty]
                  ) {
                    fail(`${label} ${domain} ${own[i].skill} difficulty regressed`);
                    break;
                  }
                }
              }
            } else {
              for (let i = 1; i < mod.questions.length; i += 1) {
                if (rank[mod.questions[i].difficulty] < rank[mod.questions[i - 1].difficulty]) {
                  fail(`${label} math difficulty regressed`);
                  break;
                }
              }
            }
          }

          const m1Ids = new Set(sec.module1.questions.map((q) => q.id));
          for (const branch of [sec.upper, sec.lower]) {
            if (branch.questions.some((q) => m1Ids.has(q.id))) {
              fail(`${seed} ${sec.section} module1/branch overlap`);
            }
            const pathFamilies = new Map<string, number>();
            for (const q of [...sec.module1.questions, ...branch.questions]) {
              const key = questionTaskFamilyKey(q);
              pathFamilies.set(key, (pathFamilies.get(key) ?? 0) + 1);
            }
            for (const count of pathFamilies.values()) {
              if (count > 2) {
                fail(`${seed} ${sec.section} path family repeated ${count}`);
                break;
              }
            }
          }

          if (avg(sec.upper.questions) < avg(sec.lower.questions)) {
            fail(
              `${seed} ${sec.section} upper easier than lower (${avg(sec.upper.questions).toFixed(
                2
              )} < ${avg(sec.lower.questions).toFixed(2)})`
            );
          }
          const hardUp = sec.upper.questions.filter((q) => q.difficulty === 'Hard').length;
          const hardLow = sec.lower.questions.filter((q) => q.difficulty === 'Hard').length;
          if (hardUp < hardLow) fail(`${seed} ${sec.section} upper hard ${hardUp} < lower ${hardLow}`);
          if (
            assessment === 'PSAT 8/9' &&
            mods.some((m) => m.questions.some((q) => q.difficulty === 'Hard'))
          ) {
            fail(`${seed} PSAT 8/9 hard item`);
          }
          if (assessment === 'SAT' && sec.section === 'Math' && hardUp < 2) {
            fail(`${seed} SAT math upper hard ${hardUp}`);
          }
          if (sec.section === 'Math') {
            const domains = new Set(sec.module1.questions.map((q) => q.domain));
            if (!domains.has('Algebra') || !domains.has('Advanced Math')) {
              fail(`${seed} math domains ${[...domains]}`);
            }
          }
        }
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  });
});
