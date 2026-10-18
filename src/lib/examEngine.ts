import type {
  Assessment,
  Difficulty,
  Question,
  QuestionProgress,
  Section,
  TestModuleResult,
} from './types';

/**
 * Official Digital SAT Suite Test Specifications & Timing:
 * - Total Duration: 134 minutes (plus a 10-minute break between sections).
 * - Total Questions: 98 items (92 operational items used for scoring +
 *   6 unscored experimental/pretest items randomly distributed: 2 per R&W module,
 *   1 per Math module).
 * - Section 1: Reading & Writing — 54 items, 64 min (Module 1: 27 Qs / 32 min, Module 2: 27 Qs / 32 min)
 * - Section 2: Math — 44 items, 70 min (Module 1: 22 Qs / 35 min, Module 2: 22 Qs / 35 min)
 */
export const SECTION_SPECS: Record<
  Section,
  { fullItems: number; fullMinutes: number; operationalItems: number; unscoredItems: number }
> = {
  'Reading and Writing': { fullItems: 27, fullMinutes: 32, operationalItems: 25, unscoredItems: 2 },
  Math: { fullItems: 22, fullMinutes: 35, operationalItems: 21, unscoredItems: 1 },
};

export const SECTION_BREAK_MINUTES = 10;

export const SECTION_ORDER: Section[] = ['Reading and Writing', 'Math'];

/** Fraction of module-1 items a student must answer correctly to be routed up. */
export const ROUTING_THRESHOLD = 0.6;

const DIFFICULTY_WEIGHT: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = items.slice();
  let state = hashSeed(seed) || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export type ModuleTier = 'module1' | 'upper' | 'lower';

export interface ModulePlan {
  id: string;
  section: Section;
  tier: ModuleTier;
  questions: Question[];
  /** IDs of the unscored experimental/pretest items in this module (2 in R&W, 1 in Math). */
  unscoredQuestionIds: string[];
  targetItems: number;
  minutes: number;
}

export interface SectionPlan {
  section: Section;
  module1: ModulePlan;
  upper: ModulePlan;
  lower: ModulePlan;
  availableItems: number;
  targetItems: number;
}

export interface TestPlan {
  assessment: string;
  createdAt: string;
  sections: SectionPlan[];
  warnings: string[];
  seed: string;
  breakMinutes: number;
}

export interface TestPlanOptions {
  assessment: Assessment | string;
  excludeReleasedPracticeSet?: boolean;
  /** Maximum items per module; defaults to the real full-length module size (27 R&W / 22 Math). */
  itemCap?: number;
  seed?: string;
}

/**
 * Target difficulty mix by tier:
 * - Module 1 (Routing): 30% Easy, 40% Medium, 30% Hard
 * - Module 2 Lower (Easy/Medium): ~55% Easy, ~35% Medium, ~10% Hard
 * - Module 2 Upper (Medium/Hard): ~10% Easy, ~45% Medium, ~45% Hard
 */
function tierDifficultyOrder(tier: ModuleTier, index: number, total: number): Difficulty[] {
  const ratio = total <= 1 ? 0.5 : index / (total - 1);
  if (tier === 'module1') {
    if (ratio < 0.3) return ['Easy', 'Medium', 'Hard'];
    if (ratio < 0.7) return ['Medium', 'Easy', 'Hard'];
    return ['Hard', 'Medium', 'Easy'];
  }
  if (tier === 'lower') {
    if (ratio < 0.55) return ['Easy', 'Medium', 'Hard'];
    if (ratio < 0.9) return ['Medium', 'Easy', 'Hard'];
    return ['Hard', 'Medium', 'Easy'];
  }
  // upper
  if (ratio < 0.12) return ['Easy', 'Medium', 'Hard'];
  if (ratio < 0.52) return ['Medium', 'Hard', 'Easy'];
  return ['Hard', 'Medium', 'Easy'];
}

function takeMatching(
  pool: Question[],
  used: Set<string>,
  predicate: (q: Question) => boolean,
  preferredDiffs: Difficulty[]
): Question | null {
  for (const diff of preferredDiffs) {
    const found = pool.find((q) => !used.has(q.id) && q.difficulty === diff && predicate(q));
    if (found) {
      used.add(found.id);
      return found;
    }
  }
  const fallback = pool.find((q) => !used.has(q.id) && predicate(q));
  if (fallback) {
    used.add(fallback.id);
    return fallback;
  }
  return null;
}

