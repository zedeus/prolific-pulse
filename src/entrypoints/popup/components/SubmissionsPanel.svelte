<script lang="ts">
  import type { Submission, Money } from '../../../lib/types';
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

  let { active, submissions, overrideMessage, onStudyClick } = $props<{
    active: boolean;
    submissions: Submission[];
    overrideMessage: string;
    onStudyClick: (url: string) => void;
  }>();

  let sorted = $derived(
    [...submissions].sort((a, b) => {
      const aDate = parseDate(a.observed_at);
      const bDate = parseDate(b.observed_at);
      const aTs = aDate ? aDate.getTime() : 0;
      const bTs = bDate ? bDate.getTime() : 0;
      if (aTs !== bTs) return bTs - aTs;
      return (b.submission_id || '').localeCompare(a.submission_id || '');
    })
  );

  function extractTimeTakenSeconds(payload: unknown): number {
    if (!payload || typeof payload !== 'object') return NaN;
    const p = payload as Record<string, unknown>;
    const startedAt = parseDate(p.started_at);
    const completedAt = parseDate(p.completed_at);
    if (!startedAt || !completedAt) return NaN;
    const seconds = (completedAt.getTime() - startedAt.getTime()) / 1000;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : NaN;
  }

  function getRewardMoney(payload: unknown): Money | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    if (p.submission_reward && typeof p.submission_reward === 'object') {
      return p.submission_reward as Money;
    }
    return null;
  }

  function cardBorderClass(status: string, phase: string): string {
    const upper = normalizeSubmissionStatus(status);
    if (upper === 'APPROVED') return 'border-l-success';
    if (upper === 'AWAITING REVIEW') return 'border-l-warning';
    if (upper === 'RETURNED' || upper === 'REJECTED' || upper === 'SCREENED OUT') return 'border-l-error';
    const normalizedPhase = String(phase || '').toLowerCase().trim();
    if (normalizedPhase === 'submitting') return 'border-l-info';
    if (normalizedPhase === 'submitted') return 'border-l-base-300';
    return 'border-l-base-300';
  }

  function handleLinkClick(event: MouseEvent, url: string) {
    event.preventDefault();
    onStudyClick(url);
  }
</script>

<div id="panelSubmissions" class="panel" class:active role="tabpanel" aria-labelledby="tabSubmissions">
  <div class="submissions min-h-[420px] max-h-[420px] overflow-auto">
    {#if overrideMessage}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-200/50">
        {overrideMessage}
      </div>
    {:else if !sorted.length}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-200/50">
        No submissions tracked yet.
      </div>
    {:else}
      {#each sorted as entry (entry.submission_id)}
        {@const name = entry.study_name || '(unknown study)'}
        {@const observedAt = formatRelative(entry.observed_at, true)}
        {@const studyURL = studyUrlFromId(entry.study_id)}
        {@const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {}}
        {@const rewardMoney = getRewardMoney(payload)}
        {@const reward = formatMoneyFromMinorUnits(rewardMoney)}
        {@const timeTakenSeconds = extractTimeTakenSeconds(payload)}
        {@const duration = formatDurationSeconds(timeTakenSeconds)}
        {@const rewardMajor = moneyMajorValue(rewardMoney)}
        {@const hourlyMajor = Number.isFinite(rewardMajor) && Number.isFinite(timeTakenSeconds) && timeTakenSeconds > 0 ? (rewardMajor * 3600) / timeTakenSeconds : NaN}
        {@const hourlyLabel = formatMoneyFromMajorUnits(hourlyMajor, rewardMoney?.currency || '')}
        {@const hourly = hourlyLabel === 'n/a' ? 'n/a' : `${hourlyLabel}/hr`}
        {@const hourlyClass = rateColorClass(hourlyMajor)}
        {@const borderClass = cardBorderClass(entry.status, entry.phase)}
        {@const statusLabel = formatSubmissionStatus(entry.status)}

        {#if studyURL}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <a
            class="event-link block no-underline text-inherit rounded-lg outline-none"
            href={studyURL}
            title="Open study in Prolific"
            onclick={(e) => handleLinkClick(e, studyURL)}
          >
            <div class="event p-3.5 rounded-lg mb-2.5 text-[12.5px] border border-base-300 bg-base-200 border-l-3 {borderClass}">
              <div class="event-top flex items-start justify-between gap-2.5">
                <div class="event-title text-sm font-semibold leading-snug mr-auto text-base-content line-clamp-2">{name}</div>
                <div class="event-time text-base-content/50 text-xs whitespace-nowrap text-right font-medium">{observedAt}</div>
              </div>
              <div class="event-metrics mt-2.5 flex flex-wrap items-center gap-1.5">
                <span class="metric reward text-base font-bold text-primary">{reward}</span>
                <span class="metric rate text-sm font-bold {hourlyClass}">{hourly}</span>
                <span class="w-px h-[18px] bg-base-300 mx-0.5"></span>
                <span class="badge badge-sm bg-base-200 border-base-300 text-base-content/60 font-semibold">{statusLabel}</span>
                <span class="badge badge-sm bg-base-200 border-base-300 text-base-content/60 font-semibold">{duration}</span>
              </div>
            </div>
          </a>
        {:else}
          <div class="event p-3.5 rounded-lg mb-2.5 text-[12.5px] border border-base-300 bg-base-200 border-l-3 {borderClass}">
            <div class="event-top flex items-start justify-between gap-2.5">
              <div class="event-title text-sm font-semibold leading-snug mr-auto text-base-content line-clamp-2">{name}</div>
              <div class="event-time text-base-content/50 text-xs whitespace-nowrap text-right font-medium">{observedAt}</div>
            </div>
            <div class="event-metrics mt-2.5 flex flex-wrap items-center gap-1.5">
              <span class="metric reward text-base font-bold text-primary">{reward}</span>
              <span class="metric rate text-sm font-bold {hourlyClass}">{hourly}</span>
              <span class="w-px h-[18px] bg-base-300 mx-0.5"></span>
              <span class="badge badge-sm bg-base-200 border-base-300 text-base-content/60 font-semibold">{statusLabel}</span>
              <span class="badge badge-sm bg-base-200 border-base-300 text-base-content/60 font-semibold">{duration}</span>
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .event-link:hover .event {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.06);
  }
  .event-link:focus-visible .event {
    box-shadow: 0 0 0 2px oklch(var(--p));
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
