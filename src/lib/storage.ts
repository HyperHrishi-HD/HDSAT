import { ACHIEVEMENTS, achievementById, normalizeAchievementIds } from './catalog';
import { checkAnswer } from './grading';
import { scheduleReview } from './sm2';
import type {
  AttemptMode,
  DailyActivity,
  Difficulty,
  LocalAttempt,
  LocalProfile,
  Question,
  QuestionProgress,
  RushScoreRecord,
  Section,
  TestAttempt,
} from './types';

/**
 * Guest-mode persistence. The rules implemented here deliberately mirror the
 * authoritative PL/pgSQL functions in supabase/migrations so that a guest's
 * history produces the same coins, streaks and mastery states after sync.
 */
export const STORAGE_KEY = 'hdsat.profile.v1';
export const PENDING_ACCOUNT_KEY = 'hdsat.pending-account.v1';
export const WELCOME_SEEN_KEY = 'hdsat.welcome-seen.v1';
export const INTRO_SEEN_KEY = 'hdsat.intro.seen.v1';
export const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DAILY_QUESTION_COIN_CAP = 60;
export const DAILY_FLASHCARD_COIN_CAP = 15;
const PROFILE_VERSION = 1;
const MAX_LOCAL_ATTEMPTS = 2000;
const MAX_LOCAL_TESTS = 2000;

export function todayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function newEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function emptyDay(date: string): DailyActivity {
  return {
    date,
    questionsCompleted: 0,
    correctQuestions: 0,
    learningMinutes: 0,
    flashcardsReviewed: 0,
    coinsEarned: 0,
    sessionsCompleted: 0,
  };
}

export function emptyProfile(): LocalProfile {
  return {
    version: PROFILE_VERSION,
    createdAt: new Date().toISOString(),
    hdCoins: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastActiveDate: null,
    dailyActivity: {},
    achievements: [],
    ownedItems: [],
    attempts: [],
    progress: {},
    saved: [],
    flashcards: {},
    testAttempts: [],
    rushScores: {},
    settings: {
      assessment: 'SAT',
      excludePreviouslyCorrect: false,
      excludeReleasedPracticeSet: false,
      timerSound: false,
      activeTheme: null,
      activeFlair: null,
    },
  };
}

export function loadProfile(): LocalProfile {
  if (typeof localStorage === 'undefined') return emptyProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as Partial<LocalProfile>;
    const base = emptyProfile();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      dailyActivity: parsed.dailyActivity ?? {},
      progress: parsed.progress ?? {},
      flashcards: parsed.flashcards ?? {},
      saved: parsed.saved ?? [],
      ownedItems: parsed.ownedItems ?? [],
      achievements: normalizeAchievementIds(parsed.achievements ?? []),
      attempts: parsed.attempts ?? [],
      testAttempts: parsed.testAttempts ?? [],
      rushScores: parsed.rushScores ?? {},
      version: PROFILE_VERSION,
    };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile: LocalProfile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const trimmed: LocalProfile = {
      ...profile,
      attempts: profile.attempts.slice(-MAX_LOCAL_ATTEMPTS),
      testAttempts: profile.testAttempts.slice(-MAX_LOCAL_TESTS),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full or unavailable: the in-memory profile stays authoritative */
  }
}

