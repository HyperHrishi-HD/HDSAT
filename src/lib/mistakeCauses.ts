import type { Question } from './types';

/**
 * Why a full-test item was missed.
 *
 * This is a reading of the evidence the app already has, not a guess dressed as
 * a fact: the chosen distractor's own rationale, the response against the
 * accepted answers, and the question's difficulty. Every result carries the
 * sentence it was derived from so the review screen can show its work, and the
 * wording stays at "likely" unless the evidence is categorical (a blank answer)
 * or numeric (an SPR that is a sign flip or a near miss).
 *
 * Deliberately computed at review time and never stored: it is feedback for the
 * student, not part of the attempt. That is also why it cannot reach the PDF,
 * the JSON export or the shared summary — those are built from the attempt, and
 * the attempt has no cause on it.
 */

export type MistakeCause =
  | 'blank'
  | 'sign'
  | 'calculation'
  | 'units'
  | 'scope'
  | 'half-step'
  | 'misread'
  | 'concept'
  | 'careless';

export interface MistakeExplanation {
  cause: MistakeCause;
  /** Short label for a badge. */
  label: string;
  /** One sentence a student can act on. */
  hint: string;
  /** The evidence, quoted; empty when the cause is only a weak inference. */
  evidence: string;
  /** 0–1. Low confidence is shown as "worth a second look", not asserted. */
  confidence: number;
}

const LABELS: Record<MistakeCause, { label: string; hint: string }> = {
  blank: {
    label: 'Left blank',
    hint: 'The item ran out of time or was skipped. Pace is the thing to practise here.',
  },
  sign: {
    label: 'Sign or direction',
    hint: 'The work was right but a negative, opposite or inverse went the wrong way.',
  },
  calculation: {
    label: 'Arithmetic slip',
    hint: 'The method was right; the final number was not. Check the last step before moving on.',
  },
  units: {
    label: 'Units or scale',
    hint: 'Convert and label units before answering; the numbers usually agree otherwise.',
  },
  scope: {
    label: 'Scope of the answer',
    hint: 'The choice says more, or less, than the passage or the question asks for.',
  },
  'half-step': {
    label: 'Stopped early',
    hint: 'The first step landed, but the question needed one more operation.',
  },
  misread: {
    label: 'Misread the text',
    hint: 'The choice contradicts a detail in the passage. Re-read the lines the question points at.',
  },
  concept: {
    label: 'Concept gap',
    hint: 'The underlying rule is not secure yet. Study the explanation, then try a sibling item.',
  },
  careless: {
    label: 'Careless error',
    hint: 'The concept looks solid; slow down on the final read of the choices.',
  },
};

const RULES: { cause: MistakeCause; pattern: RegExp; confidence: number }[] = [
  {
    cause: 'sign',
    pattern: /\b(sign|negative|positive|opposite|inverse|flip(ped)?)\b/i,
    confidence: 0.9,
  },
  {
    cause: 'units',
    pattern: /\b(unit|units|convert|conversion|scale|scaled|ratio|rate)\b/i,
    confidence: 0.85,
  },
  {
    cause: 'half-step',
    pattern:
      /\b(first step|stopped|half|only (found|solved|computed)|forgot to|did not (finish|complete|subtract|divide|multiply)|instead of (adding|subtracting|multiplying|dividing))\b/i,
    confidence: 0.85,
  },
  {
    cause: 'scope',
    pattern:
      /\b(too (broad|narrow|general|specific|strong)|scope|overstates|understates|only part|part of the (idea|passage)|whole passage)\b/i,
    confidence: 0.85,
  },
  {
    cause: 'misread',
    pattern:
      /\b(misread|misreads|reads|detail|contradicts|not stated|passage (says|states)|according to the text)\b/i,
    confidence: 0.8,
  },
  {
    cause: 'calculation',
    pattern:
      /\b(arithmetic|calculat(ed|ion)|computed|added|subtracted|multiplied|divided|rounded)\b/i,
    confidence: 0.8,
  },
  {
    cause: 'concept',
    pattern:
      /\b(definition|concept|confuses|confused|does not (mean|describe|support)|misunderstands|rule|formula)\b/i,
    confidence: 0.75,
  },
];

/** Accepted answers as numbers, ignoring units and currency marks. */
function numbers(values: (string | number | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const cleaned = String(value).replace(/[,$%\s]/g, '');
    if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) continue;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) out.push(parsed);
  }
  return out;
}

function blank(response: string | null): MistakeExplanation {
  return {
    cause: 'blank',
    ...LABELS.blank,
    evidence: response === null ? 'No answer was recorded.' : 'The answer box was left empty.',
    confidence: 1,
  };
}

function fromEvidence(
  question: Question,
  response: string | null,
  rationale: string | null
): MistakeExplanation | null {
  const text = rationale ?? '';
  if (text) {
    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        return {
          cause: rule.cause,
          ...LABELS[rule.cause],
          evidence: text.trim().slice(0, 220),
          confidence: rule.confidence,
        };
      }
    }
  }

  // No rationale, or one without a tell. A near miss on a numeric answer is
  // still strong evidence, so check it before falling back to difficulty.
  const keyed = numbers([question.correct_answer, ...(question.acceptable_answers ?? [])]);
  const given = numbers([response]);
  if (keyed.length > 0 && given.length > 0) {
    const key = keyed[0];
    const value = given[0];
    if (key !== 0 && Math.abs(value - -key) < Math.abs(key) * 1e-9) {
      return {
        cause: 'sign',
        ...LABELS.sign,
        evidence: `The answer was ${value}, the negative of the key.`,
        confidence: 0.95,
      };
    }
    const relative = Math.abs(value - key) / Math.max(1e-9, Math.abs(key));
    if (relative > 0 && relative <= 0.15) {
      return {
        cause: 'calculation',
        ...LABELS.calculation,
        evidence: `The answer was close to the key (${value} versus ${key}).`,
        confidence: 0.8,
      };
    }
  }

  if (text) {
    return {
      cause: 'concept',
      ...LABELS.concept,
      evidence: text.trim().slice(0, 220),
      confidence: 0.6,
    };
  }
  return null;
}

export function explainMistake(
  question: Question,
  response: string | null | undefined
): MistakeExplanation | null {
  const given = (response ?? '').trim();
  if (!given) return blank(response ?? null);

  const rationale =
    question.format === 'multiple_choice' && question.distractor_rationales
      ? (question.distractor_rationales[given] ??
        Object.entries(question.distractor_rationales).find(
          ([key]) => key.toUpperCase() === given.toUpperCase()
        )?.[1] ??
        null)
      : null;

  const evidenced = fromEvidence(question, given, rationale ?? null);
  if (evidenced) return evidenced;

  // Nothing to read. Say what the difficulty suggests, at a low confidence, so
  // the label cannot be mistaken for a diagnosis.
  const cause: MistakeCause = question.difficulty === 'Easy' ? 'careless' : 'concept';
  return {
    cause,
    ...LABELS[cause],
    evidence: '',
    confidence: 0.35,
  };
}
