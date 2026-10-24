import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAchievementIds } from './catalog';
import {
  PASSWORD_RESET_REQUESTED_KEY,
  type PasswordActionClaim,
  type PasswordCooldown,
  type PasswordPath,
} from './password';
import { getSupabase } from './supabaseClient';
import type {
  AttemptMode,
  DailyActivity,
  FlashcardProgress,
  LocalProfile,
  QuestionProgress,
  TestAttempt,
} from './types';

/**
 * Data access layer for Supabase. Cloud mode never writes tables directly except
 * for rows whose RLS policies explicitly allow owner inserts (saved_questions,
 * test_attempts, test_responses, question_reports). Grading, coins, streaks and
 * flashcard scheduling all run inside SECURITY DEFINER RPCs.
 */
export interface CloudStats {
  hdCoins: number;
  /** Every HDCoin earned, unaffected by cosmetic purchases. */
  lifetimeCoins: number;
  currentStreak: number;
  bestStreak: number;
  totalAttempts: number;
  correctAttempts: number;
  uniqueQuestionsAttempted: number;
  flashcardsReviewed: number;
  completedRushes: number;
  completedSimulations: number;
}

export interface CloudSnapshot {
  stats: CloudStats;
  progress: Record<string, QuestionProgress>;
  saved: string[];
  dailyActivity: Record<string, DailyActivity>;
  flashcards: Record<string, FlashcardProgress>;
  achievements: string[];
  ownedItems: string[];
  testAttempts: TestAttempt[];
  preferredExam: string;
  displayName: string;
  /** Null until the student proves they own the address with an emailed code. */
  emailVerifiedAt: string | null;
  /** ISO date (YYYY-MM-DD) of the real test, or null. */
  targetTestDate: string | null;
}

const DB_MODE: Record<AttemptMode, string> = {
  practice: 'practice',
  rush: 'rush',
  test: 'exam',
  review: 'question_bank',
  game: 'game',
};

export function toDbMode(mode: AttemptMode): string {
  return DB_MODE[mode] ?? 'practice';
}

export function toLocalDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function client(): SupabaseClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured for this deployment.');
  return supabase;
}

export async function getUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Where Supabase should send the confirmation link. The production URL is
 * configured explicitly (VITE_SITE_URL) instead of being derived from the page
 * origin, so a signup started on localhost never emails a link that only works
 * on the developer's machine. The destination must also be present in the
 * project's Redirect URLs allowlist (see supabase/email-templates/README.md).
 */
export function authRedirectUrl(): string {
  const configured = String(import.meta.env.VITE_SITE_URL ?? '').trim().replace(/\/$/, '');
  const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';
  const target = configured || origin;
  // Plain origin: Supabase appends its own #access_token / ?code payload, and
  // main.tsx consumes it before the hash router sees it.
  return `${target}/`;
}

/** True when Supabase has confirmed this address (cloud data may be written). */
export function isConfirmedUser(user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null): boolean {
  return Boolean(user && (user.email_confirmed_at || user.confirmed_at));
}

/** Thrown when signup is asked for an address that already has an account. */
export class AccountExistsError extends Error {
  constructor(email: string) {
    super(`An account already exists for ${email}.`);
    this.name = 'AccountExistsError';
  }
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
  consent: Record<string, string | boolean> = {}
) {
  const supabase = client();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || 'Student', ...consent },
      emailRedirectTo: authRedirectUrl(),
    },
  });
  if (error) throw error;
  // Supabase hides whether an address is taken by returning an obfuscated user
  // with no identities. Say so plainly instead of pretending the signup worked.
  const identities = (data.user as { identities?: unknown[] } | null)?.identities;
  if (data.user && Array.isArray(identities) && identities.length === 0) {
    throw new AccountExistsError(email.trim());
  }
  return data;
}

/**
 * Confirms an email with the 6-digit token from the branded email.
 *
 * Sign-in no longer waits for this: the account works immediately and the code
 * is what marks it verified. Email OTP is used rather than the signup token so
 * the same call works for an account that was created months ago, and it signs
 * the student in on success (a no-op when their session is already live).
 */
export async function verifySignupCode(email: string, token: string) {
  const supabase = client();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: token.trim(),
    type: 'email',
  });
  if (error) throw error;
  await markEmailVerified();
  return data;
}

/**
 * Records the proof of address on the account. Idempotent, and safe to retry:
 * the first success is the permanent answer.
 */
export async function markEmailVerified(): Promise<string | null> {
  const supabase = client();
  const { data, error } = await supabase.rpc('mark_email_verified');
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Today's remaining mail budget. Brevo's free plan allows 300 sends a day, so
 * the app stops asking at 280 instead of letting the provider return an error.
 * A missing RPC (older project) reports "allowed" — the per-address daily rule
 * still applies.
 */
export async function emailSendBudget(): Promise<{ used: number; limit: number; remaining: number; allowed: boolean }> {
  const fallback = { used: 0, limit: 280, remaining: 280, allowed: true };
  const supabase = getSupabase();
  if (!supabase) return fallback;
  try {
    const { data, error } = await supabase.rpc('email_send_budget');
    if (error || !data) return fallback;
    const row = data as { used?: number; limit?: number; remaining?: number; allowed?: boolean };
    return {
      used: Number(row.used ?? 0),
      limit: Number(row.limit ?? 280),
      remaining: Number(row.remaining ?? 280),
      allowed: row.allowed !== false,
    };
  } catch {
    return fallback;
  }
}

/**
 * One-form auth entry point: reports whether the password signed in, whether
 * the address simply has not been confirmed, or whether no matching account
 * exists yet (so the caller can create one).
 */
export type SignInAttempt =
  | { ok: true; reason: null }
  | { ok: false; reason: 'invalid' | 'unconfirmed' | 'error'; message?: string };

export async function attemptSignIn(email: string, password: string): Promise<SignInAttempt> {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error && data.session) return { ok: true, reason: null };
  const message = error?.message ?? '';
  if (/email not confirmed/i.test(message)) return { ok: false, reason: 'unconfirmed' };
  if (/invalid login credentials/i.test(message)) return { ok: false, reason: 'invalid' };
  return { ok: false, reason: 'error', message: message || 'Sign-in failed. Check your connection and try again.' };
}

