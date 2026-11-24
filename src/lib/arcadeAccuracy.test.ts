import { describe, expect, it } from 'vitest';
import { interceptorAccuracy } from './arcadeAccuracy';

describe('interceptor accuracy', () => {
  it('uses successful pulses over shots fired', () => {
    expect(interceptorAccuracy(4, 2)).toBe(50);
    expect(interceptorAccuracy(10, 9)).toBe(90);
    expect(interceptorAccuracy(7, 7)).toBe(100);
  });

  it('never exceeds 100 or falls below zero', () => {
    expect(interceptorAccuracy(3, 5)).toBe(100);
    expect(interceptorAccuracy(3, -2)).toBe(0);
    expect(interceptorAccuracy(0, 0)).toBeNull();
  });
});
