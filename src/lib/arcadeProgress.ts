import { seededShuffle } from './examEngine';
import type { Difficulty } from './types';

/**
 * Arcade progression is deliberately device-local.
 *
 * A game run always starts at room/turn one, but the *questions* do not reset:
 * every item the player has met is remembered, and only a first-try correct
 * answer raises that game's difficulty. This is the rule the Arcade brief
 * promises, and it is why a second run is not a rerun of the first.
 *
 * Ten thousand items never need a server round trip just to avoid repeating
 * eight of them. The cloud still receives the exact coins and the completed
 * session; this store only chooses what to ask next.
 */

export const ARCADE_PROGRESS_KEY = 'hdsat.arcade.progress.v2';

export type ArcadeGameKey =
  | 'interceptor'
  | 'talk'
  | 'vault'
  | 'sprint'
  | 'transitions'
  | 'vocab'
  | 'slope'
  | 'data'
  | 'grammar'
  | 'evidence'
  | 'boundaries'
  | 'words'
  | 'algebra'
  | 'boss';

interface GameProgress {
  /** First-try correct answers. Wrong answers never add a point. */
  points: number;
  plays: number;
}

interface ProgressStore {
  version: 2;
  /** Question ids already served in any Arcade game. */
  seen: string[];
  games: Partial<Record<ArcadeGameKey, GameProgress>>;
}

const EMPTY: ProgressStore = { version: 2, seen: [], games: {} };
const MAX_SEEN = 8000;

function load(): ProgressStore {
  if (typeof localStorage === 'undefined') return { ...EMPTY, games: {} };
  try {
    const raw = localStorage.getItem(ARCADE_PROGRESS_KEY);
    if (!raw) return { ...EMPTY, games: {} };
    const parsed = JSON.parse(raw) as Partial<ProgressStore> | null;
    if (!parsed || parsed.version !== 2) return { ...EMPTY, games: {} };
    return {
      version: 2,
      seen: Array.isArray(parsed.seen)
        ? parsed.seen.filter((id): id is string => typeof id === 'string').slice(-MAX_SEEN)
        : [],
      games: parsed.games && typeof parsed.games === 'object' ? parsed.games : {},
    };
  } catch {
    return { ...EMPTY, games: {} };
  }
}

function save(store: ProgressStore): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ARCADE_PROGRESS_KEY, JSON.stringify(store));
  } catch {
    /* private mode: the current run still works, it just cannot remember */
  }
}

export function arcadeLevel(game: ArcadeGameKey): number {
  const points = Math.max(0, load().games[game]?.points ?? 0);
  // Two clean first tries per rung: slow enough that the jump is earned, fast
  // enough that a regular player reaches the hard pool without a grind.
  return Math.min(10, 1 + Math.floor(points / 2));
}

export function arcadeProgressSnapshot(): {
  level: Record<string, number>;
  seen: number;
} {
  const store = load();
  const level: Record<string, number> = {};
  for (const [game, entry] of Object.entries(store.games)) {
    level[game] = Math.min(10, 1 + Math.floor(Math.max(0, entry?.points ?? 0) / 2));
  }
  return { level, seen: store.seen.length };
}

export function arcadeSeenIds(): string[] {
  return load().seen;
}

/**
 * Record the first answer to a question. `firstTryCorrect` must be true only
 * when the question was new to this game run and the first choice was right.
 * A question only ever contributes to the level once.
 */
export function markArcadeQuestion(
  game: ArcadeGameKey,
  questionId: string,
  firstTryCorrect: boolean
): { level: number; leveledUp: boolean; newQuestion: boolean } {
  const store = load();
  const seen = new Set(store.seen);
  const newQuestion = !seen.has(questionId);
  const before = arcadeLevel(game);

  if (newQuestion) {
    seen.add(questionId);
    store.seen = [...seen].slice(-MAX_SEEN);
  }

  const previous = store.games[game] ?? { points: 0, plays: 0 };
  const points = previous.points + (newQuestion && firstTryCorrect ? 1 : 0);
  store.games[game] = { points, plays: previous.plays };
  save(store);
  const level = Math.min(10, 1 + Math.floor(points / 2));
  return { level, leveledUp: level > before, newQuestion };
}

export function noteArcadeRun(game: ArcadeGameKey): void {
  const store = load();
  const previous = store.games[game] ?? { points: 0, plays: 0 };
  store.games[game] = { ...previous, plays: previous.plays + 1 };
  save(store);
}

/** The difficulty band this level should draw from. */
export function arcadeDifficultyBand(level: number): Difficulty[] {
  if (level <= 1) return ['Easy', 'Medium'];
  if (level <= 4) return ['Medium', 'Hard'];
  return ['Hard'];
}

function tierScore(difficulty: Difficulty, band: Difficulty[]): number {
  return band.includes(difficulty) ? 2 : 1;
}

/**
 * Pick questions for one arcade run.
 *
 * - unseen items always come first;
 * - the current level's difficulty band comes before the rest;
 * - a seed keeps the order fresh without making it non-reproducible;
 * - seen items only return after the unseen pool for this filter is exhausted.
 */
export function takeArcadeQuestions<T extends { id: string; difficulty: Difficulty }>(
  game: ArcadeGameKey,
  questions: T[],
  count: number,
  seed: string
): T[] {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0 || questions.length === 0) return [];
  const store = load();
  const seen = new Set(store.seen);
  const level = arcadeLevel(game);
  const band = arcadeDifficultyBand(level);
  const shuffle = (items: T[], tag: string) => seededShuffle(items, `${seed}:${game}:${tag}`);

  const fresh = questions.filter((question) => !seen.has(question.id));
  const preferred = shuffle(
    fresh.filter((question) => band.includes(question.difficulty)),
    'preferred'
  );
  const adjacent = shuffle(
    fresh.filter((question) => !band.includes(question.difficulty)),
    'adjacent'
  );
  const freshOrdered = [...preferred, ...adjacent];

  if (freshOrdered.length >= safeCount) return freshOrdered.slice(0, safeCount);

  // Only after every unseen item under this filter has been used do repeats
  // appear. The repeats are still ordered by the target band.
  const repeats = shuffle(
    questions.filter((question) => seen.has(question.id)),
    'repeat'
  ).sort((a, b) => tierScore(b.difficulty, band) - tierScore(a.difficulty, band));
  const ordered = [...freshOrdered, ...repeats];
  const unique: T[] = [];
  const used = new Set<string>();
  for (const question of ordered) {
    if (used.has(question.id)) continue;
    used.add(question.id);
    unique.push(question);
    if (unique.length >= safeCount) break;
  }
  return unique;
}

/** Difficulty label for the HUD, so the progression is visible, not guessed. */
export function arcadeLevelLabel(game: ArcadeGameKey): string {
  const level = arcadeLevel(game);
  if (level <= 1) return 'Foundation';
  if (level <= 2) return 'Building';
  if (level <= 4) return 'Advanced';
  if (level <= 6) return 'Hard';
  return 'Brutal';
}
