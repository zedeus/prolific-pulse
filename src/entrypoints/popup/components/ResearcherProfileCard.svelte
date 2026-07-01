<script lang="ts">
  import type { ResearcherProfile } from '../../../lib/researcher-profile';
  import { reliabilityBandColorClass, reliabilityBandLabel } from '../../../lib/researcher-profile';
  import {
    formatMoneyFromMajorUnits,
    formatDurationSeconds,
    formatRelative,
    rateColorClass,
    getCurrencySymbol,
  } from '../../../lib/format';
  import Sparkline from './Sparkline.svelte';

  interface Props {
    profile: ResearcherProfile | null;
    onClose: () => void;
    onPrioritize?: () => void;
    onBlacklist?: () => void;
  }

  let { profile, onClose, onPrioritize, onBlacklist }: Props = $props();

  const pct = (fraction: number | null | undefined): number | null =>
    fraction != null ? Math.round(fraction * 100) : null;

  const rel = $derived(profile?.reliability ?? null);
  const approvalPct = $derived(pct(profile?.approval_rate));
  const screenedPct = $derived(pct(profile?.screened_out_rate));
  const hourlyText = $derived(
    profile?.median_hourly != null && profile.currency
      ? `${formatMoneyFromMajorUnits(profile.median_hourly, profile.currency)}/hr`
      : null,
  );
  const hourlyRange = $derived.by(() => {
    const h = profile?.hourly;
    if (!h || !profile?.currency || h.n < 4 || !Number.isFinite(h.p25) || !Number.isFinite(h.p75)) return '';
    return `${formatMoneyFromMajorUnits(h.p25, profile.currency)}–${formatMoneyFromMajorUnits(h.p75, profile.currency)}/hr`;
  });
  const sparkValues = $derived((profile?.hourly_series ?? []).slice(-24));

  // actual ÷ estimated duration → plain-English verdict + tone
  const durationVerdict = $derived.by(() => {
    const r = profile?.duration_vs_estimate;
    if (r == null) return null;
    const pct = Math.round((r - 1) * 100);
    if (Math.abs(pct) <= 5) return { text: 'Matches estimate', tone: 'text-emerald-600 dark:text-emerald-400' };
    if (pct > 5) return { text: `${pct}% longer than estimated`, tone: 'text-amber-600 dark:text-amber-400' };
    return { text: `${Math.abs(pct)}% under estimate`, tone: 'text-emerald-600 dark:text-emerald-400' };
  });

  const listingText = $derived(
    profile?.study?.median_listing_seconds != null
      ? formatDurationSeconds(profile.study.median_listing_seconds)
      : null,
  );

  const seenText = $derived.by(() => {
    if (!profile) return '';
    const parts: string[] = [];
    if (profile.first_seen_at) parts.push(`first seen ${formatRelative(profile.first_seen_at)}`);
    if (profile.last_seen_at) parts.push(`last seen ${formatRelative(profile.last_seen_at)}`);
    return parts.join(' · ');
  });

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet statLabel(text: string, tip: string)}
  <span class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold block" title={tip || undefined}>{text}</span>
{/snippet}

