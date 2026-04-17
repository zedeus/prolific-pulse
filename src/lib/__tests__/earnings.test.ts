import { describe, it, expect } from 'vitest';
import type { SubmissionRecord } from '../db';
import {
  extractSubmissionReward,
  extractDurationSeconds,
  extractStartedAt,
  extractCompletedAt,
  isEarningsEligible,
  filterEligible,
  detectDefaultCurrency,
  listCurrencies,
  computeTotals,
  perSubmissionHourly,
  perSubmissionHourlySeries,
  dailyRollups,
  localDateKey,
  startOfLocalDay,
  daysAgo,
  quantile,
  mean,
  tukeyFences,
  trimmedMean,
  summarizeRates,
  groupByDayOfWeek,
  groupByHourOfDay,
  groupByDowHour,
  groupByStudy,
  groupByResearcher,
  rollingDailyMean,
  weekdayDailyStats,
  forecastDaily,
  observedDateRange,
  convertRewards,
  perHourOfWorkDaily,
  MIN_SENSIBLE_DURATION_SECONDS,
} from '../earnings';

// ── Fixtures ─────────────────────────────────────────────────

interface MakeOpts {
  id?: string;
  status?: string;
  phase?: 'submitting' | 'submitted';
  rewardMinor?: number | null;
  currency?: string;
  started_at?: string | null;
  completed_at?: string | null;
  observed_at?: string;
  study_id?: string;
  study_name?: string;
  researcher?: { id?: string; name?: string };
  extraPayload?: Record<string, unknown>;
}

function make(opts: MakeOpts = {}): SubmissionRecord {
  const payload: Record<string, unknown> = { ...(opts.extraPayload ?? {}) };
  if (opts.rewardMinor !== null && opts.rewardMinor !== undefined) {
    payload.submission_reward = { amount: opts.rewardMinor, currency: opts.currency ?? 'GBP' };
  }
  if (opts.started_at !== undefined && opts.started_at !== null) payload.started_at = opts.started_at;
  if (opts.completed_at !== undefined && opts.completed_at !== null) payload.completed_at = opts.completed_at;
  if (opts.researcher) {
    payload.study = { researcher: opts.researcher };
  }
  return {
    submission_id: opts.id ?? 'sub-1',
    study_id: opts.study_id ?? 'study-1',
    study_name: opts.study_name ?? 'Study 1',
    participant_id: 'p-1',
    status: opts.status ?? 'APPROVED',
    phase: opts.phase ?? 'submitted',
    payload,
    observed_at: opts.observed_at ?? '2026-04-01T12:00:00Z',
    updated_at: '2026-04-01T12:00:00Z',
  };
}

// ── extractors ───────────────────────────────────────────────

describe('extractSubmissionReward', () => {
  it('returns minor-unit amount and upper-cased currency', () => {
    const r = make({ rewardMinor: 250, currency: 'gbp' });
    expect(extractSubmissionReward(r)).toEqual({ amount: 250, currency: 'GBP' });
  });

  it('returns null when reward missing', () => {
    const r = make({ rewardMinor: null });
    expect(extractSubmissionReward(r)).toBeNull();
  });

  it('returns null when currency missing', () => {
    const r = make({ rewardMinor: 250 });
    (r.payload as Record<string, unknown>).submission_reward = { amount: 250 };
    expect(extractSubmissionReward(r)).toBeNull();
  });

  it('returns null when amount not a number', () => {
    const r = make({});
    (r.payload as Record<string, unknown>).submission_reward = { amount: 'x', currency: 'GBP' };
    expect(extractSubmissionReward(r)).toBeNull();
  });
});

