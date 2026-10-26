/**
 * A real PDF score report.
 *
 * The browser's "print this page" path produced a screenshot of the app shell:
 * navigation, cards, buttons, and a score that depended on the window width.
 * This module writes a tagged PDF document directly, so the file is a page of
 * its own — US Letter, one clean column, no chrome — and it opens the same in
 * every viewer.
 *
 * No PDF dependency: the document uses only the two standard Helvetica faces
 * every reader ships, so there is nothing to download, nothing to licence, and
 * the output is deterministic for a given attempt (which is what lets the tests
 * assert byte offsets).
 */

import type { TestAttempt } from './types';

function clock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = String(safe % 60).padStart(2, '0');
  // A full simulation runs past an hour; 119:00 would read as nonsense.
  return safe >= 3600 ? `${Math.floor(safe / 3600)}:${String(minutes).padStart(2, '0')}:${rest}` : `${Math.floor(safe / 60)}:${rest}`;
}

// ---------------------------------------------------------------------------
// Page geometry (points, origin bottom-left)
// ---------------------------------------------------------------------------
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

type Font = 'regular' | 'bold';

const INK = '#14181f';
const BODY = '#3d4756';
const MUTED = '#5a6472';
const NAVY = '#1d3557';
const RULE = '#dfe3e8';
const PANEL = '#f4f7fb';
const PANEL_LINE = '#dbe3ec';
const TABLE_HEAD = '#eef2f7';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function rgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------
// Standard Helvetica advance widths, grouped. Accurate enough to break lines
// and right-align numbers; a report does not need glyph-hinted metrics.
const NARROW = new Set(['i', 'l', 'j', 't', 'f', 'r', 'I', '!', '|', "'", '.', ',', ':', ';', '(', ')', '[', ']']);

function charWidth(ch: string, font: Font): number {
  if (ch === ' ') return 0.278;
  if (ch === '-') return 0.333;
  if ('mwMW'.includes(ch)) return font === 'bold' ? 0.944 : 0.833;
  if (NARROW.has(ch)) return font === 'bold' ? 0.333 : 0.278;
  if (ch >= '0' && ch <= '9') return 0.556;
  if (ch >= 'A' && ch <= 'Z') return font === 'bold' ? 0.722 : 0.667;
  return font === 'bold' ? 0.556 : 0.5;
}

export function measureText(text: string, size: number, font: Font = 'regular'): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch, font);
  return total * size;
}

/** Greedy word wrap against a measured width in points. */
export function wrapText(text: string, maxWidth: number, size: number, font: Font = 'regular'): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measureText(candidate, size, font) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// Minimal content-stream writer
// ---------------------------------------------------------------------------
interface TextOptions {
  size?: number;
  font?: Font;
  color?: string;
}

class PageCanvas {
  private ops: string[] = [];

  rect(x: number, y: number, w: number, h: number, fill: string): void {
    const { r, g, b } = rgb(fill);
    this.ops.push(`${f(r)} ${f(g)} ${f(b)} rg ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`);
  }

  strokeRect(x: number, y: number, w: number, h: number, stroke: string, lineWidth = 0.8): void {
    const { r, g, b } = rgb(stroke);
    this.ops.push(
      `${f(r)} ${f(g)} ${f(b)} RG ${f(lineWidth)} w ${f(x)} ${f(y)} ${f(w)} ${f(h)} re S`
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: string, lineWidth = 0.7): void {
    const { r, g, b } = rgb(stroke);
    this.ops.push(`${f(r)} ${f(g)} ${f(b)} RG ${f(lineWidth)} w ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S`);
  }

  text(value: string, x: number, y: number, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const font = options.font ?? 'regular';
    const { r, g, b } = rgb(options.color ?? INK);
    this.ops.push(
      `BT /${font === 'bold' ? 'F2' : 'F1'} ${f(size)} Tf ${f(r)} ${f(g)} ${f(b)} rg 1 0 0 1 ${f(x)} ${f(y)} Tm (${escapeText(value)}) Tj ET`
    );
  }

  textRight(value: string, rightX: number, y: number, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    this.text(value, rightX - measureText(value, size, options.font ?? 'regular'), y, options);
  }

  content(): string {
    return this.ops.join('\n');
  }
}

function f(value: number): string {
  // Three decimals keeps the file small without visible rounding.
  return String(Math.round(value * 1000) / 1000);
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // WinAnsi-safe: the report reads the same in every viewer.
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00b7/g, '-')
    .replace(/[^\x20-\x7e]/g, '');
}

