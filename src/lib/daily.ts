import {
  buildFamilyHistory,
  preferFreshFamilies,
  questionFamilyKeys,
  seededShuffle,
} from './examEngine';
import { isReviewDue } from './review';
import { todayKey } from './storage';
import type { Assessment, Question, QuestionProgress } from './types';

/**
 * Daily content: three arcade quests and one Hard Question of the Day.
 *
 * Everything here is deterministic from the calendar date, so the same student
 * sees the same set all day, a refresh never reshuffles it, and two students
 * browsing at the same time still get a different draw because the seed mixes
 * in their assessment and the bank revision. Nothing is stored on a server; the
 * progress records below are device-scoped.
 */

export const QUESTS_PER_DAY = 3;
export const QUEST_RW_COUNT = 5;
export const QUEST_MATH_COUNT = 5;
/** 3 quests x (5 R&W + 5 Math) is the whole arcade question allowance. */
export const DAILY_QUEST_QUESTION_CAP = QUESTS_PER_DAY * (QUEST_RW_COUNT + QUEST_MATH_COUNT);

export interface QuestDefinition {
  id: string;
  name: string;
  blurb: string;
  icon: 'flame' | 'bolt' | 'spark' | 'compass';
}

export const DAILY_QUESTS: QuestDefinition[] = [
  {
    id: 'warmup',
    name: 'Warm-Up Circuit',
    blurb: 'Five Reading & Writing plus five Math items to open the day.',
    icon: 'flame',
  },
  {
    id: 'precision',
    name: 'Precision Pass',
    blurb: 'A tighter mixed set — accuracy matters more than speed here.',
    icon: 'compass',
  },
  {
    id: 'gauntlet',
    name: 'Cold Read Gauntlet',
    blurb: 'Unseen texts and multi-step Math. The hardest of the three sets.',
    icon: 'bolt',
  },
];

export interface QuestProgress {
  answered: string[];
  correct: number;
  completedAt: string | null;
}

export type QuestState = Record<string, QuestProgress>;

const QUEST_KEY = 'hdsat.quests.v1';
const QUEST_ASSIGN_KEY = 'hdsat.quest.assign.v1';
const QOTD_PICK_KEY = 'hdsat.qotd.pick.v1';
const QOTD_DISMISS_KEY = 'hdsat.qotd.dismissed.v1';
const QOTD_SOLVED_KEY = 'hdsat.qotd.solved.v1';
const QOTD_OPEN_KEY = 'hdsat.qotd.open.v1';

function emptyProgress(): QuestProgress {
  return { answered: [], correct: 0, completedAt: null };
}

function readJson<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the in-memory session still works */
  }
}

interface QuestStore {
  date: string;
  quests: QuestState;
}

export function loadQuestState(date: string = todayKey()): QuestState {
  const stored = readJson<QuestStore>(QUEST_KEY);
  if (!stored || stored.date !== date || !stored.quests) return {};
  return stored.quests;
}

export function saveQuestProgress(
  questId: string,
  updater: (current: QuestProgress) => QuestProgress,
  date: string = todayKey()
): QuestState {
  const quests = loadQuestState(date);
  const next: QuestState = {
    ...quests,
    [questId]: updater(quests[questId] ?? emptyProgress()),
  };
  writeJson(QUEST_KEY, { date, quests: next } satisfies QuestStore);
  return next;
}

/**
 * One item per question family, preserving the draw order. Thirty quest items
 * drawn from the whole bank would otherwise occasionally land two variants of
 * the same template in the same day.
 */
function uniqueFamilies(pool: Question[]): Question[] {
  const used = new Set<string>();
  const out: Question[] = [];
  for (const q of pool) {
    const keys = questionFamilyKeys(q);
    if (keys.some((key) => used.has(key))) continue;
    for (const key of keys) used.add(key);
    out.push(q);
  }
  return out;
}

interface QuestAssignment {
  date: string;
  /** Whose draw this is. A different student on the same device gets their own. */
  seed?: string;
  quests: Record<string, string[]>;
}

export interface QuestDrawOptions {
  /** Student id, or a stable per-device key for a guest. */
  seed?: string;
  /** ISO date of the real test, if the student set one. */
  testDate?: string | null;
  now?: Date;
}

export interface QuestFocus {
  /** Items whose review date has arrived. */
  due: number;
  /** Domains under 70% with enough evidence to say so. */
  weakDomains: string[];
  daysToTest: number | null;
}

const QUEST_USER_KEY = 'hdsat.quest.user.v1';

