import { seededShuffle } from './examEngine';
import { todayKey } from './storage';
import type { Assessment, Question } from './types';

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
const QOTD_DISMISS_KEY = 'hdsat.qotd.dismissed.v1';
const QOTD_SOLVED_KEY = 'hdsat.qotd.solved.v1';

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

export function questQuestionIds(
  questions: Question[],
  questId: string,
  assessment: Assessment,
  date: string = todayKey()
): string[] {
  const eligible = questions.filter((q) => q.assessments.includes(assessment));
  const rw = seededShuffle(
    eligible.filter((q) => q.section === 'Reading and Writing'),
    `${date}:${questId}:rw`
  ).slice(0, QUEST_RW_COUNT);
  const math = seededShuffle(
    eligible.filter((q) => q.section === 'Math'),
    `${date}:${questId}:math`
  ).slice(0, QUEST_MATH_COUNT);
  // Interleave the two sections so a quest never feels like two separate drills.
  const out: string[] = [];
  for (let i = 0; i < Math.max(rw.length, math.length); i += 1) {
    if (rw[i]) out.push(rw[i].id);
    if (math[i]) out.push(math[i].id);
  }
  return out;
}

/** The single Hard item that represents today. Deterministic per date. */
export function dailyHardQuestion(
  questions: Question[],
  assessment: Assessment,
  date: string = todayKey()
): Question | null {
  const eligible = questions.filter((q) => q.assessments.includes(assessment));
  const hard = eligible.filter((q) => q.difficulty === 'Hard');
  const pool = hard.length > 0 ? hard : eligible;
  if (pool.length === 0) return null;
  return seededShuffle(pool, `qotd:${date}:${assessment}`)[0] ?? null;
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
