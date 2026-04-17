<script lang="ts">
  let { darkMode, onToggleDarkMode, children } = $props<{
    darkMode: boolean;
    onToggleDarkMode: () => void;
    children?: () => unknown;
  }>();
</script>

<div class="min-h-screen bg-base-200 text-base-content">
  <header class="bg-base-100 border-b border-base-300 sticky top-0 z-30">
    <div class="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-6">
      <div class="flex items-center gap-2 text-base-content">
        <div class="w-7 h-7 rounded bg-primary text-primary-content font-bold text-sm flex items-center justify-center">P</div>
        <span class="font-bold">Prolific Pulse</span>
      </div>
      <nav class="flex gap-1" aria-label="Main">
        <span class="px-3 py-1.5 rounded text-sm font-medium bg-primary/10 text-primary">Earnings</span>
      </nav>
      <div class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          onclick={onToggleDarkMode}
        >
          {#if darkMode}
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          {/if}
        </button>
      </div>
    </div>
  </header>
  <main class="max-w-[1400px] mx-auto px-6 py-6">
    {@render children?.()}
  </main>
</div>
