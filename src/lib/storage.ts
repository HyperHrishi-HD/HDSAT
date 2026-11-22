import { ARCADE_DAILY_COIN_CAP, clampArcadeCoins } from './arcadeCoins';
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
/**
 * How long an emailed 6-digit code is accepted. Supabase is configured with
 * `mailer_otp_exp: 43200` (12 h), and the templates say 12 hours; the pending
 * record has to match, or the app offers to accept a code the server has
 * already expired.
 */
export const EMAIL_CODE_WINDOW_MS = 12 * 60 * 60 * 1000;
export const DAILY_QUESTION_COIN_CAP = 60;
export const DAILY_FLASHCARD_COIN_CAP = 15;
const PROFILE_VERSION = 2;
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
      // The complete bank is the default. Hiding correct answers is an
      // explicit opt-in, so a new student never wonders where items went.
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
    const migrated = parsed.version !== PROFILE_VERSION;
    const profile: LocalProfile = {
      ...base,
      ...parsed,
      hdCoins: parsed.hdCoins ?? 0,
      lifetimeCoins: parsed.lifetimeCoins ?? (parsed.hdCoins ?? 0) + spent,
      settings: {
        ...base.settings,
        ...(parsed.settings ?? {}),
        // Version 1 shipped "exclude previously correct" on by default. That
        // made the catalogue look like it was shrinking (10,024 became 9,949)
        // as a student answered correctly. Reset it once for existing guests;
        // the preference remains available under Account.
        ...(migrated ? { excludePreviouslyCorrect: false } : {}),
      },
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
    // Persist the migration immediately. Otherwise the stored raw record stays
    // at version 1 and every future load has to redo the same copy; if a caller
    // inspected storage directly it looked as though the fix had not applied.
    if (migrated) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      } catch {
        /* storage disabled: the in-memory migration still applies */
      }
    }
    return profile;
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
 * keeps practising on this device; the address is remembered for the 24-hour
 * send allowance, while the 6-digit code itself is only valid for 12 hours. It also carries the send counter, which
 * allows one message per address per day and no more.
 */
export interface PendingAccount {
  email: string;
  displayName: string;
  createdAt: string;
  /** When the most recent code was sent (or 0 if none has been sent yet). */
  sentAt: number;
  expiresAt: number;
  /** Codes sent for this address inside the current 24-hour window. */
  sends?: number;
  windowStart?: number;
}

/**
 * One code per address per day, and the code itself stays valid for the same
 * 24 hours. A short cooldown with three sends was tried and removed: mail can
 * arrive minutes late, so "it has not come yet, press again" turned into three
 * copies of the same message and three sends off the provider's daily quota.
 * The allowance is shared with recovery links (src/lib/emailAllowance.ts).
 */
export const EMAIL_RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const EMAIL_SENDS_PER_WINDOW = 1;
const EMAIL_SEND_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      sends: typeof parsed.sends === 'number' ? parsed.sends : sentAt > 0 ? 1 : 0,
      windowStart:
        typeof parsed.windowStart === 'number' && parsed.windowStart > 0
          ? parsed.windowStart
          : sentAt,
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
    sends: account.sends ?? (sentAt > 0 ? 1 : 0),
    windowStart: account.windowStart ?? sentAt,
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
): {
  allowed: boolean;
  /** Wait before another send is worth trying; 0 when allowed. */
  remainingMs: number;
  /** Why a send was refused, so the caller can word it honestly. */
  reason: 'cooldown' | 'daily-cap' | null;
  existing: PendingAccount | null;
} {
  const existing = loadPendingAccount(now);
  const same = existing && existing.email.trim().toLowerCase() === email.trim().toLowerCase();
  if (!same || !existing) return { allowed: true, remainingMs: 0, reason: null, existing };

  const windowStart = existing.windowStart ?? existing.sentAt;
  const windowFresh = now - windowStart < EMAIL_SEND_WINDOW_MS;
  const sends = windowFresh ? existing.sends ?? 1 : 0;
  if (sends >= EMAIL_SENDS_PER_WINDOW) {
    return {
      allowed: false,
      remainingMs: Math.max(0, windowStart + EMAIL_SEND_WINDOW_MS - now),
      reason: 'daily-cap',
      existing,
    };
  }
  const cooldownLeft = existing.sentAt + EMAIL_RESEND_COOLDOWN_MS - now;
  if (existing.sentAt > 0 && cooldownLeft > 0) {
    return { allowed: false, remainingMs: cooldownLeft, reason: 'cooldown', existing };
  }
  return { allowed: true, remainingMs: 0, reason: null, existing };
}

