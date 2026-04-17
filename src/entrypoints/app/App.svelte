<script lang="ts">
  import { untrack } from 'svelte';
  import { browser } from 'wxt/browser';
  import type { SubmissionRecord } from '../../lib/db';
  import { db } from '../../lib/db';
  import type { EarningsPrefs } from '../../lib/earnings-prefs';
  import { loadEarningsPrefs, saveEarningsPrefs, DEFAULT_EARNINGS_PREFS } from '../../lib/earnings-prefs';
  import { listCurrencies, detectDefaultCurrency } from '../../lib/earnings';
  import { maybeRefreshFxRatesForPrefs } from '../../lib/fx-rates';
  import { SEED_CURRENCIES } from '../../lib/constants';
  import { applyThemeAttr, readInitialTheme, watchSystemTheme, writeThemePref } from '../../lib/theme';

  import AppShell from './components/AppShell.svelte';
  import EarningsView from './views/EarningsView.svelte';

  let submissions: SubmissionRecord[] = $state([]);
  let earningsPrefs: EarningsPrefs = $state({ ...DEFAULT_EARNINGS_PREFS, fx_rates: {}, fx_rates_cache: {} });
  let loading = $state(true);
  let darkMode = $state(false);

  function setDark(dark: boolean) {
    darkMode = dark;
    applyThemeAttr(dark);
  }
  function toggleDarkMode() {
    setDark(!darkMode);
    void writeThemePref(darkMode);
  }

  $effect(() => {
    untrack(async () => {
      setDark((await readInitialTheme()) === 'dark');
    });
    return watchSystemTheme(setDark);
  });

  $effect(() => {
    untrack(loadAll);
    const onMessage = (msg: Record<string, unknown>) => {
      if (msg?.action === 'dashboardUpdated') void loadAll();
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  });

  async function loadAll() {
    try {
      const [rows, prefs] = await Promise.all([
        db.submissions.where('phase').equals('submitted').toArray(),
        loadEarningsPrefs(),
      ]);
      submissions = rows;
      earningsPrefs = prefs;
    } finally {
      loading = false;
    }
  }

  async function handleEarningsPrefsChange(prefs: EarningsPrefs) {
    earningsPrefs = prefs;
    try { await saveEarningsPrefs(prefs); } catch { /* ignore */ }
  }

  let fxRefreshInFlight = false;
  let fxRefreshQueued = false;
  async function maybeRefreshFxRates() {
    if (fxRefreshInFlight) { fxRefreshQueued = true; return; }
    fxRefreshInFlight = true;
    fxRefreshQueued = false;
    try {
      await maybeRefreshFxRatesForPrefs({
        submissions,
        primaryCurrency: earningsPrefs.primary_currency,
        fxCache: earningsPrefs.fx_rates_cache,
        seedCurrencies: SEED_CURRENCIES,
        detectCurrency: detectDefaultCurrency,
        listCurrencies,
        onCacheUpdated: (cache) => handleEarningsPrefsChange({ ...earningsPrefs, fx_rates_cache: cache }),
      });
    } finally {
      fxRefreshInFlight = false;
      if (fxRefreshQueued) void maybeRefreshFxRates();
    }
  }

  $effect(() => {
    void submissions;
    void earningsPrefs.primary_currency;
    void maybeRefreshFxRates();
  });
</script>

<AppShell {darkMode} onToggleDarkMode={toggleDarkMode}>
  {#if loading}
    <div class="space-y-5 animate-pulse">
      <div class="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div class="h-6 w-32 bg-base-300 rounded"></div>
          <div class="h-4 w-48 bg-base-300 rounded mt-2 opacity-60"></div>
        </div>
        <div class="h-9 w-72 bg-base-300 rounded"></div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        {#each Array(5) as _, i (i)}
          <div class="h-24 bg-base-100 border border-base-300 rounded-lg"></div>
        {/each}
      </div>
      <div class="h-56 bg-base-100 border border-base-300 rounded-lg"></div>
      <div class="h-48 bg-base-100 border border-base-300 rounded-lg"></div>
    </div>
  {:else}
    <EarningsView
      {submissions}
      {earningsPrefs}
      onEarningsPrefsChange={handleEarningsPrefsChange}
      onReloadSubmissions={loadAll}
    />
  {/if}
</AppShell>
