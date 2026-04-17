<script lang="ts">
  import type { SubmissionRecord } from '../../../lib/db';
  import type { EarningsPrefs } from '../../../lib/earnings-prefs';
  import {
    APPROVED_STATUS,
    AWAITING_REVIEW_STATUS,
    addLocalDays,
    dailyRollups,
    daysAgo,
    extractCompletedAt,
    extractDurationSeconds,
    extractSubmissionReward,
    filterEligible,
    forecastDaily,
    FORECAST_MIN_HISTORY_DAYS,
    computeTotals,
    groupByDayOfWeek,
    groupByDowHour,
    groupByHourOfDay,
    groupByResearcher,
    groupByStudy,
    localDateKey,
    observedDateRange,
    parseDateKey,
    perHourOfWorkDaily,
    perSubmissionHourly,
    perSubmissionHourlySeries,
    quantile,
    resolveEarningsContext,
    startOfLocalDay,
    summarizeRates,
    weekdayDailyStats,
    type RateStats,
    type GroupAgg,
  } from '../../../lib/earnings';
  import { formatMoneyFromMajorUnits, formatDurationSeconds, formatSubmissionStatus, normalizeSubmissionStatus } from '../../../lib/format';
  import { parseProlificCsv, type CsvImportResult } from '../../../lib/import-csv';
  import { importSubmissions } from '../../../lib/store';
  import { scaleBand } from 'd3-scale';
  import { Area, Axis, Bar, Chart, ChartClipPath, Circle, Highlight, Rule, Spline, Svg, Tooltip } from 'layerchart';

  let { submissions, earningsPrefs, onEarningsPrefsChange, onReloadSubmissions } = $props<{
    submissions: SubmissionRecord[];
    earningsPrefs: EarningsPrefs;
    onEarningsPrefsChange: (prefs: EarningsPrefs) => void;
    onReloadSubmissions: () => Promise<void>;
  }>();

  type RangePreset = '7d' | '30d' | '90d' | 'this_month' | 'last_month' | 'all';
  let rangePreset: RangePreset = $state('30d');

  const now = new Date();
  const ctx = $derived(resolveEarningsContext(submissions, earningsPrefs));
  const currency = $derived(ctx.currency);
  const includeStatus = $derived(ctx.includeStatus);
  const convertedSubmissions = $derived(ctx.converted);
  const droppedByCurrency = $derived(ctx.dropped);
  const currencies = $derived(ctx.currencies);

  const range = $derived.by(() => {
    const today = startOfLocalDay(now);
    if (rangePreset === '7d') return { start: daysAgo(7, now), end: undefined as Date | undefined, label: 'Last 7 days' };
    if (rangePreset === '30d') return { start: daysAgo(30, now), end: undefined, label: 'Last 30 days' };
    if (rangePreset === '90d') return { start: daysAgo(90, now), end: undefined, label: 'Last 90 days' };
    if (rangePreset === 'this_month') {
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: undefined, label: 'This month' };
    }
    if (rangePreset === 'last_month') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start, end, label: 'Last month' };
    }
    return { start: undefined, end: undefined, label: 'All time' };
  });

  const rangeRecords = $derived(
    filterEligible(convertedSubmissions, {
      includeStatus,
      currency,
      start: range.start,
      end: range.end,
    }),
  );

  const rangeRollups = $derived(dailyRollups(rangeRecords));

  // ── Cards ──────────────────────────────────────────────────
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = addLocalDays(todayStart, -1);

  function totalFor(start?: Date, end?: Date): number {
    if (!currency) return 0;
    const records = filterEligible(convertedSubmissions, { includeStatus, currency, start, end });
    const t = computeTotals(records, currency);
    return (earningsPrefs.include_pending ? t.combined_minor : t.approved_minor) / 100;
  }

  const today = $derived(totalFor(todayStart));
  const yesterday = $derived(totalFor(yesterdayStart, todayStart));
  const last7 = $derived(totalFor(daysAgo(7, now)));
  const prev7 = $derived(totalFor(daysAgo(14, now), daysAgo(7, now)));
  const last30 = $derived(totalFor(daysAgo(30, now)));
  const prev30 = $derived(totalFor(daysAgo(60, now), daysAgo(30, now)));
  const last90 = $derived(totalFor(daysAgo(90, now)));
  const allTime = $derived(totalFor());

  // ── Daily series (for range) ───────────────────────────────
  type BarResolution = 'day' | 'week' | 'month';
  interface DailyPoint { date: Date; date_key: string; value: number; dow: number; isWeekend: boolean; spanLabel: string; submissionCount: number; }
  // Switch to weekly/monthly bars for long ranges so 10k subs over a year doesn't render 365+ slivers.
  const barResolution: BarResolution = $derived.by(() => {
    const endT = (range.end ?? addLocalDays(startOfLocalDay(now), 1)).getTime();
    let startT: number;
    if (range.start) {
      startT = range.start.getTime();
    } else {
      // "All time": span from oldest data day to today.
      const r = observedDateRange(convertedSubmissions);
      startT = r ? r.first.getTime() : endT - 30 * 86_400_000;
    }
    const totalDays = Math.ceil((endT - startT) / 86_400_000);
    if (totalDays > 365) return 'month';
    if (totalDays > 90) return 'week';
    return 'day';
  });

  const dailySeries: DailyPoint[] = $derived.by(() => {
    if (!currency) return [];
    const byKey = new Map(rangeRollups.map((r) => [r.date_key, r]));
    const firstDataDay = rangeRollups[0] ? parseDateKey(rangeRollups[0].date_key) : null;
    const start = range.start ?? firstDataDay ?? startOfLocalDay(now);
    const endExclusive = range.end ?? addLocalDays(startOfLocalDay(now), 1);
    const from = startOfLocalDay(start);
    const out: DailyPoint[] = [];

    if (barResolution === 'day') {
      for (let d = new Date(from); d < endExclusive; d.setDate(d.getDate() + 1)) {
        const key = localDateKey(d);
        const rec = byKey.get(key);
        const dow = d.getDay();
        out.push({
          date: new Date(d),
          date_key: key,
          value: (rec?.reward_minor ?? 0) / 100,
          dow,
          isWeekend: dow === 0 || dow === 6,
          spanLabel: d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
          submissionCount: rec?.submission_count ?? 0,
        });
      }
      return out;
    }

    if (barResolution === 'week') {
      // Weeks start on Monday for readability.
      const weekStart = new Date(from);
      const dow0 = weekStart.getDay();
      const backToMon = (dow0 + 6) % 7;
      weekStart.setDate(weekStart.getDate() - backToMon);
      for (let weekAnchor = new Date(weekStart); weekAnchor < endExclusive; weekAnchor.setDate(weekAnchor.getDate() + 7)) {
        let reward = 0;
        let count = 0;
        const weekEnd = new Date(weekAnchor);
        weekEnd.setDate(weekEnd.getDate() + 7);
        for (let d = new Date(weekAnchor); d < weekEnd && d < endExclusive; d.setDate(d.getDate() + 1)) {
          if (d < from) continue;
          const rec = byKey.get(localDateKey(d));
          if (!rec) continue;
          reward += rec.reward_minor / 100;
          count += rec.submission_count;
        }
        out.push({
          date: new Date(weekAnchor),
          date_key: localDateKey(weekAnchor),
          value: reward,
          dow: weekAnchor.getDay(),
          isWeekend: false,
          spanLabel: `Week of ${weekAnchor.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`,
          submissionCount: count,
        });
      }
      return out;
    }

    // 'month' resolution
    const monthStart = new Date(from.getFullYear(), from.getMonth(), 1);
    for (let m = new Date(monthStart); m < endExclusive; m.setMonth(m.getMonth() + 1)) {
      let reward = 0;
      let count = 0;
      const monthEnd = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      for (let d = new Date(m); d < monthEnd && d < endExclusive; d.setDate(d.getDate() + 1)) {
        if (d < from) continue;
        const rec = byKey.get(localDateKey(d));
        if (!rec) continue;
        reward += rec.reward_minor / 100;
        count += rec.submission_count;
      }
      out.push({
        date: new Date(m),
        date_key: localDateKey(m),
        value: reward,
        dow: m.getDay(),
        isWeekend: false,
        spanLabel: m.toLocaleDateString(undefined, { year: 'numeric', month: 'long' }),
        submissionCount: count,
      });
    }
    return out;
  });

  const rangeTotals = $derived.by(() => {
    if (!currency) return { approved: 0, pending: 0, combined: 0, count: 0 };
    const t = computeTotals(rangeRecords, currency);
    return {
      approved: t.approved_minor / 100,
      pending: t.pending_minor / 100,
      combined: t.combined_minor / 100,
      count: t.approved_count + t.pending_count,
    };
  });

  // ── Cumulative + forecast ──────────────────────────────────
  interface CumulativeHistPoint { date: Date; cumulative: number; daily: number; isForecast: false; }
  interface CumulativeForecastPoint { date: Date; cumulative: number; p25: number; p75: number; daily_median: number; isForecast: true; }

  const cumulativeSeries: CumulativeHistPoint[] = $derived.by(() => {
    const out: CumulativeHistPoint[] = [];
    let running = 0;
    for (const p of dailySeries) {
      running += p.value;
      out.push({ date: p.date, cumulative: running, daily: p.value, isForecast: false });
    }
    return out;
  });

  const rangeEndsAtToday = $derived(range.end === undefined);

  const forecastWeekdayStats = $derived.by(() => {
    if (!currency) return null;
    const start = daysAgo(28, now);
    const endExcl = addLocalDays(startOfLocalDay(now), 1);
    const source = dailyRollups(
      filterEligible(convertedSubmissions, { includeStatus, currency, start }),
    );
    const stats = weekdayDailyStats(source, start, endExcl);
    const total = stats.reduce((a, s) => a + s.n, 0);
    return { stats, total };
  });

  const forecastSeries: CumulativeForecastPoint[] = $derived.by(() => {
    if (!rangeEndsAtToday) return [];
    if (!forecastWeekdayStats) return [];
    if (forecastWeekdayStats.total < FORECAST_MIN_HISTORY_DAYS) return [];
    if (cumulativeSeries.length === 0) return [];

    const lastActual = cumulativeSeries[cumulativeSeries.length - 1];
    const firstForecast = addLocalDays(lastActual.date, 1);
    const horizon = 14;
    const points = forecastDaily(forecastWeekdayStats.stats, firstForecast, horizon);

    let cum = lastActual.cumulative;
    let p25 = lastActual.cumulative;
    let p75 = lastActual.cumulative;
    return points.map((p) => {
      cum += p.median;
      p25 += p.p25;
      p75 += p.p75;
      return {
        date: p.date,
        cumulative: cum,
        p25,
        p75,
        daily_median: p.median,
        isForecast: true as const,
      };
    });
  });

  interface CumulativeChartPoint {
    date: Date;
    scaleRef: number;
    /** Running cumulative (actual). Non-null for historical + the today bridge; null for pure-forecast days. */
    actual_cumulative: number | null;
    /** Per-day earned (historical only). */
    daily: number | null;
    /** Forecast cumulative median. Non-null for the today bridge + forecast days. */
    forecast_cumulative: number | null;
    forecast_p25: number | null;
    forecast_p75: number | null;
    /** Median earnings expected for this specific day (forecast only). */
    forecast_daily_median: number | null;
    is_forecast: boolean;
    is_today_bridge: boolean;
  }

  const cumulativeChartData: CumulativeChartPoint[] = $derived.by(() => {
    const out: CumulativeChartPoint[] = [];
    const lastHist = cumulativeSeries[cumulativeSeries.length - 1];
    const hasForecast = forecastSeries.length > 0 && lastHist !== undefined;

    for (let i = 0; i < cumulativeSeries.length; i++) {
      const p = cumulativeSeries[i];
      const isBridge = hasForecast && i === cumulativeSeries.length - 1;
      out.push({
        date: p.date,
        scaleRef: p.cumulative,
        actual_cumulative: p.cumulative,
        daily: p.daily,
        forecast_cumulative: isBridge ? p.cumulative : null,
        forecast_p25: isBridge ? p.cumulative : null,
        forecast_p75: isBridge ? p.cumulative : null,
        forecast_daily_median: isBridge ? 0 : null,
        is_forecast: false,
        is_today_bridge: isBridge,
      });
    }
    for (const p of forecastSeries) {
      out.push({
        date: p.date,
        scaleRef: p.p75,
        actual_cumulative: null,
        daily: null,
        forecast_cumulative: p.cumulative,
        forecast_p25: p.p25,
        forecast_p75: p.p75,
        forecast_daily_median: p.daily_median,
        is_forecast: true,
        is_today_bridge: false,
      });
    }
    return out;
  });

  const cumulativeYMax = $derived.by(() => {
    let m = 0;
    for (const p of cumulativeChartData) if (p.scaleRef > m) m = p.scaleRef;
    return m > 0 ? m * 1.05 : 1;
  });

  // ── Scatter plot ───────────────────────────────────────────
  interface ScatterPoint {
    date: Date;
    hourly: number;
    reward: number;
    status: string;
    study_name: string;
    duration_seconds: number;
    color_key: 'approved' | 'pending' | 'other';
  }

  const MAX_SCATTER_POINTS = 4000;
  const scatterData: ScatterPoint[] = $derived.by(() => {
    const out: ScatterPoint[] = [];
    for (const r of rangeRecords) {
      const hourly = perSubmissionHourly(r);
      if (hourly === null) continue;
      const reward = extractSubmissionReward(r);
      const completed = extractCompletedAt(r);
      const duration = extractDurationSeconds(r);
      if (!reward || !completed || duration === null) continue;
      const status = normalizeSubmissionStatus(r.status);
      const color_key: ScatterPoint['color_key'] =
        status === APPROVED_STATUS ? 'approved'
        : status === AWAITING_REVIEW_STATUS ? 'pending'
        : 'other';
      out.push({
        date: completed,
        hourly,
        reward: reward.amount / 100,
        status,
        study_name: r.study_name || '(unknown)',
        duration_seconds: duration,
        color_key,
      });
    }
    if (out.length <= MAX_SCATTER_POINTS) return out;
    // Deterministic stride preserves distribution shape while capping render cost.
    const stride = Math.ceil(out.length / MAX_SCATTER_POINTS);
    const sampled: ScatterPoint[] = [];
    for (let i = 0; i < out.length; i += stride) sampled.push(out[i]);
    return sampled;
  });
  const scatterTotalInRange = $derived(rangeRecords.length);
  const scatterYMax = $derived.by(() => {
    if (scatterData.length === 0) return 10;
    const sorted = [...scatterData.map((p) => p.hourly)].sort((a, b) => a - b);
    // Clip y to 98th percentile so extreme outliers don't crush the scale.
    const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
    return Math.max(1, p98 * 1.1);
  });

  // sqrt so dot area (not radius) is proportional to reward.
  function scatterRadius(reward: number, maxReward: number): number {
    const norm = Math.max(0.01, reward / Math.max(1, maxReward));
    return 2.5 + Math.sqrt(norm) * 7;
  }
  const scatterMaxReward = $derived(
    scatterData.reduce((m, p) => Math.max(m, p.reward), 1),
  );
  const scatterOutlierCount = $derived(
    scatterData.filter((p) => p.hourly > scatterYMax).length,
  );

  // Pad x-domain so edge-date dots aren't clipped by the plot area.
  const scatterXDomain = $derived.by(() => {
    if (scatterData.length === 0) return undefined;
    let min = scatterData[0].date.getTime();
    let max = min;
    for (const p of scatterData) {
      const t = p.date.getTime();
      if (t < min) min = t;
      if (t > max) max = t;
    }
    const span = Math.max(86_400_000, max - min);
    const pad = Math.max(86_400_000, span * 0.02);
    return [new Date(min - pad), new Date(max + pad)];
  });

  // Sliding-window rolling median; window scales so short ranges still look smooth.
  interface ScatterTrendPoint { date: Date; median: number; p25: number; p75: number; }
  const scatterTrend: ScatterTrendPoint[] = $derived.by(() => {
    if (scatterData.length < 5) return [];
    // Sort by date
    const sorted = [...scatterData].sort((a, b) => a.date.getTime() - b.date.getTime());
    const windowSize = Math.max(5, Math.min(60, Math.round(sorted.length * 0.1)));
    const out: ScatterTrendPoint[] = [];
    const step = Math.max(1, Math.floor(sorted.length / 80)); // cap at ~80 trend points
    for (let i = Math.floor(windowSize / 2); i < sorted.length - Math.floor(windowSize / 2); i += step) {
      const lo = Math.max(0, i - Math.floor(windowSize / 2));
      const hi = Math.min(sorted.length, i + Math.ceil(windowSize / 2));
      const slice = sorted.slice(lo, hi).map((p) => p.hourly).sort((a, b) => a - b);
      out.push({
        date: sorted[i].date,
        median: quantile(slice, 0.5),
        p25: quantile(slice, 0.25),
        p75: quantile(slice, 0.75),
      });
    }
    return out;
  });

  // ── Click-to-drill: day detail ─────────────────────────────
  let selectedDayKey = $state<string | null>(null);
  const selectedDaySubmissions = $derived.by(() => {
    if (!selectedDayKey || !currency) return [];
    const rows: { id: string; name: string; reward: number; duration: number | null; hourly: number | null; status: string; completed_at: Date | null }[] = [];
    for (const r of convertedSubmissions) {
      const completed = extractCompletedAt(r);
      if (!completed) continue;
      if (localDateKey(completed) !== selectedDayKey) continue;
      const reward = extractSubmissionReward(r);
      if (!reward) continue;
      const duration = extractDurationSeconds(r);
      const hourly = perSubmissionHourly(r);
      rows.push({
        id: r.submission_id,
        name: r.study_name || '(unknown)',
        reward: reward.amount / 100,
        duration,
        hourly,
        status: normalizeSubmissionStatus(r.status),
        completed_at: completed,
      });
    }
    rows.sort((a, b) => (a.completed_at?.getTime() ?? 0) - (b.completed_at?.getTime() ?? 0));
    return rows;
  });
  const selectedDayTotal = $derived(
    selectedDaySubmissions.reduce((a, r) => a + r.reward, 0),
  );

  // ── DOW × Hour heatmap ─────────────────────────────────────
  const dowHourCells = $derived(groupByDowHour(rangeRecords));
  const heatmapMax = $derived.by(() => {
    let m = 0;
    for (const c of dowHourCells) if (c.submission_count > m) m = c.submission_count;
    return m;
  });
  const heatmapIndex = $derived.by(() => {
    const map = new Map<number, (typeof dowHourCells)[number]>();
    for (const c of dowHourCells) map.set(c.dow * 24 + c.hour, c);
    return map;
  });

  function heatmapCell(dow: number, hour: number) {
    return heatmapIndex.get(dow * 24 + hour) ?? { dow, hour, submission_count: 0, reward_minor: 0 };
  }

  function heatmapAlpha(count: number): number {
    if (heatmapMax <= 0) return 0;
    // Square-root scaling brings out low-count cells without crushing peaks.
    return Math.min(1, Math.sqrt(count / heatmapMax));
  }

  let heatHover = $state<{ dow: number; hour: number; count: number; reward: number } | null>(null);

  // ── Rate comparison ────────────────────────────────────────
  const summarizeOpts = $derived({ removeOutliers: !earningsPrefs.include_outliers });

  interface RateMethod {
    label: string;
    description: string;
    stats: RateStats;
    /** Suffix shown next to each stat value (e.g. "/hr" or "/day"). */
    suffix: string;
  }

  const rateAll: RateMethod[] = $derived.by(() => {
    const methods: RateMethod[] = [];
    methods.push({
      label: 'Per submission',
      description: 'Each study: reward ÷ its own duration. Equal weight to every study — short tasks skew this high.',
      suffix: '/hr',
      stats: summarizeRates(perSubmissionHourlySeries(rangeRecords), summarizeOpts),
    });
    methods.push({
      label: 'Per hour of work',
      description: 'Your reward ÷ the actual time you spent on studies, taken per day. Your honest earning rate.',
      suffix: '/hr',
      stats: summarizeRates(perHourOfWorkDaily(rangeRecords), summarizeOpts),
    });
    const activeDays = rangeRollups
      .filter((r) => r.submission_count >= 3)
      .map((r) => r.reward_minor / 100);
    methods.push({
      label: 'Per active day',
      description: 'What you typically earn on a day you sit down and work (≥ 3 submissions).',
      suffix: '/day',
      stats: summarizeRates(activeDays, summarizeOpts),
    });
    return methods;
  });

  // ── Day-of-week + hour-of-day ──────────────────────────────
  type PatternMetric = 'earned' | 'rate';
  let dowMetric: PatternMetric = $state('earned');
  let hourMetric: PatternMetric = $state('earned');

  function medianOf(arr: number[]): number {
    if (arr.length === 0) return 0;
    return quantile([...arr].sort((a, b) => a - b), 0.5);
  }

  const dowBuckets = $derived.by(() => {
    const raw = groupByDayOfWeek(rangeRecords);
    return raw.map((b) => {
      const earned = b.reward_minor / 100;
      const rate = medianOf(b.hourly_rates);
      return {
        ...b,
        label: DOW_LABELS[b.dow],
        earned,
        rate,
        rate_sample_count: b.hourly_rates.length,
        isWeekend: b.dow === 0 || b.dow === 6,
        value: dowMetric === 'rate' ? rate : earned,
      };
    });
  });
  const hourBuckets = $derived.by(() => {
    const raw = groupByHourOfDay(rangeRecords);
    return raw.map((b) => {
      const earned = b.reward_minor / 100;
      const rate = medianOf(b.hourly_rates);
      return {
        ...b,
        label: `${b.hour}`,
        earned,
        rate,
        rate_sample_count: b.hourly_rates.length,
        value: hourMetric === 'rate' ? rate : earned,
      };
    });
  });

  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dailyLabel(date: Date, index: number, total: number): string {
    if (total <= 14) return String(date.getDate());
    if (total <= 31) {
      const step = total <= 20 ? 2 : 3;
      return index % step === 0 || date.getDate() === 1 ? String(date.getDate()) : '';
    }
    if (total <= 60) {
      if (date.getDate() === 1) return MONTH_LABELS[date.getMonth()];
      if (index === 0) return `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
      if (date.getDate() === 15) return '15';
      return '';
    }
    if (date.getDate() === 1) return MONTH_LABELS[date.getMonth()];
    if (index === 0) return `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
    if (date.getDate() === 15) return '15';
    return '';
  }

  function barLabel(date: Date, index: number, total: number, res: BarResolution): string {
    if (res === 'day') return dailyLabel(date, index, total);
    if (res === 'week') {
      // Weekly bars: show a label every ~4 weeks, plus at start.
      if (index === 0) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      // First Monday of a new month gets the month abbreviation.
      if (date.getDate() <= 7) return MONTH_LABELS[date.getMonth()];
      const step = total <= 14 ? 2 : 4;
      if (index % step === 0) return String(date.getDate());
      return '';
    }
    // Monthly
    if (index === 0) return `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;
    if (date.getMonth() === 0) return `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;
    return MONTH_LABELS[date.getMonth()];
  }

  // ── Study + researcher leaderboards ────────────────────────
  const LEADERBOARD_PAGE = 10;
  let studyLimit = $state(LEADERBOARD_PAGE);
  let researcherLimit = $state(LEADERBOARD_PAGE);

  const fullStudyBoard = $derived(groupByStudy(rangeRecords));
  const fullResearcherBoard = $derived(groupByResearcher(rangeRecords));

  $effect(() => {
    void rangePreset;
    studyLimit = LEADERBOARD_PAGE;
    researcherLimit = LEADERBOARD_PAGE;
  });

  function fmt(major: number): string {
    if (!currency) return '—';
    if (!Number.isFinite(major)) return '—';
    return formatMoneyFromMajorUnits(major, currency);
  }

  function delta(current: number, previous: number): { text: string; cls: string } {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return { text: '', cls: '' };
    if (previous === 0 && current === 0) return { text: '—', cls: 'text-base-content/40' };
    if (previous === 0) return { text: '↑ new', cls: 'text-emerald-500' };
    const diff = current - previous;
    if (diff === 0) return { text: '—', cls: 'text-base-content/40' };
    const pct = Math.round((diff / previous) * 100);
    const arrow = diff > 0 ? '↑' : '↓';
    const cls = diff > 0 ? 'text-emerald-500' : 'text-rose-500';
    return { text: `${arrow} ${Math.abs(pct)}% vs prior`, cls };
  }

  function rateMedian(board: GroupAgg[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const g of board) {
      if (g.hourly_rates.length === 0) { map.set(g.key, NaN); continue; }
      const sorted = [...g.hourly_rates].sort((a, b) => a - b);
      map.set(g.key, quantile(sorted, 0.5));
    }
    return map;
  }
  const studyMedian = $derived(rateMedian(fullStudyBoard));
  const researcherMedian = $derived(rateMedian(fullResearcherBoard));

  type LeaderSortKey = 'name' | 'earned' | 'count' | 'rate';
  type LeaderSort = { key: LeaderSortKey; dir: 'asc' | 'desc' };
  let studySort: LeaderSort = $state({ key: 'earned', dir: 'desc' });
  let researcherSort: LeaderSort = $state({ key: 'earned', dir: 'desc' });

  function cycleSort(current: LeaderSort, key: LeaderSortKey): LeaderSort {
    if (current.key !== key) return { key, dir: key === 'name' ? 'asc' : 'desc' };
    return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  }

  function sortBoard(
    board: GroupAgg[],
    sort: LeaderSort,
    rateMap: Map<string, number>,
  ): GroupAgg[] {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const copy = [...board];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sort.key === 'name') cmp = a.label.localeCompare(b.label);
      else if (sort.key === 'earned') cmp = a.reward_minor - b.reward_minor;
      else if (sort.key === 'count') cmp = a.submission_count - b.submission_count;
      else if (sort.key === 'rate') {
        const ra = rateMap.get(a.key) ?? -Infinity;
        const rb = rateMap.get(b.key) ?? -Infinity;
        cmp = ra - rb;
      }
      return cmp === 0 ? a.label.localeCompare(b.label) : cmp * dir;
    });
    return copy;
  }

  const sortedStudyBoard = $derived(
    sortBoard(fullStudyBoard, studySort, studyMedian).slice(0, studyLimit),
  );
  const sortedResearcherBoard = $derived(
    sortBoard(fullResearcherBoard, researcherSort, researcherMedian).slice(0, researcherLimit),
  );

  const studyCols: { key: LeaderSortKey; label: string; align: 'text-left' | 'text-right' }[] = [
    { key: 'name', label: 'Study', align: 'text-left' },
    { key: 'earned', label: 'Earned', align: 'text-right' },
    { key: 'rate', label: 'Median $/hr', align: 'text-right' },
  ];
  const researcherCols: { key: LeaderSortKey; label: string; align: 'text-left' | 'text-right' }[] = [
    { key: 'name', label: 'Researcher', align: 'text-left' },
    { key: 'earned', label: 'Earned', align: 'text-right' },
    { key: 'count', label: 'Submissions', align: 'text-right' },
    { key: 'rate', label: 'Median $/hr', align: 'text-right' },
  ];

  function togglePending(e: Event) {
    onEarningsPrefsChange({
      ...earningsPrefs,
      include_pending: (e.target as HTMLInputElement).checked,
    });
  }

  // ── CSV import ─────────────────────────────────────────────
  let fileInput: HTMLInputElement;
  // Parsed records stay *out* of $state — Svelte wraps reactive values in
  // Proxies, which Firefox's structured-clone bridge (used by IndexedDB)
  // can't serialise.
  let pendingRecords: CsvImportResult['records'] = [];
  let importPending = $state<{ filename: string; recordCount: number; skippedNoTime: number; errorCount: number } | null>(null);
  let importError = $state<string | null>(null);
  let importBusy = $state(false);
  let importedBanner = $state<{ added: number; skipped_existing: number; filename: string } | null>(null);

  async function handleFileSelected(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (fileInput) fileInput.value = '';
    if (!file) return;
    importError = null;
    importedBanner = null;
    try {
      const text = await file.text();
      const result = parseProlificCsv(text);
      if (result.records.length === 0 && result.errors.length > 0) {
        importError = result.errors[0].reason;
        return;
      }
      pendingRecords = result.records;
      importPending = {
        filename: file.name,
        recordCount: result.records.length,
        skippedNoTime: result.skippedNoTime,
        errorCount: result.errors.length,
      };
    } catch (err) {
      importError = err instanceof Error ? err.message : 'Failed to read file';
    }
  }

  function cancelImport() {
    importPending = null;
    pendingRecords = [];
  }

  async function confirmImport() {
    if (!importPending) return;
    importBusy = true;
    try {
      const summary = await importSubmissions(pendingRecords);
      importedBanner = {
        added: summary.added,
        skipped_existing: summary.skipped_existing,
        filename: importPending.filename,
      };
      importPending = null;
      pendingRecords = [];
      await onReloadSubmissions();
    } catch (err) {
      importError = err instanceof Error ? err.message : 'Import failed';
    } finally {
      importBusy = false;
    }
  }
