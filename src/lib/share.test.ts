/**
 * Shared result links are public URLs, so their payload and parser are a
 * security boundary: they must round-trip exactly, reject anything malformed,
 * and never carry identity or answer-key data. The AI snapshot gets the same
 * scrutiny because students paste it into third-party tools.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SHARE_CODE_LENGTH,
  buildSharedSummary,
  decodeSharedSummary,
  encodeSharedSummary,
  reportFileName,
  shareUrl,
} from './testShare';
import { buildAiSnapshot } from './dataRights';
import type { TestAttempt } from './types';

const attempt = {
  id: 'attempt-1',
  assessment: 'SAT',
  createdAt: '2026-10-22T09:30:00.000Z',
  status: 'completed',
  rwEstimate: 720,
  mathEstimate: 750,
  totalEstimate: 1470,
  modules: [
    { moduleId: 'rw-1', section: 'Reading and Writing', tier: 'module1', correct: 20, total: 27 },
    {
      moduleId: 'rw-2',
      section: 'Reading and Writing',
      tier: 'upper',
      correct: 18,
      operationalCorrect: 17,
      total: 27,
      operationalTotal: 25,
    },
    { moduleId: 'm-1', section: 'Math', tier: 'module1', correct: 18, total: 22 },
    { moduleId: 'm-2', section: 'Math', tier: 'upper', correct: 16, total: 22 },
  ],
} as unknown as TestAttempt;

const toB64Url = (text: string): string =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64Url = (code: string): string => {
  const padded = code.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
};

describe('shareable score summaries', () => {
  it('round-trips a completed attempt exactly', () => {
    const summary = buildSharedSummary(attempt);
    const decoded = decodeSharedSummary(encodeSharedSummary(summary));
    expect(decoded).toEqual(summary);
    expect(decoded?.total).toBe(1470);
    expect(decoded?.modules).toHaveLength(4);
  });

  it('uses operational counts when a module tracks unscored items', () => {
    const summary = buildSharedSummary(attempt);
    const routed = summary.modules[1];
    expect(routed.correct).toBe(17);
    expect(routed.total).toBe(25);
  });

  it('carries no identity, question ids, answers or explanations', () => {
    const code = encodeSharedSummary(buildSharedSummary(attempt));
    const json = fromB64Url(code);
    expect(json).not.toContain('@');
    expect(json).not.toContain('correct_answer');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('attempt-1');
    expect(json).not.toContain('RW-');
  });

  it('rejects malformed, oversized and wrong-version codes', () => {
    expect(decodeSharedSummary(null)).toBeNull();
    expect(decodeSharedSummary('')).toBeNull();
    expect(decodeSharedSummary('not-a-real-code')).toBeNull();
    expect(decodeSharedSummary('x'.repeat(MAX_SHARE_CODE_LENGTH + 1))).toBeNull();

    const wrongVersion = toB64Url(JSON.stringify({ version: 99, total: 1500 }));
    expect(decodeSharedSummary(wrongVersion)).toBeNull();

    const notJson = toB64Url('hello there');
    expect(decodeSharedSummary(notJson)).toBeNull();
  });

  it('clamps hand-edited values into the real ranges instead of rendering them', () => {
    const tampered = toB64Url(
      JSON.stringify({
        version: 1,
        assessment: '<script>alert(1)</script>',
        date: 'not-a-date',
        rw: 99999,
        math: -50,
        total: 123456,
        rawCorrect: 9999,
        rawTotal: 9999,
        modules: [{ section: 'Hacked', tier: 'nope', correct: 9999, total: 9999 }],
      })
    );
    const decoded = decodeSharedSummary(tampered);
    expect(decoded).not.toBeNull();
    expect(decoded?.assessment).toBe('SAT');
    expect(decoded?.date).toBe('');
    expect(decoded?.rw).toBe(800);
    expect(decoded?.math).toBe(200);
    expect(decoded?.total).toBe(1600);
    expect(decoded?.rawCorrect).toBeLessThanOrEqual(500);
    expect(decoded?.modules[0].section).toBe('Reading and Writing');
    expect(decoded?.modules[0].tier).toBe('module1');
  });

  it('builds a link that reloads the same report', () => {
    const code = encodeSharedSummary(buildSharedSummary(attempt));
    const url = shareUrl(code, 'https://example.com', '/');
    expect(url.startsWith('https://example.com/#/test?share=')).toBe(true);
    expect(decodeSharedSummary(url.split('share=')[1])?.total).toBe(1470);
  });

  it('names the downloaded report safely', () => {
    expect(reportFileName(attempt)).toBe('hdsat-score-report-SAT-2026-10-22.json');
  });
});

describe('AI account snapshot', () => {
  const input = {
    user: { id: 'u-1', email: 'student@example.com', displayName: 'Hrishi' },
    mode: 'cloud' as const,
    assessment: 'SAT',
    account: {
      hdCoins: 240,
      currentStreak: 4,
      bestStreak: 11,
      achievements: ['first-steps'],
      ownedItems: ['classic-blue'],
      settings: { assessment: 'SAT' },
    },
    totals: { attempts: 40, correct: 28, accuracy: 0.7, mastered: 9, dueCards: 3 },
    progress: {
      'RW-INF-001': {
        attemptCount: 4,
        correctCount: 1,
        lastIsCorrect: false,
        status: 'incorrect',
      },
      'MATH-ALG-001': {
        attemptCount: 3,
        correctCount: 3,
        lastIsCorrect: true,
        status: 'mastered',
      },
    },
    questions: [
      {
        id: 'RW-INF-001',
        section: 'Reading and Writing',
        domain: 'Information and Ideas',
        skill: 'Inferences',
        difficulty: 'Hard',
        prompt: 'Which choice best states the main idea?',
      },
      {
        id: 'MATH-ALG-001',
        section: 'Math',
        domain: 'Algebra',
        skill: 'Linear equations',
        difficulty: 'Easy',
        prompt: 'Solve 2x = 10.',
      },
    ],
    saved: ['MATH-ALG-001'],
    flashcardProgress: { 'vocab-abate': { nextDueAt: '2020-01-01T00:00:00.000Z' } },
    testAttempts: [
      {
        id: 't-1',
        assessment: 'SAT',
        createdAt: '2026-10-22T09:30:00.000Z',
        status: 'completed',
        rwEstimate: 720,
        mathEstimate: 750,
        totalEstimate: 1470,
        modules: [{ section: 'Math', tier: 'upper', correct: 16, total: 22 }],
      },
    ],
    dailyActivity: [
      { date: '2026-10-22', questionsCompleted: 12, correctQuestions: 9, coinsEarned: 14 },
    ],
  };

  it('describes domain and skill accuracy, including the weakest skills', () => {
    const snapshot = buildAiSnapshot(input, new Date('2026-10-22T12:00:00Z'));
    const info = snapshot.data.domains.find((d) => d.domain === 'Information and Ideas');
    expect(info?.accuracy_pct).toBe(25);
    expect(info?.attempted).toBe(4);
    expect(snapshot.data.weakest_skills[0]).toMatchObject({
      skill: 'Inferences',
      accuracy_pct: 25,
      attempted: 4,
    });
    expect(snapshot.data.weakest_skills.map((s) => s.skill)).not.toContain('Linear equations');
  });

  it('lists missed items without any answer key, explanation or email address', () => {
    const snapshot = buildAiSnapshot(input, new Date('2026-10-22T12:00:00Z'));
    expect(snapshot.data.missed_items).toHaveLength(1);
    expect(snapshot.data.missed_items[0].id).toBe('RW-INF-001');
    expect(snapshot.data.missed_items[0].prompt).toContain('main idea');
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('correct_answer');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('distractor_rationales');
    expect(json).not.toContain('student@example.com');
    expect(json).toContain('Hrishi');
    expect(snapshot.data.flashcards.due_now).toBe(1);
    expect(snapshot.data.tests).toHaveLength(1);
  });

  it('is an instruction payload sized for a chat window', () => {
    const snapshot = buildAiSnapshot(input, new Date('2026-10-22T12:00:00Z'));
    expect(snapshot.schema_version).toBe('2.0');
    expect(snapshot.role).toMatch(/SAT tutor/i);
    expect(snapshot.requested_output.tasks).toHaveLength(3);
    expect(snapshot.requested_output.constraints.join(' ')).toMatch(/thin evidence/i);
    expect(JSON.stringify(snapshot, null, 2).length).toBeLessThan(15000);
  });

  it('dense last-14-days window ends today, oldest first, empty days included', () => {
    const snapshot = buildAiSnapshot(input, new Date('2026-10-22T12:00:00Z'));
    const days = snapshot.data.last_14_days;
    expect(days).toHaveLength(14);
    expect(days[13].date).toBe('2026-10-22');
    expect(days[13].questions).toBe(12);
    expect(days[0].questions).toBe(0);
    expect(days.map((d) => d.date)).toEqual([...days.map((d) => d.date)].sort());
  });

  it('is deterministic for the same input', () => {
    const at = new Date('2026-10-22T12:00:00Z');
    expect(buildAiSnapshot(input, at)).toEqual(buildAiSnapshot(input, at));
  });
});
