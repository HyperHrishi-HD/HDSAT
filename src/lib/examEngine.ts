import { compareReviewOrder, isReviewDue } from './review';
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
 * - Total Questions: 98 items (90 operational items used for scoring +
 *   8 unscored experimental/pretest items, 2 hidden inside every module:
 *   2 per R&W module and 2 per Math module).
 * - Section 1: Reading & Writing — 54 items, 64 min (Module 1: 27 Qs / 32 min, Module 2: 27 Qs / 32 min)
 * - Section 2: Math — 44 items, 70 min (Module 1: 22 Qs / 35 min, Module 2: 22 Qs / 35 min)
 */
export const SECTION_SPECS: Record<
  Section,
  { fullItems: number; fullMinutes: number; operationalItems: number; unscoredItems: number }
> = {
  'Reading and Writing': { fullItems: 27, fullMinutes: 32, operationalItems: 25, unscoredItems: 2 },
  Math: { fullItems: 22, fullMinutes: 35, operationalItems: 20, unscoredItems: 2 },
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
  /** IDs of the unscored experimental/pretest items in this module (2 in every module). */
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
  /**
   * IDs the student has already attempted. Full-length simulations run in
   * fresh-item mode: they draw only unseen items, repeating old ones solely
   * when the leftover supply cannot fill every adaptive module.
   */
  seenQuestionIds?: Iterable<string>;
}

/**
 * PSAT/NMSQT and PSAT 10 share one blueprint and one difficulty ceiling, so the
 * full-length simulation blends them into a single track. Practice drills keep
 * the original per-assessment labels.
 */
export const BLENDED_PSAT = 'PSAT/NMSQT & PSAT 10';

const ASSESSMENT_ALIASES: Record<string, string[]> = {
  [BLENDED_PSAT]: ['PSAT/NMSQT', 'PSAT 10'],
};

/** True when a bank item belongs to the selected assessment (or blended track). */
export function assessmentMatches(question: Question, assessment: string): boolean {
  const keys = ASSESSMENT_ALIASES[assessment] ?? [assessment];
  return keys.some((key) => question.assessments.includes(key));
}

interface AssessmentDifficultyPolicy {
  /** False excludes hard items from the assessment entirely (PSAT 8/9). */
  hardAllowed: boolean;
  /** Share of each module that may be Hard when hard items are allowed. */
  maxHardShare: number;
}

const ASSESSMENT_DIFFICULTY: Record<string, AssessmentDifficultyPolicy> = {
  SAT: { hardAllowed: true, maxHardShare: 1 },
  [BLENDED_PSAT]: { hardAllowed: true, maxHardShare: 0.25 },
  'PSAT/NMSQT': { hardAllowed: true, maxHardShare: 0.25 },
  'PSAT 10': { hardAllowed: true, maxHardShare: 0.25 },
  'PSAT 8/9': { hardAllowed: false, maxHardShare: 0 },
};

export function assessmentDifficultyPolicy(assessment: string): AssessmentDifficultyPolicy {
  return ASSESSMENT_DIFFICULTY[assessment] ?? { hardAllowed: true, maxHardShare: 1 };
}

