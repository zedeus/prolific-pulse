<script lang="ts">
  import { untrack } from 'svelte';
  import { browser } from 'wxt/browser';
  import type { PriorityFilter, NormalizedRefreshPolicy, SyncState, StudiesRefreshState, DebugLogEntry } from '../../../lib/types';
  import {
    formatRelative,
    parseDate,
    compactText,
    isAuthRequiredState,
    isServiceConnectingMessage,
    shouldShowServiceConnectingMessage,
    clampInt,
    normalizeRefreshPolicy,
    canonicalSoundType,
  } from '../../../lib/format';
  import {
    PRIORITY_ALERT_SOUND_TYPE_TO_BASE64_PATH,
    DEFAULT_PRIORITY_ALERT_SOUND_TYPE,
    DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
    MIN_PRIORITY_ALERT_SOUND_VOLUME,
    MAX_PRIORITY_ALERT_SOUND_VOLUME,
    MIN_PRIORITY_FILTER_MIN_REWARD,
    MAX_PRIORITY_FILTER_MIN_REWARD,
    MIN_PRIORITY_FILTER_MIN_HOURLY_REWARD,
    MAX_PRIORITY_FILTER_MIN_HOURLY_REWARD,
    MIN_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
    MAX_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
    MIN_PRIORITY_FILTER_MIN_PLACES,
    MAX_PRIORITY_FILTER_MIN_PLACES,
    MAX_PRIORITY_FILTER_KEYWORDS,
    DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
    DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS,
    MIN_STUDIES_REFRESH_MIN_DELAY_SECONDS,
    MAX_STUDIES_REFRESH_MIN_DELAY_SECONDS,
    MIN_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
    MAX_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
    MAX_STUDIES_REFRESH_SPREAD_SECONDS,
  } from '../../../lib/constants';

  let {
    active,
    autoOpenEnabled,
    priorityFilter,
    savedRefreshPolicy,
    extensionState,
    refreshState,
    onAutoOpenChange,
    onPriorityFilterChange,
    onRefreshPolicySave,
    onRefreshDebug,
    onClearDebugLogs,
  } = $props<{
    active: boolean;
    autoOpenEnabled: boolean;
    priorityFilter: PriorityFilter;
    savedRefreshPolicy: NormalizedRefreshPolicy;
    extensionState: SyncState | null;
    refreshState: StudiesRefreshState | null;
    onAutoOpenChange: (enabled: boolean) => void;
    onPriorityFilterChange: (filter: PriorityFilter) => void;
    onRefreshPolicySave: (minDelay: number, avgDelay: number, spread: number) => void;
    onRefreshDebug: () => void;
    onClearDebugLogs: () => void;
  }>();

  // Priority filter inputs are fully imperative — same pattern as the refresh sliders.
  // On input: read raw DOM values → call onPriorityFilterChange for persistence.
  // No reactive value/checked attributes; applyPriorityFilterToControls sets DOM on mount.
  let priorityContainerEl: HTMLDivElement | undefined;

  // Track whether alert sound is enabled locally (drives conditional rendering of sound config).
  let localAlertSoundEnabled = $state(false);

  function getPriorityEls() {
    if (!priorityContainerEl) return null;
    return {
      enabled: priorityContainerEl.querySelector('#priorityFilterEnabledToggle') as HTMLInputElement | null,
      minReward: priorityContainerEl.querySelector('#priorityMinRewardInput') as HTMLInputElement | null,
      minHourly: priorityContainerEl.querySelector('#priorityMinHourlyInput') as HTMLInputElement | null,
      maxEta: priorityContainerEl.querySelector('#priorityMaxEtaInput') as HTMLInputElement | null,
      minPlaces: priorityContainerEl.querySelector('#priorityMinPlacesInput') as HTMLInputElement | null,
      alwaysKeywords: priorityContainerEl.querySelector('#priorityAlwaysKeywordsInput') as HTMLInputElement | null,
      ignoreKeywords: priorityContainerEl.querySelector('#priorityIgnoreKeywordsInput') as HTMLInputElement | null,
      autoOpenTab: priorityContainerEl.querySelector('#priorityAutoOpenInNewTabToggle') as HTMLInputElement | null,
      alertSound: priorityContainerEl.querySelector('#priorityAlertSoundToggle') as HTMLInputElement | null,
      soundType: priorityContainerEl.querySelector('#priorityAlertSoundTypeSelect') as HTMLSelectElement | null,
      soundVolume: priorityContainerEl.querySelector('#priorityAlertSoundVolumeInput') as HTMLInputElement | null,
    };
  }

  function applyPriorityFilterToControls(filter: PriorityFilter) {
    const els = getPriorityEls();
    if (!els) return;
    if (els.enabled) els.enabled.checked = !!filter.enabled;
    if (els.minReward) els.minReward.value = String(filter.minimum_reward_major ?? 0);
    if (els.minHourly) els.minHourly.value = String(filter.minimum_hourly_reward_major ?? 0);
    if (els.maxEta) els.maxEta.value = String(filter.maximum_estimated_minutes ?? 0);
    if (els.minPlaces) els.minPlaces.value = String(filter.minimum_places_available ?? 1);
    if (els.alwaysKeywords) els.alwaysKeywords.value = Array.isArray(filter.always_open_keywords) ? filter.always_open_keywords.join(', ') : '';
    if (els.ignoreKeywords) els.ignoreKeywords.value = Array.isArray(filter.ignore_keywords) ? filter.ignore_keywords.join(', ') : '';
    if (els.autoOpenTab) els.autoOpenTab.checked = !!filter.auto_open_in_new_tab;
    if (els.alertSound) els.alertSound.checked = !!filter.alert_sound_enabled;
    if (els.soundType) els.soundType.value = canonicalSoundType(filter.alert_sound_type);
    if (els.soundVolume) els.soundVolume.value = String(filter.alert_sound_volume ?? DEFAULT_PRIORITY_ALERT_SOUND_VOLUME);
    localAlertSoundEnabled = !!filter.alert_sound_enabled;
  }

  function readPriorityFilterFromDOM(): PriorityFilter {
    const els = getPriorityEls();
    if (!els) return priorityFilter;
    return {
      enabled: els.enabled?.checked ?? false,
      minimum_reward_major: els.minReward ? Number(els.minReward.value) : 0,
      minimum_hourly_reward_major: els.minHourly ? Number(els.minHourly.value) : 0,
      maximum_estimated_minutes: els.maxEta ? Number(els.maxEta.value) : 0,
      minimum_places_available: els.minPlaces ? Number(els.minPlaces.value) : 1,
      always_open_keywords: els.alwaysKeywords ? normalizePriorityKeywords(els.alwaysKeywords.value) : [],
      ignore_keywords: els.ignoreKeywords ? normalizePriorityKeywords(els.ignoreKeywords.value) : [],
      auto_open_in_new_tab: els.autoOpenTab?.checked ?? false,
      alert_sound_enabled: els.alertSound?.checked ?? false,
      alert_sound_type: els.soundType ? els.soundType.value : DEFAULT_PRIORITY_ALERT_SOUND_TYPE,
      alert_sound_volume: els.soundVolume ? Number(els.soundVolume.value) : DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
    };
  }

  // Refresh sliders are fully imperative — matching the old vanilla JS approach.
  // On input: read raw DOM values → normalize → write back to DOM (value, max, labels).
  // No $state changes during drag. Only $state changes happen on initial load and revert.
  let refreshContainerEl: HTMLDivElement | undefined;

  let committedMinDelay = $state(savedRefreshPolicy.minimum_delay_seconds);
  let committedAvgDelay = $state(savedRefreshPolicy.average_delay_seconds);
  let committedSpread = $state(savedRefreshPolicy.spread_seconds);

  function getSliderEls() {
    if (!refreshContainerEl) return null;
    return {
      min: refreshContainerEl.querySelector('#refreshMinDelayInput') as HTMLInputElement | null,
      avg: refreshContainerEl.querySelector('#refreshAverageDelayInput') as HTMLInputElement | null,
      spread: refreshContainerEl.querySelector('#refreshSpreadInput') as HTMLInputElement | null,
      minLabel: refreshContainerEl.querySelector('#refreshMinDelayValue') as HTMLElement | null,
      avgLabel: refreshContainerEl.querySelector('#refreshAverageDelayValue') as HTMLElement | null,
      spreadLabel: refreshContainerEl.querySelector('#refreshSpreadValue') as HTMLElement | null,
    };
  }

  function applyRefreshPolicyToSliders(policy: typeof savedRefreshPolicy) {
    const els = getSliderEls();
    if (!els) return;
    if (els.min) { els.min.max = String(policy.maximum_minimum_delay_seconds); els.min.value = String(policy.minimum_delay_seconds); }
    if (els.avg) { els.avg.value = String(policy.average_delay_seconds); }
    if (els.spread) { els.spread.max = String(policy.maximum_spread_seconds); els.spread.value = String(policy.spread_seconds); }
    if (els.minLabel) els.minLabel.textContent = policy.minimum_delay_seconds + 's';
    if (els.avgLabel) els.avgLabel.textContent = policy.average_delay_seconds + 's';
    if (els.spreadLabel) els.spreadLabel.textContent = policy.spread_seconds + 's';
  }

  function handleRefreshSliderInput() {
    // Exactly like the old vanilla JS: read → normalize → write back
    const els = getSliderEls();
    if (!els) return;
    const policy = normalizeRefreshPolicy(
      els.min ? Number(els.min.value) : committedMinDelay,
      els.avg ? Number(els.avg.value) : committedAvgDelay,
      els.spread ? Number(els.spread.value) : committedSpread,
    );
    applyRefreshPolicyToSliders(policy);
    // Update committed state so save/revert and plan viz react
    committedMinDelay = policy.minimum_delay_seconds;
    committedAvgDelay = policy.average_delay_seconds;
    committedSpread = policy.spread_seconds;
  }

  let previewPlaying = $state(false);
  let previewAudioContext: AudioContext | null = null;
  let previewActiveSource: AudioBufferSourceNode | null = null;
  let previewResetTimer: ReturnType<typeof setTimeout> | null = null;
  let soundBase64Cache = new Map<string, Promise<string>>();
  let soundBufferCache = new Map<string, Promise<AudioBuffer>>();
  let soundBufferContext: AudioContext | null = null;

  // Initialize sliders once on mount — untrack prevents re-running on prop changes
  $effect(() => {
    untrack(() => {
      const policy = normalizeRefreshPolicy(
        savedRefreshPolicy.minimum_delay_seconds,
        savedRefreshPolicy.average_delay_seconds,
        savedRefreshPolicy.spread_seconds,
      );
      applyRefreshPolicyToSliders(policy);
      committedMinDelay = policy.minimum_delay_seconds;
      committedAvgDelay = policy.average_delay_seconds;
      committedSpread = policy.spread_seconds;
    });
  });

  // Sync priority filter prop → DOM. Suppressed briefly after user edits to avoid
  // the persist-then-normalize round-trip from overwriting active input.
  $effect(() => {
    const filter = priorityFilter;
    untrack(() => {
      if (lastUserEditAt && (Date.now() - lastUserEditAt) < PRIORITY_EDIT_SUPPRESS_MS) {
        return;
      }
      applyPriorityFilterToControls(filter);
    });
  });

  // Native addEventListener bypasses Svelte 5's event delegation
  // (which doesn't fire for programmatically dispatched events in tests).
  function priorityEvents(node: HTMLElement) {
    node.addEventListener('input', handlePriorityContainerEvent);
    node.addEventListener('change', handlePriorityContainerEvent);
    return {
      destroy() {
        node.removeEventListener('input', handlePriorityContainerEvent);
        node.removeEventListener('change', handlePriorityContainerEvent);
      },
    };
  }

  // When localAlertSoundEnabled changes to true, the sound config section mounts.
  // We need to apply sound type/volume values after it renders.
  $effect(() => {
    if (localAlertSoundEnabled) {
      // Use tick-like microtask to wait for DOM to update after conditional render
      untrack(() => {
        queueMicrotask(() => {
          const els = getPriorityEls();
          if (els?.soundType) els.soundType.value = canonicalSoundType(priorityFilter.alert_sound_type);
          if (els?.soundVolume) els.soundVolume.value = String(priorityFilter.alert_sound_volume ?? DEFAULT_PRIORITY_ALERT_SOUND_VOLUME);
        });
      });
    }
  });

  let localRefreshPolicy = $derived(normalizeRefreshPolicy(committedMinDelay, committedAvgDelay, committedSpread));

  // Cache saved values as plain numbers so the derived doesn't re-read the reactive prop
  let savedMin = savedRefreshPolicy.minimum_delay_seconds;
  let savedAvg = savedRefreshPolicy.average_delay_seconds;
  let savedSpread = savedRefreshPolicy.spread_seconds;
  let hasUnsavedRefreshChanges = $derived(
    committedMinDelay !== savedMin ||
    committedAvgDelay !== savedAvg ||
    committedSpread !== savedSpread
  );

  let refreshPlan = $derived(buildRefreshPlan(localRefreshPolicy));
  let refreshPlanSummary = $derived.by(() => {
    const delayLabels = refreshPlan.delays.length
      ? refreshPlan.delays.map((s) => `${Math.round(s)}s`).join(', ')
      : 'none within this cycle';
    return `Per ${localRefreshPolicy.cycle_seconds}s cycle: ${refreshPlan.count} extra refreshes at ${delayLabels}.`;
  });

  let debugRows = $derived(buildDebugRows(extensionState, refreshState));
  let debugLogs = $derived(buildDebugLogs(extensionState));

  const soundTypeOptions: { value: string; label: string }[] = [
    { value: 'pay', label: 'Pay' },
    { value: 'metal_gear', label: 'Metal Gear' },
    { value: 'twitch', label: 'Twitch' },
    { value: 'chime', label: 'Chime' },
    { value: 'money', label: 'Money' },
    { value: 'samsung', label: 'Samsung' },
    { value: 'lbp', label: 'LBP' },
    { value: 'taco', label: 'Taco' },
  ];

  const DEBUG_EVENT_LABELS: Record<string, string> = {
    'token.sync.ok': 'Token synced',
    'token.sync.error': 'Token sync failed',
    'oauth.capture.ok': 'OAuth token captured',
    'studies.refresh.post.ok': 'Refresh forwarded',
    'studies.refresh.post.error': 'Refresh forward failed',
    'studies.response.ingest.ok': 'Response ingested',
    'studies.response.ingest.error': 'Response ingest failed',
    'studies.response.parse.error': 'Response parse failed',
    'studies.response.filter.error': 'Response capture failed',
    'studies.response.capture.on_parsed_error': 'Response parse hook failed',
    'settings.auto_open.updated': 'Auto-open updated',
    'settings.priority_filter.updated': 'Priority filter saved',
    'priority.alert.disabled': 'Priority alert disabled',
    'tab.priority_auto_open.created': 'Priority study opened',
    'tab.priority_auto_open.disabled_new_tab': 'Priority tab auto-open disabled',
    'tab.priority_auto_open.error': 'Priority auto-open failed',
    'priority.alert.played': 'Priority alert played',
    'priority.alert.error': 'Priority alert failed',
    'settings.studies_refresh_policy.updated': 'Cadence saved',
    'settings.studies_refresh_policy.schedule_ok': 'Cadence schedule applied',
    'service.ws.command_error': 'WS command error',
    'service.ws.unknown_message_type': 'WS message ignored',
  };

  function normalizePriorityKeywords(value: string): string[] {
    const values = String(value || '').split(',');
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const item of values) {
      const keyword = item.trim().toLowerCase();
      if (!keyword || seen.has(keyword)) continue;
      seen.add(keyword);
      unique.push(keyword);
      if (unique.length >= MAX_PRIORITY_FILTER_KEYWORDS) break;
    }
    return unique;
  }



  // Track last user edit time to suppress prop-driven DOM updates during active editing.
  // After a user edit, we skip prop-to-DOM sync for a brief window so the persist-then-normalize
  // cycle doesn't fight with the user's input. The window should exceed the debounce + RTT.
  let lastUserEditAt = 0;
  const PRIORITY_EDIT_SUPPRESS_MS = 2000;

  function handlePriorityContainerEvent(e: Event) {
    const target = e.target as HTMLElement;
    // Side effects for sound controls
    if (target.id === 'priorityAlertSoundVolumeInput') cancelPreview();
    if (target.id === 'priorityAlertSoundTypeSelect') cancelPreview();
    const updated = readPriorityFilterFromDOM();
    // Update local sound state for conditional render (deferred to avoid loops)
    const newSoundEnabled = updated.alert_sound_enabled;
    if (newSoundEnabled !== localAlertSoundEnabled) {
      queueMicrotask(() => { localAlertSoundEnabled = newSoundEnabled; });
    }
    lastUserEditAt = Date.now();
    onPriorityFilterChange(updated);
  }

  function buildRefreshPlan(policy: NormalizedRefreshPolicy): { delays: number[]; windows: { left: number; right: number }[]; count: number } {
    const cycle = policy.cycle_seconds;
    const minimum = policy.minimum_delay_seconds;
    const average = policy.average_delay_seconds;
    const spread = policy.spread_seconds;

    const maxCountByMinimum = Math.max(0, Math.floor(cycle / minimum) - 1);
    const maxCountByAverage = Math.max(0, Math.floor(cycle / average) - 1);
    const count = Math.max(0, Math.min(maxCountByMinimum, maxCountByAverage));

    if (count <= 0) return { delays: [], windows: [], count: 0 };

    const delays: number[] = [];
    const segments = count + 1;
    for (let i = 1; i <= count; i++) delays.push((cycle * i) / segments);

    const windows = delays.map((center, idx) => {
      const previous = idx === 0 ? 0 : delays[idx - 1];
      const next = idx === delays.length - 1 ? cycle : delays[idx + 1];
      const minLeft = previous + minimum;
      const maxRight = next - minimum;
      const left = Math.max(minLeft, center - spread);
      const right = Math.min(maxRight, center + spread);
      return { left: Math.min(left, right), right: Math.max(left, right) };
    });

    return { delays, windows, count };
  }

  function trackPct(seconds: number): number {
    return Math.max(0, Math.min(100, (seconds / localRefreshPolicy.cycle_seconds) * 100));
  }

  function formatDebugTime(value: unknown): string {
    return formatRelative(value);
  }

  function formatAuthStatus(state: SyncState | null): string {
    if (!state) return 'n/a';
    if (isAuthRequiredState(state)) return 'signed out';
    if (state.token_ok === true) return 'connected';
    if (state.token_ok === false) return 'degraded';
    return 'n/a';
  }

  function formatCadenceSummary(state: SyncState | null): string {
    if (!state) return 'n/a';
    const minD = Number(state.studies_refresh_min_delay_seconds);
    const avgD = Number(state.studies_refresh_average_delay_seconds);
    const sp = Number(state.studies_refresh_spread_seconds);
    if (!Number.isFinite(minD) || !Number.isFinite(avgD) || !Number.isFinite(sp)) return 'n/a';
    return `min ${minD}s \u00b7 avg ${avgD}s \u00b7 spread ${sp}s`;
  }

  function formatDebugIssue(state: SyncState | null): string {
    if (!state) return 'none';
    if (isAuthRequiredState(state)) return 'waiting for login';
    if (state.token_ok === false) return compactText(String(state.token_reason || 'token sync failed'));
    if (state.studies_refresh_ok === false) return compactText(String(state.studies_refresh_reason || 'refresh sync failed'));
    if (state.studies_response_capture_ok === false) {
      if (isServiceConnectingMessage(state.studies_response_capture_reason) && !shouldShowServiceConnectingMessage(state)) return 'none';
      return compactText(String(state.studies_response_capture_reason || 'response capture failed'));
    }
    return 'none';
  }

  function buildDebugRows(state: SyncState | null, refresh: StudiesRefreshState | null): [string, string][] {
    const s = state || {} as SyncState;
    const r = refresh || {} as StudiesRefreshState;
    return [
      ['Auth', formatAuthStatus(state)],
      ['Token Sync', formatDebugTime(s.token_last_success_at)],
      ['Last Refresh', formatDebugTime(r.last_studies_refresh_at)],
      ['Refresh Source', r.last_studies_refresh_source || 'n/a'],
      ['Cadence', formatCadenceSummary(state)],
      ['Last Issue', formatDebugIssue(state)],
      ['Log Entries', String(Number(s.debug_log_count_total) || 0)],
    ];
  }

  function formatDebugLogEvent(eventName: string): string {
    return DEBUG_EVENT_LABELS[eventName] || eventName || 'unknown';
  }

  function formatDebugLogDetails(entry: DebugLogEntry): string {
    const details = entry.details;
    if (!details) return '';
    if (details.error) return ` \u00b7 ${compactText(String(details.error), 96)}`;
    if (typeof details.status_code === 'number') return ` \u00b7 HTTP ${details.status_code}`;
    if (details.trigger) return ` \u00b7 ${String(details.trigger)}`;
    if (details.reason) return ` \u00b7 ${compactText(String(details.reason), 96)}`;
    return '';
  }

  function buildDebugLogs(state: SyncState | null): { at: string; label: string; suffix: string }[] {
    if (!state) return [];
    const logs = Array.isArray(state.debug_logs) ? state.debug_logs : [];
    return logs.slice(0, 30).map((entry) => {
      const at = formatRelative(entry.at, true);
      const label = formatDebugLogEvent(entry.event);
      const repeatCount = Math.max(1, Number(entry.repeat_count) || 1);
      const repeatLabel = repeatCount > 1 ? ` (x${repeatCount})` : '';
      const details = formatDebugLogDetails(entry);
      return { at, label, suffix: repeatLabel + details };
    });
  }

  function getPreviewAudioContext(): AudioContext | null {
    const AudioContextCtor = globalThis.AudioContext || (globalThis as any).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (previewAudioContext) return previewAudioContext;
    try {
      previewAudioContext = new AudioContextCtor();
      return previewAudioContext;
    } catch {
      return null;
    }
  }

  async function getSoundBase64(soundType: string): Promise<string> {
    const normalized = canonicalSoundType(soundType);
    if (!soundBase64Cache.has(normalized)) {
      const path = PRIORITY_ALERT_SOUND_TYPE_TO_BASE64_PATH[normalized] || PRIORITY_ALERT_SOUND_TYPE_TO_BASE64_PATH[DEFAULT_PRIORITY_ALERT_SOUND_TYPE];
      soundBase64Cache.set(normalized, (async () => {
        const response = await fetch(browser.runtime.getURL(path));
        if (!response.ok) throw new Error(`Failed to load ${normalized} sound.`);
        return (await response.text()).replace(/\s+/g, '');
      })());
    }
    return soundBase64Cache.get(normalized)!;
  }

  async function getSoundBuffer(audioContext: AudioContext, soundType: string): Promise<AudioBuffer> {
    const normalized = canonicalSoundType(soundType);
    if (soundBufferContext !== audioContext) {
      soundBufferContext = audioContext;
      soundBufferCache = new Map();
    }
    if (!soundBufferCache.has(normalized)) {
      soundBufferCache.set(normalized, (async () => {
        const base64 = await getSoundBase64(normalized);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const arrayBuffer = bytes.buffer.slice(0) as ArrayBuffer;
        return await audioContext.decodeAudioData(arrayBuffer);
      })());
    }
    return soundBufferCache.get(normalized)!;
  }

  function cancelPreview() {
    if (previewActiveSource) {
      try { previewActiveSource.stop(); } catch {}
      previewActiveSource = null;
    }
    if (previewResetTimer) {
      clearTimeout(previewResetTimer);
      previewResetTimer = null;
    }
    previewPlaying = false;
  }

  let previewButtonDisabled = $derived(previewPlaying || priorityFilter.alert_sound_volume <= 0);
  let previewButtonText = $derived(previewPlaying ? '\u25A0' : '\u25B6');
  let previewButtonTitle = $derived(
    priorityFilter.alert_sound_volume <= 0 ? 'Volume is 0' : previewPlaying ? 'Playing' : 'Preview sound',
  );

  async function handlePreviewClick() {
    if (previewPlaying) return;

    const audioContext = getPreviewAudioContext();
    if (!audioContext) return;
    if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
      await audioContext.resume();
    }

    // Read sound type and volume from DOM, not reactive props
    const els = getPriorityEls();
    const soundType = canonicalSoundType(els?.soundType?.value ?? DEFAULT_PRIORITY_ALERT_SOUND_TYPE);
    const soundVolume = clampInt(
      els?.soundVolume ? Number(els.soundVolume.value) : DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
      MIN_PRIORITY_ALERT_SOUND_VOLUME,
      MAX_PRIORITY_ALERT_SOUND_VOLUME,
      DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
    ) / 100;
    if (soundVolume <= 0) return;

    const startTime = audioContext.currentTime + 0.03;
    const soundBuffer = await getSoundBuffer(audioContext, soundType);
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    source.buffer = soundBuffer;
    source.loop = false;
    gainNode.gain.setValueAtTime(Math.max(0, Math.min(2.5, Math.pow(soundVolume, 0.55) * 2.2)), startTime);
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.onended = () => {
      try { source.disconnect(); gainNode.disconnect(); } catch {}
    };

    previewPlaying = true;
    previewActiveSource = source;
    previewResetTimer = setTimeout(() => {
      previewResetTimer = null;
      previewPlaying = false;
    }, Math.max(300, Math.ceil((Math.max(0.1, soundBuffer.duration) + 0.12) * 1000) + 180));
    source.start(startTime);
  }

  function handleRefreshSave() {
    onRefreshPolicySave(
      localRefreshPolicy.minimum_delay_seconds,
      localRefreshPolicy.average_delay_seconds,
      localRefreshPolicy.spread_seconds,
    );
    // Update cached saved values so hasUnsavedRefreshChanges becomes false
    savedMin = committedMinDelay;
    savedAvg = committedAvgDelay;
    savedSpread = committedSpread;
  }

  function handleRefreshRevert() {
    const policy = normalizeRefreshPolicy(
      savedRefreshPolicy.minimum_delay_seconds,
      savedRefreshPolicy.average_delay_seconds,
      savedRefreshPolicy.spread_seconds,
    );
    applyRefreshPolicyToSliders(policy);
    committedMinDelay = policy.minimum_delay_seconds;
    committedAvgDelay = policy.average_delay_seconds;
    committedSpread = policy.spread_seconds;
    savedMin = committedMinDelay;
    savedAvg = committedAvgDelay;
    savedSpread = committedSpread;
  }

