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
    SERVICE_OFFLINE_MESSAGE,
    AUTH_REQUIRED_MESSAGE,
    AUTH_REQUIRED_PANEL_MESSAGE,
    RETRY_INTERVAL_MS,
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
  } from '../../lib/constants';
  import {
    parseDate,
    formatRelative,
    toUserErrorMessage,
    isServiceUnavailableError,
    isServiceConnectingMessage,
    isAuthRequiredState,
    normalizeRefreshPolicy,
    canonicalSoundType,
    shouldShowServiceConnectingMessage,
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
  let isOffline = $state(false);
  let isAuthRequired = $state(false);
  let autoOpenEnabled = $state(true);
  let panelStatusMessage = $state('');
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
  let retryDeadlineAt = $state(0);
  let retryCountdownTimer: ReturnType<typeof setInterval> | null = null;
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

  const showPanelOverride = $derived(isOffline || isAuthRequired);
  const panelOverrideText = $derived(
    isOffline ? panelStatusMessage : isAuthRequired ? AUTH_REQUIRED_PANEL_MESSAGE : '',
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
    const response = await browser.runtime.sendMessage({ action: 'getState' });
    if (!response || !(response as any).ok) throw new Error('Failed to fetch extension state.');
    return (response as any).state;
  }

  async function getSettings(): Promise<Settings> {
    const response = await sendRuntimeMessage('getSettings');
    return response.settings || {};
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

  async function getDashboardData(liveLimit = 50, eventsLimit = 25, submissionsLimit = 100): Promise<any> {
    const response = await sendRuntimeMessage('getDashboardData', {
      live_limit: liveLimit,
      events_limit: eventsLimit,
      submissions_limit: submissionsLimit,
    });
    return response.dashboard || {};
  }

  function normalizePriorityFilterFromSettings(s: Settings): PriorityFilter {
    return {
      enabled: s.auto_open_priority_studies === true || (s as any).priority_filter_enabled === true,
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

  function stopRetryCountdown() {
    retryDeadlineAt = 0;
    if (retryCountdownTimer) {
      clearInterval(retryCountdownTimer);
      retryCountdownTimer = null;
    }
    if (retryRefreshTimer) {
      clearTimeout(retryRefreshTimer);
      retryRefreshTimer = null;
    }
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

  function formatRetryCountdownMessage(): string {
    if (!retryDeadlineAt) return 'Connection failed. Retrying in 5 seconds.';
    const remainingMs = Math.max(0, retryDeadlineAt - Date.now());
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const label = remainingSeconds === 1 ? 'second' : 'seconds';
    return `Connection failed. Retrying in ${remainingSeconds} ${label}.`;
  }

  function startOfflineRetryLoop() {
    retryDeadlineAt = Date.now() + RETRY_INTERVAL_MS;
    panelStatusMessage = formatRetryCountdownMessage();

    if (!retryCountdownTimer) {
      retryCountdownTimer = setInterval(() => {
        panelStatusMessage = formatRetryCountdownMessage();
      }, 250);
    }

    scheduleViewRefreshAfter(RETRY_INTERVAL_MS);
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
      if (isServiceConnectingMessage(state.studies_response_capture_reason) && !shouldShowServiceConnectingMessage(state)) {
        return '';
      }
      return state.studies_response_capture_reason.trim();
    }
    return '';
  }

  function dashboardSectionOrError(section: any, fallbackError: string): { ok: boolean; data?: any; error?: string } {
    if (section && section.ok === true) return { ok: true, data: section.data };
    if (section && section.ok === false) return { ok: false, error: section.error || fallbackError };
    return { ok: false, error: fallbackError };
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
        getDashboardData(50, 25, 100),
      ]);

      const extState = stateResult.status === 'fulfilled' ? stateResult.value : null;
      extensionState = extState;
      const authRequired = isAuthRequiredState(extState);
      isAuthRequired = authRequired;

      const dashboard = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
      const dashboardError = dashboardResult.status === 'rejected'
        ? toUserErrorMessage((dashboardResult as PromiseRejectedResult).reason)
        : 'Failed to fetch dashboard data.';

      const refreshSection = dashboardSectionOrError(dashboard?.refresh_state, dashboardError);
      const studiesSection = dashboardSectionOrError(dashboard?.studies, dashboardError);
      const eventsSection = dashboardSectionOrError(dashboard?.events, dashboardError);
      const submissionsSection = dashboardSectionOrError(dashboard?.submissions, dashboardError);
      const refreshSt = refreshSection.ok ? refreshSection.data : null;
      refreshStateData = refreshSt;

      const serviceSections = [refreshSection, studiesSection, eventsSection, submissionsSection];
      const serviceSuccessCount = serviceSections.filter((s) => s.ok).length;
      const serviceUnavailableCount = serviceSections.filter(
        (s) => !s.ok && isServiceUnavailableError(s.error),
      ).length;
      const serviceOffline = serviceSuccessCount === 0 && serviceUnavailableCount === serviceSections.length;

      if (serviceOffline) {
        isOffline = true;
        startOfflineRetryLoop();
      } else {
        isOffline = false;
        panelStatusMessage = '';
        stopRetryCountdown();
        scheduleRegularRefresh();

        if (authRequired) {
          panelStatusMessage = AUTH_REQUIRED_PANEL_MESSAGE;
          if (studies.length) studies = [];
          if (events.length) events = [];
          if (submissions.length) submissions = [];
        } else {
          const newStudies = studiesSection.ok && Array.isArray(studiesSection.data) ? studiesSection.data : [];
          const newEvents = eventsSection.ok && Array.isArray(eventsSection.data) ? eventsSection.data : [];
          const newSubmissions = submissionsSection.ok && Array.isArray(submissionsSection.data) ? submissionsSection.data : [];
          if (!jsonEqual(studies, newStudies)) studies = newStudies;
          if (!jsonEqual(events, newEvents)) events = newEvents;
          if (!jsonEqual(submissions, newSubmissions)) submissions = newSubmissions;
        }
      }

      // Compute health message
      let firstErrorMessage = '';
      if (serviceOffline) {
        firstErrorMessage = SERVICE_OFFLINE_MESSAGE;
      } else if (stateResult.status === 'rejected') {
        firstErrorMessage = toUserErrorMessage((stateResult as PromiseRejectedResult).reason);
      } else {
        const firstServiceError = serviceSections.find(
          (s) => !s.ok && !isServiceUnavailableError(s.error),
        );
        if (firstServiceError) {
          firstErrorMessage = toUserErrorMessage(firstServiceError.error);
        }
      }

      let healthMessage = deriveErrorMessage(extState, firstErrorMessage);
      if (authRequired) healthMessage = AUTH_REQUIRED_MESSAGE;
      if (!serviceOffline && serviceSuccessCount > 0 && isServiceUnavailableError(healthMessage)) {
        healthMessage = '';
      }

      // Update refresh time display
      if (serviceOffline || isServiceConnectingMessage(healthMessage)) {
        latestRefreshOffline = true;
        latestRefreshDate = null;
      } else if (authRequired) {
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
    offline={isOffline || !!errorMessage}
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
