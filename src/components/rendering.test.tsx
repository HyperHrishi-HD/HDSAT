import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import bankJson from '../data/questionBank.json';
import type { Question, QuestionBank } from '../lib/types';
import { FigureView, StimulusView } from './FigureView';
import { MathText } from './MathText';

const bank = bankJson as unknown as QuestionBank;
const figureQuestions = bank.questions.filter((q) => Boolean(q.figure_metadata));

describe('figure rendering', () => {
  it('covers every figure-bearing item in the bank', () => {
    expect(figureQuestions.length).toBeGreaterThan(200);
  });

  it('renders a bordered data table for every table item', () => {
    const tables = figureQuestions.filter(
      (q) => (q.figure_metadata as { type?: string }).type === 'table'
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const q of tables) {
      const meta = q.figure_metadata as { headers: string[]; rows: string[][]; caption?: string };
      const html = renderToStaticMarkup(<FigureView question={q} />);
      expect(html, q.id).toContain('<table');
      expect(html, q.id).toContain('figure-table');
      expect(html, q.id).toContain(meta.headers[0]);
      expect(html, q.id).toContain(meta.rows[0][0]);
      if (meta.caption) expect(html, q.id).toContain(meta.caption);
    }
  });

  it('renders an SVG chart with axes and data marks for every chart item', () => {
    const charts = figureQuestions.filter((q) =>
      ['bar_chart', 'line_chart'].includes(
        (q.figure_metadata as { type?: string }).type ?? ''
      )
    );
    expect(charts.length).toBeGreaterThan(0);
    for (const q of charts) {
      const meta = q.figure_metadata as {
        type: 'bar_chart' | 'line_chart';
        series: { label: string; value: number }[];
      };
      const html = renderToStaticMarkup(<FigureView question={q} />);
      expect(html, q.id).toContain('<svg');
      expect(html, q.id).not.toContain('NaN');
      if (meta.type === 'bar_chart') expect(html, q.id).toContain('<rect');
      else expect(html, q.id).toContain('<polyline');
      expect(html, q.id).toContain(meta.series[0].label.slice(0, 10));
    }
  });

  it('renders nothing for items without figures', () => {
    const plain = bank.questions.find((q) => !q.figure_metadata) as Question;
    expect(renderToStaticMarkup(<FigureView question={plain} />)).toBe('');
  });
});

describe('stimulus rendering', () => {
  it('renders rhetorical-synthesis notes as real bullet lists', () => {
    const q = bank.questions.find((item) => (item.stimulus ?? '').includes('•')) as Question;
    const html = renderToStaticMarkup(<StimulusView stimulus={q.stimulus} />);
    expect(html).toContain('<ul');
    expect(html).toContain('<li>');
    expect(html).not.toContain('•');
  });

  it('renders cross-text headings in bold', () => {
    const q = bank.questions.find((item) => /(^|\n)Text 1(\n|$)/.test(item.stimulus ?? '')) as Question;
    const html = renderToStaticMarkup(<StimulusView stimulus={q.stimulus} />);
    expect(html).toContain('stimulus-text-heading');
    expect(html).toContain('<strong>Text 1</strong>');
  });

  it('renders nothing for an empty stimulus', () => {
    expect(renderToStaticMarkup(<StimulusView stimulus={null} />)).toBe('');
    expect(renderToStaticMarkup(<StimulusView stimulus="   " />)).toBe('');
  });
});

describe('mixed math and currency rendering', () => {
  const html = (text: string) => renderToStaticMarkup(<MathText text={text} />);

  it('renders dollar amounts as text instead of swallowing them as LaTeX', () => {
    const out = html('A repair shop raises the price of a tune-up from $40 by 20$\\%$.');
    expect(out).toContain('$40 by 20');
    expect(out).toContain('katex');
    expect(out).not.toContain('$\\%$');
  });

  it('renders math delimiters without leaking dollar signs', () => {
    const out = html('What is the value of $t$ when $W = 195$?');
    expect(out).toContain('katex');
    expect(out).not.toContain('$t$');
    expect(out).not.toContain('$W');
  });

  it('renders escaped currency inside math', () => {
    const out = html('The list price was $\\$650$ before tax.');
    expect(out).toContain('katex');
    expect(out).not.toContain('$\\$650$');
  });
});
