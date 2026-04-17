<script lang="ts">
  import { browser } from 'wxt/browser';
  import type { SubmissionRecord } from '../../../lib/db';
  import type { EarningsPrefs } from '../../../lib/earnings-prefs';
  import {
    filterEligible,
    computeTotals,
    perSubmissionHourlySeries,
    perHourOfWorkDaily,
    dailyRollups,
    summarizeRates,
    daysAgo,
    startOfLocalDay,
    addLocalDays,
    localDateKey,
    resolveEarningsContext,
    type RateStats,
  } from '../../../lib/earnings';
  import { formatMoneyFromMajorUnits } from '../../../lib/format';
  import { Area, Axis, Chart, Highlight, Svg, Tooltip } from 'layerchart';

  let { active, allSubmissions, earningsPrefs, onEarningsPrefsChange, overrideMessage } = $props<{
    active: boolean;
    allSubmissions: SubmissionRecord[];
    earningsPrefs: EarningsPrefs;
    onEarningsPrefsChange: (prefs: EarningsPrefs) => void;
    overrideMessage: string;
  }>();

  type RateMethod = 'per_submission' | 'per_hour_of_work' | 'per_active_day';
  let rateMethod: RateMethod = $state('per_hour_of_work');

  function methodSuffix(m: RateMethod): string {
    return m === 'per_active_day' ? '/day' : '/hr';
  }

  const ctx = $derived(resolveEarningsContext(allSubmissions, earningsPrefs));
  const currency = $derived(ctx.currency);
  const includeStatus = $derived(ctx.includeStatus);
  const convertedSubmissions = $derived(ctx.converted);

  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = addLocalDays(todayStart, -1);
  const sevenDaysAgo = daysAgo(7, now);
  const fourteenDaysAgo = daysAgo(14, now);
  const thirtyDaysAgo = daysAgo(30, now);
  const sixtyDaysAgo = daysAgo(60, now);

  function totalFor(start?: Date, end?: Date): number {
    if (!currency) return 0;
    const records = filterEligible(convertedSubmissions, { includeStatus, currency, start, end });
    const t = computeTotals(records, currency);
    return (earningsPrefs.include_pending ? t.combined_minor : t.approved_minor) / 100;
  }

  const today = $derived(totalFor(todayStart));
  const yesterday = $derived(totalFor(yesterdayStart, todayStart));
  const last7 = $derived(totalFor(sevenDaysAgo));
  const prev7 = $derived(totalFor(fourteenDaysAgo, sevenDaysAgo));
  const last30 = $derived(totalFor(thirtyDaysAgo));
  const prev30 = $derived(totalFor(sixtyDaysAgo, thirtyDaysAgo));
  const allTime = $derived(totalFor());

  const eligible30d = $derived(
    filterEligible(convertedSubmissions, { includeStatus, currency, start: thirtyDaysAgo }),
  );
  const eligibleAll = $derived(
    filterEligible(convertedSubmissions, { includeStatus, currency }),
  );

  // Sparkline: daily earnings over last 30 days
  interface SparkPoint { date: Date; value: number; }
  const sparkData: SparkPoint[] = $derived.by(() => {
    if (!currency) return [];
    const rollups = dailyRollups(eligible30d);
    const byKey = new Map(rollups.map((r) => [r.date_key, r.reward_minor / 100]));
    const out: SparkPoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = daysAgo(i, now);
      out.push({ date: d, value: byKey.get(localDateKey(d)) ?? 0 });
    }
    return out;
  });

  const rateStats: RateStats = $derived.by(() => {
    if (!currency) return summarizeRates([]);
    if (rateMethod === 'per_submission') {
      return summarizeRates(perSubmissionHourlySeries(eligibleAll));
    }
    if (rateMethod === 'per_hour_of_work') {
      return summarizeRates(perHourOfWorkDaily(eligibleAll));
    }
    // per_active_day: median £/day across days with ≥3 submissions
    const rollups = dailyRollups(eligibleAll).filter((r) => r.submission_count >= 3);
    return summarizeRates(rollups.map((r) => r.reward_minor / 100));
  });

  function fmt(major: number): string {
    if (!currency) return '—';
    if (!Number.isFinite(major)) return '—';
    return formatMoneyFromMajorUnits(major, currency);
  }

  function delta(current: number, previous: number): { text: string; cls: string } {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return { text: '', cls: '' };
    if (previous === 0 && current === 0) return { text: '—', cls: 'text-base-content/40' };
    if (previous === 0) return { text: '↑', cls: 'text-emerald-500' };
    const diff = current - previous;
    if (diff === 0) return { text: '—', cls: 'text-base-content/40' };
    const pct = Math.round((diff / previous) * 100);
    const arrow = diff > 0 ? '↑' : '↓';
    const cls = diff > 0 ? 'text-emerald-500' : 'text-rose-500';
    return { text: `${arrow} ${Math.abs(pct)}%`, cls };
  }

  const todayDelta = $derived(delta(today, yesterday));
  const sevenDelta = $derived(delta(last7, prev7));
  const thirtyDelta = $derived(delta(last30, prev30));

  async function openFullView() {
    const url = browser.runtime.getURL('/app.html#/earnings');
    await browser.tabs.create({ url, active: true });
    window.close();
  }

  function togglePending(e: Event) {
    onEarningsPrefsChange({
      ...earningsPrefs,
      include_pending: (e.target as HTMLInputElement).checked,
    });
  }

  function methodLabel(m: RateMethod): string {
    if (m === 'per_submission') return 'Per submission';
    if (m === 'per_hour_of_work') return 'Per hour of work';
    return 'Per active day';
  }

  function methodDescription(m: RateMethod): string {
    if (m === 'per_submission') return 'Each study: reward ÷ its own duration. Sensitive to very short tasks.';
    if (m === 'per_hour_of_work') return 'Your reward ÷ the time you actually spent on studies, per day. Your honest earning rate.';
    return 'What you typically earn on a day you did Prolific (≥ 3 submissions).';
  }