{#if profile}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="researcher-profile-card fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    onclick={handleBackdropClick}
  >
    <div class="bg-base-100 w-full max-w-md rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto">
      <div class="sticky top-0 bg-base-100 px-4 pt-4 pb-2 border-b border-base-300 flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-base-content line-clamp-2">{profile.name}</h3>
          <p class="text-[11px] text-base-content/50 mt-0.5 flex flex-wrap items-center gap-x-1.5">
            {#if profile.country}<span class="badge badge-xs bg-base-200 text-base-content/70 border-0">{profile.country}</span>{/if}
            {#if seenText}<span>{seenText}</span>{/if}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square text-base-content/50 hover:text-base-content"
          onclick={onClose}
          title="Close"
          aria-label="Close"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="p-4 space-y-4">
        <!-- Reliability hero -->
        <div class="rounded-xl border border-base-300 bg-base-200/40 p-3 flex items-center gap-3">
          <div class="flex flex-col items-center justify-center w-16 shrink-0">
            {#if rel?.hasEnoughData}
              <span class="text-2xl font-bold leading-none {reliabilityBandColorClass(rel.band)}">{rel.score}</span>
              <span class="text-[9px] uppercase tracking-wide text-base-content/40 mt-0.5">/ 100</span>
            {:else}
              <span class="text-xl leading-none text-base-content/30">—</span>
            {/if}
          </div>
          <div class="min-w-0">
            <div class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold">Reliability</div>
            <div class="text-sm font-semibold {reliabilityBandColorClass(rel?.band ?? 'unknown')}">
              {reliabilityBandLabel(rel?.band ?? 'unknown')}
            </div>
            <p class="text-[11px] text-base-content/55 leading-snug mt-0.5">
              {#if rel?.hasEnoughData}
                How often your work gets approved (vs returned/rejected) and how rarely you're screened out.
              {:else}
                Complete a few more of their studies to build a reliable picture.
              {/if}
            </p>
          </div>
        </div>

        <!-- Stat grid -->
        <div class="grid grid-cols-2 gap-3 text-[12.5px]">
          <div>
            {@render statLabel('Approval rate', '')}
            {#if approvalPct != null}
              <span class="font-semibold">{approvalPct}%</span>
              <span class="text-[11px] text-base-content/45"> · {profile.counts.approved} of {profile.decided} reviewed</span>
            {:else}
              <span class="text-base-content/40">Nothing reviewed yet</span>
            {/if}
          </div>
          <div>
            {@render statLabel('Typical pay', '')}
            {#if hourlyText}
              <span class="font-semibold {rateColorClass(profile.median_hourly ?? 0)}">{hourlyText}</span>
              {#if hourlyRange}<span class="text-[11px] text-base-content/45 block">usually {hourlyRange}</span>{/if}
            {:else}
              <span class="text-base-content/40">n/a</span>
            {/if}
          </div>
          <div>
            {@render statLabel('Time vs estimate', "Actual time taken vs the study's estimated time")}
            {#if durationVerdict}
              <span class="font-medium {durationVerdict.tone}">{durationVerdict.text}</span>
              <span class="text-[11px] text-base-content/45"> · {profile.duration_sample} studies</span>
            {:else}
              <span class="text-base-content/40">Not enough data</span>
            {/if}
          </div>
          <div>
            {@render statLabel('Screened out', 'How often you were screened out before completing')}
            {#if screenedPct != null}
              <span class="font-medium {screenedPct >= 25 ? 'text-amber-600 dark:text-amber-400' : ''}">{screenedPct}% of the time</span>
              <span class="text-[11px] text-base-content/45"> · {profile.counts.screened_out} {profile.counts.screened_out === 1 ? 'time' : 'times'}</span>
            {:else}
              <span class="text-base-content/40">Never</span>
            {/if}
          </div>
          {#if profile.study}
            <div>
              {@render statLabel('Studies seen live', 'Different studies from this researcher the extension has seen posted')}
              <span class="font-medium">{profile.study.studies_posted || '—'}</span>
            </div>
            <div>
              {@render statLabel('Typically listed', 'How long their studies stay open before filling or closing — shorter fills faster')}
              {#if listingText}
                <span class="font-medium">{listingText}</span>
              {:else}
                <span class="text-base-content/40">n/a</span>
              {/if}
            </div>
          {/if}
        </div>

        {#if sparkValues.length >= 2}
          <div>
            <div class="text-[10.5px] uppercase tracking-wide text-base-content/50 font-semibold mb-1 flex items-center justify-between">
              <span>Recent pay trend</span>
              <span class="text-[10px] normal-case tracking-normal text-base-content/40">last {sparkValues.length} · {getCurrencySymbol(profile.currency)}/hr</span>
            </div>
            <div class="text-primary">
              <Sparkline values={sparkValues} width={340} height={40} fill title="Per-study hourly rate over time" class="w-full" />
            </div>
          </div>
        {/if}

        <!-- Totals footnote -->
        <p class="text-[11px] text-base-content/45">
          Based on {profile.total} {profile.total === 1 ? 'study' : 'studies'} you've submitted to this researcher.
        </p>

        {#if onPrioritize || onBlacklist}
          <div class="flex items-center gap-2 pt-1 border-t border-base-300">
            {#if onPrioritize}
              <button type="button" class="btn btn-sm btn-primary flex-1 mt-3" onclick={onPrioritize}>
                &#10022; Prioritize
              </button>
            {/if}
            {#if onBlacklist}
              <button type="button" class="btn btn-sm btn-ghost flex-1 mt-3 text-error hover:bg-error/10" onclick={onBlacklist}>
                &#128683; Blacklist
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