</script>

<style>
  :global(.cumulative-line) {
    stroke-width: 2.5;
  }
  :global(.forecast-dashed) {
    stroke-dasharray: 5 4;
    stroke-width: 2.5;
  }
  :global(.today-rule) {
    stroke-dasharray: 2 3;
    stroke-width: 1;
  }
  :global(.scatter-trend-line) {
    stroke-width: 2.25;
  }
  .heatmap-cell.is-hovered {
    outline: 2px solid currentColor;
    outline-offset: -1px;
    z-index: 1;
    position: relative;
  }
  /* Hover highlights for SVG chart elements. Applied via :global so they
     reach LayerChart-rendered <rect>/<circle> descendants. */
  :global(.chart-bar-interactive) {
    transition: filter 120ms ease;
    cursor: pointer;
  }
  :global(.chart-bar-interactive:hover) {
    filter: brightness(1.25) saturate(1.15);
  }
  :global(.scatter-dot-interactive) {
    transition: filter 120ms ease, opacity 120ms ease;
    cursor: pointer;
  }
  :global(.scatter-dot-interactive:hover) {
    filter: brightness(1.4) saturate(1.3);
    opacity: 1 !important;
  }
</style>

<div class="space-y-5">
  <!-- Header row: title + controls -->
  <div class="flex items-start justify-between flex-wrap gap-3">
    <div>
      <h1 class="text-xl font-bold">Earnings</h1>
      <p class="text-sm text-base-content/60 mt-0.5">
        {range.label} · {rangeTotals.count} submission{rangeTotals.count === 1 ? '' : 's'}
        {#if earningsPrefs.include_pending && rangeTotals.pending > 0}
          · <span class="text-amber-600 dark:text-amber-400">{fmt(rangeTotals.pending)} pending</span>
        {/if}
      </p>
    </div>
    <div class="flex items-center gap-3 flex-wrap">
      <div role="tablist" class="flex rounded-md border border-base-300 overflow-hidden text-xs bg-base-100" aria-label="Date range">
        {#each ['7d', '30d', '90d', 'this_month', 'last_month', 'all'] as const as preset (preset)}
          <button
            type="button"
            class="px-3 py-1.5 border-r border-base-300 last:border-r-0 cursor-pointer {rangePreset === preset ? 'bg-primary text-primary-content font-semibold' : 'hover:bg-base-200 text-base-content/70'}"
            onclick={() => (rangePreset = preset)}
          >
            {preset === '7d' ? '7d'
              : preset === '30d' ? '30d'
              : preset === '90d' ? '90d'
              : preset === 'this_month' ? 'This month'
              : preset === 'last_month' ? 'Last month'
              : 'All'}
          </button>
        {/each}
      </div>
      {#if currency}
        <div class="text-xs text-base-content/60">
          Totals in <span class="font-semibold text-base-content">{currency}</span>
          {#if currencies.length > 1}
            <span class="text-base-content/45">· {currencies.length - 1} other {currencies.length - 1 === 1 ? 'currency' : 'currencies'} converted</span>
          {/if}
        </div>
      {/if}
      <label class="flex items-center gap-1.5 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          checked={earningsPrefs.include_pending}
          onchange={togglePending}
        />
        Include pending
      </label>
      <button
        type="button"
        class="btn btn-ghost btn-sm gap-1.5 text-xs"
        onclick={() => fileInput?.click()}
        title="Import submission history from a Prolific CSV export"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Import CSV
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".csv,text/csv"
        class="hidden"
        onchange={handleFileSelected}
      />
    </div>
  </div>

  {#if importError}
    <div class="rounded border border-rose-500/50 bg-rose-500/10 p-3 text-sm flex items-start gap-2">
      <span class="text-rose-500 font-bold">✕</span>
      <div class="flex-1">
        <div class="font-semibold">Couldn't import that file</div>
        <div class="text-base-content/70 text-xs mt-0.5">{importError}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => (importError = null)}>Dismiss</button>
    </div>
  {/if}

  {#if importPending}
    <div class="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div class="font-semibold text-base">Import <span class="font-mono text-[13px] text-base-content/70">{importPending.filename}</span>?</div>
          <div class="text-xs text-base-content/70 mt-1 space-y-0.5">
            <div>• {importPending.recordCount} submission{importPending.recordCount === 1 ? '' : 's'} ready to import</div>
            {#if importPending.skippedNoTime > 0}
              <div>• {importPending.skippedNoTime} row{importPending.skippedNoTime === 1 ? '' : 's'} skipped (no timestamps)</div>
            {/if}
            {#if importPending.errorCount > 0}
              <div>• {importPending.errorCount} row{importPending.errorCount === 1 ? '' : 's'} skipped (parse errors)</div>
            {/if}
            <div class="text-base-content/55">Existing submissions with the same completion code will be preserved — nothing is overwritten.</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-ghost btn-sm" onclick={cancelImport} disabled={importBusy}>Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" onclick={confirmImport} disabled={importBusy}>
            {importBusy ? 'Importing…' : `Import ${importPending.recordCount}`}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if importedBanner}
    <div class="rounded border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm flex items-center gap-2">
      <span class="text-emerald-500 font-bold">✓</span>
      <span class="flex-1">
        Imported <span class="font-semibold">{importedBanner.added}</span> new submission{importedBanner.added === 1 ? '' : 's'}
        {#if importedBanner.skipped_existing > 0}
          · <span class="text-base-content/65">{importedBanner.skipped_existing} already present</span>
        {/if}
        from <span class="font-mono text-[12px] text-base-content/70">{importedBanner.filename}</span>
      </span>
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => (importedBanner = null)}>Dismiss</button>
    </div>
  {/if}

  {#if submissions.length === 0}
    <div class="rounded-lg border border-dashed border-base-300 bg-base-100 p-10 text-center">
      <div class="text-4xl mb-3">📥</div>
      <div class="text-lg font-semibold">Import your submission history</div>
      <div class="text-sm text-base-content/65 mt-1 max-w-lg mx-auto leading-snug">
        Prolific lets you export your full submission history as a CSV — import it here and your totals, rates, and patterns come to life. New submissions will keep flowing in automatically as you do studies.
      </div>
      <button
        type="button"
        class="btn btn-primary btn-md gap-2 mt-5"
        onclick={() => fileInput?.click()}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Import CSV
      </button>
      <div class="text-[11px] text-base-content/45 mt-3">
        Get your export from <a href="https://app.prolific.com/submissions" target="_blank" rel="noreferrer" class="link link-hover">Prolific → Account → Submissions → Export</a>
      </div>
    </div>
  {:else}
    {#if droppedByCurrency.length > 0}
      <div class="rounded border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs flex items-center gap-2 text-base-content/70">
        <span class="text-amber-500 font-bold">⚠</span>
        <span>
          Excluded from totals:
          {#each droppedByCurrency as d, i (d.currency)}
            <span class="font-medium text-base-content/85">{d.count} {d.currency}</span>{i < droppedByCurrency.length - 1 ? ', ' : ''}
          {/each}
          — rate to {currency} pending. Set one manually in popup settings if needed.
        </span>
      </div>
    {/if}
    <!-- Summary cards -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
      {#each [
        { label: 'Today', value: today, prev: yesterday },
        { label: 'Last 7 days', value: last7, prev: prev7 },
        { label: 'Last 30 days', value: last30, prev: prev30 },
        { label: 'Last 90 days', value: last90, prev: NaN },
        { label: 'All time', value: allTime, prev: NaN },
      ] as card (card.label)}
        {@const d = delta(card.value, card.prev)}
        <div class="rounded-lg border border-base-300 bg-base-100 p-3">
          <div class="text-[11px] uppercase tracking-wide text-base-content/55 font-semibold">{card.label}</div>
          <div class="text-xl font-bold mt-0.5">{fmt(card.value)}</div>
          {#if d.text}
            <div class="text-xs font-semibold {d.cls} mt-0.5">{d.text}</div>
          {:else}
            <div class="text-xs mt-0.5">&nbsp;</div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Cumulative earnings + forecast -->
    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="font-semibold">Cumulative earnings · {range.label}</h2>
        <div class="text-xs text-base-content/55">
          {#if forecastSeries.length > 0}
            Dashed tail = 14-day forecast (per-weekday median · {forecastWeekdayStats?.total ?? 0}-day history)
          {:else if rangeEndsAtToday && forecastWeekdayStats && forecastWeekdayStats.total < FORECAST_MIN_HISTORY_DAYS}
            Need {FORECAST_MIN_HISTORY_DAYS} days of history for a forecast · you have {forecastWeekdayStats.total}
          {:else if !rangeEndsAtToday}
            Forecast shown only when range extends to today
          {/if}
        </div>
      </div>
      {#if cumulativeSeries.length === 0}
        <div class="text-center text-base-content/50 py-8">No data in range.</div>
      {:else}
        <div class="h-56">
          <Chart
            data={cumulativeChartData}
            x="date"
            y="scaleRef"
            yDomain={[0, cumulativeYMax]}
            yNice
            padding={{ left: 56, bottom: 24, top: 6, right: 6 }}
            tooltipContext={{ mode: 'bisect-x' }}
          >
            <Svg>
              <Axis placement="left" grid rule format={(v: number) => fmt(v)} ticks={5} />
              <Axis placement="bottom" rule format={(d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ticks={6} />
              {#if forecastSeries.length > 0}
                <Area
                  y0="forecast_p25"
                  y1="forecast_p75"
                  defined={(d: CumulativeChartPoint) => d.forecast_p75 !== null}
                  class="fill-primary/15"
                />
                <Spline
                  y="forecast_cumulative"
                  defined={(d: CumulativeChartPoint) => d.forecast_cumulative !== null}
                  class="stroke-primary/80 fill-none forecast-dashed"
                />
                <Rule
                  x={cumulativeSeries[cumulativeSeries.length - 1].date}
                  class="stroke-base-content/25 today-rule"
                />
              {/if}
              <Area
                y="actual_cumulative"
                defined={(d: CumulativeChartPoint) => d.actual_cumulative !== null}
                class="fill-primary/40"
              />
              <Spline
                y="actual_cumulative"
                defined={(d: CumulativeChartPoint) => d.actual_cumulative !== null}
                class="stroke-primary fill-none cumulative-line"
              />
              <Highlight points lines />
            </Svg>
            <Tooltip.Root>
              {#snippet children({ data }: { data: CumulativeChartPoint })}
                {@const lastForecast = forecastSeries[forecastSeries.length - 1]}
                <Tooltip.Header>
                  {data.date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                  {data.is_forecast ? ' · forecast' : ''}
                </Tooltip.Header>
                <Tooltip.List>
                  {#if data.is_forecast}
                    <Tooltip.Item label="Projected total" value={fmt(data.forecast_cumulative ?? NaN)} />
                    <Tooltip.Item label="P25 – P75" value={`${fmt(data.forecast_p25 ?? NaN)} – ${fmt(data.forecast_p75 ?? NaN)}`} />
                    <Tooltip.Item label="Expected that day" value={fmt(data.forecast_daily_median ?? NaN)} />
                  {:else}
                    <Tooltip.Item label="Cumulative" value={fmt(data.actual_cumulative ?? NaN)} />
                    <Tooltip.Item label="Earned that day" value={fmt(data.daily ?? 0)} />
                    {#if lastForecast}
                      <Tooltip.Separator />
                      <Tooltip.Item label="In 14 days (projected)" value={fmt(lastForecast.cumulative)} />
                      <Tooltip.Item label="P25 – P75" value={`${fmt(lastForecast.p25)} – ${fmt(lastForecast.p75)}`} />
                    {/if}
                  {/if}
                </Tooltip.List>
              {/snippet}
            </Tooltip.Root>
          </Chart>
        </div>
        <div class="mt-1.5 flex items-center gap-4 text-[11px] text-base-content/55 flex-wrap">
          <span class="inline-flex items-center gap-1.5">
            <span class="inline-block w-4 h-0.5 bg-primary"></span> Actual
          </span>
          {#if forecastSeries.length > 0}
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block w-4 border-t-2 border-dashed border-primary/70"></span> Forecast median
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block w-3 h-2.5 bg-primary/10 rounded"></span> Forecast P25 – P75 band
            </span>
          {/if}
        </div>

        {#if forecastSeries.length > 0}
          {@const last = forecastSeries[forecastSeries.length - 1]}
          <div class="mt-3 pt-3 border-t border-base-300 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="flex flex-col">
              <div class="text-[10.5px] uppercase tracking-wide text-base-content/55 font-semibold">
                By {last.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} you'll likely have
              </div>
              <div class="text-xl font-bold text-primary mt-0.5">{fmt(last.cumulative)}</div>
              <div class="text-[11px] text-base-content/55 mt-0.5">Based on your usual pace over the next 2 weeks</div>
            </div>
            <div class="flex flex-col">
              <div class="text-[10.5px] uppercase tracking-wide text-base-content/55 font-semibold">If the next 2 weeks are slow</div>
              <div class="text-xl font-semibold text-base-content/70 mt-0.5">{fmt(last.p25)}</div>
              <div class="text-[11px] text-base-content/55 mt-0.5">Low-end of your typical weekdays</div>
            </div>
            <div class="flex flex-col">
              <div class="text-[10.5px] uppercase tracking-wide text-base-content/55 font-semibold">If you're on a roll</div>
              <div class="text-xl font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">{fmt(last.p75)}</div>
              <div class="text-[11px] text-base-content/55 mt-0.5">High-end of your typical weekdays</div>
            </div>
          </div>
        {/if}
      {/if}
    </section>

    <!-- Daily/weekly/monthly earnings bar chart -->
    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="font-semibold">{barResolution === 'day' ? 'Daily' : barResolution === 'week' ? 'Weekly' : 'Monthly'} earnings · {range.label}</h2>
        <div class="text-xs text-base-content/55">
          Total {fmt(rangeTotals.combined)} · peak {fmt(Math.max(...dailySeries.map((d) => d.value), 0))}
        </div>
      </div>
      {#if dailySeries.length === 0}
        <div class="text-center text-base-content/50 py-8">No data in range.</div>
      {:else}
        <div class="h-48">
          <Chart
            data={dailySeries}
            x="date_key"
            xScale={scaleBand().padding(0.15)}
            y="value"
            yDomain={[0, null]}
            yNice
            padding={{ left: 48, bottom: 26, top: 6, right: 6 }}
          >
            {#snippet children({ context })}
              <Svg>
                <Axis placement="left" grid rule format={(v: number) => fmt(v)} ticks={5} />
                <Axis
                  placement="bottom"
                  rule
                  ticks={(scale) => {
                    const dom = (scale.domain() as string[]);
                    const total = dom.length;
                    return dom.filter((_, i) => barLabel(dailySeries[i].date, i, total, barResolution) !== '');
                  }}
                  format={(key: string) => {
                    const i = dailySeries.findIndex((d) => d.date_key === key);
                    if (i < 0) return '';
                    return barLabel(dailySeries[i].date, i, dailySeries.length, barResolution);
                  }}
                />
                {#each dailySeries as d (d.date_key)}
                  <Bar
                    data={d}
                    class={`${d.isWeekend ? 'fill-amber-400 dark:fill-amber-500' : 'fill-primary'} ${selectedDayKey === d.date_key ? 'opacity-100' : (selectedDayKey ? 'opacity-50' : '')} chart-bar-interactive`}
                    radius={2}
                    onpointerenter={(e) => context.tooltip.show(e, d)}
                    onpointermove={(e) => context.tooltip.show(e, d)}
                    onpointerleave={() => context.tooltip.hide()}
                    onclick={barResolution === 'day' ? (() => (selectedDayKey = selectedDayKey === d.date_key ? null : d.date_key)) : undefined}
                  />
                {/each}
              </Svg>
              <Tooltip.Root>
                {#snippet children({ data }: { data: DailyPoint })}
                  <Tooltip.Header>{data.spanLabel}</Tooltip.Header>
                  <Tooltip.List>
                    <Tooltip.Item label="Earned" value={fmt(data.value)} />
                    {#if data.submissionCount > 0}
                      <Tooltip.Item label="Submissions" value={data.submissionCount} />
                    {/if}
                  </Tooltip.List>
                {/snippet}
              </Tooltip.Root>
            {/snippet}
          </Chart>
        </div>
        <div class="mt-2 flex items-center gap-3 text-[11px] text-base-content/55 flex-wrap">
          {#if barResolution === 'day'}
            <span class="inline-flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-primary"></span> Weekday</span>
            <span class="inline-flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-amber-400 dark:bg-amber-500"></span> Weekend</span>
            <span class="text-base-content/40">·</span>
            <span>Click a bar for that day's submissions</span>
          {:else}
            <span>Auto-aggregated to {barResolution === 'week' ? 'weekly' : 'monthly'} bars for this range. Zoom in (30d / 90d) to see daily detail.</span>
          {/if}
        </div>
      {/if}

      {#if selectedDayKey && selectedDaySubmissions.length > 0}
        {@const parsed = parseDateKey(selectedDayKey)}
        <div class="mt-4 pt-4 border-t border-base-300">
          <div class="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
            <div>
              <div class="text-sm font-semibold">
                {parsed?.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) ?? selectedDayKey}
              </div>
              <div class="text-xs text-base-content/55">
                {selectedDaySubmissions.length} submission{selectedDaySubmissions.length === 1 ? '' : 's'} · total {fmt(selectedDayTotal)}
              </div>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onclick={() => (selectedDayKey = null)}
            >Close ✕</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-[11px] uppercase tracking-wide text-base-content/55 border-b border-base-300">
                <tr>
                  <th class="text-left py-1.5 font-semibold">Time</th>
                  <th class="text-left py-1.5 font-semibold">Study</th>
                  <th class="text-right py-1.5 font-semibold">Reward</th>
                  <th class="text-right py-1.5 font-semibold">Duration</th>
                  <th class="text-right py-1.5 font-semibold">$/hr</th>
                  <th class="text-right py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {#each selectedDaySubmissions as sub (sub.id)}
                  <tr class="border-b border-base-300/60 last:border-b-0 hover:bg-base-200/40">
                    <td class="py-1.5 text-base-content/65 whitespace-nowrap">
                      {sub.completed_at?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) ?? ''}
                    </td>
                    <td class="py-1.5 pr-2 truncate max-w-[360px]" title={sub.name}>{sub.name}</td>
                    <td class="text-right py-1.5 font-semibold">{fmt(sub.reward)}</td>
                    <td class="text-right py-1.5 text-base-content/60">{formatDurationSeconds(sub.duration ?? NaN)}</td>
                    <td class="text-right py-1.5">{sub.hourly !== null ? fmt(sub.hourly) : '—'}</td>
                    <td class="text-right py-1.5 text-base-content/60">{formatSubmissionStatus(sub.status)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </section>

    <!-- Rate comparison -->
    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <div class="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 class="font-semibold">How you're paid · {range.label}</h2>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        {#each rateAll as method (method.label)}
          {@const s = method.stats}
          <div class="rounded border border-base-300 p-3">
            <div class="flex items-baseline justify-between">
              <div class="font-semibold text-sm">{method.label}</div>
              <div class="text-[10px] text-base-content/50">n={s.n}</div>
            </div>
            <div class="text-[11px] text-base-content/55 mb-2 leading-snug">{method.description}</div>
            {#if s.n === 0}
              <div class="text-sm text-base-content/45 py-2">Not enough data.</div>
            {:else}
              <div class="grid grid-cols-2 gap-y-1 text-[12.5px]">
                <div class="text-base-content/55">Median</div>
                <div class="text-right font-bold text-emerald-600 dark:text-emerald-400">{fmt(s.median)}{method.suffix}</div>
                <div class="text-base-content/55">Mean</div>
                <div class="text-right font-semibold">{fmt(s.mean)}{method.suffix}</div>
                <div class="text-base-content/55">P25 – P75</div>
                <div class="text-right font-medium">{fmt(s.p25)} – {fmt(s.p75)}</div>
                <div class="text-base-content/55">Range</div>
                <div class="text-right font-medium">{fmt(s.min)} – {fmt(s.max)}</div>
              </div>
              {#if s.n_excluded_outliers > 0}
                <div class="mt-2 text-[10.5px] text-base-content/50">{s.n_excluded_outliers} extreme {s.n_excluded_outliers === 1 ? 'value' : 'values'} excluded</div>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
      <div class="mt-3 pt-3 border-t border-base-300 flex items-center justify-end gap-3 text-xs text-base-content/60 flex-wrap">
        <label class="flex items-center gap-1.5 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            class="checkbox checkbox-xs"
            checked={earningsPrefs.include_outliers}
            onchange={(e) => onEarningsPrefsChange({ ...earningsPrefs, include_outliers: (e.target as HTMLInputElement).checked })}
          />
          Include outliers
        </label>
      </div>
    </section>

    <!-- Per-submission scatter -->
    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <div class="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 class="font-semibold">Per-submission hourly rate · {range.label}</h2>
        <div class="text-xs text-base-content/55">
          Size = reward · colour = status
          {#if scatterOutlierCount > 0}
            · y-axis clipped to 98th percentile ({scatterOutlierCount} extreme point{scatterOutlierCount === 1 ? '' : 's'} hidden)
          {/if}
          {#if scatterData.length < scatterTotalInRange}
            · showing {scatterData.length.toLocaleString()} of {scatterTotalInRange.toLocaleString()} (sampled)
          {/if}
        </div>
      </div>
      {#if scatterData.length === 0}
        <div class="text-center text-base-content/50 py-8">
          No submissions with both reward and duration in this range.
        </div>
      {:else}
        <div class="h-72">
          <Chart
            data={scatterTrend.length >= 3 ? scatterTrend : scatterData}
            x="date"
            xDomain={scatterXDomain}
            y={scatterTrend.length >= 3 ? 'median' : 'hourly'}
            yDomain={[0, scatterYMax]}
            yNice
            padding={{ left: 56, bottom: 28, top: 6, right: 6 }}
            tooltipContext={scatterTrend.length >= 3 ? { mode: 'bisect-x' } : undefined}
          >
            {#snippet children({ context })}
              <Svg>
                <Axis placement="left" grid rule ticks={5} format={(v: number) => fmt(v)} />
                <Axis placement="bottom" rule format={(d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ticks={6} />
                <ChartClipPath>
                  {#each scatterData as p, idx (idx)}
                    {@const cls = p.color_key === 'approved'
                      ? 'fill-primary/35 dark:fill-primary/45'
                      : p.color_key === 'pending'
                      ? 'fill-amber-400/40 dark:fill-amber-500/50'
                      : 'fill-rose-400/40 dark:fill-rose-500/45'}
                    <Circle
                      cx={context.xScale?.(p.date)}
                      cy={context.yScale?.(Math.min(p.hourly, scatterYMax))}
                      r={scatterRadius(p.reward, scatterMaxReward)}
                      class={`${cls} scatter-dot-interactive`}
                      onpointerenter={(e) => { e.stopPropagation(); context.tooltip.show(e, p); }}
                      onpointermove={(e) => { e.stopPropagation(); context.tooltip.show(e, p); }}
                      onpointerleave={(e) => { e.stopPropagation(); context.tooltip.hide(); }}
                    />
                  {/each}
                  {#if scatterTrend.length >= 3}
                    <Area
                      data={scatterTrend}
                      x="date"
                      y0="p25"
                      y1="p75"
                      class="fill-emerald-500/15 dark:fill-emerald-400/15 pointer-events-none"
                    />
                    <Spline
                      data={scatterTrend}
                      x="date"
                      y="median"
                      class="stroke-emerald-500 dark:stroke-emerald-400 fill-none scatter-trend-line pointer-events-none"
                    />
                    <Highlight
                      points={{ class: 'pointer-events-none' }}
                      lines={{ class: 'pointer-events-none' }}
                    />
                  {/if}
                </ChartClipPath>
              </Svg>
              <Tooltip.Root>
                {#snippet children({ data })}
                  {#if data && 'study_name' in (data as object)}
                    {@const p = data as ScatterPoint}
                    <Tooltip.Header>{p.study_name}</Tooltip.Header>
                    <Tooltip.List>
                      <Tooltip.Item label="Date" value={p.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} />
                      <Tooltip.Item label="Reward" value={fmt(p.reward)} />
                      <Tooltip.Item label="Duration" value={formatDurationSeconds(p.duration_seconds)} />
                      <Tooltip.Item label="Rate" value={`${fmt(p.hourly)}/hr`} />
                      <Tooltip.Item label="Status" value={formatSubmissionStatus(p.status)} />
                    </Tooltip.List>
                  {:else if data && 'median' in (data as object)}
                    {@const t = data as ScatterTrendPoint}
                    <Tooltip.Header>
                      {t.date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                    </Tooltip.Header>
                    <Tooltip.List>
                      <Tooltip.Item label="Rolling median" value={`${fmt(t.median)}/hr`} />
                      <Tooltip.Item label="P25 – P75" value={`${fmt(t.p25)} – ${fmt(t.p75)}/hr`} />
                      <Tooltip.Item label="Span" value={`${fmt(t.p75 - t.p25)}/hr`} />
                    </Tooltip.List>
                  {/if}
                {/snippet}
              </Tooltip.Root>
            {/snippet}
          </Chart>
        </div>
        <div class="mt-2 flex items-center gap-4 text-[11px] text-base-content/55 flex-wrap">
          <span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-primary/45"></span> Approved</span>
          <span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-400/50 dark:bg-amber-500/60"></span> Awaiting review</span>
          <span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-rose-400/45 dark:bg-rose-500/55"></span> Other</span>
          {#if scatterTrend.length >= 3}
            <span class="text-base-content/40">·</span>
            <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5 bg-emerald-500 dark:bg-emerald-400"></span> Rolling median</span>
            <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded bg-emerald-500/15 dark:bg-emerald-400/15"></span> P25 – P75</span>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Day-of-week + Hour-of-day -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <section class="rounded-lg border border-base-300 bg-base-100 p-4">
        <div class="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
          <h2 class="font-semibold">Day of week · {range.label}</h2>
          <div role="tablist" class="flex rounded-md border border-base-300 overflow-hidden text-[11px]" aria-label="DoW metric">
            {#each ['earned', 'rate'] as const as m (m)}
              <button
                type="button"
                class="px-2.5 py-1 border-r border-base-300 last:border-r-0 cursor-pointer {dowMetric === m ? 'bg-primary text-primary-content font-semibold' : 'hover:bg-base-200 text-base-content/70'}"
                onclick={() => (dowMetric = m)}
              >{m === 'earned' ? 'Total earned' : 'Median $/hr'}</button>
            {/each}
          </div>
        </div>
        <div class="h-36">
          <Chart
            data={dowBuckets}
            x="label"
            xScale={scaleBand().padding(0.2)}
            y="value"
            yDomain={[0, null]}
            yNice
            padding={{ left: 48, bottom: 22, top: 6, right: 6 }}
          >
            {#snippet children({ context })}
              <Svg>
                <Axis placement="left" grid rule format={(v: number) => fmt(v)} ticks={4} />
                <Axis placement="bottom" rule />
                {#each dowBuckets as b (b.dow)}
                  {@const hasData = dowMetric === 'earned' ? b.earned > 0 : b.rate_sample_count > 0}
                  <Bar
                    data={b}
                    class={`${b.isWeekend ? 'fill-amber-400 dark:fill-amber-500' : 'fill-primary'} ${hasData ? 'chart-bar-interactive' : 'opacity-20'}`}
                    radius={3}
                    onpointerenter={(e) => context.tooltip.show(e, b)}
                    onpointermove={(e) => context.tooltip.show(e, b)}
                    onpointerleave={() => context.tooltip.hide()}
                  />
                {/each}
              </Svg>
              <Tooltip.Root>
                {#snippet children({ data })}
                  {@const b = data as typeof dowBuckets[number]}
                  <Tooltip.Header>{b.label}</Tooltip.Header>
                  <Tooltip.List>
                    <Tooltip.Item label="Total earned" value={fmt(b.earned)} />
                    <Tooltip.Item label="Median $/hr" value={b.rate_sample_count > 0 ? `${fmt(b.rate)} · ${b.rate_sample_count} sample${b.rate_sample_count === 1 ? '' : 's'}` : '—'} />
                    <Tooltip.Item label="Submissions" value={b.submission_count} />
                    <Tooltip.Item label="Active days" value={b.active_days} />
                  </Tooltip.List>
                {/snippet}
              </Tooltip.Root>
            {/snippet}
          </Chart>
        </div>
        <div class="mt-2 grid grid-cols-7 gap-1 text-center">
          {#each dowBuckets as b (b.dow)}
            {@const displayValue = dowMetric === 'rate' ? b.rate : b.earned}
            {@const hasData = dowMetric === 'earned' ? b.earned > 0 : b.rate_sample_count > 0}
            <div>
              <div class="text-[11px] font-semibold text-base-content/70">{DOW_LABELS[b.dow]}</div>
              <div class="text-[11px] font-bold {hasData ? 'text-base-content' : 'text-base-content/30'}">{hasData ? fmt(displayValue) : '—'}</div>
              <div class="text-[9.5px] text-base-content/45 leading-tight">{b.active_days}d · {b.submission_count}s</div>
            </div>
          {/each}
        </div>
      </section>

      <section class="rounded-lg border border-base-300 bg-base-100 p-4 flex flex-col">
        <div class="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
          <h2 class="font-semibold">Hour of day · {range.label}</h2>
          <div role="tablist" class="flex rounded-md border border-base-300 overflow-hidden text-[11px]" aria-label="Hour metric">
            {#each ['earned', 'rate'] as const as m (m)}
              <button
                type="button"
                class="px-2.5 py-1 border-r border-base-300 last:border-r-0 cursor-pointer {hourMetric === m ? 'bg-primary text-primary-content font-semibold' : 'hover:bg-base-200 text-base-content/70'}"
                onclick={() => (hourMetric = m)}
              >{m === 'earned' ? 'Total earned' : 'Median $/hr'}</button>
            {/each}
          </div>
        </div>
        <div class="flex-1 min-h-[140px]">
          <Chart
            data={hourBuckets}
            x="label"
            xScale={scaleBand().padding(0.15)}
            y="value"
            yDomain={[0, null]}
            yNice
            padding={{ left: 40, bottom: 22, top: 6, right: 6 }}
          >
            {#snippet children({ context })}
              <Svg>
                <Axis placement="left" grid rule ticks={4} format={(v: number) => fmt(v)} />
                <Axis
                  placement="bottom"
                  rule
                  ticks={(scale) => (scale.domain() as string[]).filter((_, i) => i % 3 === 0)}
                />
                {#each hourBuckets as b (b.hour)}
                  {@const hasData = hourMetric === 'earned' ? b.earned > 0 : b.rate_sample_count > 0}
                  <Bar
                    data={b}
                    class={`fill-primary ${hasData ? 'chart-bar-interactive' : 'opacity-20'}`}
                    radius={2}
                    onpointerenter={(e) => context.tooltip.show(e, b)}
                    onpointermove={(e) => context.tooltip.show(e, b)}
                    onpointerleave={() => context.tooltip.hide()}
                  />
                {/each}
              </Svg>
              <Tooltip.Root>
                {#snippet children({ data })}
                  {@const b = data as typeof hourBuckets[number]}
                  <Tooltip.Header>{b.hour}:00 – {b.hour + 1}:00</Tooltip.Header>
                  <Tooltip.List>
                    <Tooltip.Item label="Total earned" value={fmt(b.earned)} />
                    <Tooltip.Item label="Median $/hr" value={b.rate_sample_count > 0 ? `${fmt(b.rate)} · ${b.rate_sample_count} sample${b.rate_sample_count === 1 ? '' : 's'}` : '—'} />
                    <Tooltip.Item label="Submissions" value={b.submission_count} />
                  </Tooltip.List>
                {/snippet}
              </Tooltip.Root>
            {/snippet}
          </Chart>
        </div>
      </section>
    </div>

    <!-- DOW × Hour heatmap -->
    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="font-semibold">When you work · {range.label}</h2>
        <div class="text-xs text-base-content/55">Submissions by weekday and hour (local). Darker = more.</div>
      </div>
      {#if heatmapMax === 0}
        <div class="text-center text-base-content/50 py-8">No submissions with timestamps in range.</div>
      {:else}
        <div class="heatmap relative" style="display: grid; grid-template-columns: 36px repeat(24, minmax(0, 1fr)); gap: 2px;">
          <!-- Hour labels row -->
          <div></div>
          {#each Array(24) as _, h (h)}
            <div class="text-[9.5px] text-base-content/50 text-center">{h % 3 === 0 ? h : ''}</div>
          {/each}
          <!-- Data rows: Mon..Sun (reordered so weekend is last) -->
          {#each [1, 2, 3, 4, 5, 6, 0] as dow (dow)}
            <div class="text-[10.5px] text-base-content/65 pr-1 font-medium flex items-center justify-end">{DOW_LABELS[dow]}</div>
            {#each Array(24) as _, h (h)}
              {@const cell = heatmapCell(dow, h)}
              {@const alpha = heatmapAlpha(cell.submission_count)}
              {@const isHovered = heatHover?.dow === dow && heatHover?.hour === h}
              <div
                class="rounded-sm cursor-crosshair heatmap-cell"
                class:is-hovered={isHovered}
                style="aspect-ratio: 1 / 1; min-height: 18px; background-color: {alpha > 0 ? `oklch(0.70 0.18 268 / ${Math.max(0.08, alpha)})` : 'oklch(0.5 0 0 / 0.05)'};"
                role="img"
                aria-label={`${DOW_LABELS[dow]} ${h}:00 — ${cell.submission_count} submissions`}
                onpointerenter={() => (heatHover = { dow, hour: h, count: cell.submission_count, reward: cell.reward_minor / 100 })}
                onpointerleave={() => (heatHover = null)}
              ></div>
            {/each}
          {/each}
        </div>
        <div class="mt-3 flex items-center gap-3 text-[11px] text-base-content/60 flex-wrap">
          {#if heatHover}
            <span class="font-semibold text-base-content">
              {DOW_LABELS[heatHover.dow]} {heatHover.hour}:00 – {heatHover.hour + 1}:00
            </span>
            <span class="text-base-content/65">{heatHover.count} submission{heatHover.count === 1 ? '' : 's'} · {fmt(heatHover.reward)}</span>
          {:else}
            <span>Hover a cell for details.</span>
          {/if}
          <span class="ml-auto inline-flex items-center gap-2">
            <span>Less</span>
            {#each [0.2, 0.4, 0.6, 0.8, 1.0] as a (a)}
              <span class="inline-block w-3.5 h-3.5 rounded-sm" style="background-color: oklch(0.70 0.18 268 / {a})"></span>
            {/each}
            <span>More</span>
            <span class="pl-3 text-base-content/55">Peak: {heatmapMax} in a single hour</span>
          </span>
        </div>
      {/if}
    </section>

    <!-- Leaderboards -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <section class="rounded-lg border border-base-300 bg-base-100 p-4">
        <h2 class="font-semibold mb-3">Top studies · {range.label}</h2>
        {#if fullStudyBoard.length === 0}
          <div class="text-sm text-base-content/50 py-4">No studies in range.</div>
        {:else}
          <table class="w-full text-sm">
            <thead class="text-[11px] uppercase tracking-wide text-base-content/55 border-b border-base-300">
              <tr>
                {#each studyCols as col (col.key)}
                  <th class="{col.align} py-1.5 font-semibold">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 hover:text-base-content cursor-pointer"
                      onclick={() => (studySort = cycleSort(studySort, col.key))}
                    >
                      {col.label}
                      <span class="text-[9px] opacity-70">
                        {studySort.key === col.key ? (studySort.dir === 'desc' ? '▼' : '▲') : '↕'}
                      </span>
                    </button>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each sortedStudyBoard as s (s.key)}
                <tr class="border-b border-base-300/60 last:border-b-0">
                  <td class="py-1.5 pr-2 truncate max-w-[320px]" title={s.label}>{s.label}</td>
                  <td class="text-right py-1.5 font-semibold">{fmt(s.reward_minor / 100)}</td>
                  <td class="text-right py-1.5">{fmt(studyMedian.get(s.key) ?? NaN)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if fullStudyBoard.length > studyLimit}
            <button
              type="button"
              class="btn btn-ghost btn-xs w-full mt-2 text-base-content/60 hover:text-base-content"
              onclick={() => (studyLimit += LEADERBOARD_PAGE)}
            >
              Show {Math.min(LEADERBOARD_PAGE, fullStudyBoard.length - studyLimit)} more · {fullStudyBoard.length - studyLimit} remaining
            </button>
          {/if}
        {/if}
      </section>

      <section class="rounded-lg border border-base-300 bg-base-100 p-4">
        <h2 class="font-semibold mb-3">Top researchers · {range.label}</h2>
        {#if fullResearcherBoard.length === 0}
          <div class="text-sm text-base-content/50 py-4">No researchers in range.</div>
        {:else}
          <table class="w-full text-sm">
            <thead class="text-[11px] uppercase tracking-wide text-base-content/55 border-b border-base-300">
              <tr>
                {#each researcherCols as col (col.key)}
                  <th class="{col.align} py-1.5 font-semibold">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 hover:text-base-content cursor-pointer"
                      onclick={() => (researcherSort = cycleSort(researcherSort, col.key))}
                    >
                      {col.label}
                      <span class="text-[9px] opacity-70">
                        {researcherSort.key === col.key ? (researcherSort.dir === 'desc' ? '▼' : '▲') : '↕'}
                      </span>
                    </button>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each sortedResearcherBoard as r (r.key)}
                <tr class="border-b border-base-300/60 last:border-b-0">
                  <td class="py-1.5 pr-2 truncate max-w-[280px]" title={r.label}>{r.label}</td>
                  <td class="text-right py-1.5 font-semibold">{fmt(r.reward_minor / 100)}</td>
                  <td class="text-right py-1.5 text-base-content/55">{r.submission_count}</td>
                  <td class="text-right py-1.5">{fmt(researcherMedian.get(r.key) ?? NaN)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if fullResearcherBoard.length > researcherLimit}
            <button
              type="button"
              class="btn btn-ghost btn-xs w-full mt-2 text-base-content/60 hover:text-base-content"
              onclick={() => (researcherLimit += LEADERBOARD_PAGE)}
            >
              Show {Math.min(LEADERBOARD_PAGE, fullResearcherBoard.length - researcherLimit)} more · {fullResearcherBoard.length - researcherLimit} remaining
            </button>
          {/if}
        {/if}
      </section>
    </div>
  {/if}
</div>
