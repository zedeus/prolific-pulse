<script lang="ts">
  import type { Study, PriorityFilter } from '../../../lib/types';
  import {
    formatMoneyFromMinorUnits,
    moneyMajorValue,
    formatDurationMinutes,
    formatShortNumber,
    formatRelative,
    parseDate,
    studyUrlFromId,
    rateColorClass,
  } from '../../../lib/format';
  import { studyMatchesPriorityFilter } from '../../background/domain';

  let { active, studies, priorityFilter, overrideMessage, onStudyClick } = $props<{
    active: boolean;
    studies: Study[];
    priorityFilter: PriorityFilter;
    overrideMessage: string;
    onStudyClick: (url: string) => void;
  }>();

  const sortedStudies = $derived(
    [...studies].sort((a, b) => {
      const aDate = parseDate(a.published_at || a.date_created);
      const bDate = parseDate(b.published_at || b.date_created);
      const aTs = aDate ? aDate.getTime() : 0;
      const bTs = bDate ? bDate.getTime() : 0;
      if (aTs !== bTs) return aTs - bTs;
      return (a.id || '').localeCompare(b.id || '');
    })
  );

  function handleLinkClick(event: MouseEvent, url: string) {
    event.preventDefault();
    onStudyClick(url);
  }
</script>

<div id="panelLive" class="panel" class:active role="tabpanel" aria-labelledby="tabLive">
  <div class="live-studies min-h-[420px] max-h-[420px] scroll-container pb-1">
    {#if overrideMessage}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        {overrideMessage}
      </div>
    {:else if !sortedStudies.length}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        No studies available right now. They'll appear here automatically.
      </div>
    {:else}
      {#each sortedStudies as study (study.id)}
        {@const isPriority = priorityFilter?.enabled && studyMatchesPriorityFilter(study, priorityFilter)}
        {@const url = studyUrlFromId(study.id)}
        {@const reward = formatMoneyFromMinorUnits(study.reward)}
        {@const perHourAmount = moneyMajorValue(study.average_reward_per_hour)}
        {@const perHour = formatMoneyFromMinorUnits(study.average_reward_per_hour)}
        {@const eta = formatDurationMinutes(study.estimated_completion_time)}
        {@const placesAvailable = Number(study.places_available)}
        {@const placesLabel = Number.isFinite(placesAvailable) ? `${formatShortNumber(placesAvailable)} left` : 'n/a left'}
        {@const placesLow = Number.isFinite(placesAvailable) && placesAvailable <= 5}
        {@const firstSeenText = study.first_seen_at ? formatRelative(study.first_seen_at) : ''}
        {@const hourlyClass = rateColorClass(perHourAmount)}

        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <a
            class="event-link block no-underline text-inherit rounded-lg outline-none"
            href={url}
            title="Open study in Prolific"
            onclick={(e) => handleLinkClick(e, url)}
          >
            <div class="event live {isPriority ? 'priority' : ''} p-3.5 rounded-lg mb-2.5 text-[12.5px] shadow-sm border border-base-300 bg-base-100 {isPriority ? 'priority-card' : ''}">
              <div class="event-top flex items-start justify-between gap-2.5">
                <div class="event-title text-sm font-semibold leading-snug mr-auto text-base-content line-clamp-2">{study.name || '(unnamed study)'}</div>
                {#if firstSeenText}
                  <div class="event-time text-base-content/50 text-xs whitespace-nowrap text-right font-medium">{firstSeenText}</div>
                {/if}
              </div>
              <div class="event-metrics mt-1.5 flex items-baseline gap-x-1.5 flex-wrap gap-y-0.5">
                <span class="text-[15px] font-bold text-primary">{reward}</span>
                <span class="text-[12px] font-semibold {hourlyClass}">{perHour}/hr</span>
                <span class="text-base-content/20 select-none">·</span>
                <span class="text-xs text-base-content/55">{eta}</span>
                <span class="text-base-content/20 select-none">·</span>
                <span class="text-xs {placesLow ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-base-content/55'}">{placesLabel}</span>
                {#if isPriority}
                  <span class="ml-0.5 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-purple-700 text-purple-100 dark:bg-purple-500 dark:text-white">priority</span>
                {/if}
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
  .priority-card {
    border-left: 3px solid #a855f7;
    background: #faf5ff;
  }
  :global([data-theme="dark"]) .priority-card {
    background: rgba(88, 28, 135, 0.25);
  }
  .event-link:hover .event {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px oklch(var(--bc) / 0.10), 0 1px 3px oklch(var(--bc) / 0.06);
  }
  .event-link:hover .event.priority {
    box-shadow: 0 4px 12px oklch(var(--bc) / 0.10), 0 1px 3px oklch(var(--bc) / 0.06), inset 0 0 0 1px rgba(124, 58, 237, 0.18);
    background: oklch(var(--p) / 0.08);
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