/**
 * Records one accepted send, so the cooldown starts now and the 3-per-day cap
 * counts it. Called only after the mail provider accepted the request.
 */
export function recordVerificationSend(
  email: string,
  displayName: string,
  now: number = Date.now()
): PendingAccount {
  const existing = loadPendingAccount(now);
  const same = existing && existing.email.trim().toLowerCase() === email.trim().toLowerCase();
  const windowStart = same ? existing.windowStart ?? now : now;
  const withinWindow = now - windowStart < EMAIL_SEND_WINDOW_MS;
  const sends = (withinWindow && same ? existing.sends ?? 0 : 0) + 1;
  return savePendingAccount(
    {
      email,
      displayName: displayName || existing?.displayName || 'Student',
      createdAt: same ? existing.createdAt : new Date(now).toISOString(),
      sentAt: now,
      sends,
      windowStart,
    },
    now
  );
}

/**
 * When the emailed code stops being accepted. The pending record lives for the
 * full 24-hour send allowance so a second request stays blocked; the code
 * inside it only works for the mailer's 12-hour window.
 */
export function pendingCodeEndsAt(
  account: Pick<PendingAccount, 'sentAt' | 'expiresAt'>
): number {
  return Math.min(account.expiresAt, account.sentAt + EMAIL_CODE_WINDOW_MS);
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

/** Credit exact coins found in a game, without inventing a random session reward. */
export function awardCoins(
  profile: LocalProfile,
  amount: number,
  now: Date = new Date()
): LocalProfile {
  const safeAmount = Math.floor(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) return profile;
  const date = todayKey(now);
  let next: LocalProfile = withDay(profile, date);
  next = withEarned(next, safeAmount);
  return bumpDay(next, date, { coinsEarned: safeAmount });
}

/**
 * Guest parity for the exact arcade-event RPC. The event id is the idempotency
 * key, and the day's total is capped so a script cannot claim the same pickup
 * twice or mint an unlimited number of fresh events.
 */
export const ARCADE_EVENT_LEDGER_KEY = 'hdsat.arcade.events.v1';

interface ArcadeEventLedger {
  date: string;
  ids: string[];
  total: number;
}

function loadArcadeEventLedger(date: string): ArcadeEventLedger {
  if (typeof localStorage === 'undefined') return { date, ids: [], total: 0 };
  try {
    const raw = localStorage.getItem(ARCADE_EVENT_LEDGER_KEY);
    if (!raw) return { date, ids: [], total: 0 };
    const parsed = JSON.parse(raw) as Partial<ArcadeEventLedger>;
    if (parsed.date !== date) return { date, ids: [], total: 0 };
    return {
      date,
      ids: Array.isArray(parsed.ids)
        ? parsed.ids.filter((id): id is string => typeof id === 'string').slice(-500)
        : [],
      total: Math.max(0, Math.min(ARCADE_DAILY_COIN_CAP, Number(parsed.total) || 0)),
    };
  } catch {
    return { date, ids: [], total: 0 };
  }
}

function saveArcadeEventLedger(ledger: ArcadeEventLedger): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ARCADE_EVENT_LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    /* storage unavailable: the in-memory award still applies for this action */
  }
}

