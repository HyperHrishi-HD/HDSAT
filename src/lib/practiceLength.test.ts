import { describe, expect, it } from 'vitest';
import { retryMissedLength } from './practiceLength';

describe('retry missed length', () => {
  it('starts at the missed count', () => {
    expect(retryMissedLength(16, 16)).toBe(16);
    expect(retryMissedLength(7, 12)).toBe(7);
  });

  it('never exceeds the eligible pool or the existing maximum', () => {
    expect(retryMissedLength(16, 9)).toBe(9);
    expect(retryMissedLength(80, 80)).toBe(50);
  });

  it('leaves the normal empty state alone', () => {
    expect(retryMissedLength(0, 0)).toBeNull();
    expect(retryMissedLength(4, 0)).toBeNull();
  });
});
