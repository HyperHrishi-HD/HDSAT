import type { TestAttempt } from './types';

/**
 * Shareable practice results.
 *
 * A shared link carries only what the score card shows: assessment, date,
 * section estimates, raw totals and per-module counts. No name, email, user id,
 * question ids, answers or explanations ever enter the payload, and the link is
 * self-contained so it needs no server, no account and no public row in the
 * database. The decoder validates every field it reads, so a hand-edited link
 * can only produce a plain score card — never markup or an unbounded render.
 */

export const SHARE_VERSION = 1;
export const MAX_SHARE_CODE_LENGTH = 1200;

export interface SharedModule {
  section: 'Reading and Writing' | 'Math';
  tier: 'module1' | 'upper' | 'lower';
  correct: number;
  total: number;
}

export interface SharedTestSummary {
  version: number;
  assessment: string;
  date: string;
  rw: number | null;
  math: number | null;
  total: number | null;
  rawCorrect: number;
  rawTotal: number;
  modules: SharedModule[];
}

const ASSESSMENTS = ['SAT', 'PSAT/NMSQT', 'PSAT 10', 'PSAT 8/9'];

function clampInt(value: unknown, min: number, max: number): number {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function optionalScore(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export function buildSharedSummary(attempt: TestAttempt): SharedTestSummary {
  const modules: SharedModule[] = attempt.modules.slice(0, 6).map((module) => ({
    section: module.section === 'Math' ? 'Math' : 'Reading and Writing',
    tier: module.tier === 'upper' ? 'upper' : module.tier === 'lower' ? 'lower' : 'module1',
    correct: clampInt(module.operationalCorrect ?? module.correct, 0, 300),
    total: clampInt(module.operationalTotal ?? module.total, 0, 300),
  }));
  const rawCorrect = modules.reduce((sum, module) => sum + module.correct, 0);
  const rawTotal = modules.reduce((sum, module) => sum + module.total, 0);
  return {
    version: SHARE_VERSION,
    assessment: ASSESSMENTS.includes(attempt.assessment) ? attempt.assessment : 'SAT',
    date: attempt.createdAt.slice(0, 10),
    rw: optionalScore(attempt.rwEstimate, 200, 800),
    math: optionalScore(attempt.mathEstimate, 200, 800),
    total: optionalScore(attempt.totalEstimate, 400, 1600),
    rawCorrect,
    rawTotal,
    modules,
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string | null {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeSharedSummary(summary: SharedTestSummary): string {
  return toBase64Url(JSON.stringify(summary));
}

/** Returns null for anything that is not a well-formed summary. */
export function decodeSharedSummary(code: string | null | undefined): SharedTestSummary | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SHARE_CODE_LENGTH) return null;
  const json = fromBase64Url(trimmed);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as Record<string, unknown>;
  if (Number(raw.version) !== SHARE_VERSION) return null;

  const modulesRaw = Array.isArray(raw.modules) ? raw.modules.slice(0, 6) : [];
  const modules: SharedModule[] = modulesRaw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      section: entry.section === 'Math' ? 'Math' : 'Reading and Writing',
      tier:
        entry.tier === 'upper' ? 'upper' : entry.tier === 'lower' ? 'lower' : 'module1',
      correct: clampInt(entry.correct, 0, 300),
      total: clampInt(entry.total, 0, 300),
    }));

  const total = optionalScore(raw.total, 400, 1600);
  const rw = optionalScore(raw.rw, 200, 800);
  const math = optionalScore(raw.math, 200, 800);
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : '';

  return {
    version: SHARE_VERSION,
    assessment:
      typeof raw.assessment === 'string' && ASSESSMENTS.includes(raw.assessment)
        ? raw.assessment
        : 'SAT',
    date,
    rw,
    math,
    total,
    rawCorrect: clampInt(raw.rawCorrect, 0, 500),
    rawTotal: clampInt(raw.rawTotal, 0, 500),
    modules,
  };
}

export function shareUrl(code: string, origin: string, pathname: string): string {
  return `${origin}${pathname}#/test?share=${code}`;
}

/** Downloads any plain object as pretty JSON. No-ops outside a browser. */
export function downloadJson(payload: unknown, fileName: string): string {
  const json = JSON.stringify(payload, null, 2);
  if (typeof document === 'undefined') return fileName;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return fileName;
}

export function reportFileName(attempt: TestAttempt): string {
  return `hdsat-score-report-${attempt.assessment.replace(/[^a-zA-Z0-9]+/g, '-')}-${attempt.createdAt.slice(0, 10)}.json`;
}
