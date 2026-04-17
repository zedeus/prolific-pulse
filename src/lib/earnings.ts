import type { SubmissionRecord } from './db';
import type { Money } from './types';
import { normalizeSubmissionStatus, parseDate } from './format';
import { resolvedFxRates, type FxCache } from './fx-rates';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type IncludeStatus = 'approved_only' | 'approved_and_pending';

export const APPROVED_STATUS = 'APPROVED';
export const AWAITING_REVIEW_STATUS = 'AWAITING REVIEW';
export const RETURNED_STATUS = 'RETURNED';
export const REJECTED_STATUS = 'REJECTED';
export const SCREENED_OUT_STATUS = 'SCREENED OUT';
export const PENDING_STATUSES = new Set([AWAITING_REVIEW_STATUS]);
export const TERMINAL_NEGATIVE_STATUSES = new Set([RETURNED_STATUS, REJECTED_STATUS, SCREENED_OUT_STATUS]);

export interface EarningsFilter {
  includeStatus: IncludeStatus;
  /** Inclusive lower bound on `recordEventTime` (completed_at, else observed_at). */
  start?: Date;
  /** Exclusive upper bound. */
  end?: Date;
  currency?: string;
}

export interface DailyRollup {
  date_key: string; // YYYY-MM-DD in local TZ
  reward_minor: number;
  currency: string;
  submission_count: number;
  first_started_at: Date | null;
  last_completed_at: Date | null;
  active_span_seconds: number; // last_completed - first_started
  sum_duration_seconds: number; // sum of per-submission durations
  hourly_active_major: number; // reward / active_span
  hourly_focused_major: number; // reward / sum_duration
}

export interface Totals {
  approved_minor: number;
  pending_minor: number;
  combined_minor: number;
  approved_count: number;
  pending_count: number;
  currency: string;
}

export interface RateStats {
  n: number;
  n_excluded_outliers: number;
  mean: number;
  median: number;
  trimmed_mean: number; // trimFrac from each tail
  min: number;
  max: number;
  p25: number;
  p75: number;
  samples: number[]; // sorted, post-outlier filtering
}

export interface SummarizeOptions {
  removeOutliers?: boolean; // default true
  trimFrac?: number; // default 0.1
  logSpace?: boolean; // default true — Tukey fences in log space for right-skewed rates
}

// ──────────────────────────────────────────────────────────────
// Extraction helpers
// ──────────────────────────────────────────────────────────────

/** Minimum shape these helpers need — accepts both SubmissionRecord and Submission. */
interface PayloadCarrier { payload?: unknown }

export function extractSubmissionReward(record: PayloadCarrier): Money | null {
  const p = record.payload;
  if (!p || typeof p !== 'object') return null;
  const sr = (p as Record<string, unknown>).submission_reward;
  if (!sr || typeof sr !== 'object') return null;
  const m = sr as Record<string, unknown>;
  const amount = Number(m.amount);
  const currency = String(m.currency ?? '').toUpperCase();
  if (!Number.isFinite(amount) || !currency) return null;
  return { amount, currency };
}

export function extractStartedAt(record: PayloadCarrier): Date | null {
  const p = record.payload as Record<string, unknown> | undefined;
  return parseDate(p?.started_at);
}

export function extractCompletedAt(record: PayloadCarrier): Date | null {
  const p = record.payload as Record<string, unknown> | undefined;
  return parseDate(p?.completed_at) ?? parseDate(p?.returned_at);
}

export function extractDurationSeconds(record: PayloadCarrier): number | null {
  const started = extractStartedAt(record);
  const completed = extractCompletedAt(record);
  if (!started || !completed) return null;
  const s = (completed.getTime() - started.getTime()) / 1000;
  if (!Number.isFinite(s) || s <= 0) return null;
  return s;
}

// ──────────────────────────────────────────────────────────────
// Eligibility + filtering
// ──────────────────────────────────────────────────────────────

/** True if the record contributes to totals under the given status setting. */
export function isEarningsEligible(record: SubmissionRecord, include: IncludeStatus): boolean {
  if (record.phase !== 'submitted') return false;
  const status = normalizeSubmissionStatus(record.status);
  const reward = extractSubmissionReward(record);
  if (!reward || reward.amount <= 0) return false;
  if (status === APPROVED_STATUS) return true;
  if (include === 'approved_and_pending') {
    return PENDING_STATUSES.has(status) || status === SCREENED_OUT_STATUS;
  }
  return false;
}

