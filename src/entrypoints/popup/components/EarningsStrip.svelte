<script lang="ts">
  import type { SubmissionRecord } from '../../../lib/db';
  import {
    filterEligible,
    computeTotals,
    perHourOfWorkDaily,
    summarizeRates,
    daysAgo,
    startOfLocalDay,
    resolveEarningsContext,
  } from '../../../lib/earnings';
  import { formatMoneyFromMajorUnits } from '../../../lib/format';
  import type { EarningsPrefs } from '../../../lib/earnings-prefs';

  let { submissions, prefs, onTogglePending } = $props<{
    submissions: SubmissionRecord[];
    prefs: EarningsPrefs;
    onTogglePending: (enabled: boolean) => void;
  }>();

  const ctx = $derived(resolveEarningsContext(submissions, prefs));
  const currency = $derived(ctx.currency);
  const includeStatus = $derived(ctx.includeStatus);
  const convertedSubmissions = $derived(ctx.converted);

  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const sevenDaysAgo = daysAgo(7, now);
  const thirtyDaysAgo = daysAgo(30, now);

  function totalsMajor(start?: Date) {
    if (!currency) return { total: 0, approved: 0, pending: 0 };
    const records = filterEligible(convertedSubmissions, {
      includeStatus,
      currency,
      start,
    });
    const t = computeTotals(records, currency);
    return {
      total: (prefs.include_pending ? t.combined_minor : t.approved_minor) / 100,
      approved: t.approved_minor / 100,
      pending: t.pending_minor / 100,
    };
  }

  const today = $derived(totalsMajor(todayStart));
  const last7 = $derived(totalsMajor(sevenDaysAgo));
  const last30 = $derived(totalsMajor(thirtyDaysAgo));
  const allTime = $derived(totalsMajor());

  const rateStats = $derived.by(() => {
    if (!currency) return null;
    const records = filterEligible(convertedSubmissions, {
      includeStatus,
      currency,
      start: daysAgo(30, now),
    });
    return summarizeRates(perHourOfWorkDaily(records));
  });

  function fmt(major: number): string {
    if (!currency) return '—';
    return formatMoneyFromMajorUnits(major, currency);
  }

  function pendingTooltip(c: { approved: number; pending: number }): string {
    if (c.pending <= 0) return '';
    return ` (${fmt(c.approved)} approved + ${fmt(c.pending)} pending)`;
  }
</script>

<div class="earnings-strip mb-2.5 rounded-lg border border-base-300 bg-base-100 p-2.5 text-[12.5px]">
  {#if !currency}
    <div class="text-center text-base-content/55 py-1">
      No earnings yet — approved submissions will appear here.
    </div>
  {:else}
    <div class="flex items-baseline justify-between gap-2 flex-wrap">
      <div class="flex items-baseline gap-x-3.5 gap-y-1 flex-wrap">
        <div class="flex flex-col leading-tight" title={`Since ${todayStart.toLocaleString()}${pendingTooltip(today)}`}>
          <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold">Today</span>
          <span class="text-[14px] font-bold text-primary">{fmt(today.total)}</span>
        </div>
        <div class="flex flex-col leading-tight" title={`Last 7 days${pendingTooltip(last7)}`}>
          <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold">7d</span>
          <span class="text-[14px] font-bold">{fmt(last7.total)}</span>
        </div>
        <div class="flex flex-col leading-tight" title={`Last 30 days${pendingTooltip(last30)}`}>
          <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold">30d</span>
          <span class="text-[14px] font-bold">{fmt(last30.total)}</span>
        </div>
        <div class="flex flex-col leading-tight" title={`All time${pendingTooltip(allTime)}`}>
          <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold">All time</span>
          <span class="text-[14px] font-bold">{fmt(allTime.total)}</span>
        </div>
        {#if rateStats && rateStats.n > 0}
          <div
            class="flex flex-col leading-tight"
            title={`Your reward ÷ the actual time you spent on studies, per day (last 30d median)\nMean ${fmt(rateStats.mean)}/hr · ${rateStats.n} day${rateStats.n === 1 ? '' : 's'}${rateStats.n_excluded_outliers ? ` · ${rateStats.n_excluded_outliers} outliers excluded` : ''}`}
          >
            <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold">Rate (30d)</span>
            <span class="text-[14px] font-bold text-emerald-600 dark:text-emerald-400">{fmt(rateStats.median)}<span class="text-[10.5px] text-base-content/50 font-medium">/hr</span></span>
          </div>
        {/if}
      </div>
      <label class="flex items-center gap-1.5 text-[11.5px] text-base-content/70 cursor-pointer select-none whitespace-nowrap">
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          checked={prefs.include_pending}
          onchange={(e) => onTogglePending((e.target as HTMLInputElement).checked)}
        />
        Include pending
      </label>
    </div>
  {/if}
</div>
