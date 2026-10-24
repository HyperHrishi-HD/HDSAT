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
  /** Scores of deleted simulations; the runs themselves are no longer held. */
  testScoreLog?: unknown[];
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
    test_score_log: unknown[];
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
      test_score_log: input.testScoreLog ?? [],
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
export const AI_SNAPSHOT_VERSION = '2.0';

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
  progress: Record<
    string,
    {
      attemptCount: number;
      correctCount: number;
      lastIsCorrect: boolean;
      status: string;
      lastResponse?: string;
    }
  >;
  questions: {
    id: string;
    section: string;
    domain: string;
    skill: string;
    difficulty: string;
    prompt: string;
  }[];
  /** Timed attempts from this device; used for the pacing block. */
  attempts?: { questionId: string; seconds: number; isCorrect: boolean }[];
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
  role: string;
  data: {
    student: { display_name: string; target_assessment: string };
    goal: {
      target_assessment: string;
      daily_question_goal: number;
      items_due_for_review: number;
      flashcards_due: number;
    };
    accuracy: {
      questions_answered: number;
      questions_correct: number;
      accuracy_pct: number;
      mastered: number;
      streak_days: number;
      best_streak_days: number;
    };
    domains: {
      section: string;
      domain: string;
      attempted: number;
      correct: number;
      accuracy_pct: number;
    }[];
    skills: {
      section: string;
      domain: string;
      skill: string;
      attempted: number;
      correct: number;
      accuracy_pct: number;
    }[];
    weakest_skills: { skill: string; section: string; accuracy_pct: number; attempted: number; correct: number }[];
    missed_items: {
      id: string;
      section: string;
      skill: string;
      difficulty: string;
      prompt: string;
      your_answer: string;
    }[];
    slowest_correct: { id: string; skill: string; seconds: number }[];
    slowest_incorrect: { id: string; skill: string; seconds: number; your_answer: string }[];
    tests: {
      taken_on: string;
      assessment: string;
      total_estimate: number | null;
      rw_estimate: number | null;
      math_estimate: number | null;
      modules: { section: string; tier: string; correct: number; total: number }[];
    }[];
    last_14_days: { date: string; questions: number; correct: number }[];
    flashcards: { tracked: number; due_now: number };
  };
  requested_output: {
    format: string;
    tasks: string[];
    constraints: string[];
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pct(correct: number, attempted: number): number {
  return attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
}

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/**
 * Tutor brief.
 *
 * A single JSON document shaped as an instruction payload: what the student's
 * own data says, then exactly what the model should produce. Deterministic
 * ordering and stable field order make two exports diffable. No answer keys,
 * no explanations, no email address, no other students' data.
 */
export function buildAiSnapshot(input: AiSnapshotInput, now: Date = new Date()): AiSnapshot {
  const byId = new Map(input.questions.map((question) => [question.id, question]));

  const domains = new Map<string, { section: string; domain: string; attempted: number; correct: number }>();
  const skills = new Map<
    string,
    { section: string; domain: string; skill: string; attempted: number; correct: number }
  >();

  input.questions.forEach((question) => {
    const progress = input.progress[question.id];
    const attempted = progress?.attemptCount ?? 0;
    const correct = progress?.correctCount ?? 0;

    const domainKey = `${question.section}|${question.domain}`;
    const domain = domains.get(domainKey) ?? {
      section: question.section,
      domain: question.domain,
      attempted: 0,
      correct: 0,
    };
    domain.attempted += attempted;
    domain.correct += correct;
    domains.set(domainKey, domain);

    const skillKey = `${question.section}|${question.domain}|${question.skill}`;
    const skill = skills.get(skillKey) ?? {
      section: question.section,
      domain: question.domain,
      skill: question.skill,
      attempted: 0,
      correct: 0,
    };
    skill.attempted += attempted;
    skill.correct += correct;
    skills.set(skillKey, skill);
  });

  const domainRows = [...domains.values()]
    .map((entry) => ({ ...entry, accuracy_pct: pct(entry.correct, entry.attempted) }))
    .filter((entry) => entry.attempted > 0)
    .sort(
      (a, b) =>
        a.section.localeCompare(b.section) ||
        b.attempted - a.attempted ||
        a.domain.localeCompare(b.domain)
    );

  const skillRows = [...skills.values()]
    .map((entry) => ({ ...entry, accuracy_pct: pct(entry.correct, entry.attempted) }))
    .filter((entry) => entry.attempted > 0)
    .sort(
      (a, b) =>
        a.section.localeCompare(b.section) ||
        a.domain.localeCompare(b.domain) ||
        a.skill.localeCompare(b.skill)
    )
    .slice(0, 40);

  const weakestSkills = [...skillRows]
    .filter((entry) => entry.accuracy_pct < 80)
    .sort(
      (a, b) =>
        a.accuracy_pct - b.accuracy_pct ||
        b.attempted - a.attempted ||
        a.skill.localeCompare(b.skill)
    )
    .slice(0, 6)
    .map((entry) => ({
      skill: entry.skill,
      section: entry.section,
      accuracy_pct: entry.accuracy_pct,
      attempted: entry.attempted,
      correct: entry.correct,
    }));

  const missed = Object.entries(input.progress)
    .filter(([, progress]) => progress.attemptCount > 0 && !progress.lastIsCorrect)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 12)
    .map(([id, progress]) => {
      const question = byId.get(id);
      return {
        id,
        section: question?.section ?? 'Unknown',
        skill: question?.skill ?? 'Unknown',
        difficulty: question?.difficulty ?? 'Unknown',
        prompt: clip(question?.prompt ?? '', 180),
        your_answer: clip(progress.lastResponse ?? '', 40),
      };
    });

  const timed = (input.attempts ?? [])
    .filter((attempt) => attempt.seconds >= 3 && attempt.seconds <= 1200)
    .map((attempt) => ({ ...attempt, question: byId.get(attempt.questionId) }))
    .filter((attempt) => Boolean(attempt.question));

  const slowestCorrect = [...timed]
    .filter((attempt) => attempt.isCorrect)
    .sort((a, b) => b.seconds - a.seconds || a.questionId.localeCompare(b.questionId))
    .slice(0, 3)
    .map((attempt) => ({
      id: attempt.questionId,
      skill: attempt.question?.skill ?? 'Unknown',
      seconds: Math.round(attempt.seconds),
    }));

  const slowestIncorrect = [...timed]
    .filter((attempt) => !attempt.isCorrect)
    .sort((a, b) => b.seconds - a.seconds || a.questionId.localeCompare(b.questionId))
    .slice(0, 3)
    .map((attempt) => ({
      id: attempt.questionId,
      skill: attempt.question?.skill ?? 'Unknown',
      seconds: Math.round(attempt.seconds),
      your_answer: clip(input.progress[attempt.questionId]?.lastResponse ?? '', 40),
    }));

  const tests = input.testAttempts
    .filter((attempt) => attempt.status !== 'incomplete')
    .slice(0, 8)
    .map((attempt) => ({
      taken_on: attempt.createdAt.slice(0, 10),
      assessment: attempt.assessment,
      total_estimate: attempt.totalEstimate,
      rw_estimate: attempt.rwEstimate,
      math_estimate: attempt.mathEstimate,
      modules: attempt.modules.map((module) => ({
        section: module.section,
        tier: module.tier,
        correct: module.correct,
        total: module.total,
      })),
    }));

  // Dense window ending today, oldest first, so empty days are visible.
  const activityByDate = new Map(input.dailyActivity.map((day) => [day.date, day]));
  const last14 = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(now.getTime() - (13 - index) * DAY_MS);
    const key = localDateKey(day);
    const recorded = activityByDate.get(key);
    return {
      date: key,
      questions: recorded?.questionsCompleted ?? 0,
      correct: recorded?.correctQuestions ?? 0,
    };
  });

  const dueCards = Object.values(input.flashcardProgress).filter(
    (card) => !card.nextDueAt || Date.parse(card.nextDueAt) <= now.getTime()
  ).length;

  return {
    schema_version: AI_SNAPSHOT_VERSION,
    role:
      'You are an SAT tutor reviewing one student\\u2019s HDSAT practice history. Treat the data block as evidence, not as a score report.',
    data: {
      student: {
        display_name: input.user?.displayName ?? 'Guest',
        target_assessment: input.assessment,
      },
      goal: {
        target_assessment: input.assessment,
        daily_question_goal: 3,
        items_due_for_review: Object.values(input.progress).filter(
          (progress) => progress.status === 'incorrect'
        ).length,
        flashcards_due: dueCards,
      },
      accuracy: {
        questions_answered: input.totals.attempts,
        questions_correct: input.totals.correct,
        accuracy_pct: Math.round(input.totals.accuracy * 100),
        mastered: input.totals.mastered,
        streak_days: input.account.currentStreak,
        best_streak_days: input.account.bestStreak,
      },
      domains: domainRows,
      skills: skillRows,
      weakest_skills: weakestSkills,
      missed_items: missed,
      slowest_correct: slowestCorrect,
      slowest_incorrect: slowestIncorrect,
      tests,
      last_14_days: last14,
      flashcards: { tracked: Object.keys(input.flashcardProgress).length, due_now: dueCards },
    },
    requested_output: {
      format: 'markdown',
      tasks: [
        'Diagnose the two or three weakest skills, citing attempts and accuracy from the data.',
        'Give a 7-day plan, 25-40 minutes a day, that uses HDSAT practice and review.',
        'For each weak skill, name one technique and one check the student can use to verify progress.',
      ],
      constraints: [
        'Use only the data in this document.',
        'Say "thin evidence" when a skill has fewer than 5 attempts.',
        'Do not invent question content, scores or answer keys.',
      ],
    },
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
