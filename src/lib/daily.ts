import {
  buildFamilyHistory,
  preferFreshFamilies,
  questionFamilyKeys,
  seededShuffle,
} from './examEngine';
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
  quests: Record<string, string[]>;
}

/**
 * The day's draw is frozen the first time it is built. Progress changes as the
 * student answers, so recomputing freshness on every render would reshuffle a
 * quest mid-run; the stored assignment keeps today's set fixed, as it always was.
 */
function loadAssignment(date: string): QuestAssignment {
  const stored = readJson<QuestAssignment>(QUEST_ASSIGN_KEY);
  if (!stored || stored.date !== date || !stored.quests) return { date, quests: {} };
  return stored;
}

export function questQuestionIds(
  questions: Question[],
  questId: string,
  assessment: Assessment,
  date: string = todayKey(),
  progress: Record<string, QuestionProgress> = {}
): string[] {
  const assignment = loadAssignment(date);
  const known = new Set(questions.map((q) => q.id));
  const cached = (assignment.quests[questId] ?? []).filter((id) => known.has(id));
  if (cached.length > 0) return cached;

  const eligible = questions.filter((q) => q.assessments.includes(assessment));
  const history = buildFamilyHistory(questions, progress);
  const draw = (section: Question['section'], count: number, tag: string) =>
    uniqueFamilies(
      preferFreshFamilies(
        seededShuffle(
          eligible.filter((q) => q.section === section),
          `${date}:${questId}:${tag}`
        ),
        history
      )
    ).slice(0, count);
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
      quests: { ...assignment.quests, [questId]: out },
    } satisfies QuestAssignment);
  }
  return out;
}

/** The single Hard item that represents today. Deterministic per date. */
export function dailyHardQuestion(
  questions: Question[],
  assessment: Assessment,
  date: string = todayKey(),
  progress: Record<string, QuestionProgress> = {}
): Question | null {
  const picked = readJson<{ date: string; id: string }>(QOTD_PICK_KEY);
  if (picked && picked.date === date) {
    const cached = questions.find((q) => q.id === picked.id);
    if (cached) return cached;
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
