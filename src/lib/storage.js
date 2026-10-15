import { ACHIEVEMENTS } from './catalog';
import { checkAnswer } from './grading';
import { scheduleReview } from './sm2';
/**
 * Guest-mode persistence. The rules implemented here deliberately mirror the
 * authoritative PL/pgSQL functions in supabase/migrations so that a guest's
 * history produces the same coins, streaks and mastery states after sync.
 */
export const STORAGE_KEY = 'hdsat.profile.v1';
export const DAILY_QUESTION_COIN_CAP = 60;
export const DAILY_FLASHCARD_COIN_CAP = 15;
const PROFILE_VERSION = 1;
const MAX_LOCAL_ATTEMPTS = 2000;
export function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
export function newEventId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        return crypto.randomUUID();
    return `evt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
export function emptyDay(date) {
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
export function emptyProfile() {
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
        settings: {
            assessment: 'SAT',
            excludePreviouslyCorrect: false,
            excludeReleasedPracticeSet: false,
            timerSound: false,
        },
    };
}
export function loadProfile() {
    if (typeof localStorage === 'undefined')
        return emptyProfile();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return emptyProfile();
        const parsed = JSON.parse(raw);
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
            achievements: parsed.achievements ?? [],
            attempts: parsed.attempts ?? [],
            testAttempts: parsed.testAttempts ?? [],
            version: PROFILE_VERSION,
        };
    }
    catch {
        return emptyProfile();
    }
}
export function saveProfile(profile) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        const trimmed = {
            ...profile,
            attempts: profile.attempts.slice(-MAX_LOCAL_ATTEMPTS),
            testAttempts: profile.testAttempts.slice(-50),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    }
    catch {
        /* storage full or unavailable: the in-memory profile stays authoritative */
    }
}
export function clearProfile() {
    if (typeof localStorage === 'undefined')
        return;
    localStorage.removeItem(STORAGE_KEY);
}
function withDay(profile, date) {
    if (profile.dailyActivity[date])
        return profile;
    return { ...profile, dailyActivity: { ...profile.dailyActivity, [date]: emptyDay(date) } };
}
function bumpDay(profile, date, delta) {
    const current = profile.dailyActivity[date] ?? emptyDay(date);
    const next = {
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
function previousDateKey(date) {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() - 1);
    return todayKey(copy);
}
export function updateStreak(profile, date) {
    if (profile.lastActiveDate === date)
        return profile;
    const yesterday = previousDateKey(new Date(`${date}T12:00:00`));
    const current = profile.lastActiveDate === yesterday ? profile.currentStreak + 1 : 1;
    return {
        ...profile,
        currentStreak: current,
        bestStreak: Math.max(profile.bestStreak, current),
        lastActiveDate: date,
    };
}
export function applyAttempt(profile, question, response, meta) {
    const now = meta.date ?? new Date();
    const date = todayKey(now);
    const eventId = meta.eventId ?? newEventId();
    if (profile.attempts.some((attempt) => attempt.eventId === eventId)) {
        return {
            profile,
            isCorrect: profile.progress[question.id]?.lastIsCorrect ?? false,
            coinsAwarded: 0,
            duplicate: true,
            progress: profile.progress[question.id] ??
                {
                    questionId: question.id,
                    attemptCount: 0,
                    correctCount: 0,
                    consecutiveCorrect: 0,
                    status: 'unseen',
                    lastResponse: '',
                    lastIsCorrect: false,
                    lastAttemptedAt: '',
                },
            unlocked: [],
        };
    }
    const isCorrect = checkAnswer(question, response);
    const existing = profile.progress[question.id];
    const isFirstAttempt = !existing;
    const wasPreviouslyCorrect = (existing?.correctCount ?? 0) > 0;
    const consecutive = isCorrect ? (existing?.consecutiveCorrect ?? 0) + 1 : 0;
    const status = consecutive >= 2 ? 'mastered' : isCorrect ? 'correct' : 'incorrect';
    const progress = {
        questionId: question.id,
        attemptCount: (existing?.attemptCount ?? 0) + 1,
        correctCount: (existing?.correctCount ?? 0) + (isCorrect ? 1 : 0),
        consecutiveCorrect: consecutive,
        status,
        lastResponse: response,
        lastIsCorrect: isCorrect,
        lastAttemptedAt: now.toISOString(),
    };
    const attempt = {
        eventId,
        questionId: question.id,
        response,
        isCorrect,
        mode: meta.mode,
        difficulty: question.difficulty,
        section: question.section,
        timeSpentSeconds: Math.max(0, Math.round(meta.timeSpentSeconds ?? 0)),
        createdAt: now.toISOString(),
        sessionId: meta.sessionId ?? null,
    };
    let next = withDay(profile, date);
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
        if (isFirstAttempt)
            coinsAwarded += 1;
        if (isCorrect && !wasPreviouslyCorrect)
            coinsAwarded += 1;
    }
    next = updateStreak(next, date);
    if (coinsAwarded > 0) {
        next = { ...next, hdCoins: next.hdCoins + coinsAwarded };
        next = bumpDay(next, date, { coinsEarned: coinsAwarded });
    }
    const unlocked = evaluateAchievements(next, profile.achievements);
    if (unlocked.length > 0) {
        next = { ...next, achievements: [...next.achievements, ...unlocked] };
    }
    return { profile: next, isCorrect, coinsAwarded, duplicate: false, progress, unlocked };
}
export function applyFlashcardReview(profile, cardId, quality, now = new Date()) {
    const date = todayKey(now);
    const previous = profile.flashcards[cardId];
    const wasDue = !previous || new Date(previous.nextDueAt).getTime() <= now.getTime() + 5 * 60 * 1000;
    const outcome = scheduleReview(previous, quality, now);
    let next = withDay(profile, date);
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
    const alreadyRewarded = next.attempts.some((attempt) => attempt.mode === 'review' && attempt.questionId === cardId && attempt.createdAt.slice(0, 10) === date);
    let coinsAwarded = 0;
    if (wasDue && !alreadyRewarded && coinsToday < DAILY_FLASHCARD_COIN_CAP) {
        coinsAwarded = 1;
        next = { ...next, hdCoins: next.hdCoins + 1 };
        next = bumpDay(next, date, { coinsEarned: coinsAwarded });
    }
    const unlocked = evaluateAchievements(next, profile.achievements);
    if (unlocked.length > 0)
        next = { ...next, achievements: [...next.achievements, ...unlocked] };
    return { profile: next, coinsAwarded };
}
export function recordTestAttempt(profile, attempt) {
    const date = todayKey(new Date(attempt.createdAt));
    let next = withDay(profile, date);
    next = {
        ...next,
        testAttempts: [...next.testAttempts, attempt],
    };
    next = bumpDay(next, date, { sessionsCompleted: 1 });
    const unlocked = evaluateAchievements(next, profile.achievements);
    if (unlocked.length > 0)
        next = { ...next, achievements: [...next.achievements, ...unlocked] };
    return next;
}
export function toggleSaved(profile, questionId) {
    const has = profile.saved.includes(questionId);
    return {
        ...profile,
        saved: has ? profile.saved.filter((id) => id !== questionId) : [...profile.saved, questionId],
    };
}
export function purchaseItem(profile, itemId, cost) {
    if (profile.ownedItems.includes(itemId)) {
        return { profile, ok: false, reason: 'You already own this item.' };
    }
    if (profile.hdCoins < cost) {
        return { profile, ok: false, reason: 'Not enough HDCoins yet.' };
    }
    return {
        profile: { ...profile, hdCoins: profile.hdCoins - cost, ownedItems: [...profile.ownedItems, itemId] },
        ok: true,
    };
}
export function evaluateAchievements(profile, alreadyUnlocked) {
    const owned = new Set(alreadyUnlocked);
    const unlocked = [];
    const totalAttempts = profile.attempts.length;
    const flashcardsReviewed = Object.keys(profile.flashcards).length;
    const mastered = Object.values(profile.progress).filter((p) => p.status === 'mastered').length;
    const rushCorrect = profile.attempts.filter((a) => a.mode === 'rush' && a.isCorrect).length;
    const grant = (id, condition) => {
        if (condition && !owned.has(id) && !unlocked.includes(id))
            unlocked.push(id);
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
export function perfectModuleAchievement(profile, modules) {
    if (!modules.some((m) => m.total > 0 && m.correct === m.total))
        return profile;
    if (profile.achievements.includes('perfect-module'))
        return profile;
    return { ...profile, achievements: [...profile.achievements, 'perfect-module'] };
}
