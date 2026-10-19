import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import bankJson from '../data/questionBank.json';
import flashcardsJson from '../data/flashcards.json';
import resourcesJson from '../data/resources.json';
import * as cloud from './cloud';
import { getSupabase, isCloudConfigured } from './supabaseClient';
import * as local from './storage';
import type {
  DailyActivity,
  DatasetSource,
  Flashcard,
  FlashcardProgress,
  LocalProfile,
  Question,
  QuestionProgress,
  StudyResource,
  TestAttempt,
  UserSettings,
} from './types';

const bank = bankJson as unknown as {
  bank_version: string;
  licensing_note: string;
  sources: DatasetSource[];
  questions: Question[];
};
const deck = flashcardsJson as unknown as { cards: Flashcard[] };
const library = resourcesJson as unknown as { resources: StudyResource[] };

export type Mode = 'guest' | 'cloud';

export interface SubmitResult {
  isCorrect: boolean;
  coinsAwarded: number;
  duplicate: boolean;
  error?: string;
}

export interface AppValue {
  ready: boolean;
  mode: Mode;
  cloudConfigured: boolean;
  user: { id: string; email: string; displayName: string } | null;
  /** 'pending' means an account exists but the email is not confirmed yet. */
  accountStatus: 'guest' | 'pending' | 'cloud';
  pendingAccount: local.PendingAccount | null;
  bankVersion: string;
  licensingNote: string;
  sources: DatasetSource[];
  questions: Question[];
  flashcards: Flashcard[];
  resources: StudyResource[];
  hdCoins: number;
  currentStreak: number;
  bestStreak: number;
  progress: Record<string, QuestionProgress>;
  saved: string[];
  flashcardProgress: Record<string, FlashcardProgress>;
  testAttempts: TestAttempt[];
  dailyActivity: DailyActivity[];
  achievements: string[];
  ownedItems: string[];
  totals: {
    attempts: number;
    correct: number;
    accuracy: number;
    uniqueQuestions: number;
    mastered: number;
    dueCards: number;
    testsTaken: number;
  };
  settings: UserSettings;
  syncing: boolean;
  syncMessage: string | null;
  error: string | null;
  notice: string | null;
  actions: {
    signIn: (email: string, password: string) => Promise<void>;
    attemptSignIn: (email: string, password: string) => Promise<cloud.SignInAttempt>;
    signUp: (
      email: string,
      password: string,
      displayName: string,
      consent?: Record<string, string | boolean>
    ) => Promise<string>;
    signOut: () => Promise<void>;
    continueAsGuest: () => void;
    submitAttempt: (
      question: Question,
      response: string,
      meta: { mode: 'practice' | 'rush' | 'test' | 'review' | 'game'; timeSpentSeconds?: number; sessionId?: string | null }
    ) => Promise<SubmitResult>;
    reviewFlashcard: (cardId: string, quality: number) => Promise<void>;
    toggleSaved: (questionId: string) => Promise<void>;
    purchase: (itemId: string, cost: number) => Promise<{ ok: boolean; reason?: string }>;
    completeSession: (args: {
      activityType: 'practice_rush' | 'timed_session' | 'full_simulation' | 'mini_game';
      sessionId: string;
      questions: number;
      correct: number;
      timeSpentSeconds: number;
    }) => Promise<void>;
    recordTest: (attempt: TestAttempt, clientSessionId: string) => Promise<void>;
    verifySignupCode: (email: string, token: string) => Promise<void>;
    resendVerification: (email: string) => Promise<void>;
    syncGuestData: () => Promise<void>;
    updateSettings: (patch: Partial<UserSettings>) => void;
    dismissMessages: () => void;
    resetGuestProgress: () => void;
  };
}

const AppContext = createContext<AppValue | null>(null);