export function clearProfile(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * An account created with a password but not yet email-confirmed. The student
 * keeps practising on this device; the address is remembered for 24 hours so
 * the app can accept the 6-digit code and prevent duplicate Brevo emails
 * within the same 24-hour window.
 */
export interface PendingAccount {
  email: string;
  displayName: string;
  createdAt: string;
  sentAt: number;
  expiresAt: number;
}

let memoryPendingAccount: PendingAccount | null = null;
let memoryIntroSeen = false;

export function loadPendingAccount(now: number = Date.now()): PendingAccount | null {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(PENDING_ACCOUNT_KEY) : null;
    const parsed: Partial<PendingAccount> | null = raw
      ? (JSON.parse(raw) as Partial<PendingAccount>)
      : memoryPendingAccount;
    if (!parsed || !parsed.email) return null;
    const createdMs = parsed.createdAt ? new Date(parsed.createdAt).getTime() : now;
    const sentAt = typeof parsed.sentAt === 'number' && parsed.sentAt > 0 ? parsed.sentAt : createdMs;
    const expiresAt =
      typeof parsed.expiresAt === 'number' && parsed.expiresAt > 0
        ? parsed.expiresAt
        : sentAt + EMAIL_WINDOW_MS;
    if (now >= expiresAt) {
      memoryPendingAccount = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(PENDING_ACCOUNT_KEY);
      }
      return null;
    }
    return {
      email: String(parsed.email),
      displayName: String(parsed.displayName ?? 'Student'),
      createdAt: String(parsed.createdAt ?? new Date(sentAt).toISOString()),
      sentAt,
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function savePendingAccount(
  account: Pick<PendingAccount, 'email' | 'displayName'> & Partial<PendingAccount>,
  now: number = Date.now()
): PendingAccount {
  const sentAt = account.sentAt ?? now;
  const expiresAt = account.expiresAt ?? sentAt + EMAIL_WINDOW_MS;
  const full: PendingAccount = {
    email: account.email.trim(),
    displayName: account.displayName || 'Student',
    createdAt: account.createdAt ?? new Date(sentAt).toISOString(),
    sentAt,
    expiresAt,
  };
  memoryPendingAccount = full;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PENDING_ACCOUNT_KEY, JSON.stringify(full));
    } catch {
      /* storage unavailable: the in-memory state still explains the situation */
    }
  }
  return full;
}

export function canSendVerificationEmail(
  email: string,
  now: number = Date.now()
): { allowed: boolean; remainingMs: number; existing: PendingAccount | null } {
  const existing = loadPendingAccount(now);
  if (
    existing &&
    existing.email.trim().toLowerCase() === email.trim().toLowerCase() &&
    now < existing.expiresAt
  ) {
    return {
      allowed: false,
      remainingMs: Math.max(0, existing.expiresAt - now),
      existing,
    };
  }
  return { allowed: true, remainingMs: 0, existing };
}

export function formatRemainingHours(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function clearPendingAccount(): void {
  memoryPendingAccount = null;
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PENDING_ACCOUNT_KEY);
}

export function hasSeenIntro(): boolean {
  if (typeof localStorage === 'undefined') return memoryIntroSeen;
  return Boolean(localStorage.getItem(INTRO_SEEN_KEY)) || memoryIntroSeen;
}

export function markIntroSeen(): void {
  memoryIntroSeen = true;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(INTRO_SEEN_KEY, new Date().toISOString());
  } catch {
    /* ignore quota errors */
  }
}

export function hasSeenWelcome(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return Boolean(localStorage.getItem(WELCOME_SEEN_KEY));
}

export function markWelcomeSeen(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, new Date().toISOString());
  } catch {
    /* ignore quota errors */
  }
}

function withDay(profile: LocalProfile, date: string): LocalProfile {
  if (profile.dailyActivity[date]) return profile;
  return { ...profile, dailyActivity: { ...profile.dailyActivity, [date]: emptyDay(date) } };
}

function bumpDay(profile: LocalProfile, date: string, delta: Partial<DailyActivity>): LocalProfile {
  const current = profile.dailyActivity[date] ?? emptyDay(date);
  const next: DailyActivity = {
    ...current,
    questionsCompleted: current.questionsCompleted + (delta.questionsCompleted ?? 0),
    correctQuestions: current.correctQuestions + (delta.correctQuestions ?? 0),
    learningMinutes: current.learningMinutes + (delta.learningMinutes ?? 0),
    flashcardsReviewed: current.flashcardsReviewed + (delta.flashcardsReviewed ?? 0),
    coinsEarned: current.coinsEarned + (delta.coinsEarned ?? 0),
    sessionsCompleted: current.sessionsCompleted + (delta.sessionsCompleted ?? 0),
  };
  return { ...profile, dailyActivity: { ...profile.dailyActivity, [date]: next } };
}

