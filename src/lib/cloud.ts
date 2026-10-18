import type { SupabaseClient } from '@supabase/supabase-js';
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
    options: { data: { display_name: displayName || 'Student', ...consent } },
  });
  if (error) throw error;
  return data;
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
  const { error } = await supabase.auth.resend({ type: 'signup', email });
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
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(20),
      supabase.from('profiles').select('display_name, preferred_exam, unlocked_cosmetics').eq('user_id', userId).maybeSingle(),
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
    const payload = (row.modules ?? {}) as { modules?: TestAttempt['modules'] };
    return {
      id: String(row.id),
      assessment: String(row.assessment ?? 'SAT'),
      createdAt: String(row.completed_at ?? row.started_at ?? new Date().toISOString()),
      modules: Array.isArray(payload.modules) ? (payload.modules as TestAttempt['modules']) : [],
      rwEstimate: null,
      mathEstimate: null,
      totalEstimate: null,
      durationSeconds: Number(row.time_spent_seconds ?? 0),
    };
  });

  return {
    stats: {
      hdCoins: Number(statsRow.hd_coins ?? 0),
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
    achievements: (achRes.data ?? []).map((row: { achievement_id: string }) => row.achievement_id),
    ownedItems: Array.isArray(profileRes.data?.unlocked_cosmetics)
      ? (profileRes.data.unlocked_cosmetics as string[])
      : [],
    testAttempts,
    preferredExam: String(profileRes.data?.preferred_exam ?? 'SAT'),
    displayName: String(profileRes.data?.display_name ?? 'Student'),
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

export async function purchaseCosmeticCloud(
  itemId: string,
  itemType: 'accent_theme' | 'avatar_badge'
): Promise<{ ok: boolean; reason?: string; hd_coins?: number }> {
  const supabase = client();
  const { data, error } = await supabase.rpc('purchase_cosmetic_item', {
    p_item_id: itemId,
    p_item_type: itemType,
    p_local_request_id: `req-${Date.now()}`,
  });
  if (error) throw error;
  return { ok: true, ...(data as Record<string, unknown>) };
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

export async function recordTestCloud(
  attempt: TestAttempt,
  options: { clientSessionId: string; assessment: string; durationSeconds: number }
) {
  const supabase = client();
  const userId = await getUserId();
  if (!userId) throw new Error('Not signed in.');
  const rwModules = attempt.modules.filter((m) => m.section === 'Reading and Writing');
  const mathModules = attempt.modules.filter((m) => m.section === 'Math');
  const sum = (rows: typeof attempt.modules, key: 'correct' | 'total') =>
    rows.reduce((acc, m) => acc + m[key], 0);

  const { data, error } = await supabase
    .from('test_attempts')
    .upsert(
      {
        user_id: userId,
        client_session_id: options.clientSessionId,
        assessment: options.assessment,
        mode: 'full_adaptive',
        status: 'completed',
        modules: { modules: attempt.modules },
        rw_route: rwModules.some((m) => m.tier === 'upper') ? 'higher' : 'lower',
        math_route: mathModules.some((m) => m.tier === 'upper') ? 'higher' : 'lower',
        raw_correct: sum(attempt.modules, 'correct'),
        raw_total: sum(attempt.modules, 'total'),
        rw_correct: sum(rwModules, 'correct'),
        rw_total: sum(rwModules, 'total'),
        math_correct: sum(mathModules, 'correct'),
        math_total: sum(mathModules, 'total'),
        estimated_score_range: {
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

  const responses = attempt.modules.flatMap((module) =>
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
  if (responses.length > 0) {
    const { error: responseError } = await supabase
      .from('test_responses')
      .upsert(responses, { onConflict: 'test_attempt_id,module_id,question_id' });
    if (responseError) throw responseError;
  }
  return data.id as string;
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
  const row = {
    user_id: userId,
    question_id: args.questionId,
    reason: args.reason,
    details: args.details?.trim() ? args.details.trim() : null,
  };
  const email = args.contactEmail?.trim();

  if (email) {
    const withEmail = await supabase
      .from('question_reports')
      .insert({ ...row, contact_email: email });
    if (!withEmail.error) return;
    // A project that has not yet run the safety migration has no contact_email
    // column. The report itself is still valuable, so fall through and file it
    // without the optional reply address instead of losing the report.
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
  const { data, error } = await supabase
    .from('user_appeals')
    .insert({
      user_id: userId,
      contact_email: args.contactEmail?.trim() ? args.contactEmail.trim() : null,
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
export async function deleteMyAccount(): Promise<{ deleted: boolean; deleted_at: string }> {
  const supabase = client();
  const { data, error } = await supabase.rpc('delete_own_account');
  if (error) {
    if (isMissingRoutineError(error.message, 'delete_own_account')) {
      throw new Error(
        'Self-serve account deletion is not enabled on this deployment yet, so nothing was deleted. ' +
          'Please file an appeal instead and we will delete your account for you.'
      );
    }
    throw error;
  }
  await supabase.auth.signOut();
  return data as { deleted: boolean; deleted_at: string };
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