function emptyActivitySeries(source: Record<string, DailyActivity>, days = 14): DailyActivity[] {
  const out: DailyActivity[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today.getTime());
    date.setDate(date.getDate() - i);
    const key = local.todayKey(date);
    out.push(source[key] ?? local.emptyDay(key));
  }
  return out;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<LocalProfile>(() => local.loadProfile());
  const [snapshot, setSnapshot] = useState<cloud.CloudSnapshot | null>(null);
  const [user, setUser] = useState<AppValue['user']>(null);
  const [pendingAccount, setPendingAccount] = useState<local.PendingAccount | null>(() =>
    local.loadPendingAccount()
  );
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Module submissions run many attempts in one loop (27 R&W / 22 Math items),
  // so mutating actions must read the freshest profile rather than the closure
  // captured at the start of the run. The ref keeps the sequential writes exact.
  const profileRef = useRef<LocalProfile>(profile);

  // Auth events can fire before the import callback below is created, so the
  // handler reads it through a ref instead of a stale closure.
  const importLocalRef = useRef<(userId: string) => Promise<void>>(async () => {});
  const importingRef = useRef<Set<string>>(new Set());

  const persist = useCallback((next: LocalProfile) => {
    profileRef.current = next;
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
      if (!active) return;
      const sessionUser = data.session?.user;
      if (sessionUser) {
        setUser({
          id: sessionUser.id,
          email: sessionUser.email ?? '',
          displayName: (sessionUser.user_metadata?.display_name as string) ?? 'Student',
        });
        try {
          await refreshSnapshot();
        } catch (err) {
          setError(`Signed in, but loading your cloud progress failed: ${(err as Error).message}`);
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
        displayName: (session.user.user_metadata?.display_name as string) ?? 'Student',
      });
      setPendingAccount(null);
      local.clearPendingAccount();
      // Confirmation links land here with a live session; back up whatever this
      // device practised before the account existed.
      void importLocalRef.current(session.user.id);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [refreshSnapshot]);

  const mode: Mode = user && snapshot ? 'cloud' : 'guest';

  const progress = useMemo<Record<string, QuestionProgress>>(
    () => (mode === 'cloud' && snapshot ? snapshot.progress : profile.progress),
    [mode, snapshot, profile.progress]
  );
  const saved = useMemo(
    () => (mode === 'cloud' && snapshot ? snapshot.saved : profile.saved),
    [mode, snapshot, profile.saved]
  );
  const flashcardProgress = useMemo(
    () => (mode === 'cloud' && snapshot ? snapshot.flashcards : profile.flashcards),
    [mode, snapshot, profile.flashcards]
  );
  const daily = useMemo(
    () => (mode === 'cloud' && snapshot ? snapshot.dailyActivity : profile.dailyActivity),
    [mode, snapshot, profile.dailyActivity]
  );
  const testAttempts = useMemo(
    () => (mode === 'cloud' && snapshot ? snapshot.testAttempts : profile.testAttempts),
    [mode, snapshot, profile.testAttempts]
  );

  const totals = useMemo(() => {
    const attempts =
      mode === 'cloud' && snapshot
        ? snapshot.stats.totalAttempts
        : profile.attempts.length;
    const correct =
      mode === 'cloud' && snapshot
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

  const submitAttempt = useCallback<AppValue['actions']['submitAttempt']>(
    async (question, response, meta) => {
      const outcome = local.applyAttempt(profileRef.current, question, response, {
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
        } catch (err) {
          if (cloud.isUnknownQuestionError(err)) {
            // The cloud question table lags the bundled bank for a newly added
            // item. Keep the answer local and quiet: it still counts here.
            return { isCorrect: outcome.isCorrect, coinsAwarded: outcome.coinsAwarded, duplicate: false };
          }
          setError(
            `Your answer was saved locally, but writing it to your HDSAT account failed: ${(err as Error).message}`
          );
          return { isCorrect: outcome.isCorrect, coinsAwarded: outcome.coinsAwarded, duplicate: false, error: (err as Error).message };
        }
      }
      return { isCorrect: outcome.isCorrect, coinsAwarded: outcome.coinsAwarded, duplicate: false };
    },
    [mode, persist, refreshSnapshot]
  );

  const reviewFlashcard = useCallback(
    async (cardId: string, quality: number) => {
      const outcome = local.applyFlashcardReview(profileRef.current, cardId, quality);
      persist(outcome.profile);
      if (mode === 'cloud') {
        try {
          await cloud.submitFlashcardCloud(cardId, quality, local.newEventId());
          await refreshSnapshot();
        } catch (err) {
          setError(`Flashcard review saved locally; cloud sync failed: ${(err as Error).message}`);
        }
      }
    },
    [mode, persist, profile, refreshSnapshot]
  );

  const toggleSaved = useCallback(
    async (questionId: string) => {
      const next = local.toggleSaved(profileRef.current, questionId);
      persist(next);
      if (mode === 'cloud') {
        try {
          if (next.saved.includes(questionId)) await cloud.saveQuestionCloud(questionId);
          else await cloud.unsaveQuestionCloud(questionId);
          await refreshSnapshot();
        } catch (err) {
          setError(`Saved-list change kept locally; cloud sync failed: ${(err as Error).message}`);
        }
      }
    },
    [mode, persist, profile, refreshSnapshot]
  );

  const purchase = useCallback(
    async (itemId: string, cost: number) => {
      if (mode === 'cloud') {
        try {
          const itemType = itemId.startsWith('badge-') ? 'avatar_badge' : 'accent_theme';
          const result = await cloud.purchaseCosmeticCloud(itemId, itemType);
          await refreshSnapshot();
          return { ok: Boolean(result.ok), reason: result.reason as string | undefined };
        } catch (err) {
          return { ok: false, reason: (err as Error).message };
        }
      }
      const result = local.purchaseItem(profileRef.current, itemId, cost);
      persist(result.profile);
      return { ok: result.ok, reason: result.reason };
    },
    [mode, persist, profile, refreshSnapshot]
  );

  const completeSession = useCallback<AppValue['actions']['completeSession']>(
    async (args) => {
      if (mode === 'cloud') {
        try {
          await cloud.completeActivityCloud(args);
          await refreshSnapshot();
        } catch (err) {
          setError(`Session result was not recorded in your account: ${(err as Error).message}`);
        }
      }
    },
    [mode, refreshSnapshot]
  );

  const recordTest = useCallback(
    async (attempt: TestAttempt, clientSessionId: string) => {
      persist(local.recordTestAttempt(profileRef.current, attempt));
      if (mode === 'cloud') {
        try {
          const saved = await cloud.recordTestCloud(attempt, {
            clientSessionId,
            assessment: attempt.assessment,
            durationSeconds: attempt.durationSeconds,
            status: attempt.status,
          });
          await refreshSnapshot();
          if (saved.skippedResponses > 0) {
            setNotice(
              `Test saved to your account. ${saved.skippedResponses} answer(s) used newly added questions that are still being synced to the cloud bank, so those replies stay on this device for now.`
            );
          }
        } catch (err) {
          setError(`Test result kept locally; saving it to your account failed: ${(err as Error).message}`);
        }
      }
      const next = local.perfectModuleAchievement(profileRef.current, attempt.modules);
      if (next !== profileRef.current) persist(next);
    },
    [mode, persist, refreshSnapshot]
  );

  const syncGuestData = useCallback(async () => {
    if (mode !== 'cloud') {
      setError('Sign in first, then sync your guest history.');
      return;
    }
    setSyncing(true);
    setSyncMessage(null);
    try {
      const report = await cloud.syncGuestProfile(profileRef.current, (done, total) => {
        setSyncMessage(`Syncing ${done} of ${total} guest attempts...`);
      });
      await refreshSnapshot();
      setSyncMessage(
        `Synced ${report.attempts} attempt(s), ${report.saved} saved question(s) and ${report.flashcards} flashcard record(s).` +
          (report.errors.length > 0 ? ` ${report.errors.length} item(s) failed: ${report.errors[0]}` : '')
      );
    } catch (err) {
      setError(`Guest sync failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }, [mode, profile, refreshSnapshot]);

  /**
   * First meaningful sign-in imports this device's guest history exactly once.
   * Replays are idempotent, but the guard keeps later logins from re-uploading
   * a long local history on every device that happens to share a browser.
   */
  const importLocalHistoryOnce = useCallback(
    async (userId: string) => {
      if (typeof localStorage === 'undefined') return;
      const key = `hdsat.imported.${userId}`;
      if (
        localStorage.getItem(key) ||
        profileRef.current.attempts.length === 0 ||
        importingRef.current.has(userId)
      ) {
        return;
      }
      importingRef.current.add(userId);
      try {
        setSyncMessage('Importing your device practice history into your account...');
        const report = await cloud.syncGuestProfile(profileRef.current, (done, total) =>
          setSyncMessage(`Importing device history: ${done} of ${total} attempts...`)
        );
        localStorage.setItem(key, new Date().toISOString());
        await refreshSnapshot();
        setNotice(
          `Imported ${report.attempts} practice attempt(s), ${report.saved} saved question(s) and ${report.flashcards} flashcard review(s) from this device.`
        );
      } catch (err) {
        setError(`Signed in, but importing this device's history failed: ${(err as Error).message}`);
      } finally {
        importingRef.current.delete(userId);
        setSyncMessage(null);
      }
    },
    [refreshSnapshot]
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const data = await cloud.signIn(email, password);
      await refreshSnapshot();
      setPendingAccount(null);
      local.clearPendingAccount();
      if (data.user?.id) await importLocalHistoryOnce(data.user.id);
    },
    [importLocalHistoryOnce, refreshSnapshot]
  );

  const verifySignupCode = useCallback(
    async (email: string, token: string) => {
      setError(null);
      const data = await cloud.verifySignupCode(email, token);
      if (!data.session) {
        throw new Error('That code was not accepted. Check the email and try again.');
      }
      local.clearPendingAccount();
      setPendingAccount(null);
      await refreshSnapshot();
      if (data.user?.id) await importLocalHistoryOnce(data.user.id);
      setNotice('Email confirmed — you are signed in and your device history is backed up.');
    },
    [importLocalHistoryOnce, refreshSnapshot]
  );

  const resendVerification = useCallback(async (email: string) => {
    setError(null);
    await cloud.resendConfirmation(email);
    setNotice('Confirmation email sent again. Check your inbox and spam folder.');
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      consent: Record<string, string | boolean> = {}
    ) => {
      setError(null);
      const data = await cloud.signUp(email, password, displayName, consent);
      if (data.session) {
        local.clearPendingAccount();
        setPendingAccount(null);
        await refreshSnapshot();
        if (data.user?.id) await importLocalHistoryOnce(data.user.id);
        return 'Account created and signed in. Your device history is now backed up to the cloud.';
      }
      // Supabase requires email confirmation before it issues a session. The
      // account exists now, so the student keeps studying on this device and we
      // remember the address to explain what confirmation unlocks.
      const record = {
        email,
        displayName: displayName || 'Student',
        createdAt: new Date().toISOString(),
      };
      local.savePendingAccount(record);
      setPendingAccount(record);
      return `Account created for ${email}. We emailed a confirmation link — until you confirm, your work stays on this device and HDCoins are provisional.`;
    },
    [importLocalHistoryOnce, refreshSnapshot]
  );

  const attemptSignIn = useCallback(
    async (email: string, password: string): Promise<cloud.SignInAttempt> => {
      setError(null);
      const result = await cloud.attemptSignIn(email, password);
      if (result.ok) {
        local.clearPendingAccount();
        setPendingAccount(null);
        await refreshSnapshot();
        const userId = await cloud.getUserId();
        if (userId) await importLocalHistoryOnce(userId);
      }
      return result;
    },
    [importLocalHistoryOnce, refreshSnapshot]
  );

  const signOut = useCallback(async () => {
    await cloud.signOutCloud();
    setUser(null);
    setSnapshot(null);
  }, []);

  // Keep the import ref pointed at the latest callback (see onAuthStateChange).
  importLocalRef.current = importLocalHistoryOnce;

  const accountStatus: AppValue['accountStatus'] = user
    ? 'cloud'
    : pendingAccount
    ? 'pending'
    : 'guest';

  const updateSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      const next: LocalProfile = {
        ...profileRef.current,
        settings: { ...profileRef.current.settings, ...patch },
      };
      persist(next);
      if (mode === 'cloud' && patch.assessment) {
        cloud.setPreferredExamCloud(patch.assessment).catch((err: Error) =>
          setError(`Could not save your preferred exam: ${err.message}`)
        );
      }
    },
    [mode, persist, profile]
  );

  const value: AppValue = {
    ready,
    mode,
    cloudConfigured: isCloudConfigured,
    user,
    accountStatus,
    pendingAccount,
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
      attemptSignIn,
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
      verifySignupCode,
      resendVerification,
      syncGuestData,
      updateSettings,
      dismissMessages: () => {
        setError(null);
        setNotice(null);
      },
      resetGuestProgress: () => {
        local.clearProfile();
        const cleared = local.emptyProfile();
        profileRef.current = cleared;
        setProfile(cleared);
        setNotice('Local guest progress cleared.');
      },
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
