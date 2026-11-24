import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import flashcardsJson from '../data/flashcards.json';
import resourcesJson from '../data/resources.json';
import { achievementById, itemById } from './catalog';
import * as cloud from './cloud';
import { getSupabase, isCloudConfigured } from './supabaseClient';
import * as local from './storage';
import * as emailAllowance from './emailAllowance';
import * as emailQueue from './emailQueue';
import * as outbox from './outbox';
import * as arcadeCoinQueue from './arcadeCoinQueue';
import { clampArcadeCoins } from './arcadeCoins';
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

interface BankData {
  bank_version: string;
  licensing_note: string;
  sources: DatasetSource[];
  questions: Question[];
}

let bankPromise: Promise<BankData> | null = null;

/**
 * The official College Board pool is a deployment-side asset, deliberately
 * kept out of the repository and out of the startup bundle. A missing or
 * unavailable supplemental asset must never prevent the curated bank loading.
 */
async function loadCollegeBoardBank(): Promise<BankData | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}collegeBoardBank.json`, {
      cache: 'no-cache',
    });
    if (!response.ok) return null;
    const data = (await response.json()) as BankData;
    if (!Array.isArray(data.questions) || data.questions.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

function mergeBanks(curated: BankData, official: BankData | null): BankData {
  if (!official) return curated;
  const knownIds = new Set(curated.questions.map((question) => question.id));
  const knownSources = new Set(curated.sources.map((source) => source.source_id));
  const questions = official.questions.filter((question) => !knownIds.has(question.id));
  return {
    ...curated,
    bank_version: `${curated.bank_version}+cb-${questions.length}`,
    sources: [
      ...curated.sources,
      ...official.sources.filter((source) => !knownSources.has(source.source_id)),
    ],
    questions: [...curated.questions, ...questions],
  };
}

/**
 * The bank is a separate chunk, not part of the startup script. It is the one
 * large asset in the app, and keeping it out of the entry bundle means a repeat
 * visit can reuse the cached bank while a code change only invalidates the much
 * smaller shell.
 */
function loadBank(): Promise<BankData> {
  if (!bankPromise) {
    bankPromise = Promise.all([
      import('../data/questionBank.json').then(
        (module) => (module.default ?? module) as unknown as BankData
      ),
      loadCollegeBoardBank(),
    ]).then(([curated, official]) => mergeBanks(curated, official));
  }
  return bankPromise;
}
const deck = flashcardsJson as unknown as { cards: Flashcard[] };
const library = resourcesJson as unknown as { resources: StudyResource[] };

/**
 * Official Words-in-Context cards are generated locally from the imported
 * College Board bank and served as a deployment-side asset. They are not
 * committed to the reference repo, so a missing file is a normal, quiet
 * fallback rather than a startup failure.
 */
async function loadOfficialFlashcardDeck(): Promise<Flashcard[]> {
  if (typeof fetch !== 'function') return [];
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}officialContextCards.json`, {
      cache: 'no-cache',
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { cards?: Flashcard[] };
    if (!Array.isArray(data.cards)) return [];
    return data.cards.filter(
      (card) =>
        card &&
        typeof card.id === 'string' &&
        card.deck === 'official_context' &&
        typeof card.front === 'string' &&
        typeof card.back === 'string'
    );
  } catch {
    return [];
  }
}

export type Mode = 'guest' | 'cloud';

export interface SubmitResult {
  isCorrect: boolean;
  coinsAwarded: number;
  duplicate: boolean;
  error?: string;
}

