<script lang="ts">
  import type { StudyEvent } from '../../../lib/types';
  import {
    formatMoneyFromMinorUnits,
    moneyMajorValue,
    formatDurationMinutes,
    formatShortNumber,
    formatRelative,
    studyUrlFromId,
    rateColorClass,
  } from '../../../lib/format';

  let { active, events, overrideMessage, onStudyClick } = $props<{
    active: boolean;
    events: StudyEvent[];
    overrideMessage: string;
    onStudyClick: (url: string) => void;
  }>();

  function handleLinkClick(event: MouseEvent, url: string) {
    event.preventDefault();
    onStudyClick(url);
  }
</script>

<div id="panelFeed" class="panel" class:active role="tabpanel" aria-labelledby="tabFeed">
  <div class="events min-h-[420px] max-h-[420px] scroll-container pb-1">
    {#if overrideMessage}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        {overrideMessage}
      </div>
    {:else if !events.length}
      <div class="empty-events p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        No events recorded yet. Events appear when studies become available or fill up.
      </div>
    {:else}
      {#each events as evt (evt.row_id)}
        {@const type = evt.event_type === 'available' ? 'available' : 'unavailable'}
        {@const name = evt.study_name || '(unnamed study)'}
        {@const observedAt = formatRelative(evt.observed_at, true)}
        {@const reward = formatMoneyFromMinorUnits(evt.reward)}
        {@const perHourAmount = moneyMajorValue(evt.average_reward_per_hour)}
        {@const perHour = formatMoneyFromMinorUnits(evt.average_reward_per_hour)}
        {@const hourlyClass = rateColorClass(perHourAmount)}
        {@const duration = formatDurationMinutes(evt.estimated_completion_time)}
        {@const totalPlaces = Number(evt.total_available_places)}
        {@const remainingPlaces = Number(evt.places_available)}
        {@const isLowRemaining = type === 'available' && Number.isFinite(remainingPlaces) && remainingPlaces <= 5}
        {@const placesLine = type === 'available'
          ? `${Number.isFinite(remainingPlaces) ? formatShortNumber(remainingPlaces) : 'n/a'} left`
          : `${Number.isFinite(totalPlaces) ? formatShortNumber(totalPlaces) : 'n/a'} total`}
        {@const studyURL = studyUrlFromId(evt.study_id)}

        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <a
            class="event-link block no-underline text-inherit rounded-lg outline-none"
            href={studyURL}
            title="Open study in Prolific"
            onclick={(e) => handleLinkClick(e, studyURL)}
          >
            <div class="event {type} p-3.5 rounded-lg mb-2.5 text-[12.5px] border border-base-300 {type === 'available' ? 'bg-base-100 shadow-sm' : 'bg-base-200/60'} border-l-3 {type === 'available' ? 'border-l-success' : 'border-l-error'}">
              <div class="event-top flex items-start justify-between gap-2.5">
                <div class="event-title text-sm font-semibold leading-snug mr-auto text-base-content line-clamp-2">{name}</div>
                <div class="event-time text-base-content/50 text-xs whitespace-nowrap text-right font-medium">{observedAt}</div>
              </div>
              <div class="event-metrics mt-1.5 flex items-baseline gap-x-1.5 flex-wrap gap-y-0.5">
                <span class="text-[15px] font-bold text-primary">{reward}</span>
                <span class="text-[12px] font-semibold {hourlyClass}">{perHour}/hr</span>
                <span class="text-base-content/20 select-none">·</span>
                <span class="text-xs text-base-content/55">{duration}</span>
                <span class="text-base-content/20 select-none">·</span>
                <span class="text-xs {isLowRemaining ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-base-content/55'}">{placesLine}</span>
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
