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

  let sortedStudies = $derived(
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
  <div class="live-studies min-h-[420px] max-h-[420px] overflow-auto">
    {#if overrideMessage}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-200/50">
        {overrideMessage}
      </div>
    {:else if !sortedStudies.length}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-200/50">
        No currently available studies cached yet.
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

        {#if url}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <a
            class="event-link live-link block no-underline text-inherit rounded-lg outline-none"
            href={url}
            title="Open study in Prolific"
            onclick={(e) => handleLinkClick(e, url)}
          >
            <div class="event live {isPriority ? 'priority' : ''} p-3.5 rounded-lg mb-2.5 text-[12.5px] border border-base-300 bg-base-200 {isPriority ? '!border-l-3 !border-l-purple-500 !bg-purple-500/10' : ''}">
              <div class="event-top flex items-start justify-between gap-2.5">
                <div class="event-title text-sm font-semibold leading-snug mr-auto text-base-content line-clamp-2">{study.name || '(unnamed study)'}</div>
                {#if firstSeenText}
                  <div class="event-time text-base-content/50 text-xs whitespace-nowrap text-right font-medium">{firstSeenText}</div>
                {/if}
              </div>
              <div class="event-metrics mt-2.5 flex flex-wrap items-center gap-1.5">
                <span class="metric reward text-base font-bold text-primary">{reward}</span>
                <span class="metric rate text-sm font-bold {hourlyClass}">{perHour}/hr</span>
                <span class="w-px h-[18px] bg-base-300 mx-0.5"></span>
                <span class="badge badge-sm bg-base-200 border-base-300 text-base-content/60 font-semibold">{eta}</span>
                <span class="badge badge-sm font-semibold {placesLow ? 'bg-yellow-100 border-yellow-400 text-yellow-800' : 'bg-base-200 border-base-300 text-base-content/60'}">{placesLabel}</span>
                {#if isPriority}
                  <span class="badge badge-sm bg-purple-50 border-purple-300 text-purple-700 font-bold">Priority</span>
                {/if}
              </div>
            </div>
          </a>
        {:else}
          <div class="event live {isPriority ? 'priority' : ''} p-3.5 rounded-lg mb-2.5 text-[12.5px] border border-base-300 bg-base-200">
            <div class="event-top flex items-start justify-between gap-2.5">
              <div class="event-title text-sm font-semibold leading-snug mr-auto text-base-content line-clamp-2">{study.name || '(unnamed study)'}</div>
              {#if firstSeenText}
                <div class="event-time text-base-content/50 text-xs whitespace-nowrap text-right font-medium">{firstSeenText}</div>
              {/if}
            </div>
            <div class="event-metrics mt-2.5 flex flex-wrap items-center gap-1.5">
              <span class="metric reward text-base font-bold text-primary">{reward}</span>
              <span class="metric rate text-sm font-bold {hourlyClass}">{perHour}/hr</span>
              <span class="w-px h-[18px] bg-base-300 mx-0.5"></span>
              <span class="badge badge-sm bg-base-200 border-base-300 text-base-content/60 font-semibold">{eta}</span>
              <span class="badge badge-sm font-semibold {placesLow ? 'bg-yellow-100 border-yellow-400 text-yellow-800' : 'bg-base-200 border-base-300 text-base-content/60'}">{placesLabel}</span>
              {#if isPriority}
                <span class="badge badge-sm bg-purple-50 border-purple-300 text-purple-700 font-bold">Priority</span>
              {/if}
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
  .event-link:hover .event.priority {
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.06), inset 0 0 0 1px rgba(124, 58, 237, 0.18);
    background: #f3eeff;
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