export async function signIn(email: string, password: string) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOutCloud() {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function resendConfirmation(email: string) {
  const supabase = client();
  // Magic-link OTP, not a signup resend: accounts are usable before they are
  // verified, so this has to work for any account age and must not create one.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: authRedirectUrl() },
  });
  if (error) throw error;
}

export async function fetchSnapshot(): Promise<CloudSnapshot> {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) throw new Error('Not signed in.');

  const [statsRes, progressRes, savedRes, dailyRes, flashRes, achRes, testsRes, profileRes] =
    await Promise.all([
      supabase.from('user_stats').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('user_question_progress').select('*').eq('user_id', userId),
      supabase.from('saved_questions').select('question_id').eq('user_id', userId),
      supabase.from('daily_activity').select('*').eq('user_id', userId).order('activity_date', { ascending: false }).limit(120),
      supabase.from('flashcard_progress').select('*').eq('user_id', userId),
      supabase.from('user_achievements').select('achievement_id').eq('user_id', userId),
      supabase
        .from('test_attempts')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['completed', 'abandoned'])
        .order('completed_at', { ascending: false })
        .limit(1000),
      supabase
        .from('profiles')
        .select('display_name, preferred_exam, unlocked_cosmetics, email_verified_at, target_test_date')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

  const statsRow = statsRes.data ?? {};
  const progress: Record<string, QuestionProgress> = {};
  (progressRes.data ?? []).forEach((row: Record<string, unknown>) => {
    const id = String(row.question_id);
    progress[id] = {
      questionId: id,
      attemptCount: Number(row.attempt_count ?? 0),
      correctCount: Number(row.correct_count ?? 0),
      consecutiveCorrect: Number(row.consecutive_correct ?? 0),
      status: (row.status as QuestionProgress['status']) ?? 'unseen',
      lastResponse: String(row.last_response ?? ''),
      lastIsCorrect: Boolean(row.last_is_correct),
      lastAttemptedAt: String(row.last_attempted_at ?? ''),
    };
  });

  const dailyActivity: Record<string, DailyActivity> = {};
  (dailyRes.data ?? []).forEach((row: Record<string, unknown>) => {
    const date = String(row.activity_date);
    dailyActivity[date] = {
      date,
      questionsCompleted: Number(row.questions_completed ?? 0),
      correctQuestions: Number(row.correct_questions ?? 0),
      learningMinutes: Number(row.learning_minutes ?? 0),
      flashcardsReviewed: Number(row.flashcards_reviewed ?? 0),
      coinsEarned: Number(row.coins_earned_today ?? 0),
      sessionsCompleted: Number(row.rushes_completed ?? 0) + Number(row.games_completed ?? 0),
    };
  });

  const flashcards: Record<string, FlashcardProgress> = {};
  (flashRes.data ?? []).forEach((row: Record<string, unknown>) => {
    const id = String(row.card_id);
    flashcards[id] = {
      cardId: id,
      stage: (row.stage as FlashcardProgress['stage']) ?? 'new',
      repetitions: Number(row.repetitions ?? 0),
      intervalDays: Number(row.interval_days ?? 0),
      easeFactor: Number(row.ease_factor ?? 2.5),
      lastQuality: Number(row.last_quality ?? 0),
      nextDueAt: String(row.next_due_at ?? new Date().toISOString()),
      lastReviewedAt: String(row.last_reviewed_at ?? new Date().toISOString()),
    };
  });

  const testAttempts: TestAttempt[] = (testsRes.data ?? []).map((row: Record<string, unknown>) => {
    const payload = (row.modules ?? {}) as {
      modules?: TestAttempt['modules'];
      pausedState?: TestAttempt['pausedState'];
    };
    const estimates = (row.estimated_score_range ?? {}) as {
      rw?: number | null;
      math?: number | null;
      total?: number | null;
    };
    const isAbandoned = String(row.status) === 'abandoned' || String(row.status) === 'in_progress';
    return {
      id: String(row.client_session_id ?? row.id),
      assessment: String(row.assessment ?? 'SAT'),
      status: isAbandoned ? 'incomplete' : 'completed',
      createdAt: String(row.completed_at ?? row.started_at ?? new Date().toISOString()),
      modules: Array.isArray(payload.modules) ? (payload.modules as TestAttempt['modules']) : [],
      rwEstimate: isAbandoned ? null : estimates.rw ?? null,
      mathEstimate: isAbandoned ? null : estimates.math ?? null,
      totalEstimate: isAbandoned ? null : estimates.total ?? null,
      durationSeconds: Number(row.time_spent_seconds ?? 0),
      pausedState: payload.pausedState,
    };
  });

  return {
    stats: {
      hdCoins: Number(statsRow.hd_coins ?? 0),
      lifetimeCoins: Number(statsRow.lifetime_coins ?? statsRow.hd_coins ?? 0),
      currentStreak: Number(statsRow.current_streak ?? 0),
      bestStreak: Number(statsRow.best_streak ?? 0),
      totalAttempts: Number(statsRow.total_attempts ?? 0),
      correctAttempts: Number(statsRow.correct_attempts ?? 0),
      uniqueQuestionsAttempted: Number(statsRow.unique_questions_attempted ?? 0),
      flashcardsReviewed: Number(statsRow.flashcards_reviewed ?? 0),
      completedRushes: Number(statsRow.completed_rushes ?? 0),
      completedSimulations: Number(statsRow.completed_simulations ?? 0),
    },
    progress,
    saved: (savedRes.data ?? []).map((row: { question_id: string }) => row.question_id),
    dailyActivity,
    flashcards,
    achievements: normalizeAchievementIds(
      (achRes.data ?? []).map((row: { achievement_id: string }) => row.achievement_id)
    ),
    ownedItems: Array.isArray(profileRes.data?.unlocked_cosmetics)
      ? (profileRes.data.unlocked_cosmetics as string[])
      : [],
    testAttempts,
    preferredExam: String(profileRes.data?.preferred_exam ?? 'SAT'),
    displayName: String(profileRes.data?.display_name ?? 'Student'),
    emailVerifiedAt: (profileRes.data?.email_verified_at as string | null) ?? null,
    targetTestDate: (profileRes.data?.target_test_date as string | null) ?? null,
  };
}

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  hdCoins: number;
  bestStreak: number;
  totalAttempts: number;
  isMe: boolean;
}