describe('extract started_at / completed_at / duration', () => {
  it('parses timestamps', () => {
    const r = make({ started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:15:00Z' });
    expect(extractStartedAt(r)?.toISOString()).toBe('2026-04-01T10:00:00.000Z');
    expect(extractCompletedAt(r)?.toISOString()).toBe('2026-04-01T10:15:00.000Z');
    expect(extractDurationSeconds(r)).toBe(900);
  });

  it('falls back to returned_at when completed_at missing', () => {
    const r = make({ started_at: '2026-04-01T10:00:00Z', extraPayload: { returned_at: '2026-04-01T10:05:00Z' } });
    expect(extractCompletedAt(r)?.toISOString()).toBe('2026-04-01T10:05:00.000Z');
  });

  it('returns null when either side missing', () => {
    expect(extractDurationSeconds(make({ started_at: null, completed_at: '2026-04-01T10:15:00Z' }))).toBeNull();
    expect(extractDurationSeconds(make({ started_at: '2026-04-01T10:00:00Z', completed_at: null }))).toBeNull();
  });

  it('returns null for non-positive duration', () => {
    const r = make({ started_at: '2026-04-01T10:15:00Z', completed_at: '2026-04-01T10:00:00Z' });
    expect(extractDurationSeconds(r)).toBeNull();
  });
});

// ── eligibility ──────────────────────────────────────────────

describe('isEarningsEligible', () => {
  it('approved counts in both modes', () => {
    const r = make({ status: 'APPROVED', rewardMinor: 100 });
    expect(isEarningsEligible(r, 'approved_only')).toBe(true);
    expect(isEarningsEligible(r, 'approved_and_pending')).toBe(true);
  });

  it('awaiting review only counts in pending mode', () => {
    const r = make({ status: 'AWAITING REVIEW', rewardMinor: 100 });
    expect(isEarningsEligible(r, 'approved_only')).toBe(false);
    expect(isEarningsEligible(r, 'approved_and_pending')).toBe(true);
  });

  it('underscore/dash variants of awaiting review work', () => {
    const a = make({ status: 'AWAITING_REVIEW', rewardMinor: 100 });
    const b = make({ status: 'AWAITING-REVIEW', rewardMinor: 100 });
    expect(isEarningsEligible(a, 'approved_and_pending')).toBe(true);
    expect(isEarningsEligible(b, 'approved_and_pending')).toBe(true);
  });

  it('rejected/returned never count', () => {
    for (const status of ['REJECTED', 'RETURNED']) {
      const r = make({ status, rewardMinor: 100 });
      expect(isEarningsEligible(r, 'approved_and_pending')).toBe(false);
    }
  });

  it('screened out with reward counts as pending', () => {
    const r = make({ status: 'SCREENED OUT', rewardMinor: 20 });
    expect(isEarningsEligible(r, 'approved_only')).toBe(false);
    expect(isEarningsEligible(r, 'approved_and_pending')).toBe(true);
  });

  it('submitting phase never counts', () => {
    const r = make({ phase: 'submitting', status: 'APPROVED', rewardMinor: 100 });
    expect(isEarningsEligible(r, 'approved_and_pending')).toBe(false);
  });

  it('zero reward never counts', () => {
    const r = make({ rewardMinor: 0 });
    expect(isEarningsEligible(r, 'approved_and_pending')).toBe(false);
  });
});

describe('filterEligible', () => {
  it('applies currency, status and window filter', () => {
    const a = make({ id: 'a', rewardMinor: 100, currency: 'GBP', completed_at: '2026-04-02T00:00:00Z' });
    const b = make({ id: 'b', rewardMinor: 100, currency: 'USD', completed_at: '2026-04-02T00:00:00Z' });
    const c = make({ id: 'c', rewardMinor: 100, currency: 'GBP', completed_at: '2025-01-01T00:00:00Z' });
    const d = make({ id: 'd', rewardMinor: 100, currency: 'GBP', status: 'AWAITING REVIEW', completed_at: '2026-04-02T00:00:00Z' });

    const kept = filterEligible([a, b, c, d], {
      includeStatus: 'approved_only',
      currency: 'GBP',
      start: new Date('2026-01-01T00:00:00Z'),
      end: new Date('2027-01-01T00:00:00Z'),
    });
    expect(kept.map((r) => r.submission_id)).toEqual(['a']);
  });
});

// ── currency ─────────────────────────────────────────────────

describe('detectDefaultCurrency / listCurrencies', () => {
  it('picks the most-common currency', () => {
    const records = [
      make({ id: '1', rewardMinor: 100, currency: 'GBP' }),
      make({ id: '2', rewardMinor: 100, currency: 'USD' }),
      make({ id: '3', rewardMinor: 100, currency: 'GBP' }),
    ];
    expect(detectDefaultCurrency(records)).toBe('GBP');
  });

  it('returns null when no eligible rewards', () => {
    expect(detectDefaultCurrency([make({ rewardMinor: null })])).toBeNull();
  });

  it('lists currencies by count', () => {
    const records = [
      make({ id: '1', rewardMinor: 100, currency: 'EUR' }),
      make({ id: '2', rewardMinor: 100, currency: 'GBP' }),
      make({ id: '3', rewardMinor: 100, currency: 'GBP' }),
    ];
    expect(listCurrencies(records)).toEqual([
      { currency: 'GBP', count: 2 },
      { currency: 'EUR', count: 1 },
    ]);
  });
});

// ── totals ───────────────────────────────────────────────────

describe('computeTotals', () => {
  it('partitions approved vs pending and ignores others', () => {
    const records = [
      make({ id: 'a', status: 'APPROVED', rewardMinor: 500 }),
      make({ id: 'b', status: 'AWAITING REVIEW', rewardMinor: 300 }),
      make({ id: 'c', status: 'REJECTED', rewardMinor: 0 }),
      make({ id: 'd', status: 'RETURNED', rewardMinor: 0 }),
      make({ id: 'e', status: 'SCREENED OUT', rewardMinor: 20 }),
      make({ id: 'f', status: 'APPROVED', rewardMinor: 100, currency: 'USD' }),
    ];
    const totals = computeTotals(records, 'GBP');
    expect(totals.approved_minor).toBe(500);
    expect(totals.approved_count).toBe(1);
    expect(totals.pending_minor).toBe(320);
    expect(totals.pending_count).toBe(2);
    expect(totals.combined_minor).toBe(820);
  });
});

// ── per-submission hourly ────────────────────────────────────

describe('perSubmissionHourly', () => {
  it('computes £/hr in major units', () => {
    const r = make({ rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:30:00Z' });
    // £3.00 for 30 minutes → £6.00/hr
    expect(perSubmissionHourly(r)).toBeCloseTo(6, 6);
  });

  it('drops sub-15-second durations', () => {
    const r = make({ rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:00:10Z' });
    expect(perSubmissionHourly(r)).toBeNull();
  });

  it('drops >24h durations', () => {
    const r = make({ rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-03T10:00:00Z' });
    expect(perSubmissionHourly(r)).toBeNull();
  });

  it('perSubmissionHourlySeries filters nulls', () => {
    const records = [
      make({ id: 'a', rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:30:00Z' }),
      make({ id: 'b', rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:00:05Z' }), // too short
      make({ id: 'c', rewardMinor: null }),
    ];
    expect(perSubmissionHourlySeries(records)).toEqual([6]);
  });

  it('respects the MIN_SENSIBLE_DURATION_SECONDS threshold', () => {
    expect(MIN_SENSIBLE_DURATION_SECONDS).toBeGreaterThan(0);
  });
});

// ── daily rollups ────────────────────────────────────────────

describe('dailyRollups', () => {
  it('groups by local date and computes active + focused rates', () => {
    const records = [
      make({ id: 'a', rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:15:00Z' }),
      make({ id: 'b', rewardMinor: 300, started_at: '2026-04-01T10:30:00Z', completed_at: '2026-04-01T10:45:00Z' }),
    ];
    const rollups = dailyRollups(records);
    expect(rollups.length).toBe(1);
    const day = rollups[0];
    expect(day.reward_minor).toBe(600);
    expect(day.submission_count).toBe(2);
    expect(day.active_span_seconds).toBe(45 * 60); // 10:00 → 10:45
    expect(day.sum_duration_seconds).toBe(30 * 60); // 15m + 15m
    // £6 over 45 min active → £8/hr; over 30 min focused → £12/hr
    expect(day.hourly_active_major).toBeCloseTo(8, 6);
    expect(day.hourly_focused_major).toBeCloseTo(12, 6);
  });

  it('sorts rollups by date', () => {
    const records = [
      make({ id: 'b', rewardMinor: 100, started_at: '2026-04-03T10:00:00Z', completed_at: '2026-04-03T10:10:00Z' }),
      make({ id: 'a', rewardMinor: 100, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:10:00Z' }),
    ];
    const rollups = dailyRollups(records);
    expect(rollups.map((r) => r.date_key)).toEqual([
      localDateKey(new Date('2026-04-01T10:10:00Z')),
      localDateKey(new Date('2026-04-03T10:10:00Z')),
    ]);
  });
});

// ── date helpers ─────────────────────────────────────────────

describe('date helpers', () => {
  it('startOfLocalDay zeroes the time portion', () => {
    const d = new Date(2026, 3, 15, 14, 30, 45, 999); // local
    const s = startOfLocalDay(d);
    expect(s.getHours()).toBe(0);
    expect(s.getMinutes()).toBe(0);
    expect(s.getSeconds()).toBe(0);
    expect(s.getMilliseconds()).toBe(0);
    expect(s.getDate()).toBe(15);
  });

  it('daysAgo returns start of that day', () => {
    const now = new Date(2026, 3, 15, 14, 30);
    const y = daysAgo(7, now);
    expect(y.getDate()).toBe(8);
    expect(y.getHours()).toBe(0);
  });

  it('localDateKey formats as YYYY-MM-DD using local fields', () => {
    const d = new Date(2026, 0, 5, 23, 59); // Jan 5 local
    expect(localDateKey(d)).toBe('2026-01-05');
  });
});

// ── statistics ───────────────────────────────────────────────

describe('quantile / mean / trimmedMean', () => {
  it('quantile handles edge q values', () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(quantile(sorted, 0)).toBe(1);
    expect(quantile(sorted, 1)).toBe(5);
    expect(quantile(sorted, 0.5)).toBe(3);
  });

  it('quantile interpolates', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 6);
  });

  it('mean of empty is NaN', () => {
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  it('trimmedMean drops tails', () => {
    expect(trimmedMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBeCloseTo(5.5, 6);
    // 10% of 10 = 1 item each side → drop 1 and 10 → mean(2..9) = 5.5
  });
});

describe('tukeyFences', () => {
  it('has infinite fences on tiny samples', () => {
    expect(tukeyFences([1, 2, 3])).toEqual({ lo: -Infinity, hi: Infinity });
  });

  it('computes finite fences on larger samples', () => {
    const { lo, hi } = tukeyFences([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Number.isFinite(lo)).toBe(true);
    expect(Number.isFinite(hi)).toBe(true);
  });
});

describe('summarizeRates', () => {
  it('computes all stats and excludes outliers in log-space by default', () => {
    const values = [5, 5.5, 6, 6, 6.5, 7, 7, 1000];
    const stats = summarizeRates(values);
    expect(stats.n).toBe(7);
    expect(stats.n_excluded_outliers).toBe(1);
    expect(stats.max).toBe(7);
    expect(stats.median).toBeCloseTo(6, 6);
  });

  it('disables outlier filter when asked', () => {
    const values = [5, 6, 7, 1000];
    const stats = summarizeRates(values, { removeOutliers: false });
    expect(stats.n).toBe(4);
    expect(stats.max).toBe(1000);
  });

  it('empty input yields NaN stats', () => {
    const stats = summarizeRates([]);
    expect(stats.n).toBe(0);
    expect(Number.isNaN(stats.median)).toBe(true);
  });
});

// ── grouping ─────────────────────────────────────────────────

describe('groupByDayOfWeek', () => {
  it('computes active days correctly', () => {
    // 2026-04-05 is a Sunday (dow 0) in local TZ on a machine where the 5th is Sunday
    const records = [
      make({ id: 'a', rewardMinor: 100, started_at: '2026-04-06T10:00:00Z', completed_at: '2026-04-06T10:10:00Z' }),
      make({ id: 'b', rewardMinor: 200, started_at: '2026-04-06T11:00:00Z', completed_at: '2026-04-06T11:10:00Z' }),
      make({ id: 'c', rewardMinor: 300, started_at: '2026-04-13T10:00:00Z', completed_at: '2026-04-13T10:10:00Z' }),
    ];
    const buckets = groupByDayOfWeek(records);
    expect(buckets.length).toBe(7);
    // Same DOW for the 6th and 13th → both go in same bucket with 2 active days
    const dowBucket = buckets.find((b) => b.submission_count === 3);
    expect(dowBucket?.active_days).toBe(2);
    expect(dowBucket?.reward_minor).toBe(600);
  });
});

describe('groupByHourOfDay / groupByDowHour', () => {
  it('produces 24 hour buckets and 7x24 cells', () => {
    expect(groupByHourOfDay([]).length).toBe(24);
    expect(groupByDowHour([]).length).toBe(168);
  });

  it('hour grouping uses started_at local hour', () => {
    const r = make({ rewardMinor: 100, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:10:00Z' });
    const localHour = new Date('2026-04-01T10:00:00Z').getHours();
    const buckets = groupByHourOfDay([r]);
    expect(buckets[localHour].submission_count).toBe(1);
  });
});

describe('groupByStudy / groupByResearcher', () => {
  it('aggregates per study', () => {
    const records = [
      make({ id: 'a', study_id: 's1', rewardMinor: 100 }),
      make({ id: 'b', study_id: 's1', rewardMinor: 200 }),
      make({ id: 'c', study_id: 's2', rewardMinor: 300 }),
    ];
    const groups = groupByStudy(records).sort((a, b) => a.key.localeCompare(b.key));
    expect(groups.length).toBe(2);
    expect(groups[0]).toMatchObject({ key: 's1', reward_minor: 300, submission_count: 2 });
    expect(groups[1]).toMatchObject({ key: 's2', reward_minor: 300, submission_count: 1 });
  });

  it('aggregates per researcher from payload.study.researcher', () => {
    const records = [
      make({ id: 'a', rewardMinor: 100, researcher: { id: 'r1', name: 'Dr A' } }),
      make({ id: 'b', rewardMinor: 200, researcher: { id: 'r1', name: 'Dr A' } }),
      make({ id: 'c', rewardMinor: 300, researcher: { id: 'r2', name: 'Dr B' } }),
    ];
    const groups = groupByResearcher(records).sort((a, b) => a.key.localeCompare(b.key));
    expect(groups.length).toBe(2);
    expect(groups[0].label).toBe('Dr A');
    expect(groups[0].reward_minor).toBe(300);
  });

  it('bucket unknown researchers under "unknown"', () => {
    const records = [make({ id: 'a', rewardMinor: 100 })];
    const groups = groupByResearcher(records);
    expect(groups[0].key).toBe('unknown');
  });
});

// ── rolling ──────────────────────────────────────────────────

describe('weekdayDailyStats + forecastDaily', () => {
  function mkDay(y: number, m: number, d: number, minor: number): import('../db').SubmissionRecord {
    const date = new Date(y, m, d, 10, 0, 0);
    return make({
      id: `${y}-${m}-${d}`,
      rewardMinor: minor,
      started_at: date.toISOString(),
      completed_at: new Date(date.getTime() + 10 * 60_000).toISOString(),
    });
  }

  it('computes per-weekday medians including zero days', () => {
    // Build 4 consecutive weeks; only Wednesdays have earnings.
    // Pick a known Wednesday. 2026-04-01 is… let's just check: new Date(2026, 3, 1).getDay() yields the actual DOW.
    // Use Monday as a known reference: 2026-04-06 is a Monday? We don't need to care — just pick a date and measure.
    const records: import('../db').SubmissionRecord[] = [];
    // 4 Wednesdays with earnings of $5, $10, $15, $20
    for (let wk = 0; wk < 4; wk++) {
      records.push(mkDay(2026, 2, 4 + wk * 7, 500 + wk * 500)); // Mar 4, 11, 18, 25 (if Mar 4 2026 is a Wednesday)
    }
    const daily = dailyRollups(records);
    const start = new Date(2026, 2, 1); // Mar 1 local
    const end = new Date(2026, 3, 1); // Apr 1 exclusive (31 days)
    const stats = weekdayDailyStats(daily, start, end);
    expect(stats.length).toBe(7);
    // Total samples across all dows = 31 days
    const totalN = stats.reduce((a, s) => a + s.n, 0);
    expect(totalN).toBe(31);
    // The weekday with 4 non-zero samples should have the biggest median (>= $5).
    // Find a DOW with n=5 samples (some DOWs in March have 5 occurrences, others 4)
    // Just assert that one DOW has a non-zero median equal to the median of [5,10,15,20,0]
    const earnedDow = stats.find((s) => s.median > 0);
    expect(earnedDow).toBeDefined();
  });

  it('forecastDaily returns one point per horizon day using weekday lookup', () => {
    const weekday: Array<{
      dow: number; n: number; median: number; p25: number; p75: number; mean: number;
    }> = Array.from({ length: 7 }, (_, dow) => ({
      dow,
      n: 4,
      median: dow * 2,
      p25: dow,
      p75: dow * 3,
      mean: dow * 2,
    }));
    const start = new Date(2026, 3, 16);
    const f = forecastDaily(weekday, start, 7);
    expect(f.length).toBe(7);
    expect(f[0].date.getDay()).toBe(start.getDay());
    expect(f[0].median).toBe(start.getDay() * 2);
  });
});

describe('perHourOfWorkDaily', () => {
  it('returns reward-weighted daily $/hr', () => {
    // Day 1: 2 submissions. £3 over 30min + £6 over 60min = £9 over 1.5h → £6/hr
    const records = [
      make({ id: 'a', rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:30:00Z' }),
      make({ id: 'b', rewardMinor: 600, started_at: '2026-04-01T12:00:00Z', completed_at: '2026-04-01T13:00:00Z' }),
    ];
    const rates = perHourOfWorkDaily(records);
    expect(rates.length).toBe(1);
    expect(rates[0]).toBeCloseTo(6, 2);
  });

  it('excludes days with a single submission', () => {
    const records = [
      make({ id: 'a', rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:30:00Z' }),
    ];
    expect(perHourOfWorkDaily(records)).toEqual([]);
  });

  it('produces one rate per multi-submission day', () => {
    const records = [
      // Day 1
      make({ id: 'a1', rewardMinor: 300, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:30:00Z' }),
      make({ id: 'a2', rewardMinor: 600, started_at: '2026-04-01T12:00:00Z', completed_at: '2026-04-01T13:00:00Z' }),
      // Day 2
      make({ id: 'b1', rewardMinor: 200, started_at: '2026-04-02T10:00:00Z', completed_at: '2026-04-02T10:20:00Z' }),
      make({ id: 'b2', rewardMinor: 400, started_at: '2026-04-02T14:00:00Z', completed_at: '2026-04-02T14:40:00Z' }),
    ];
    const rates = perHourOfWorkDaily(records);
    expect(rates.length).toBe(2);
  });

  it('ignores records with missing reward or duration', () => {
    const records = [
      make({ id: 'a', rewardMinor: null, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:30:00Z' }),
      make({ id: 'b', rewardMinor: 300, started_at: null, completed_at: '2026-04-01T12:00:00Z' }),
      make({ id: 'c', rewardMinor: 300, started_at: '2026-04-01T13:00:00Z', completed_at: '2026-04-01T13:30:00Z' }),
      make({ id: 'd', rewardMinor: 300, started_at: '2026-04-01T14:00:00Z', completed_at: '2026-04-01T14:30:00Z' }),
    ];
    const rates = perHourOfWorkDaily(records);
    expect(rates.length).toBe(1); // only 'c' and 'd' are valid
  });
});

describe('convertRewards', () => {
  it('converts non-target currencies using fx rates', () => {
    const records = [
      make({ id: 'a', rewardMinor: 1000, currency: 'USD' }), // target
      make({ id: 'b', rewardMinor: 200, currency: 'GBP' }), // 200p × 1.27 = 254c
      make({ id: 'c', rewardMinor: 100, currency: 'EUR' }), // no rate → dropped
    ];
    const { converted, dropped } = convertRewards(records, 'USD', { GBP: 1.27 });
    expect(converted.length).toBe(2);
    expect(dropped).toEqual([{ currency: 'EUR', count: 1 }]);
    const b = converted.find((r) => r.submission_id === 'b')!;
    const payload = b.payload as { submission_reward: { amount: number; currency: string } };
    expect(payload.submission_reward).toEqual({ amount: 254, currency: 'USD' });
  });

  it('passes through records when target matches', () => {
    const records = [make({ id: 'a', rewardMinor: 1000, currency: 'USD' })];
    const { converted, dropped } = convertRewards(records, 'USD', {});
    expect(converted.length).toBe(1);
    expect(dropped.length).toBe(0);
  });

  it('passes through records without a reward untouched', () => {
    const records = [make({ id: 'a', rewardMinor: null })];
    const { converted } = convertRewards(records, 'USD', {});
    expect(converted.length).toBe(1);
  });
});

describe('observedDateRange', () => {
  it('returns first/last completed_at', () => {
    const records = [
      make({ id: 'a', rewardMinor: 100, completed_at: '2026-04-02T10:00:00Z', started_at: '2026-04-02T09:00:00Z' }),
      make({ id: 'b', rewardMinor: 100, completed_at: '2026-04-05T10:00:00Z', started_at: '2026-04-05T09:00:00Z' }),
      make({ id: 'c', rewardMinor: 100, completed_at: '2026-03-30T10:00:00Z', started_at: '2026-03-30T09:00:00Z' }),
    ];
    const r = observedDateRange(records);
    expect(r).not.toBeNull();
    expect(r!.first.toISOString()).toBe('2026-03-30T10:00:00.000Z');
    expect(r!.last.toISOString()).toBe('2026-04-05T10:00:00.000Z');
  });

  it('returns null when no completed_at', () => {
    expect(observedDateRange([make({ rewardMinor: 100 })])).toBeNull();
  });
});

describe('rollingDailyMean', () => {
  it('fills in zero days between data points', () => {
    // Build 3 records on local days 1, 3, 5
    const mk = (day: number, minor: number, id: string) => {
      const d = new Date(2026, 3, day, 10, 0, 0);
      return make({
        id,
        rewardMinor: minor,
        started_at: d.toISOString(),
        completed_at: new Date(d.getTime() + 10 * 60_000).toISOString(),
      });
    };
    const daily = dailyRollups([mk(1, 700, 'a'), mk(3, 700, 'b'), mk(5, 700, 'c')]);
    expect(daily.length).toBe(3); // no zero days in source
    const series = rollingDailyMean(daily, 3);
    // Span is 5 days → series length 5
    expect(series.length).toBe(5);
    // Last rolling value = (days 3,4,5) → (700 + 0 + 700) / 3 ≈ 466.67
    expect(series[series.length - 1].value_minor).toBeCloseTo(1400 / 3, 2);
  });

  it('empty input produces empty output', () => {
    expect(rollingDailyMean([], 7)).toEqual([]);
  });
});
