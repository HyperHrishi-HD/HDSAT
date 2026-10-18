import { describe, expect, it } from 'vitest';
import legalSource from './legal.ts?raw';
import termsSource from '../pages/Legal.tsx?raw';
import {
  APPEAL_CATEGORIES,
  LEGAL_VERSION,
  MIN_AGE,
  APPEAL_SLA_HOURS,
  AGE_BANDS,
  contactLine,
  governingLawClause,
} from './legal';
import { buildDataExport, exportFileName, validateConsent, type DataExportInput } from './dataRights';
import { isMissingColumnError, isMissingRelationError, isMissingRoutineError } from './cloud';

describe('signup consent gate (minors / COPPA)', () => {
  it('refuses signup without an age band or without accepting the policies', () => {
    expect(validateConsent({ ageBand: '', guardianConsent: false, acceptedTerms: true }).ok).toBe(false);
    expect(validateConsent({ ageBand: '16-17', guardianConsent: true, acceptedTerms: false }).ok).toBe(false);
  });

  it('requires parent or guardian consent for every minor band', () => {
    const minor = validateConsent({ ageBand: '13-15', guardianConsent: false, acceptedTerms: true });
    expect(minor.ok).toBe(false);
    expect(minor.errors.join(' ')).toMatch(/parent or guardian/i);

    expect(validateConsent({ ageBand: '16-17', guardianConsent: false, acceptedTerms: true }).ok).toBe(false);
  });

  it('accepts adults without guardian consent and records a versioned consent record', () => {
    const adult = validateConsent({ ageBand: '18+', guardianConsent: false, acceptedTerms: true });
    expect(adult.ok).toBe(true);
    expect(adult.metadata.age_band).toBe('18+');
    expect(adult.metadata.terms_version).toBe(LEGAL_VERSION);

    const minor = validateConsent(
      { ageBand: '13-15', guardianConsent: true, acceptedTerms: true },
      new Date('2026-10-17T12:00:00Z')
    );
    expect(minor.ok).toBe(true);
    expect(minor.metadata.guardian_consent).toBe(true);
    expect(minor.metadata.terms_accepted_at).toBe('2026-10-17T12:00:00.000Z');
  });

  it('keeps the under-13 policy explicit', () => {
    expect(MIN_AGE).toBe(13);
    expect(AGE_BANDS.map((b) => b.value)).toEqual(['13-15', '16-17', '18+']);
  });
});

describe('data rights: export and deletion affordances', () => {
  const input: DataExportInput = {
    user: { id: 'u-1', email: 'student@example.com', displayName: 'Student' },
    mode: 'cloud',
    account: {
      hdCoins: 120,
      currentStreak: 3,
      bestStreak: 9,
      totals: { attempts: 12, correct: 8, accuracy: 0.667 },
      achievements: ['first-steps'],
      ownedItems: ['classic-blue'],
      settings: { assessment: 'SAT' },
    },
    progress: { 'RW-INF-001': { questionId: 'RW-INF-001', attemptCount: 2 } },
    saved: ['MATH-ALG-003'],
    flashcardProgress: { 'vocab-abate': { cardId: 'vocab-abate' } },
    testAttempts: [{ id: 't-1', modules: [] }],
    dailyActivity: [{ date: '2026-10-17' }],
  };

  it('exports the student’s own data and never any answer key material', () => {
    const payload = buildDataExport(input, new Date('2026-10-17T00:00:00Z'));
    const json = JSON.stringify(payload);

    expect(payload.account_type).toBe('cloud');
    expect(payload.generated_at).toBe('2026-10-17T00:00:00.000Z');
    expect(payload.data.saved_questions).toEqual(['MATH-ALG-003']);
    expect(json).toContain('RW-INF-001');
    // Answer keys, explanations and other users' data must never be exported.
    expect(json).not.toContain('correct_answer');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('distractor_rationales');
    expect(json).not.toContain('question_keys');
  });

  it('builds a safe, dated export filename', () => {
    const name = exportFileName({ email: 'Student.Name@example.com' }, new Date('2026-10-17T00:00:00Z'));
    expect(name).toBe('hdsat-data-export-Student.Name-2026-10-17.json');

    // Path-traversal and header-hostile characters never reach the filename.
    const tricky = exportFileName({ email: 'a/b+c@example.com' }, new Date('2026-10-17T00:00:00Z'));
    expect(tricky).not.toMatch(/[/+@]/);
    expect(tricky.startsWith('hdsat-data-export-')).toBe(true);
    expect(tricky.endsWith('.json')).toBe(true);

    expect(exportFileName(null).startsWith('hdsat-data-export-guest-')).toBe(true);
  });
});

describe('appeal intake covers every escalation channel', () => {
  it('offers safety, copyright, accuracy, access and data-request categories', () => {
    const values = APPEAL_CATEGORIES.map((c) => c.value);
    for (const required of ['safety_report', 'content_copyright', 'question_error', 'account_access', 'data_request']) {
      expect(values).toContain(required);
    }
    expect(APPEAL_SLA_HOURS).toBeGreaterThan(0);
    expect(contactLine().length).toBeGreaterThan(0);
  });

  it('states a governing law without inventing a jurisdiction', () => {
    expect(governingLawClause()).toMatch(/governed by the laws/i);
  });
});

describe('schema-drift resilience keeps safety flows honest', () => {
  it('detects a not-yet-migrated column so a question report still lands', () => {
    expect(
      isMissingColumnError(
        "Could not find the 'contact_email' column of 'question_reports' in the schema cache",
        'contact_email'
      )
    ).toBe(true);
    expect(isMissingColumnError('PGRST204: contact_email unknown', 'contact_email')).toBe(true);
    // An ordinary permission failure must never be mistaken for schema drift.
    expect(isMissingColumnError('permission denied for column contact_email', 'contact_email')).toBe(false);
    expect(isMissingColumnError('JWT expired', 'contact_email')).toBe(false);
  });

  it('detects a not-yet-migrated appeals table', () => {
    expect(
      isMissingRelationError("Could not find the table 'public.user_appeals' in the schema cache", 'user_appeals')
    ).toBe(true);
    expect(
      isMissingRelationError("Could not find the table 'public.other_table' in the schema cache", 'user_appeals')
    ).toBe(false);
  });

  it('detects a missing deletion RPC so the user is told instead of misled', () => {
    expect(
      isMissingRoutineError('Could not find the function public.delete_own_account() in the schema cache', 'delete_own_account')
    ).toBe(true);
    expect(isMissingRoutineError('JWT expired', 'delete_own_account')).toBe(false);
    expect(isMissingRoutineError('infinite recursion detected in policy', 'delete_own_account')).toBe(false);
  });
});

describe('published policies cover the required disclosures', () => {
  const haystack = `${termsSource}\n${legalSource}`.toLowerCase();

  it.each([
    ['terms of service', 'terms'],
    ['privacy & data rights', 'privacy'],
    ['copyright & content policy', 'copyright'],
    ['acceptable use', 'acceptable use'],
    ['parent or guardian', 'guardian consent'],
    ['trademark', 'no College Board affiliation'],
    ['not affiliated', 'no College Board affiliation'],
    ['counter-notice', 'DMCA counter-notice'],
    ['signature', 'DMCA notice elements'],
    ['delete your account', 'self-serve deletion'],
    ['bulk-download', 'anti-scraping clause'],
    ['safety', 'safety reporting'],
    ['age band', 'age handling'],
    ['retention', 'retention period'],
    ['security', 'security practices'],
  ])('mentions %s (%s)', (needle) => {
    expect(haystack).toContain(needle);
  });
});
