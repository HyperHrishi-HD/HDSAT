/**
 * Whole-bank integrity checks.
 *
 * These are the mistakes that make a question unanswerable rather than merely
 * hard: a key letter that is not one of the choices, two choices that are the
 * same answer, a "which value is a zero" item where three of the four values
 * are zeros, a student-produced response with no acceptable answer, or two
 * byte-identical items in the same bank. They are cheap to run over every item
 * and they guard the classes of defect that have actually shipped before.
 */
import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import { checkAnswer } from './grading';
import type { Question } from './types';

const questions = (bankJson as unknown as { questions: Question[] }).questions;

function numeric(text: string): number | null {
  const cleaned = text
    .replace(/\$/g, '')
    .replace(/\\\$/g, '')
    .replace(/\\[dt]?frac\{(-?\d+(?:\.\d+)?)\}\{(-?\d+(?:\.\d+)?)\}/g, '$1/$2')
    .replace(/[,\s]/g, '')
    .replace(/^\+/, '');
  if (!cleaned) return null;
  const fraction = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(cleaned);
  if (fraction) {
    const top = Number(fraction[1]);
    const bottom = Number(fraction[2]);
    return bottom === 0 ? null : top / bottom;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function plain(text: string | null): string {
  // Strip the math delimiters, not the math: `$4$` is the answer "4", and
  // removing the whole span would make every math choice look empty.
  return (text ?? '').replace(/\$/g, '').replace(/\s+/g, ' ').trim();
}

describe('question bank integrity', () => {
  it('ships the full 10,024-item bank', () => {
    expect(questions).toHaveLength(10024);
  });

  it('does not label one-step data-change charts as Hard', () => {
    // The World Bank change/trend/comparison families ask the student to read a
    // single chart or table. They are useful Medium/Easy evidence items, not
    // QOTD-grade inference. The D130 item was the Friday QOTD that exposed this.
    const oneStep = questions.filter((question) =>
      /^RW-(M15-WB-D|M14-WB-(T|C|B))/.test(question.id)
    );
    expect(oneStep.length).toBeGreaterThan(30);
    for (const question of oneStep) {
      expect(question.difficulty, `${question.id} is mislabelled Hard`).not.toBe('Hard');
      for (const choice of question.choices ?? []) {
        expect(choice.text, `${question.id} has a negative-gain claim`).not.toMatch(/gaining -/);
      }
    }
  });

  it('has unique ids and non-empty prompts, answers and explanations', () => {
    const ids = new Set<string>();
    for (const question of questions) {
      expect(ids.has(question.id), `duplicate id ${question.id}`).toBe(false);
      ids.add(question.id);
      expect(question.prompt.trim(), `empty prompt ${question.id}`).not.toBe('');
      expect(question.correct_answer.trim(), `empty key ${question.id}`).not.toBe('');
      expect(question.explanation.trim(), `empty explanation ${question.id}`).not.toBe('');
    }
  });

  it('gives every multiple-choice item four distinct choices and a key among them', () => {
    for (const question of questions) {
      if (question.format !== 'multiple_choice') continue;
      const choices = question.choices ?? [];
      expect(choices, `${question.id} has no choices`).toHaveLength(4);
      const ids = choices.map((choice) => choice.id);
      expect(new Set(ids).size, `${question.id} repeats a choice id`).toBe(4);
      expect(ids, `${question.id} key ${question.correct_answer} missing`).toContain(
        question.correct_answer
      );
      const texts = choices.map((choice) => plain(choice.text).toLowerCase());
      expect(new Set(texts).size, `${question.id} repeats a choice`).toBe(4);
      for (const text of texts) expect(text, `${question.id} has an empty choice`).not.toBe('');
    }
  });

  it('gives every student-produced response an acceptable answer', () => {
    for (const question of questions) {
      if (question.format !== 'spr') continue;
      const accepted = [question.correct_answer, ...(question.acceptable_answers ?? [])]
        .map((value) => value.trim())
        .filter(Boolean);
      expect(accepted.length, `${question.id} accepts nothing`).toBeGreaterThan(0);
      const key = numeric(question.correct_answer);
      if (key === null) continue;
      const numericAccepted = accepted.map(numeric).filter((value): value is number => value !== null);
      expect(
        numericAccepted.some((value) => Math.abs(value - key) < 1e-6),
        `${question.id} accepts no form of ${question.correct_answer}`
      ).toBe(true);
    }
  });

  it('fixes the two reported content defects', () => {
    const probability = questions.find((question) => question.id === 'M-DAT-76026');
    expect(probability, 'M-DAT-76026 is missing').toBeDefined();
    expect(probability?.prompt).not.toMatch(/answer as a fraction/i);
    expect(checkAnswer(probability!, '1/12')).toBe(true);
    expect(checkAnswer(probability!, '0.083')).toBe(true);
    expect(checkAnswer(probability!, '0.0833')).toBe(true);
    expect(checkAnswer(probability!, '.083')).toBe(true);

    const russian = questions.find((question) => question.id === 'RW-INF-319');
    expect(russian, 'RW-INF-319 is missing').toBeDefined();
    expect(russian?.stimulus).not.toMatch(/[\u0400-\u04FF]/);
    expect(russian?.stimulus).toContain('most falls happen');
  });

  it('never offers two mathematically equal numeric choices', () => {
    for (const question of questions) {
      if (question.section !== 'Math' || question.format !== 'multiple_choice') continue;
      const values = (question.choices ?? [])
        .map((choice) => ({ id: choice.id, value: numeric(plain(choice.text)) }))
        .filter((entry): entry is { id: string; value: number } => entry.value !== null);
      for (let left = 0; left < values.length; left += 1) {
        for (let right = left + 1; right < values.length; right += 1) {
          expect(
            Math.abs(values[left].value - values[right].value) < 1e-9,
            `${question.id}: choices ${values[left].id} and ${values[right].id} are equal`
          ).toBe(false);
        }
      }
    }
  });

  it('has exactly one zero among the choices of a factored-polynomial question', () => {
    for (const question of questions) {
      if (!/zero/i.test(question.prompt) || question.format !== 'multiple_choice') continue;
      const match = /^([fghpq])\(x\)\s*=\s*(.+)$/.exec(plain(question.stimulus));
      if (!match) continue;
      const factors = [...match[2].matchAll(/\(x\s*([+-])\s*(\d+)\)/g)];
      if (factors.length < 2) continue;
      const zeros = factors.map((factor) =>
        factor[1] === '+' ? -Number(factor[2]) : Number(factor[2])
      );
      const valid = (question.choices ?? []).filter((choice) => {
        const value = numeric(plain(choice.text));
        return value !== null && zeros.some((zero) => Math.abs(zero - value) < 1e-9);
      });
      expect(valid.length, `${question.id} has ${valid.length} zeros among its choices`).toBe(1);
      expect(valid[0].id, `${question.id} key does not point at the only zero`).toBe(
        question.correct_answer
      );
    }
  });

  it('points every "Substituting x = n" rationale at its own choice', () => {
    // A generator wrote all three rationales with the first wrong value, so
    // picking 1 could show "Substituting x = 2 leaves three nonzero factors"
    // even when 2 was a zero. A distractor explanation has to talk about the
    // distractor the student actually picked.
    for (const question of questions) {
      if (question.format !== 'multiple_choice') continue;
      if (!/zero/i.test(question.prompt)) continue;
      for (const choice of question.choices ?? []) {
        if (choice.id === question.correct_answer) continue;
        const text = (question.distractor_rationales ?? {})[choice.id] ?? '';
        const named = /Substituting \$x = (-?\d+(?:\.\d+)?)\$/.exec(text);
        if (!named) continue;
        expect(numeric(plain(choice.text)), `${question.id} ${choice.id} names x=${named[1]}`).toBe(
          Number(named[1])
        );
      }
    }
  });

  it('has no doubled words or repeated sentences in its text', () => {
    // A generator once emitted "binding agricultural agricultural byproducts"
    // and duplicated the final instruction sentence of 182 synthesis items.
    // A reader sees both as corrupted questions, so the bank fails the build
    // rather than shipping them. Legitimate English repetitions stay allowed.
    const legitimate = new Set(['had had', 'that that']);
    for (const question of questions) {
      const fields = [
        question.stimulus ?? '',
        question.prompt,
        question.explanation,
        ...(question.choices ?? []).map((choice) => choice.text),
      ];
      for (const text of fields) {
        expect(text, `${question.id} has an empty quotation pair`).not.toContain('""');
        expect(text, `${question.id} has an empty curly quotation pair`).not.toContain('“”');
        const match = /\b([A-Za-z]{3,})\s+\1\b/i.exec(text);
        if (match && !legitimate.has(match[0].toLowerCase())) {
          throw new Error(`${question.id} repeats "${match[0]}"`);
        }
        const sentences = text
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => sentence.trim().toLowerCase())
          .filter((sentence) => sentence.length >= 30);
        expect(
          new Set(sentences).size,
          `${question.id} repeats a sentence`
        ).toBe(sentences.length);
      }
    }
  });

  it('never labels a one-step Math item as Hard', () => {
    // The expansion generator used to promote every M-SYS/M-GEO/M-ALE item to
    // Hard to fill adaptive upper modules. That is how "legs 5 and 12, find the
    // hypotenuse" and "evaluate 32(1.5)^1" were sitting in the Hard pool. A
    // one-step family may be Medium at most, no matter how it is dressed up.
    const oneStep = new Set([
      'Linear equations in one variable',
      'Unit rates and conversions',
      'Volume and surface area',
      'Mean, median and mode',
      'Percentages',
      'Area and volume',
      'Circles',
      'Right triangles',
      'Lines, angles, and triangles',
      'Linear functions',
      'Linear functions: slope and intercepts',
      'Circles: area and circumference',
      'Circles: equations in standard form',
      'Probability and conditional probability',
      'Exponential growth and decay',
      'Right triangles and trigonometry',
    ]);
    for (const question of questions) {
      if (question.section !== 'Math' || question.difficulty !== 'Hard') continue;
      expect(oneStep.has(question.skill), `${question.id} (${question.skill}) is labelled Hard`).toBe(
        false
      );
    }
  });

  it('keeps Algebra at or below the Medium tier', () => {
    // Owner calibration: routinely solving a clean two-equation system is a
    // two-step task, so no Algebra item carries the top tier.
    const hardAlgebra = questions.filter(
      (question) =>
        question.section === 'Math' &&
        question.domain === 'Algebra' &&
        question.difficulty === 'Hard'
    );
    expect(hardAlgebra).toEqual([]);
  });

  it('keeps a usable Hard tier without flooding it', () => {
    const hard = questions.filter(
      (question) => question.section === 'Math' && question.difficulty === 'Hard'
    );
    expect(hard.length).toBeGreaterThanOrEqual(80);
    expect(hard.length).toBeLessThanOrEqual(800);
  });

  it('leaves no space between a fill-in blank and its punctuation', () => {
    const misplaced = /_{2,}\s+[,.;:]/;
    for (const question of questions) {
      const fields = [
        question.stimulus ?? '',
        question.prompt,
        question.explanation,
        ...(question.choices ?? []).map((choice) => choice.text),
      ];
      for (const text of fields) {
        expect(text, `${question.id} has a space before punctuation`).not.toMatch(misplaced);
      }
    }
  });

  it('routes every inference prompt to the Inferences skill', () => {
    const mismatched = questions.filter(
      (question) =>
        question.section === 'Reading and Writing' &&
        /what would most likely happen if/i.test(question.prompt) &&
        question.skill !== 'Inferences'
    );
    expect(mismatched.map((question) => `${question.id}: ${question.skill}`)).toEqual([]);
  });

  it('uses the verb form required by time, perfect and past-tense blanks', () => {
    // The Words-in-Context scale family originally shipped base verbs after
    // "spent two years", "had almost entirely" and a past-tense subject. Those
    // are grammar errors, not hard distractors. Keep every choice in the form
    // the surrounding sentence actually requires.
    const failures: string[] = [];
    let spent = 0;
    let perfect = 0;
    let restriction = 0;

    for (const question of questions) {
      if (!question.id.startsWith('RW-CRF-')) continue;
      const stimulus = question.stimulus ?? '';
      const choices = (question.choices ?? []).map((choice) => choice.text.trim());

      if (/\bspent\b[^.]{0,60}_{2,}/i.test(stimulus)) {
        spent += 1;
        if (!choices.every((choice) => /ing$/i.test(choice))) {
          failures.push(`${question.id}: spent choices ${choices.join(' / ')}`);
        }
      }

      if (/\bhad\b[^.]{0,30}almost entirely\s+_{2,}/i.test(stimulus)) {
        perfect += 1;
        if (!choices.every((choice) => /ed$/i.test(choice))) {
          failures.push(`${question.id}: perfect choices ${choices.join(' / ')}`);
        }
      }

      if (/_{2,}\s+the restriction\b/i.test(stimulus)) {
        restriction += 1;
        if (!choices.every((choice) => /ed$/i.test(choice))) {
          failures.push(`${question.id}: past-tense choices ${choices.join(' / ')}`);
        }
      }
    }

    expect({ spent, perfect, restriction }).toEqual({ spent: 35, perfect: 35, restriction: 35 });
    expect(failures).toEqual([]);
  });

  it('does not cite microsatellite markers outside a passage that names them', () => {
    const offContext = questions.filter(
      (question) =>
        /microsatellite/i.test(question.explanation) &&
        !/microsatellite/i.test(question.stimulus ?? '')
    );
    expect(offContext.map((question) => question.id)).toEqual([]);
  });

  it('does not use the broken vocabulary-gloss explanation template', () => {
    // The old WIC generator paired a vocabulary entry with whichever authored
    // sentence sat at the same index, producing explanations such as
    // "'avaricious' means greedy ... matches barely readable."
    const broken = questions.filter((question) =>
      /which matches the context:/i.test(question.explanation)
    );
    expect(broken.map((question) => question.id)).toEqual([]);
  });

  it('keeps every vocabulary blank separated from its surrounding words', () => {
    const tight = questions.filter(
      (question) =>
        question.id.startsWith('RW-CRF-') &&
        /[A-Za-z]_{2,}|_{2,}[A-Za-z]/.test(question.stimulus ?? '')
    );
    expect(tight.map((question) => question.id)).toEqual([]);
  });

  it('contains no malformed synthetic English rephrasings', () => {
    // The scale generator once emitted "these features operate by seawater
    // dissolves..." and giveaway distractors such as "modern electronic
    // sensors". The repaired template and this guard keep that class out.
    const malformed = /operate by \\w+ing|modern electronic sensors|mechanism of .* would fail/i;
    for (const question of questions) {
      const fields = [
        question.stimulus ?? '',
        question.prompt,
        question.explanation,
        ...(question.choices ?? []).map((choice) => choice.text),
      ];
      for (const text of fields) {
        expect(text, `${question.id} repeats a malformed scale template`).not.toMatch(malformed);
      }
    }
  });

  it('does not contain two identical items under different ids', () => {
    const seen = new Map<string, string>();
    for (const question of questions) {
      const signature = `${plain(question.stimulus)}|${plain(question.prompt)}`.toLowerCase();
      if (!plain(question.stimulus) && !plain(question.prompt)) continue;
      const previous = seen.get(signature);
      expect(previous, `${question.id} duplicates ${previous}`).toBeUndefined();
      seen.set(signature, question.id);
    }
  });
});
