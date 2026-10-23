import { LEGAL_VERSION } from './legal';

/**
 * Client-side data-rights helpers (access/portability). The export deliberately
 * contains only data that belongs to the requesting student: no answer keys, no
 * other users' data, no credentials or session tokens.
 */
export interface DataExportInput {
  user: { id: string; email: string; displayName: string } | null;
  mode: 'guest' | 'cloud';
  account: {
    hdCoins: number;
    currentStreak: number;
    bestStreak: number;
    totals: Record<string, number>;
    achievements: string[];
    ownedItems: string[];
    settings: Record<string, unknown>;
  };
  progress: Record<string, unknown>;
  saved: string[];
  flashcardProgress: Record<string, unknown>;
  testAttempts: unknown[];
  dailyActivity: unknown[];
}

export interface DataExport {
  export_version: string;
  generated_at: string;
  account_type: 'guest' | 'cloud';
  notice: string;
  user: DataExportInput['user'];
  account: DataExportInput['account'];
  data: {
    question_progress: Record<string, unknown>;
    saved_questions: string[];
    flashcard_progress: Record<string, unknown>;
    test_attempts: unknown[];
    daily_activity: unknown[];
  };
}

export const EXPORT_VERSION = '1.0';

export function buildDataExport(input: DataExportInput, now: Date = new Date()): DataExport {
  return {
    export_version: EXPORT_VERSION,
    generated_at: now.toISOString(),
    account_type: input.mode,
    notice:
      'This file contains the personal practice data HDSAT holds for this account. It excludes other students\u2019 data, exam answer keys and any credentials. See the Privacy & Data Rights page for retention and deletion details.',
    user: input.user,
    account: input.account,
    data: {
      question_progress: input.progress,
      saved_questions: [...input.saved],
      flashcard_progress: input.flashcardProgress,
      test_attempts: input.testAttempts,
      daily_activity: input.dailyActivity,
    },
  };
}

export function exportFileName(user: { email: string } | null, now: Date = new Date()): string {
  const who = (user?.email ?? 'guest').split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') || 'guest';
  return `hdsat-data-export-${who}-${now.toISOString().slice(0, 10)}.json`;
}

/** Trigger a browser download of the export. No-ops without a DOM (tests). */
export function downloadExport(payload: DataExport, user: { email: string } | null): string {
  const json = JSON.stringify(payload, null, 2);
  const name = exportFileName(user);
  if (typeof document === 'undefined') return name;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return name;
}

/**
 * The single-button AI snapshot.
 *
 * This is the "paste me into a tutor" export: one JSON document with the
 * student's own performance, domain accuracy, missed items and history, plus a
 * short instruction block so any model knows what it is looking at. It never
 * contains answer keys, explanations, distractor rationales, credentials or
 * other students' data.
 */
export const AI_SNAPSHOT_VERSION = '1.0';

export interface AiSnapshotInput {
  user: { id: string; email: string; displayName: string } | null;
  mode: 'guest' | 'cloud';
  assessment: string;
  account: {
    hdCoins: number;
    currentStreak: number;
    bestStreak: number;
    achievements: string[];
    ownedItems: string[];
    settings: Record<string, unknown>;
  };
  totals: { attempts: number; correct: number; accuracy: number; mastered: number; dueCards: number };
  progress: Record<string, { attemptCount: number; correctCount: number; lastIsCorrect: boolean; status: string }>;
  questions: {
    id: string;
    section: string;
    domain: string;
    skill: string;
    difficulty: string;
    prompt: string;
  }[];
  saved: string[];
  flashcardProgress: Record<string, { stage?: string; repetitions?: number; nextDueAt?: string }>;
  testAttempts: {
    id: string;
    assessment: string;
    createdAt: string;
    status?: string;
    rwEstimate: number | null;
    mathEstimate: number | null;
    totalEstimate: number | null;
    modules: { section: string; tier: string; correct: number; total: number }[];
  }[];
  dailyActivity: { date: string; questionsCompleted: number; correctQuestions: number; coinsEarned: number }[];
}

export interface AiSnapshot {
  schema_version: string;
  generated_at: string;
  account_type: string;
  how_to_use: string;
  student: { display_name: string; email: string | null; target_assessment: string };
  progress: Record<string, unknown>;
  domain_accuracy: { domain: string; section: string; attempted: number; correct: number; accuracy_pct: number; unseen: number }[];
  weakest_domains: string[];
  missed_items: { id: string; section: string; domain: string; skill: string; difficulty: string; prompt: string; status: string }[];
  saved_question_ids: string[];
  flashcards: { tracked: number; due_now: number };
  tests: unknown[];
  recent_activity: unknown[];
}