function previousDateKey(date: Date): string {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() - 1);
  return todayKey(copy);
}

export function updateStreak(profile: LocalProfile, date: string): LocalProfile {
  if (profile.lastActiveDate === date) return profile;
  const yesterday = previousDateKey(new Date(`${date}T12:00:00`));
  const current = profile.lastActiveDate === yesterday ? profile.currentStreak + 1 : 1;
  return {
    ...profile,
    currentStreak: current,
    bestStreak: Math.max(profile.bestStreak, current),
    lastActiveDate: date,
  };
}

export interface AttemptOutcome {
  profile: LocalProfile;
  isCorrect: boolean;
  coinsAwarded: number;
  duplicate: boolean;
  progress: QuestionProgress;
  unlocked: string[];
}

export interface AttemptMeta {
  mode: AttemptMode;
  timeSpentSeconds?: number;
  sessionId?: string | null;
  eventId?: string;
  date?: Date;
}

export function applyAttempt(
  profile: LocalProfile,
  question: Question,
  response: string,
  meta: AttemptMeta
): AttemptOutcome {
  const now = meta.date ?? new Date();
  const date = todayKey(now);
  const eventId = meta.eventId ?? newEventId();

  if (profile.attempts.some((attempt) => attempt.eventId === eventId)) {
    return {
      profile,
      isCorrect: profile.progress[question.id]?.lastIsCorrect ?? false,
      coinsAwarded: 0,
      duplicate: true,
      progress:
        profile.progress[question.id] ??
        ({
          questionId: question.id,
          attemptCount: 0,
          correctCount: 0,
          consecutiveCorrect: 0,
          status: 'unseen',
          lastResponse: '',
          lastIsCorrect: false,
          lastAttemptedAt: '',
        } as QuestionProgress),
      unlocked: [],
    };
  }

  const isCorrect = checkAnswer(question, response);
  const existing = profile.progress[question.id];
  const isFirstAttempt = !existing;
  const wasPreviouslyCorrect = (existing?.correctCount ?? 0) > 0;
  const consecutive = isCorrect ? (existing?.consecutiveCorrect ?? 0) + 1 : 0;
  const status: QuestionProgress['status'] = consecutive >= 2 ? 'mastered' : isCorrect ? 'correct' : 'incorrect';
  const progress: QuestionProgress = {
    questionId: question.id,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    correctCount: (existing?.correctCount ?? 0) + (isCorrect ? 1 : 0),
    consecutiveCorrect: consecutive,
    status,
    lastResponse: response,
    lastIsCorrect: isCorrect,
    lastAttemptedAt: now.toISOString(),
  };

  const attempt: LocalAttempt = {
    eventId,
    questionId: question.id,
    response,
    isCorrect,
    mode: meta.mode,
    difficulty: question.difficulty as Difficulty,
    section: question.section as Section,
    timeSpentSeconds: Math.max(0, Math.round(meta.timeSpentSeconds ?? 0)),
    createdAt: now.toISOString(),
    sessionId: meta.sessionId ?? null,
  };

  let next: LocalProfile = withDay(profile, date);
  next = {
    ...next,
    progress: { ...next.progress, [question.id]: progress },
    attempts: [...next.attempts, attempt],
  };
  next = bumpDay(next, date, {
    questionsCompleted: 1,
    correctQuestions: isCorrect ? 1 : 0,
    learningMinutes: Math.max(0, Math.min(10, Math.round((meta.timeSpentSeconds ?? 0) / 60))),
  });

  // HDCoins: 1 for the first attempt on a question, 1 more for the first correct
  // answer on that question, both capped by the shared daily question cap.
  let coinsAwarded = 0;
  const coinsToday = next.dailyActivity[date]?.coinsEarned ?? 0;
  if (coinsToday < DAILY_QUESTION_COIN_CAP) {
    if (isFirstAttempt) coinsAwarded += 1;
    if (isCorrect && !wasPreviouslyCorrect) coinsAwarded += 1;
  }

  next = updateStreak(next, date);
  if (coinsAwarded > 0) {
    next = { ...next, hdCoins: next.hdCoins + coinsAwarded };
    next = bumpDay(next, date, { coinsEarned: coinsAwarded });
  }

  const unlocked = evaluateAchievements(next, profile.achievements);
  if (unlocked.length > 0) {
    const bonus = unlocked.reduce((sum, id) => sum + (achievementById(id)?.rewardCoins ?? 0), 0);
    next = {
      ...next,
      achievements: [...next.achievements, ...unlocked],
      hdCoins: next.hdCoins + bonus,
    };
    if (bonus > 0) {
      next = bumpDay(next, date, { coinsEarned: bonus });
    }
  }

  return { profile: next, isCorrect, coinsAwarded, duplicate: false, progress, unlocked };
}

