<script lang="ts">
  import type { ResearcherRecord } from '../../../lib/db';
  import type { ResearcherProfile } from '../../../lib/researcher-profile';
  import { reliabilityBandColorClass } from '../../../lib/researcher-profile';
  import { formatMoneyFromMajorUnits, formatRelative, compareNumberDesc } from '../../../lib/format';
  import ReliabilityBadge from './ReliabilityBadge.svelte';
  import Sparkline from './Sparkline.svelte';

  interface Props {
    active: boolean;
    knownResearchers: ResearcherRecord[];
    researcherProfiles?: Map<string, ResearcherProfile>;
    overrideMessage: string;
    onViewResearcher?: (researcherId: string, researcherName: string) => void;
  }

  let { active, knownResearchers, researcherProfiles, overrideMessage, onViewResearcher }: Props = $props();

  type SortKey = 'reliability' | 'approval' | 'pay' | 'name' | 'recent';
  let sortKey = $state<SortKey>('reliability');
  let query = $state('');

  interface Row {
    rec: ResearcherRecord;
    profile: ResearcherProfile | null;
  }

  // Sort metric extractors — NaN sinks unrated researchers to the bottom of numeric sorts.
  function scoreOf(p: ResearcherProfile | null): number {
    return p?.reliability.hasEnoughData ? p.reliability.score : NaN;
  }
  function approvalOf(p: ResearcherProfile | null): number {
    return p?.approval_rate ?? NaN;
  }
  function payOf(p: ResearcherProfile | null): number {
    return p?.median_hourly ?? NaN;
  }

  const rows = $derived.by((): Row[] => {
    const q = query.trim().toLowerCase();
    const list: Row[] = knownResearchers
      .filter((r) => {
        if (!q) return true;
        return (r.name || '').toLowerCase().includes(q)
          || r.id.toLowerCase().includes(q)
          || (r.country || '').toLowerCase().includes(q);
      })
      .map((r) => ({ rec: r, profile: researcherProfiles?.get(r.id) ?? null }));

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'reliability': cmp = compareNumberDesc(scoreOf(a.profile), scoreOf(b.profile)); break;
        case 'approval': cmp = compareNumberDesc(approvalOf(a.profile), approvalOf(b.profile)); break;
        case 'pay': cmp = compareNumberDesc(payOf(a.profile), payOf(b.profile)); break;
        case 'recent': cmp = (b.rec.last_seen_at || '').localeCompare(a.rec.last_seen_at || ''); break;
        case 'name': break;
      }
      if (cmp !== 0) return cmp;
      return (a.rec.name || a.rec.id).localeCompare(b.rec.name || b.rec.id);
    });
    return list;
  });

  function payLabel(p: ResearcherProfile | null): string {
    if (!p || p.median_hourly == null || !p.currency) return '';
    return `${formatMoneyFromMajorUnits(p.median_hourly, p.currency)}/hr`;
  }
  function approvalLabel(p: ResearcherProfile | null): string {
    return p?.approval_rate != null ? `${Math.round(p.approval_rate * 100)}% approved` : '';
  }
</script>

<div id="panelResearchers" class="panel" class:active role="tabpanel" aria-labelledby="tabResearchers">
  {#if !overrideMessage && knownResearchers.length > 0}
    <div class="mb-2 flex items-center gap-1.5">
      <input
        type="text"
        class="input input-xs flex-1 min-w-0"
        placeholder="Search researchers…"
        spellcheck="false"
        bind:value={query}
      />
      <select class="select select-xs w-auto" bind:value={sortKey} title="Sort researchers by">
        <option value="reliability">Trust ↓</option>
        <option value="approval">Approval ↓</option>
        <option value="pay">Pay ↓</option>
        <option value="recent">Recent</option>
        <option value="name">Name</option>
      </select>
    </div>
  {/if}

  <div class="researchers min-h-[350px] max-h-[350px] scroll-container pb-1">
    {#if overrideMessage}
      <div class="p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        {overrideMessage}
      </div>
    {:else if knownResearchers.length === 0}
      <div class="p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        No researchers seen yet. They'll appear here as studies come in.
      </div>
    {:else if rows.length === 0}
      <div class="p-8 text-base-content/50 text-sm text-center border border-dashed border-base-300 rounded-lg bg-base-100">
        No researchers match your search.
      </div>
    {:else}
      {#each rows as { rec, profile } (rec.id)}
        {@const spark = (profile?.hourly_series ?? []).slice(-16)}
        {@const approval = approvalLabel(profile)}
        {@const pay = payLabel(profile)}
        <button
          type="button"
          class="researcher-row block w-full text-left rounded-lg mb-2 p-3 border border-base-300 bg-base-100 shadow-sm hover:border-primary/40 hover:bg-base-200/40 cursor-pointer transition-colors"
          title="View {rec.name || rec.id}'s reliability profile"
          onclick={() => onViewResearcher?.(rec.id, rec.name)}
        >
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex items-center gap-1.5">
              <span class="text-[13px] font-semibold text-base-content truncate">{rec.name || rec.id}</span>
              {#if rec.country}<span class="text-[10.5px] text-base-content/45 shrink-0">{rec.country}</span>{/if}
              <ReliabilityBadge reliability={profile?.reliability} />
            </div>
            {#if spark.length >= 2}
              <span class="{profile?.reliability.hasEnoughData ? reliabilityBandColorClass(profile.reliability.band) : 'text-base-content/40'} shrink-0" title="Pay trend over time">
                <Sparkline values={spark} width={48} height={16} />
              </span>
            {/if}
          </div>
          <div class="mt-1 flex items-center gap-x-1.5 flex-wrap text-[11px] text-base-content/55">
            {#if approval}<span>{approval}</span>{/if}
            {#if approval && pay}<span class="text-base-content/20">·</span>{/if}
            {#if pay}<span class="font-medium text-base-content/70">{pay}</span>{/if}
            {#if approval || pay}<span class="text-base-content/20">·</span>{/if}
            <span>{rec.study_count > 0 ? `${rec.study_count} live` : ''}{rec.study_count > 0 && rec.submission_count > 0 ? ' · ' : ''}{rec.submission_count > 0 ? `${rec.submission_count} done` : ''}</span>
            {#if !approval && !pay && rec.study_count === 0 && rec.submission_count === 0}
              <span class="text-base-content/40">seen {formatRelative(rec.last_seen_at)}</span>
            {/if}
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .panel {
    display: none;
  }
  .panel.active {
    display: block;
  }
</style>