/**
 * Exact 27-item Reading & Writing Module Blueprint:
 * Domain 1: Craft and Structure (Items 1-7)
 *   - Items 1-4: Words in Context (4)
 *   - Items 5-6: Text Structure and Purpose (2)
 *   - Item 7:    Cross-Text Connections (1)
 * Domain 2: Information and Ideas (Items 8-13)
 *   - Items 8-10:  Central Ideas and Details (3)
 *   - Items 11-12: Command of Evidence (Textual or Quantitative) (2)
 *   - Item 13:     Inferences (1)
 * Domain 3: Standard English Conventions (Items 14-20)
 *   - Items 14-17: Boundaries (4)
 *   - Items 18-20: Form, Structure, and Sense (3)
 * Domain 4: Expression of Ideas (Items 21-27)
 *   - Items 21-23: Transitions (3)
 *   - Items 24-27: Rhetorical Synthesis (4)
 *
 * Within each discrete domain subset, difficulty scales linearly from easier to
 * harder, resetting when transitioning to the next domain.
 */
interface RwSlotSpec {
  domain: string;
  skillMatch: (skill: string) => boolean;
  count: number;
}

const RW_BLUEPRINT_SLOTS: RwSlotSpec[] = [
  { domain: 'Craft and Structure', skillMatch: (s) => s === 'Words in Context', count: 4 },
  { domain: 'Craft and Structure', skillMatch: (s) => s === 'Text Structure and Purpose', count: 2 },
  { domain: 'Craft and Structure', skillMatch: (s) => s === 'Cross-Text Connections', count: 1 },
  { domain: 'Information and Ideas', skillMatch: (s) => s === 'Central Ideas and Details', count: 3 },
  {
    domain: 'Information and Ideas',
    skillMatch: (s) => s.startsWith('Command of Evidence'),
    count: 2,
  },
  { domain: 'Information and Ideas', skillMatch: (s) => s === 'Inferences', count: 1 },
  { domain: 'Standard English Conventions', skillMatch: (s) => s === 'Boundaries', count: 4 },
  {
    domain: 'Standard English Conventions',
    skillMatch: (s) => s === 'Form, Structure, and Sense',
    count: 3,
  },
  { domain: 'Expression of Ideas', skillMatch: (s) => s === 'Transitions', count: 3 },
  { domain: 'Expression of Ideas', skillMatch: (s) => s === 'Rhetorical Synthesis', count: 4 },
];

const RW_DOMAIN_SEQUENCE = [
  'Craft and Structure',
  'Information and Ideas',
  'Standard English Conventions',
  'Expression of Ideas',
] as const;