export interface Leaderboard {
  /** The board itself, at most `limit` rows. */
  rows: LeaderboardRow[];
  /** Where the signed-in student sits, even when they are off the board. */
  myRank: number | null;
  /** The student's own row when it fell outside the top slice. */
  outsideTop: LeaderboardRow | null;
  totalPlayers: number;
}

function mapLeaderboardRow(row: Record<string, unknown>): LeaderboardRow {
  return {
    rank: Number(row.rank ?? 0),
    displayName: String(row.display_name ?? 'Student'),
    hdCoins: Number(row.hd_coins ?? 0),
    bestStreak: Number(row.best_streak ?? 0),
    totalAttempts: Number(row.total_attempts ?? 0),
    isMe: Boolean(row.is_me),
  };
}

/**
 * Top students by HDCoin balance. The database returns a name and three
 * numbers only — no email, no id, no answers — and it is granted to signed-in
 * students alone, so a guest never queries it.
 */
export async function fetchLeaderboard(limit = 5): Promise<Leaderboard> {
  const supabase = client();
  const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: limit });
  if (error) throw error;
  const source = (data ?? []) as Record<string, unknown>[];
  const all = source.map((row) => ({
    ...mapLeaderboardRow(row),
    outsideTop: Boolean(row.outside_top),
  }));
  const strip = ({ outsideTop: _drop, ...row }: (typeof all)[number]): LeaderboardRow => row;
  const rows = all.filter((row) => !row.outsideTop).map(strip);
  const outside = all.find((row) => row.outsideTop);
  const rawRank = source[0]?.my_rank;
  return {
    rows,
    myRank: rawRank === null || rawRank === undefined ? null : Number(rawRank),
    outsideTop: outside ? strip(outside) : null,
    totalPlayers: Number(source[0]?.total_players ?? rows.length),
  };
}

export interface SubmitAttemptArgs {
  questionId: string;
  response: string;
  mode: AttemptMode;
  timeSpentSeconds: number;
  clientEventId: string;
  sessionId?: string | null;
}

/**
 * The deployed database can lag behind a newly regenerated bank. A question
 * that exists in the client bundle but not in public.questions cannot be
 * written to question_attempts or test_responses (both have a foreign key),
 * so callers use this to treat it as a local-only answer instead of an error.
 */
export function isUnknownQuestionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /does not exist/i.test(message) || /question_id_fkey/i.test(message);
}

async function existingQuestionIds(ids: string[]): Promise<Set<string> | null> {
  const supabase = client();
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 120) {
    const chunk = ids.slice(i, i + 120);
    const { data, error } = await supabase.from('questions').select('id').in('id', chunk);
    if (error) return null;
    (data ?? []).forEach((row: { id: string }) => found.add(row.id));
  }
  return found;
}

export async function submitAttemptCloud(args: SubmitAttemptArgs) {
  const supabase = client();
  const { data, error } = await supabase.rpc('submit_question_attempt', {
    p_question_id: args.questionId,
    p_response: args.response,
    p_mode: toDbMode(args.mode),
    p_time_spent_seconds: Math.max(0, Math.round(args.timeSpentSeconds)),
    p_client_event_id: args.clientEventId,
    p_session_id: args.sessionId ?? null,
    p_local_date: toLocalDate(),
  });
  if (error) throw error;
  return data as {
    duplicate: boolean;
    is_correct: boolean;
    correct_answer: string;
    explanation: string;
    distractor_rationales: Record<string, string>;
    coins_awarded: number;
    hd_coins: number;
    current_streak: number;
  };
}

