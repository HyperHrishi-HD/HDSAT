/**
 * Deleting a saved simulation must leave exactly one thing behind: its score.
 * per-item detail is what the student asked to remove, so it must not survive
 * anywhere in the local profile.
 */
import { describe, expect, it } from 'vitest';
import { deleteTestAttempt, emptyProfile } from './storage';
import type { TestAttempt } from './types';

function attempt(overrides: Partial<TestAttempt> = {}): TestAttempt {
  return {
    id: 'run-1',
    assessment: 'SAT',
    status: 'completed',
    createdAt: '2026-10-27T10:00:00.000Z',
    modules: [
      {
        moduleId: 'rw-1',
        section: 'Reading and Writing',
        tier: 'module1',
        correct: 21,
        total: 27,
        timedOut: false,
        responses: [{ questionId: 'q1', response: 'B', isCorrect: true }],
      },
    ],
    rwEstimate: 620,
    mathEstimate: 590,
    totalEstimate: 1210,
    durationSeconds: 6300,
    ...overrides,
  };
}

describe('deleting a simulation', () => {
  it('removes the run and keeps one score line', () => {
    const profile = { ...emptyProfile(), testAttempts: [attempt()] };
    const result = deleteTestAttempt(profile, 'run-1');

    expect(result.profile.testAttempts).toHaveLength(0);
    expect(result.profile.testScoreLog).toHaveLength(1);
    expect(result.entry).toEqual({
      id: 'run-1',
      createdAt: '2026-10-27T10:00:00.000Z',
      assessment: 'SAT',
      total: 1210,
      rw: 620,
      math: 590,
      rawCorrect: 21,
      rawTotal: 27,
      durationSeconds: 6300,
    });
    // No per-item detail survives in the log.
    expect(JSON.stringify(result.profile.testScoreLog)).not.toContain('q1');
  });

  it('leaves nothing behind for an unfinished run', () => {
    const profile = {
      ...emptyProfile(),
      testAttempts: [attempt({ status: 'incomplete', totalEstimate: null })],
    };
    const result = deleteTestAttempt(profile, 'run-1');
    expect(result.profile.testAttempts).toHaveLength(0);
    expect(result.entry).toBeNull();
    expect(result.profile.testScoreLog).toHaveLength(0);
  });

  it('ignores an unknown id', () => {
    const profile = { ...emptyProfile(), testAttempts: [attempt()] };
    const result = deleteTestAttempt(profile, 'missing');
    expect(result.profile).toBe(profile);
    expect(result.entry).toBeNull();
  });

  it('keeps one line per run when a delete is repeated', () => {
    const profile = { ...emptyProfile(), testAttempts: [attempt()] };
    const first = deleteTestAttempt(profile, 'run-1');
    const second = deleteTestAttempt(
      { ...first.profile, testAttempts: [attempt()] },
      'run-1'
    );
    expect(second.profile.testScoreLog).toHaveLength(1);
    expect(second.profile.testScoreLog[0].total).toBe(1210);
  });
});
