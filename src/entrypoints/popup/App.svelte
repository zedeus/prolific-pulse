<script lang="ts">
  import { untrack } from 'svelte';
  import { browser } from 'wxt/browser';
  import type {
    Study,
    StudyEvent,
    Submission,
    SyncState,
    StudiesRefreshState,
    PriorityFilter,
    NormalizedRefreshPolicy,
    Settings,
    TelegramSettings,
    ResearcherRef,
    FilterListField,
  } from '../../lib/types';
  import type { SubmissionRecord, ResearcherRecord } from '../../lib/db';
  import type { EarningsPrefs } from '../../lib/earnings-prefs';
  import { loadEarningsPrefs, saveEarningsPrefs, DEFAULT_EARNINGS_PREFS } from '../../lib/earnings-prefs';
  import { listCurrencies, detectDefaultCurrency } from '../../lib/earnings';
  import { maybeRefreshFxRatesForPrefs } from '../../lib/fx-rates';
  import { SEED_CURRENCIES } from '../../lib/constants';
  import {
    AUTH_REQUIRED_MESSAGE,
    AUTH_REQUIRED_PANEL_MESSAGE,
    DEFAULT_REFRESH_INTERVAL_MS,
    REACTIVE_REFRESH_DEBOUNCE_MS,
    PRIORITY_FILTER_PERSIST_DEBOUNCE_MS,
    DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS,
    DEFAULT_PRIORITY_ALERT_SOUND_TYPE,
    MAX_PRIORITY_FILTERS,
    SOUND_TYPE_NONE,
    STATE_KEY,
    AUTO_OPEN_PROLIFIC_TAB_KEY,
    PRIORITY_FILTERS_KEY,
    STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY,
    STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY,
    STUDIES_REFRESH_SPREAD_SECONDS_KEY,
    DASHBOARD_DEFAULT_STUDIES_LIMIT,
    DASHBOARD_DEFAULT_EVENTS_LIMIT,
    DASHBOARD_DEFAULT_SUBMISSIONS_LIMIT,
    DEFAULT_TELEGRAM_SETTINGS,
  } from '../../lib/constants';
  import * as store from '../../lib/store';
  import { createDefaultPriorityFilter } from '../../lib/priority-filter';
  import {
    parseDate,
    formatRelative,
    toUserErrorMessage,
    isAuthRequiredState,
    normalizeRefreshPolicy,
    cloneTelegramSettings,
  } from '../../lib/format';
  import { applyThemeAttr, readInitialTheme, watchSystemTheme, writeThemePref } from '../../lib/theme';

  import StatusBar from './components/StatusBar.svelte';
  import TabBar from './components/TabBar.svelte';
  import LivePanel from './components/LivePanel.svelte';
  import FeedPanel from './components/FeedPanel.svelte';
  import SubmissionsPanel from './components/SubmissionsPanel.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';

  // EarningsPanel pulls in ~600 kB of layerchart + d3-scale. Lazy-load it on
  // first visit to the Earnings tab so the initial popup paint stays cheap.
  let EarningsPanelComponent: typeof import('./components/EarningsPanel.svelte').default | null = $state(null);
  let earningsLoadStarted = false;
  function loadEarningsPanel() {
    if (earningsLoadStarted) return;
    earningsLoadStarted = true;
    import('./components/EarningsPanel.svelte').then((mod) => {
      EarningsPanelComponent = mod.default;
    });
  }

  let activeTab = $state('live');
  let darkMode = $state(false);
  let studies: Study[] = $state([]);
  let events: StudyEvent[] = $state([]);
  let submissions: Submission[] = $state([]);
  let extensionState: SyncState | null = $state(null);
  let refreshStateData: StudiesRefreshState | null = $state(null);
  let errorMessage = $state('');
  let isAuthRequired = $state(false);
  let autoOpenEnabled = $state(true);
  let settingsLoaded = $state(false);

  let priorityFilters: PriorityFilter[] = $state([]);
  let telegramSettings: TelegramSettings = $state(cloneTelegramSettings(DEFAULT_TELEGRAM_SETTINGS));
  let allSubmissions: SubmissionRecord[] = $state([]);
  let earningsPrefs: EarningsPrefs = $state({ ...DEFAULT_EARNINGS_PREFS, fx_rates: {}, fx_rates_cache: {} });
  let knownResearchers: ResearcherRecord[] = $state([]);
  let focusFilterId = $state('');

  let savedRefreshPolicy: NormalizedRefreshPolicy = $state(normalizeRefreshPolicy(
    DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS,
  ));

  let latestRefreshDate: Date | null = $state(null);
  let isRefreshingView = $state(false);
  let retryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let reactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let reactiveRefreshPending = false;
  let latestRefreshTicker: ReturnType<typeof setInterval> | null = null;
  let priorityFilterPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let priorityFilterPersistPending = false;
  let priorityFilterPersistInFlight = false;
  let tick = $state(0);

  const refreshPrefix = $derived(
    isAuthRequired && !latestRefreshDate ? '' : 'Updated ',
  );

  const latestRefreshText = $derived.by(() => {
    void tick;
    if (isAuthRequired && !latestRefreshDate) return 'Signed out';
    if (!latestRefreshDate) return 'never';
    return formatRelative(latestRefreshDate);
  });

  const latestRefreshTitle = $derived.by(() => {
    if (isAuthRequired && !latestRefreshDate) return AUTH_REQUIRED_MESSAGE;
    if (!latestRefreshDate) return '';
    return latestRefreshDate.toLocaleString();
  });

  const showPanelOverride = $derived(isAuthRequired);
  const panelOverrideText = $derived(
    isAuthRequired ? AUTH_REQUIRED_PANEL_MESSAGE : '',
  );

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
    latestRefreshTicker = setInterval(() => {
      tick++;
    }, 1000);
    return () => {
      if (latestRefreshTicker) clearInterval(latestRefreshTicker);
    };
  });

  $effect(() => {
    function onMessage(message: Record<string, unknown>) {
      if (!message || message.action !== 'dashboardUpdated') return;
      applyObservedAtUpdate(message.observed_at as string);
      scheduleReactiveRefresh();
    }
    if (browser.runtime?.onMessage) {
      browser.runtime.onMessage.addListener(onMessage);
    }
    return () => {
      if (browser.runtime?.onMessage) {
        browser.runtime.onMessage.removeListener(onMessage);
      }
    };
  });

  $effect(() => {
    untrack(() => {
      refreshSettings();
      refreshView();
    });
  });

  $effect(() => {
    return () => {
      if (retryRefreshTimer) clearTimeout(retryRefreshTimer);
      if (reactiveRefreshTimer) clearTimeout(reactiveRefreshTimer);
      if (priorityFilterPersistTimer) clearTimeout(priorityFilterPersistTimer);
    };
  });

  function jsonEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Cheap identity check for the analytics list: same length and same
  // (submission_id, updated_at) across the same positions. Avoids
  // JSON.stringify on a potentially large array.
  function analyticsListEqual(a: SubmissionRecord[], b: SubmissionRecord[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].submission_id !== b[i].submission_id) return false;
      if (a[i].updated_at !== b[i].updated_at) return false;
    }
    return true;
  }

  interface RuntimeMessageResponse {
    ok: boolean;
    error?: string;
    [key: string]: unknown;
  }
  async function sendRuntimeMessage(action: string, payload: Record<string, unknown> = {}): Promise<RuntimeMessageResponse> {
    const response = (await browser.runtime.sendMessage({ action, ...payload })) as RuntimeMessageResponse | undefined;
    if (!response) throw new Error(`No response from background for ${action}`);
    if (!response.ok) throw new Error(response.error || `Failed: ${action}`);
    return response;
  }

  async function getSyncState(): Promise<SyncState | null> {
    const data = await browser.storage.local.get(STATE_KEY);
    return (data[STATE_KEY] as SyncState) || null;
  }

  async function getSettings(): Promise<Settings> {
    const data = await browser.storage.local.get([
      AUTO_OPEN_PROLIFIC_TAB_KEY,
      STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY,
      STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY,
      STUDIES_REFRESH_SPREAD_SECONDS_KEY,
    ]);
    return {
      auto_open_prolific_tab: data[AUTO_OPEN_PROLIFIC_TAB_KEY] !== false,
      studies_refresh_min_delay_seconds: Number(data[STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY] ?? DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS),
      studies_refresh_average_delay_seconds: Number(data[STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY] ?? DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS),
      studies_refresh_spread_seconds: Number(data[STUDIES_REFRESH_SPREAD_SECONDS_KEY] ?? DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS),
    };
  }

  async function loadPriorityFilters(): Promise<PriorityFilter[]> {
    const data = await browser.storage.local.get(PRIORITY_FILTERS_KEY);
    const raw = data[PRIORITY_FILTERS_KEY];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f: unknown) => f && typeof f === 'object')
      .map((raw: Record<string, unknown>) => {
        const filter = { ...raw } as unknown as PriorityFilter;
        const bag = filter as unknown as Record<string, unknown>;
        if (filter.alert_sound_enabled === false) {
          filter.alert_sound_type = SOUND_TYPE_NONE;
        }
        // Rename: always_open_* → match_* (whitelist semantics). Accept the
        // legacy names for one-time migration on popup load.
        if (!Array.isArray(filter.match_keywords)) {
          filter.match_keywords = Array.isArray(bag.always_open_keywords) ? (bag.always_open_keywords as string[]) : [];
        }
        if (!Array.isArray(filter.match_researchers)) {
          filter.match_researchers = Array.isArray(bag.always_open_researchers) ? (bag.always_open_researchers as ResearcherRef[]) : [];
        }
        delete bag.always_open_keywords;
        delete bag.always_open_researchers;
        if (!Array.isArray(filter.ignore_researchers)) filter.ignore_researchers = [];
        return filter;
      });
  }

  async function setAutoOpen(enabled: boolean) {
    await sendRuntimeMessage('setAutoOpen', { enabled });
  }

  async function setPriorityFiltersRemote(filters: PriorityFilter[]): Promise<PriorityFilter[]> {
    const response = await sendRuntimeMessage('setPriorityFilters', { filters });
    return Array.isArray(response.filters) ? response.filters : filters;
  }

  async function setRefreshDelays(minDelay: number, avgDelay: number, spread: number): Promise<Settings> {
    const response = await sendRuntimeMessage('setRefreshDelays', {
      minimum_delay_seconds: minDelay,
      average_delay_seconds: avgDelay,
      spread_seconds: spread,
    });
    return (response.settings as Settings | undefined) ?? ({} as Settings);
  }

  async function clearDebugLogs() {
    await sendRuntimeMessage('clearDebugLogs');
  }

  async function getDashboardData(liveLimit = 50, eventsLimit = 25, submissionsLimit = 100) {
    const [refreshState, studiesList, eventsList, submissionsList, analyticsList, researcherList] = await Promise.all([
      store.getStudiesRefresh(),
      store.getCurrentAvailableStudies(liveLimit),
      store.getRecentAvailabilityEvents(eventsLimit),
      store.getCurrentSubmissions(submissionsLimit, 'all'),
      store.getSubmissionsForAnalytics(),
      store.listKnownResearchers(),
    ]);
    const researchers = store.annotateResearcherCounts(researcherList, studiesList, analyticsList);
    return { refreshState, studies: studiesList, events: eventsList, submissions: submissionsList, analyticsSubmissions: analyticsList, researchers };
  }


  function scheduleViewRefreshAfter(delayMs: number) {
    if (retryRefreshTimer) clearTimeout(retryRefreshTimer);
    retryRefreshTimer = setTimeout(() => {
      retryRefreshTimer = null;
      refreshView();
    }, delayMs);
  }

  function scheduleRegularRefresh() {
    scheduleViewRefreshAfter(DEFAULT_REFRESH_INTERVAL_MS);
  }

  function scheduleReactiveRefresh() {
    reactiveRefreshPending = true;
    if (reactiveRefreshTimer || isRefreshingView) return;
    reactiveRefreshTimer = setTimeout(() => {
      reactiveRefreshTimer = null;
      if (!reactiveRefreshPending) return;
      reactiveRefreshPending = false;
      refreshView();
    }, REACTIVE_REFRESH_DEBOUNCE_MS);
  }

  function applyObservedAtUpdate(observedAt: string) {
    const date = parseDate(observedAt);
    if (!date) return;
    latestRefreshDate = date;
  }

  function deriveErrorMessage(state: SyncState | null, sourceError: string): string {
    if (sourceError) return sourceError.trim();
    if (!state) return '';
    if (state.token_ok === false) return (state.token_reason || 'Token sync error.').trim();
    if (state.studies_refresh_ok === false) return (state.studies_refresh_reason || 'Studies refresh sync error.').trim();
    if (
      state.studies_response_capture_supported === true &&
      state.studies_response_capture_ok === false &&
      state.studies_response_capture_reason
    ) {
      return state.studies_response_capture_reason.trim();
    }
    return '';
  }

  async function refreshSettings() {
    try {
      const [settings, filters, tgResponse, prefs] = await Promise.all([
        getSettings(),
        loadPriorityFilters(),
        sendRuntimeMessage('getTelegramSettings').catch(() => null),
        loadEarningsPrefs(),
      ]);
      autoOpenEnabled = settings.auto_open_prolific_tab !== false;
      priorityFilters = filters;
      earningsPrefs = prefs;
      if (tgResponse?.settings) {
        telegramSettings = tgResponse.settings as TelegramSettings;
      }
      const rp = normalizeRefreshPolicy(
        settings.studies_refresh_min_delay_seconds,
        settings.studies_refresh_average_delay_seconds,
        settings.studies_refresh_spread_seconds,
      );
      savedRefreshPolicy = rp;
      settingsLoaded = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function refreshView() {
    if (isRefreshingView) {
      reactiveRefreshPending = true;
      return;
    }
    isRefreshingView = true;
    reactiveRefreshPending = false;

    try {
      const [stateResult, dashboardResult] = await Promise.allSettled([
        getSyncState(),
        getDashboardData(DASHBOARD_DEFAULT_STUDIES_LIMIT, DASHBOARD_DEFAULT_EVENTS_LIMIT, DASHBOARD_DEFAULT_SUBMISSIONS_LIMIT),
      ]);

      const extState = stateResult.status === 'fulfilled' ? stateResult.value : null;
      extensionState = extState;
      const authRequired = isAuthRequiredState(extState);
      isAuthRequired = authRequired;

      const dashboard = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
      const refreshSt = dashboard?.refreshState ?? null;
      refreshStateData = refreshSt;

      scheduleRegularRefresh();

      if (authRequired) {
        if (studies.length) studies = [];
        if (events.length) events = [];
        if (submissions.length) submissions = [];
        if (allSubmissions.length) allSubmissions = [];
      } else if (dashboard) {
        const newStudies = dashboard.studies ?? [];
        const newEvents = dashboard.events ?? [];
        const newSubmissions = dashboard.submissions ?? [];
        const newAnalytics = dashboard.analyticsSubmissions ?? [];
        const newResearchers = dashboard.researchers ?? [];
        if (!jsonEqual(studies, newStudies)) studies = newStudies;
        if (!jsonEqual(events, newEvents)) events = newEvents;
        if (!jsonEqual(submissions, newSubmissions)) submissions = newSubmissions;
        if (!analyticsListEqual(allSubmissions, newAnalytics)) allSubmissions = newAnalytics;
        if (!jsonEqual(knownResearchers, newResearchers)) knownResearchers = newResearchers;
      }

      let firstErrorMessage = '';
      if (stateResult.status === 'rejected') {
        firstErrorMessage = toUserErrorMessage((stateResult as PromiseRejectedResult).reason);
      } else if (dashboardResult.status === 'rejected') {
        firstErrorMessage = toUserErrorMessage((dashboardResult as PromiseRejectedResult).reason);
      }

      let healthMessage = deriveErrorMessage(extState, firstErrorMessage);
      if (authRequired) healthMessage = AUTH_REQUIRED_MESSAGE;

      latestRefreshDate = authRequired ? null : (parseDate(refreshSt?.last_studies_refresh_at) ?? null);

      errorMessage = healthMessage;
    } finally {
      isRefreshingView = false;
      if (reactiveRefreshPending && !reactiveRefreshTimer) {
        scheduleReactiveRefresh();
      }
    }
  }

  async function handleAutoOpenChange(enabled: boolean) {
    try {
      await setAutoOpen(enabled);
      await refreshView();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      await refreshSettings();
    }
  }

  async function persistPriorityFiltersIfNeeded() {
    if (priorityFilterPersistInFlight) return;
    priorityFilterPersistInFlight = true;
    try {
      while (priorityFilterPersistPending) {
        priorityFilterPersistPending = false;
        try {
          // JSON round-trip strips Svelte $state proxies (structuredClone cannot clone them)
          const plain = JSON.parse(JSON.stringify(priorityFilters)) as PriorityFilter[];
          for (const f of plain) {
            if (f.alert_sound_type === SOUND_TYPE_NONE) {
              f.alert_sound_enabled = false;
              f.alert_sound_type = DEFAULT_PRIORITY_ALERT_SOUND_TYPE;
            } else {
              f.alert_sound_enabled = true;
            }
          }
          await setPriorityFiltersRemote(plain);
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      priorityFilterPersistInFlight = false;
    }
  }

  function handlePriorityFiltersChange() {
    priorityFilterPersistPending = true;
    if (priorityFilterPersistTimer) clearTimeout(priorityFilterPersistTimer);
    priorityFilterPersistTimer = setTimeout(() => {
      priorityFilterPersistTimer = null;
      void persistPriorityFiltersIfNeeded();
    }, PRIORITY_FILTER_PERSIST_DEBOUNCE_MS);
  }

  async function handleRefreshPolicySave(minDelay: number, avgDelay: number, spread: number) {
    try {
      const saved = await setRefreshDelays(minDelay, avgDelay, spread);
      const normalized = normalizeRefreshPolicy(
        saved.studies_refresh_min_delay_seconds,
        saved.studies_refresh_average_delay_seconds,
        saved.studies_refresh_spread_seconds,
      );
      savedRefreshPolicy = normalized;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleRefreshDebug() {
    await refreshView();
  }

  async function handleClearDebugLogs() {
    try {
      await clearDebugLogs();
      await refreshView();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleTelegramSettingsChange(settings: TelegramSettings) {
    try {
      const response = await sendRuntimeMessage('setTelegramSettings', { settings });
      if (response?.settings) {
        telegramSettings = response.settings as TelegramSettings;
      }
    } catch (err) {
      errorMessage = toUserErrorMessage(err);
    }
  }

  async function handleTelegramTest(settings: TelegramSettings): Promise<{ ok: boolean; error?: string; description?: string }> {
    try {
      return await sendRuntimeMessage('testTelegramMessage', { settings });
    } catch (err) {
      return { ok: false, error: toUserErrorMessage(err) };
    }
  }

  async function handleTelegramVerifyBot(botToken: string): Promise<{ ok: boolean; bot_name?: string; bot_username?: string; error?: string }> {
    try {
      return await sendRuntimeMessage('verifyTelegramBot', { bot_token: botToken });
    } catch (err) {
      return { ok: false, error: toUserErrorMessage(err) };
    }
  }

  function handleStudyClick(url: string) {
    if (!url) return;
    browser.tabs.create({ url, active: true }).then(() => {
      setTimeout(() => window.close(), 0);
    });
  }

  function researcherRefFromStudy(study: Study): ResearcherRef | null {
    const id = study?.researcher?.id?.trim();
    if (!id) return null;
    return { id, name: study.researcher?.name?.trim() || id };
  }

  function addResearcherToExistingFilter(study: Study, filterId: string, field: FilterListField) {
    const ref = researcherRefFromStudy(study);
    if (!ref) return;
    const target = priorityFilters.find((f) => f.id === filterId);
    if (!target) return;
    const list = field === 'match' ? (target.match_researchers || []) : (target.ignore_researchers || []);
    if (list.some((r) => r.id === ref.id)) return;
    if (field === 'match') {
      target.match_researchers = [...list, ref];
    } else {
      target.ignore_researchers = [...list, ref];
    }
    handlePriorityFiltersChange();
  }

  function addResearcherToNewFilter(study: Study, field: FilterListField) {
    const ref = researcherRefFromStudy(study);
    if (!ref) return;
    if (priorityFilters.length >= MAX_PRIORITY_FILTERS) {
      errorMessage = `Filter limit reached (${MAX_PRIORITY_FILTERS}).`;
      return;
    }
    const isMatch = field === 'match';
    const newFilter = createDefaultPriorityFilter({
      name: isMatch ? `${ref.name} - prioritize` : `${ref.name} - blacklist`,
      auto_open_in_new_tab: isMatch,
      alert_sound_enabled: isMatch,
      alert_sound_type: isMatch ? DEFAULT_PRIORITY_ALERT_SOUND_TYPE : SOUND_TYPE_NONE,
      telegram_notify: isMatch,
      match_researchers: isMatch ? [ref] : [],
      ignore_researchers: isMatch ? [] : [ref],
    });
    priorityFilters = [...priorityFilters, newFilter];
    handlePriorityFiltersChange();
    focusFilterId = newFilter.id;
    activeTab = 'settings';
  }

  async function copyStudyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      errorMessage = toUserErrorMessage(err);
    }
  }

  async function sendStudyToTelegram(study: Study) {
    try {
      await sendRuntimeMessage('sendStudyToTelegram', { study });
    } catch (err) {
      errorMessage = toUserErrorMessage(err);
    }
  }

  function clearFocusFilter() {
    focusFilterId = '';
  }

  function handleTabChange(tab: string) {
    activeTab = tab;
    if (tab === 'earnings') loadEarningsPanel();
  }

  async function handleEarningsPrefsChange(prefs: EarningsPrefs) {
    earningsPrefs = prefs;
    try {
      await saveEarningsPrefs(prefs);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  let fxRefreshInFlight = false;
  let fxRefreshQueued = false;
  async function maybeRefreshFxRates() {
    if (fxRefreshInFlight) { fxRefreshQueued = true; return; }
    fxRefreshInFlight = true;
    fxRefreshQueued = false;
    try {
      await maybeRefreshFxRatesForPrefs({
        submissions: allSubmissions,
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
    void allSubmissions;
    void earningsPrefs.primary_currency;
    void maybeRefreshFxRates();
  });
</script>

<main class="w-[620px] p-3 bg-base-200 text-base-content">
  <StatusBar
    offline={!!errorMessage}
    {errorMessage}
    {latestRefreshText}
    {latestRefreshTitle}
    {refreshPrefix}
    {darkMode}
    onToggleDarkMode={toggleDarkMode}
  />

  <TabBar {activeTab} onTabChange={handleTabChange} />

  <!-- All panels are always in DOM; .panel/.active CSS toggles visibility.
       This is required for WebdriverIO test compatibility. -->
  <LivePanel
    active={activeTab === 'live'}
    {studies}
    {priorityFilters}
    {telegramSettings}
    overrideMessage={showPanelOverride ? panelOverrideText : ''}
    onStudyClick={handleStudyClick}
    onAddResearcherToFilter={addResearcherToExistingFilter}
    onAddResearcherToNewFilter={addResearcherToNewFilter}
    onCopyLink={copyStudyLink}
    onSendStudyToTelegram={sendStudyToTelegram}
  />
  <FeedPanel
    active={activeTab === 'feed'}
    {events}
    overrideMessage={showPanelOverride ? panelOverrideText : ''}
    onStudyClick={handleStudyClick}
  />
  <SubmissionsPanel
    active={activeTab === 'submissions'}
    {submissions}
    {allSubmissions}
    {earningsPrefs}
    overrideMessage={showPanelOverride ? panelOverrideText : ''}
    onStudyClick={handleStudyClick}
    onEarningsPrefsChange={handleEarningsPrefsChange}
  />
  {#if EarningsPanelComponent}
    {@const Earnings = EarningsPanelComponent}
    <Earnings
      active={activeTab === 'earnings'}
      {allSubmissions}
      {earningsPrefs}
      onEarningsPrefsChange={handleEarningsPrefsChange}
      overrideMessage={showPanelOverride ? panelOverrideText : ''}
    />
  {:else}
    <div id="panelEarnings" class="panel" class:active={activeTab === 'earnings'}></div>
  {/if}
  {#if settingsLoaded}
  <SettingsPanel
    active={activeTab === 'settings'}
    {autoOpenEnabled}
    bind:priorityFilters
    {telegramSettings}
    {savedRefreshPolicy}
    {extensionState}
    refreshState={refreshStateData}
    {earningsPrefs}
    {allSubmissions}
    {knownResearchers}
    {focusFilterId}
    onAutoOpenChange={handleAutoOpenChange}
    onPriorityFiltersChange={handlePriorityFiltersChange}
    onTelegramSettingsChange={handleTelegramSettingsChange}
    onTelegramTest={handleTelegramTest}
    onTelegramVerifyBot={handleTelegramVerifyBot}
    onRefreshPolicySave={handleRefreshPolicySave}
    onRefreshDebug={handleRefreshDebug}
    onClearDebugLogs={handleClearDebugLogs}
    onEarningsPrefsChange={handleEarningsPrefsChange}
    onFilterFocused={clearFocusFilter}
  />
  {:else}
    <div id="panelSettings" class="panel" class:active={activeTab === 'settings'}></div>
  {/if}
</main>
