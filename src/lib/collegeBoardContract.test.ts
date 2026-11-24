import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import {
  buildTestPlan,
  questionTaskFamilyKey,
  RW_DOMAIN_ORDER,
} from './examEngine';
import type { Difficulty, Question, QuestionBank, Section } from './types';

const integrationEnabled =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.COLLEGE_BOARD_INTEGRATION === '1';
const officialPath = 'public/collegeBoardBank.json';
const curated = bankJson as unknown as QuestionBank;
const RANK: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };
const RW_TARGET: Record<string, number> = {
  'Craft and Structure': 7,
  'Information and Ideas': 6,
  'Standard English Conventions': 6,
  'Expression of Ideas': 6,
};
const MATH_TARGET: Record<string, number> = {
  Algebra: 7,
  'Advanced Math': 7,
  'Problem-Solving and Data Analysis': 3,
  'Geometry and Trigonometry': 3,
};
const RW_SKILL_RANK: Record<string, number> = {
  'Words in Context': 0,
  'Text Structure and Purpose': 1,
  'Cross-Text Connections': 2,
  'Central Ideas and Details': 3,
  'Command of Evidence': 4,
  'Command of Evidence (Textual)': 4,
  'Command of Evidence (Quantitative)': 4,
  Inferences: 5,
  Boundaries: 6,
  'Form, Structure, and Sense': 7,
  Transitions: 8,
  'Rhetorical Synthesis': 9,
};
const RW_SKILL_DOMAINS = new Set([
  'Craft and Structure',
  'Information and Ideas',
  'Expression of Ideas',
]);

let official: QuestionBank;
let combined: Question[];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function operational(module: { questions: Question[]; unscoredQuestionIds: string[] }) {
  const unscored = new Set(module.unscoredQuestionIds);
  return module.questions.filter((q) => !unscored.has(q.id));
}

