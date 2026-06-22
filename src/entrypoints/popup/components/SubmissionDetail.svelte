<script lang="ts">
  import type { Submission } from '../../../lib/types';
  import { extractResearcherFromSubmissionPayload } from '../../../lib/store';
  import {
    formatMoneyFromMinorUnits,
    formatMoneyFromMajorUnits,
    moneyMajorValue,
    formatDurationSeconds,
    formatRelative,
    formatSubmissionStatus,
    studyUrlFromId,
    rateColorClass,
  } from '../../../lib/format';
  import {
    extractSubmissionReward,
    extractDurationSeconds,
    extractStartedAt,
    extractCompletedAt,
  } from '../../../lib/earnings';
  import {
    extractRejectionDetails,
    hasRejectionDetails,
    extractSubmissionMeta,
    statusColorClass,
  } from '../../../lib/submission-analytics';
  import StudyTitle from './StudyTitle.svelte';

  let { submission, onClose, onStudyClick } = $props<{
    submission: Submission | null;
    onClose: () => void;
    onStudyClick?: (url: string) => void;
  }>();

  const researcherName = $derived(
    submission ? extractResearcherFromSubmissionPayload(submission.payload)?.name ?? '' : ''
  );
  const reward = $derived(submission ? extractSubmissionReward(submission) : null);
  const duration = $derived(submission ? extractDurationSeconds(submission) : null);
  const startedAt = $derived(submission ? extractStartedAt(submission) : null);
  const completedAt = $derived(submission ? extractCompletedAt(submission) : null);
  const rejectionDetails = $derived(submission ? extractRejectionDetails(submission.payload) : null);
  const hasDetails = $derived(rejectionDetails ? hasRejectionDetails(rejectionDetails) : false);
  const meta = $derived(submission ? extractSubmissionMeta(submission.payload) : null);

  const rewardMajor = $derived(reward ? moneyMajorValue(reward) : NaN);
  const hourlyRate = $derived(
    Number.isFinite(rewardMajor) && duration && duration > 0
      ? (rewardMajor * 3600) / duration
      : NaN
  );
  const hourlyFormatted = $derived(
    Number.isFinite(hourlyRate) && reward
      ? `${formatMoneyFromMajorUnits(hourlyRate, reward.currency)}/hr`
      : 'n/a'
  );
  const studyUrl = $derived(submission ? studyUrlFromId(submission.study_id) : '');

  function handleOpenStudy() {
    if (studyUrl && onStudyClick) {
      onStudyClick(studyUrl);
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if submission}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    onclick={handleBackdropClick}
  >
    <div class="bg-base-100 w-full max-w-md rounded-2xl shadow-xl max-h-[80vh] overflow-y-auto">
      <div class="sticky top-0 bg-base-100 px-4 pt-4 pb-2 border-b border-base-300 flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-base-content line-clamp-2">
            <StudyTitle name={submission.study_name || '(unknown study)'} {researcherName} />
          </h3>
          <p class="text-xs text-base-content/50 mt-0.5">
            {formatRelative(submission.observed_at, true)}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square text-base-content/50 hover:text-base-content"
          onclick={onClose}
          title="Close"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="p-4 space-y-4">
        <div class="grid grid-cols-2 gap-3 text-[12.5px]">
          <div>
            <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Status</span>
            <span class="font-semibold {statusColorClass(submission.status)}">{formatSubmissionStatus(submission.status)}</span>
          </div>
          <div>
            <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Reward</span>
            <span class="font-bold text-primary">{reward ? formatMoneyFromMinorUnits(reward) : 'n/a'}</span>
          </div>
          <div>
            <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Time taken</span>
            <span class="font-medium">{duration ? formatDurationSeconds(duration) : 'n/a'}</span>
          </div>
          <div>
            <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Hourly rate</span>
            <span class="font-semibold {rateColorClass(hourlyRate)}">{hourlyFormatted}</span>
          </div>
          {#if startedAt}
            <div>
              <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Started</span>
              <span class="font-medium">{formatRelative(startedAt.toISOString(), true)}</span>
            </div>
          {/if}
          {#if completedAt}
            <div>
              <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Completed</span>
              <span class="font-medium">{formatRelative(completedAt.toISOString(), true)}</span>
            </div>
          {/if}
        </div>

        <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
          {#if meta?.researcher_country}
            <span class="badge badge-sm bg-base-200 text-base-content/70 border-0" title="Researcher country">{meta.researcher_country}</span>
          {/if}
          {#if meta?.institution_name}
            <span class="badge badge-sm bg-base-200 text-base-content/70 border-0" title="Institution">{meta.institution_name}</span>
          {/if}
          {#if meta?.is_trial}
            <span class="badge badge-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0">Trial</span>
          {/if}
          {#if meta?.study_code}
            <span class="badge badge-sm bg-base-200 text-base-content/50 border-0 font-mono" title="Completion code">{meta.study_code}</span>
          {/if}
          {#each meta?.bonuses ?? [] as bonus}
            <span class="badge badge-sm bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0" title="Bonus">+{formatMoneyFromMinorUnits(bonus)}</span>
          {/each}
        </div>

        <div class="flex items-center gap-2 pt-1">
          {#if onStudyClick}
            <button
              type="button"
              class="btn btn-sm btn-primary flex-1"
              onclick={handleOpenStudy}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open in Prolific
            </button>
          {/if}
          <span class="text-[10px] text-base-content/40 font-mono" title="Study ID">{submission.study_id}</span>
        </div>

        {#if hasDetails}
          <div class="border-t border-base-300 pt-3">
            <h4 class="text-[11px] uppercase tracking-wide text-base-content/50 font-semibold mb-2">Details</h4>
            <div class="space-y-2 text-[12.5px]">
              {#if rejectionDetails?.return_reason}
                <div>
                  <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Return reason</span>
                  <p class="text-base-content/80">{rejectionDetails.return_reason}</p>
                </div>
              {/if}
              {#if rejectionDetails?.rejection_message}
                <div>
                  <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Message</span>
                  <p class="text-base-content/80">{rejectionDetails.rejection_message}</p>
                </div>
              {/if}
              {#if rejectionDetails?.rejection_category}
                <div>
                  <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Category</span>
                  <p class="text-base-content/80">{rejectionDetails.rejection_category}</p>
                </div>
              {/if}
              {#if rejectionDetails?.researcher_message}
                <div>
                  <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block">Researcher feedback</span>
                  <p class="text-base-content/80">{rejectionDetails.researcher_message}</p>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
