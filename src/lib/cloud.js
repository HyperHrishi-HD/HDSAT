import { getSupabase } from './supabaseClient';
const DB_MODE = {
    practice: 'practice',
    rush: 'rush',
    test: 'exam',
    review: 'question_bank',
    game: 'game',
};
export function toDbMode(mode) {
    return DB_MODE[mode] ?? 'practice';
}
export function toLocalDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function client() {
    const supabase = getSupabase();
    if (!supabase)
        throw new Error('Supabase is not configured for this deployment.');
    return supabase;
}
export async function getUserId() {
    const supabase = getSupabase();
    if (!supabase)
        return null;
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
}
export async function signUp(email, password, displayName) {
    const supabase = client();
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName || 'Student' } },
    });
    if (error)
        throw error;
    return data;
}
export async function signIn(email, password) {
    const supabase = client();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error)
        throw error;
    return data;
}
export async function signOutCloud() {
    const supabase = getSupabase();
    if (!supabase)
        return;
    await supabase.auth.signOut();
}
export async function resendConfirmation(email) {
    const supabase = client();
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error)
        throw error;
}
export async function fetchSnapshot() {
    const supabase = client();
    const userId = await getUserId();
    if (!userId)
        throw new Error('Not signed in.');
    const [statsRes, progressRes, savedRes, dailyRes, flashRes, achRes, testsRes, profileRes] = await Promise.all([
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
    const progress = {};
    (progressRes.data ?? []).forEach((row) => {
        const id = String(row.question_id);
        progress[id] = {
            questionId: id,
            attemptCount: Number(row.attempt_count ?? 0),
            correctCount: Number(row.correct_count ?? 0),
            consecutiveCorrect: Number(row.consecutive_correct ?? 0),
            status: row.status ?? 'unseen',
            lastResponse: String(row.last_response ?? ''),
            lastIsCorrect: Boolean(row.last_is_correct),
            lastAttemptedAt: String(row.last_attempted_at ?? ''),
        };
    });
    const dailyActivity = {};
    (dailyRes.data ?? []).forEach((row) => {
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
    const flashcards = {};
    (flashRes.data ?? []).forEach((row) => {
        const id = String(row.card_id);
        flashcards[id] = {
            cardId: id,
            stage: row.stage ?? 'new',
            repetitions: Number(row.repetitions ?? 0),
            intervalDays: Number(row.interval_days ?? 0),
            easeFactor: Number(row.ease_factor ?? 2.5),
            lastQuality: Number(row.last_quality ?? 0),
            nextDueAt: String(row.next_due_at ?? new Date().toISOString()),
            lastReviewedAt: String(row.last_reviewed_at ?? new Date().toISOString()),
        };
    });
    const testAttempts = (testsRes.data ?? []).map((row) => {
        const payload = (row.modules ?? {});
        return {
            id: String(row.id),
            assessment: String(row.assessment ?? 'SAT'),
            createdAt: String(row.completed_at ?? row.started_at ?? new Date().toISOString()),
            modules: Array.isArray(payload.modules) ? payload.modules : [],
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
        saved: (savedRes.data ?? []).map((row) => row.question_id),
        dailyActivity,
        flashcards,
        achievements: (achRes.data ?? []).map((row) => row.achievement_id),
        ownedItems: Array.isArray(profileRes.data?.unlocked_cosmetics)
            ? profileRes.data.unlocked_cosmetics
            : [],
        testAttempts,
        preferredExam: String(profileRes.data?.preferred_exam ?? 'SAT'),
        displayName: String(profileRes.data?.display_name ?? 'Student'),
    };
}
export async function submitAttemptCloud(args) {
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
    if (error)
        throw error;
    return data;
}
export async function submitFlashcardCloud(cardId, quality, clientEventId) {
    const supabase = client();
    const { data, error } = await supabase.rpc('submit_flashcard_review', {
        p_card_id: cardId,
        p_quality: quality,
        p_client_event_id: clientEventId,
        p_local_date: toLocalDate(),
    });
    if (error)
        throw error;
    return data;
}
export async function completeActivityCloud(args) {
    const supabase = client();
    const { data, error } = await supabase.rpc('complete_activity_session', {
        p_activity_type: args.activityType,
        p_session_id: args.sessionId,
        p_questions_count: args.questions,
        p_correct_count: args.correct,
        p_time_spent_seconds: args.timeSpentSeconds,
        p_local_date: toLocalDate(),
    });
    if (error)
        throw error;
    return data;
}
export async function purchaseCosmeticCloud(itemId, itemType) {
    const supabase = client();
    const { data, error } = await supabase.rpc('purchase_cosmetic_item', {
        p_item_id: itemId,
        p_item_type: itemType,
        p_local_request_id: `req-${Date.now()}`,
    });
    if (error)
        throw error;
    return { ok: true, ...data };
}
export async function setPreferredExamCloud(exam) {
    const supabase = client();
    const userId = await getUserId();
    if (!userId)
        return;
    const { error } = await supabase
        .from('profiles')
        .update({ preferred_exam: exam, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    if (error)
        throw error;
}
export async function saveQuestionCloud(questionId, note = '') {
    const supabase = client();
    const userId = await getUserId();
    if (!userId)
        return;
    const { error } = await supabase
        .from('saved_questions')
        .upsert({ user_id: userId, question_id: questionId, personal_note: note }, { onConflict: 'user_id,question_id' });
    if (error)
        throw error;
}
export async function unsaveQuestionCloud(questionId) {
    const supabase = client();
    const userId = await getUserId();
    if (!userId)
        return;
    const { error } = await supabase.from('saved_questions').delete().eq('user_id', userId).eq('question_id', questionId);
    if (error)
        throw error;
}
export async function recordTestCloud(attempt, options) {
    const supabase = client();
    const userId = await getUserId();
    if (!userId)
        throw new Error('Not signed in.');
    const rwModules = attempt.modules.filter((m) => m.section === 'Reading and Writing');
    const mathModules = attempt.modules.filter((m) => m.section === 'Math');
    const sum = (rows, key) => rows.reduce((acc, m) => acc + m[key], 0);
    const { data, error } = await supabase
        .from('test_attempts')
        .upsert({
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
    }, { onConflict: 'user_id,client_session_id' })
        .select('id')
        .single();
    if (error)
        throw error;
    const responses = attempt.modules.flatMap((module) => module.responses
        .filter((r) => r.response !== null && r.response !== '')
        .map((r, index) => ({
        test_attempt_id: data.id,
        user_id: userId,
        module_id: module.moduleId,
        question_id: r.questionId,
        question_order: index,
        selected_answer: r.response,
        is_correct: r.isCorrect,
    })));
    if (responses.length > 0) {
        const { error: responseError } = await supabase
            .from('test_responses')
            .upsert(responses, { onConflict: 'test_attempt_id,module_id,question_id' });
        if (responseError)
            throw responseError;
    }
    return data.id;
}
/**
 * Replays a guest profile into the signed-in account. Every attempt is written
 * through submit_question_attempt using the guest's original event id as
 * client_event_id, so re-running the sync is idempotent and cannot double-count
 * coins, streaks or progress.
 */
export async function syncGuestProfile(profile, onProgress) {
    const errors = [];
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
        }
        catch (error) {
            errors.push(`attempt ${attempt.eventId}: ${error.message}`);
            if (errors.length > 5)
                break;
        }
        onProgress?.(i + 1, pending.length);
    }
    for (const questionId of profile.saved) {
        try {
            await saveQuestionCloud(questionId);
            saved += 1;
        }
        catch (error) {
            errors.push(`saved ${questionId}: ${error.message}`);
        }
    }
    for (const [cardId, card] of Object.entries(profile.flashcards)) {
        try {
            await submitFlashcardCloud(cardId, card.lastQuality || 4, `guest-card:${cardId}:${card.lastReviewedAt}`);
            flashcards += 1;
        }
        catch (error) {
            errors.push(`flashcard ${cardId}: ${error.message}`);
        }
    }
    return { attempts, saved, flashcards, errors };
}