/** Returns the date used for window filtering: completed_at if present, else observed_at. */
export function recordEventTime(record: SubmissionRecord): Date | null {
  return extractCompletedAt(record) ?? parseDate(record.observed_at);
}

export function filterEligible(records: SubmissionRecord[], filter: EarningsFilter): SubmissionRecord[] {
  const out: SubmissionRecord[] = [];
  for (const r of records) {
    if (!isEarningsEligible(r, filter.includeStatus)) continue;
    if (filter.currency) {
      const reward = extractSubmissionReward(r);
      if (!reward || reward.currency !== filter.currency) continue;
    }
    if (filter.start || filter.end) {
      const t = recordEventTime(r);
      if (!t) continue;
      if (filter.start && t < filter.start) continue;
      if (filter.end && t >= filter.end) continue;
    }
    out.push(r);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Currency detection
// ──────────────────────────────────────────────────────────────

/** Pick the currency appearing on the most eligible records. Ties → alphabetical. */
export function detectDefaultCurrency(records: SubmissionRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.phase !== 'submitted') continue;
    const reward = extractSubmissionReward(r);
    if (!reward || reward.amount <= 0) continue;
    counts.set(reward.currency, (counts.get(reward.currency) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = '';
  let bestCount = -1;
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && code < best)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/** Shared earnings view-model: resolved primary currency, converted submissions, and dropped/present currency stats. */
export interface ResolvedEarningsContext {
  currency: string;
  includeStatus: IncludeStatus;
  converted: SubmissionRecord[];
  dropped: { currency: string; count: number }[];
  /** Currencies present in the input submissions (count descending). */
  currencies: { currency: string; count: number }[];
}
export function resolveEarningsContext(
  submissions: SubmissionRecord[],
  prefs: {
    primary_currency: string | null;
    include_pending: boolean;
    fx_rates: Record<string, number>;
    fx_rates_cache: FxCache;
  },
): ResolvedEarningsContext {
  const currencies = listCurrencies(submissions);
  const currency = prefs.primary_currency ?? detectDefaultCurrency(submissions) ?? '';
  const includeStatus: IncludeStatus =
    prefs.include_pending ? 'approved_and_pending' : 'approved_only';
  if (!currency) {
    return { currency, includeStatus, converted: submissions, dropped: [], currencies };
  }
  const effectiveRates = resolvedFxRates(
    currencies.map((c) => c.currency),
    currency,
    prefs.fx_rates,
    prefs.fx_rates_cache,
  );
  const { converted, dropped } = convertRewards(submissions, currency, effectiveRates);
  return { currency, includeStatus, converted, dropped, currencies };
}

export function listCurrencies(records: SubmissionRecord[]): { currency: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const reward = extractSubmissionReward(r);
    if (!reward) continue;
    counts.set(reward.currency, (counts.get(reward.currency) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([currency, count]) => ({ currency, count }))
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}

/** Rewrite each reward into target currency (rate = units-of-target per 1 unit-of-source). Records without a rate are dropped. */
export function convertRewards(
  records: SubmissionRecord[],
  targetCurrency: string,
  fxRates: Record<string, number>,
): { converted: SubmissionRecord[]; dropped: { currency: string; count: number }[] } {
  if (!targetCurrency) return { converted: records, dropped: [] };

  // Fast path: if every record is already target-currency, skip cloning.
  let needsConversion = false;
  for (const r of records) {
    const reward = extractSubmissionReward(r);
    if (reward && reward.currency !== targetCurrency) { needsConversion = true; break; }
  }
  if (!needsConversion) return { converted: records, dropped: [] };

  const converted: SubmissionRecord[] = [];
  const droppedCounts = new Map<string, number>();
  for (const r of records) {
    const reward = extractSubmissionReward(r);
    if (!reward || reward.currency === targetCurrency) {
      converted.push(r);
      continue;
    }
    const rate = fxRates[reward.currency];
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      droppedCounts.set(reward.currency, (droppedCounts.get(reward.currency) ?? 0) + 1);
      continue;
    }
    const payload = { ...(r.payload as Record<string, unknown>) };
    payload.submission_reward = {
      amount: Math.round(reward.amount * rate),
      currency: targetCurrency,
    };
    converted.push({ ...r, payload });
  }
  const dropped = [...droppedCounts.entries()]
    .map(([currency, count]) => ({ currency, count }))
    .sort((a, b) => b.count - a.count);
  return { converted, dropped };
}

// ──────────────────────────────────────────────────────────────
// Totals
// ──────────────────────────────────────────────────────────────

export function computeTotals(records: SubmissionRecord[], currency: string): Totals {
  const totals: Totals = {
    approved_minor: 0,
    pending_minor: 0,
    combined_minor: 0,
    approved_count: 0,
    pending_count: 0,
    currency,
  };
  for (const r of records) {
    if (r.phase !== 'submitted') continue;
    const reward = extractSubmissionReward(r);
    if (!reward || reward.amount <= 0 || reward.currency !== currency) continue;
    const status = normalizeSubmissionStatus(r.status);
    if (status === APPROVED_STATUS) {
      totals.approved_minor += reward.amount;
      totals.approved_count += 1;
    } else if (PENDING_STATUSES.has(status) || status === SCREENED_OUT_STATUS) {
      totals.pending_minor += reward.amount;
      totals.pending_count += 1;
    }
  }
  totals.combined_minor = totals.approved_minor + totals.pending_minor;
  return totals;
}

// ──────────────────────────────────────────────────────────────
// Per-submission $/hr
// ──────────────────────────────────────────────────────────────

export const MIN_SENSIBLE_DURATION_SECONDS = 15;
export const MAX_SENSIBLE_DURATION_SECONDS = 24 * 3600; // 1 day

/** Major-unit £/hr for one submission. `null` if data is missing or duration is outside sensible bounds. */
export function perSubmissionHourly(record: SubmissionRecord): number | null {
  const reward = extractSubmissionReward(record);
  if (!reward || reward.amount <= 0) return null;
  const duration = extractDurationSeconds(record);
  if (duration === null) return null;
  if (duration < MIN_SENSIBLE_DURATION_SECONDS) return null;
  if (duration > MAX_SENSIBLE_DURATION_SECONDS) return null;
  return ((reward.amount / 100) * 3600) / duration;
}

export function perSubmissionHourlySeries(records: SubmissionRecord[]): number[] {
  const out: number[] = [];
  for (const r of records) {
    const h = perSubmissionHourly(r);
    if (h !== null && Number.isFinite(h)) out.push(h);
  }
  return out;
}

/** Per-day (≥2 submissions): sum(rewards) ÷ sum(durations). Reward-weighted, threshold-free alternative to per-submission rate. */
export function perHourOfWorkDaily(records: SubmissionRecord[]): number[] {
  const byDay = new Map<string, { reward_major: number; duration_seconds: number; count: number }>();
  for (const r of records) {
    const completed = extractCompletedAt(r);
    const reward = extractSubmissionReward(r);
    const duration = extractDurationSeconds(r);
    if (!completed || !reward || reward.amount <= 0 || duration === null) continue;
    if (duration < MIN_SENSIBLE_DURATION_SECONDS || duration > MAX_SENSIBLE_DURATION_SECONDS) continue;
    const key = localDateKey(completed);
    const bucket = byDay.get(key) ?? { reward_major: 0, duration_seconds: 0, count: 0 };
    bucket.reward_major += reward.amount / 100;
    bucket.duration_seconds += duration;
    bucket.count += 1;
    byDay.set(key, bucket);
  }
  const out: number[] = [];
  for (const bucket of byDay.values()) {
    if (bucket.count < 2 || bucket.duration_seconds <= 0) continue;
    out.push((bucket.reward_major * 3600) / bucket.duration_seconds);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Daily rollups (local TZ)
// ──────────────────────────────────────────────────────────────

/** YYYY-MM-DD in local TZ (not UTC). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Midnight (start-of-day) in local TZ. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** `n` days ago, at start-of-local-day. Negative n = in the future. */
export function daysAgo(n: number, now: Date = new Date()): Date {
  const t = startOfLocalDay(now);
  t.setDate(t.getDate() - n);
  return t;
}

export function addLocalDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function dailyRollups(records: SubmissionRecord[]): DailyRollup[] {
  // Assumes single-currency filter already applied upstream; uses first reward's currency.
  const byDay = new Map<string, {
    reward_minor: number;
    currency: string;
    count: number;
    first_start: Date | null;
    last_complete: Date | null;
    sum_duration: number;
  }>();

  for (const r of records) {
    const reward = extractSubmissionReward(r);
    if (!reward || reward.amount <= 0) continue;
    const completed = extractCompletedAt(r);
    if (!completed) continue;
    const key = localDateKey(completed);
    let bucket = byDay.get(key);
    if (!bucket) {
      bucket = {
        reward_minor: 0,
        currency: reward.currency,
        count: 0,
        first_start: null,
        last_complete: null,
        sum_duration: 0,
      };
      byDay.set(key, bucket);
    }
    if (reward.currency !== bucket.currency) continue;
    bucket.reward_minor += reward.amount;
    bucket.count += 1;
    const started = extractStartedAt(r);
    if (started) {
      if (!bucket.first_start || started < bucket.first_start) bucket.first_start = started;
    }
    if (!bucket.last_complete || completed > bucket.last_complete) bucket.last_complete = completed;
    const duration = extractDurationSeconds(r);
    if (duration !== null) bucket.sum_duration += duration;
  }

  const rollups: DailyRollup[] = [];
  for (const [date_key, b] of byDay) {
    const active_span_seconds = b.first_start && b.last_complete
      ? Math.max(0, (b.last_complete.getTime() - b.first_start.getTime()) / 1000)
      : 0;
    const sum_duration_seconds = b.sum_duration;
    const rewardMajor = b.reward_minor / 100;
    const hourly_active_major = active_span_seconds > 0
      ? (rewardMajor * 3600) / active_span_seconds
      : 0;
    const hourly_focused_major = sum_duration_seconds > 0
      ? (rewardMajor * 3600) / sum_duration_seconds
      : 0;
    rollups.push({
      date_key,
      reward_minor: b.reward_minor,
      currency: b.currency,
      submission_count: b.count,
      first_started_at: b.first_start,
      last_completed_at: b.last_complete,
      active_span_seconds,
      sum_duration_seconds,
      hourly_active_major,
      hourly_focused_major,
    });
  }
  rollups.sort((a, b) => a.date_key.localeCompare(b.date_key));
  return rollups;
}

// ──────────────────────────────────────────────────────────────
// Statistics helpers
// ──────────────────────────────────────────────────────────────

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function tukeyFences(sortedValues: number[], k = 1.5): { lo: number; hi: number } {
  if (sortedValues.length < 4) return { lo: -Infinity, hi: Infinity };
  const q1 = quantile(sortedValues, 0.25);
  const q3 = quantile(sortedValues, 0.75);
  const iqr = q3 - q1;
  return { lo: q1 - k * iqr, hi: q3 + k * iqr };
}

/** Trim `trimFrac` from each tail and return the mean of the remainder. */
export function trimmedMean(values: number[], trimFrac = 0.1): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const drop = Math.floor(sorted.length * trimFrac);
  const kept = sorted.slice(drop, sorted.length - drop);
  if (kept.length === 0) return mean(sorted);
  return mean(kept);
}

export function summarizeRates(values: number[], opts: SummarizeOptions = {}): RateStats {
  const removeOutliers = opts.removeOutliers ?? true;
  const trimFrac = opts.trimFrac ?? 0.1;
  const logSpace = opts.logSpace ?? true;

  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  let kept = finite;
  let excluded = 0;

  if (removeOutliers && finite.length >= 4) {
    const sorted = [...finite].sort((a, b) => a - b);
    const space = logSpace
      ? sorted.map((v) => Math.log(v))
      : sorted;
    const { lo, hi } = tukeyFences(space, 1.5);
    const toKeep: number[] = [];
    for (const v of finite) {
      const sv = logSpace ? Math.log(v) : v;
      if (sv >= lo && sv <= hi) toKeep.push(v);
      else excluded += 1;
    }
    kept = toKeep;
  }

  if (kept.length === 0) {
    return {
      n: 0, n_excluded_outliers: excluded,
      mean: NaN, median: NaN, trimmed_mean: NaN,
      min: NaN, max: NaN, p25: NaN, p75: NaN,
      samples: [],
    };
  }

  const sorted = [...kept].sort((a, b) => a - b);
  return {
    n: sorted.length,
    n_excluded_outliers: excluded,
    mean: mean(sorted),
    median: quantile(sorted, 0.5),
    trimmed_mean: trimmedMean(sorted, trimFrac),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    samples: sorted,
  };
}

// ──────────────────────────────────────────────────────────────
// Pattern aggregators
// ──────────────────────────────────────────────────────────────

export interface DowBucket {
  dow: number; // 0=Sun..6=Sat, local
  reward_minor: number;
  submission_count: number;
  active_days: number; // distinct local-date-keys that had activity on this DoW
  avg_reward_per_active_day_minor: number;
  hourly_rates: number[]; // per-submission $/hr samples
}

export function groupByDayOfWeek(records: SubmissionRecord[]): DowBucket[] {
  const buckets: Record<number, {
    reward_minor: number;
    count: number;
    dates: Set<string>;
    hourlies: number[];
  }> = {};
  for (let i = 0; i < 7; i++) {
    buckets[i] = { reward_minor: 0, count: 0, dates: new Set(), hourlies: [] };
  }
  for (const r of records) {
    const reward = extractSubmissionReward(r);
    const completed = extractCompletedAt(r);
    if (!reward || reward.amount <= 0 || !completed) continue;
    const dow = completed.getDay();
    const b = buckets[dow];
    b.reward_minor += reward.amount;
    b.count += 1;
    b.dates.add(localDateKey(completed));
    const hr = perSubmissionHourly(r);
    if (hr !== null) b.hourlies.push(hr);
  }
  return Object.entries(buckets).map(([k, b]) => {
    const active = b.dates.size;
    return {
      dow: Number(k),
      reward_minor: b.reward_minor,
      submission_count: b.count,
      active_days: active,
      avg_reward_per_active_day_minor: active > 0 ? b.reward_minor / active : 0,
      hourly_rates: b.hourlies,
    };
  });
}

export interface HourBucket {
  hour: number; // 0..23 local
  reward_minor: number;
  submission_count: number;
  hourly_rates: number[];
}

export function groupByHourOfDay(records: SubmissionRecord[]): HourBucket[] {
  const buckets: HourBucket[] = [];
  for (let h = 0; h < 24; h++) {
    buckets.push({ hour: h, reward_minor: 0, submission_count: 0, hourly_rates: [] });
  }
  for (const r of records) {
    const reward = extractSubmissionReward(r);
    const started = extractStartedAt(r) ?? extractCompletedAt(r);
    if (!reward || reward.amount <= 0 || !started) continue;
    const h = started.getHours();
    const b = buckets[h];
    b.reward_minor += reward.amount;
    b.submission_count += 1;
    const hr = perSubmissionHourly(r);
    if (hr !== null) b.hourly_rates.push(hr);
  }
  return buckets;
}

export interface DowHourCell {
  dow: number;
  hour: number;
  submission_count: number;
  reward_minor: number;
}

export function groupByDowHour(records: SubmissionRecord[]): DowHourCell[] {
  const grid = new Map<string, DowHourCell>();
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      grid.set(`${d}-${h}`, { dow: d, hour: h, submission_count: 0, reward_minor: 0 });
    }
  }
  for (const r of records) {
    const reward = extractSubmissionReward(r);
    const started = extractStartedAt(r) ?? extractCompletedAt(r);
    if (!reward || reward.amount <= 0 || !started) continue;
    const cell = grid.get(`${started.getDay()}-${started.getHours()}`);
    if (!cell) continue;
    cell.submission_count += 1;
    cell.reward_minor += reward.amount;
  }
  return [...grid.values()];
}

export interface GroupAgg {
  key: string;
  label: string;
  submission_count: number;
  reward_minor: number;
  currency: string;
  hourly_rates: number[];
}

export function groupByStudy(records: SubmissionRecord[]): GroupAgg[] {
  const map = new Map<string, GroupAgg>();
  for (const r of records) {
    const reward = extractSubmissionReward(r);
    if (!reward || reward.amount <= 0) continue;
    let agg = map.get(r.study_id);
    if (!agg) {
      agg = {
        key: r.study_id,
        label: r.study_name || r.study_id,
        submission_count: 0,
        reward_minor: 0,
        currency: reward.currency,
        hourly_rates: [],
      };
      map.set(r.study_id, agg);
    }
    if (reward.currency !== agg.currency) continue;
    agg.submission_count += 1;
    agg.reward_minor += reward.amount;
    const hr = perSubmissionHourly(r);
    if (hr !== null) agg.hourly_rates.push(hr);
  }
  return [...map.values()];
}

export function groupByResearcher(records: SubmissionRecord[]): GroupAgg[] {
  const map = new Map<string, GroupAgg>();
  for (const r of records) {
    const reward = extractSubmissionReward(r);
    if (!reward || reward.amount <= 0) continue;
    const payload = r.payload as Record<string, unknown> | undefined;
    const study = payload?.study as Record<string, unknown> | undefined;
    const researcher = study?.researcher as Record<string, unknown> | undefined;
    const id = String(researcher?.id ?? '').trim() || 'unknown';
    const name = String(researcher?.name ?? '').trim() || id;
    let agg = map.get(id);
    if (!agg) {
      agg = {
        key: id,
        label: name,
        submission_count: 0,
        reward_minor: 0,
        currency: reward.currency,
        hourly_rates: [],
      };
      map.set(id, agg);
    }
    if (reward.currency !== agg.currency) continue;
    agg.submission_count += 1;
    agg.reward_minor += reward.amount;
    const hr = perSubmissionHourly(r);
    if (hr !== null) agg.hourly_rates.push(hr);
  }
  return [...map.values()];
}

// ──────────────────────────────────────────────────────────────
// Forecast helpers
// ──────────────────────────────────────────────────────────────

export interface WeekdayStats {
  dow: number;
  n: number;
  median: number;
  p25: number;
  p75: number;
  mean: number;
}

/** Per-weekday daily-earnings distribution (major units) over the window. Always length 7. */
export function weekdayDailyStats(
  daily: DailyRollup[],
  windowStart: Date,
  windowEndExclusive: Date,
): WeekdayStats[] {
  const byKey = new Map(daily.map((r) => [r.date_key, r]));
  const samples: number[][] = [[], [], [], [], [], [], []];
  for (let d = new Date(windowStart); d < windowEndExclusive; d.setDate(d.getDate() + 1)) {
    const key = localDateKey(d);
    const reward = byKey.get(key)?.reward_minor ?? 0;
    samples[d.getDay()].push(reward / 100);
  }
  const out: WeekdayStats[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const arr = samples[dow];
    if (arr.length === 0) {
      out.push({ dow, n: 0, median: 0, p25: 0, p75: 0, mean: 0 });
      continue;
    }
    const sorted = [...arr].sort((a, b) => a - b);
    out.push({
      dow,
      n: sorted.length,
      median: quantile(sorted, 0.5),
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75),
      mean: mean(sorted),
    });
  }
  return out;
}

export interface ForecastPoint {
  date: Date;
  date_key: string;
  median: number;
  p25: number;
  p75: number;
}

/** Per-weekday median × `horizonDays` starting at `startDate` (inclusive). */
export function forecastDaily(
  weekdayStats: WeekdayStats[],
  startDate: Date,
  horizonDays: number,
): ForecastPoint[] {
  const out: ForecastPoint[] = [];
  const d = new Date(startDate);
  for (let i = 0; i < horizonDays; i++) {
    const s = weekdayStats[d.getDay()];
    out.push({
      date: new Date(d),
      date_key: localDateKey(d),
      median: s.median,
      p25: s.p25,
      p75: s.p75,
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Minimum days of history required before a forecast is shown. */
export const FORECAST_MIN_HISTORY_DAYS = 14;

/** Earliest + latest `completed_at` across records. `null` if none have one. */
export function observedDateRange(records: SubmissionRecord[]): { first: Date; last: Date } | null {
  let first: Date | null = null;
  let last: Date | null = null;
  for (const r of records) {
    const d = extractCompletedAt(r);
    if (!d) continue;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  if (!first || !last) return null;
  return { first, last };
}

// ──────────────────────────────────────────────────────────────
// Rolling averages
// ──────────────────────────────────────────────────────────────

/** Rolling mean of daily rewards over `windowDays`. Missing days count as 0. */
export function rollingDailyMean(
  daily: DailyRollup[],
  windowDays: number,
): { date_key: string; value_minor: number }[] {
  if (daily.length === 0) return [];
  const byKey = new Map(daily.map((d) => [d.date_key, d]));
  const first = parseDateKey(daily[0].date_key);
  const last = parseDateKey(daily[daily.length - 1].date_key);
  if (!first || !last) return [];
  const out: { date_key: string; value_minor: number }[] = [];
  const buf: number[] = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const key = localDateKey(d);
    buf.push(byKey.get(key)?.reward_minor ?? 0);
    if (buf.length > windowDays) buf.shift();
    const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
    out.push({ date_key: key, value_minor: avg });
  }
  return out;
}

export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
