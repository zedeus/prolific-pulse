<script lang="ts">
  import type { Submission } from '../../../lib/types';
  import type { SubmissionRecord } from '../../../lib/db';
  import type { EarningsPrefs } from '../../../lib/earnings-prefs';
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
  } from '../../../lib/format';
  import {
    APPROVED_STATUS,
    AWAITING_REVIEW_STATUS,
    TERMINAL_NEGATIVE_STATUSES,
    extractSubmissionReward,
    extractDurationSeconds,
  } from '../../../lib/earnings';
  import EarningsStrip from './EarningsStrip.svelte';

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

  const sorted = $derived(
    [...submissions].sort((a, b) => {
      const aDate = parseDate(a.observed_at);
      const bDate = parseDate(b.observed_at);
      const aTs = aDate ? aDate.getTime() : 0;
      const bTs = bDate ? bDate.getTime() : 0;
      if (aTs !== bTs) return bTs - aTs;
      return (b.submission_id || '').localeCompare(a.submission_id || '');
    })
  );

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
  <div class="submissions min-h-[360px] max-h-[360px] scroll-container pb-1">
    {#if overrideMessage}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        {overrideMessage}
      </div>
    {:else if !sorted.length}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        No submissions tracked yet. They'll appear after you participate in a study.
      </div>
    {:else}
      {#each sorted as entry (entry.submission_id)}
        {@const name = entry.study_name || '(unknown study)'}
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
                <div class="event-title text-sm font-semibold leading-snug mr-auto text-base-content line-clamp-2">{name}</div>
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
