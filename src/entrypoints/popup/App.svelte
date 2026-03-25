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
  } from '../../lib/types';
  import {
    AUTH_REQUIRED_MESSAGE,
    AUTH_REQUIRED_PANEL_MESSAGE,
    DEFAULT_REFRESH_INTERVAL_MS,
    REACTIVE_REFRESH_DEBOUNCE_MS,
    PRIORITY_FILTER_PERSIST_DEBOUNCE_MS,
    DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS,
    DEFAULT_PRIORITY_FILTER_MIN_REWARD,
    DEFAULT_PRIORITY_FILTER_MIN_HOURLY_REWARD,
    DEFAULT_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
    DEFAULT_PRIORITY_FILTER_MIN_PLACES,
    DEFAULT_PRIORITY_ALERT_SOUND_TYPE,
    DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
    MIN_PRIORITY_ALERT_SOUND_VOLUME,
    MAX_PRIORITY_ALERT_SOUND_VOLUME,
    STATE_KEY,
    AUTO_OPEN_PROLIFIC_TAB_KEY,
    PRIORITY_FILTER_ENABLED_KEY,
    PRIORITY_FILTER_AUTO_OPEN_NEW_TAB_KEY,
    PRIORITY_FILTER_ALERT_SOUND_ENABLED_KEY,
    PRIORITY_FILTER_ALERT_SOUND_TYPE_KEY,
    PRIORITY_FILTER_ALERT_SOUND_VOLUME_KEY,
    PRIORITY_FILTER_MIN_REWARD_KEY,
    PRIORITY_FILTER_MIN_HOURLY_REWARD_KEY,
    PRIORITY_FILTER_MAX_ESTIMATED_MINUTES_KEY,
    PRIORITY_FILTER_MIN_PLACES_KEY,
    PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY,
    PRIORITY_FILTER_IGNORE_KEYWORDS_KEY,
    STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY,
    STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY,
    STUDIES_REFRESH_SPREAD_SECONDS_KEY,
    DASHBOARD_DEFAULT_STUDIES_LIMIT,
    DASHBOARD_DEFAULT_EVENTS_LIMIT,
    DASHBOARD_DEFAULT_SUBMISSIONS_LIMIT,
  } from '../../lib/constants';
  import * as store from '../../lib/store';
  import {
    parseDate,
    formatRelative,
    toUserErrorMessage,
    isAuthRequiredState,
    normalizeRefreshPolicy,
    canonicalSoundType,
    clampInt,
    clampNumber,
  } from '../../lib/format';

  import StatusBar from './components/StatusBar.svelte';
  import TabBar from './components/TabBar.svelte';
  import LivePanel from './components/LivePanel.svelte';
  import FeedPanel from './components/FeedPanel.svelte';
  import SubmissionsPanel from './components/SubmissionsPanel.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';

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

  let priorityFilter: PriorityFilter = $state({
    enabled: false,
    auto_open_in_new_tab: true,
    alert_sound_enabled: true,
    alert_sound_type: DEFAULT_PRIORITY_ALERT_SOUND_TYPE,
    alert_sound_volume: DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
    minimum_reward_major: DEFAULT_PRIORITY_FILTER_MIN_REWARD,
    minimum_hourly_reward_major: DEFAULT_PRIORITY_FILTER_MIN_HOURLY_REWARD,
    maximum_estimated_minutes: DEFAULT_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
    minimum_places_available: DEFAULT_PRIORITY_FILTER_MIN_PLACES,
    always_open_keywords: [],
    ignore_keywords: [],
  });

  let savedRefreshPolicy: NormalizedRefreshPolicy = $state(normalizeRefreshPolicy(
    DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS,
  ));

  let latestRefreshDate: Date | null = $state(null);
  let latestRefreshOffline = $state(false);
  let isRefreshingView = $state(false);
  let retryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let reactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let reactiveRefreshPending = false;
  let latestRefreshTicker: ReturnType<typeof setInterval> | null = null;
  let priorityFilterPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let priorityFilterPersistPending = false;
  let priorityFilterPersistInFlight = false;
  let tick = $state(0);

  const refreshPrefix = $derived.by(() => {
    if (latestRefreshOffline) return '';
    if (isAuthRequired && !latestRefreshDate) return '';
    return 'Updated ';
  });

  const latestRefreshText = $derived.by(() => {
    void tick;
    if (latestRefreshOffline) return 'Offline';
    if (isAuthRequired && !latestRefreshDate) return 'Signed out';
    if (!latestRefreshDate) return 'never';
    return formatRelative(latestRefreshDate);
  });

  const latestRefreshTitle = $derived.by(() => {
    if (latestRefreshOffline) return 'Local service unavailable';
    if (isAuthRequired && !latestRefreshDate) return AUTH_REQUIRED_MESSAGE;
    if (!latestRefreshDate) return '';
    return latestRefreshDate.toLocaleString();
  });

  const showPanelOverride = $derived(isAuthRequired);
  const panelOverrideText = $derived(
    isAuthRequired ? AUTH_REQUIRED_PANEL_MESSAGE : '',
  );

  function applyTheme(dark: boolean) {
    darkMode = dark;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  // Load theme preference: stored override > system preference
  $effect(() => {
    untrack(() => {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      browser.storage.local.get('themePreference').then((data: Record<string, unknown>) => {
        const pref = data.themePreference as string | undefined;
        if (pref === 'dark') applyTheme(true);
        else if (pref === 'light') applyTheme(false);
        else applyTheme(systemDark);
      });
    });
  });

  // Follow system preference changes (only when no manual override is stored)
  $effect(() => {
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      browser.storage.local.get('themePreference').then((data: Record<string, unknown>) => {
        if (!data.themePreference) applyTheme(e.matches);
      });
    };
    darkQuery.addEventListener('change', handler);
    return () => darkQuery.removeEventListener('change', handler);
  });

  function toggleDarkMode() {
    const next = !darkMode;
    applyTheme(next);
    // Cycle: light → dark → system (clear preference)
    // For simplicity: just toggle and store
    browser.storage.local.set({ themePreference: next ? 'dark' : 'light' });
  }

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
      if (retryCountdownTimer) clearInterval(retryCountdownTimer);
      if (retryRefreshTimer) clearTimeout(retryRefreshTimer);
      if (reactiveRefreshTimer) clearTimeout(reactiveRefreshTimer);
      if (priorityFilterPersistTimer) clearTimeout(priorityFilterPersistTimer);
    };
  });

  function jsonEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  async function sendRuntimeMessage(action: string, payload: Record<string, unknown> = {}) {
    const response = await browser.runtime.sendMessage({ action, ...payload });
    if (!response) throw new Error(`No response from background for ${action}`);
    if (!(response as any).ok) throw new Error((response as any).error || `Failed: ${action}`);
    return response as any;
  }

  async function getSyncState(): Promise<SyncState | null> {
    const data = await browser.storage.local.get(STATE_KEY);
    return (data[STATE_KEY] as SyncState) || null;
  }

  async function getSettings(): Promise<Settings> {
    const data = await browser.storage.local.get([
      AUTO_OPEN_PROLIFIC_TAB_KEY,
      PRIORITY_FILTER_ENABLED_KEY,
      PRIORITY_FILTER_AUTO_OPEN_NEW_TAB_KEY,
      PRIORITY_FILTER_ALERT_SOUND_ENABLED_KEY,
      PRIORITY_FILTER_ALERT_SOUND_TYPE_KEY,
      PRIORITY_FILTER_ALERT_SOUND_VOLUME_KEY,
      PRIORITY_FILTER_MIN_REWARD_KEY,
      PRIORITY_FILTER_MIN_HOURLY_REWARD_KEY,
      PRIORITY_FILTER_MAX_ESTIMATED_MINUTES_KEY,
      PRIORITY_FILTER_MIN_PLACES_KEY,
      PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY,
      PRIORITY_FILTER_IGNORE_KEYWORDS_KEY,
      STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY,
      STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY,
      STUDIES_REFRESH_SPREAD_SECONDS_KEY,
    ]);
    return {
      auto_open_prolific_tab: data[AUTO_OPEN_PROLIFIC_TAB_KEY] !== false,
      priority_filter_enabled: data[PRIORITY_FILTER_ENABLED_KEY] === true,
      priority_filter_auto_open_in_new_tab: data[PRIORITY_FILTER_AUTO_OPEN_NEW_TAB_KEY] !== false,
      priority_filter_alert_sound_enabled: data[PRIORITY_FILTER_ALERT_SOUND_ENABLED_KEY] !== false,
      priority_filter_alert_sound_type: String(data[PRIORITY_FILTER_ALERT_SOUND_TYPE_KEY] ?? DEFAULT_PRIORITY_ALERT_SOUND_TYPE),
      priority_filter_alert_sound_volume: Number(data[PRIORITY_FILTER_ALERT_SOUND_VOLUME_KEY] ?? DEFAULT_PRIORITY_ALERT_SOUND_VOLUME),
      priority_filter_minimum_reward: Number(data[PRIORITY_FILTER_MIN_REWARD_KEY] ?? DEFAULT_PRIORITY_FILTER_MIN_REWARD),
      priority_filter_minimum_hourly_reward: Number(data[PRIORITY_FILTER_MIN_HOURLY_REWARD_KEY] ?? DEFAULT_PRIORITY_FILTER_MIN_HOURLY_REWARD),
      priority_filter_maximum_estimated_minutes: Number(data[PRIORITY_FILTER_MAX_ESTIMATED_MINUTES_KEY] ?? DEFAULT_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES),
      priority_filter_minimum_places: Number(data[PRIORITY_FILTER_MIN_PLACES_KEY] ?? DEFAULT_PRIORITY_FILTER_MIN_PLACES),
      priority_filter_always_open_keywords: Array.isArray(data[PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY]) ? data[PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY] as string[] : [],
      priority_filter_ignore_keywords: Array.isArray(data[PRIORITY_FILTER_IGNORE_KEYWORDS_KEY]) ? data[PRIORITY_FILTER_IGNORE_KEYWORDS_KEY] as string[] : [],
      studies_refresh_min_delay_seconds: Number(data[STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY] ?? DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS),
      studies_refresh_average_delay_seconds: Number(data[STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY] ?? DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS),
      studies_refresh_spread_seconds: Number(data[STUDIES_REFRESH_SPREAD_SECONDS_KEY] ?? DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS),
    } as Settings;
  }

  async function setAutoOpen(enabled: boolean) {
    await sendRuntimeMessage('setAutoOpen', { enabled });
  }

  async function setPriorityFilterRemote(filter: PriorityFilter): Promise<Settings> {
    const response = await sendRuntimeMessage('setPriorityFilter', filter as any);
    return response.settings || {};
  }

  async function setRefreshDelays(minDelay: number, avgDelay: number, spread: number): Promise<Settings> {
    const response = await sendRuntimeMessage('setRefreshDelays', {
      minimum_delay_seconds: minDelay,
      average_delay_seconds: avgDelay,
      spread_seconds: spread,
    });
    return response.settings || {};
  }

  async function clearDebugLogs() {
    await sendRuntimeMessage('clearDebugLogs');
  }

  async function getDashboardData(liveLimit = 50, eventsLimit = 25, submissionsLimit = 100) {
    const [refreshState, studiesList, eventsList, submissionsList] = await Promise.all([
      store.getStudiesRefresh(),
      store.getCurrentAvailableStudies(liveLimit),
      store.getRecentAvailabilityEvents(eventsLimit),
      store.getCurrentSubmissions(submissionsLimit, 'all'),
    ]);
    return { refreshState, studies: studiesList, events: eventsList, submissions: submissionsList };
  }

  function normalizePriorityFilterFromSettings(s: Settings): PriorityFilter {
    return {
      enabled: s.priority_filter_enabled === true,
      auto_open_in_new_tab: s.priority_filter_auto_open_in_new_tab !== false,
      alert_sound_enabled: s.priority_filter_alert_sound_enabled !== false,
      alert_sound_type: canonicalSoundType(s.priority_filter_alert_sound_type),
      alert_sound_volume: clampInt(
        s.priority_filter_alert_sound_volume,
        MIN_PRIORITY_ALERT_SOUND_VOLUME,
        MAX_PRIORITY_ALERT_SOUND_VOLUME,
        DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
      ),
      minimum_reward_major: Math.round(clampNumber(
        s.priority_filter_minimum_reward, 0, 100, DEFAULT_PRIORITY_FILTER_MIN_REWARD,
      ) * 100) / 100,
      minimum_hourly_reward_major: Math.round(clampNumber(
        s.priority_filter_minimum_hourly_reward, 0, 100, DEFAULT_PRIORITY_FILTER_MIN_HOURLY_REWARD,
      ) * 100) / 100,
      maximum_estimated_minutes: clampInt(
        s.priority_filter_maximum_estimated_minutes, 1, 240, DEFAULT_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
      ),
      minimum_places_available: clampInt(
        s.priority_filter_minimum_places, 1, 1000, DEFAULT_PRIORITY_FILTER_MIN_PLACES,
      ),
      always_open_keywords: Array.isArray(s.priority_filter_always_open_keywords)
        ? s.priority_filter_always_open_keywords : [],
      ignore_keywords: Array.isArray(s.priority_filter_ignore_keywords)
        ? s.priority_filter_ignore_keywords : [],
    };
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
    latestRefreshOffline = false;
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
      const settings = await getSettings();
      autoOpenEnabled = settings.auto_open_prolific_tab !== false;
      const pf = normalizePriorityFilterFromSettings(settings);
      priorityFilter = pf;
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
      } else if (dashboard) {
        const newStudies = dashboard.studies ?? [];
        const newEvents = dashboard.events ?? [];
        const newSubmissions = dashboard.submissions ?? [];
        if (!jsonEqual(studies, newStudies)) studies = newStudies;
        if (!jsonEqual(events, newEvents)) events = newEvents;
        if (!jsonEqual(submissions, newSubmissions)) submissions = newSubmissions;
      }

      let firstErrorMessage = '';
      if (stateResult.status === 'rejected') {
        firstErrorMessage = toUserErrorMessage((stateResult as PromiseRejectedResult).reason);
      } else if (dashboardResult.status === 'rejected') {
        firstErrorMessage = toUserErrorMessage((dashboardResult as PromiseRejectedResult).reason);
      }

      let healthMessage = deriveErrorMessage(extState, firstErrorMessage);
      if (authRequired) healthMessage = AUTH_REQUIRED_MESSAGE;

      // Update refresh time display
      if (authRequired) {
        latestRefreshOffline = false;
        latestRefreshDate = null;
      } else {
        const latest = parseDate(refreshSt?.last_studies_refresh_at);
        if (latest) {
          latestRefreshDate = latest;
          latestRefreshOffline = false;
        } else {
          latestRefreshDate = null;
          latestRefreshOffline = false;
        }
      }

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

  async function persistPriorityFilterIfNeeded() {
    if (priorityFilterPersistInFlight) return;
    priorityFilterPersistInFlight = true;
    try {
      while (priorityFilterPersistPending) {
        priorityFilterPersistPending = false;
        try {
          // Create a plain object copy to strip Svelte $state proxies before runtime.sendMessage
          const plain: PriorityFilter = {
            enabled: priorityFilter.enabled,
            auto_open_in_new_tab: priorityFilter.auto_open_in_new_tab,
            alert_sound_enabled: priorityFilter.alert_sound_enabled,
            alert_sound_type: priorityFilter.alert_sound_type,
            alert_sound_volume: priorityFilter.alert_sound_volume,
            minimum_reward_major: priorityFilter.minimum_reward_major,
            minimum_hourly_reward_major: priorityFilter.minimum_hourly_reward_major,
            maximum_estimated_minutes: priorityFilter.maximum_estimated_minutes,
            minimum_places_available: priorityFilter.minimum_places_available,
            always_open_keywords: [...priorityFilter.always_open_keywords],
            ignore_keywords: [...priorityFilter.ignore_keywords],
          };
          await setPriorityFilterRemote(plain);
          // Don't write normalized back to priorityFilter — the child owns editing state
          // via $bindable, and writing back would cause the round-trip flicker.
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      priorityFilterPersistInFlight = false;
    }
  }

  function handlePriorityFilterChange(_filter: PriorityFilter) {
    // The binding has already updated priorityFilter in the parent.
    // We only need to schedule persistence here.
    priorityFilterPersistPending = true;
    if (priorityFilterPersistTimer) clearTimeout(priorityFilterPersistTimer);
    priorityFilterPersistTimer = setTimeout(() => {
      priorityFilterPersistTimer = null;
      void persistPriorityFilterIfNeeded();
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

  function handleStudyClick(url: string) {
    if (!url) return;
    browser.tabs.create({ url, active: true }).then(() => {
      setTimeout(() => window.close(), 0);
    });
  }

  function handleTabChange(tab: string) {
    activeTab = tab;
  }
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
    {priorityFilter}
    overrideMessage={showPanelOverride ? panelOverrideText : ''}
    onStudyClick={handleStudyClick}
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
    overrideMessage={showPanelOverride ? panelOverrideText : ''}
    onStudyClick={handleStudyClick}
  />
  {#if settingsLoaded}
  <SettingsPanel
    active={activeTab === 'settings'}
    {autoOpenEnabled}
    bind:priorityFilter
    {savedRefreshPolicy}
    {extensionState}
    refreshState={refreshStateData}
    onAutoOpenChange={handleAutoOpenChange}
    onPriorityFilterChange={handlePriorityFilterChange}
    onRefreshPolicySave={handleRefreshPolicySave}
    onRefreshDebug={handleRefreshDebug}
    onClearDebugLogs={handleClearDebugLogs}
  />
  {:else}
    <div id="panelSettings" class="panel" class:active={activeTab === 'settings'}></div>
  {/if}
</main>
