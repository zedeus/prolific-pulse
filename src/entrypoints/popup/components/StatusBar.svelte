<script lang="ts">
  let { offline, errorMessage, latestRefreshText, latestRefreshTitle, refreshPrefix, darkMode, onToggleDarkMode } = $props<{
    offline: boolean;
    errorMessage: string;
    latestRefreshText: string;
    latestRefreshTitle: string;
    refreshPrefix: string;
    darkMode: boolean;
    onToggleDarkMode: () => void;
  }>();
</script>

<div class="flex items-center gap-2 px-0.5 pb-2.5">
  <span
    id="syncDot"
    class="inline-block w-2.5 h-2.5 rounded-full flex-none {offline ? 'bg-error shadow-[0_0_0_2px_rgba(225,29,72,0.15)] bad' : 'bg-success shadow-[0_0_0_2px_rgba(26,147,111,0.15)]'}"
    title="Sync status"
    aria-label={offline ? 'Offline' : 'Connected'}
  ></span>
  <span class="whitespace-nowrap font-semibold text-[13px] text-base-content/70">
    <span>{refreshPrefix}</span><span id="latestRefresh" title={latestRefreshTitle}>{latestRefreshText}</span>
  </span>
  <button
    class="ml-auto text-base-content/50 hover:text-base-content transition-colors duration-100 p-1 -m-1 rounded"
    type="button"
    title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    onclick={onToggleDarkMode}
  >
    {#if darkMode}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    {/if}
  </button>
</div>

{#if errorMessage}
  <div
    id="errorMessage"
    class="mb-2.5 text-[13px] leading-snug py-2.5 px-3.5 rounded-lg border border-error/30 bg-error/10 text-error-content dark:text-error"
  >
    {errorMessage}
  </div>
{:else}
  <div id="errorMessage" class="hidden"></div>
{/if}
