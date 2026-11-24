import type { Question } from './types';

/** Stable source ID used by the normalized College Board supplemental bank. */
export const COLLEGE_BOARD_SOURCE_ID = 'collegeboard-sat';

/** True for rows fetched from the official College Board question bank. */
export function isCollegeBoardQuestion(
  question: Pick<Question, 'source_id'> | null | undefined
): boolean {
  return question?.source_id === COLLEGE_BOARD_SOURCE_ID;
}

/** True for a clean College Board row: no released-practice overlap and no unusable markup. */
export function isServableCollegeBoardQuestion(
  question: Pick<Question, 'source_id' | 'in_practice_test' | 'unusable'> | null | undefined
): boolean {
  return Boolean(
    question &&
      isCollegeBoardQuestion(question) &&
      !question.in_practice_test &&
      !question.unusable
  );
}

/**
 * Full-test assembly and the arcade/daily pickers may use every curated row,
 * but only clean official rows. The explicit official practice dataset can
 * include released-practice overlap for deliberate review; adaptive tests do
 * not.
 */
export function isAssemblyEligible(question: Question): boolean {
  return isCollegeBoardQuestion(question) ? isServableCollegeBoardQuestion(question) : true;
}

/** True for HTML payloads (College Board); curated bank text remains plain/LaTeX. */
export function hasHtmlMarkup(text: string | null | undefined): boolean {
  return Boolean(
    text &&
      /<\s*(?:p|div|span|math|table|svg|img|figure|ul|ol|li|blockquote|strong|em|br)\b/i.test(
        text
      )
  );
}
