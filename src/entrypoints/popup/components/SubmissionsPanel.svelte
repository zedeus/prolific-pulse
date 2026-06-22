<script lang="ts">
  import type { Submission } from '../../../lib/types';
  import type { SubmissionRecord } from '../../../lib/db';
  import type { EarningsPrefs } from '../../../lib/earnings-prefs';
  import { extractResearcherFromSubmissionPayload } from '../../../lib/store';
  import {
    formatMoneyFromMinorUnits,
    formatMoneyFromMajorUnits,
    moneyMajorValue,
    formatDurationSeconds,
    formatRelative,
    parseDate,
    studyUrlFromId,
    formatSubmissionStatus,
    normalizeSubmissionStatus,
    rateColorClass,
    getCurrencySymbol,
  } from '../../../lib/format';
  import {
    APPROVED_STATUS,
    AWAITING_REVIEW_STATUS,
    TERMINAL_NEGATIVE_STATUSES,
    extractSubmissionReward,
    extractDurationSeconds,
  } from '../../../lib/earnings';
  import EarningsStrip from './EarningsStrip.svelte';
  import StudyTitle from './StudyTitle.svelte';

  let {
    active,
    submissions,
    allSubmissions,
    earningsPrefs,
    overrideMessage,
    onStudyClick,
    onEarningsPrefsChange,
  } = $props<{
    active: boolean;
    submissions: Submission[];
    allSubmissions: SubmissionRecord[];
    earningsPrefs: EarningsPrefs;
    overrideMessage: string;
    onStudyClick: (url: string) => void;
    onEarningsPrefsChange: (prefs: EarningsPrefs) => void;
  }>();

  type SortKey = 'newest' | 'reward';
  type StatusFilter = 'all' | 'approved' | 'pending' | 'rejected';

  let sortKey = $state<SortKey>('newest');
  let searchQuery = $state('');
  let statusFilter = $state<StatusFilter>('all');
  let filtersExpanded = $state(false);
  let minReward = $state<number | null>(null);
  let minHourly = $state<number | null>(null);
  let maxDuration = $state<number | null>(null);

  const currencySymbol = $derived(getCurrencySymbol(earningsPrefs.primary_currency));

  const hasNumericFilters = $derived(
    (minReward !== null && minReward > 0) ||
    (minHourly !== null && minHourly > 0) ||
    (maxDuration !== null && maxDuration > 0)
  );

  const hasActiveFilters = $derived(
    searchQuery.trim() !== '' || statusFilter !== 'all' || hasNumericFilters
  );

  function getStatusCategory(status: string): 'approved' | 'pending' | 'rejected' {
    const upper = normalizeSubmissionStatus(status);
    if (upper === APPROVED_STATUS) return 'approved';
    if (TERMINAL_NEGATIVE_STATUSES.has(upper)) return 'rejected';
    return 'pending';
  }

  function getActualHourlyRate(s: Submission): number {
    const reward = moneyMajorValue(extractSubmissionReward(s));
    const seconds = extractDurationSeconds(s);
    if (!Number.isFinite(reward) || seconds === null || seconds <= 0) return NaN;
    return (reward * 3600) / seconds;
  }

  function getActualDurationMinutes(s: Submission): number {
    const seconds = extractDurationSeconds(s);
    if (seconds === null || !Number.isFinite(seconds)) return NaN;
    return seconds / 60;
  }

  const filteredAndSorted = $derived.by(() => {
    let result = [...submissions];
    const query = searchQuery.trim().toLowerCase();

    if (query) {
      result = result.filter((s) => {
        const name = (s.study_name || '').toLowerCase();
        const researcher = (extractResearcherFromSubmissionPayload(s.payload)?.name || '').toLowerCase();
        return name.includes(query) || researcher.includes(query);
      });
    }

    if (statusFilter !== 'all') {
      result = result.filter((s) => getStatusCategory(s.status) === statusFilter);
    }

    if (minReward !== null && minReward > 0) {
      const threshold = minReward;
      result = result.filter((s) => moneyMajorValue(extractSubmissionReward(s)) >= threshold);
    }
    if (minHourly !== null && minHourly > 0) {
      const threshold = minHourly;
      result = result.filter((s) => getActualHourlyRate(s) >= threshold);
    }
    if (maxDuration !== null && maxDuration > 0) {
      const threshold = maxDuration;
      result = result.filter((s) => {
        const d = getActualDurationMinutes(s);
        return Number.isFinite(d) && d <= threshold;
      });
    }

    result.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortKey) {
        case 'reward':
          aVal = moneyMajorValue(extractSubmissionReward(a));
          bVal = moneyMajorValue(extractSubmissionReward(b));
          break;
        case 'newest':
        default: {
          const aDate = parseDate(a.observed_at);
          const bDate = parseDate(b.observed_at);
          aVal = aDate ? aDate.getTime() : 0;
          bVal = bDate ? bDate.getTime() : 0;
          break;
        }
      }
      const aFinite = Number.isFinite(aVal);
      const bFinite = Number.isFinite(bVal);
      if (aFinite && bFinite) {
        const diff = bVal - aVal;
        if (diff !== 0) return diff;
      } else if (aFinite !== bFinite) {
        return aFinite ? -1 : 1;
      }
      return (b.submission_id || '').localeCompare(a.submission_id || '');
    });

    return result;
  });

  function clearFilters() {
    searchQuery = '';
    statusFilter = 'all';
    minReward = null;
    minHourly = null;
    maxDuration = null;
  }

  function cardBorderClass(status: string, phase: string): string {
    const upper = normalizeSubmissionStatus(status);
    if (upper === APPROVED_STATUS) return 'border-l-success';
    if (upper === AWAITING_REVIEW_STATUS) return 'border-l-warning';
    if (TERMINAL_NEGATIVE_STATUSES.has(upper)) return 'border-l-error';
    if (String(phase || '').toLowerCase().trim() === 'submitting') return 'border-l-info';
    return 'border-l-base-300';
  }

  function statusBadgeClass(status: string): string {
    const upper = normalizeSubmissionStatus(status);
    if (upper === APPROVED_STATUS) return 'text-emerald-600 dark:text-emerald-400';
    if (upper === AWAITING_REVIEW_STATUS) return 'text-amber-600 dark:text-amber-400';
    if (TERMINAL_NEGATIVE_STATUSES.has(upper)) return 'text-rose-600 dark:text-rose-400';
    return 'text-base-content/50';
  }

  function handleLinkClick(event: MouseEvent, url: string) {
    event.preventDefault();
    onStudyClick(url);
  }