export async function submitFlashcardCloud(cardId: string, quality: number, clientEventId: string) {
  const supabase = client();
  const { data, error } = await supabase.rpc('submit_flashcard_review', {
    p_card_id: cardId,
    p_quality: quality,
    p_client_event_id: clientEventId,
    p_local_date: toLocalDate(),
  });
  if (error) throw error;
  return data as { coins_awarded: number; next_due_at: string; interval_days: number; stage: string };
}

export async function completeActivityCloud(args: {
  activityType: 'practice_rush' | 'timed_session' | 'full_simulation' | 'mini_game';
  sessionId: string;
  questions: number;
  correct: number;
  timeSpentSeconds: number;
}) {
  const supabase = client();
  const { data, error } = await supabase.rpc('complete_activity_session', {
    p_activity_type: args.activityType,
    p_session_id: args.sessionId,
    p_questions_count: args.questions,
    p_correct_count: args.correct,
    p_time_spent_seconds: args.timeSpentSeconds,
    p_local_date: toLocalDate(),
  });
  if (error) throw error;
  return data as { coins_awarded: number; hd_coins: number };
}

/** Themes are the only purchasable cosmetic; the RPC refuses emblem slots. */
export async function purchaseCosmeticCloud(
  itemId: string
): Promise<{ ok: boolean; reason?: string; hd_coins?: number }> {
  const supabase = client();
  const { data, error } = await supabase.rpc('purchase_cosmetic_item', {
    p_item_id: itemId,
    p_item_type: 'accent_theme',
    p_local_request_id: `req-${Date.now()}`,
  });
  if (error) throw error;
  return { ok: true, ...(data as Record<string, unknown>) };
}

/**
 * Renames the signed-in student. The auth metadata is what the header reads,
 * and the profiles mirror keeps the cloud snapshot (and any future admin view)
 * consistent with it.
 */
/**
 * Password changes are gated by the database (1 per hour, 1 recovery link per
 * day). Supabase Auth performs the hash; this layer only asks permission, does
 * the change and reports the outcome.
 */
function passwordRpcError(message: string): Error | null {
  const routines = [
    'claim_password_action',
    'complete_password_action',
    'cancel_password_action',
    'password_action_status',
  ];
  if (routines.some((routine) => isMissingRoutineError(message, routine))) {
    return new Error('Password changes are not available on this deployment yet.');
  }
  return null;
}

function readCooldown(raw: unknown): PasswordCooldown {
  const value = (raw ?? {}) as { next_allowed_at?: string | null; retry_after_seconds?: number };
  return {
    nextAllowedAt: value.next_allowed_at ?? null,
    retryAfterSeconds: Number(value.retry_after_seconds ?? 0),
  };
}

export async function fetchPasswordCooldowns(
  email: string
): Promise<Record<PasswordPath, PasswordCooldown>> {
  const supabase = client();
  const { data, error } = await supabase.rpc('password_action_status');
  if (error) throw passwordRpcError(error.message) ?? error;
  const payload = (data ?? {}) as Record<string, unknown>;
  // Recovery links are limited per address (so signed-out requests share the
  // same daily budget); the password path is limited per account.
  const wait = await emailRequestWait(email, 'reset').catch(() => 0);
  return {
    password: readCooldown(payload.password),
    email: { nextAllowedAt: null, retryAfterSeconds: wait },
  };
}

/** Reserves one action. `allowed: false` carries the wait that remains. */
export async function claimPasswordAction(via: PasswordPath): Promise<PasswordActionClaim> {
  const supabase = client();
  const { data, error } = await supabase.rpc('claim_password_action', { p_via: via });
  if (error) throw passwordRpcError(error.message) ?? error;
  const payload = (data ?? {}) as {
    allowed?: boolean;
    action_id?: string | null;
    next_allowed_at?: string | null;
    retry_after_seconds?: number;
  };
  return {
    allowed: Boolean(payload.allowed),
    actionId: payload.action_id ?? null,
    nextAllowedAt: payload.next_allowed_at ?? null,
    retryAfterSeconds: Number(payload.retry_after_seconds ?? 0),
  };
}

export async function completePasswordAction(actionId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.rpc('complete_password_action', { p_action_id: actionId });
  if (error) throw passwordRpcError(error.message) ?? error;
}

/** Releases a claim so a rejected password does not start a cooldown. */
export async function cancelPasswordAction(actionId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.rpc('cancel_password_action', { p_action_id: actionId });
  if (error) throw passwordRpcError(error.message) ?? error;
}

/** Re-authenticates with the current password (never stored, never echoed). */
export async function verifyCurrentPassword(password: string): Promise<boolean> {
  const supabase = client();
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) throw new Error('Sign in again to change your password.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return true;
  const message = error.message ?? '';
  if (/invalid login credentials|invalid password/i.test(message)) return false;
  throw error;
}

export async function updatePassword(password: string, signOutOthers: boolean): Promise<void> {
  const supabase = client();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  if (!signOutOthers) return;
  try {
    await supabase.auth.signOut({ scope: 'others' });
  } catch {
    /* the password is already changed; the session sweep is best effort */
  }
}

export type EmailRequestKind = 'reset' | 'confirm';

/**
 * Seconds left before this address may receive another email of this kind.
 * Keyed by address, so it also covers people who are signed out.
 */
