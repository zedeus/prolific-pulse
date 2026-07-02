import { describe, it, expect } from 'vitest';
import { compareNumberDesc } from '../format';

describe('compareNumberDesc', () => {
  it('orders larger finite numbers first', () => {
    expect([3, 1, 2].sort(compareNumberDesc)).toEqual([3, 2, 1]);
  });

  it('pushes non-finite values (NaN/Infinity) to the end', () => {
    const sorted = [NaN, 5, Infinity, 2].sort(compareNumberDesc);
    expect(sorted.slice(0, 2)).toEqual([5, 2]);
    expect(Number.isFinite(sorted[2])).toBe(false);
    expect(Number.isFinite(sorted[3])).toBe(false);
  });

  it('treats equal or both-non-finite as 0 (stable)', () => {
    expect(compareNumberDesc(2, 2)).toBe(0);
    expect(compareNumberDesc(NaN, Infinity)).toBe(0);
    expect(compareNumberDesc(NaN, NaN)).toBe(0);
  });
});