/**
 * A stable identity for the day's draw. Signed-in students use their account
 * id; a guest gets one random key per browser, created once. Without this every
 * guest on every device would receive the same quest for the same assessment,
 * which is the opposite of "different for each user".
 */
export function questUserKey(userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const stored = readJson<string>(QUEST_USER_KEY);
  if (typeof stored === 'string' && stored.length > 8) return stored;
  const fresh = `d:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  writeJson(QUEST_USER_KEY, fresh);
  return fresh;
}

/**
 * Whole local calendar days from today to a `YYYY-MM-DD` date. Date-only math
 * avoids the off-by-one a late-evening `Math.ceil` on a 23:59:59 target gives
 * (39 days out read as 40), and it is DST-safe because both sides are UTC
 * midnights built from local date parts.
 */
export function daysUntilDate(dateKey: string, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** What today's quests are built from, for the one-line reason under each. */
export function questFocus(
  questions: Question[],
  progress: Record<string, QuestionProgress>,
  options: QuestDrawOptions = {}
): QuestFocus {
  const now = options.now ?? new Date();
  let due = 0;
  const domains = new Map<string, { seen: number; correct: number }>();
  for (const question of questions) {
    const record = progress[question.id];
    if (!record || record.attemptCount === 0) continue;
    if (isReviewDue(record, now)) due += 1;
    const entry = domains.get(question.domain) ?? { seen: 0, correct: 0 };
    entry.seen += record.attemptCount;
    entry.correct += record.correctCount;
    domains.set(question.domain, entry);
  }
  const weakDomains = [...domains.entries()]
    .filter(([, entry]) => entry.seen >= 3 && entry.correct / entry.seen < 0.7)
    .sort((a, b) => a[1].correct / a[1].seen - b[1].correct / b[1].seen)
    .map(([domain]) => domain)
    .slice(0, 3);

  let daysToTest: number | null = null;
  if (options.testDate) {
    const days = daysUntilDate(options.testDate, now);
    if (days !== null) daysToTest = Math.max(0, days);
  }
  return { due, weakDomains, daysToTest };
}

/**
 * The day's draw is frozen the first time it is built. Progress changes as the
 * student answers, so recomputing freshness on every render would reshuffle a
 * quest mid-run; the stored assignment keeps today's set fixed, as it always was.
 */
function loadAssignment(date: string, seed: string): QuestAssignment {
  const stored = readJson<QuestAssignment>(QUEST_ASSIGN_KEY);
  if (!stored || stored.date !== date || !stored.quests) return { date, seed, quests: {} };
  // A different student's draw must never be reused, even on the same device.
  if (stored.seed !== undefined && stored.seed !== seed) return { date, seed, quests: {} };
  return { ...stored, seed };
}

/**
 * Which quest wants which items. Each quest is a different drill, so each is
 * filled from a different slice of the student's own history:
 *   warmup    - reviews that are due, the openers of the day
 *   precision - the domains the student is weakest in
 *   gauntlet  - hard items, leaning on those same weak domains
 * Anything unfilled falls back to the rest of the eligible pool, so a brand-new
 * account still gets three complete quests.
 */
function questTiers(
  questId: string,
  pool: Question[],
  dueIds: Set<string>,
  weakDomains: Set<string>
): Question[][] {
  const due = pool.filter((q) => dueIds.has(q.id));
  const weak = pool.filter((q) => weakDomains.has(q.domain));
  const hard = pool.filter((q) => q.difficulty === 'Hard');
  const previouslySeen = (q: Question) => dueIds.has(q.id);
  // Freshness outranks every other rule (see preferFreshFamilies below), so
  // these tiers only decide order inside a freshness class. A due review is a
  // deliberate repeat and never displaces a question the student has not met.
  if (questId === 'precision') {
    return [weak.filter((q) => !previouslySeen(q)), weak, due];
  }
  if (questId === 'gauntlet') {
    // Hard items, weighted to the weakest domains. The test date changes the
    // wording under the quest (reason below), never the ordering rule.
    return [
      hard.filter((q) => weakDomains.has(q.domain) && !previouslySeen(q)),
      hard.filter((q) => weakDomains.has(q.domain)),
      hard.filter((q) => !previouslySeen(q)),
      hard,
      due,
    ];
  }
  return [weak.filter((q) => !previouslySeen(q)), weak, due];
}

export function questQuestionIds(
  questions: Question[],
  questId: string,
  assessment: Assessment,
  date: string = todayKey(),
  progress: Record<string, QuestionProgress> = {},
  options: QuestDrawOptions = {}
): string[] {
  const seed = options.seed ?? 'anon';
  const assignment = loadAssignment(date, seed);
  const known = new Set(questions.map((q) => q.id));
  const cached = (assignment.quests[questId] ?? []).filter((id) => known.has(id));
  if (cached.length > 0) return cached;

  const eligible = questions.filter((q) => q.assessments.includes(assessment));
  const history = buildFamilyHistory(questions, progress);
  const focus = questFocus(questions, progress, options);
  const weakDomains = new Set(focus.weakDomains);
  const now = options.now ?? new Date();
  const dueIds = new Set(
    questions
      .filter((q) => progress[q.id] && isReviewDue(progress[q.id], now))
      .map((q) => q.id)
  );
  const draw = (section: Question['section'], count: number, tag: string) => {
    const sectionPool = eligible.filter((q) => q.section === section);
    const stamp = `${seed}:${date}:${questId}:${tag}`;
    const ordered = questTiers(questId, sectionPool, dueIds, weakDomains).flatMap(
      (tier) => preferFreshFamilies(seededShuffle(tier, stamp), history)
    );
    const fallback = preferFreshFamilies(seededShuffle(sectionPool, `${stamp}:fill`), history);
    const seen = new Set<string>();
    const merged: Question[] = [];
    for (const q of [...ordered, ...fallback]) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      merged.push(q);
    }
    // One global freshness pass: fresh families first, near-duplicates only when
    // the fresh pool cannot fill the quest. This is the rule a student feels.
    return uniqueFamilies(preferFreshFamilies(merged, history)).slice(0, count);
  };
  const rw = draw('Reading and Writing', QUEST_RW_COUNT, 'rw');
  const math = draw('Math', QUEST_MATH_COUNT, 'math');
  // Interleave the two sections so a quest never feels like two separate drills.
  const out: string[] = [];
  for (let i = 0; i < Math.max(rw.length, math.length); i += 1) {
    if (rw[i]) out.push(rw[i].id);
    if (math[i]) out.push(math[i].id);
  }
  if (out.length > 0) {
    writeJson(QUEST_ASSIGN_KEY, {
      date,
      seed,
      quests: { ...assignment.quests, [questId]: out },
    } satisfies QuestAssignment);
  }
  return out;
}

/**
 * The single question that represents today. It prefers a genuinely Hard item,
 * but the pick is always returned with its real difficulty: an assessment with
 * no Hard items still gets a question, and the UI must never call it Hard.
 * Deterministic per date.
 */
export function dailyHardQuestion(
  questions: Question[],
  assessment: Assessment,
  date: string = todayKey(),
  progress: Record<string, QuestionProgress> = {}
): Question | null {
  const picked = readJson<{ date: string; id: string }>(QOTD_PICK_KEY);
  if (picked && picked.date === date) {
    const cached = questions.find((q) => q.id === picked.id);
    // A cached pick can predate a difficulty correction in the bank. Never keep
    // serving an easier item under the QOTD's "Hard" promise just because it
    // was selected yesterday.
    if (cached && cached.difficulty === 'Hard' && cached.assessments.includes(assessment)) {
      return cached;
    }
  }
  const eligible = questions.filter((q) => q.assessments.includes(assessment));
  const hard = eligible.filter((q) => q.difficulty === 'Hard');
  const pool = hard.length > 0 ? hard : eligible;
  if (pool.length === 0) return null;
  const history = buildFamilyHistory(questions, progress);
  const question =
    uniqueFamilies(
      preferFreshFamilies(seededShuffle(pool, `qotd:${date}:${assessment}`), history)
    )[0] ?? null;
  if (question) writeJson(QOTD_PICK_KEY, { date, id: question.id });
  return question;
}

export function isQuestionOfTheDayDismissed(date: string = todayKey()): boolean {
  return readJson<string>(QOTD_DISMISS_KEY) === date;
}

export function dismissQuestionOfTheDay(date: string = todayKey()): void {
  writeJson(QOTD_DISMISS_KEY, date);
}

export function isQuestionOfTheDaySolved(date: string = todayKey()): boolean {
  return readJson<string>(QOTD_SOLVED_KEY) === date;
}

export function markQuestionOfTheDaySolved(date: string = todayKey()): void {
  writeJson(QOTD_SOLVED_KEY, date);
}

/** Dashboard strip: whether it was left open, so a reload keeps the choice. */
export function isQuestionOfTheDayExpanded(): boolean {
  return readJson<boolean>(QOTD_OPEN_KEY) === true;
}

export function setQuestionOfTheDayExpanded(open: boolean): void {
  writeJson(QOTD_OPEN_KEY, open);
}