export async function emailRequestWait(email: string, kind: EmailRequestKind): Promise<number> {
  const supabase = client();
  const { data, error } = await supabase.rpc('email_request_next_allowed', {
    p_email: email.trim(),
    p_kind: kind,
  });
  if (error) throw error;
  const iso = typeof data === 'string' ? data : null;
  if (!iso) return 0;
  const target = Date.parse(iso);
  return Number.isNaN(target) ? 0 : Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

/** Records a send that the mail provider accepted. Never call it before that. */
export async function recordEmailRequest(email: string, kind: EmailRequestKind): Promise<void> {
  const supabase = client();
  const { error } = await supabase.rpc('record_email_request', {
    p_email: email.trim(),
    p_kind: kind,
  });
  if (error) throw error;
}

/**
 * Sends the recovery link. The device marker lets main.tsx recognise the PKCE
 * code as a recovery link rather than a signup confirmation.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: authRedirectUrl(),
  });
  if (error) throw error;
  try {
    window.sessionStorage.setItem(PASSWORD_RESET_REQUESTED_KEY, String(Date.now()));
  } catch {
    /* private mode: the implicit flow still carries type=recovery */
  }
}

export async function updateDisplayNameCloud(displayName: string): Promise<string> {
  const supabase = client();
  const name = displayName.trim().slice(0, 40);
  if (!name) throw new Error('Enter a display name.');
  const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
  if (error) throw error;
  const userId = await getUserId();
  if (userId) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ display_name: name, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (profileError) throw profileError;
  }
  return name;
}