export interface AppValue {
  ready: boolean;
  /** The route-level bank gate asks for this before rendering question screens. */
  bankReady: boolean;
  bankError: string | null;
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
  /** Exact arcade coins waiting for the cloud function / connection. */
  arcadeCoinsPending: number;
  syncing: boolean;
  syncMessage: string | null;
  /** Answers written offline and still waiting to reach the account. */
  outboxPending: number;
  error: string | null;
  notice: string | null;
  authModalOpen: boolean;
  authModalView: 'signin' | 'signup' | 'verify';
  /** Present when guest work can be merged into the account only after consent. */
  guestMergePrompt: {
    userId: string;
    attempts: number;
    saved: number;
    flashcards: number;
  } | null;
  actions: {
    openAuthModal: (view?: 'signin' | 'signup' | 'verify') => void;
    closeAuthModal: () => void;
    signIn: (email: string, password: string) => Promise<void>;
    attemptSignIn: (email: string, password: string) => Promise<cloud.SignInAttempt>;
    completeGoogleSignIn: () => Promise<void>;
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
    /** Credits exact coins picked up in a game. `sessionId` is the idempotency key. */
    awardCoins: (amount: number, sessionId: string) => Promise<void>;
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
    /**
     * Sends the confirmation emails that were parked when the day's mail budget
     * ran out. Called when the app opens, and again when the confirm strip is
     * shown, so a queued request goes out on the first open after the reset.
     */
    flushQueuedEmails: () => Promise<void>;
    syncGuestData: () => Promise<void>;
    /** Merge this browser's guest history after the student explicitly accepts. */
    acceptGuestMerge: () => Promise<void>;
    /** Leave guest history on this device and never ask for this account again. */
    declineGuestMerge: () => void;
    updateSettings: (patch: Partial<UserSettings>) => void;
    /** Rename the signed-in student, or the name remembered for a pending signup. */
    updateDisplayName: (name: string) => Promise<void>;
    dismissMessages: () => void;
    resetGuestProgress: () => void;
    /** Load the large bank chunk on demand, once a route needs it. */
    ensureBank: () => void;
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
  const [bank, setBank] = useState<BankData | null>(null);
  const [flashcards, setFlashcards] = useState<Flashcard[]>(deck.cards);
  const [snapshot, setSnapshot] = useState<cloud.CloudSnapshot | null>(null);
  // The last snapshot before the current one. Cloud achievements are announced
  // from this diff, not from the local profile: the local bonus is invisible in
  // cloud mode, and promising coins that were never added is worse than silence.
  const snapshotRef = useRef<cloud.CloudSnapshot | null>(null);
  const [user, setUser] = useState<AppValue['user']>(null);
  const [pendingAccount, setPendingAccount] = useState<local.PendingAccount | null>(() =>
    local.loadPendingAccount()
  );
  const [ready, setReady] = useState(false);
  const bankLoadingRef = useRef(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [outboxPending, setOutboxPending] = useState(() => outbox.queuedCount());
  const [arcadeCoinsPending, setArcadeCoinsPending] = useState(() =>
    arcadeCoinQueue.pendingArcadeCoinTotal()
  );
  const [arcadeSessionsPending, setArcadeSessionsPending] = useState(() =>
    arcadeCoinQueue.pendingArcadeSessions().length
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalView, setAuthModalView] = useState<'signin' | 'signup' | 'verify'>('signin');
  const [guestMergePrompt, setGuestMergePrompt] = useState<AppValue['guestMergePrompt']>(null);

  // Module submissions run many attempts in one loop (27 R&W / 22 Math items),
  // so mutating actions must read the freshest profile rather than the closure
  // captured at the start of the run. The ref keeps the sequential writes exact.
  const profileRef = useRef<LocalProfile>(profile);

  // Auth events can fire before the import callback below is created, so the
  // handler reads it through a ref instead of a stale closure.
  const importLocalRef = useRef<(userId: string) => void>(() => {});
  const importingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    void loadOfficialFlashcardDeck().then((officialCards) => {
      if (!active || officialCards.length === 0) return;
      const known = new Set(deck.cards.map((card) => card.id));
      setFlashcards([...deck.cards, ...officialCards.filter((card) => !known.has(card.id))]);
    });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: LocalProfile) => {
    profileRef.current = next;
    setProfile(next);
    local.saveProfile(next);
  }, []);

  const ensureBank = useCallback(() => {
    if (bank || bankLoadingRef.current) return;
    bankLoadingRef.current = true;
    setBankError(null);
    loadBank()
      .then((data) => {
        setBank(data);
        setBankError(null);
      })
      .catch((err: Error) => {
        const message = `The question bank could not be loaded: ${err.message}`;
        setBankError(message);
        setError(message);
      })
      .finally(() => {
        bankLoadingRef.current = false;
      });
  }, [bank]);