function normalize(text: string): string {
  return text
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function templateKey(q: Question): string {
  return `${q.section}|${normalize(q.stimulus ?? '')}|${normalize(q.prompt)}`;
}

function validateModule(
  seed: string,
  label: string,
  section: Section,
  module: { questions: Question[]; unscoredQuestionIds: string[] },
  tier: string
): void {
  const expectedTotal = section === 'Math' ? 22 : 27;
  const expectedOperational = section === 'Math' ? 20 : 25;
  const expectedDomains = section === 'Math' ? MATH_TARGET : RW_TARGET;
  assert(module.questions.length === expectedTotal, `${seed} ${label} length ${module.questions.length}`);
  assert(
    module.unscoredQuestionIds.length === 2,
    `${seed} ${label} pretest ${module.unscoredQuestionIds.length}`
  );
  const scored = operational(module);
  assert(
    scored.length === expectedOperational,
    `${seed} ${label} operational ${scored.length}`
  );

  const counts: Record<string, number> = {};
  for (const q of scored) counts[q.domain] = (counts[q.domain] ?? 0) + 1;
  for (const [domain, count] of Object.entries(expectedDomains)) {
    assert((counts[domain] ?? 0) === count, `${seed} ${label} ${domain} ${counts[domain] ?? 0}`);
  }

  const bands = new Set(module.questions.map((q) => q.difficulty));
  if (tier === 'module1') {
    assert(
      bands.has('Easy') && bands.has('Medium') && bands.has('Hard'),
      `${seed} ${label} module 1 missing difficulty band (${[...bands].join('/')})`
    );
  } else {
    assert(
      bands.has('Easy') && bands.has('Medium') && bands.has('Hard'),
      `${seed} ${label} ${tier} missing difficulty band (${[...bands].join('/')})`
    );
  }

  if (section === 'Reading and Writing') {
    const positions = module.questions.map((q) => RW_DOMAIN_ORDER[q.domain] ?? 1);
    for (let i = 1; i < positions.length; i += 1) {
      assert(
        positions[i] >= positions[i - 1],
        `${seed} ${label} R&W domain order ${positions.join(',')}`
      );
    }
    assert(positions[0] === 0, `${seed} ${label} does not start with C&S`);
    assert(positions[positions.length - 1] === 3, `${seed} ${label} does not end with EoI`);

    const sec = module.questions.filter((q) => q.domain === 'Standard English Conventions');
    for (let i = 1; i < sec.length; i += 1) {
      assert(
        RANK[sec[i].difficulty] >= RANK[sec[i - 1].difficulty],
        `${seed} ${label} SEC difficulty regression`
      );
    }

    for (const domain of RW_SKILL_DOMAINS) {
      const own = module.questions.filter((q) => q.domain === domain);
      for (let i = 1; i < own.length; i += 1) {
        const previousRank = RW_SKILL_RANK[own[i - 1].skill] ?? 99;
        const rank = RW_SKILL_RANK[own[i].skill] ?? 99;
        assert(
          rank >= previousRank,
          `${seed} ${label} ${domain} skill group regression (${own[i - 1].skill} -> ${own[i].skill})`
        );
        if (rank === previousRank) {
          assert(
            RANK[own[i].difficulty] >= RANK[own[i - 1].difficulty],
            `${seed} ${label} ${domain}/${own[i].skill} difficulty regression`
          );
        }
      }
    }
  } else {
    for (let i = 1; i < module.questions.length; i += 1) {
      assert(
        RANK[module.questions[i].difficulty] >= RANK[module.questions[i - 1].difficulty],
        `${seed} ${label} Math difficulty regression`
      );
    }
    const domains = new Set(scored.map((q) => q.domain));
    for (const domain of Object.keys(MATH_TARGET)) {
      assert(domains.has(domain), `${seed} ${label} Math missing ${domain}`);
    }
    const sprCount = scored.filter((q) => q.format === 'spr').length;
    assert(
      sprCount >= 4 && sprCount <= 7,
      `${seed} ${label} Math grid-in count ${sprCount} is outside the operational mix`
    );
  }

  const contentKeys = new Set<string>();
  const stimuli = new Set<string>();
  const templates = new Set<string>();
  const families = new Map<string, number>();
  for (const q of module.questions) {
    const content = `${q.section}|${q.stimulus ?? q.prompt}|${JSON.stringify(q.figure_metadata)}`;
    assert(!contentKeys.has(content), `${seed} ${label} duplicate content ${q.id}`);
    contentKeys.add(content);
    if (q.stimulus?.trim()) {
      assert(!stimuli.has(q.stimulus), `${seed} ${label} duplicate stimulus ${q.id}`);
      stimuli.add(q.stimulus);
    }
    const template = templateKey(q);
    assert(!templates.has(template), `${seed} ${label} duplicate template ${q.id}`);
    templates.add(template);
    const family = questionTaskFamilyKey(q);
    families.set(family, (families.get(family) ?? 0) + 1);
    assert((families.get(family) ?? 0) <= 1, `${seed} ${label} task family repeated ${q.id}`);
  }
}

function validatePath(seed: string, path: Question[], label: string): void {
  const contentKeys = new Set<string>();
  const stimuli = new Set<string>();
  const templates = new Set<string>();
  const families = new Map<string, number>();
  for (const q of path) {
    const content = `${q.section}|${q.stimulus ?? q.prompt}|${JSON.stringify(q.figure_metadata)}`;
    assert(!contentKeys.has(content), `${seed} ${label} repeated content ${q.id}`);
    contentKeys.add(content);
    if (q.stimulus?.trim()) {
      assert(!stimuli.has(q.stimulus), `${seed} ${label} repeated stimulus ${q.id}`);
      stimuli.add(q.stimulus);
    }
    const template = templateKey(q);
    assert(!templates.has(template), `${seed} ${label} repeated template ${q.id}`);
    templates.add(template);
    const family = questionTaskFamilyKey(q);
    families.set(family, (families.get(family) ?? 0) + 1);
    assert((families.get(family) ?? 0) <= 2, `${seed} ${label} task family repeated >2 ${q.id}`);
  }
}

describe.skipIf(!integrationEnabled)('combined official + curated full-test contract', () => {
  beforeAll(() => {
    assert(existsSync(officialPath), `missing ${officialPath}`);
    official = JSON.parse(readFileSync(officialPath, 'utf8')) as QuestionBank;
    combined = [...curated.questions, ...official.questions];
  });

  it('holds every v2 clause with official rows selected', () => {
    let totalOfficial = 0;
    let totalOfficialSpr = 0;
    const seeds = Array.from({ length: 10 }, (_, index) => `contract:${index}`);
    let officialLongest = 0;
    let officialMc = 0;
    for (const seed of seeds) {
      const plan = buildTestPlan(combined, { assessment: 'SAT', seed });
      assert(plan.sections.length === 2, `${seed} sections`);
      for (const section of plan.sections) {
        const mods = [section.module1, section.upper, section.lower];
        for (const mod of mods) {
          validateModule(seed, section.section, section.section, mod, mod.tier);
          const tier2Count = mod.questions.filter((q) => q.source_id !== 'collegeboard-sat').length;
          assert(
            tier2Count <= Math.floor(mod.questions.length * 0.2),
            `${seed} ${section.section} Tier 2 filler exceeds 20% (${tier2Count}/${mod.questions.length})`
          );
          for (const q of mod.questions) {
            if (q.source_id === 'collegeboard-sat') {
              totalOfficial += 1;
              assert(!q.in_practice_test && !q.unusable, `${seed} invalid official row ${q.id}`);
              if (q.format === 'spr') totalOfficialSpr += 1;
              if (q.format === 'multiple_choice') {
                officialMc += 1;
                const lengths = (q.choices ?? []).map((choice) => choice.text.length);
                const correctLength = q.choices?.find((choice) => choice.id === q.correct_answer)?.text.length;
                if (
                  correctLength !== undefined &&
                  correctLength > Math.max(...lengths.filter((_, index) => q.choices?.[index].id !== q.correct_answer))
                ) {
                  officialLongest += 1;
                }
              }
            }
          }
        }
        // Tier 1 official rows fill the module; Tier 2 is only fallback.
        const sourceCounts = new Map<string, number>();
        for (const mod of mods) {
          for (const q of mod.questions) {
            sourceCounts.set(q.source_id, (sourceCounts.get(q.source_id) ?? 0) + 1);
          }
        }
        assert((sourceCounts.get('collegeboard-sat') ?? 0) > 0, `${seed} ${section.section} no official rows`);
        const fallbackWarnings = plan.warnings.filter((warning) =>
          /blueprint shortfall|no .* candidate/i.test(warning)
        );
        assert(
          fallbackWarnings.length === 0,
          `${seed} ${section.section} silent difficulty fallback: ${fallbackWarnings.join(' || ')}`
        );

        const hard = (mod: { questions: Question[] }) =>
          mod.questions.filter((q) => q.difficulty === 'Hard').length;
        const easy = (mod: { questions: Question[] }) =>
          mod.questions.filter((q) => q.difficulty === 'Easy').length;
        assert(hard(section.upper) >= hard(section.lower), `${seed} ${section.section} upper is not harder than lower`);
        assert(easy(section.lower) >= easy(section.upper), `${seed} ${section.section} lower is not easier than upper`);

        for (const branch of [section.upper, section.lower]) {
          validatePath(
            seed,
            [...section.module1.questions, ...branch.questions],
            `${section.section}:${branch.tier}`
          );
        }
      }
    }
    // This is a measured design cue, not a selection input: the engine never
    // looks at choice length, so record its prevalence in the selected set.
    console.log(
      `official longest-choice cue: ${officialLongest}/${officialMc} (${(
        (officialLongest / Math.max(1, officialMc)) * 100
      ).toFixed(1)}%)`
    );
    expect(totalOfficial).toBeGreaterThan(100);
    expect(totalOfficialSpr).toBeGreaterThan(0);
  });
});