function maxHardForModule(assessment: string, target: number): number {
  const policy = assessmentDifficultyPolicy(assessment);
  if (!policy.hardAllowed) return 0;
  return Math.max(0, Math.round(target * policy.maxHardShare));
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

const contentKeyCache = new WeakMap<Question, string>();
const stimulusKeyCache = new WeakMap<Question, string | null>();
const templateKeyCache = new WeakMap<Question, string>();
const archetypeKeyCache = new WeakMap<Question, string>();

function questionContentKey(q: Question): string {
  let k = contentKeyCache.get(q);
  if (k !== undefined) return k;
  const stim = (q.stimulus ?? '').trim();
  const prompt = q.prompt.trim();
  const fig = q.figure_metadata ? JSON.stringify(q.figure_metadata) : '';
  k = `content:${q.section}:${stim || prompt}:${fig}`;
  contentKeyCache.set(q, k);
  return k;
}

function questionStimulusKey(q: Question): string | null {
  if (stimulusKeyCache.has(q)) return stimulusKeyCache.get(q) ?? null;
  const stim = (q.stimulus ?? '').trim();
  if (!stim) {
    stimulusKeyCache.set(q, null);
    return null;
  }
  const fig = q.figure_metadata ? JSON.stringify(q.figure_metadata) : '';
  const k = `stim:${q.section}:${stim}:${fig}`;
  stimulusKeyCache.set(q, k);
  return k;
}

function questionTemplateKey(q: Question): string {
  let k = templateKeyCache.get(q);
  if (k !== undefined) return k;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\d+/g, '#');
  k = `tmpl:${q.section}:${norm(q.stimulus ?? '')}:${norm(q.prompt)}`;
  templateKeyCache.set(q, k);
  return k;
}

/**
 * Coarse structural signature of a question so parameterized siblings
 * ("Although X are frequently cited in discussions of Y, few studies have isolated...")
 * collapse to a single archetype key and never appear back-to-back or flood a session.
 */