  const refreshSnapshot = useCallback(async () => {
    const data = await cloud.fetchSnapshot();
    const previous = snapshotRef.current;
    snapshotRef.current = data;
    setSnapshot(data);
    // A new badge in the snapshot is the server's own record that it was
    // granted, and the grant pays its reward in the same transaction. This is
    // the only place a cloud student is told about coins.
    if (previous) {
      const before = new Set(previous.achievements);
      const fresh = data.achievements.filter((id) => !before.has(id));
      if (fresh.length > 0) {
        const labels = fresh.slice(0, 3).map((id) => {
          const ach = achievementById(id);
          return ach ? `${ach.name} (+${ach.rewardCoins} HDCoins)` : id;
        });
        const rest = fresh.length - labels.length;
        setNotice(
          `Achievement unlocked: ${labels.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`
        );
      }
    }
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
    const confirmProviderEmail = async (sessionUser: {
      app_metadata?: { provider?: string };
    }) => {
      const provider = sessionUser.app_metadata?.provider;
      // 'email' and 'phone' prove nothing on their own: those accounts keep the
      // in-app 6-digit confirmation flow.
      if (!provider || provider === 'email' || provider === 'phone') return;
      if (snapshotRef.current?.emailVerifiedAt) return;
      try {
        await cloud.markEmailVerified();
        await refreshSnapshot();
      } catch {
        /* the banner still offers the coded path if the write fails */
      }
    };
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
          // Google and the other OAuth providers hand back an address they have
          // already verified. Without this the profile row kept
          // email_verified_at empty and a Google student was shown the light
          // account limits and a "Confirm your email" banner they never needed.
          await confirmProviderEmail(sessionUser);
        } catch (err) {
          setError(`Signed in, but loading your cloud progress failed: ${(err as Error).message}`);
        }
      }
      setReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setUser(null);
        snapshotRef.current = null;
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
    const dueCards = flashcards.filter((card) => {
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
  }, [mode, snapshot, profile, progress, flashcardProgress, testAttempts, flashcards]);