const RW_SKILL_RANK: Record<string, number> = {
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

function buildRwModuleQuestions(
  pool: Question[],
  used: Set<string>,
  tier: ModuleTier,
  target: number
): Question[] {
  if (target < 27) {
    // Scaled-down module when an explicit small itemCap is passed in unit tests
    const picked: Question[] = [];
    for (let i = 0; i < target; i += 1) {
      const prefs = tierDifficultyOrder(tier, i, target);
      const q = takeMatching(pool, used, () => true, prefs);
      if (q) picked.push(q);
    }
    return orderModuleQuestions(picked, 'Reading and Writing');
  }

  // Group slots by domain so we can assign intra-domain difficulty curves
  const byDomain = new Map<string, RwSlotSpec[]>();
  for (const slot of RW_BLUEPRINT_SLOTS) {
    const list = byDomain.get(slot.domain) ?? [];
    list.push(slot);
    byDomain.set(slot.domain, list);
  }

  const result: Question[] = [];
  for (const domain of RW_DOMAIN_SEQUENCE) {
    const slots = byDomain.get(domain) ?? [];
    const domainTotal = slots.reduce((acc, s) => acc + s.count, 0);
    const domainPicked: Question[] = [];
    let idxInDomain = 0;

    for (const slot of slots) {
      const slotItems: Question[] = [];
      for (let k = 0; k < slot.count; k += 1) {
        const prefs = tierDifficultyOrder(tier, idxInDomain, domainTotal);
        idxInDomain += 1;
        // First try exact domain + skill, then any skill Match, then same domain, then any R&W item
        const item =
          takeMatching(pool, used, (q) => q.domain === slot.domain && slot.skillMatch(q.skill), prefs) ??
          takeMatching(pool, used, (q) => slot.skillMatch(q.skill), prefs) ??
          takeMatching(pool, used, (q) => q.domain === slot.domain, prefs) ??
          takeMatching(pool, used, () => true, prefs);
        if (item) {
          // Ensure the item carries the canonical blueprint domain for this slot
          slotItems.push(item.domain === slot.domain ? item : { ...item, domain: slot.domain });
        }
      }
      domainPicked.push(...slotItems);
    }

    // Within each discrete domain subset, sort by ascending difficulty while preserving
    // the exact skill sequence (Items 1-4 WIC, 5-6 TSP, 7 CTC, etc.)
    const orderedDomain = domainPicked
      .map((q, idx) => ({ q, idx }))
      .sort((a, b) => {
        const skA = RW_SKILL_RANK[a.q.skill] ?? 99;
        const skB = RW_SKILL_RANK[b.q.skill] ?? 99;
        if (skA !== skB) return skA - skB;
        const dA = DIFFICULTY_WEIGHT[a.q.difficulty] ?? 1;
        const dB = DIFFICULTY_WEIGHT[b.q.difficulty] ?? 1;
        if (dA !== dB) return dA - dB;
        return a.idx - b.idx;
      })
      .map(({ q }) => q);

    result.push(...orderedDomain);
  }

  return result;
}

/**
 * Exact 22-item Math Module Blueprint:
 * 1. Content Distribution Matrix:
 *    - Algebra (~35% / 8 items)
 *    - Advanced Math (~35% / 7 items)
 *    - Problem-Solving and Data Analysis (~15% / 4 items)
 *    - Geometry and Trigonometry (~15% / 3 items; trigonometry excluded on PSAT 8/9)
 * 2. Format Intermingling:
 *    - ~75% Multiple-Choice (16–17 items) and ~25% SPR (5–6 items), intermixed across the module.
 * 3. Linear Difficulty Curve:
 *    - Items 1 through 22 arranged in a single continuous progression of ascending
 *      difficulty (Easy -> Medium -> Hard) with no format-based or domain-based reset.
 */
const MATH_DOMAIN_QUOTAS: { domain: string; count: number }[] = [
  { domain: 'Algebra', count: 8 },
  { domain: 'Advanced Math', count: 7 },
  { domain: 'Problem-Solving and Data Analysis', count: 4 },
  { domain: 'Geometry and Trigonometry', count: 3 },
];

const TARGET_MATH_SPR_COUNT = 5; // ~23-25% of 22 (17 MC + 5 SPR)

function isTrigQuestion(q: Question): boolean {
  const s = `${q.skill} ${q.prompt} ${q.stimulus ?? ''}`.toLowerCase();
  return (
    s.includes('trigonometr') ||
    s.includes('\\sin') ||
    s.includes('\\cos') ||
    s.includes('\\tan') ||
    s.includes('sine') ||
    s.includes('cosine')
  );
}

function buildMathModuleQuestions(
  pool: Question[],
  used: Set<string>,
  tier: ModuleTier,
  target: number,
  assessment: string
): Question[] {
  const filteredPool =
    assessment === 'PSAT 8/9' ? pool.filter((q) => !isTrigQuestion(q)) : pool;

  if (target < 22) {
    const picked: Question[] = [];
    for (let i = 0; i < target; i += 1) {
      const prefs = tierDifficultyOrder(tier, i, target);
      const q = takeMatching(filteredPool, used, () => true, prefs);
      if (q) picked.push(q);
    }
    return orderModuleQuestions(picked, 'Math');
  }

  // Target difficulty counts for the 22-question module:
  // Module 1: 30% Easy (7), 40% Medium (9), 30% Hard (6) = 22
  // Lower:    12 Easy, 8 Medium, 2 Hard = 22
  // Upper:    2 Easy, 10 Medium, 10 Hard = 22
  const diffTargets: Record<Difficulty, number> =
    tier === 'module1'
      ? { Easy: 7, Medium: 9, Hard: 6 }
      : tier === 'lower'
      ? { Easy: 12, Medium: 8, Hard: 2 }
      : { Easy: 2, Medium: 10, Hard: 10 };

  const diffRemaining: Record<Difficulty, number> = { ...diffTargets };
  let sprRemaining = TARGET_MATH_SPR_COUNT;
  let mcRemaining = target - TARGET_MATH_SPR_COUNT;

  const picked: Question[] = [];

  for (const { domain, count } of MATH_DOMAIN_QUOTAS) {
    for (let i = 0; i < count; i += 1) {
      // Decide desired format for this pick to keep ~75% MC / ~25% SPR balanced across domains
      const wantSpr = sprRemaining > 0 && (i % 4 === 1 || mcRemaining <= 0);
      const desiredFormat = wantSpr ? 'spr' : 'multiple_choice';

      // Order difficulties by which bucket still needs the most items
      const sortedDiffs = (['Easy', 'Medium', 'Hard'] as Difficulty[]).sort(
        (a, b) => diffRemaining[b] - diffRemaining[a]
      );

      const q =
        takeMatching(
          filteredPool,
          used,
          (item) => item.domain === domain && item.format === desiredFormat,
          sortedDiffs
        ) ??
        takeMatching(filteredPool, used, (item) => item.domain === domain, sortedDiffs) ??
        takeMatching(filteredPool, used, () => true, sortedDiffs);

      if (q) {
        picked.push(q);
        diffRemaining[q.difficulty] = Math.max(0, diffRemaining[q.difficulty] - 1);
        if (q.format === 'spr') sprRemaining = Math.max(0, sprRemaining - 1);
        else mcRemaining = Math.max(0, mcRemaining - 1);
      }
    }
  }

  return orderModuleQuestions(picked, 'Math');
}

function pickUnscoredIds(questions: Question[], count: number, seed: string): string[] {
  if (questions.length <= count) return [];
  const shuffled = seededShuffle(questions, `${seed}:unscored`);
  return shuffled.slice(0, count).map((q) => q.id);
}

function buildModulePlan(
  section: Section,
  tier: ModuleTier,
  questions: Question[],
  targetItems: number,
  minutes: number,
  seed: string
): ModulePlan {
  const spec = SECTION_SPECS[section];
  const unscoredCount = questions.length >= spec.fullItems ? spec.unscoredItems : 0;
  return {
    id: `${section === 'Math' ? 'math' : 'rw'}-${tier}`,
    section,
    tier,
    questions,
    unscoredQuestionIds: pickUnscoredIds(questions, unscoredCount, `${seed}:${section}:${tier}`),
    targetItems,
    minutes,
  };
}

export function buildTestPlan(all: Question[], options: TestPlanOptions): TestPlan {
  const seed = options.seed ?? 'hdsat-test';
  const warnings: string[] = [];
  const sections: SectionPlan[] = [];
  const assessmentStr = String(options.assessment);

  for (const section of SECTION_ORDER) {
    const spec = SECTION_SPECS[section];
    const target = Math.max(4, Math.min(spec.fullItems, options.itemCap ?? spec.fullItems));
    const pool = seededShuffle(
      all.filter(
        (q) =>
          q.section === section &&
          q.assessments.includes(assessmentStr) &&
          !(options.excludeReleasedPracticeSet && q.is_released_practice_set) &&
          !(assessmentStr === 'PSAT 8/9' && section === 'Math' && isTrigQuestion(q))
      ),
      `${seed}:${section}`
    );

    const usedM1 = new Set<string>();
    const module1 =
      section === 'Reading and Writing'
        ? buildRwModuleQuestions(pool, usedM1, 'module1', target)
        : buildMathModuleQuestions(pool, usedM1, 'module1', target, assessmentStr);

    const usedUpper = new Set<string>(usedM1);
    const upper =
      section === 'Reading and Writing'
        ? buildRwModuleQuestions(pool, usedUpper, 'upper', target)
        : buildMathModuleQuestions(pool, usedUpper, 'upper', target, assessmentStr);

    const usedLower = new Set<string>(usedUpper);
    const lower =
      section === 'Reading and Writing'
        ? buildRwModuleQuestions(pool, usedLower, 'lower', target)
        : buildMathModuleQuestions(pool, usedLower, 'lower', target, assessmentStr);

    const coverageRatio = module1.length / target;
    const minutesFor = (items: number) =>
      items >= target ? spec.fullMinutes : Math.max(4, Math.round(spec.fullMinutes * (items / target)));

    if (module1.length < target) {
      warnings.push(
        `${section}: only ${pool.length} licensed item(s) available for this assessment, so each module uses ${module1.length} of ${target} items (${Math.round(
          coverageRatio * 100
        )}% coverage) with proportionally shortened timers.`
      );
    }
    if (upper.length < target || lower.length < target) {
      warnings.push(
        `${section}: the adaptive second module cannot be filled at full length from the current bank (upper ${upper.length}, lower ${lower.length} of ${target}).`
      );
    }

    sections.push({
      section,
      availableItems: pool.length,
      targetItems: target,
      module1: buildModulePlan(section, 'module1', module1, target, minutesFor(module1.length), seed),
      upper: buildModulePlan(section, 'upper', upper, target, minutesFor(upper.length), seed),
      lower: buildModulePlan(section, 'lower', lower, target, minutesFor(lower.length), seed),
    });
  }

  return {
    assessment: assessmentStr,
    createdAt: new Date().toISOString(),
    sections,
    warnings,
    seed,
    breakMinutes: SECTION_BREAK_MINUTES,
  };
}

export function routeModule(module1Correct: number, module1Total: number): 'upper' | 'lower' {
  if (module1Total <= 0) return 'lower';
  return module1Correct / module1Total >= ROUTING_THRESHOLD ? 'upper' : 'lower';
}

/* ------------------------------------------------------------------------
 * Module flow ordering:
 * - Reading & Writing: exact 4-domain sequence:
 *     0: Craft and Structure (Words in Context -> Text Structure and Purpose -> Cross-Text Connections)
 *     1: Information and Ideas (Central Ideas and Details -> Command of Evidence -> Inferences)
 *     2: Standard English Conventions (Boundaries -> Form, Structure, and Sense)
 *     3: Expression of Ideas (Transitions -> Rhetorical Synthesis)
 *   Within each discrete domain/skill group, difficulty scales Easy -> Medium -> Hard.
 * - Math: continuous linear difficulty progression from Item 1 (Easiest) to Item 22 (Hardest)
 *   across the entire module, with domains and MC/SPR formats intermixed.
 * --------------------------------------------------------------------- */

export const RW_DOMAIN_ORDER: Record<string, number> = {
  'Craft and Structure': 0,
  'Information and Ideas': 1,
  'Standard English Conventions': 2,
  'Expression of Ideas': 3,
};

const DIFFICULTY_ORDER: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

export function orderModuleQuestions(questions: Question[], section: Section): Question[] {
  if (section === 'Reading and Writing') {
    return questions
      .map((q, i) => ({ q, i }))
      .sort((a, b) => {
        const dA = RW_DOMAIN_ORDER[a.q.domain] ?? 1;
        const dB = RW_DOMAIN_ORDER[b.q.domain] ?? 1;
        if (dA !== dB) return dA - dB;
        const sA = RW_SKILL_RANK[a.q.skill] ?? 99;
        const sB = RW_SKILL_RANK[b.q.skill] ?? 99;
        if (sA !== sB) return sA - sB;
        const diffA = DIFFICULTY_ORDER[a.q.difficulty] ?? 1;
        const diffB = DIFFICULTY_ORDER[b.q.difficulty] ?? 1;
        if (diffA !== diffB) return diffA - diffB;
        return a.i - b.i;
      })
      .map(({ q }) => q);
  }

  // Math: continuous linear difficulty progression Easy -> Medium -> Hard across all 22 items
  return questions
    .map((q, i) => ({ q, i }))
    .sort((a, b) => {
      const diffA = DIFFICULTY_ORDER[a.q.difficulty] ?? 1;
      const diffB = DIFFICULTY_ORDER[b.q.difficulty] ?? 1;
      if (diffA !== diffB) return diffA - diffB;
      return a.i - b.i;
    })
    .map(({ q }) => q);
}

/**
 * HDSAT scaled-score estimate (200-800 per section).
 * Routing to the lower-difficulty Module 2 caps the maximum achievable scaled score,
 * whereas routing to the upper-difficulty Module 2 unlocks the highest scaled scores (up to 800).
 */
export function estimateScaledScore(
  tier: 'upper' | 'lower',
  correct: number,
  total: number
): number | null {
  if (total <= 0) return null;
  const accuracy = Math.max(0, Math.min(1, correct / total));
  let score = 200 + 600 * accuracy;
  const tierBoost = tier === 'upper' ? (accuracy >= 0.5 ? 40 : -10) : accuracy >= 0.5 ? -30 : -60;
  score += tierBoost;
  const maxCap = tier === 'lower' ? 620 : 800;
  const clamped = Math.max(200, Math.min(maxCap, score));
  return Math.round(clamped / 10) * 10;
}

export function summarizeTest(
  modules: TestModuleResult[]
): { rwEstimate: number | null; mathEstimate: number | null; totalEstimate: number | null } {
  const estimateFor = (section: Section): number | null => {
    const sectionModules = modules.filter((m) => m.section === section);
    if (sectionModules.length === 0) return null;
    const correct = sectionModules.reduce((acc, m) => acc + m.correct, 0);
    const total = sectionModules.reduce((acc, m) => acc + m.total, 0);
    const routingModule = sectionModules.find((m) => m.tier !== 'module1');
    return estimateScaledScore(routingModule?.tier === 'upper' ? 'upper' : 'lower', correct, total);
  };

  const rwEstimate = estimateFor('Reading and Writing');
  const mathEstimate = estimateFor('Math');
  const totalEstimate =
    rwEstimate !== null && mathEstimate !== null ? rwEstimate + mathEstimate : null;
  return { rwEstimate, mathEstimate, totalEstimate };
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export interface PracticeFilters {
  assessment?: Assessment | string;
  section?: Section | 'all';
  domain?: string | 'all';
  difficulty?: Difficulty | 'all';
  sourceId?: string | 'all';
  onlyIncorrect?: boolean;
  onlySaved?: boolean;
  excludePreviouslyCorrect?: boolean;
  excludeReleasedPracticeSet?: boolean;
}

export interface PracticeSessionOptions {
  count: number;
  seed?: string;
  progress?: Record<string, QuestionProgress>;
  savedIds?: string[];
  format?: 'both' | 'multiple_choice' | 'spr';
}

export function filterQuestions(
  all: Question[],
  filters: PracticeFilters,
  progress: Record<string, QuestionProgress> = {},
  savedIds: string[] = []
): Question[] {
  const savedSet = new Set(savedIds);
  return all.filter((q) => {
    if (filters.assessment && !q.assessments.includes(String(filters.assessment))) return false;
    if (
      filters.assessment === 'PSAT 8/9' &&
      q.section === 'Math' &&
      isTrigQuestion(q)
    ) {
      return false;
    }
    if (filters.section && filters.section !== 'all' && q.section !== filters.section) return false;
    if (filters.domain && filters.domain !== 'all' && q.domain !== filters.domain) return false;
    if (filters.difficulty && filters.difficulty !== 'all' && q.difficulty !== filters.difficulty) return false;
    if (filters.sourceId && filters.sourceId !== 'all' && q.source_id !== filters.sourceId) return false;
    if (filters.onlySaved && !savedSet.has(q.id)) return false;
    if (filters.onlyIncorrect && progress[q.id]?.lastIsCorrect !== false) return false;
    if (filters.excludePreviouslyCorrect && (progress[q.id]?.correctCount ?? 0) > 0) return false;
    if (filters.excludeReleasedPracticeSet && q.is_released_practice_set) return false;
    return true;
  });
}

export function buildPracticeSession(
  all: Question[],
  filters: PracticeFilters,
  options: PracticeSessionOptions
): Question[] {
  let pool = filterQuestions(all, filters, options.progress ?? {}, options.savedIds ?? []);
  if (options.format && options.format !== 'both') {
    pool = pool.filter((q) => q.format === options.format);
  }
  const ordered = seededShuffle(pool, options.seed ?? `practice:${Date.now()}`);
  if (!filters.section || filters.section === 'all') {
    const rw = ordered.filter((q) => q.section === 'Reading and Writing');
    const math = ordered.filter((q) => q.section === 'Math');
    const half = Math.ceil(options.count / 2);
    const mixed: Question[] = [];
    const rwTake = rw.slice(0, Math.min(half, rw.length));
    const mathTake = math.slice(0, Math.min(options.count - rwTake.length, math.length));
    mixed.push(...rwTake, ...mathTake);
    if (mixed.length < options.count) {
      const used = new Set(mixed.map((q) => q.id));
      for (const q of ordered) {
        if (mixed.length >= options.count) break;
        if (!used.has(q.id)) {
          mixed.push(q);
          used.add(q.id);
        }
      }
    }
    return seededShuffle(mixed, `${options.seed ?? 'practice'}:order`).slice(0, options.count);
  }
  return ordered.slice(0, options.count);
}

export function averageDifficulty(questions: Question[]): number {
  if (questions.length === 0) return 0;
  const sum = questions.reduce((acc, q) => acc + DIFFICULTY_WEIGHT[q.difficulty], 0);
  return sum / questions.length;
}

export function countByDifficulty(questions: Question[]): Record<Difficulty, number> {
  const counts: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  questions.forEach((q) => {
    counts[q.difficulty] += 1;
  });
  return counts;
}
