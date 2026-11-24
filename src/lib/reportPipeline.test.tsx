import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import { FigureView, StimulusView } from '../components/FigureView';
import { MathText, parseRichText } from '../components/MathText';
import { checkAnswer } from './grading';
import type { Question, QuestionBank } from './types';

const bank = bankJson as unknown as QuestionBank;
const questions = bank.questions;

function get(id: string): Question {
  const question = questions.find((item) => item.id === id);
  if (!question) throw new Error(`missing ${id}`);
  return question;
}

function wrongChoice(question: Question): string {
  const id = (question.choices ?? []).find((choice) => choice.id !== question.correct_answer)?.id;
  if (!id) throw new Error(`${question.id} has no wrong choice`);
  return id;
}

function tableRows(question: Question): number[][] {
  const meta = question.figure_metadata as { rows?: string[][] } | null;
  if (!meta?.rows) throw new Error(`${question.id} has no table`);
  return meta.rows.map((row) => row.map(Number));
}

function keyValue(question: Question): number {
  const key = (question.choices ?? []).find((choice) => choice.id === question.correct_answer);
  if (!key) throw new Error(`${question.id} key is not a choice`);
  return Number(key.text);
}

function chartValues(question: Question): { label: string; value: number }[] {
  const meta = question.figure_metadata as { series?: { label: string; value: number }[] } | null;
  if (!meta?.series) throw new Error(`${question.id} has no chart series`);
  return meta.series;
}

describe('reported repair items through the runtime pipeline', () => {
  it('grades the three P0 items for the intended key and against the old answer', () => {
    const fieldStation = get('RW-SEC-9003');
    expect(checkAnswer(fieldStation, 'C')).toBe(true);
    // The old keyed choice was the semicolon; it is now choice A.
    expect(checkAnswer(fieldStation, 'A')).toBe(false);
    expect(checkAnswer(fieldStation, wrongChoice(fieldStation))).toBe(false);

    const assumptions = get('RW-SEC-9033');
    expect(checkAnswer(assumptions, 'C')).toBe(true);
    // The old keyed dash was choice B.
    expect(checkAnswer(assumptions, 'B')).toBe(false);

    const copper = get('RW-SEC-89358');
    expect(checkAnswer(copper, 'C')).toBe(true);
    expect(copper.choices?.some((choice) => /without recutting/i.test(choice.text))).toBe(false);
    for (const choice of copper.choices ?? []) {
      if (choice.id !== copper.correct_answer) expect(checkAnswer(copper, choice.id)).toBe(false);
    }
  });

  it('renders and grades all completion prompts, including the 88 repaired, with a real blank', () => {
    const completion = questions.filter(
      (question) =>
        question.skill === 'Inferences' &&
        /completes?\s+the\s+text/i.test(question.prompt)
    );
    expect(completion.length).toBeGreaterThanOrEqual(88);
    for (const question of completion) {
      expect(question.stimulus, `${question.id} has no blank`).toMatch(/_{2,}/);
      const html = renderToStaticMarkup(<StimulusView stimulus={question.stimulus} />);
      expect(html, `${question.id} did not render a blank`).toMatch(/_{2,}/);
      expect(checkAnswer(question, question.correct_answer), `${question.id} key does not grade`).toBe(
        true
      );
      expect(checkAnswer(question, wrongChoice(question)), `${question.id} accepts a distractor`).toBe(
        false
      );
    }
  });

  it('renders every cross-text item as two line-start headings', () => {
    const crossText = questions.filter((question) => question.skill === 'Cross-Text Connections');
    expect(crossText).toHaveLength(86);
    for (const question of crossText) {
      expect(question.stimulus, `${question.id} headings are not line-start`).toMatch(
        /(^|\n)Text 1\n[\s\S]*(^|\n)Text 2\n/
      );
      const html = renderToStaticMarkup(<StimulusView stimulus={question.stimulus} />);
      expect(html, `${question.id} is missing Text 1 heading`).toContain('<strong>Text 1</strong>');
      expect(html, `${question.id} is missing Text 2 heading`).toContain('<strong>Text 2</strong>');
      expect(
        (html.match(/stimulus-text-heading/g) ?? []).length,
        `${question.id} did not render exactly two headings`
      ).toBe(2);
    }
  });

  it('validates the generated M13 table and chart families and recomputes their keys', () => {
    const linear = questions.filter((question) => /^M13-DATA-T\d{3}$/.test(question.id));
    for (const question of linear) {
      const rows = tableRows(question);
      expect(rows.length, question.id).toBeGreaterThanOrEqual(2);
      const [x1, y1] = rows[0];
      const [x2, y2] = rows[1];
      const slope = (y2 - y1) / (x2 - x1);
      const intercept = y1 - slope * x1;
      expect(keyValue(question), `${question.id} f(9)`).toBe(slope * 9 + intercept);
      expect(checkAnswer(question, question.correct_answer), `${question.id} key`).toBe(true);
      expect(checkAnswer(question, wrongChoice(question)), `${question.id} distractor`).toBe(false);
      expect(renderToStaticMarkup(<FigureView question={question} />)).toContain('<table');
    }

    const exponential = questions.filter((question) => /^M13-DATA-E\d{3}$/.test(question.id));
    for (const question of exponential) {
      const rows = tableRows(question);
      expect(rows.length, question.id).toBeGreaterThanOrEqual(2);
      const factor = rows[1][1] / rows[0][1];
      expect(keyValue(question), `${question.id} factor`).toBe(factor);
      expect(checkAnswer(question, question.correct_answer), `${question.id} key`).toBe(true);
      expect(checkAnswer(question, wrongChoice(question)), `${question.id} distractor`).toBe(false);
      expect(renderToStaticMarkup(<FigureView question={question} />)).toContain('<table');
    }

    const barCharts = questions.filter((question) => /^M13-DATA-B\d{3}$/.test(question.id));
    for (const question of barCharts) {
      const match = /in (.+?) than in (.+?)\?/.exec(question.prompt);
      expect(match, `${question.id} prompt shape`).not.toBeNull();
      const series = chartValues(question);
      const high = series.find((point) => point.label === match?.[1])?.value;
      const low = series.find((point) => point.label === match?.[2])?.value;
      expect(high, `${question.id} high category`).toBeDefined();
      expect(low, `${question.id} low category`).toBeDefined();
      expect(keyValue(question), `${question.id} difference`).toBe((high ?? 0) - (low ?? 0));
      expect(checkAnswer(question, question.correct_answer), `${question.id} key`).toBe(true);
      expect(checkAnswer(question, wrongChoice(question)), `${question.id} distractor`).toBe(false);
      const html = renderToStaticMarkup(<FigureView question={question} />);
      expect(html, `${question.id} chart`).toContain('<svg');
      expect(html, `${question.id} chart`).not.toContain('NaN');
    }
  });

  it('renders escaped currency spans as text rather than KaTeX math', () => {
    const currency = [
      'RW-M17-CT001',
      'RW-M17-CT002',
      'RW-M24-CI002',
      'RW-M24-INF002',
      'RW-M24-TS002',
    ].map(get);
    for (const question of currency) {
      expect(question.stimulus, `${question.id} lost its currency escape`).toContain('\\$');
      const tokens = parseRichText(question.stimulus ?? '');
      expect(tokens.every((token) => token.type === 'text'), `${question.id} parsed currency as math`).toBe(
        true
      );
      const html = renderToStaticMarkup(<MathText text={question.stimulus ?? ''} />);
      expect(html, `${question.id} currency`).toContain('$');
      expect(html, `${question.id} currency`).not.toContain('katex');
    }
  });
});