export function applyFlashcardReview(
  profile: LocalProfile,
  cardId: string,
  quality: number,
  now: Date = new Date()
): { profile: LocalProfile; coinsAwarded: number } {
  const date = todayKey(now);
  const previous = profile.flashcards[cardId];
  const wasDue = !previous || new Date(previous.nextDueAt).getTime() <= now.getTime() + 5 * 60 * 1000;
  const outcome = scheduleReview(previous, quality, now);

  let next: LocalProfile = withDay(profile, date);
  next = {
    ...next,
    flashcards: {
      ...next.flashcards,
      [cardId]: {
        cardId,
        stage: outcome.stage,
        repetitions: outcome.repetitions,
        intervalDays: outcome.intervalDays,
        easeFactor: outcome.easeFactor,
        lastQuality: Math.max(0, Math.min(5, Math.round(quality))),
        nextDueAt: outcome.nextDueAt,
        lastReviewedAt: now.toISOString(),
      },
    },
  };
  next = bumpDay(next, date, { flashcardsReviewed: 1 });

  const coinsToday = next.dailyActivity[date]?.coinsEarned ?? 0;
  const alreadyRewarded = next.attempts.some(
    (attempt) => attempt.mode === 'review' && attempt.questionId === cardId && attempt.createdAt.slice(0, 10) === date
  );
  let coinsAwarded = 0;
  if (wasDue && !alreadyRewarded && coinsToday < DAILY_FLASHCARD_COIN_CAP) {
    coinsAwarded = 1;
    next = { ...next, hdCoins: next.hdCoins + 1 };
    next = bumpDay(next, date, { coinsEarned: coinsAwarded });
  }

  const unlocked = evaluateAchievements(next, profile.achievements);
  if (unlocked.length > 0) {
    const bonus = unlocked.reduce((sum, id) => sum + (achievementById(id)?.rewardCoins ?? 0), 0);
    next = {
      ...next,
      achievements: [...next.achievements, ...unlocked],
      hdCoins: next.hdCoins + bonus,
    };
    if (bonus > 0) {
      next = bumpDay(next, date, { coinsEarned: bonus });
    }
  }
  return { profile: next, coinsAwarded };
}

export function recordTestAttempt(profile: LocalProfile, attempt: TestAttempt): LocalProfile {
  const date = todayKey(new Date(attempt.createdAt));
  let next: LocalProfile = withDay(profile, date);
  const existingIdx = next.testAttempts.findIndex((item) => item.id === attempt.id);
  const updatedAttempts =
    existingIdx >= 0
      ? next.testAttempts.map((item, idx) => (idx === existingIdx ? attempt : item))
      : [...next.testAttempts, attempt];
  next = {
    ...next,
    testAttempts: updatedAttempts,
  };
  if (attempt.status !== 'incomplete') {
    next = bumpDay(next, date, { sessionsCompleted: 1 });
    const unlocked = evaluateAchievements(next, profile.achievements);
    if (unlocked.length > 0) {
      const bonus = unlocked.reduce((sum, id) => sum + (achievementById(id)?.rewardCoins ?? 0), 0);
      next = {
        ...next,
        achievements: [...next.achievements, ...unlocked],
        hdCoins: next.hdCoins + bonus,
      };
      if (bonus > 0) next = bumpDay(next, date, { coinsEarned: bonus });
    }
  }
  return next;
}