</script>

<div id="panelEarnings" class="panel" class:active role="tabpanel" aria-labelledby="tabEarnings">
  {#if overrideMessage}
    <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100 min-h-[420px] flex items-center justify-center">
      {overrideMessage}
    </div>
  {:else if !currency}
    <div class="p-8 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100 min-h-[420px] flex flex-col items-center justify-center gap-3">
      <div class="text-base-content/60 max-w-xs leading-snug">
        No earnings yet. Complete a study — or import your submission history from Prolific to see past totals.
      </div>
      <button type="button" class="btn btn-primary btn-sm gap-2" onclick={openFullView}>
        Open full view to import CSV →
      </button>
    </div>
  {:else}
    <div class="earnings-panel space-y-3 min-h-[420px] max-h-[420px] scroll-container pb-1">
      <!-- 4 summary cards -->
      <div class="grid grid-cols-4 gap-2">
        {#each [
          { label: 'Today', value: today, delta: todayDelta, highlight: true },
          { label: '7 days', value: last7, delta: sevenDelta, highlight: false },
          { label: '30 days', value: last30, delta: thirtyDelta, highlight: false },
          { label: 'All time', value: allTime, delta: { text: '', cls: '' }, highlight: false },
        ] as card (card.label)}
          <div class="rounded-lg border border-base-300 bg-base-100 p-2.5 flex flex-col leading-tight">
            <div class="text-[10px] uppercase tracking-wide text-base-content/50 font-semibold">{card.label}</div>
            <div class="text-[15px] font-bold {card.highlight ? 'text-primary' : ''}">{fmt(card.value)}</div>
            {#if card.delta.text}
              <div class="text-[10.5px] font-semibold {card.delta.cls}">{card.delta.text}</div>
            {:else}
              <div class="text-[10.5px]">&nbsp;</div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Sparkline -->
      <div class="rounded-lg border border-base-300 bg-base-100 p-2.5">
        <div class="flex items-baseline justify-between mb-1">
          <div class="text-[11px] uppercase tracking-wide text-base-content/55 font-semibold">Daily earnings · 30d</div>
          <div class="text-[10.5px] text-base-content/45">Peak {fmt(Math.max(...sparkData.map((p) => p.value), 0))}</div>
        </div>
        <div class="h-14">
          <Chart
            data={sparkData}
            x="date"
            y="value"
            yDomain={[0, null]}
            padding={{ left: 0, right: 0, top: 2, bottom: 2 }}
            tooltipContext={{ mode: 'bisect-x' }}
          >
            <Svg>
              <Area
                line={{ class: 'stroke-primary stroke-2' }}
                class="fill-primary/20"
              />
              <Highlight points lines />
            </Svg>
            <Tooltip.Root>
              {#snippet children({ data }: { data: SparkPoint })}
                <Tooltip.Header>{data.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Tooltip.Header>
                <Tooltip.List>
                  <Tooltip.Item label="Earned" value={fmt(data.value)} />
                </Tooltip.List>
              {/snippet}
            </Tooltip.Root>
          </Chart>
        </div>
      </div>

      <!-- Rate -->
      <div class="rounded-lg border border-base-300 bg-base-100 p-2.5">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="text-[11px] uppercase tracking-wide text-base-content/55 font-semibold">Effective rate</div>
          <div role="tablist" class="flex rounded-md border border-base-300 overflow-hidden text-[11px]" aria-label="Rate calculation method">
            {#each ['per_submission', 'per_hour_of_work', 'per_active_day'] as const as m (m)}
              <button
                type="button"
                role="tab"
                aria-selected={rateMethod === m}
                class="px-2 py-1 border-r border-base-300 last:border-r-0 cursor-pointer {rateMethod === m ? 'bg-primary text-primary-content font-semibold' : 'hover:bg-base-200 text-base-content/70'}"
                onclick={() => (rateMethod = m)}
              >{methodLabel(m)}</button>
            {/each}
          </div>
        </div>
        {#if rateStats.n === 0}
          <div class="text-center text-sm text-base-content/50 py-3">Not enough data for this method yet.</div>
        {:else}
          <div class="grid grid-cols-4 gap-2 text-[12px]">
            {#each [
              { label: 'Median', value: rateStats.median, emphasis: true },
              { label: 'Mean', value: rateStats.mean, emphasis: false },
              { label: 'P25', value: rateStats.p25, emphasis: false },
              { label: 'P75', value: rateStats.p75, emphasis: false },
            ] as stat (stat.label)}
              <div class="flex flex-col leading-tight">
                <span class="text-[10px] uppercase tracking-wide text-base-content/45 font-semibold">{stat.label}</span>
                <span class="{stat.emphasis ? 'text-[14px] font-bold text-emerald-600 dark:text-emerald-400' : 'text-[12px] font-semibold'}">{fmt(stat.value)}<span class="text-[10px] font-medium text-base-content/50">{methodSuffix(rateMethod)}</span></span>
              </div>
            {/each}
          </div>
          <div class="mt-2 text-[10.5px] text-base-content/55 flex items-center justify-between gap-2">
            <span>{methodDescription(rateMethod)}</span>
            <span class="whitespace-nowrap">n={rateStats.n}{rateStats.n_excluded_outliers ? ` · ${rateStats.n_excluded_outliers} outlier${rateStats.n_excluded_outliers === 1 ? '' : 's'} excluded` : ''}</span>
          </div>
        {/if}
      </div>

      <!-- Footer controls -->
      <div class="flex items-center justify-between gap-2 flex-wrap pt-0.5">
        <label class="flex items-center gap-1.5 text-[11.5px] text-base-content/70 cursor-pointer select-none">
          <input
            type="checkbox"
            class="checkbox checkbox-xs"
            checked={earningsPrefs.include_pending}
            onchange={togglePending}
          />
          Include pending (awaiting review)
        </label>
        <button
          type="button"
          class="btn btn-primary btn-xs"
          onclick={openFullView}
        >Open full view →</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .panel { display: none; }
  .panel.active { display: block; }
</style>