// ---------------------------------------------------------------------------
// Report layout
// ---------------------------------------------------------------------------
export interface ScoreReportInput {
  assessment: string;
  completedAt: string;
  durationSeconds: number;
  rwEstimate: number | null;
  mathEstimate: number | null;
  totalEstimate: number | null;
  modules: Array<{
    section: string;
    tier: 'module1' | 'upper' | 'lower';
    correct: number;
    total: number;
    operationalCorrect?: number;
    operationalTotal?: number;
  }>;
}

function tierLabel(tier: 'module1' | 'upper' | 'lower'): string {
  if (tier === 'module1') return 'Module 1 - Baseline';
  if (tier === 'upper') return 'Module 2 - Routed Upper';
  return 'Module 2 - Routed Lower';
}

function longDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function scoreOrDash(value: number | null): string {
  return value === null || value === undefined ? '--' : String(value);
}

function drawHeader(canvas: PageCanvas, assessment: string, input: ScoreReportInput): void {
  canvas.rect(0, PAGE_H - 52, PAGE_W, 52, NAVY);
  canvas.text('HDSAT', MARGIN, PAGE_H - 33, { size: 15, font: 'bold', color: '#ffffff' });
  canvas.textRight('PRACTICE SCORE REPORT', PAGE_W - MARGIN, PAGE_H - 31, {
    size: 8.5,
    font: 'bold',
    color: '#cfe0f5',
  });

  canvas.text('Practice Score Report', MARGIN, PAGE_H - 96, { size: 22, font: 'bold', color: INK });
  canvas.text(`${assessment}  -  ${longDate(input.completedAt)}  -  ${clock(input.durationSeconds)}`, MARGIN, PAGE_H - 116, {
    size: 9.5,
    color: MUTED,
  });
  canvas.line(MARGIN, PAGE_H - 132, PAGE_W - MARGIN, PAGE_H - 132, RULE);
}

function drawScorePanels(canvas: PageCanvas, input: ScoreReportInput): void {
  const gap = 12;
  const width = (CONTENT_W - gap * 2) / 3;
  const top = PAGE_H - 148;
  const height = 84;
  const panels: { label: string; range: string; value: string; accent: boolean }[] = [
    { label: 'Estimated Total', range: '400 - 1600', value: scoreOrDash(input.totalEstimate), accent: true },
    { label: 'Reading & Writing', range: '200 - 800', value: scoreOrDash(input.rwEstimate), accent: false },
    { label: 'Math', range: '200 - 800', value: scoreOrDash(input.mathEstimate), accent: false },
  ];

  panels.forEach((panel, index) => {
    const x = MARGIN + index * (width + gap);
    canvas.rect(x, top - height, width, height, panel.accent ? '#eaf0fb' : PANEL);
    canvas.strokeRect(x, top - height, width, height, panel.accent ? '#c3d3ee' : PANEL_LINE);
    canvas.text(panel.label.toUpperCase(), x + 12, top - 22, {
      size: 7.5,
      font: 'bold',
      color: panel.accent ? '#2b4a7d' : MUTED,
    });
    canvas.text(panel.value, x + 12, top - 56, {
      size: 26,
      font: 'bold',
      color: panel.accent ? NAVY : INK,
    });
    canvas.text(panel.range, x + 12, top - 72, { size: 7.5, color: MUTED });
  });
}

function drawModuleTable(canvas: PageCanvas, input: ScoreReportInput): number {
  let y = PAGE_H - 262;
  canvas.text('Module breakdown', MARGIN, y, { size: 12, font: 'bold', color: INK });
  y -= 20;

  canvas.rect(MARGIN, y - 5, CONTENT_W, 19, TABLE_HEAD);
  canvas.text('SECTION', MARGIN + 8, y, { size: 7.5, font: 'bold', color: MUTED });
  canvas.text('ADAPTIVE MODULE', MARGIN + 120, y, { size: 7.5, font: 'bold', color: MUTED });
  canvas.textRight('CORRECT', MARGIN + CONTENT_W - 96, y, { size: 7.5, font: 'bold', color: MUTED });
  canvas.textRight('ACCURACY', MARGIN + CONTENT_W - 8, y, { size: 7.5, font: 'bold', color: MUTED });
  y -= 22;

  if (input.modules.length === 0) {
    canvas.text('No modules were recorded for this run.', MARGIN + 8, y, { size: 9, color: MUTED });
    return y - 26;
  }

  for (const module of input.modules) {
    const correct = module.operationalCorrect ?? module.correct;
    const total = module.operationalTotal ?? module.total;
    const accuracy = total > 0 ? `${Math.round((correct / total) * 100)}%` : '--';
    canvas.text(module.section, MARGIN + 8, y, { size: 9.5, color: INK });
    canvas.text(tierLabel(module.tier), MARGIN + 120, y, { size: 9.5, color: BODY });
    canvas.textRight(`${correct} / ${total}`, MARGIN + CONTENT_W - 96, y, { size: 9.5, color: INK });
    canvas.textRight(accuracy, MARGIN + CONTENT_W - 8, y, { size: 9.5, color: INK });
    y -= 20;
    canvas.line(MARGIN, y + 7, PAGE_W - MARGIN, y + 7, '#eef1f5', 0.6);
  }
  return y - 6;
}