export function awardArcadeEventCoins(
  profile: LocalProfile,
  amount: number,
  eventId: string,
  now: Date = new Date()
): { profile: LocalProfile; coinsAwarded: number } {
  const safeAmount = clampArcadeCoins(amount);
  if (!eventId || safeAmount <= 0) return { profile, coinsAwarded: 0 };
  const date = todayKey(now);
  const ledger = loadArcadeEventLedger(date);
  if (ledger.ids.includes(eventId)) return { profile, coinsAwarded: 0 };

  const paid = Math.min(safeAmount, Math.max(0, ARCADE_DAILY_COIN_CAP - ledger.total));
  saveArcadeEventLedger({
    date,
    ids: [...ledger.ids, eventId].slice(-500),
    total: ledger.total + paid,
  });
  if (paid <= 0) return { profile, coinsAwarded: 0 };
  return { profile: awardCoins(profile, paid, now), coinsAwarded: paid };
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

/**
 * One rule for every mode, matching the database trigger:
 * three questions, five flashcards, or one completed game/rush/test.
 * A game answer is not a streak day by itself; finishing the game is.
 */
export function dayQualifiesForStreak(day: DailyActivity | undefined): boolean {
  if (!day) return false;
  return (
    day.questionsCompleted >= 3 ||
    day.flashcardsReviewed >= 5 ||
    day.sessionsCompleted >= 1
  );
}

/** What today still needs, for the Dashboard's honest one-line hint. */
export function streakQualification(day: DailyActivity | undefined): {
  qualified: boolean;
  label: string;
} {
  if (dayQualifiesForStreak(day)) return { qualified: true, label: 'Today counts toward your streak' };
  const questions = Math.max(0, 3 - (day?.questionsCompleted ?? 0));
  const cards = Math.max(0, 5 - (day?.flashcardsReviewed ?? 0));
  if (questions <= cards) {
    return {
      qualified: false,
      label: `${questions} more question${questions === 1 ? '' : 's'} or one game today`,
    };
  }
  return {
    qualified: false,
    label: `${cards} more flashcard${cards === 1 ? '' : 's'} or one game today`,
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

  if (dayQualifiesForStreak(next.dailyActivity[date])) next = updateStreak(next, date);
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
  if (dayQualifiesForStreak(next.dailyActivity[date])) next = updateStreak(next, date);

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
    if (dayQualifiesForStreak(next.dailyActivity[date])) next = updateStreak(next, date);
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
  /** Completed session ids already counted today, so a replay is a no-op. */
  sessionIds?: string[];
}

function loadSessionLedger(date: string): SessionLedger {
  if (typeof localStorage === 'undefined') return { date, counts: {}, sessionIds: [] };
  try {
    const raw = localStorage.getItem(SESSION_LEDGER_KEY);
    if (!raw) return { date, counts: {}, sessionIds: [] };
    const parsed = JSON.parse(raw) as Partial<SessionLedger>;
    if (parsed.date !== date) return { date, counts: {}, sessionIds: [] };
    return {
      date,
      counts: parsed.counts ?? {},
      sessionIds: Array.isArray(parsed.sessionIds)
        ? parsed.sessionIds.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    return { date, counts: {}, sessionIds: [] };
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

/**
 * What one finished session pays, mirroring `complete_activity_session` in the
 * database exactly.
 *
 * Arcade mini-games now pay only their exact event coins (asteroids, ships,
 * first-try questions, Table Talk replies and vault pickups). The session
 * completion is still recorded, because it is what qualifies a study-streak
 * day and what updates the activity chart, but it pays zero on top. Practice
 * Rush keeps its own session reward.
 *
 * A completed full test pays up to 25 HDCoins, scaled by how much of the test
 * was actually done and how much of it was right. Finishing three questions and
 * closing the test cannot collect the whole reward any more.
 */
export function sessionCoinReward(args: {
  activityType: SessionActivityType;
  questions: number;
  correct: number;
  random?: () => number;
}): number {
  const questions = Math.max(0, Math.floor(args.questions));
  const correct = Math.max(0, Math.min(Math.floor(args.correct), questions));

  if (args.activityType === 'practice_rush') {
    // A "run" is at least three answers with at least one of them right; that
    // is what stops an instant reset from collecting a rush payout. The cloud
    // pays a flat five for the same reason: a random guest roll would make the
    // two paths disagree and look like an extra arcade payout.
    if (questions < 3 || correct < 1) return 0;
    return 5;
  }

  // Mini-games pay per event through the exact arcade ledger. Paying a random
  // session bonus on top would double the economy and make the stated values
  // untrue.
  if (args.activityType === 'mini_game') return 0;

  if (args.activityType === 'full_simulation') {
    if (questions < 3) return 0;
    const coverage = Math.min(1, questions / 90);
    return Math.round(25 * coverage * (correct / questions));
  }

  // timed_session
  return questions >= 3 ? Math.min(15, Math.max(5, Math.round(questions * 0.6))) : 0;
}

export function awardSessionCoins(
  profile: LocalProfile,
  args: {
    activityType: SessionActivityType;
    questions: number;
    correct: number;
    sessionId: string;
    /** Injectable roll for tests; production uses Math.random. */
    random?: () => number;
  },
  now: Date = new Date()
): { profile: LocalProfile; coinsAwarded: number; runsToday: number } {
  const date = todayKey(now);
  const ledger = loadSessionLedger(date);
  const runsToday = ledger.counts[args.activityType] ?? 0;
  const cap = SESSION_REWARD_CAPS[args.activityType] ?? 0;
  let reward = 0;

  // A finished run is one event. Replaying its id must not consume another
  // daily slot or add another completion to the streak/activity counters.
  if (args.sessionId && (ledger.sessionIds ?? []).includes(args.sessionId)) {
    return { profile, coinsAwarded: 0, runsToday };
  }

  if (runsToday < cap) {
    reward = sessionCoinReward({
      activityType: args.activityType,
      questions: args.questions,
      correct: args.correct,
    });
  }

  // Record every credited completion, not only the paid ones: a replay of a
  // zero-reward mini-game must not keep incrementing its session counters.
  if (reward > 0 || (args.sessionId && args.questions > 0)) {
    saveSessionLedger({
      date,
      counts:
        reward > 0
          ? { ...ledger.counts, [args.activityType]: runsToday + 1 }
          : ledger.counts,
      sessionIds: args.sessionId
        ? [...(ledger.sessionIds ?? []), args.sessionId].slice(-300)
        : ledger.sessionIds,
    });
  }

  let next: LocalProfile = withDay(profile, date);
  // A finished sitting counts toward the day even when its exact coin value is
  // zero. The activity chart and the streak both need the completion.
  if (args.questions > 0) {
    next = bumpDay(next, date, { sessionsCompleted: 1 });
  }
  if (reward > 0) {
    next = withEarned(next, reward);
    next = bumpDay(next, date, { coinsEarned: reward });
  }
  if (dayQualifiesForStreak(next.dailyActivity[date])) next = updateStreak(next, date);
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

/**
 * Every condition the achievement ladder can see in a local profile, in one
 * pass. Thresholds mirror `refresh_streak_and_achievements` in the database:
 * an achievement that unlocks on the phone must also unlock in the cloud, or
 * the two balance histories would disagree.
 *
 * Streaks use the best streak rather than the live one, so a broken streak can
 * never take a badge back once it was earned.
 */
export function evaluateAchievements(profile: LocalProfile, alreadyUnlocked: string[]): string[] {
  const owned = new Set(alreadyUnlocked);
  const unlocked: string[] = [];
  const totalAttempts = profile.attempts.length;
  const correctAttempts = profile.attempts.filter((a) => a.isCorrect).length;
  const distinctAnswered = Object.keys(profile.progress).length;
  const flashcardsReviewed = Object.keys(profile.flashcards).length;
  const mastered = Object.values(profile.progress).filter((p) => p.status === 'mastered').length;
  const rushCorrect = profile.attempts.filter((a) => a.mode === 'rush' && a.isCorrect).length;
  const tests = profile.testAttempts.length;
  const bestStreak = Math.max(profile.bestStreak, profile.currentStreak);
  const lifetime = Math.max(profile.lifetimeCoins, profile.hdCoins);

  const grant = (id: string, condition: boolean) => {
    if (condition && !owned.has(id) && !unlocked.includes(id)) unlocked.push(id);
  };

  grant('first-steps', totalAttempts >= 1);
  grant('ten-questions', totalAttempts >= 10);
  grant('fifty-questions', totalAttempts >= 50);
  grant('streak-3', bestStreak >= 3);
  grant('streak-7', bestStreak >= 7);
  grant('flashcard-10', flashcardsReviewed >= 10);
  grant('flashcard-50', flashcardsReviewed >= 50);
  grant('first-test', tests >= 1);
  grant('rush-10', rushCorrect >= 10);
  grant('coin-100', profile.hdCoins >= 100);
  grant('mastery-5', mastered >= 5);
  grant('hundred-questions', totalAttempts >= 100);
  grant('accurate-50', correctAttempts >= 50);
  grant('distinct-100', distinctAnswered >= 100);
  grant('streak-14', bestStreak >= 14);
  grant('tests-5', tests >= 5);
  grant('flashcards-200', flashcardsReviewed >= 200);
  grant('mastery-25', mastered >= 25);
  grant('rush-100', rushCorrect >= 100);
  grant('coin-1000', profile.hdCoins >= 1000);
  grant('lifetime-2500', lifetime >= 2500);
  grant('accurate-500', correctAttempts >= 500);
  grant('five-hundred-questions', totalAttempts >= 500);
  grant('distinct-500', distinctAnswered >= 500);
  grant('mastery-100', mastered >= 100);
  grant('tests-15', tests >= 15);
  grant('streak-30', bestStreak >= 30);
  grant('thousand-questions', totalAttempts >= 1000);
  grant('streak-100', bestStreak >= 100);
  grant('lifetime-10000', lifetime >= 10000);
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
