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