/**
 * Records one Practice Rush run against its exact settings combination. Best
 * only moves up; the last score always shows the most recent run.
 */
export function recordRushScore(
  profile: LocalProfile,
  key: string,
  score: number,
  now: Date = new Date()
): { profile: LocalProfile; record: RushScoreRecord; improved: boolean } {
  const safeScore = Math.max(0, Math.round(score));
  const previous = profile.rushScores[key];
  const timestamp = now.toISOString();
  const previousBest = previous?.best ?? 0;
  const improved = Boolean(previous) && safeScore > previousBest;
  const record: RushScoreRecord = {
    best: Math.max(previousBest, safeScore),
    last: safeScore,
    bestAt: improved ? timestamp : previous?.bestAt ?? timestamp,
    lastAt: timestamp,
    plays: (previous?.plays ?? 0) + 1,
  };
  return {
    profile: { ...profile, rushScores: { ...profile.rushScores, [key]: record } },
    record,
    improved,
  };
}

export function toggleSaved(profile: LocalProfile, questionId: string): LocalProfile {
  const has = profile.saved.includes(questionId);
  return {
    ...profile,
    saved: has ? profile.saved.filter((id) => id !== questionId) : [...profile.saved, questionId],
  };
}

export function purchaseItem(
  profile: LocalProfile,
  itemId: string,
  cost: number
): { profile: LocalProfile; ok: boolean; reason?: string } {
  if (profile.ownedItems.includes(itemId)) {
    return { profile, ok: false, reason: 'You already own this item.' };
  }
  if (profile.hdCoins < cost) {
    return { profile, ok: false, reason: 'Not enough HDCoins yet.' };
  }
  const isBadge = itemId.startsWith('badge-');
  const nextSettings = {
    ...profile.settings,
    ...(isBadge ? { activeFlair: itemId } : { activeTheme: itemId }),
  };
  return {
    profile: {
      ...profile,
      hdCoins: profile.hdCoins - cost,
      ownedItems: [...profile.ownedItems, itemId],
      settings: nextSettings,
    },
    ok: true,
  };
}

export function evaluateAchievements(profile: LocalProfile, alreadyUnlocked: string[]): string[] {
  const owned = new Set(alreadyUnlocked);
  const unlocked: string[] = [];
  const totalAttempts = profile.attempts.length;
  const flashcardsReviewed = Object.keys(profile.flashcards).length;
  const mastered = Object.values(profile.progress).filter((p) => p.status === 'mastered').length;
  const rushCorrect = profile.attempts.filter((a) => a.mode === 'rush' && a.isCorrect).length;

  const grant = (id: string, condition: boolean) => {
    if (condition && !owned.has(id) && !unlocked.includes(id)) unlocked.push(id);
  };

  grant('first-steps', totalAttempts >= 1);
  grant('ten-questions', totalAttempts >= 10);
  grant('fifty-questions', totalAttempts >= 50);
  grant('streak-3', profile.currentStreak >= 3);
  grant('streak-7', profile.currentStreak >= 7);
  grant('flashcard-10', flashcardsReviewed >= 10);
  grant('flashcard-50', flashcardsReviewed >= 50);
  grant('first-test', profile.testAttempts.length >= 1);
  grant('rush-10', rushCorrect >= 10);
  grant('coin-100', profile.hdCoins >= 100);
  grant('mastery-5', mastered >= 5);
  return unlocked.filter((id) => ACHIEVEMENTS.some((a) => a.id === id));
}

export function perfectModuleAchievement(
  profile: LocalProfile,
  modules: { correct: number; total: number }[]
): LocalProfile {
  if (!modules.some((m) => m.total > 0 && m.correct === m.total)) return profile;
  if (profile.achievements.includes('perfect-module')) return profile;
  const bonus = achievementById('perfect-module')?.rewardCoins ?? 0;
  return {
    ...profile,
    achievements: [...profile.achievements, 'perfect-module'],
    hdCoins: profile.hdCoins + bonus,
  };
}
