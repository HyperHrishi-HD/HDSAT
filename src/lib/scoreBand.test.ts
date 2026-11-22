import { describe, expect, it } from 'vitest';
import { scoreBand } from './scoreBand';
import type { TestAttempt } from './types';

function attempt(total: number | null, status: TestAttempt['status'] = 'completed'): TestAttempt {
  return {
    id: `t-${total}-${Math.random()}`,
    assessment: 'SAT',
    status,
    createdAt: '2026-10-20T12:00:00.000Z',
    modules: [],
    rwEstimate: null,
    mathEstimate: null,
    totalEstimate: total,
    durationSeconds: 8000,
  };
}

describe('score band', () => {
  it('has no band until a test is finished', () => {
    expect(scoreBand([], 'SAT')).toBeNull();
    expect(scoreBand([attempt(null)], 'SAT')).toBeNull();
    expect(scoreBand([attempt(1300, 'incomplete')], 'SAT')).toBeNull();
  });

  it('widens when recent tests disagree', () => {
    const steady = scoreBand([attempt(1300), attempt(1310), attempt(1290)], 'SAT');
    const jumpy = scoreBand([attempt(1420), attempt(1180)], 'SAT');
    expect(steady).not.toBeNull();
    expect(jumpy).not.toBeNull();
    expect(jumpy!.high - jumpy!.low).toBeGreaterThan(steady!.high - steady!.low);
  });

  it('weights the newest result more heavily', () => {
    const band = scoreBand([attempt(1500), attempt(1000)], 'SAT');
    expect(band!.latest).toBe(1500);
    expect((band!.low + band!.high) / 2).toBeGreaterThan(1250);
  });

  it('never leaves the assessment scale', () => {
    const high = scoreBand([attempt(1600)], 'SAT');
    expect(high!.high).toBeLessThanOrEqual(1600);
    const low = scoreBand([attempt(400)], 'SAT');
    expect(low!.low).toBeGreaterThanOrEqual(400);
    const eighth = scoreBand([attempt(1440)], 'PSAT 8/9');
    expect(eighth!.high).toBeLessThanOrEqual(1440);
  });

  it('stays narrow for a single test', () => {
    const band = scoreBand([attempt(1200)], 'SAT');
    expect(band!.high - band!.low).toBeLessThanOrEqual(120);
  });
});
