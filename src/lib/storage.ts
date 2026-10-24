import { ACHIEVEMENTS, achievementById, itemById, normalizeAchievementIds } from './catalog';
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
  TestScoreEntry,
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
const MAX_LOCAL_SCORE_LOG = 400;

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
    lifetimeCoins: 0,
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
    testScoreLog: [],
    rushScores: {},
    settings: {
      assessment: 'SAT',
      testDate: null,
      excludePreviouslyCorrect: false,
      excludeReleasedPracticeSet: false,
      timerSound: false,
      activeTheme: null,
      activeFlair: null,
    },
  };
}

/**
 * True once this browser has a profile at all (even an empty one). That is what
 * tells the starting homepage apart from a returning student.
 */
export function hasStoredProfile(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * One-way door out of the starting homepage: the visitor chose to begin, so a
 * profile now exists and the homepage never returns. It writes an empty profile
 * rather than a flag so the rest of the app has one source of truth.
 */
export function markEntered(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyProfile()));
    }
  } catch {
    /* storage disabled: the homepage simply shows again next time */
  }
}

export function loadProfile(): LocalProfile {
  if (typeof localStorage === 'undefined') return emptyProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as Partial<LocalProfile>;
    const base = emptyProfile();
    // Older profiles never counted lifetime earnings. The best reconstruction
    // is the balance plus what was spent on the themes they now own.
    const spent = (parsed.ownedItems ?? []).reduce(
      (sum, id) => sum + (itemById(id)?.cost ?? 0),
      0
    );
    return {
      ...base,
      ...parsed,
      hdCoins: parsed.hdCoins ?? 0,
      lifetimeCoins: parsed.lifetimeCoins ?? (parsed.hdCoins ?? 0) + spent,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      dailyActivity: parsed.dailyActivity ?? {},
      progress: parsed.progress ?? {},
      flashcards: parsed.flashcards ?? {},
      saved: parsed.saved ?? [],
      ownedItems: parsed.ownedItems ?? [],
      achievements: normalizeAchievementIds(parsed.achievements ?? []),
      attempts: parsed.attempts ?? [],
      testAttempts: parsed.testAttempts ?? [],
      testScoreLog: parsed.testScoreLog ?? [],
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
      testScoreLog: profile.testScoreLog.slice(-MAX_LOCAL_SCORE_LOG),
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

/*
 * Guest sign-in nudge: a thin banner at the top of the Dashboard that offers to
 * save progress across devices. It is shown at most twice in a browser's life.
 * The first dismissal covers the visit; the second appearance waits for the
 * next visit (a new page load), and the second dismissal retires it for good.
 */
export const SYNC_NUDGE_KEY = 'hdsat.sync-nudge.v1';
export const SYNC_NUDGE_VISIT_KEY = 'hdsat.visit.v1';
export const SYNC_NUDGE_LIMIT = 2;

interface SyncNudgeState {
  dismissals: number;
  dismissedVisit: string | null;
}

function currentVisit(): string {
  if (typeof sessionStorage === 'undefined') return '';
  try {
    const existing = sessionStorage.getItem(SYNC_NUDGE_VISIT_KEY);
    if (existing) return existing;
    const fresh = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SYNC_NUDGE_VISIT_KEY, fresh);
    return fresh;
  } catch {
    return '';
  }
}

export function loadSyncNudge(): SyncNudgeState {
  if (typeof localStorage === 'undefined') return { dismissals: 0, dismissedVisit: null };
  try {
    const raw = localStorage.getItem(SYNC_NUDGE_KEY);
    if (!raw) return { dismissals: 0, dismissedVisit: null };
    const parsed = JSON.parse(raw) as Partial<SyncNudgeState>;
    const dismissals = Math.max(0, Math.min(SYNC_NUDGE_LIMIT, Number(parsed.dismissals) || 0));
    return { dismissals, dismissedVisit: parsed.dismissedVisit ?? null };
  } catch {
    return { dismissals: 0, dismissedVisit: null };
  }
}

export function shouldShowSyncNudge(): boolean {
  const state = loadSyncNudge();
  if (state.dismissals >= SYNC_NUDGE_LIMIT) return false;
  if (state.dismissals === 0) return true;
  // The second showing is a second visit, never the moment it was dismissed.
  return state.dismissedVisit !== currentVisit();
}

export function dismissSyncNudge(): void {
  if (typeof localStorage === 'undefined') return;
  const state = loadSyncNudge();
  try {
    localStorage.setItem(
      SYNC_NUDGE_KEY,
      JSON.stringify({
        dismissals: Math.min(SYNC_NUDGE_LIMIT, state.dismissals + 1),
        dismissedVisit: currentVisit(),
      })
    );
  } catch {
    /* storage disabled: the banner simply shows again next visit */
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

/**
 * One place where coins are credited, so the spendable balance and the
 * lifetime total can never drift apart. Spending goes through purchaseItem.
 */
function withEarned(profile: LocalProfile, amount: number): LocalProfile {
  if (!Number.isFinite(amount) || amount <= 0) return profile;
  return {
    ...profile,
    hdCoins: profile.hdCoins + amount,
    lifetimeCoins: profile.lifetimeCoins + amount,
  };
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
    next = withEarned(next, coinsAwarded);
    next = bumpDay(next, date, { coinsEarned: coinsAwarded });
  }

  const unlocked = evaluateAchievements(next, profile.achievements);
  if (unlocked.length > 0) {
    const bonus = unlocked.reduce((sum, id) => sum + (achievementById(id)?.rewardCoins ?? 0), 0);
    next = {
      ...next,
      achievements: [...next.achievements, ...unlocked],
      hdCoins: next.hdCoins + bonus,
      lifetimeCoins: next.lifetimeCoins + bonus,
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
    next = withEarned(next, 1);
    next = bumpDay(next, date, { coinsEarned: coinsAwarded });
  }

  const unlocked = evaluateAchievements(next, profile.achievements);
  if (unlocked.length > 0) {
    const bonus = unlocked.reduce((sum, id) => sum + (achievementById(id)?.rewardCoins ?? 0), 0);
    next = {
      ...next,
      achievements: [...next.achievements, ...unlocked],
      hdCoins: next.hdCoins + bonus,
      lifetimeCoins: next.lifetimeCoins + bonus,
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
        lifetimeCoins: next.lifetimeCoins + bonus,
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
/**
 * Deletes a saved simulation and keeps its score in a one-line log.
 *
 * The score is the only thing worth keeping once the run is gone: the modules
 * and per-item responses are exactly what the student asked to remove. An
 * unfinished run never had a score, so it leaves nothing behind.
 */
export function deleteTestAttempt(
  profile: LocalProfile,
  attemptId: string
): { profile: LocalProfile; entry: TestScoreEntry | null } {
  const attempt = profile.testAttempts.find((item) => item.id === attemptId);
  if (!attempt) return { profile, entry: null };
  const finished = attempt.status !== 'incomplete' && attempt.totalEstimate !== null;
  const entry: TestScoreEntry | null = finished
    ? {
        id: attempt.id,
        createdAt: attempt.createdAt,
        assessment: attempt.assessment,
        total: attempt.totalEstimate,
        rw: attempt.rwEstimate,
        math: attempt.mathEstimate,
        rawCorrect: attempt.modules.reduce((sum, m) => sum + m.correct, 0),
        rawTotal: attempt.modules.reduce((sum, m) => sum + m.total, 0),
        durationSeconds: attempt.durationSeconds,
      }
    : null;
  return {
    profile: {
      ...profile,
      testAttempts: profile.testAttempts.filter((item) => item.id !== attemptId),
      testScoreLog: entry ? mergeScoreLog(profile.testScoreLog, entry) : profile.testScoreLog,
    },
    entry,
  };
}

/** One entry per deleted attempt, newest last, deduplicated by attempt id. */
export function mergeScoreLog(
  log: TestScoreEntry[],
  entry: TestScoreEntry
): TestScoreEntry[] {
  const without = log.filter((item) => item.id !== entry.id);
  return [...without, entry].slice(-MAX_LOCAL_SCORE_LOG);
}

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

/**
 * Guest-mode parity with the cloud's `complete_activity_session` rewards.
 *
 * A local session reward ledger keeps the same per-category daily caps the
 * database enforces, so a guest cannot farm HDCoins by replaying the Arcade and
 * a signed-in student sees the same numbers on both paths.
 */
export const SESSION_LEDGER_KEY = 'hdsat.session-rewards.v1';
export const SESSION_REWARD_CAPS: Record<string, number> = {
  practice_rush: 4,
  timed_session: 3,
  full_simulation: 2,
  mini_game: 5,
};

interface SessionLedger {
  date: string;
  counts: Record<string, number>;
}

function loadSessionLedger(date: string): SessionLedger {
  if (typeof localStorage === 'undefined') return { date, counts: {} };
  try {
    const raw = localStorage.getItem(SESSION_LEDGER_KEY);
    if (!raw) return { date, counts: {} };
    const parsed = JSON.parse(raw) as Partial<SessionLedger>;
    if (parsed.date !== date) return { date, counts: {} };
    return { date, counts: parsed.counts ?? {} };
  } catch {
    return { date, counts: {} };
  }
}

function saveSessionLedger(ledger: SessionLedger): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SESSION_LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    /* storage unavailable: the reward simply is not repeated this session */
  }
}

export type SessionActivityType = 'practice_rush' | 'timed_session' | 'full_simulation' | 'mini_game';

export function awardSessionCoins(
  profile: LocalProfile,
  args: {
    activityType: SessionActivityType;
    questions: number;
    correct: number;
    sessionId: string;
  },
  now: Date = new Date()
): { profile: LocalProfile; coinsAwarded: number; runsToday: number } {
  const date = todayKey(now);
  const ledger = loadSessionLedger(date);
  const runsToday = ledger.counts[args.activityType] ?? 0;
  const cap = SESSION_REWARD_CAPS[args.activityType] ?? 0;
  let reward = 0;

  if (args.questions >= 3 && runsToday < cap) {
    if (args.activityType === 'practice_rush') reward = 5;
    else if (args.activityType === 'timed_session') {
      reward = Math.min(15, Math.max(5, Math.round(args.questions * 0.6)));
    } else if (args.activityType === 'full_simulation') reward = 25;
    else if (args.activityType === 'mini_game' && args.correct >= 3) reward = 4;
  }

  // The ledger records a rewarded run only, so a failed run never eats a slot.
  if (reward > 0) saveSessionLedger({ date, counts: { ...ledger.counts, [args.activityType]: runsToday + 1 } });

  let next: LocalProfile = withDay(profile, date);
  if (reward > 0) {
    next = {
      ...next,
      hdCoins: next.hdCoins + reward,
      lifetimeCoins: next.lifetimeCoins + reward,
      dailyActivity: {
        ...next.dailyActivity,
        [date]: {
          ...(next.dailyActivity[date] ?? emptyDay(date)),
          coinsEarned: (next.dailyActivity[date]?.coinsEarned ?? 0) + reward,
          sessionsCompleted: (next.dailyActivity[date]?.sessionsCompleted ?? 0) + 1,
        },
      },
    };
  }
  return { profile: next, coinsAwarded: reward, runsToday: runsToday + (reward > 0 ? 1 : 0) };
}

export function toggleSaved(profile: LocalProfile, questionId: string): LocalProfile {
  const has = profile.saved.includes(questionId);
  return {
    ...profile,
    saved: has ? profile.saved.filter((id) => id !== questionId) : [...profile.saved, questionId],
  };
}

/**
 * Themes are the only purchasable cosmetic. Emblems are proof of an earned
 * achievement, so buying one is refused here as well as in the database.
 */
export function purchaseItem(
  profile: LocalProfile,
  itemId: string,
  cost: number
): { profile: LocalProfile; ok: boolean; reason?: string } {
  const item = itemById(itemId);
  if (!item || item.slot !== 'theme') {
    return { profile, ok: false, reason: 'Emblems are earned through achievements, not purchased.' };
  }
  if (profile.ownedItems.includes(item.id)) {
    return { profile, ok: false, reason: 'You already own this theme.' };
  }
  const price = Math.max(0, item.cost || cost);
  if (profile.hdCoins < price) {
    return { profile, ok: false, reason: 'Not enough HDCoins yet.' };
  }
  return {
    profile: {
      ...profile,
      hdCoins: profile.hdCoins - price,
      ownedItems: [...profile.ownedItems, item.id],
      settings: { ...profile.settings, activeTheme: item.id },
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
    lifetimeCoins: profile.lifetimeCoins + bonus,
  };
}
