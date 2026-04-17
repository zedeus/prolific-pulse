import { describe, it, expect } from 'vitest';
import { generateFakeSubmissions } from '../__dev__/fake-submissions';
import { extractSubmissionReward, extractCompletedAt, extractStartedAt } from '../earnings';

describe('generateFakeSubmissions', () => {
  const now = new Date('2026-04-16T12:00:00Z');

  it('produces the requested count', () => {
    const records = generateFakeSubmissions({ count: 100, seed: 7, now, spanDays: 60 });
    expect(records.length).toBe(100);
  });

  it('is deterministic for the same seed', () => {
    const a = generateFakeSubmissions({ count: 25, seed: 123, now, spanDays: 60 });
    const b = generateFakeSubmissions({ count: 25, seed: 123, now, spanDays: 60 });
    expect(a.map((r) => r.submission_id)).toEqual(b.map((r) => r.submission_id));
    expect(a[0].payload).toEqual(b[0].payload);
  });

  it('produces valid rewards with positive amounts', () => {
    const records = generateFakeSubmissions({ count: 200, seed: 9, now, spanDays: 90 });
    for (const r of records) {
      const reward = extractSubmissionReward(r);
      expect(reward).not.toBeNull();
      expect(reward!.amount).toBeGreaterThan(0);
      expect(['GBP', 'USD', 'EUR']).toContain(reward!.currency);
    }
  });

  it('puts started_at before completed_at on submitted statuses', () => {
    const records = generateFakeSubmissions({ count: 200, seed: 11, now, spanDays: 90 });
    for (const r of records) {
      const started = extractStartedAt(r);
      const completed = extractCompletedAt(r);
      if (completed && started) {
        expect(completed.getTime()).toBeGreaterThan(started.getTime());
      }
    }
  });

  it('sorts by observed_at ascending', () => {
    const records = generateFakeSubmissions({ count: 50, seed: 3, now, spanDays: 30 });
    for (let i = 1; i < records.length; i++) {
      expect(records[i].observed_at.localeCompare(records[i - 1].observed_at)).toBeGreaterThanOrEqual(0);
    }
  });

  it('spreads submissions across the requested span (within tolerance)', () => {
    const records = generateFakeSubmissions({ count: 500, seed: 5, now, spanDays: 180 });
    const oldest = new Date(records[0].observed_at);
    const newest = new Date(records[records.length - 1].observed_at);
    const spanMs = newest.getTime() - oldest.getTime();
    expect(spanMs).toBeGreaterThan(90 * 86_400_000); // at least 90 days of spread
  });
});