  const submitAttempt = useCallback<AppValue['actions']['submitAttempt']>(
    async (question, response, meta) => {
      const outcome = local.applyAttempt(profileRef.current, question, response, {
        mode: meta.mode,
        timeSpentSeconds: meta.timeSpentSeconds,
        sessionId: meta.sessionId ?? null,
      });
      persist(outcome.profile);
      if (mode === 'guest' && outcome.unlocked.length > 0) {
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
          // Nothing is lost and nothing needs shouting about: keep the answer
          // in the outbox and say so once, quietly.
          const last = outcome.profile.attempts[outcome.profile.attempts.length - 1];
          const remaining = outbox.queueAttempt({
            eventId: last.eventId,
            questionId: question.id,
            response,
            mode: meta.mode,
            timeSpentSeconds: meta.timeSpentSeconds ?? 0,
            sessionId: meta.sessionId ?? null,
            queuedAt: new Date().toISOString(),
          });
          setOutboxPending(remaining);
          setNotice(
            remaining === 1
              ? 'Offline: this answer is saved here and will sync when the connection returns.'
              : `Offline: ${remaining} answers are saved here and will sync when the connection returns.`
          );
          return { isCorrect: outcome.isCorrect, coinsAwarded: outcome.coinsAwarded, duplicate: false, error: (err as Error).message };
        }
      }
      return { isCorrect: outcome.isCorrect, coinsAwarded: outcome.coinsAwarded, duplicate: false };
    },
    [mode, persist, refreshSnapshot]
  );

  // Queued answers go out on the next open, when the tab becomes visible again,
  // and as soon as the browser reports a connection. Replays are idempotent on
  // the client event id, so running this repeatedly is harmless.
  useEffect(() => {
    if (mode !== 'cloud') return;
    let disposed = false;
    const flush = async () => {
      if (outbox.queuedCount() === 0) return;
      const result = await outbox.flushOutbox(
        async (entry) => {
          await cloud.submitAttemptCloud({
            questionId: entry.questionId,
            response: entry.response,
            mode: entry.mode,
            timeSpentSeconds: entry.timeSpentSeconds,
            clientEventId: entry.eventId,
            sessionId: entry.sessionId,
          });
        },
        cloud.isUnknownQuestionError
      );
      if (disposed) return;
      setOutboxPending(result.remaining);
      if (result.sent > 0) {
        setNotice(
          `${result.sent} queued answer${result.sent === 1 ? '' : 's'} synced to your account.`
        );
        await refreshSnapshot();
      }
    };
    void flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      disposed = true;
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [mode, refreshSnapshot]);

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
          // The old server function paid a random 5–100 coin bonus for a
          // mini-game. Until the exact-arcade migration is live, queue the
          // completed game instead of double-paying and preserve it for the
          // retry. The queue drains automatically once the RPC exists.
          if (args.activityType === 'mini_game') {
            const ready = await cloud.arcadeCoinRpcAvailable().catch(() => false);
            if (!ready) {
              arcadeCoinQueue.queueArcadeSession({
                id: args.sessionId,
                questions: args.questions,
                correct: args.correct,
                timeSpentSeconds: args.timeSpentSeconds,
              });
              setArcadeSessionsPending(arcadeCoinQueue.pendingArcadeSessions().length);
              setNotice('Game saved on this device. It will sync with your streak when arcade coin sync is available.');
              return;
            }
          }
          const result = await cloud.completeActivityCloud(args);
          const coins = Number(result?.coins_awarded ?? 0);
          if (coins > 0) {
            setNotice(`Session reward: +${coins} HDCoins added to your balance.`);
          }
          // Refresh last: if the session also unlocked a badge, its banner is
          // the more specific message and the balance already includes both.
          await refreshSnapshot();
        } catch (err) {
          setError(`Session result was not recorded in your account: ${(err as Error).message}`);
        }
        return;
      }
      // Guest mode mirrors the cloud's per-category daily reward caps locally so
      // the Arcade pays the same on both paths.
      const outcome = local.awardSessionCoins(profileRef.current, args);
      // Persist even when the session pays zero. A mini-game's exact coins are
      // credited per event, but its completed session is what qualifies the
      // day for the streak and appears on the activity chart.
      if (outcome.profile !== profileRef.current) {
        persist(outcome.profile);
      }
      if (outcome.coinsAwarded > 0) {
        setNotice(`Session reward: +${outcome.coinsAwarded} HDCoins (saved on this device).`);
      }
    },
    [mode, persist, refreshSnapshot]
  );

  const awardCoins = useCallback<AppValue['actions']['awardCoins']>(
    async (amount, sessionId) => {
      const safeAmount = clampArcadeCoins(amount);
      if (safeAmount <= 0) return;
      if (mode === 'cloud') {
        try {
          await cloud.awardArcadeCoins(safeAmount, sessionId);
          arcadeCoinQueue.removeArcadeCoins(sessionId);
          setArcadeCoinsPending(arcadeCoinQueue.pendingArcadeCoinTotal());
          await refreshSnapshot();
        } catch (err) {
          // A deploy can land before the SQL function is installed, and a phone
          // can lose the network mid-run. Neither should eat the coins or show
          // a red failure after every pickup. The idempotency key makes the
          // retry safe when the function is available.
          arcadeCoinQueue.queueArcadeCoins(sessionId, safeAmount);
          setArcadeCoinsPending(arcadeCoinQueue.pendingArcadeCoinTotal());
          if (cloud.isMissingArcadeCoinRpc(err)) {
            setNotice(
              `${safeAmount} HDCoin${safeAmount === 1 ? '' : 's'} saved on this device. Cloud sync is waiting for the arcade coin function.`
            );
          } else {
            setNotice(
              `${safeAmount} HDCoin${safeAmount === 1 ? '' : 's'} saved on this device and will sync when the connection returns.`
            );
          }
        }
        return;
      }
      const outcome = local.awardArcadeEventCoins(profileRef.current, safeAmount, sessionId);
      if (outcome.profile !== profileRef.current) persist(outcome.profile);
    },
    [mode, persist, refreshSnapshot]
  );

  // Drain exact arcade coins when the account and the function are available.
  // Entries are removed only after the RPC confirms them; a missing function
  // leaves the queue untouched and silent.
  useEffect(() => {
    if (mode !== 'cloud' || (arcadeCoinsPending <= 0 && arcadeSessionsPending <= 0)) return;
    let disposed = false;
    let running = false;
    const flush = async () => {
      if (disposed || running) return;
      running = true;
      let credited = 0;
      let sessionsSynced = 0;
      try {
        const ready = await cloud.arcadeCoinRpcAvailable().catch(() => false);
        if (!ready) return;
        for (const session of arcadeCoinQueue.pendingArcadeSessions()) {
          if (disposed) break;
          try {
            await cloud.completeActivityCloud({
              activityType: 'mini_game',
              sessionId: session.id,
              questions: session.questions,
              correct: session.correct,
              timeSpentSeconds: session.timeSpentSeconds,
            });
            arcadeCoinQueue.removeArcadeSession(session.id);
            sessionsSynced += 1;
          } catch {
            break;
          }
        }
        for (const entry of arcadeCoinQueue.pendingArcadeCoins()) {
          if (disposed) break;
          try {
            await cloud.awardArcadeCoins(entry.amount, entry.id);
            arcadeCoinQueue.removeArcadeCoins(entry.id);
            credited += entry.amount;
          } catch (err) {
            if (cloud.isMissingArcadeCoinRpc(err)) break;
            // Network failures leave the rest of the queue for the next wake.
            break;
          }
        }
      } finally {
        running = false;
      }
      if (disposed) return;
      const remaining = arcadeCoinQueue.pendingArcadeCoinTotal();
      setArcadeCoinsPending(remaining);
      setArcadeSessionsPending(arcadeCoinQueue.pendingArcadeSessions().length);
      if (credited > 0) {
        setNotice(`${credited} queued HDCoin${credited === 1 ? '' : 's'} synced to your balance.`);
        await refreshSnapshot().catch(() => undefined);
      } else if (sessionsSynced > 0) {
        setNotice(`${sessionsSynced} queued game${sessionsSynced === 1 ? '' : 's'} synced to your streak.`);
        await refreshSnapshot().catch(() => undefined);
      }
    };
    void flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      disposed = true;
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [arcadeCoinsPending, arcadeSessionsPending, mode, refreshSnapshot]);

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
   * Guest history is never merged silently. A sign-in only asks once per
   * account; accepting performs the same idempotent sync as before, and
   * declining records that choice so the prompt does not return on every visit.
   */
  const mergeLocalHistory = useCallback(
    async (userId: string) => {
      if (typeof localStorage === 'undefined') return;
      const importedKey = `hdsat.imported.${userId}`;
      const declinedKey = `hdsat.import-declined.${userId}`;
      if (
        localStorage.getItem(importedKey) ||
        localStorage.getItem(declinedKey) ||
        importingRef.current.has(userId)
      ) {
        return;
      }
      const localProfile = profileRef.current;
      if (
        localProfile.attempts.length === 0 &&
        localProfile.saved.length === 0 &&
        Object.keys(localProfile.flashcards).length === 0
      ) {
        return;
      }
      importingRef.current.add(userId);
      try {
        setSyncMessage('Importing your device practice history into your account...');
        const report = await cloud.syncGuestProfile(localProfile, (done, total) =>
          setSyncMessage(`Importing device history: ${done} of ${total} attempts...`)
        );
        localStorage.setItem(importedKey, new Date().toISOString());
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

  const importLocalHistoryOnce = useCallback((userId: string) => {
    if (typeof localStorage === 'undefined') return;
    const importedKey = `hdsat.imported.${userId}`;
    const declinedKey = `hdsat.import-declined.${userId}`;
    if (localStorage.getItem(importedKey) || localStorage.getItem(declinedKey)) return;
    const localProfile = profileRef.current;
    const counts = {
      attempts: localProfile.attempts.length,
      saved: localProfile.saved.length,
      flashcards: Object.keys(localProfile.flashcards).length,
    };
    if (counts.attempts === 0 && counts.saved === 0 && counts.flashcards === 0) return;
    setGuestMergePrompt({ userId, ...counts });
  }, []);

  const acceptGuestMerge = useCallback(async () => {
    const prompt = guestMergePrompt;
    if (!prompt) return;
    setGuestMergePrompt(null);
    await mergeLocalHistory(prompt.userId);
  }, [guestMergePrompt, mergeLocalHistory]);

  const declineGuestMerge = useCallback(() => {
    const prompt = guestMergePrompt;
    if (!prompt || typeof localStorage === 'undefined') return;
    localStorage.setItem(`hdsat.import-declined.${prompt.userId}`, new Date().toISOString());
    setGuestMergePrompt(null);
    setNotice('Guest history stays on this device. Your account was not changed.');
  }, [guestMergePrompt]);

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
    async (email: string): Promise<{ sent: boolean; queued?: boolean; message: string }> => {
      const address = email.trim();
      if (!address) return { sent: false, message: 'Enter your email address first.' };

      // One message per address per day, shared with the recovery link. A slow
      // inbox must not become three sends: the answer is here, instantly, before
      // the provider is asked for anything.
      const allowance = emailAllowance.emailAllowanceRemaining(address);
      if (allowance > 0) {
        setPendingAccount(local.loadPendingAccount());
        return { sent: false, message: emailAllowance.oneEmailPerDayMessage(address, allowance) };
      }

      // Brevo gives 300 sends a day. Stop asking at 280 so the provider never
      // answers with an error, and keep the last 20 for recovery links — the
      // account keeps working either way.
      const budget = await cloud.emailSendBudget().catch(() => null);
      if (!emailQueue.budgetAllows('confirm', budget)) {
        // Park the request instead of losing it. The account is already usable
        // — confirmation only lifts the light-account cap — so the cost of
        // waiting is the reminder strip, not access to the app.
        emailQueue.queueEmail(address, 'confirm');
        const parked = local.savePendingAccount({
          email: address,
          displayName: user?.displayName ?? 'Student',
        });
        setPendingAccount(parked);
        return {
          sent: false,
          queued: true,
          message: `The daily email limit is used up, so ${address} is queued: the code goes out the next time you open HDSAT after midnight UTC. Keep studying signed in — nothing else is affected.`,
        };
      }

      // The last guard is the same one the recovery link uses: one message per
      // address per UTC day, wherever it is asked from. Mail can arrive ten
      // minutes late, and a student who presses again during that wait used to
      // cost three sends and three copies; now the second press is answered
      // here instead of by the provider.
      //
      // The device ledger cannot see another browser, so ask the server first.
      // The database record is written by whichever request wins; a second
      // device therefore stops here instead of paying for a second copy. A
      // failed lookup (offline, cloud off) falls through to the local guard.
      const serverWait = await cloud.emailRequestWait(address, 'confirm').catch(() => 0);
      if (serverWait > 0) {
        const hours = Math.max(1, Math.ceil(serverWait / 3600));
        return {
          sent: false,
          message: `One email per day goes to ${address}, and today's has already been sent. It can take a few minutes to arrive — check the inbox and the spam folder. Another can be sent in about ${hours} hour${hours === 1 ? '' : 's'}.`,
        };
      }
      const guard = local.canSendVerificationEmail(address);
      if (!guard.allowed) {
        setPendingAccount(guard.existing);
        const wait = local.formatRemainingHours(guard.remainingMs);
        return {
          sent: false,
          message: `Today's code for ${address} has already gone out. It can take a few minutes to arrive — check the inbox and the spam folder. The same code stays valid for 12 hours, and a new one can be sent in ${wait}.`,
        };
      }
      await cloud.resendConfirmation(address);
      await cloud.recordEmailRequest(address, 'confirm').catch(() => {});
      emailAllowance.recordEmailSent(address);
      // A send for this address makes any parked copy redundant.
      emailQueue.removeQueuedEmail(address, 'confirm');
      const saved = local.recordVerificationSend(
        address,
        guard.existing?.displayName ?? user?.displayName ?? 'Student'
      );
      setPendingAccount(saved);
      return { sent: true, message: `Code sent to ${address}. It works for 12 hours.` };
    },
    [user]
  );

  const resendVerification = useCallback(async (email: string) => {
    setError(null);
    const result = await sendVerificationCode(email);
    if (!result.sent) throw new Error(result.message);
    setNotice(result.message);
  }, [sendVerificationCode]);

  /**
   * Send whatever was parked when yesterday's budget ran out.
   *
   * Runs when the app opens for a light account, which is the only reason a
   * request gets queued in the first place. One attempt per address per UTC day
   * (recorded before the send, so a thrown error cannot turn into a loop) and
   * at most two sends per open, because a queue is not a licence to burn the
   * new day's budget in one page load.
   */
  const flushQueuedEmails = useCallback(async () => {
    const due = emailQueue.dueQueuedEmails(emailQueue.loadEmailQueue());
    if (due.length === 0) return;
    const budget = await cloud.emailSendBudget().catch(() => null);
    if (budget && !budget.allowed) return;
    // The queue is ordered recovery-first, so the cheap cap is the whole
    // policy: an open spends at most two sends and never more than the day has
    // left, and a confirmation in the reserved tail is skipped rather than
    // blocking the recovery link queued behind it.
    const room = budget ? Math.min(emailQueue.EMAIL_QUEUE_PER_OPEN, budget.remaining) : emailQueue.EMAIL_QUEUE_PER_OPEN;
    let sent = 0;
    for (const entry of due) {
      if (sent >= room) break;
      if (!emailQueue.budgetAllows(entry.kind, budget)) continue;
      if (emailAllowance.emailAllowanceRemaining(entry.email) > 0) continue;
      emailQueue.markQueuedAttempt(entry.email, entry.kind);
      try {
        if (entry.kind === 'reset') {
          await cloud.requestPasswordReset(entry.email);
          await cloud.recordEmailRequest(entry.email, 'reset').catch(() => {});
        } else {
          await cloud.resendConfirmation(entry.email);
          await cloud.recordEmailRequest(entry.email, 'confirm').catch(() => {});
        }
        emailAllowance.recordEmailSent(entry.email);
        emailQueue.removeQueuedEmail(entry.email, entry.kind);
        sent += 1;
      } catch {
        /* still queued: the next open after the reset tries once more */
      }
    }

    if (sent > 0) {
      setNotice(
        sent === 1
          ? 'The confirmation email you asked for yesterday has been sent. Check your inbox for the 6-digit code.'
          : `${sent} queued emails have been sent. Check your inbox.`
      );
    }
  }, []);

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
          message: `A code just went to ${email.trim()}. Give it ${local.formatRemainingHours(
            guard.remainingMs
          )} to arrive, or enter it below if it already has.`,
          verificationRequired: true,
        };
      }
      const data = await cloud.signUp(email, password, displayName, consent);
      // Supabase sends the confirmation message as part of the signup call.
      // Asking for another one here is what put two copies in a student's inbox:
      // the signup email already counted, then `sendVerificationCode` sent a
      // resend on top of it. Record the send instead of repeating it.
      await cloud.recordEmailRequest(email, 'confirm').catch(() => {});
      emailAllowance.recordEmailSent(email.trim());
      const record = local.savePendingAccount({
        email: email.trim(),
        displayName: displayName || 'Student',
      });
      setPendingAccount(record);
      if (data.session) {
        await refreshSnapshot();
        if (data.user?.id) await importLocalHistoryOnce(data.user.id);
        // The account is usable now. The code only lifts the light-account cap,
        // so a mail failure must never read as a failed signup.
        return {
          message: `Account created. We emailed a 6-digit code to ${email.trim()} — it stays valid for 12 hours.`,
          verificationRequired: true,
        };
      }
      return {
        message: `Account created for ${email}. We emailed a confirmation link and a 6-digit code that stays valid for 12 hours.`,
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

  const completeGoogleSignIn = useCallback(async () => {
    setError(null);
    // Google has already proven the address. Marking it here keeps the profile
    // out of the light-account state, exactly as the redirect flow did on mount.
    await cloud.markEmailVerified().catch(() => {});
    await refreshSnapshot();
    const userId = await cloud.getUserId();
    if (userId) await importLocalHistoryOnce(userId);
    setPendingAccount(null);
    local.clearPendingAccount();
  }, [importLocalHistoryOnce, refreshSnapshot]);

  const signOut = useCallback(async () => {
    await cloud.signOutCloud();
    setUser(null);
    snapshotRef.current = null;
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
    bankReady: bank !== null,
    bankError,
    mode,
    cloudConfigured: isCloudConfigured,
    user,
    accountStatus,
    emailVerified,
    pendingAccount,
    bankVersion: bank?.bank_version ?? '',
    licensingNote: bank?.licensing_note ?? '',
    sources: bank?.sources ?? [],
    questions: bank?.questions ?? [],
    flashcards,
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
    arcadeCoinsPending,
    syncing,
    syncMessage,
    outboxPending,
    error,
    notice,
    authModalOpen,
    authModalView,
    guestMergePrompt,
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
      completeGoogleSignIn,
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
      awardCoins,
      recordTest,
      deleteTest,
      autosaveTest,
      flushTestSync,
      verifySignupCode,
      resendVerification,
      flushQueuedEmails,
      syncGuestData,
      acceptGuestMerge,
      declineGuestMerge,
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
      ensureBank,
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