export async function setPreferredExamCloud(exam: string) {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase
    .from('profiles')
    .update({ preferred_exam: exam, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

/** The assessment and its real test date are one goal; save them together. */
export async function setTestGoalCloud(exam: string, testDate: string | null) {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase
    .from('profiles')
    .update({
      preferred_exam: exam,
      target_test_date: testDate || null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function saveQuestionCloud(questionId: string, note = '') {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase
    .from('saved_questions')
    .upsert({ user_id: userId, question_id: questionId, personal_note: note }, { onConflict: 'user_id,question_id' });
  if (error) throw error;
}

export async function unsaveQuestionCloud(questionId: string) {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase.from('saved_questions').delete().eq('user_id', userId).eq('question_id', questionId);
  if (error) throw error;
}

/**
 * test_attempts.assessment is constrained by the database to the four official
 * form names, so the blended full-test track is stored under its NMSQT key.
 */
export function toDbAssessment(assessment: string): string {
  if (assessment.includes('PSAT/NMSQT') && assessment.includes('10')) return 'PSAT/NMSQT';
  return ['SAT', 'PSAT/NMSQT', 'PSAT 10', 'PSAT 8/9'].includes(assessment)
    ? assessment
    : 'SAT';
}

export async function recordTestCloud(
  attempt: TestAttempt,
  options: {
    clientSessionId: string;
    assessment: string;
    durationSeconds: number;
    status?: 'completed' | 'incomplete';
    /** Unverified (light) account: keep the summary, skip per-item rows. */
    light?: boolean;
  }
) {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) throw new Error('Not signed in.');
  const rwModules = attempt.modules.filter((m) => m.section === 'Reading and Writing');
  const mathModules = attempt.modules.filter((m) => m.section === 'Math');
  const sum = (rows: typeof attempt.modules, key: 'correct' | 'total') =>
    rows.reduce((acc, m) => acc + m[key], 0);

  const isIncomplete = options.status === 'incomplete';
  const { data, error } = await supabase
    .from('test_attempts')
    .upsert(
      {
        user_id: userId,
        client_session_id: options.clientSessionId,
        assessment: toDbAssessment(options.assessment),
        mode: 'full_adaptive',
        status: isIncomplete ? 'abandoned' : 'completed',
        modules: {
          modules: attempt.modules,
          ...(attempt.pausedState ? { pausedState: attempt.pausedState } : {}),
        },
        rw_route: rwModules.some((m) => m.tier === 'upper') ? 'higher' : 'lower',
        math_route: mathModules.some((m) => m.tier === 'upper') ? 'higher' : 'lower',
        raw_correct: isIncomplete ? 0 : sum(attempt.modules, 'correct'),
        raw_total: isIncomplete ? 0 : sum(attempt.modules, 'total'),
        rw_correct: isIncomplete ? 0 : sum(rwModules, 'correct'),
        rw_total: isIncomplete ? 0 : sum(rwModules, 'total'),
        math_correct: isIncomplete ? 0 : sum(mathModules, 'correct'),
        math_total: isIncomplete ? 0 : sum(mathModules, 'total'),
        estimated_score_range: isIncomplete
          ? { rw: null, math: null, total: null }
          : {
              rw: attempt.rwEstimate,
              math: attempt.mathEstimate,
              total: attempt.totalEstimate,
            },
        time_spent_seconds: options.durationSeconds,
        completed_at: attempt.createdAt,
      },
      { onConflict: 'user_id,client_session_id' }
    )
    .select('id')
    .single();
  if (error) throw error;

  const answered = attempt.modules.flatMap((module) =>
    module.responses
      .filter((r) => r.response !== null && r.response !== '')
      .map((r, index) => ({
        test_attempt_id: data.id,
        user_id: userId,
        module_id: module.moduleId,
        question_id: r.questionId,
        question_order: index,
        selected_answer: r.response,
        is_correct: r.isCorrect,
      }))
  );

  // A light account has not confirmed its address, so the cloud keeps the
  // attempt, score and module state (enough for reports and resume) and skips
  // the per-item copy, which is the largest thing a test writes.
  if (options.light && answered.length > 0) {
    return { id: data.id as string, skippedResponses: answered.length, lightLimited: true };
  }

  // Skip responses whose question has not been seeded into this project yet.
  // They remain in the browser and still appear in the local report; only the
  // cloud copy is limited until the bank is re-seeded.
  const known = answered.length > 0 ? await existingQuestionIds([...new Set(answered.map((r) => r.question_id))]) : new Set<string>();
  let responses = known ? answered.filter((r) => known.has(r.question_id)) : answered;
  const skippedResponses = answered.length - responses.length;

  if (responses.length > 0) {
    let { error: responseError } = await supabase
      .from('test_responses')
      .upsert(responses, { onConflict: 'test_attempt_id,module_id,question_id' });
    if (responseError && /foreign key|23503/i.test(responseError.message)) {
      // A concurrent bank change can invalidate the prefetch; retry once with a
      // fresh lookup rather than losing the whole attempt.
      const fresh = await existingQuestionIds([...new Set(responses.map((r) => r.question_id))]);
      if (fresh) {
        responses = responses.filter((r) => fresh.has(r.question_id));
        if (responses.length > 0) {
          ({ error: responseError } = await supabase
            .from('test_responses')
            .upsert(responses, { onConflict: 'test_attempt_id,module_id,question_id' }));
        } else {
          responseError = null;
        }
      }
    }
    if (responseError) throw responseError;
  }
  return { id: data.id as string, skippedResponses, lightLimited: false };
}

/**
 * Replays a guest profile into the signed-in account. Every attempt is written
 * through submit_question_attempt using the guest's original event id as
 * client_event_id, so re-running the sync is idempotent and cannot double-count
 * coins, streaks or progress.
 */
export async function syncGuestProfile(
  profile: LocalProfile,
  onProgress?: (done: number, total: number) => void
): Promise<{ attempts: number; saved: number; flashcards: number; errors: string[] }> {
  const errors: string[] = [];
  let attempts = 0;
  let saved = 0;
  let flashcards = 0;

  const pending = profile.attempts.slice(-1000);
  for (let i = 0; i < pending.length; i += 1) {
    const attempt = pending[i];
    try {
      await submitAttemptCloud({
        questionId: attempt.questionId,
        response: attempt.response,
        mode: attempt.mode,
        timeSpentSeconds: attempt.timeSpentSeconds,
        clientEventId: attempt.eventId,
        sessionId: attempt.sessionId,
      });
      attempts += 1;
    } catch (error) {
      errors.push(`attempt ${attempt.eventId}: ${(error as Error).message}`);
      if (errors.length > 5) break;
    }
    onProgress?.(i + 1, pending.length);
  }

  for (const questionId of profile.saved) {
    try {
      await saveQuestionCloud(questionId);
      saved += 1;
    } catch (error) {
      errors.push(`saved ${questionId}: ${(error as Error).message}`);
    }
  }

  for (const [cardId, card] of Object.entries(profile.flashcards)) {
    try {
      await submitFlashcardCloud(cardId, card.lastQuality || 4, `guest-card:${cardId}:${card.lastReviewedAt}`);
      flashcards += 1;
    } catch (error) {
      errors.push(`flashcard ${cardId}: ${(error as Error).message}`);
    }
  }

  return { attempts, saved, flashcards, errors };
}

/* -------------------------------------------------------------------------
 * Safety, content-quality and data-rights writes.
 *
 * These are the user-facing "failsafe" endpoints: report a bad question, send
 * a safety/copyright/access appeal, export personal data, and delete an
 * account. Reports and appeals are insert-only for the reporter and readable
 * only by the reporter; only the operator (service role) can triage them.
 * ---------------------------------------------------------------------- */

/**
 * True when PostgREST rejects a write because a column from the safety
 * migration is not present in this project yet (PGRST204, schema cache miss).
 */
export function isMissingColumnError(message: string, column: string): boolean {
  const text = String(message).toLowerCase();
  return (
    text.includes(column.toLowerCase()) &&
    /pgrst204|could not find the|schema cache|column .* does not exist/.test(text)
  );
}

/** True when a table from the safety migration is missing (PGRST205). */
export function isMissingRelationError(message: string, relation: string): boolean {
  const text = String(message).toLowerCase();
  return (
    text.includes(relation.toLowerCase()) &&
    /pgrst205|could not find the table|schema cache|does not exist/.test(text)
  );
}

/** True when a security-definer RPC from the safety migration is missing. */
export function isMissingRoutineError(message: string, routine: string): boolean {
  const text = String(message).toLowerCase();
  return (
    text.includes(routine.toLowerCase()) &&
    /pgrst202|could not find the function|schema cache|does not exist/.test(text)
  );
}

export async function reportQuestion(args: {
  questionId: string;
  reason: string;
  details?: string;
  contactEmail?: string;
}): Promise<void> {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) {
    throw new Error('Please sign in to report a question.');
  }
  const row = {
    user_id: userId,
    question_id: args.questionId,
    reason: args.reason,
    details: args.details?.trim() ? args.details.trim().slice(0, 2000) : null,
  };
  const email = args.contactEmail?.trim().slice(0, 254);

  if (email) {
    const withEmail = await supabase
      .from('question_reports')
      .insert({ ...row, contact_email: email });
    if (!withEmail.error) return;
    if (!isMissingColumnError(withEmail.error.message, 'contact_email')) {
      throw withEmail.error;
    }
  }

  const plain = await supabase.from('question_reports').insert(row);
  if (plain.error) throw plain.error;
}

export async function submitAppeal(args: {
  category: string;
  subject: string;
  details: string;
  contactEmail?: string;
}): Promise<string> {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) {
    throw new Error('Please sign in to submit an appeal or safety report.');
  }
  const { data, error } = await supabase
    .from('user_appeals')
    .insert({
      user_id: userId,
      contact_email: args.contactEmail?.trim() ? args.contactEmail.trim().slice(0, 254) : null,
      category: args.category,
      subject: args.subject.trim().slice(0, 200),
      details: args.details.trim().slice(0, 8000),
    })
    .select('reference')
    .single();
  if (error) throw error;
  return String((data as { reference: string }).reference);
}

/**
 * Permanently deletes the signed-in account and every row that belongs to it.
 * Runs as a SECURITY DEFINER RPC so the browser never needs elevated keys.
 */
export interface AccountDeletionOutcome {
  deleted: boolean;
  /** Set when the self-serve RPC is not installed in this deployment. */
  setupRequired?: boolean;
  message: string;
}

export async function deleteMyAccount(): Promise<AccountDeletionOutcome> {
  const supabase = client();
  const { data, error } = await supabase.rpc('delete_own_account');
  if (error) {
    if (isMissingRoutineError(error.message, 'delete_own_account')) {
      // The erasure RPC ships in supabase/migrations/20261017000100_safety_compliance.sql.
      // Until a project owner pastes that migration into the SQL editor, no browser
      // client can delete an auth user (that needs elevated database privileges), so
      // be precise rather than reporting a generic failure.
      return {
        deleted: false,
        setupRequired: true,
        message:
          'Nothing was deleted and your data is untouched. Self-serve deletion is not switched on for this deployment yet, so please file an appeal below and we will delete your account and every row tied to it for you.',
      };
    }
    throw error;
  }
  await supabase.auth.signOut();
  const outcome = data as { deleted?: boolean; deleted_at?: string };
  return {
    deleted: outcome?.deleted !== false,
    message: 'Your account and every row tied to it were deleted.',
  };
}

/* -------------------------------------------------------------------------
 * Operator console + student notifications.
 *
 * Every admin call is a SECURITY DEFINER RPC that re-checks `is_admin()` on the
 * server, so the browser never holds a service key and a non-admin session gets
 * a plain "Operator access required" error. Notifications are one row per
 * operator reply and are readable only by their owner.
 * ---------------------------------------------------------------------- */

export interface AdminReportRow {
  id: string;
  question_id: string;
  reason: string;
  details: string | null;
  contact_email: string | null;
  status: string;
  created_at: string;
  reporter_name: string | null;
  reporter_email: string | null;
}

export interface AdminAppealRow {
  id: string;
  reference: string;
  category: string;
  subject: string;
  details: string;
  contact_email: string | null;
  status: string;
  created_at: string;
  reporter_name: string | null;
  reporter_email: string | null;
}

export interface AdminStudentRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  confirmed: boolean;
  age_band: string | null;
  created_at: string;
  hd_coins: number;
  current_streak: number;
  total_attempts: number;
  report_count: number;
}

export interface AdminPage<T> {
  total: number;
  open?: number;
  items: T[];
}

export interface AdminUnlockResult {
  ok: boolean;
  token?: string;
  expires_at?: string;
  message?: string;
  attempts_left?: number;
  locked_seconds?: number;
}

/**
 * One proof-of-work challenge for the console's human check. The browser finds
 * a nonce whose SHA-256(salt + nonce) has `difficulty` leading zero nibbles;
 * Postgres re-computes it and burns the challenge on use.
 */
export interface AdminHumanChallenge {
  id: string;
  salt: string;
  difficulty: number;
}

export async function adminHumanCheck(): Promise<AdminHumanChallenge> {
  const supabase = client();
  const { data, error } = await supabase.rpc('admin_human_check');
  if (error) throw error;
  return data as AdminHumanChallenge;
}

/**
 * Session + solved human check + passcode. The passcode is compared against a
 * bcrypt hash inside Postgres, and a success returns a random console token
 * that every admin RPC below requires.
 */
export async function adminUnlock(args: {
  passcode: string;
  challengeId: string;
  nonce: number;
}): Promise<AdminUnlockResult> {
  const supabase = client();
  const { data, error } = await supabase.rpc('admin_unlock', {
    p_passcode: args.passcode,
    p_challenge_id: args.challengeId,
    p_nonce: args.nonce,
  });
  if (error) throw error;
  return data as AdminUnlockResult;
}

export interface AdminLoginAttempt {
  id: number;
  ip: string;
  device: string;
  attempts: number;
  first_seen_at: string;
  last_seen_at: string;
}

/** Wrong-passcode rows, one per device (IP + user agent). */
export async function adminLoginAttempts(token: string): Promise<AdminLoginAttempt[]> {
  const supabase = client();
  const { data, error } = await supabase.rpc('admin_list_login_attempts', { p_token: token });
  if (error) throw error;
  const payload = (data ?? {}) as { items?: AdminLoginAttempt[] };
  return payload.items ?? [];
}

export async function adminDeleteLoginAttempt(token: string, id: number): Promise<void> {
  const supabase = client();
  const { error } = await supabase.rpc('admin_delete_login_attempt', { p_token: token, p_id: id });
  if (error) throw error;
}

export async function adminClearLoginAttempts(token: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.rpc('admin_clear_login_attempts', { p_token: token });
  if (error) throw error;
}

export async function adminSessionValid(token: string): Promise<boolean> {
  const supabase = client();
  if (!token) return false;
  const { data, error } = await supabase.rpc('admin_session_valid', { p_token: token });
  if (error) {
    if (isMissingRoutineError(error.message, 'admin_session_valid')) return false;
    throw error;
  }
  return Boolean(data);
}

export async function adminLock(token: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.rpc('admin_lock', { p_token: token });
  if (error) throw error;
}

export async function adminListReports(
  token: string,
  args: {
    status?: string | null;
    reason?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Promise<AdminPage<AdminReportRow>> {
  const supabase = client();
  const { data, error } = await supabase.rpc('admin_list_reports', {
    p_token: token,
    p_status: args.status ?? null,
    p_reason: args.reason ?? null,
    p_limit: args.limit ?? 50,
    p_offset: args.offset ?? 0,
  });
  if (error) throw error;
  return data as AdminPage<AdminReportRow>;
}

export async function adminSetReportStatus(
  token: string,
  id: string,
  status: string
): Promise<void> {
  const supabase = client();
  const { error } = await supabase.rpc('admin_set_report_status', {
    p_token: token,
    p_id: id,
    p_status: status,
  });
  if (error) throw error;
}

export async function adminBatchDeleteReports(
  token: string,
  args: {
    ids?: string[] | null;
    userId?: string | null;
    status?: string | null;
    olderThanDays?: number | null;
  }
): Promise<number> {
  const supabase = client();
  const { data, error } = await supabase.rpc('admin_batch_delete_reports', {
    p_token: token,
    p_ids: args.ids ?? null,
    p_user_id: args.userId ?? null,
    p_status: args.status ?? null,
    p_older_than_days: args.olderThanDays ?? null,
  });
  if (error) throw error;
  return Number((data as { deleted?: number })?.deleted ?? 0);
}

export async function adminListAppeals(
  token: string,
  args: { status?: string | null; limit?: number; offset?: number } = {}
): Promise<AdminPage<AdminAppealRow>> {
  const supabase = client();
  const { data, error } = await supabase.rpc('admin_list_appeals', {
    p_token: token,
    p_status: args.status ?? null,
    p_limit: args.limit ?? 50,
    p_offset: args.offset ?? 0,
  });
  if (error) throw error;
  return data as AdminPage<AdminAppealRow>;
}

export async function adminSetAppealStatus(
  token: string,
  id: string,
  status: string
): Promise<void> {
  const supabase = client();
  const { error } = await supabase.rpc('admin_set_appeal_status', {
    p_token: token,
    p_id: id,
    p_status: status,
  });
  if (error) throw error;
}

export async function adminBatchDeleteAppeals(
  token: string,
  args: {
    ids?: string[] | null;
    userId?: string | null;
    status?: string | null;
    olderThanDays?: number | null;
  }
): Promise<number> {
  const supabase = client();
  const { data, error } = await supabase.rpc('admin_batch_delete_appeals', {
    p_token: token,
    p_ids: args.ids ?? null,
    p_user_id: args.userId ?? null,
    p_status: args.status ?? null,
    p_older_than_days: args.olderThanDays ?? null,
  });
  if (error) throw error;
  return Number((data as { deleted?: number })?.deleted ?? 0);
}

export async function adminReply(
  token: string,
  args: { kind: 'report' | 'appeal'; id: string; title: string; body: string }
): Promise<{ delivered: boolean }> {
  const supabase = client();
  const routine = args.kind === 'report' ? 'admin_reply_to_report' : 'admin_reply_to_appeal';
  const params =
    args.kind === 'report'
      ? { p_token: token, p_report_id: args.id, p_title: args.title, p_body: args.body }
      : { p_token: token, p_appeal_id: args.id, p_title: args.title, p_body: args.body };
  const { data, error } = await supabase.rpc(routine, params);
  if (error) throw error;
  return { delivered: Boolean((data as { delivered?: boolean })?.delivered) };
}

export async function adminListStudents(
  token: string,
  args: { limit?: number; offset?: number } = {}
): Promise<AdminPage<AdminStudentRow>> {
  const supabase = client();
  const { data, error } = await supabase.rpc('admin_list_students', {
    p_token: token,
    p_limit: args.limit ?? 50,
    p_offset: args.offset ?? 0,
  });
  if (error) throw error;
  return data as AdminPage<AdminStudentRow>;
}

export interface StudentNotification {
  id: string;
  title: string;
  body: string;
  reference: string | null;
  created_at: string;
  seen_at: string | null;
}

export async function fetchMyNotifications(): Promise<StudentNotification[]> {
  const supabase = client();
  const { data, error } = await supabase
    .from('user_notifications')
    .select('id, title, body, reference, created_at, seen_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingRelationError(error.message, 'user_notifications')) return [];
    throw error;
  }
  return (data ?? []) as StudentNotification[];
}

export async function markMyNotificationsSeen(): Promise<number> {
  const supabase = client();
  const { data, error } = await supabase.rpc('mark_my_notifications_seen');
  if (error) {
    if (isMissingRoutineError(error.message, 'mark_my_notifications_seen')) return 0;
    throw error;
  }
  return Number(data ?? 0);
}

export async function fetchMyReports(): Promise<
  { id: string; question_id: string; reason: string; details: string | null; created_at: string }[]
> {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('question_reports')
    .select('id, question_id, reason, details, created_at')
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as { id: string; question_id: string; reason: string; details: string | null; created_at: string }[];
}
