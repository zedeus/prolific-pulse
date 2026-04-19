<script lang="ts">
  import type { ResearcherRef } from '../../../lib/types';
  import type { ResearcherRecord } from '../../../lib/db';

  interface Props {
    selected: ResearcherRef[];
    knownResearchers: ResearcherRecord[];
    placeholder?: string;
    tone: 'positive' | 'negative';
    onChange: (next: ResearcherRef[]) => void;
  }

  let { selected, knownResearchers, placeholder = 'Add researcher', tone, onChange }: Props = $props();

  const MAX_SUGGESTIONS = 30;

  let open = $state(false);
  let query = $state('');
  let rootEl: HTMLDivElement | null = $state(null);
  let searchInput: HTMLInputElement | null = $state(null);

  const selectedIds = $derived(new Set(selected.map((r) => r.id)));

  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return knownResearchers
      .filter((r) => !selectedIds.has(r.id))
      .filter((r) => {
        if (!q) return true;
        return (
          (r.name || '').toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          (r.country || '').toLowerCase().includes(q)
        );
      })
      .slice(0, MAX_SUGGESTIONS);
  });

  const chipClass = $derived(
    tone === 'negative'
      ? 'bg-error/12 text-error border-error/25 hover:bg-error/20'
      : 'bg-primary/12 text-primary border-primary/25 hover:bg-primary/20'
  );

  function toggleOpen() {
    open = !open;
    if (open) {
      query = '';
      setTimeout(() => searchInput?.focus(), 0);
    }
  }

  function add(researcher: ResearcherRecord) {
    const ref: ResearcherRef = { id: researcher.id, name: researcher.name || researcher.id };
    onChange([...selected, ref]);
    query = '';
    setTimeout(() => searchInput?.focus(), 0);
  }

  function remove(id: string) {
    onChange(selected.filter((r) => r.id !== id));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      e.stopPropagation();
    } else if (e.key === 'Enter' && suggestions.length > 0) {
      e.preventDefault();
      add(suggestions[0]);
    }
  }

  function onGlobalClick(e: MouseEvent) {
    if (!rootEl) return;
    if (!rootEl.contains(e.target as Node)) {
      open = false;
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', onGlobalClick);
      return () => document.removeEventListener('mousedown', onGlobalClick);
    }
  });

  function labelFor(r: ResearcherRef): string {
    return r.name?.trim() || r.id;
  }
</script>

<div class="researcher-picker relative" bind:this={rootEl}>
  <div class="flex flex-wrap gap-1 items-center">
    {#each selected as ref (ref.id)}
      <button
        type="button"
        class="chip inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10.5px] leading-tight font-medium border cursor-pointer {chipClass}"
        title="Click to remove — {ref.id}"
        aria-label="Remove {labelFor(ref)}"
        onclick={() => remove(ref.id)}
      >
        <span class="max-w-[140px] truncate">{labelFor(ref)}</span>
        <span class="text-current/60 leading-none text-[13px]" aria-hidden="true">&#215;</span>
      </button>
    {/each}
    <button
      type="button"
      class="picker-add-btn inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10.5px] leading-tight font-medium border border-dashed border-base-content/25 text-base-content/55 hover:border-base-content/50 hover:text-base-content/80 bg-transparent cursor-pointer"
      onclick={toggleOpen}
      aria-expanded={open}
    >
      <span class="text-[11px] leading-none">+</span>
      <span>{placeholder}</span>
    </button>
  </div>

  {#if open}
    <div
      class="picker-popover absolute z-30 mt-1 left-0 w-72 max-w-[96vw] bg-base-100 border border-base-300 rounded-lg shadow-lg p-2"
      role="dialog"
    >
      <input
        bind:this={searchInput}
        type="text"
        class="input input-xs w-full mb-1.5"
        placeholder="Search researchers…"
        spellcheck="false"
        bind:value={query}
        onkeydown={onKeydown}
      />
      <div class="max-h-60 overflow-y-auto flex flex-col gap-0.5">
        {#if suggestions.length === 0}
          <div class="text-[11px] text-base-content/50 p-2 text-center">
            {knownResearchers.length === 0
              ? 'No researchers seen yet. New studies will populate this list.'
              : selected.length >= knownResearchers.length
                ? 'All known researchers are already selected.'
                : 'No matches.'}
          </div>
        {:else}
          {#each suggestions as r (r.id)}
            <button
              type="button"
              class="suggestion-row flex items-baseline gap-2 px-2 py-1 rounded hover:bg-base-200 text-left bg-transparent border-none cursor-pointer"
              onclick={() => add(r)}
            >
              <span class="flex-1 min-w-0 truncate">
                <span class="text-[12px] font-medium">{r.name || r.id}</span>
                {#if r.country}
                  <span class="text-[10.5px] text-base-content/45 ml-1">{r.country}</span>
                {/if}
              </span>
              <span class="text-[10px] text-base-content/55 whitespace-nowrap">
                {r.study_count > 0 ? `${r.study_count} stud${r.study_count === 1 ? 'y' : 'ies'}` : ''}
                {r.submission_count > 0 ? `${r.study_count > 0 ? ' · ' : ''}${r.submission_count} sub${r.submission_count === 1 ? '' : 's'}` : ''}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .researcher-picker {
    min-height: 1.5rem;
  }
</style>
