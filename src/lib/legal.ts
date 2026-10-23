/**
 * Legal, safety and compliance configuration for HDSAT.
 *
 * Everything here is deployment-configurable so the operator can publish
 * accurate policies without editing components. Values that are left unset fall
 * back to neutral wording instead of inventing a legal entity, mailing address
 * or mailbox that does not exist yet. Set these in the build environment:
 *
 *   VITE_OPERATOR_NAME   e.g. "HDSAT Prep LLC"
 *   VITE_SUPPORT_EMAIL   e.g. "support@yourdomain.com"  (optional but recommended)
 *   VITE_JURISDICTION    e.g. "the State of Delaware, United States"
 */

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};

function clean(value: string | undefined): string {
  return String(value ?? '').trim();
}

/** Bump this whenever the policies below change materially. */
export const LEGAL_VERSION = '1.0';
export const LEGAL_EFFECTIVE_DATE = 'October 17, 2026';
export const SITE_NAME = 'HDSAT';
export const TERMS_PATH = '/terms';
export const PRIVACY_PATH = '/privacy';
export const COPYRIGHT_PATH = '/copyright';
export const CREDITS_PATH = '/credits';
export const CREATOR_HANDLE = 'HyperHrishi-HD';
export const CREATOR_YOUTUBE_URL = 'https://www.youtube.com/@HyperHrishiHD';
export const CREATOR_GITHUB_URL = 'https://github.com/HyperHrishi-HD/HDSAT';

export const OPERATOR_NAME = clean(env.VITE_OPERATOR_NAME) || `the ${SITE_NAME} operator`;
export const SUPPORT_EMAIL = clean(env.VITE_SUPPORT_EMAIL);
export const JURISDICTION = clean(env.VITE_JURISDICTION);

/**
 * Minimum age to create an account. Under-13 accounts are refused outright
 * (COPPA); 13–17 accounts require parent/guardian consent.
 */
export const MIN_AGE = 13;

/** Target first-response window for safety, copyright and access requests. */
export const APPEAL_SLA_HOURS = 72;

export type AgeBand = '13-15' | '16-17' | '18+';

export const AGE_BANDS: { value: AgeBand; label: string }[] = [
  { value: '13-15', label: '13–15 years old' },
  { value: '16-17', label: '16–17 years old' },
  { value: '18+', label: '18 years or older' },
];

export type AppealCategory =
  | 'content_copyright'
  | 'question_error'
  | 'account_access'
  | 'data_request'
  | 'safety_report'
  | 'other';

export const APPEAL_CATEGORIES: { value: AppealCategory; label: string }[] = [
  { value: 'safety_report', label: 'Safety or abuse report' },
  { value: 'content_copyright', label: 'Copyright / content removal request' },
  { value: 'question_error', label: 'Question is wrong, unclear or mistagged' },
  { value: 'account_access', label: 'Account access or ban appeal' },
  { value: 'data_request', label: 'Data access, correction or deletion request' },
  { value: 'other', label: 'Something else' },
];

export const QUESTION_REPORT_REASONS = [
  { value: 'incorrect_answer', label: 'The marked correct answer looks wrong' },
  { value: 'wrong_explanation', label: 'The explanation is wrong or missing' },
  { value: 'mistagged', label: 'Wrong section, domain, skill or difficulty' },
  { value: 'unclear_formatting', label: 'Formatting, math or figure does not render correctly' },
  { value: 'copyright', label: 'Copyright or attribution concern' },
  { value: 'inappropriate', label: 'Inappropriate or unsafe content' },
  { value: 'other', label: 'Other problem' },
];

/** How the operator can be reached. Falls back to the in-app appeal form. */
export function contactLine(): string {
  if (SUPPORT_EMAIL) return `email ${SUPPORT_EMAIL} or use the in-app appeal form`;
  return 'use the in-app appeal form below';
}

/**
 * Governing-law clause. We never guess a jurisdiction: when one is configured
 * the clause names it, otherwise it refers to the operator's own jurisdiction
 * without asserting a specific state or country.
 */
export function governingLawClause(): string {
  if (JURISDICTION) {
    return `These Terms are governed by the laws of ${JURISDICTION}, without regard to its conflict-of-law rules.`;
  }
  return 'These Terms are governed by the laws of the jurisdiction in which the operator is established, without regard to conflict-of-law rules.';
}

export function venuesClause(): string {
  if (JURISDICTION) {
    return `The state and federal courts located in ${JURISDICTION} have exclusive jurisdiction over any dispute arising from these Terms.`;
  }
  return 'The courts located in the operator’s jurisdiction have exclusive jurisdiction over any dispute arising from these Terms.';
}