</script>

<div id="panelSubmissions" class="panel" class:active role="tabpanel" aria-labelledby="tabSubmissions">
  {#if !overrideMessage && allSubmissions.length > 0}
    <EarningsStrip
      submissions={allSubmissions}
      prefs={earningsPrefs}
      onTogglePending={(enabled) => onEarningsPrefsChange({ ...earningsPrefs, include_pending: enabled })}
    />
  {/if}
  {#if !overrideMessage && submissions.length > 0}
    <div class="submissions-toolbar mb-2 space-y-1.5">
      <div class="flex items-center gap-1.5">
        <input
          type="text"
          class="input input-xs flex-1 min-w-0"
          placeholder="Search..."
          bind:value={searchQuery}
        />
        <select
          class="select select-xs w-auto"
          bind:value={statusFilter}
          title="Filter by status"
        >
          <option value="all">All</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          class="select select-xs w-auto"
          bind:value={sortKey}
          title="Sort by"
        >
          <option value="newest">Newest</option>
          <option value="reward">Pay ↓</option>
        </select>
        <button
          type="button"
          class="btn btn-xs btn-square {filtersExpanded || hasNumericFilters ? 'btn-primary' : 'btn-ghost'}"
          class:btn-outline={hasNumericFilters && !filtersExpanded}
          onclick={() => filtersExpanded = !filtersExpanded}
          title="Quick filters"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </button>
      </div>
      {#if filtersExpanded}
        <div class="flex items-center gap-3 px-1 py-1.5 bg-base-200/50 rounded-lg text-[11px]">
          <label class="flex items-center gap-1 text-base-content/70" title="Minimum reward">
            <span class="text-[12px] font-semibold text-base-content/60">{currencySymbol}</span>
            <input
              type="number"
              class="input input-xs w-12 tabular-nums text-center bg-base-100"
              min="0"
              step="0.5"
              placeholder="any"
              bind:value={minReward}
            />
          </label>
          <label class="flex items-center gap-1 text-base-content/70" title="Minimum actual hourly rate">
            <span class="text-[12px] font-semibold text-base-content/60">{currencySymbol}/hr</span>
            <input
              type="number"
              class="input input-xs w-12 tabular-nums text-center bg-base-100"
              min="0"
              step="1"
              placeholder="any"
              bind:value={minHourly}
            />
          </label>
          <label class="flex items-center gap-1 text-base-content/70" title="Maximum actual time taken (minutes)">
            <span class="text-[12px] font-semibold text-base-content/60">Time</span>
            <input
              type="number"
              class="input input-xs w-12 tabular-nums text-center bg-base-100"
              min="0"
              step="5"
              placeholder="any"
              bind:value={maxDuration}
            />
          </label>
          {#if hasNumericFilters}
            <button
              type="button"
              class="btn btn-ghost btn-xs ml-auto px-2 h-6 min-h-0 text-[11px] text-base-content/50 hover:text-error"
              onclick={clearFilters}
              title="Clear filters"
            >✕ clear</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  <div class="submissions min-h-[300px] max-h-[300px] scroll-container pb-1">
    {#if overrideMessage}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        {overrideMessage}
      </div>
    {:else if !filteredAndSorted.length}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        {#if hasActiveFilters}
          No submissions match your filters.
        {:else}
          No submissions tracked yet. They'll appear after you participate in a study.
        {/if}
      </div>
    {:else}
      {#each filteredAndSorted as entry (entry.submission_id)}
        {@const name = entry.study_name || '(unknown study)'}
        {@const researcherName = extractResearcherFromSubmissionPayload(entry.payload)?.name ?? ''}
        {@const observedAt = formatRelative(entry.observed_at, true)}
        {@const studyURL = studyUrlFromId(entry.study_id)}
        {@const rewardMoney = extractSubmissionReward(entry)}
        {@const reward = formatMoneyFromMinorUnits(rewardMoney)}
        {@const timeTakenSeconds = extractDurationSeconds(entry)}
        {@const duration = formatDurationSeconds(timeTakenSeconds ?? NaN)}
        {@const rewardMajor = moneyMajorValue(rewardMoney)}
        {@const hourlyMajor = Number.isFinite(rewardMajor) && timeTakenSeconds !== null ? (rewardMajor * 3600) / timeTakenSeconds : NaN}
        {@const hourlyLabel = formatMoneyFromMajorUnits(hourlyMajor, rewardMoney?.currency || '')}
        {@const hourly = hourlyLabel === 'n/a' ? 'n/a' : `${hourlyLabel}/hr`}
        {@const hourlyClass = rateColorClass(hourlyMajor)}
        {@const borderClass = cardBorderClass(entry.status, entry.phase)}
        {@const statusLabel = formatSubmissionStatus(entry.status)}

        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <a
            class="event-link block no-underline text-inherit rounded-lg outline-none"
            href={studyURL}
            title="Open study in Prolific"
            onclick={(e) => handleLinkClick(e, studyURL)}
          >
            <div class="event p-3.5 rounded-lg mb-2.5 text-[12.5px] border border-base-300 shadow-sm bg-base-100 border-l-[3px] {borderClass}">
              <div class="event-top flex items-start justify-between gap-2.5">
                <div class="event-title text-sm font-semibold leading-snug mr-auto text-base-content line-clamp-2">
                  <StudyTitle {name} {researcherName} />
                </div>
                <div class="event-time text-base-content/50 text-xs whitespace-nowrap text-right font-medium">{observedAt}</div>
              </div>
              <div class="event-metrics mt-1.5 flex items-baseline gap-x-1.5 flex-wrap gap-y-0.5">
                <span class="text-[15px] font-bold text-primary">{reward}</span>
                <span class="text-[12px] font-semibold {hourlyClass}">{hourly}</span>
                <span class="text-base-content/20 select-none">·</span>
                <span class="text-xs font-medium {statusBadgeClass(entry.status)}">{statusLabel}</span>
                <span class="text-base-content/20 select-none">·</span>
                <span class="text-xs text-base-content/55">{duration}</span>
              </div>
            </div>
          </a>
      {/each}
    {/if}
  </div>
</div>

<style>
  .event {
    transition: transform 100ms ease, box-shadow 100ms ease;
  }
  .event-link:hover .event {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px oklch(var(--bc) / 0.10), 0 1px 3px oklch(var(--bc) / 0.06);
  }
  .event-link:focus-visible .event {
    box-shadow: 0 4px 12px oklch(var(--bc) / 0.10), 0 1px 3px oklch(var(--bc) / 0.06);
  }
  .event-link:active .event {
    transform: translateY(0);
  }
  .panel {
    display: none;
  }
  .panel.active {
    display: block;
  }
</style>
