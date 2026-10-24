/**
 * Mottos for the starting homepage.
 *
 * Every visit to the homepage shows a different line, in order, so a returning
 * student never reads the same motto twice in a row. The lines are written for
 * HDSAT rather than quoted from anyone, so there is no attribution to get
 * wrong and no licence to check.
 */

export const MOTTOS: string[] = [
  'Practice is a habit, not an event.',
  'The score follows the work.',
  'Small sessions, done often.',
  'Understand one more thing today.',
  'Speed is what clarity looks like under a clock.',
  'Every missed question is a lead.',
  'Learn the rule, then beat the clock.',
  'Consistency outranks intensity.',
  'Read the whole question before you answer it.',
  'A hard item is a skill you have not met yet.',
  'Review is where practice becomes knowledge.',
  'Show up today; the test is only one of the days.',
];

export const MOTTO_STORAGE_KEY = 'hdsat.welcome-motto.v1';

/**
 * Next motto in the list, given the last one shown. Falling back to the list
 * start when nothing is stored keeps a first open deterministic and testable.
 */
export function nextMotto(lastIndex: number | null | undefined): {
  index: number;
  text: string;
} {
  const safe =
    typeof lastIndex === 'number' && Number.isFinite(lastIndex)
      ? Math.abs(Math.trunc(lastIndex)) % MOTTOS.length
      : MOTTOS.length - 1;
  const index = (safe + 1) % MOTTOS.length;
  return { index, text: MOTTOS[index] };
}

function readIndex(): number | null {
  try {
    const raw = localStorage.getItem(MOTTO_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Advances the stored motto and returns the new line. Never throws. */
export function takeNextMotto(): string {
  const { index, text } = nextMotto(readIndex());
  try {
    localStorage.setItem(MOTTO_STORAGE_KEY, String(index));
  } catch {
    /* storage is a nicety; the line still shows */
  }
  return text;
}