export function buildAiSnapshot(input: AiSnapshotInput, now: Date = new Date()): AiSnapshot {
  const byId = new Map(input.questions.map((q) => [q.id, q]));
  const domains = new Map<
    string,
    { domain: string; section: string; attempted: number; correct: number; unseen: number }
  >();

  input.questions.forEach((question) => {
    const entry = domains.get(question.domain) ?? {
      domain: question.domain,
      section: question.section,
      attempted: 0,
      correct: 0,
      unseen: 0,
    };
    const progress = input.progress[question.id];
    if (!progress || progress.attemptCount === 0) entry.unseen += 1;
    else {
      entry.attempted += 1;
      if (progress.lastIsCorrect) entry.correct += 1;
    }
    domains.set(question.domain, entry);
  });

  const domainAccuracy = Array.from(domains.values())
    .map((entry) => ({
      ...entry,
      accuracy_pct: entry.attempted > 0 ? Math.round((entry.correct / entry.attempted) * 100) : 0,
    }))
    .sort((a, b) => b.attempted - a.attempted || a.domain.localeCompare(b.domain));

  const weakest = domainAccuracy
    .filter((entry) => entry.attempted > 0 && entry.accuracy_pct < 80)
    .sort((a, b) => a.accuracy_pct - b.accuracy_pct || b.attempted - a.attempted)
    .slice(0, 8)
    .map((entry) => `${entry.domain} (${entry.accuracy_pct}% of ${entry.attempted})`);

  const missed = Object.entries(input.progress)
    .filter(([, progress]) => progress.attemptCount > 0 && !progress.lastIsCorrect)
    .slice(0, 60)
    .map(([id, progress]) => {
      const question = byId.get(id);
      return {
        id,
        section: question?.section ?? 'Unknown',
        domain: question?.domain ?? 'Unknown',
        skill: question?.skill ?? 'Unknown',
        difficulty: question?.difficulty ?? 'Unknown',
        prompt: (question?.prompt ?? '').slice(0, 400),
        status: progress.status,
      };
    });

  const nowMs = now.getTime();
  const dueNow = Object.values(input.flashcardProgress).filter((card) => {
    if (!card.nextDueAt) return true;
    return new Date(card.nextDueAt).getTime() <= nowMs;
  }).length;

  return {
    schema_version: AI_SNAPSHOT_VERSION,
    generated_at: now.toISOString(),
    account_type: input.mode,
    how_to_use:
      'This JSON is one student\u2019s own HDSAT practice history. Use it to diagnose weak domains, choose what to study next, and build a study plan. It contains no answer keys, so ask the student to show a question if you need the choices.',
    student: {
      display_name: input.user?.displayName ?? 'Guest',
      email: input.user?.email ?? null,
      target_assessment: input.assessment,
    },
    progress: {
      hd_coins: input.account.hdCoins,
      current_streak_days: input.account.currentStreak,
      best_streak_days: input.account.bestStreak,
      questions_answered: input.totals.attempts,
      questions_correct: input.totals.correct,
      accuracy_pct: Math.round(input.totals.accuracy * 100),
      mastered_questions: input.totals.mastered,
      achievements: input.account.achievements,
      owned_cosmetics: input.account.ownedItems,
      preferences: input.account.settings,
    },
    domain_accuracy: domainAccuracy,
    weakest_domains: weakest,
    missed_items: missed,
    saved_question_ids: [...input.saved],
    flashcards: { tracked: Object.keys(input.flashcardProgress).length, due_now: dueNow },
    tests: input.testAttempts
      .filter((attempt) => attempt.status !== 'incomplete')
      .slice(0, 10)
      .map((attempt) => ({
        assessment: attempt.assessment,
        taken_on: attempt.createdAt.slice(0, 10),
        rw_estimate: attempt.rwEstimate,
        math_estimate: attempt.mathEstimate,
        total_estimate: attempt.totalEstimate,
        modules: attempt.modules.map((module) => ({
          section: module.section,
          tier: module.tier,
          correct: module.correct,
          total: module.total,
        })),
      })),
    recent_activity: input.dailyActivity.slice(-14).map((day) => ({
      date: day.date,
      questions: day.questionsCompleted,
      correct: day.correctQuestions,
      coins: day.coinsEarned,
    })),
  };
}

export interface ConsentInput {
  ageBand: string;
  guardianConsent: boolean;
  acceptedTerms: boolean;
}

export interface ConsentRecord {
  ok: boolean;
  errors: string[];
  metadata: Record<string, string | boolean>;
}

/**
 * Validates the signup consent gate and produces the metadata that the signup
 * trigger stores on the student's profile row.
 */
export function validateConsent(input: ConsentInput, now: Date = new Date()): ConsentRecord {
  const errors: string[] = [];
  if (!input.ageBand) errors.push('Select your age group so we can apply the right privacy rules.');
  if (!input.acceptedTerms) errors.push('You must accept the Terms of Service and Privacy Policy.');
  if (input.ageBand !== '18+' && !input.guardianConsent) {
    errors.push('A parent or guardian must review and agree before someone under 18 creates an account.');
  }
  return {
    ok: errors.length === 0,
    errors,
    metadata: {
      age_band: input.ageBand,
      guardian_consent: input.guardianConsent,
      terms_version: LEGAL_VERSION,
      terms_accepted_at: now.toISOString(),
    },
  };
}