</script>

<div id="panelSettings" class="panel" class:active role="tabpanel" aria-labelledby="tabSettings">
  <div class="settings">
    <!-- Auto-open card -->
    <div class="setting-card bg-base-200 border border-base-300 rounded-lg p-4 flex items-center justify-between gap-3 mb-2.5">
      <div>
        <div class="text-sm font-semibold text-base-content">Auto-open Prolific tab</div>
        <div class="text-xs text-base-content/50 mt-0.5 leading-snug">Keeps a background Prolific tab alive when none are open.</div>
      </div>
      <input
        id="autoOpenToggle"
        type="checkbox"
        class="toggle toggle-primary toggle-sm"
        checked={autoOpenEnabled}
        aria-label="Auto-open Prolific tab"
        onchange={(e) => onAutoOpenChange((e.target as HTMLInputElement).checked)}
      />
    </div>

    <!-- Priority filter card -->
    <div bind:this={priorityContainerEl} use:priorityEvents class="setting-card bg-base-200 border border-base-300 rounded-lg p-4 mb-2.5">
      <div class="flex items-center justify-between gap-2.5 mb-0.5">
        <div class="text-sm font-semibold text-base-content">Priority filter</div>
        <input
          id="priorityFilterEnabledToggle"
          type="checkbox"
          class="toggle toggle-primary toggle-sm"
          aria-label="Priority filter"
        />
      </div>
      <div class="text-xs text-base-content/50 leading-snug">Highlight and alert when newly available studies match these rules.</div>

      <div class="mt-3 flex flex-col gap-2.5">
        <!-- Min reward -->
        <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2">
          <label for="priorityMinRewardInput" class="text-[12.5px] text-base-content/50 font-medium">Min reward</label>
          <input
            id="priorityMinRewardInput"
            type="number"
            class="input input-sm w-full"
            min={MIN_PRIORITY_FILTER_MIN_REWARD}
            max={MAX_PRIORITY_FILTER_MIN_REWARD}
            step="0.1"
          />
        </div>

        <!-- Min reward/hour -->
        <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2">
          <label for="priorityMinHourlyInput" class="text-[12.5px] text-base-content/50 font-medium">Min reward/hour</label>
          <input
            id="priorityMinHourlyInput"
            type="number"
            class="input input-sm w-full"
            min={MIN_PRIORITY_FILTER_MIN_HOURLY_REWARD}
            max={MAX_PRIORITY_FILTER_MIN_HOURLY_REWARD}
            step="0.5"
          />
        </div>

        <!-- Max ETA -->
        <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2">
          <label for="priorityMaxEtaInput" class="text-[12.5px] text-base-content/50 font-medium">Max ETA (minutes)</label>
          <input
            id="priorityMaxEtaInput"
            type="number"
            class="input input-sm w-full"
            min={MIN_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES}
            max={MAX_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES}
            step="1"
          />
        </div>

        <!-- Min places -->
        <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2">
          <label for="priorityMinPlacesInput" class="text-[12.5px] text-base-content/50 font-medium">Min places left</label>
          <input
            id="priorityMinPlacesInput"
            type="number"
            class="input input-sm w-full"
            min={MIN_PRIORITY_FILTER_MIN_PLACES}
            max={MAX_PRIORITY_FILTER_MIN_PLACES}
            step="1"
          />
        </div>

        <!-- Always-open keywords -->
        <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2">
          <label for="priorityAlwaysKeywordsInput" class="text-[12.5px] text-base-content/50 font-medium">Always-open keywords</label>
          <input
            id="priorityAlwaysKeywordsInput"
            type="text"
            class="input input-sm w-full lowercase"
            spellcheck="false"
            placeholder="survey, ai, mobile"
          />
        </div>

        <!-- Ignore keywords -->
        <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2">
          <label for="priorityIgnoreKeywordsInput" class="text-[12.5px] text-base-content/50 font-medium">Ignore keywords</label>
          <input
            id="priorityIgnoreKeywordsInput"
            type="text"
            class="input input-sm w-full lowercase"
            spellcheck="false"
            placeholder="screened, webcam"
          />
        </div>
      </div>

      <div class="mt-2.5 text-[11px] text-base-content/50 leading-snug">
        Ignore keywords win first. Otherwise, always-open keywords force open. If neither keyword list matches, numeric filters decide.
      </div>

      <!-- Auto-open in new tab toggle -->
      <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2 mt-2">
        <label for="priorityAutoOpenInNewTabToggle" class="text-[12.5px] text-base-content/50 font-medium">Auto-open in new tab</label>
        <input
          id="priorityAutoOpenInNewTabToggle"
          type="checkbox"
          class="toggle toggle-primary toggle-sm justify-self-start"
          aria-label="Auto-open in new tab"
        />
      </div>

      <!-- Alert sound toggle -->
      <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2 mt-2">
        <label for="priorityAlertSoundToggle" class="text-[12.5px] text-base-content/50 font-medium">Alert sound</label>
        <input
          id="priorityAlertSoundToggle"
          type="checkbox"
          class="toggle toggle-primary toggle-sm justify-self-start"
          aria-label="Alert sound"
        />
      </div>

      <!-- Alert sound config (shown when sound enabled) -->
      {#if localAlertSoundEnabled}
        <div id="priorityAlertSoundConfig" class="mt-2.5 p-3 border border-base-300 rounded-md bg-base-200/50">
          <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2">
            <div class="inline-flex items-center gap-1.5">
              <label for="priorityAlertSoundTypeSelect" class="text-[12.5px] text-base-content/50 font-medium">Sound</label>
              <button
                id="priorityAlertSoundPreviewButton"
                class="btn btn-ghost btn-xs w-6 h-6 min-h-0 p-0 text-[11px]"
                type="button"
                aria-label="Preview sound"
                title={previewButtonTitle}
                disabled={previewButtonDisabled}
                onclick={handlePreviewClick}
              >{previewButtonText}</button>
            </div>
            <select
              id="priorityAlertSoundTypeSelect"
              class="select select-sm w-full"
            >
              {#each soundTypeOptions as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
          <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2 mt-2">
            <label for="priorityAlertSoundVolumeInput" class="text-[12.5px] text-base-content/50 font-medium">Volume</label>
            <input
              id="priorityAlertSoundVolumeInput"
              type="range"
              class="range range-primary range-sm w-full"
              min={MIN_PRIORITY_ALERT_SOUND_VOLUME}
              max={MAX_PRIORITY_ALERT_SOUND_VOLUME}
              step="1"
            />
          </div>
        </div>
      {/if}
    </div>

    <!-- Refresh cadence card -->
    <div class="setting-card bg-base-200 border border-base-300 rounded-lg p-4 mb-2.5">
      <div class="text-sm font-semibold text-base-content">Studies refresh rate</div>
      <div class="text-xs text-base-content/50 mt-0.5 leading-snug">Plan delayed backend refreshes inside each 2-minute Prolific auto-refresh cycle.</div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div bind:this={refreshContainerEl} class="mt-2 flex flex-col gap-2" oninput={handleRefreshSliderInput}>
        <div class="refresh-field grid grid-cols-[132px_1fr_auto] items-center gap-2">
          <label for="refreshMinDelayInput" class="text-[12.5px] text-base-content/50 font-medium">Minimum delay (s)</label>
          <input id="refreshMinDelayInput" type="range" class="range range-primary range-sm w-full" min="1" max="30" step="1" />
          <span id="refreshMinDelayValue" class="text-[11px] text-base-content font-extrabold font-mono text-right min-w-[34px]">20s</span>
        </div>
        <div class="refresh-field grid grid-cols-[132px_1fr_auto] items-center gap-2">
          <label for="refreshAverageDelayInput" class="text-[12.5px] text-base-content/50 font-medium">Average delay (s)</label>
          <input id="refreshAverageDelayInput" type="range" class="range range-primary range-sm w-full" min="5" max="60" step="1" />
          <span id="refreshAverageDelayValue" class="text-[11px] text-base-content font-extrabold font-mono text-right min-w-[34px]">30s</span>
        </div>
        <div class="refresh-field grid grid-cols-[132px_1fr_auto] items-center gap-2">
          <label for="refreshSpreadInput" class="text-[12.5px] text-base-content/50 font-medium">Spread (s)</label>
          <input id="refreshSpreadInput" type="range" class="range range-primary range-sm w-full" min="0" max="60" step="1" />
          <span id="refreshSpreadValue" class="text-[11px] text-base-content font-extrabold font-mono text-right min-w-[34px]">0s</span>
        </div>
      </div>

      <!-- Plan summary -->
      <div id="refreshPlanSummary" class="mt-2 text-[10px] text-base-content/60 font-semibold leading-snug">
        {refreshPlanSummary}
      </div>

      <!-- Plan track visualization -->
      <div id="refreshPlanTrack" class="refresh-plan-track mt-2 border border-base-300 rounded-md bg-base-200/50 h-[44px] relative overflow-hidden">
        <!-- Boundary markers -->
        <span class="refresh-marker boundary absolute top-[6px] h-[22px] w-0.5 rounded-sm bg-success" style="left:0%"></span>
        <span class="refresh-marker boundary absolute top-[6px] h-[22px] w-0.5 rounded-sm bg-success" style="left:100%"></span>

        <!-- Min delay exclusion zones -->
        <span class="refresh-min-window absolute top-[8px] h-[18px] rounded-sm bg-error/10 border border-error/25" style="left:0%;width:{trackPct(localRefreshPolicy.minimum_delay_seconds)}%"></span>
        <span class="refresh-min-window absolute top-[8px] h-[18px] rounded-sm bg-error/10 border border-error/25" style="left:{trackPct(localRefreshPolicy.cycle_seconds - localRefreshPolicy.minimum_delay_seconds)}%;width:{Math.max(0, 100 - trackPct(localRefreshPolicy.cycle_seconds - localRefreshPolicy.minimum_delay_seconds))}%"></span>

        <!-- Min delay exclusion around each marker -->
        {#each refreshPlan.delays as seconds, i (i)}
          {@const left = trackPct(seconds - localRefreshPolicy.minimum_delay_seconds)}
          {@const right = trackPct(seconds + localRefreshPolicy.minimum_delay_seconds)}
          <span class="refresh-min-window absolute top-[8px] h-[18px] rounded-sm bg-error/10 border border-error/25" style="left:{left}%;width:{Math.max(0, right - left)}%"></span>
        {/each}

        <!-- Spread windows -->
        {#each refreshPlan.windows as window, i (i)}
          {@const left = trackPct(window.left)}
          {@const right = trackPct(window.right)}
          <span class="refresh-window absolute top-[8px] h-[18px] rounded-sm bg-base-content/20 border border-base-content/30" style="left:{left}%;width:{Math.max(0, right - left)}%"></span>
        {/each}

        <!-- Service markers -->
        {#each refreshPlan.delays as seconds, i (i)}
          <span class="refresh-marker service absolute top-[8px] h-[18px] w-0.5 rounded-sm bg-base-content" style="left:{trackPct(seconds)}%" title="Extra refresh at ~{Math.round(seconds)}s"></span>
        {/each}

        <!-- Track labels -->
        <span class="absolute bottom-[3px] left-1.5 text-[9px] text-base-content/50 font-mono uppercase tracking-wide font-bold">tab refresh</span>
        <span class="absolute bottom-[3px] right-1.5 text-[9px] text-base-content/50 font-mono uppercase tracking-wide font-bold text-right">+{localRefreshPolicy.cycle_seconds}s</span>
      </div>

      <!-- Save/Revert buttons -->
      {#if hasUnsavedRefreshChanges}
        <div id="refreshCadenceActions" class="setting-actions mt-2 flex gap-2 visible">
          <button
            id="refreshCadenceSaveButton"
            class="btn btn-outline btn-sm flex-1"
            type="button"
            onclick={handleRefreshSave}
          >Save</button>
          <button
            id="refreshCadenceRevertButton"
            class="btn btn-outline btn-sm btn-error flex-1"
            type="button"
            onclick={handleRefreshRevert}
          >Revert</button>
        </div>
      {:else}
        <div id="refreshCadenceActions" class="setting-actions mt-2 hidden gap-2"></div>
      {/if}
    </div>

    <!-- Diagnostics collapsible -->
    <details class="debug-details border border-base-300 rounded-lg bg-base-200/50">
      <summary class="debug-summary cursor-pointer text-[13px] font-semibold text-base-content/70 p-3 select-none list-none">
        <span class="debug-arrow mr-1.5 text-base-content/40 inline-block">&#9656;</span>Diagnostics
      </summary>
      <div class="debug-card border-t border-base-300 p-3">
        <div class="flex items-center justify-between gap-2.5 mb-2">
          <div class="text-xs font-bold text-base-content">Diagnostics</div>
          <div class="flex items-center gap-1.5">
            <button
              id="refreshDebugButton"
              class="btn btn-ghost btn-xs text-xs font-semibold"
              type="button"
              onclick={onRefreshDebug}
            >Refresh</button>
            <button
              id="clearDebugButton"
              class="btn btn-ghost btn-xs text-xs font-semibold"
              type="button"
              onclick={onClearDebugLogs}
            >Clear Log</button>
          </div>
        </div>

        <div id="debugGrid" class="debug-grid grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] mb-2">
          {#each debugRows as [key, value] (key)}
            <div class="debug-row flex items-baseline justify-between gap-2 border-b border-dotted border-base-300 pb-0.5">
              <span class="debug-key text-base-content/50 overflow-hidden text-ellipsis whitespace-nowrap">{key}</span>
              <span class="debug-value text-base-content font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[62%] text-right">{value}</span>
            </div>
          {/each}
        </div>

        <div id="debugLog" class="debug-log max-h-[180px] overflow-auto border border-base-300 rounded-md bg-base-100/80 p-2 font-mono text-[10px] leading-snug text-base-content/70">
          {#if !debugLogs.length}
            <div class="debug-line">No diagnostic events yet.</div>
          {:else}
            {#each debugLogs as log, i (i)}
              <div class="debug-line mb-1 whitespace-pre-wrap break-words">{log.at}  {log.label}{log.suffix}</div>
            {/each}
          {/if}
        </div>
      </div>
    </details>
  </div>
</div>

<style>
  .panel {
    display: none;
  }
  .panel.active {
    display: block;
  }
  .debug-summary::-webkit-details-marker {
    display: none;
  }
  details[open] .debug-summary {
    border-bottom: 1px solid oklch(var(--bc) / 0.15);
  }
  details[open] .debug-arrow {
    transform: rotate(90deg);
    display: inline-block;
  }
</style>
