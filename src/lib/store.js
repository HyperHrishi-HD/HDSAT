import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import bankJson from '../data/questionBank.json';
import flashcardsJson from '../data/flashcards.json';
import resourcesJson from '../data/resources.json';
import * as cloud from './cloud';
import { getSupabase, isCloudConfigured } from './supabaseClient';
import * as local from './storage';
const bank = bankJson;
const deck = flashcardsJson;
const library = resourcesJson;
const AppContext = createContext(null);
function emptyActivitySeries(source, days = 14) {
    const out = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i -= 1) {
        const date = new Date(today.getTime());
        date.setDate(date.getDate() - i);
        const key = local.todayKey(date);
        out.push(source[key] ?? local.emptyDay(key));
    }
    return out;
}
export function AppProvider({ children }) {
    const [profile, setProfile] = useState(() => local.loadProfile());
    const [snapshot, setSnapshot] = useState(null);
    const [user, setUser] = useState(null);
    const [ready, setReady] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const persist = useCallback((next) => {
        setProfile(next);
        local.saveProfile(next);
    }, []);
    const refreshSnapshot = useCallback(async () => {
        const data = await cloud.fetchSnapshot();
        setSnapshot(data);
        return data;
    }, []);
    useEffect(() => {
        const supabase = getSupabase();
        if (!supabase) {
            setReady(true);
            return;
        }
        let active = true;
        supabase.auth.getSession().then(async ({ data }) => {
            if (!active)
                return;
            const sessionUser = data.session?.user;
            if (sessionUser) {
                setUser({
                    id: sessionUser.id,
                    email: sessionUser.email ?? '',
                    displayName: sessionUser.user_metadata?.display_name ?? 'Student',
                });
                try {
                    await refreshSnapshot();
                }
                catch (err) {
                    setError(`Signed in, but loading your cloud progress failed: ${err.message}`);
                }
            }
            setReady(true);
        });
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.user) {
                setUser(null);
                setSnapshot(null);
                return;
            }
            setUser({
                id: session.user.id,
                email: session.user.email ?? '',
                displayName: session.user.user_metadata?.display_name ?? 'Student',
            });
        });
        return () => {
            active = false;
            subscription.subscription.unsubscribe();
        };
    }, [refreshSnapshot]);
    const mode = user && snapshot ? 'cloud' : 'guest';
    const progress = useMemo(() => (mode === 'cloud' && snapshot ? snapshot.progress : profile.progress), [mode, snapshot, profile.progress]);
    const saved = useMemo(() => (mode === 'cloud' && snapshot ? snapshot.saved : profile.saved), [mode, snapshot, profile.saved]);
    const flashcardProgress = useMemo(() => (mode === 'cloud' && snapshot ? snapshot.flashcards : profile.flashcards), [mode, snapshot, profile.flashcards]);
    const daily = useMemo(() => (mode === 'cloud' && snapshot ? snapshot.dailyActivity : profile.dailyActivity), [mode, snapshot, profile.dailyActivity]);
    const testAttempts = useMemo(() => (mode === 'cloud' && snapshot ? snapshot.testAttempts : profile.testAttempts), [mode, snapshot, profile.testAttempts]);
    const totals = useMemo(() => {
        const attempts = mode === 'cloud' && snapshot
            ? snapshot.stats.totalAttempts
            : profile.attempts.length;
        const correct = mode === 'cloud' && snapshot
            ? snapshot.stats.correctAttempts
            : profile.attempts.filter((a) => a.isCorrect).length;
        const mastered = Object.values(progress).filter((p) => p.status === 'mastered').length;
        const now = Date.now();
        const dueCards = deck.cards.filter((card) => {
            const state = flashcardProgress[card.id];
            return !state || new Date(state.nextDueAt).getTime() <= now;
        }).length;
        return {
            attempts,
            correct,
            accuracy: attempts > 0 ? correct / attempts : 0,
            uniqueQuestions: Object.keys(progress).length,
            mastered,
            dueCards,
            testsTaken: testAttempts.length,
        };
    }, [mode, snapshot, profile, progress, flashcardProgress, testAttempts]);
    const submitAttempt = useCallback(async (question, response, meta) => {
        const outcome = local.applyAttempt(profile, question, response, {
            mode: meta.mode,
            timeSpentSeconds: meta.timeSpentSeconds,
            sessionId: meta.sessionId ?? null,
        });
        persist(outcome.profile);
        if (outcome.unlocked.length > 0) {
            setNotice(`Achievement unlocked: ${outcome.unlocked.join(', ')}`);
        }
        if (mode === 'cloud') {
            try {
                const result = await cloud.submitAttemptCloud({
                    questionId: question.id,
                    response,
                    mode: meta.mode,
                    timeSpentSeconds: meta.timeSpentSeconds ?? 0,
                    clientEventId: outcome.profile.attempts[outcome.profile.attempts.length - 1].eventId,
                    sessionId: meta.sessionId ?? null,
                });
                await refreshSnapshot();
                return {
                    isCorrect: Boolean(result.is_correct),
                    coinsAwarded: Number(result.coins_awarded ?? 0),
                    duplicate: Boolean(result.duplicate),
                };
            }
            catch (err) {
                setError(`Your answer was saved locally, but writing it to your HDSAT account failed: ${err.message}`);
                return { isCorrect: outcome.isCorrect, coinsAwarded: outcome.coinsAwarded, duplicate: false, error: err.message };
            }
        }
        return { isCorrect: outcome.isCorrect, coinsAwarded: outcome.coinsAwarded, duplicate: false };
    }, [mode, persist, profile, refreshSnapshot]);
    const reviewFlashcard = useCallback(async (cardId, quality) => {
        const outcome = local.applyFlashcardReview(profile, cardId, quality);
        persist(outcome.profile);
        if (mode === 'cloud') {
            try {
                await cloud.submitFlashcardCloud(cardId, quality, local.newEventId());
                await refreshSnapshot();
            }
            catch (err) {
                setError(`Flashcard review saved locally; cloud sync failed: ${err.message}`);
            }
        }
    }, [mode, persist, profile, refreshSnapshot]);
    const toggleSaved = useCallback(async (questionId) => {
        const next = local.toggleSaved(profile, questionId);
        persist(next);
        if (mode === 'cloud') {
            try {
                if (next.saved.includes(questionId))
                    await cloud.saveQuestionCloud(questionId);
                else
                    await cloud.unsaveQuestionCloud(questionId);
                await refreshSnapshot();
            }
            catch (err) {
                setError(`Saved-list change kept locally; cloud sync failed: ${err.message}`);
            }
        }
    }, [mode, persist, profile, refreshSnapshot]);
    const purchase = useCallback(async (itemId, cost) => {
        if (mode === 'cloud') {
            try {
                const itemType = itemId.startsWith('badge-') ? 'avatar_badge' : 'accent_theme';
                const result = await cloud.purchaseCosmeticCloud(itemId, itemType);
                await refreshSnapshot();
                return { ok: Boolean(result.ok), reason: result.reason };
            }
            catch (err) {
                return { ok: false, reason: err.message };
            }
        }
        const result = local.purchaseItem(profile, itemId, cost);
        persist(result.profile);
        return { ok: result.ok, reason: result.reason };
    }, [mode, persist, profile, refreshSnapshot]);
    const completeSession = useCallback(async (args) => {
        if (mode === 'cloud') {
            try {
                await cloud.completeActivityCloud(args);
                await refreshSnapshot();
            }
            catch (err) {
                setError(`Session result was not recorded in your account: ${err.message}`);
            }
        }
    }, [mode, refreshSnapshot]);
    const recordTest = useCallback(async (attempt, clientSessionId) => {
        persist(local.recordTestAttempt(profile, attempt));
        if (mode === 'cloud') {
            try {
                await cloud.recordTestCloud(attempt, {
                    clientSessionId,
                    assessment: attempt.assessment,
                    durationSeconds: attempt.durationSeconds,
                });
                await refreshSnapshot();
            }
            catch (err) {
                setError(`Test result kept locally; saving it to your account failed: ${err.message}`);
            }
        }
        const next = local.perfectModuleAchievement(profile, attempt.modules);
        if (next !== profile)
            persist(next);
    }, [mode, persist, profile, refreshSnapshot]);
    const syncGuestData = useCallback(async () => {
        if (mode !== 'cloud') {
            setError('Sign in first, then sync your guest history.');
            return;
        }
        setSyncing(true);
        setSyncMessage(null);
        try {
            const report = await cloud.syncGuestProfile(profile, (done, total) => {
                setSyncMessage(`Syncing ${done} of ${total} guest attempts...`);
            });
            await refreshSnapshot();
            setSyncMessage(`Synced ${report.attempts} attempt(s), ${report.saved} saved question(s) and ${report.flashcards} flashcard record(s).` +
                (report.errors.length > 0 ? ` ${report.errors.length} item(s) failed: ${report.errors[0]}` : ''));
        }
        catch (err) {
            setError(`Guest sync failed: ${err.message}`);
        }
        finally {
            setSyncing(false);
        }
    }, [mode, profile, refreshSnapshot]);
    const signIn = useCallback(async (email, password) => {
        setError(null);
        await cloud.signIn(email, password);
        await refreshSnapshot();
    }, [refreshSnapshot]);
    const signUp = useCallback(async (email, password, displayName) => {
        setError(null);
        const data = await cloud.signUp(email, password, displayName);
        if (data.session) {
            await refreshSnapshot();
            return 'Account created and signed in.';
        }
        return 'Account created. Check your email to confirm the address, then sign in.';
    }, [refreshSnapshot]);
    const signOut = useCallback(async () => {
        await cloud.signOutCloud();
        setUser(null);
        setSnapshot(null);
    }, []);
    const updateSettings = useCallback((patch) => {
        const next = { ...profile, settings: { ...profile.settings, ...patch } };
        persist(next);
        if (mode === 'cloud' && patch.assessment) {
            cloud.setPreferredExamCloud(patch.assessment).catch((err) => setError(`Could not save your preferred exam: ${err.message}`));
        }
    }, [mode, persist, profile]);
    const value = {
        ready,
        mode,
        cloudConfigured: isCloudConfigured,
        user,
        bankVersion: bank.bank_version,
        licensingNote: bank.licensing_note,
        sources: bank.sources,
        questions: bank.questions,
        flashcards: deck.cards,
        resources: library.resources,
        hdCoins: mode === 'cloud' && snapshot ? snapshot.stats.hdCoins : profile.hdCoins,
        currentStreak: mode === 'cloud' && snapshot ? snapshot.stats.currentStreak : profile.currentStreak,
        bestStreak: mode === 'cloud' && snapshot ? snapshot.stats.bestStreak : profile.bestStreak,
        progress,
        saved,
        flashcardProgress,
        testAttempts,
        dailyActivity: emptyActivitySeries(daily),
        achievements: mode === 'cloud' && snapshot ? snapshot.achievements : profile.achievements,
        ownedItems: mode === 'cloud' && snapshot ? snapshot.ownedItems : profile.ownedItems,
        totals,
        settings: profile.settings,
        syncing,
        syncMessage,
        error,
        notice,
        actions: {
            signIn,
            signUp,
            signOut,
            continueAsGuest: () => {
                setNotice('Guest mode active. Your progress is stored in this browser only.');
            },
            submitAttempt,
            reviewFlashcard,
            toggleSaved,
            purchase,
            completeSession,
            recordTest,
            syncGuestData,
            updateSettings,
            dismissMessages: () => {
                setError(null);
                setNotice(null);
            },
            resetGuestProgress: () => {
                local.clearProfile();
                setProfile(local.emptyProfile());
                setNotice('Local guest progress cleared.');
            },
        },
    };
    return _jsx(AppContext.Provider, { value: value, children: children });
}
export function useApp() {
    const context = useContext(AppContext);
    if (!context)
        throw new Error('useApp must be used inside AppProvider');
    return context;
}
