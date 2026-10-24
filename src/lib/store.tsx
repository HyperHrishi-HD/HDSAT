import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import bankJson from '../data/questionBank.json';
import flashcardsJson from '../data/flashcards.json';
import resourcesJson from '../data/resources.json';
import { achievementById, itemById } from './catalog';
import * as cloud from './cloud';
import { getSupabase, isCloudConfigured } from './supabaseClient';
import * as local from './storage';
import { timingSamplesFromAttempts, type TimingSample } from './timing';
import type {
  DailyActivity,
  DatasetSource,
  Flashcard,
  FlashcardProgress,
  LocalAttempt,
  LocalProfile,
  Question,
  QuestionProgress,
  RushScoreRecord,
  StudyResource,
  TestAttempt,
  TestScoreEntry,
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
  /** Signed in, but the address has not been proven with an emailed code. */
  emailVerified: boolean;
  pendingAccount: local.PendingAccount | null;
  bankVersion: string;
  licensingNote: string;
  sources: DatasetSource[];
  questions: Question[];
  flashcards: Flashcard[];
  resources: StudyResource[];
  hdCoins: number;
  /** Total earned across the life of the account; purchases do not reduce it. */
  lifetimeCoins: number;
  currentStreak: number;
  bestStreak: number;
  progress: Record<string, QuestionProgress>;
  saved: string[];
  flashcardProgress: Record<string, FlashcardProgress>;
  /** Practice Rush personal bests, keyed by `rushSetupKey()`. Device-local. */
  rushScores: Record<string, RushScoreRecord>;
  testAttempts: TestAttempt[];
  /** Scores of deleted simulations, newest first (cloud + this device). */
  scoreLog: TestScoreEntry[];
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
  /** Timed attempts recorded on this device, used for pacing comparisons. */
  timingSamples: TimingSample[];
  /** Recent device attempts, with per-item timing (guest and cloud alike). */
  attempts: LocalAttempt[];
  syncing: boolean;
  syncMessage: string | null;
  error: string | null;
  notice: string | null;
  authModalOpen: boolean;
  authModalView: 'signin' | 'verify';
  actions: {
    openAuthModal: (view?: 'signin' | 'verify') => void;
    closeAuthModal: () => void;
    signIn: (email: string, password: string) => Promise<void>;
    attemptSignIn: (email: string, password: string) => Promise<cloud.SignInAttempt>;
    signUp: (
      email: string,
      password: string,
      displayName: string,
      consent?: Record<string, string | boolean>
    ) => Promise<{ message: string; verificationRequired: boolean }>;
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
    /** Stores a finished Practice Rush score for its exact settings combination. */
    recordRushScore: (key: string, score: number) => { record: RushScoreRecord; improved: boolean };
    completeSession: (args: {
      activityType: 'practice_rush' | 'timed_session' | 'full_simulation' | 'mini_game';
      sessionId: string;
      questions: number;
      correct: number;
      timeSpentSeconds: number;
    }) => Promise<void>;
    recordTest: (attempt: TestAttempt, clientSessionId: string) => Promise<void>;
    /** Removes a saved simulation; a finished run leaves its score in the log. */
    deleteTest: (attemptId: string) => Promise<void>;
    /**
     * Local-first in-progress snapshot: writes localStorage synchronously (so a
     * closed tab can never lose the run) and mirrors to the cloud at most every
     * 20 seconds. Used by the full-test autosave loop.
     */
    autosaveTest: (attempt: TestAttempt, clientSessionId: string) => void;
    /** Fire the pending cloud mirror immediately (page hiding/closing). */
    flushTestSync: (attempt: TestAttempt, clientSessionId: string) => void;
    verifySignupCode: (email: string, token: string) => Promise<void>;
    resendVerification: (email: string) => Promise<void>;
    syncGuestData: () => Promise<void>;
    updateSettings: (patch: Partial<UserSettings>) => void;
    /** Rename the signed-in student, or the name remembered for a pending signup. */
    updateDisplayName: (name: string) => Promise<void>;
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
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalView, setAuthModalView] = useState<'signin' | 'verify'>('signin');

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
    // Adopt the cloud's test goal only when this device has none, so a local
    // choice is never silently replaced by an older server copy.
    const current = profileRef.current;
    if (data.targetTestDate && !current.settings.testDate) {
      persist({
        ...current,
        settings: { ...current.settings, testDate: data.targetTestDate },
      });
    }
    return data;
  }, [persist]);

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
  // Light account: signed in, address not proven yet. Declared before the
  // callbacks so they close over the current value.
  const emailVerified = Boolean(snapshot?.emailVerifiedAt);

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
  // Cloud rows are authoritative for completed runs, but a run autosaved on
  // THIS device may not have reached the cloud yet (throttled sync, or the tab
  // closed mid-request). Union by id so an in-progress run is always visible
  // and resumable here even if the mirror never landed.
  const testAttempts = useMemo(() => {
    if (mode !== 'cloud' || !snapshot) return profile.testAttempts;
    const byId = new Map<string, TestAttempt>();
    for (const remote of snapshot.testAttempts) byId.set(remote.id, remote);
    for (const localAttempt of profile.testAttempts) {
      const remote = byId.get(localAttempt.id);
      if (!remote) {
        byId.set(localAttempt.id, localAttempt);
      } else if (remote.status !== 'completed' && localAttempt.status === 'completed') {
        byId.set(localAttempt.id, localAttempt);
      } else if (remote.status !== 'completed' && localAttempt.pausedState && !remote.pausedState) {
        byId.set(localAttempt.id, localAttempt);
      }
    }
    return [...byId.values()];
  }, [mode, snapshot, profile.testAttempts]);

  const scoreLog = useMemo(() => {
    const localLog = profile.testScoreLog ?? [];
    const rows = mode === 'cloud' && snapshot ? [...snapshot.scoreLog, ...localLog] : localLog;
    const byId = new Map<string, TestScoreEntry>();
    for (const entry of rows) byId.set(entry.id, entry);
    return [...byId.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
  }, [mode, snapshot, profile.testScoreLog]);

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
    const completedTests = testAttempts.filter((t) => t.status !== 'incomplete');
    return {
      attempts,
      correct,
      accuracy: attempts > 0 ? correct / attempts : 0,
      uniqueQuestions: Object.keys(progress).length,
      mastered,
      dueCards,
      testsTaken: completedTests.length,
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
        const labels = outcome.unlocked.map((id) => {
          const ach = achievementById(id);
          return ach ? `${ach.name} (+${ach.rewardCoins} HDCoins)` : id;
        });
        setNotice(`Achievement unlocked: ${labels.join(', ')}`);
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
      const item = itemById(itemId);
      if (!item || item.slot !== 'theme') {
        return { ok: false, reason: 'Emblems are earned through achievements, not purchased.' };
      }
      if (mode === 'cloud') {
        try {
          const result = await cloud.purchaseCosmeticCloud(itemId);
          await refreshSnapshot();
          if (result.ok) {
            persist({
              ...profileRef.current,
              settings: { ...profileRef.current.settings, activeTheme: itemId },
            });
          }
          return { ok: Boolean(result.ok), reason: result.reason as string | undefined };
        } catch (err) {
          return { ok: false, reason: (err as Error).message };
        }
      }
      const result = local.purchaseItem(profileRef.current, itemId, cost);
      persist(result.profile);
      return { ok: result.ok, reason: result.reason };
    },
    [mode, persist, refreshSnapshot]
  );

  const recordRushScore = useCallback<AppValue['actions']['recordRushScore']>((key, score) => {
    const outcome = local.recordRushScore(profileRef.current, key, score);
    persist(outcome.profile);
    return { record: outcome.record, improved: outcome.improved };
  }, [persist]);

  const completeSession = useCallback<AppValue['actions']['completeSession']>(
    async (args) => {
      if (mode === 'cloud') {
        try {
          const result = await cloud.completeActivityCloud(args);
          await refreshSnapshot();
          const coins = Number(result?.coins_awarded ?? 0);
          if (coins > 0) {
            setNotice(`Session reward: +${coins} HDCoins added to your balance.`);
          }
        } catch (err) {
          setError(`Session result was not recorded in your account: ${(err as Error).message}`);
        }
        return;
      }
      // Guest mode mirrors the cloud's per-category daily reward caps locally so
      // the Arcade pays the same on both paths.
      const outcome = local.awardSessionCoins(profileRef.current, args);
      if (outcome.coinsAwarded > 0) {
        persist(outcome.profile);
        setNotice(`Session reward: +${outcome.coinsAwarded} HDCoins (saved on this device).`);
      }
    },
    [mode, persist, refreshSnapshot]
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
            light: !emailVerified,
          });
          await refreshSnapshot();
          if (saved.lightLimited) {
            setNotice(
              'Test saved to your account. Answer detail stays on this device until you confirm your email.'
            );
          } else if (saved.skippedResponses > 0) {
            setNotice(
              `Test saved to your account. ${saved.skippedResponses} answer(s) used newly added questions that are still being synced to the cloud bank, so those replies stay on this device for now.`
            );
          }
        } catch (err) {
          setError(`Test result kept locally; saving it to your account failed: ${(err as Error).message}`);
        }
      }
      if (attempt.status !== 'incomplete') {
        const next = local.perfectModuleAchievement(profileRef.current, attempt.modules);
        if (next !== profileRef.current) persist(next);
      }
    },
    [emailVerified, mode, persist, refreshSnapshot]
  );

  // Throttle for the in-progress cloud mirror: localStorage is written on every
  // autosave, but Supabase sees at most one write per TEST_SYNC_MIN_MS unless a
  // flush is forced (page hiding / closing).
  const lastTestSyncRef = useRef<number>(0);
  const syncInFlightRef = useRef<boolean>(false);

  const mirrorTestCloud = useCallback(
    (attempt: TestAttempt, clientSessionId: string) => {
      if (mode !== 'cloud' || syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      lastTestSyncRef.current = Date.now();
      void cloud
        .recordTestCloud(attempt, {
          clientSessionId,
          assessment: attempt.assessment,
          durationSeconds: attempt.durationSeconds,
          status: attempt.status,
        })
        .catch(() => {
          // In-progress mirrors are best-effort: the localStorage copy is the
          // safety net and the completed-run save re-upserts everything.
        })
        .finally(() => {
          syncInFlightRef.current = false;
        });
    },
    [mode]
  );

  const autosaveTest = useCallback(
    (attempt: TestAttempt, clientSessionId: string) => {
      // Synchronous localStorage write first — this is what guarantees a closed
      // tab never loses the test.
      persist(local.recordTestAttempt(profileRef.current, attempt));
      if (mode === 'cloud' && Date.now() - lastTestSyncRef.current > 20_000) {
        mirrorTestCloud(attempt, clientSessionId);
      }
    },
    [mirrorTestCloud, mode, persist]
  );

  const flushTestSync = useCallback(
    (attempt: TestAttempt, clientSessionId: string) => {
      persist(local.recordTestAttempt(profileRef.current, attempt));
      mirrorTestCloud(attempt, clientSessionId);
    },
    [mirrorTestCloud, persist]
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

  const deleteTest = useCallback<AppValue['actions']['deleteTest']>(
    async (attemptId: string) => {
      const outcome = local.deleteTestAttempt(profileRef.current, attemptId);
      if (outcome.profile !== profileRef.current) persist(outcome.profile);
      if (mode === 'cloud') {
        try {
          await cloud.deleteTestAttemptCloud(attemptId);
          await refreshSnapshot();
        } catch (err) {
          setError(
            `Deleted on this device, but removing it from your account failed: ${(err as Error).message}`
          );
          return;
        }
      }
      setNotice(
        outcome.entry
          ? 'Simulation deleted. Its score stays in your log.'
          : 'Simulation deleted.'
      );
    },
    [mode, persist, refreshSnapshot]
  );

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
      const pending = local.loadPendingAccount();
      local.clearPendingAccount();
      setPendingAccount(null);
      if (pending?.displayName) {
        try {
          const saved = await cloud.updateDisplayNameCloud(pending.displayName);
          setUser((prev) => (prev ? { ...prev, displayName: saved } : prev));
        } catch {
          /* keep the name from signup if the rename cannot be saved */
        }
      }
      await refreshSnapshot();
      if (data.user?.id) await importLocalHistoryOnce(data.user.id);
      setNotice('Email confirmed — your account is now fully backed up.');
    },
    [importLocalHistoryOnce, refreshSnapshot]
  );

  const sendVerificationCode = useCallback(
    async (email: string): Promise<{ sent: boolean; message: string }> => {
      const address = email.trim();
      if (!address) return { sent: false, message: 'Enter your email address first.' };

      // Brevo gives 300 sends a day. Stop asking at 280 so the provider never
      // answers with an error; the account keeps working either way.
      const budget = await cloud.emailSendBudget().catch(() => null);
      if (budget && !budget.allowed) {
        return {
          sent: false,
          message: 'Email verification is paused for today — come back tomorrow, keep studying signed in.',
        };
      }

      const guard = local.canSendVerificationEmail(address);
      if (!guard.allowed) {
        setPendingAccount(guard.existing);
        return {
          sent: false,
          message: `A code was already sent to ${address} (${local.formatRemainingHours(
            guard.remainingMs
          )} left).`,
        };
      }
      let serverWait = 0;
      try {
        serverWait = await cloud.emailRequestWait(address, 'confirm');
      } catch {
        /* offline: the local guard above still applies */
      }
      if (serverWait > 0) {
        return {
          sent: false,
          message: `A code was already sent to ${address} (${local.formatRemainingHours(
            serverWait * 1000
          )} left).`,
        };
      }
      await cloud.resendConfirmation(address);
      await cloud.recordEmailRequest(address, 'confirm').catch(() => {});
      const saved = local.savePendingAccount({
        email: address,
        displayName: guard.existing?.displayName ?? user?.displayName ?? 'Student',
      });
      setPendingAccount(saved);
      return { sent: true, message: `Code sent to ${address}. It works for 24 hours.` };
    },
    [user]
  );

  const resendVerification = useCallback(async (email: string) => {
    setError(null);
    const result = await sendVerificationCode(email);
    if (!result.sent) throw new Error(result.message);
    setNotice(result.message);
  }, [sendVerificationCode]);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      consent: Record<string, string | boolean> = {}
    ) => {
      setError(null);
      const guard = local.canSendVerificationEmail(email);
      if (!guard.allowed) {
        setPendingAccount(guard.existing);
        setAuthModalView('verify');
        return {
          message: `A confirmation email was already sent to ${email.trim()} (${local.formatRemainingHours(
            guard.remainingMs
          )} remaining in its 24-hour window). Enter the 6-digit code from that email below.`,
          verificationRequired: true,
        };
      }
      let serverWait = 0;
      try {
        serverWait = await cloud.emailRequestWait(email, 'confirm');
      } catch {
        /* offline: the local guard above still applies */
      }
      if (serverWait > 0) {
        const record = local.savePendingAccount({
          email: email.trim(),
          displayName: displayName || 'Student',
        });
        setPendingAccount(record);
        setAuthModalView('verify');
        return {
          message: `A confirmation email was already sent to ${email.trim()} (${local.formatRemainingHours(
            serverWait * 1000
          )} left). Enter the 6-digit code from that email below.`,
          verificationRequired: true,
        };
      }
      const data = await cloud.signUp(email, password, displayName, consent);
      if (!data.session) {
        // The signup email counts against the same one-per-day budget.
        await cloud.recordEmailRequest(email, 'confirm').catch(() => {});
      }
      if (data.session) {
        local.clearPendingAccount();
        setPendingAccount(null);
        await refreshSnapshot();
        if (data.user?.id) await importLocalHistoryOnce(data.user.id);
        // The account is usable now. The code only lifts the light-account cap,
        // so a mail failure must never read as a failed signup.
        const send = await sendVerificationCode(email.trim()).catch((err: Error) => ({
          sent: false,
          message: err.message,
        }));
        return {
          message: send.sent
            ? `Account created. We emailed a 6-digit code to ${email.trim()} — enter it to confirm your address.`
            : `Account created and signed in. ${send.message}`,
          verificationRequired: true,
        };
      }
      const record = local.savePendingAccount({
        email: email.trim(),
        displayName: displayName || 'Student',
      });
      setPendingAccount(record);
      return {
        message: `Account created for ${email}. We emailed a confirmation link and a 6-digit code that stays valid for 24 hours.`,
        verificationRequired: true,
      };
    },
    [importLocalHistoryOnce, refreshSnapshot, sendVerificationCode]
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

  const updateDisplayName = useCallback(
    async (name: string) => {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) throw new Error('Enter a display name.');
      if (user) {
        const saved = await cloud.updateDisplayNameCloud(trimmed);
        setUser((prev) => (prev ? { ...prev, displayName: saved } : prev));
        try {
          await refreshSnapshot();
        } catch {
          /* the header already shows the new name; snapshot catches up next load */
        }
        setNotice(`Display name changed to ${saved}.`);
        return;
      }
      // An account that exists but is not confirmed yet has no session, so the
      // name is remembered locally and applied the moment the code is verified.
      const pending = local.loadPendingAccount();
      if (pending) {
        const record = { ...pending, displayName: trimmed };
        local.savePendingAccount(record);
        setPendingAccount(record);
        setNotice(`Display name will be set to ${trimmed} when you confirm your email.`);
        return;
      }
      throw new Error('Sign in first to change your name.');
    },
    [refreshSnapshot, user]
  );

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
      if (mode === 'cloud' && ('assessment' in patch || 'testDate' in patch)) {
        cloud
          .setTestGoalCloud(next.settings.assessment, next.settings.testDate ?? null)
          .catch((err: Error) =>
            setError(`Could not save your test goal: ${err.message}`)
          );
      }
    },
    [mode, persist]
  );

  const timingSamples = useMemo(
    () => timingSamplesFromAttempts(profile.attempts),
    [profile.attempts]
  );

  const value: AppValue = {
    ready,
    mode,
    cloudConfigured: isCloudConfigured,
    user,
    accountStatus,
    emailVerified,
    pendingAccount,
    bankVersion: bank.bank_version,
    licensingNote: bank.licensing_note,
    sources: bank.sources,
    questions: bank.questions,
    flashcards: deck.cards,
    resources: library.resources,
    hdCoins: mode === 'cloud' && snapshot ? snapshot.stats.hdCoins : profile.hdCoins,
    lifetimeCoins:
      mode === 'cloud' && snapshot ? snapshot.stats.lifetimeCoins : profile.lifetimeCoins,
    currentStreak: mode === 'cloud' && snapshot ? snapshot.stats.currentStreak : profile.currentStreak,
    bestStreak: mode === 'cloud' && snapshot ? snapshot.stats.bestStreak : profile.bestStreak,
    progress,
    saved,
    flashcardProgress,
    rushScores: profile.rushScores ?? {},
    testAttempts,
    scoreLog,
    dailyActivity: emptyActivitySeries(daily),
    achievements: mode === 'cloud' && snapshot ? snapshot.achievements : profile.achievements,
    ownedItems: mode === 'cloud' && snapshot ? snapshot.ownedItems : profile.ownedItems,
    totals,
    settings: profile.settings,
    timingSamples,
    attempts: profile.attempts.slice(-600),
    syncing,
    syncMessage,
    error,
    notice,
    authModalOpen,
    authModalView,
    actions: {
      openAuthModal: (view = 'signin') => {
        setAuthModalView(view);
        setAuthModalOpen(true);
      },
      closeAuthModal: () => {
        setAuthModalOpen(false);
      },
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
      recordRushScore,
      completeSession,
      recordTest,
      deleteTest,
      autosaveTest,
      flushTestSync,
      verifySignupCode,
      resendVerification,
      syncGuestData,
      updateSettings,
      updateDisplayName,
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