function drawNotes(canvas: PageCanvas, input: ScoreReportInput, startY: number): void {
  let y = startY - 14;
  canvas.text('How this estimate works', MARGIN, y, { size: 10.5, font: 'bold', color: INK });
  y -= 16;

  const notes = [
    'Scores come from raw module accuracy, routed through the adaptive Stage-2 tier this run produced. They are a practice estimate for the 400-1600 scale, not an official College Board score.',
    'Eight unscored experimental items per simulation are excluded from the module accuracy shown above, exactly as in the operational blueprint.',
  ];
  if (input.modules.some((m) => m.operationalTotal !== undefined && m.operationalTotal !== m.total)) {
    notes.push('Where "correct" is lower than the module total, the difference is those unscored items.');
  }

  for (const note of notes) {
    for (const line of wrapText(note, CONTENT_W, 9.5)) {
      canvas.text(line, MARGIN, y, { size: 9.5, color: BODY });
      y -= 13;
    }
    y -= 4;
  }
}

/**
 * The host the report was produced on, without a scheme. A printed page should
 * say where it came from, and reading it from the page means a build served
 * from anywhere (the hosted app, a local copy, an installed app) is correct
 * without a hard-coded domain.
 */
function reportHost(): string {
  if (typeof window === 'undefined') return 'HDSAT';
  const host = window.location.host;
  return host || 'HDSAT';
}

function drawFooter(canvas: PageCanvas, generatedAt: string): void {
  canvas.line(MARGIN, 62, PAGE_W - MARGIN, 62, RULE);
  canvas.text(`Generated ${longDate(generatedAt)} - HDSAT - ${reportHost()}`, MARGIN, 48, {
    size: 7.5,
    color: MUTED,
  });
  canvas.textRight('Not an official College Board score', PAGE_W - MARGIN, 48, {
    size: 7.5,
    color: MUTED,
  });
  canvas.textRight('Page 1 of 1', PAGE_W - MARGIN, 36, { size: 7.5, color: MUTED });
}

/**
 * Builds the report bytes. `now` is injected so tests can pin the footer date.
 */
export function buildScoreReportPdf(input: ScoreReportInput, now: Date = new Date()): Uint8Array {
  const canvas = new PageCanvas();
  drawHeader(canvas, input.assessment, input);
  drawScorePanels(canvas, input);
  const afterTable = drawModuleTable(canvas, input);
  drawNotes(canvas, input, afterTable);
  drawFooter(canvas, now.toISOString());
  return assemblePdf(canvas.content());
}

/** Wraps one content stream in the four objects a single-page PDF needs. */
export function assemblePdf(stream: string): Uint8Array {
  // WinAnsi bytes only; the stream is ASCII after escapeText().
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /ProcSet [/PDF /Text] >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------
export function reportInputFromAttempt(attempt: TestAttempt): ScoreReportInput {
  return {
    assessment: attempt.assessment,
    completedAt: attempt.createdAt,
    durationSeconds: attempt.durationSeconds ?? 0,
    rwEstimate: attempt.rwEstimate,
    mathEstimate: attempt.mathEstimate,
    totalEstimate: attempt.totalEstimate,
    modules: (attempt.modules ?? []).map((module) => ({
      section: module.section,
      tier: module.tier,
      correct: module.correct,
      total: module.total,
      operationalCorrect: module.operationalCorrect,
      operationalTotal: module.operationalTotal,
    })),
  };
}

export function scoreReportFileName(attempt: TestAttempt): string {
  const date = new Date(attempt.createdAt);
  const stamp = Number.isNaN(date.getTime())
    ? 'report'
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
      ).padStart(2, '0')}`;
  return `HDSAT-score-report-${stamp}.pdf`;
}

/** Hands the bytes to the browser as a download. No print dialog involved. */
export function downloadScoreReport(attempt: TestAttempt, now: Date = new Date()): string {
  const bytes = buildScoreReportPdf(reportInputFromAttempt(attempt), now);
  const fileName = scoreReportFileName(attempt);
  // Copy into a plain ArrayBuffer: BlobPart rejects the SharedArrayBuffer
  // possibility that Uint8Array's generic carries in newer TypeScript.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so Safari has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return fileName;
}
