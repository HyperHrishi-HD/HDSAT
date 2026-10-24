import { describe, expect, it } from 'vitest';
import {
  assemblePdf,
  buildScoreReportPdf,
  measureText,
  reportInputFromAttempt,
  scoreReportFileName,
  wrapText,
  type ScoreReportInput,
} from './scoreReportPdf';
import type { TestAttempt, TestModuleResult } from './types';

const FIXED_NOW = new Date('2026-10-31T09:00:00.000Z');

function moduleResult(overrides: Partial<TestModuleResult> = {}): TestModuleResult {
  return {
    moduleId: 'm1',
    section: 'Reading and Writing',
    tier: 'module1',
    correct: 21,
    total: 27,
    operationalCorrect: 19,
    operationalTotal: 25,
    timedOut: false,
    responses: [],
    ...overrides,
  };
}

function input(overrides: Partial<ScoreReportInput> = {}): ScoreReportInput {
  return {
    assessment: 'SAT',
    completedAt: '2026-10-30T14:05:00.000Z',
    durationSeconds: 7_140,
    rwEstimate: 610,
    mathEstimate: 640,
    totalEstimate: 1250,
    modules: [
      moduleResult(),
      moduleResult({ moduleId: 'm2', tier: 'upper', correct: 24, total: 27, operationalCorrect: 22 }),
      moduleResult({ moduleId: 'm3', section: 'Math', tier: 'module1', correct: 17, total: 22, operationalCorrect: 15 }),
      moduleResult({ moduleId: 'm4', section: 'Math', tier: 'lower', correct: 19, total: 22, operationalCorrect: 18 }),
    ],
    ...overrides,
  };
}

function asText(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

describe('score report PDF', () => {
  it('writes a complete, well-formed PDF envelope', () => {
    const text = asText(buildScoreReportPdf(input(), FIXED_NOW));
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Page');
    expect(text).toContain('/BaseFont /Helvetica-Bold');
  });

  it('points every xref entry at its object and gets /Length right', () => {
    const text = asText(buildScoreReportPdf(input(), FIXED_NOW));
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    expect(Number.isFinite(startxref)).toBe(true);

    const xref = text.slice(startxref).split('\n');
    expect(xref[0]).toBe('xref');
    expect(xref[1]).toBe('0 7');

    const entries = xref.slice(2, 9);
    expect(entries[0].startsWith('0000000000 65535 f')).toBe(true);
    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      // The object header must sit exactly at the recorded byte offset.
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });

    const length = Number(/\/Length (\d+) >>\nstream\n/.exec(text)?.[1]);
    const streamStart = text.indexOf('stream\n') + 'stream\n'.length;
    const streamEnd = text.indexOf('\nendstream');
    expect(length).toBe(streamEnd - streamStart);
  });

  it('puts the real scores and module rows in the document', () => {
    const text = asText(buildScoreReportPdf(input(), FIXED_NOW));
    expect(text).toContain('(Practice Score Report) Tj');
    expect(text).toContain('(1250) Tj');
    expect(text).toContain('(610) Tj');
    expect(text).toContain('(640) Tj');
    expect(text).toContain('(Module 1 - Baseline) Tj');
    expect(text).toContain('(Module 2 - Routed Upper) Tj');
    expect(text).toContain('(22 / 25) Tj');
    expect(text).toContain('(88%) Tj');
    expect(text).toContain('Not an official College Board score');
  });

  it('shows a dash for a run with no estimate instead of the word null', () => {
    const text = asText(
      buildScoreReportPdf(input({ rwEstimate: null, mathEstimate: null, totalEstimate: null }), FIXED_NOW)
    );
    expect(text).toContain('(--) Tj');
    expect(text).not.toContain('null');
  });

  it('escapes parentheses and strips glyphs WinAnsi viewers choke on', () => {
    const text = asText(buildScoreReportPdf(input({ assessment: 'SAT (Practice) \u2014 PSAT' }), FIXED_NOW));
    expect(text).toContain('(SAT \\(Practice\\) - PSAT');
    // No raw em dash: it was normalised to ASCII before wrapping the string.
    expect(text).not.toContain('\u2014');
  });

  it('wraps a paragraph inside its measured column', () => {
    const paragraph =
      'Scores come from raw module accuracy, routed through the adaptive Stage-2 tier this run produced. They are a practice estimate.';
    const lines = wrapText(paragraph, 200, 9.5);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, 9.5)).toBeLessThanOrEqual(200);
    }
    expect(lines.join(' ')).toBe(paragraph);
  });

  it('measures bold wider than regular', () => {
    expect(measureText('Practice Score Report', 12, 'bold')).toBeGreaterThan(
      measureText('Practice Score Report', 12, 'regular')
    );
  });

  it('keeps a report with no modules readable rather than empty', () => {
    const text = asText(buildScoreReportPdf(input({ modules: [] }), FIXED_NOW));
    expect(text).toContain('(No modules were recorded for this run.) Tj');
  });

  it('names the file from the attempt date', () => {
    const attempt = {
      id: 'a1',
      assessment: 'SAT',
      status: 'completed',
      createdAt: '2026-03-04T10:00:00.000Z',
      modules: [],
      rwEstimate: 500,
      mathEstimate: 500,
      totalEstimate: 1000,
      durationSeconds: 100,
    } as TestAttempt;
    expect(scoreReportFileName(attempt)).toBe('HDSAT-score-report-2026-03-04.pdf');
    expect(reportInputFromAttempt(attempt).totalEstimate).toBe(1000);
  });

  it('assembles arbitrary streams without corrupting offsets', () => {
    const text = asText(assemblePdf('BT /F1 12 Tf (x) Tj ET'));
    expect(text).toContain('/Length 22 >>\nstream\nBT /F1 12 Tf (x) Tj ET\nendstream');
  });
});
