import { compareReviewOrder, isReviewDue } from './review';
import {
  isAssemblyEligible,
  isCollegeBoardQuestion,
  isServableCollegeBoardQuestion,
} from './questionSources';
import type {
  Assessment,
  Difficulty,
  Question,
  QuestionFormat,
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
const DIFFICULTY_BANDS: Difficulty[] = ['Easy', 'Medium', 'Hard'];

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

/**
 * Keeps official College Board items ahead of curated items inside one draw
 * tier. The curated pool remains the fallback, so a missing domain/skill or
 * a small clean official supply cannot prevent a full module from filling.
 * Both halves stay seeded, so replays remain deterministic.
 */
function preferOfficialWithin(questions: Question[], seed: string): Question[] {
  // Keep the existing deterministic draw byte-for-byte when the supplemental
  // official pool is absent (the curated bank and its saved-attempt replays).
  if (!questions.some((question) => isCollegeBoardQuestion(question))) {
    return seededShuffle(questions, seed);
  }
  const official = questions.filter((question) => isServableCollegeBoardQuestion(question));
  const curated = questions.filter((question) => !isCollegeBoardQuestion(question));
  return [
    ...seededShuffle(official, `${seed}:official`),
    ...seededShuffle(curated, `${seed}:curated`),
  ];
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

export type PlanAlgorithmVersion = 1 | 2;

export type ModuleRelaxation =
  | 'module-family-cap'
  | 'plan-family-cap'
  | 'skill-fallback'
  | 'format-fallback';

const MODULE_RELAXATION_ORDER: ModuleRelaxation[] = [
  'module-family-cap',
  'plan-family-cap',
  'skill-fallback',
  'format-fallback',
];

/** Per-module selection facts, used by tests and the operator console. */
export interface ModuleDiagnostics {
  tier: ModuleTier;
  operational: number;
  pretest: number;
  domainCounts: Record<string, number>;
  /** Difficulty counts for operational items only. */
  difficultyCounts: Record<Difficulty, number>;
  /** Bands present in the eligible pool but absent from the administered module. */
  missingDifficulties: Difficulty[];
  /** True when Hard is allowed and present in the pool but absent from this module. */
  missingHard: boolean;
  /** Constraints relaxed while filling this module, in canonical order. */
  relaxations: ModuleRelaxation[];
  /** Extra members of a task family beyond the first, per module. */
  taskFamilyRepeats: number;
  shortfalls: string[];
}

export interface SectionDiagnostics {
  section: Section;
  modules: ModuleDiagnostics[];
}

export interface PlanDiagnostics {
  algorithmVersion: PlanAlgorithmVersion;
  sections: SectionDiagnostics[];
}

export interface TestPlan {
  assessment: string;
  createdAt: string;
  sections: SectionPlan[];
  warnings: string[];
  seed: string;
  breakMinutes: number;
  /** Which selection algorithm built this plan. Saved attempts replay their own version. */
  algorithmVersion?: PlanAlgorithmVersion;
  diagnostics?: PlanDiagnostics;
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
  /** Defaults to v2. Paused attempts pass the version they were created with. */
  algorithm?: PlanAlgorithmVersion;
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
 * How long a family stays out of the draw. Semester-length, because the
 * complaint that started this was recognising a question two weeks later: a
 * template with new numbers is the same question to a student. A drill bank
 * reuses templates, so an absolute ban would exhaust the Math bank, and the
 * draw is ordered rather than filtered — fresh families first, near-duplicates
 * only once the fresh pool cannot fill the session.
 */
export const FAMILY_COOLDOWN_DAYS = 45;

export function questionFamilyKeys(q: Question): string[] {
  const keys = [questionTemplateKey(q), questionContentKey(q)];
  const stimKey = questionStimulusKey(q);
  if (stimKey) keys.push(stimKey);
  return keys;
}

const taskFamilyKeyCache = new WeakMap<Question, string>();

function normaliseTaskText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ');
}

function finalSentence(text: string | null): string {
  const parts = (text ?? '')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function figureSignature(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  const figure = meta as { type?: string; rows?: unknown[]; series?: unknown[] };
  if (figure.type === 'table') {
    const rows = Array.isArray(figure.rows) ? figure.rows : [];
    const first = rows[0];
    const width = Array.isArray(first) ? first.length : 0;
    return `table:${rows.length}x${width}`;
  }
  if (figure.type === 'bar_chart' || figure.type === 'line_chart') {
    return `${figure.type}:${Array.isArray(figure.series) ? figure.series.length : 0}`;
  }
  return figure.type ?? '';
}

/**
 * Task family: the layer that catches a generated template whose context
 * sentence was paraphrased. The ordinary template key includes the whole
 * stimulus, so `M13-DATA-T000..T007` (one table, eight unrelated context
 * sentences) look like eight different questions to it.
 *
 * Math ignores the opening context sentence and keys on the skill, the prompt
 * and the final (task-bearing) sentence plus the figure shape. R&W keeps the
 * passage identity, because two prompts on one passage are already one family.
 *
 * Full-test planning uses this key; practice, rush, daily and mastery keep the
 * existing `questionFamilyKeys` so their behaviour does not change.
 */
export function questionTaskFamilyKey(q: Question): string {
  const cached = taskFamilyKeyCache.get(q);
  if (cached !== undefined) return cached;
  const prompt = normaliseTaskText(q.prompt);
  // R&W has one question per passage, so the passage is the family. That also
  // catches the bank's few multiple-prompt variants on one passage, which a
  // prompt-sensitive key would treat as unrelated questions.
  const key =
    q.section === 'Reading and Writing'
      ? `task:rw:${q.skill}:${questionStimulusKey(q) ?? ''}`
      : `task:math:${q.skill}:${prompt}:${normaliseTaskText(finalSentence(q.stimulus))}:${figureSignature(
          q.figure_metadata
        )}`;
  taskFamilyKeyCache.set(q, key);
  return key;
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
 * Family history for full-test planning: the ordinary keys plus the task
 * family, so a generated sibling counts as "seen" even when its context
 * sentence was rewritten.
 */
export function buildPlanFamilyHistoryFromIds(
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
    for (const key of [...questionFamilyKeys(question), questionTaskFamilyKey(question)]) {
      lastSeen.set(key, Math.max(lastSeen.get(key) ?? 0, when));
    }
  }
  return { lastSeen };
}

export function isPlanFamilyFresh(
  q: Question,
  history: FamilyHistory,
  now: number = Date.now()
): boolean {
  if (history.lastSeen.size === 0) return true;
  const cutoff = now - FAMILY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return [...questionFamilyKeys(q), questionTaskFamilyKey(q)].every(
    (key) => (history.lastSeen.get(key) ?? 0) < cutoff
  );
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

  // Difficulty first, freshness second.
  //
  // The old order walked the freshness passes outermost, so a fresh archetype
  // at a *lower* difficulty beat a near-sibling at the preferred one. That was
  // invisible while algebra supplied a large Hard family; once those routine
  // systems were relabelled Medium the adaptive "upper" module filled every
  // slot from Module 1's leftovers and came out with no Hard items at all,
  // even with 282 hard items still in the pool. A module's difficulty curve is
  // the reason the tier exists, so it now outranks template freshness; the
  // freshness passes still run before any other difficulty is considered.
  for (const diff of preferredDiffs) {
    for (const isFresh of [isFreshAll, isFreshStim, isFreshContent]) {
      const found = pool.find((q) => isFresh(q) && q.difficulty === diff && predicate(q));
      if (found) {
        markQuestionUsed(found, used);
        return found;
      }
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
  'Command of Evidence': 4,
  'Command of Evidence (Textual)': 4,
  'Command of Evidence (Quantitative)': 4,
  Inferences: 5,
  Boundaries: 6,
  'Form, Structure, and Sense': 7,
  Transitions: 8,
  'Rhetorical Synthesis': 9,
};

function buildRwModuleQuestionsV1(
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
    return orderModuleQuestions(picked, 'Reading and Writing', 1);
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

function buildMathModuleQuestionsV1(
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

/* ------------------------------------------------------------------------ *
 * v2: operational blueprint, task-family caps, supply-aware difficulty
 *
 * The official module is 25 operational + 2 pretest for R&W and 20 + 2 for
 * Math. Quotas below describe the operational items only; the two pretest
 * items are extra and sit inside the same domain/skill blocks. That is what
 * keeps Expression of Ideas at 12 per test instead of 14, and Algebra/PSDA at
 * 14/6 instead of 16/8.
 * ------------------------------------------------------------------------ */

const RW_OPERATIONAL_SLOTS_V2: RwSlotSpec[] = [
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
  { domain: 'Standard English Conventions', skillMatch: (s) => s === 'Boundaries', count: 3 },
  {
    domain: 'Standard English Conventions',
    skillMatch: (s) => s === 'Form, Structure, and Sense',
    count: 3,
  },
  { domain: 'Expression of Ideas', skillMatch: (s) => s === 'Transitions', count: 3 },
  { domain: 'Expression of Ideas', skillMatch: (s) => s === 'Rhetorical Synthesis', count: 3 },
];

const RW_OPERATIONAL_TARGET_V2 = 25;

const MATH_OPERATIONAL_SLOTS_V2: { domain: string; count: number; spr: number }[] = [
  { domain: 'Algebra', count: 7, spr: 1 },
  { domain: 'Advanced Math', count: 7, spr: 2 },
  { domain: 'Problem-Solving and Data Analysis', count: 3, spr: 1 },
  { domain: 'Geometry and Trigonometry', count: 3, spr: 1 },
];

const MATH_OPERATIONAL_TARGET_V2 = 20;
const TASK_FAMILY_PER_MODULE = 1;
const TASK_FAMILY_PER_PLAN = 2;
/**
 * Tier 1 is the official College Board pool. Tier 2 (the curated bank) fills
 * only slots Tier 1 cannot fill and is capped at this share of a module. It is
 * a filler ceiling, not a quota: when official rows can fill the module, no
 * curated row is forced in.
 */
const TIER2_FILL_SHARE_PER_MODULE = 0.2;
const CAP_RELAX_ATTEMPTS = [
  { moduleFamily: false, planFamily: false },
  { moduleFamily: true, planFamily: false },
  { moduleFamily: true, planFamily: true },
] as const;

interface ModulePickState {
  used: Set<string>;
  moduleFamilyCounts: Map<string, number>;
  planFamilyCounts: Map<string, number>;
  skillCounts: Map<string, number>;
  seen: Set<string>;
  hardPicked: number;
  tier2Picked: number;
  tier2Cap: number;
  relaxations: Set<ModuleRelaxation>;
}

interface ModuleBuildV2 {
  questions: Question[];
  unscoredIds: string[];
  diagnostics: ModuleDiagnostics;
}

function newPickState(seen: Set<string>, tier2Cap = Number.POSITIVE_INFINITY): ModulePickState {
  return {
    used: new Set<string>(),
    moduleFamilyCounts: new Map<string, number>(),
    planFamilyCounts: new Map<string, number>(),
    skillCounts: new Map<string, number>(),
    seen,
    hardPicked: 0,
    tier2Picked: 0,
    tier2Cap,
    relaxations: new Set<ModuleRelaxation>(),
  };
}

/** A second adaptive branch keeps module 1 out, but resets per-module caps. */
function branchPickState(base: ModulePickState): ModulePickState {
  return {
    used: new Set<string>(base.used),
    moduleFamilyCounts: new Map<string, number>(),
    planFamilyCounts: new Map<string, number>(base.planFamilyCounts),
    skillCounts: new Map<string, number>(),
    seen: base.seen,
    hardPicked: 0,
    tier2Picked: 0,
    tier2Cap: base.tier2Cap,
    relaxations: new Set<ModuleRelaxation>(),
  };
}

function noteRelaxation(state: ModulePickState, relaxation: ModuleRelaxation): void {
  state.relaxations.add(relaxation);
}

function noteCapRelaxations(
  state: ModulePickState,
  question: Question,
  moduleRelaxed: boolean,
  planRelaxed: boolean
): void {
  const family = questionTaskFamilyKey(question);
  if (
    moduleRelaxed &&
    (state.moduleFamilyCounts.get(family) ?? 0) >= TASK_FAMILY_PER_MODULE
  ) {
    noteRelaxation(state, 'module-family-cap');
  }
  if (planRelaxed && (state.planFamilyCounts.get(family) ?? 0) >= TASK_FAMILY_PER_PLAN) {
    noteRelaxation(state, 'plan-family-cap');
  }
}

function markPickedV2(q: Question, state: ModulePickState): void {
  state.used.add(q.id);
  state.used.add(questionContentKey(q));
  const stimKey = questionStimulusKey(q);
  if (stimKey) state.used.add(stimKey);
  state.used.add(questionTemplateKey(q));
  const family = questionTaskFamilyKey(q);
  state.moduleFamilyCounts.set(family, (state.moduleFamilyCounts.get(family) ?? 0) + 1);
  state.planFamilyCounts.set(family, (state.planFamilyCounts.get(family) ?? 0) + 1);
  state.skillCounts.set(q.skill, (state.skillCounts.get(q.skill) ?? 0) + 1);
  if (q.difficulty === 'Hard') state.hardPicked += 1;
  if (!isCollegeBoardQuestion(q)) state.tier2Picked += 1;
}

function isAvailableV2(
  q: Question,
  state: ModulePickState,
  relaxModuleFamily: boolean,
  relaxPlanFamily: boolean
): boolean {
  if (state.used.has(q.id) || state.used.has(questionContentKey(q))) return false;
  if (!isCollegeBoardQuestion(q) && state.tier2Picked >= state.tier2Cap) return false;
  const stimKey = questionStimulusKey(q);
  if (stimKey && state.used.has(stimKey)) return false;
  if (state.used.has(questionTemplateKey(q))) return false;
  const family = questionTaskFamilyKey(q);
  if (
    !relaxModuleFamily &&
    (state.moduleFamilyCounts.get(family) ?? 0) >= TASK_FAMILY_PER_MODULE
  ) {
    return false;
  }
  if (!relaxPlanFamily && (state.planFamilyCounts.get(family) ?? 0) >= TASK_FAMILY_PER_PLAN) {
    return false;
  }
  return true;
}

/**
 * Deterministic best candidate. Difficulty fit dominates; family repetition,
 * skill saturation, freshness and a seeded tie-break order the rest.
 */
function chooseV2(
  pool: Question[],
  state: ModulePickState,
  predicate: (q: Question) => boolean,
  preferred: Difficulty[],
  seed: string,
  options: { relaxModuleFamily?: boolean; relaxPlanFamily?: boolean; hardCap?: number } = {}
): Question | null {
  let best: Question | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const q of pool) {
    if (!predicate(q)) continue;
    if (!isAvailableV2(q, state, Boolean(options.relaxModuleFamily), Boolean(options.relaxPlanFamily))) {
      continue;
    }
    if (options.hardCap !== undefined && q.difficulty === 'Hard' && state.hardPicked >= options.hardCap) {
      continue;
    }
    const family = questionTaskFamilyKey(q);
    const preferredIndex = preferred.indexOf(q.difficulty);
    const difficultyScore =
      preferredIndex >= 0 ? preferredIndex : preferred.length + (DIFFICULTY_WEIGHT[q.difficulty] ?? 1);
    const score =
      (isCollegeBoardQuestion(q) ? 0 : 1000) +
      difficultyScore * 100 +
      (state.moduleFamilyCounts.get(family) ?? 0) * 30 +
      (state.planFamilyCounts.get(family) ?? 0) * 10 +
      (state.skillCounts.get(q.skill) ?? 0) * 4 +
      (state.seen.has(q.id) ? 20 : 0) +
      (hashSeed(`${seed}:${q.id}`) % 1000) / 1000;
    if (score < bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

function tryPickV2(
  pool: Question[],
  state: ModulePickState,
  predicate: (q: Question) => boolean,
  preferred: Difficulty[],
  seed: string,
  options: { relaxModuleFamily?: boolean; relaxPlanFamily?: boolean; hardCap?: number } = {}
): Question | null {
  for (const difficulty of preferred) {
    const found = chooseV2(
      pool,
      state,
      (q) => predicate(q) && q.difficulty === difficulty,
      // The predicate already fixes the band; only that band can score.
      [difficulty],
      seed,
      options
    );
    if (found) return found;
  }
  return chooseV2(pool, state, predicate, preferred, seed, options);
}

function canPickV2(q: Question, state: ModulePickState, hardCap: number): boolean {
  return q.difficulty !== 'Hard' || state.hardPicked < hardCap;
}

function fillRwOperationalV2(
  pool: Question[],
  state: ModulePickState,
  tier: ModuleTier,
  seed: string,
  maxHard: number
): { picked: Question[]; shortfalls: string[] } {
  const picked: Question[] = [];
  const shortfalls: string[] = [];
  for (const slot of RW_OPERATIONAL_SLOTS_V2) {
    for (let i = 0; i < slot.count; i += 1) {
      const prefs = tierDifficultyOrder(tier, i, slot.count);
      const attempts = [
        ...CAP_RELAX_ATTEMPTS.map((relax) => ({ exactSkill: true, ...relax })),
        ...CAP_RELAX_ATTEMPTS.map((relax) => ({ exactSkill: false, ...relax })),
      ].map(({ exactSkill, moduleFamily, planFamily }) => ({
        predicate: (q: Question) =>
          q.domain === slot.domain && (!exactSkill || slot.skillMatch(q.skill)),
        relaxSkill: !exactSkill,
        relaxModuleFamily: moduleFamily,
        relaxPlanFamily: planFamily,
      }));
      let found: Question | null = null;
      for (const attempt of attempts) {
        found = tryPickV2(pool, state, attempt.predicate, prefs, seed, {
          hardCap: maxHard,
          relaxModuleFamily: attempt.relaxModuleFamily,
          relaxPlanFamily: attempt.relaxPlanFamily,
        });
        if (found) {
          if (attempt.relaxSkill && !slot.skillMatch(found.skill)) {
            noteRelaxation(state, 'skill-fallback');
          }
          noteCapRelaxations(
            state,
            found,
            attempt.relaxModuleFamily,
            attempt.relaxPlanFamily
          );
          break;
        }
      }
      if (!found) {
        shortfalls.push(
          `${slot.domain}: ${slot.count - i} operational slot(s) unfilled (skill ${slot.skillMatch.name || 'group'})`
        );
        break;
      }
      if (!prefs.includes(found.difficulty)) {
        shortfalls.push(
          `${slot.domain}: no ${prefs.join('/')} candidate for slot ${i + 1}; used ${found.difficulty}`
        );
      }
      markPickedV2(found, state);
      picked.push(found);
    }
  }
  return { picked, shortfalls };
}

function mathFormatSequence(slot: { count: number; spr: number }): QuestionFormat[] {
  const sprPositions = new Set<number>();
  for (let i = 0; i < slot.spr; i += 1) {
    sprPositions.add(Math.min(slot.count - 1, Math.round(((i + 1) * slot.count) / (slot.spr + 1))));
  }
  return Array.from({ length: slot.count }, (_, index) =>
    sprPositions.has(index) ? 'spr' : 'multiple_choice'
  );
}

function fillMathOperationalV2(
  pool: Question[],
  state: ModulePickState,
  tier: ModuleTier,
  seed: string,
  maxHard: number
): { picked: Question[]; shortfalls: string[] } {
  const picked: Question[] = [];
  const shortfalls: string[] = [];
  for (const slot of MATH_OPERATIONAL_SLOTS_V2) {
    const formats = mathFormatSequence(slot);
    for (let i = 0; i < slot.count; i += 1) {
      const desiredFormat = formats[i];
      const prefs = tierDifficultyOrder(tier, i, slot.count);
      let found = tryPickV2(
        pool,
        state,
        (q) => q.domain === slot.domain && q.format === desiredFormat,
        prefs,
        seed,
        { hardCap: maxHard }
      );
      if (!found) {
        found = tryPickV2(pool, state, (q) => q.domain === slot.domain, prefs, seed, {
          hardCap: maxHard,
        });
        if (found) noteRelaxation(state, 'format-fallback');
      }
      if (!found) {
        found = tryPickV2(pool, state, (q) => q.domain === slot.domain, prefs, seed, {
          hardCap: maxHard,
          relaxModuleFamily: true,
          relaxPlanFamily: true,
        });
        if (found) {
          noteRelaxation(state, 'format-fallback');
          noteCapRelaxations(state, found, true, true);
        }
      }
      if (!found) {
        shortfalls.push(`${slot.domain}: ${slot.count - i} operational slot(s) unfilled`);
        break;
      }
      if (!prefs.includes(found.difficulty)) {
        shortfalls.push(
          `${slot.domain}: no ${prefs.join('/')} candidate for slot ${i + 1}; used ${found.difficulty}`
        );
      }
      markPickedV2(found, state);
      picked.push(found);
    }
  }
  return { picked, shortfalls };
}

function selectPretestV2(
  pool: Question[],
  state: ModulePickState,
  operational: Question[],
  count: number,
  seed: string,
  maxHard: number
): { questions: Question[]; shortfalls: string[] } {
  if (count <= 0) return { questions: [], shortfalls: [] };
  const domainTotals = new Map<string, number>();
  for (const q of operational) {
    domainTotals.set(q.domain, (domainTotals.get(q.domain) ?? 0) + 1);
  }
  const domains = [...domainTotals.entries()].sort((a, b) => b[1] - a[1]).map(([domain]) => domain);
  const questions: Question[] = [];
  const shortfalls: string[] = [];
  for (const domain of domains) {
    if (questions.length >= count) break;
    const found = tryPickV2(
      pool,
      state,
      (q) => q.domain === domain && canPickV2(q, state, maxHard),
      ['Medium', 'Easy', 'Hard'],
      `${seed}:pretest:${domain}`,
      { hardCap: maxHard }
    );
    if (found) {
      markPickedV2(found, state);
      questions.push(found);
    }
  }
  while (questions.length < count) {
    const found = tryPickV2(
      pool,
      state,
      (q) => canPickV2(q, state, maxHard),
      ['Medium', 'Easy', 'Hard'],
      `${seed}:pretest:fill:${questions.length}`,
      { hardCap: maxHard }
    );
    if (!found) break;
    markPickedV2(found, state);
    questions.push(found);
  }
  if (questions.length < count) {
    shortfalls.push(`pretest: ${count - questions.length} slot(s) unfilled`);
  }
  return { questions, shortfalls };
}

function moduleDiagnosticsV2(
  tier: ModuleTier,
  questions: Question[],
  unscoredIds: string[],
  shortfalls: string[],
  pool: Question[],
  maxHard: number,
  relaxations: Set<ModuleRelaxation>
): ModuleDiagnostics {
  const unscored = new Set(unscoredIds);
  const operational = questions.filter((q) => !unscored.has(q.id));
  const domainCounts: Record<string, number> = {};
  const difficultyCounts: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  const familyCounts = new Map<string, number>();
  for (const q of operational) {
    domainCounts[q.domain] = (domainCounts[q.domain] ?? 0) + 1;
    difficultyCounts[q.difficulty] += 1;
  }
  for (const q of questions) {
    const family = questionTaskFamilyKey(q);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  let taskFamilyRepeats = 0;
  for (const count of familyCounts.values()) taskFamilyRepeats += Math.max(0, count - 1);

  const administered = new Set(questions.map((q) => q.difficulty));
  const available = new Set<Difficulty>();
  for (const q of pool) {
    if (q.difficulty === 'Hard' && maxHard <= 0) continue;
    available.add(q.difficulty);
  }
  const missingDifficulties = DIFFICULTY_BANDS.filter(
    (difficulty) => available.has(difficulty) && !administered.has(difficulty)
  );
  return {
    tier,
    operational: operational.length,
    pretest: questions.length - operational.length,
    domainCounts,
    difficultyCounts,
    missingDifficulties,
    missingHard: missingDifficulties.includes('Hard'),
    relaxations: MODULE_RELAXATION_ORDER.filter((relaxation) => relaxations.has(relaxation)),
    taskFamilyRepeats,
    shortfalls,
  };
}

function orderMathV2(questions: Question[]): Question[] {
  const buckets: Question[][] = [[], [], []];
  for (const q of questions) {
    buckets[DIFFICULTY_ORDER[q.difficulty] ?? 1].push(q);
  }
  const ordered: Question[] = [];
  for (const bucket of buckets) {
    const remaining = bucket.slice();
    while (remaining.length > 0) {
      const prev = ordered[ordered.length - 1];
      let index = -1;
      if (prev) {
        const prevFamily = questionTaskFamilyKey(prev);
        index = remaining.findIndex(
          (q) =>
            q.domain !== prev.domain &&
            q.skill !== prev.skill &&
            questionTaskFamilyKey(q) !== prevFamily
        );
        if (index < 0) {
          index = remaining.findIndex(
            (q) => q.skill !== prev.skill && questionTaskFamilyKey(q) !== prevFamily
          );
        }
        if (index < 0) {
          index = remaining.findIndex((q) => questionTaskFamilyKey(q) !== prevFamily);
        }
        if (index < 0) index = remaining.findIndex((q) => q.domain !== prev.domain);
      }
      if (index < 0) index = 0;
      ordered.push(remaining.splice(index, 1)[0]);
    }
  }
  return ordered;
}

function buildScaledModuleV2(
  pool: Question[],
  state: ModulePickState,
  tier: ModuleTier,
  target: number,
  seed: string,
  maxHard: number,
  order: (questions: Question[]) => Question[]
): ModuleBuildV2 {
  const picked: Question[] = [];
  const shortfalls: string[] = [];
  for (let i = 0; i < target; i += 1) {
    const prefs = tierDifficultyOrder(tier, i, target);
    let found: Question | null = null;
    for (const relax of CAP_RELAX_ATTEMPTS) {
      found = tryPickV2(pool, state, () => true, prefs, `${seed}:small:${i}`, {
        hardCap: maxHard,
        relaxModuleFamily: relax.moduleFamily,
        relaxPlanFamily: relax.planFamily,
      });
      if (found) {
        noteCapRelaxations(state, found, relax.moduleFamily, relax.planFamily);
        break;
      }
    }
    if (!found) {
      shortfalls.push(`${target - i} scaled-down slot(s) unfilled`);
      break;
    }
    markPickedV2(found, state);
    picked.push(found);
  }
  const questions = order(picked);
  return {
    questions,
    unscoredIds: [],
    diagnostics: moduleDiagnosticsV2(
      tier,
      questions,
      [],
      shortfalls,
      pool,
      maxHard,
      state.relaxations
    ),
  };
}

function buildRwModuleQuestionsV2(
  pool: Question[],
  state: ModulePickState,
  tier: ModuleTier,
  target: number,
  seed: string,
  maxHard = Number.POSITIVE_INFINITY
): ModuleBuildV2 {
  if (target < 27) {
    return buildScaledModuleV2(pool, state, tier, target, seed, maxHard, (picked) =>
      orderModuleQuestions(picked, 'Reading and Writing', 2)
    );
  }

  const operational = fillRwOperationalV2(pool, state, tier, seed, maxHard);
  const pretest =
    operational.picked.length >= RW_OPERATIONAL_TARGET_V2
      ? selectPretestV2(
          pool,
          state,
          operational.picked,
          target - RW_OPERATIONAL_TARGET_V2,
          seed,
          maxHard
        )
      : { questions: [], shortfalls: [] };
  const questions = orderModuleQuestions(
    [...operational.picked, ...pretest.questions],
    'Reading and Writing',
    2
  );
  const unscoredIds = pretest.questions.map((q) => q.id);
  return {
    questions,
    unscoredIds,
    diagnostics: moduleDiagnosticsV2(
      tier,
      questions,
      unscoredIds,
      [...operational.shortfalls, ...pretest.shortfalls],
      pool,
      maxHard,
      state.relaxations
    ),
  };
}

function buildMathModuleQuestionsV2(
  pool: Question[],
  state: ModulePickState,
  tier: ModuleTier,
  target: number,
  assessment: string,
  seed: string,
  maxHard = Number.POSITIVE_INFINITY
): ModuleBuildV2 {
  const filteredPool = assessment === 'PSAT 8/9' ? pool.filter((q) => !isTrigQuestion(q)) : pool;
  if (target < 22) {
    return buildScaledModuleV2(
      filteredPool,
      state,
      tier,
      target,
      seed,
      maxHard,
      orderMathV2
    );
  }

  const operational = fillMathOperationalV2(filteredPool, state, tier, seed, maxHard);
  const pretest =
    operational.picked.length >= MATH_OPERATIONAL_TARGET_V2
      ? selectPretestV2(
          filteredPool,
          state,
          operational.picked,
          target - MATH_OPERATIONAL_TARGET_V2,
          seed,
          maxHard
        )
      : { questions: [], shortfalls: [] };
  const questions = orderMathV2([...operational.picked, ...pretest.questions]);
  const unscoredIds = pretest.questions.map((q) => q.id);
  return {
    questions,
    unscoredIds,
    diagnostics: moduleDiagnosticsV2(
      tier,
      questions,
      unscoredIds,
      [...operational.shortfalls, ...pretest.shortfalls],
      filteredPool,
      maxHard,
      state.relaxations
    ),
  };
}

function buildSectionModuleV2(
  section: Section,
  pool: Question[],
  state: ModulePickState,
  tier: ModuleTier,
  target: number,
  assessment: string,
  seed: string,
  maxHard: number
): ModuleBuildV2 {
  return section === 'Reading and Writing'
    ? buildRwModuleQuestionsV2(pool, state, tier, target, seed, maxHard)
    : buildMathModuleQuestionsV2(pool, state, tier, target, assessment, seed, maxHard);
}

function buildTestPlanV2(all: Question[], options: TestPlanOptions): TestPlan {
  const seed = options.seed ?? 'hdsat-test';
  const warnings: string[] = [];
  const sections: SectionPlan[] = [];
  const diagnostics: PlanDiagnostics = { algorithmVersion: 2, sections: [] };
  const assessmentStr = String(options.assessment);
  const difficultyPolicy = assessmentDifficultyPolicy(assessmentStr);
  const seen = new Set(options.seenQuestionIds ?? []);
  const family = buildPlanFamilyHistoryFromIds(all, seen);

  for (const section of SECTION_ORDER) {
    const spec = SECTION_SPECS[section];
    const target = Math.max(4, Math.min(spec.fullItems, options.itemCap ?? spec.fullItems));
    const maxHard = maxHardForModule(assessmentStr, target);
    const eligible = all.filter(
      (q) =>
        q.section === section &&
        assessmentMatches(q, assessmentStr) &&
        (difficultyPolicy.hardAllowed || q.difficulty !== 'Hard') &&
        isAssemblyEligible(q) &&
        !(options.excludeReleasedPracticeSet && q.is_released_practice_set) &&
        !(assessmentStr === 'PSAT 8/9' && section === 'Math' && isTrigQuestion(q))
    );

    // Module 1 and one adaptive branch are actually administered, so the
    // planner needs two modules of unique items, not three. Upper and lower
    // are drawn independently from the same post-module-1 pool.
    const needed = target * 2;
    const untouched = eligible.filter((q) => !seen.has(q.id));
    const fresh = untouched.filter((q) => isPlanFamilyFresh(q, family));
    const similar = untouched.filter((q) => !isPlanFamilyFresh(q, family));
    const repeated = eligible.filter((q) => seen.has(q.id));
    let poolSources: Question[][];
    if (fresh.length >= needed) {
      poolSources = [fresh];
    } else if (fresh.length + similar.length >= needed) {
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
      preferOfficialWithin(source, `${seed}:${section}:v2:${idx}`)
    );

    // The 20% ceiling applies only when an official Tier 1 pool is present.
    // Curated-only deployments keep the pre-integration v2 behaviour; the
    // supplemental asset is allowed to be missing without shrinking tests.
    const hasOfficialPool = pool.some((q) => isCollegeBoardQuestion(q));
    const tier2Cap = hasOfficialPool
      ? Math.max(0, Math.floor(target * TIER2_FILL_SHARE_PER_MODULE))
      : Number.POSITIVE_INFINITY;
    const module1State = newPickState(seen, tier2Cap);
    const module1 = buildSectionModuleV2(
      section,
      pool,
      module1State,
      'module1',
      target,
      assessmentStr,
      `${seed}:${section}:module1`,
      maxHard
    );

    const upperState = branchPickState(module1State);
    const upper = buildSectionModuleV2(
      section,
      pool,
      upperState,
      'upper',
      target,
      assessmentStr,
      `${seed}:${section}:upper`,
      maxHard
    );

    const lowerState = branchPickState(module1State);
    const lower = buildSectionModuleV2(
      section,
      pool,
      lowerState,
      'lower',
      target,
      assessmentStr,
      `${seed}:${section}:lower`,
      maxHard
    );

    const minutesFor = (items: number) =>
      items >= target ? spec.fullMinutes : Math.max(4, Math.round(spec.fullMinutes * (items / target)));

    if (module1.questions.length < target) {
      warnings.push(
        `${section}: only ${pool.length} eligible item(s) available, so each module uses ${module1.questions.length} of ${target} items with proportionally shortened timers.`
      );
    }
    if (upper.questions.length < target || lower.questions.length < target) {
      warnings.push(
        `${section}: the adaptive second module cannot be filled at full length from the current bank (upper ${upper.questions.length}, lower ${lower.questions.length} of ${target}).`
      );
    }
    const shortfalls = [
      ...module1.diagnostics.shortfalls,
      ...upper.diagnostics.shortfalls,
      ...lower.diagnostics.shortfalls,
    ];
    if (shortfalls.length > 0) {
      warnings.push(`${section}: blueprint shortfall - ${shortfalls[0]}`);
    }

    sections.push({
      section,
      availableItems: pool.length,
      targetItems: target,
      module1: buildModulePlan(
        section,
        'module1',
        module1.questions,
        target,
        minutesFor(module1.questions.length),
        seed,
        module1.unscoredIds
      ),
      upper: buildModulePlan(
        section,
        'upper',
        upper.questions,
        target,
        minutesFor(upper.questions.length),
        seed,
        upper.unscoredIds
      ),
      lower: buildModulePlan(
        section,
        'lower',
        lower.questions,
        target,
        minutesFor(lower.questions.length),
        seed,
        lower.unscoredIds
      ),
    });
    diagnostics.sections.push({
      section,
      modules: [module1.diagnostics, upper.diagnostics, lower.diagnostics],
    });
  }

  return {
    assessment: assessmentStr,
    createdAt: new Date().toISOString(),
    sections,
    warnings,
    seed,
    breakMinutes: SECTION_BREAK_MINUTES,
    algorithmVersion: 2,
    diagnostics,
  };
}

/** Default entry point. `algorithm: 1` replays the original planner for saved attempts. */
export function buildTestPlan(all: Question[], options: TestPlanOptions): TestPlan {
  return (options.algorithm ?? 2) === 1 ? buildTestPlanV1(all, options) : buildTestPlanV2(all, options);
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
  seed: string,
  unscoredIds?: string[]
): ModulePlan {
  const spec = SECTION_SPECS[section];
  const unscoredCount = questions.length >= spec.fullItems ? spec.unscoredItems : 0;
  const chosen = unscoredIds ?? pickUnscoredIds(questions, unscoredCount, `${seed}:${section}:${tier}`);
  return {
    id: `${section === 'Math' ? 'math' : 'rw'}-${tier}`,
    section,
    tier,
    questions,
    unscoredQuestionIds: chosen.slice(0, unscoredCount),
    targetItems,
    minutes,
  };
}

function buildTestPlanV1(all: Question[], options: TestPlanOptions): TestPlan {
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
        isAssemblyEligible(q) &&
        // v1 is only used to replay attempts saved before the official pool
        // existed. Keep its exact curated draw so a resumed test is unchanged.
        !isCollegeBoardQuestion(q) &&
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
      preferOfficialWithin(source, `${seed}:${section}:${idx}`)
    );

    const usedM1 = new Set<string>();
    const module1 =
      section === 'Reading and Writing'
        ? buildRwModuleQuestionsV1(pool, usedM1, 'module1', target, `${seed}:${section}:module1`, maxHard)
        : buildMathModuleQuestionsV1(pool, usedM1, 'module1', target, assessmentStr, maxHard);

    const usedUpper = new Set<string>(usedM1);
    const upper =
      section === 'Reading and Writing'
        ? buildRwModuleQuestionsV1(pool, usedUpper, 'upper', target, `${seed}:${section}:upper`, maxHard)
        : buildMathModuleQuestionsV1(pool, usedUpper, 'upper', target, assessmentStr, maxHard);

    const usedLower = new Set<string>(usedUpper);
    const lower =
      section === 'Reading and Writing'
        ? buildRwModuleQuestionsV1(pool, usedLower, 'lower', target, `${seed}:${section}:lower`, maxHard)
        : buildMathModuleQuestionsV1(pool, usedLower, 'lower', target, assessmentStr, maxHard);

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
    algorithmVersion: 1,
  };
}

export function routeModule(module1Correct: number, module1Total: number): 'upper' | 'lower' {
  if (module1Total <= 0) return 'lower';
  return module1Correct / module1Total >= ROUTING_THRESHOLD ? 'upper' : 'lower';
}

/* ------------------------------------------------------------------------
 * Module flow ordering:
 * - Reading & Writing: canonical 4-domain sequence. v2 builds strict domain
 *   blocks; the legacy interleave helper remains only for saved v1 attempts:
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

export function orderModuleQuestions(
  questions: Question[],
  section: Section,
  algorithmVersion: PlanAlgorithmVersion = 2
): Question[] {
  if (section === 'Reading and Writing') {
    return questions
      .map((q, i) => ({ q, i }))
      .sort((a, b) => {
        const dA = RW_DOMAIN_ORDER[a.q.domain] ?? 1;
        const dB = RW_DOMAIN_ORDER[b.q.domain] ?? 1;
        if (dA !== dB) return dA - dB;
        // Standard English Conventions is ordered by difficulty only, across
        // Boundaries and Form, Structure, and Sense. The other three domains
        // keep their skill groups and scale within each group.
        if (algorithmVersion === 2 && a.q.domain === 'Standard English Conventions') {
          const diffA = DIFFICULTY_ORDER[a.q.difficulty] ?? 1;
          const diffB = DIFFICULTY_ORDER[b.q.difficulty] ?? 1;
          if (diffA !== diffB) return diffA - diffB;
          return a.i - b.i;
        }
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
  /**
   * Catalog browsing shows every item, including official rows reserved for a
   * full simulation. Practice draws leave this unset, so those items stay out
   * of a mixed session until a test deliberately uses them.
   */
  includePracticeTestOverlap?: boolean;
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
    // Practice-test overlap is review-only in a mixed draw; choosing the
    // official dataset explicitly opens the full official bank for deliberate
    // practice. Unusable rows stay out either way.
    if (isCollegeBoardQuestion(q)) {
      if (q.unusable) return false;
      if (
        q.in_practice_test &&
        filters.sourceId !== 'collegeboard-sat' &&
        !filters.includePracticeTestOverlap
      ) {
        return false;
      }
    }
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
  const freshPool = preferFreshFamilies(unseen, options.family);
  const working = [
    ...freshPool,
    ...due,
    ...(options.allowScheduled ? scheduled : []),
  ];
  const unseenCount = freshPool.length;

  const picked: Question[] = [];
  const usedIds = new Set<string>();
  const usedContent = new Set<string>();
  const usedTemplates = new Set<string>();
  const usedArchetypes = new Set<string>();
  const usedSkills = new Map<string, number>();
  const usedDomains = new Map<string, number>();

  // Among equally eligible unseen items, take the one whose skill and domain
  // are least represented so far. The old draw only stopped *adjacent*
  // repeats, so five Math slots could still all be linear equations; scoring
  // the whole session spreads them. Due reviews keep their original order.
  const pickIndex = (accept: (q: Question) => boolean): number => {
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let firstReview = -1;
    for (let i = 0; i < working.length; i += 1) {
      const q = working[i];
      if (usedIds.has(q.id) || !accept(q)) continue;
      if (i < unseenCount) {
        const score =
          (usedSkills.get(q.skill) ?? 0) * 100 +
          (usedDomains.get(q.domain) ?? 0) * 12;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      } else if (firstReview < 0) {
        firstReview = i;
      }
    }
    return bestIdx >= 0 ? bestIdx : firstReview;
  };

  for (let step = 0; step < count; step += 1) {
    const prev = picked[picked.length - 1];
    const unique = (q: Question) => {
      const cKey = questionContentKey(q);
      const sKey = questionStimulusKey(q);
      return (
        !usedContent.has(cKey) &&
        !(sKey && usedContent.has(sKey)) &&
        !usedTemplates.has(questionTemplateKey(q)) &&
        !usedArchetypes.has(questionArchetypeKey(q))
      );
    };
    // Pass 1: unique family, and never the same skill twice in a row.
    let bestIdx = pickIndex((q) => unique(q) && (!prev || prev.skill !== q.skill));
    // Pass 2: keep the family unique; allow a repeated skill only when no
    // different-skill item is left.
    if (bestIdx < 0) bestIdx = pickIndex(unique);
    // Pass 3: relax archetype on a very narrow pool, still no exact repeat.
    if (bestIdx < 0) {
      bestIdx = pickIndex((q) => {
        const cKey = questionContentKey(q);
        const sKey = questionStimulusKey(q);
        return (
          !usedContent.has(cKey) &&
          !(sKey && usedContent.has(sKey)) &&
          (!prev || questionArchetypeKey(prev) !== questionArchetypeKey(q))
        );
      });
    }
    // Final fallback: any unused ID.
    if (bestIdx < 0) bestIdx = working.findIndex((q) => !usedIds.has(q.id));
    if (bestIdx < 0) break;

    const chosen = working[bestIdx];
    picked.push(chosen);
    usedIds.add(chosen.id);
    usedContent.add(questionContentKey(chosen));
    const sKey = questionStimulusKey(chosen);
    if (sKey) usedContent.add(sKey);
    usedTemplates.add(questionTemplateKey(chosen));
    usedArchetypes.add(questionArchetypeKey(chosen));
    usedSkills.set(chosen.skill, (usedSkills.get(chosen.skill) ?? 0) + 1);
    usedDomains.set(chosen.domain, (usedDomains.get(chosen.domain) ?? 0) + 1);
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
  // Drills keep their existing source-neutral selection. The official dataset
  // is available through the source filter; selecting All blends both pools
  // without turning every drill into an official-only set.
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