export function questionArchetypeKey(q: Question): string {
  let k = archetypeKeyCache.get(q);
  if (k !== undefined) return k;
  const collapse = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\$[^$]+\$/g, 'MATH')
      .replace(/\b\d+(?:\.\d+)?\b/g, '#')
      .replace(/[^a-z#\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 7)
      .join(' ');
  const stimSig = collapse(q.stimulus ?? '');
  const promptSig = collapse(q.prompt);
  k = `arch:${q.section}:${q.skill}:${stimSig.slice(0, 36)}:${promptSig.slice(0, 36)}`;
  archetypeKeyCache.set(q, k);
  return k;
}

/**
 * Question families: everything that makes two items "the same question" to a
 * student who has already seen one of them.
 *
 * A template key ignores the digits (so "if 3x + 5 = 20" and "if 4x + 7 = 31"
 * are one family), a stimulus key covers every item built on the same passage or
 * figure, and a content key covers an exact repeat. These are deliberately
 * narrower than the archetype key: an archetype is a *shape* ("Which choice
 * completes the text...") and there are hundreds of legitimate items in one,
 * while a family is a near-duplicate. Families drive cross-session spacing; the
 * archetype only keeps neighbours inside one session from looking alike.
 */
export interface FamilyHistory {
  /** Family key -> epoch ms of the most recent attempt anywhere in that family. */
  lastSeen: Map<string, number>;
}

/**
 * How long a family stays out of the draw. A drill bank reuses a template with
 * new numbers dozens of times, so an absolute ban would exhaust the Math bank
 * after a handful of sessions; three weeks is long enough that the student
 * never notices the repeat, and short enough that the pool refills itself.
 */
export const FAMILY_COOLDOWN_DAYS = 21;

export function questionFamilyKeys(q: Question): string[] {
  const keys = [questionTemplateKey(q), questionContentKey(q)];
  const stimKey = questionStimulusKey(q);
  if (stimKey) keys.push(stimKey);
  return keys;
}

/**
 * Indexes what the student has already been shown, by family. Only attempted
 * questions contribute, so an untouched bank has an empty history.
 */
export function buildFamilyHistory(
  all: Question[],
  progress: Record<string, QuestionProgress>
): FamilyHistory {
  const lastSeen = new Map<string, number>();
  const byId = new Map(all.map((q) => [q.id, q]));
  for (const [id, record] of Object.entries(progress ?? {})) {
    if (!record || record.attemptCount <= 0) continue;
    const question = byId.get(id);
    if (!question) continue;
    const parsed = Date.parse(record.lastAttemptedAt);
    const when = Number.isFinite(parsed) ? parsed : Date.now();
    for (const key of questionFamilyKeys(question)) {
      lastSeen.set(key, Math.max(lastSeen.get(key) ?? 0, when));
    }
  }
  return { lastSeen };
}

/**
 * Same index, built straight from a list of attempted question IDs. A full test
 * stores only those, and rebuilding the index from the same list is what lets a
 * resumed attempt reproduce its original plan.
 */
export function buildFamilyHistoryFromIds(
  all: Question[],
  ids: Iterable<string>,
  attemptedAt: string = new Date().toISOString()
): FamilyHistory {
  const lastSeen = new Map<string, number>();
  const wanted = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
  if (wanted.size === 0) return { lastSeen };
  const parsed = Date.parse(attemptedAt);
  const when = Number.isFinite(parsed) ? parsed : Date.now();
  for (const question of all) {
    if (!wanted.has(question.id)) continue;
    for (const key of questionFamilyKeys(question)) {
      lastSeen.set(key, Math.max(lastSeen.get(key) ?? 0, when));
    }
  }
  return { lastSeen };
}

/**
 * False while any near-duplicate of this item has been attempted recently.
 * Exact repeats are covered by the template/stimulus keys, so this one rule
 * handles both "same question" and "same question with new numbers".
 */
export function isFamilyFresh(
  q: Question,
  history: FamilyHistory,
  now: number = Date.now()
): boolean {
  if (history.lastSeen.size === 0) return true;
  const cutoff = now - FAMILY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return questionFamilyKeys(q).every((key) => (history.lastSeen.get(key) ?? 0) < cutoff);
}

/**
 * Sorts a pool so families outside the cooldown come before near-duplicates the
 * student has met recently. Order inside each half is preserved, so the caller's
 * schedule (unseen, then due reviews) still decides what comes first.
 */
export function preferFreshFamilies(
  pool: Question[],
  history: FamilyHistory | undefined,
  now: number = Date.now()
): Question[] {
  if (!history || history.lastSeen.size === 0) return pool;
  const fresh: Question[] = [];
  const repeated: Question[] = [];
  for (const q of pool) (isFamilyFresh(q, history, now) ? fresh : repeated).push(q);
  return [...fresh, ...repeated];
}

/**
 * Question-bank status with template mastery folded in.
 *
 * Two items built from one template — same wording, different numbers — are the
 * same question to the student. Once one of them has been answered correctly
 * twice in a row, the bank shows its siblings as mastered too, instead of
 * leaving them as items to study again.
 */
export function templateMasteryIds(
  all: Question[],
  progress: Record<string, QuestionProgress>
): Set<string> {
  const masteredTemplates = new Set<string>();
  for (const q of all) {
    if (progress[q.id]?.status === 'mastered') masteredTemplates.add(questionTemplateKey(q));
  }
  const out = new Set<string>();
  if (masteredTemplates.size === 0) return out;
  for (const q of all) {
    if (masteredTemplates.has(questionTemplateKey(q))) out.add(q.id);
  }
  return out;
}

function markQuestionUsed(q: Question, used: Set<string>): void {
  used.add(q.id);
  used.add(questionContentKey(q));
  const stimKey = questionStimulusKey(q);
  if (stimKey) used.add(stimKey);
  used.add(questionTemplateKey(q));
  used.add(questionArchetypeKey(q));
}

function takeMatching(
  pool: Question[],
  used: Set<string>,
  predicate: (q: Question) => boolean,
  preferredDiffs: Difficulty[]
): Question | null {
  const isFreshAll = (q: Question) => {
    if (used.has(q.id) || used.has(questionContentKey(q))) return false;
    const stimKey = questionStimulusKey(q);
    if (stimKey && used.has(stimKey)) return false;
    if (used.has(questionTemplateKey(q))) return false;
    return !used.has(questionArchetypeKey(q));
  };
  const isFreshStim = (q: Question) => {
    if (used.has(q.id) || used.has(questionContentKey(q))) return false;
    const stimKey = questionStimulusKey(q);
    return !stimKey || !used.has(stimKey);
  };
  const isFreshContent = (q: Question) => !used.has(q.id) && !used.has(questionContentKey(q));

  // Pass 1: unique ID, unique content, unique stimulus, unique template, preferred difficulty
  for (const diff of preferredDiffs) {
    const found = pool.find((q) => isFreshAll(q) && q.difficulty === diff && predicate(q));
    if (found) {
      markQuestionUsed(found, used);
      return found;
    }
  }
  // Pass 2: unique ID, unique content, unique stimulus, preferred difficulty
  for (const diff of preferredDiffs) {
    const found = pool.find((q) => isFreshStim(q) && q.difficulty === diff && predicate(q));
    if (found) {
      markQuestionUsed(found, used);
      return found;
    }
  }
  // Pass 3: unique ID, unique content, preferred difficulty
  for (const diff of preferredDiffs) {
    const found = pool.find((q) => isFreshContent(q) && q.difficulty === diff && predicate(q));
    if (found) {
      markQuestionUsed(found, used);
      return found;
    }
  }
  // Pass 4: any difficulty with unique stimulus & content
  const fallbackStim = pool.find((q) => isFreshStim(q) && predicate(q));
  if (fallbackStim) {
    markQuestionUsed(fallbackStim, used);
    return fallbackStim;
  }
  // Pass 5: any difficulty with unique content
  const fallbackContent = pool.find((q) => isFreshContent(q) && predicate(q));
  if (fallbackContent) {
    markQuestionUsed(fallbackContent, used);
    return fallbackContent;
  }
  // Pass 6: strict ID fallback for tiny unit-test fixtures
  const fallbackId = pool.find((q) => !used.has(q.id) && predicate(q));
  if (fallbackId) {
    markQuestionUsed(fallbackId, used);
    return fallbackId;
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
 *
 * The four domain bands follow that order but are not frozen to the nominal
 * 1-7 / 8-13 / 14-20 / 21-27 windows: adjacent bands may interleave by up to
 * three items, so a domain can begin a few positions early (Information &
 * Ideas starting around item 5-8) or trail a few positions late while the
 * overall domain order is preserved. Skill order and intra-domain difficulty
 * progression always survive the drift.
 */
const RW_BAND_JITTER_MAX = 3;

/** Deterministic integer in [0, maxInclusive] derived from a seed string. */
function seededInt(seed: string, maxInclusive: number): number {
  return hashSeed(seed) % (maxInclusive + 1);
}

/**
 * Lets two adjacent domain bands trade up to `RW_BAND_JITTER_MAX` items across
 * their shared boundary. Each band's items keep their relative order, so the
 * canonical domain order, per-domain skill order, and intra-domain difficulty
 * curve all remain intact while the visible band edges drift.
 */
function interleaveDomainBands(blocks: Question[][], seed: string): Question[] {
  const flat = blocks.flat();
  const offsets: number[] = [0];
  blocks.forEach((block) => offsets.push(offsets[offsets.length - 1] + block.length));

  for (let i = 0; i < blocks.length - 1; i += 1) {
    const k = seededInt(`${seed}:band:${i}`, RW_BAND_JITTER_MAX);
    if (k === 0) continue;
    const earlier = blocks[i];
    const later = blocks[i + 1];
    if (earlier.length < k || later.length < k) continue;
    const boundary = offsets[i + 1];
    const earlierTail = flat.slice(boundary - k, boundary);
    const laterHead = flat.slice(boundary, boundary + k);
    flat.splice(boundary - k, k * 2, ...laterHead, ...earlierTail);
  }

  return flat;
}
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
  target: number,
  seed: string,
  maxHard = Number.POSITIVE_INFINITY
): Question[] {
  let hardPicked = 0;
  const withinHardCap = (q: Question) => q.difficulty !== 'Hard' || hardPicked < maxHard;
  const prefsFor = (index: number, total: number): Difficulty[] => {
    const prefs = tierDifficultyOrder(tier, index, total);
    return hardPicked >= maxHard ? prefs.filter((d) => d !== 'Hard') : prefs;
  };

  if (target < 27) {
    // Scaled-down module when an explicit small itemCap is passed in unit tests
    const picked: Question[] = [];
    for (let i = 0; i < target; i += 1) {
      const q = takeMatching(pool, used, withinHardCap, prefsFor(i, target));
      if (q) {
        if (q.difficulty === 'Hard') hardPicked += 1;
        picked.push(q);
      }
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

  const domainBlocks: Question[][] = [];
  for (const domain of RW_DOMAIN_SEQUENCE) {
    const slots = byDomain.get(domain) ?? [];
    const domainTotal = slots.reduce((acc, s) => acc + s.count, 0);
    const domainPicked: Question[] = [];
    let idxInDomain = 0;

    for (const slot of slots) {
      const slotItems: Question[] = [];
      for (let k = 0; k < slot.count; k += 1) {
        const prefs = prefsFor(idxInDomain, domainTotal);
        idxInDomain += 1;
        // First try exact domain + skill, then any skill Match, then same domain, then any R&W item
        const item =
          takeMatching(
            pool,
            used,
            (q) => withinHardCap(q) && q.domain === slot.domain && slot.skillMatch(q.skill),
            prefs
          ) ??
          takeMatching(pool, used, (q) => withinHardCap(q) && slot.skillMatch(q.skill), prefs) ??
          takeMatching(pool, used, (q) => withinHardCap(q) && q.domain === slot.domain, prefs) ??
          takeMatching(pool, used, withinHardCap, prefs);
        if (item) {
          if (item.difficulty === 'Hard') hardPicked += 1;
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

    domainBlocks.push(orderedDomain);
  }

  return interleaveDomainBands(domainBlocks, seed);
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
  assessment: string,
  maxHard = Number.POSITIVE_INFINITY
): Question[] {
  const filteredPool =
    assessment === 'PSAT 8/9' ? pool.filter((q) => !isTrigQuestion(q)) : pool;
  const hardCap = Number.isFinite(maxHard) ? maxHard : Number.MAX_SAFE_INTEGER;

  if (target < 22) {
    const picked: Question[] = [];
    let hardPicked = 0;
    for (let i = 0; i < target; i += 1) {
      const prefs = tierDifficultyOrder(tier, i, target).filter(
        (d) => d !== 'Hard' || hardPicked < hardCap
      );
      const q = takeMatching(
        filteredPool,
        used,
        (item) => item.difficulty !== 'Hard' || hardPicked < hardCap,
        prefs
      );
      if (q) {
        if (q.difficulty === 'Hard') hardPicked += 1;
        picked.push(q);
      }
    }
    return orderModuleQuestions(picked, 'Math');
  }

  // Target difficulty counts for the 22-question module:
  // Module 1: 30% Easy (7), 40% Medium (9), 30% Hard (6) = 22
  // Lower:    12 Easy, 8 Medium, 2 Hard = 22
  // Upper:    2 Easy, 10 Medium, 10 Hard = 22
  // When the assessment caps hard items (PSAT/NMSQT & PSAT 10 at 25%), the
  // trimmed hard slots are reassigned to Medium so the module still fills.
  const baseHard = tier === 'module1' ? 6 : tier === 'lower' ? 2 : 10;
  const hardCount = Math.min(baseHard, hardCap);
  const hardDeficit = baseHard - hardCount;
  const diffTargets: Record<Difficulty, number> =
    tier === 'module1'
      ? { Easy: 7, Medium: 9 + hardDeficit, Hard: hardCount }
      : tier === 'lower'
      ? { Easy: 12, Medium: 8 + hardDeficit, Hard: hardCount }
      : { Easy: 2, Medium: 10 + hardDeficit, Hard: hardCount };

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
  const difficultyPolicy = assessmentDifficultyPolicy(assessmentStr);
  const seen = new Set(options.seenQuestionIds ?? []);
  // Derived from the same seen set the modules are built from, so resuming a
  // saved attempt (which replays this exact call) reproduces the same plan.
  const family = buildFamilyHistoryFromIds(all, seen);

  for (const section of SECTION_ORDER) {
    const spec = SECTION_SPECS[section];
    const target = Math.max(4, Math.min(spec.fullItems, options.itemCap ?? spec.fullItems));
    const maxHard = maxHardForModule(assessmentStr, target);
    const eligible = all.filter(
      (q) =>
        q.section === section &&
        assessmentMatches(q, assessmentStr) &&
        (difficultyPolicy.hardAllowed || q.difficulty !== 'Hard') &&
        !(options.excludeReleasedPracticeSet && q.is_released_practice_set) &&
        !(assessmentStr === 'PSAT 8/9' && section === 'Math' && isTrigQuestion(q))
    );

    // Fresh-item mode: a full run needs target * 3 unique items (module 1 plus
    // whichever routed module is used). Draw only unseen items while the supply
    // allows it, then fall back to near-duplicates, and only after that to
    // repeats — each step with a transparent warning.
    const needed = target * 3;
    const untouched = eligible.filter((q) => !seen.has(q.id));
    const fresh = untouched.filter((q) => isFamilyFresh(q, family));
    const similar = untouched.filter((q) => !isFamilyFresh(q, family));
    const repeated = eligible.filter((q) => seen.has(q.id));
    let poolSources: Question[][];
    if (fresh.length >= needed) {
      poolSources = [fresh];
    } else if (fresh.length + similar.length >= needed) {
      // Unanswered, but from a family met inside the cooldown. Served after the
      // genuinely new items; no warning, the student asked for the freshest set
      // the bank can build.
      poolSources = [fresh, similar];
    } else {
      warnings.push(
        `${section}: fresh-item mode found only ${fresh.length + similar.length} unanswered item(s) for this assessment, so ${Math.min(
          repeated.length,
          needed - fresh.length - similar.length
        )} previously attempted item(s) are repeated to fill the adaptive modules.`
      );
      poolSources = [fresh, similar, repeated];
    }
    const pool = poolSources.flatMap((source, idx) =>
      seededShuffle(source, `${seed}:${section}:${idx}`)
    );

    const usedM1 = new Set<string>();
    const module1 =
      section === 'Reading and Writing'
        ? buildRwModuleQuestions(pool, usedM1, 'module1', target, `${seed}:${section}:module1`, maxHard)
        : buildMathModuleQuestions(pool, usedM1, 'module1', target, assessmentStr, maxHard);

    const usedUpper = new Set<string>(usedM1);
    const upper =
      section === 'Reading and Writing'
        ? buildRwModuleQuestions(pool, usedUpper, 'upper', target, `${seed}:${section}:upper`, maxHard)
        : buildMathModuleQuestions(pool, usedUpper, 'upper', target, assessmentStr, maxHard);

    const usedLower = new Set<string>(usedUpper);
    const lower =
      section === 'Reading and Writing'
        ? buildRwModuleQuestions(pool, usedLower, 'lower', target, `${seed}:${section}:lower`, maxHard)
        : buildMathModuleQuestions(pool, usedLower, 'lower', target, assessmentStr, maxHard);

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
 * - Reading & Writing: canonical 4-domain sequence whose band boundaries may
 *   drift by up to three items (see interleaveDomainBands):
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
    // Prefer the operational (scored) counts when the runner recorded them, so
    // the two embedded experimental items per module never move the estimate.
    const operational = sectionModules.every((m) => (m.operationalTotal ?? 0) > 0);
    const correct = sectionModules.reduce(
      (acc, m) => acc + (operational ? (m.operationalCorrect ?? 0) : m.correct),
      0
    );
    const total = sectionModules.reduce(
      (acc, m) => acc + (operational ? (m.operationalTotal ?? 0) : m.total),
      0
    );
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
  /** Single-domain filter. Also used by the Study Coach deep links. */
  domain?: string | 'all';
  /** Multi-select domains; an empty list means every domain. */
  domains?: string[];
  /** Single-difficulty filter, kept for callers that only pick one. */
  difficulty?: Difficulty | 'all';
  /** Multi-select difficulties; an empty list means every difficulty. */
  difficulties?: Difficulty[];
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
  /** Clock used for review spacing; injectable so tests are deterministic. */
  now?: Date;
  /**
   * Explicit drills (saved questions, incorrect-only) may revisit an item whose
   * review date has not arrived, because the student picked it on purpose.
   * Automatic sessions never do.
   */
  allowScheduled?: boolean;
}

export function filterQuestions(
  all: Question[],
  filters: PracticeFilters,
  progress: Record<string, QuestionProgress> = {},
  savedIds: string[] = []
): Question[] {
  const savedSet = new Set(savedIds);
  const domainSet = new Set((filters.domains ?? []).filter((d) => d && d !== 'all'));
  const difficultySet = new Set(filters.difficulties ?? []);
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
    if (domainSet.size > 0 && !domainSet.has(q.domain)) return false;
    if (filters.difficulty && filters.difficulty !== 'all' && q.difficulty !== filters.difficulty) return false;
    if (difficultySet.size > 0 && !difficultySet.has(q.difficulty)) return false;
    if (filters.sourceId && filters.sourceId !== 'all' && q.source_id !== filters.sourceId) return false;
    if (filters.onlySaved && !savedSet.has(q.id)) return false;
    if (filters.onlyIncorrect && progress[q.id]?.lastIsCorrect !== false) return false;
    if (filters.excludePreviouslyCorrect && (progress[q.id]?.correctCount ?? 0) > 0) return false;
    if (filters.excludeReleasedPracticeSet && q.is_released_practice_set) return false;
    return true;
  });
}

/**
 * Interleaves questions so consecutive items never share the same archetype
 * or skill when alternatives exist.
 *
 * Draw order is the schedule, not a filler rule: unseen items lead, then items
 * whose review date has arrived (misses first, then one-off corrects, then
 * mastered items, oldest wait first). A seen item that is not due yet is only
 * admitted for an explicit drill (`allowScheduled`), so a mastered question can
 * never drift back into a normal session by accident.
 */
function diversifySequence(
  candidates: Question[],
  count: number,
  progress: Record<string, QuestionProgress>,
  seed: string,
  options: { now?: Date; allowScheduled?: boolean; family?: FamilyHistory } = {}
): Question[] {
  if (candidates.length === 0 || count <= 0) return [];
  const now = options.now ?? new Date();
  const shuffled = seededShuffle(candidates, seed);
  const unseen = shuffled.filter((q) => !progress[q.id] || progress[q.id].attemptCount === 0);
  const seen = shuffled.filter((q) => progress[q.id] && progress[q.id].attemptCount > 0);
  const due = seen
    .filter((q) => isReviewDue(progress[q.id], now))
    .sort((a, b) => compareReviewOrder(progress[a.id], progress[b.id]));
  const scheduled = seen.filter((q) => !isReviewDue(progress[q.id], now));
  // Reviews whose date has arrived keep their priority; among the *new* items,
  // a family the student has never met comes first. That is what stops a
  // practice set from handing out four rewordings of the same template while a
  // genuinely unseen question sits at the back of the draw.
  const working = [
    ...preferFreshFamilies(unseen, options.family),
    ...due,
    ...(options.allowScheduled ? scheduled : []),
  ];

  const picked: Question[] = [];
  const usedIds = new Set<string>();
  const usedContent = new Set<string>();
  const usedTemplates = new Set<string>();
  const usedArchetypes = new Set<string>();

  // Pass 1: strictly distinct archetype + template + content, avoiding consecutive same skill
  for (let step = 0; step < count; step += 1) {
    const prev = picked[picked.length - 1];
    let bestIdx = -1;
    for (let i = 0; i < working.length; i += 1) {
      const q = working[i];
      if (usedIds.has(q.id)) continue;
      const cKey = questionContentKey(q);
      const sKey = questionStimulusKey(q);
      const tKey = questionTemplateKey(q);
      const aKey = questionArchetypeKey(q);
      if (usedContent.has(cKey) || (sKey && usedContent.has(sKey))) continue;
      if (usedTemplates.has(tKey) || usedArchetypes.has(aKey)) continue;
      if (prev && prev.skill === q.skill && prev.difficulty === q.difficulty) continue;
      bestIdx = i;
      break;
    }
    // Relax consecutive-skill restriction if needed while keeping archetype unique
    if (bestIdx < 0) {
      for (let i = 0; i < working.length; i += 1) {
        const q = working[i];
        if (usedIds.has(q.id)) continue;
        const cKey = questionContentKey(q);
        const sKey = questionStimulusKey(q);
        const tKey = questionTemplateKey(q);
        const aKey = questionArchetypeKey(q);
        if (usedContent.has(cKey) || (sKey && usedContent.has(sKey))) continue;
        if (usedTemplates.has(tKey) || usedArchetypes.has(aKey)) continue;
        bestIdx = i;
        break;
      }
    }
    // Relax archetype restriction if pool is small (e.g. narrow single-skill filter)
    if (bestIdx < 0) {
      for (let i = 0; i < working.length; i += 1) {
        const q = working[i];
        if (usedIds.has(q.id)) continue;
        const cKey = questionContentKey(q);
        const sKey = questionStimulusKey(q);
        if (usedContent.has(cKey) || (sKey && usedContent.has(sKey))) continue;
        if (prev && questionArchetypeKey(prev) === questionArchetypeKey(q)) continue;
        bestIdx = i;
        break;
      }
    }
    // Final fallback: any unused ID
    if (bestIdx < 0) {
      bestIdx = working.findIndex((q) => !usedIds.has(q.id));
    }
    if (bestIdx < 0) break;

    const chosen = working[bestIdx];
    picked.push(chosen);
    usedIds.add(chosen.id);
    usedContent.add(questionContentKey(chosen));
    const sKey = questionStimulusKey(chosen);
    if (sKey) usedContent.add(sKey);
    usedTemplates.add(questionTemplateKey(chosen));
    usedArchetypes.add(questionArchetypeKey(chosen));
  }

  return picked;
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
  const seed =
    options.seed ??
    `practice:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const progress = options.progress ?? {};
  const family = buildFamilyHistory(all, progress);
  const draw = { now: options.now, allowScheduled: options.allowScheduled, family };

  if (!filters.section || filters.section === 'all') {
    const rwPool = pool.filter((q) => q.section === 'Reading and Writing');
    const mathPool = pool.filter((q) => q.section === 'Math');
    const half = Math.ceil(options.count / 2);
    const rwTake = diversifySequence(rwPool, half, progress, `${seed}:rw`, draw);
    const mathTake = diversifySequence(
      mathPool,
      Math.max(0, options.count - rwTake.length),
      progress,
      `${seed}:math`,
      draw
    );
    const combined: Question[] = [];
    const maxLen = Math.max(rwTake.length, mathTake.length);
    for (let i = 0; i < maxLen; i += 1) {
      if (i < rwTake.length) combined.push(rwTake[i]);
      if (i < mathTake.length) combined.push(mathTake[i]);
    }
    if (combined.length < options.count) {
      const used = new Set(combined.map((q) => q.id));
      const extras = diversifySequence(
        pool.filter((q) => !used.has(q.id)),
        options.count - combined.length,
        progress,
        `${seed}:extra`,
        draw
      );
      combined.push(...extras);
    }
    return combined.slice(0, options.count);
  }

  return diversifySequence(pool, options.count, progress, seed, draw);
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
