<script lang="ts">
  import { browser } from 'wxt/browser';
  import type { PriorityFilter, NormalizedRefreshPolicy, SyncState, StudiesRefreshState, DebugLogEntry } from '../../../lib/types';
  import {
    formatRelative,
    compactText,
    isAuthRequiredState,
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
  } from '../../../lib/constants';

  let {
    active,
    autoOpenEnabled,
    priorityFilter = $bindable(),
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

  // Local keyword strings — initialized from prop at mount, kept in sync via handlers.
  // svelte-ignore state_referenced_locally
  let alwaysKeywordsText = $state(
    Array.isArray(priorityFilter.always_open_keywords) ? priorityFilter.always_open_keywords.join(', ') : ''
  );
  // svelte-ignore state_referenced_locally
  let ignoreKeywordsText = $state(
    Array.isArray(priorityFilter.ignore_keywords) ? priorityFilter.ignore_keywords.join(', ') : ''
  );

  // Refresh sliders — local $state initialized from prop at mount time.
  // svelte-ignore state_referenced_locally
  let localMinDelay = $state(savedRefreshPolicy.minimum_delay_seconds);
  // svelte-ignore state_referenced_locally
  let localAvgDelay = $state(savedRefreshPolicy.average_delay_seconds);
  // svelte-ignore state_referenced_locally
  let localSpread = $state(savedRefreshPolicy.spread_seconds);

  // svelte-ignore state_referenced_locally — intentional: init from prop at mount
  let savedMin = $state(savedRefreshPolicy.minimum_delay_seconds);
  // svelte-ignore state_referenced_locally
  let savedAvg = $state(savedRefreshPolicy.average_delay_seconds);
  // svelte-ignore state_referenced_locally
  let savedSpread = $state(savedRefreshPolicy.spread_seconds);

  const localRefreshPolicy = $derived(normalizeRefreshPolicy(localMinDelay, localAvgDelay, localSpread));

  const hasUnsavedRefreshChanges = $derived(
    Number(localMinDelay) !== Number(savedMin) ||
    Number(localAvgDelay) !== Number(savedAvg) ||
    Number(localSpread) !== Number(savedSpread)
  );

  const refreshPlan = $derived(buildRefreshPlan(localRefreshPolicy));
  const refreshPlanSummary = $derived.by(() => {
    const delayLabels = refreshPlan.delays.length
      ? refreshPlan.delays.map((s) => `${Math.round(s)}s`).join(', ')
      : 'none within this cycle';
    return `Per ${localRefreshPolicy.cycle_seconds}s cycle: ${refreshPlan.count} extra refreshes at ${delayLabels}.`;
  });

  const debugRows = $derived(buildDebugRows(extensionState, refreshState));
  const debugLogs = $derived(buildDebugLogs(extensionState));

  let previewPlaying = $state(false);
  let previewAudioContext: AudioContext | null = null;
  let previewActiveSource: AudioBufferSourceNode | null = null;
  let previewResetTimer: ReturnType<typeof setTimeout> | null = null;
  let soundBase64Cache = new Map<string, Promise<string>>();
  let soundBufferCache = new Map<string, Promise<AudioBuffer>>();
  let soundBufferContext: AudioContext | null = null;

  const previewButtonDisabled = $derived(!previewPlaying && (priorityFilter.alert_sound_type === 'none' || priorityFilter.alert_sound_volume <= 0));
  const previewButtonText = $derived(previewPlaying ? '\u25A0' : '\u25B6');
  const previewButtonTitle = $derived(
    priorityFilter.alert_sound_volume <= 0 ? 'Volume is 0' : previewPlaying ? 'Stop preview' : 'Preview sound',
  );

  const soundTypeOptions: { value: string; label: string }[] = [
    { value: 'none', label: 'None' },
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

  // Called when any priority filter input changes. Reads current state from
  // the $bindable priorityFilter (already updated by bind:) and notifies
  // the parent to persist.
  function handlePriorityInput() {
    // Update keywords from local text state
    priorityFilter.always_open_keywords = normalizePriorityKeywords(alwaysKeywordsText);
    priorityFilter.ignore_keywords = normalizePriorityKeywords(ignoreKeywordsText);
    onPriorityFilterChange(priorityFilter);
  }

  function handlePriorityCheckboxChange() {
    // For checkboxes, bind:checked has already updated priorityFilter.
    // Update keywords in case they were edited.
    priorityFilter.always_open_keywords = normalizePriorityKeywords(alwaysKeywordsText);
    priorityFilter.ignore_keywords = normalizePriorityKeywords(ignoreKeywordsText);
    onPriorityFilterChange(priorityFilter);
  }

  function handleSoundControlChange() {
    priorityFilter.alert_sound_enabled = priorityFilter.alert_sound_type !== 'none';
    cancelPreview();
    handlePriorityInput();
  }

  // Refresh slider handlers
  function handleRefreshSliderInput() {
    // Normalize the policy from current slider values
    const policy = normalizeRefreshPolicy(localMinDelay, localAvgDelay, localSpread);
    localMinDelay = policy.minimum_delay_seconds;
    localAvgDelay = policy.average_delay_seconds;
    localSpread = policy.spread_seconds;
  }

  function refreshCardActions(node: HTMLElement) {
    function onClick(e: Event) {
      const target = e.target as HTMLElement;
      if (target.closest('#refreshCadenceSaveButton')) handleRefreshSave();
      else if (target.closest('#refreshCadenceRevertButton')) handleRefreshRevert();
    }
    node.addEventListener('click', onClick);
    return { destroy() { node.removeEventListener('click', onClick); } };
  }

  function handleRefreshSave() {
    onRefreshPolicySave(
      localRefreshPolicy.minimum_delay_seconds,
      localRefreshPolicy.average_delay_seconds,
      localRefreshPolicy.spread_seconds,
    );
    savedMin = Number(localMinDelay);
    savedAvg = Number(localAvgDelay);
    savedSpread = Number(localSpread);
  }

  function handleRefreshRevert() {
    const policy = normalizeRefreshPolicy(
      savedRefreshPolicy.minimum_delay_seconds,
      savedRefreshPolicy.average_delay_seconds,
      savedRefreshPolicy.spread_seconds,
    );
    localMinDelay = policy.minimum_delay_seconds;
    localAvgDelay = policy.average_delay_seconds;
    localSpread = policy.spread_seconds;
    savedMin = localMinDelay;
    savedAvg = localAvgDelay;
    savedSpread = localSpread;
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

  async function handlePreviewClick() {
    if (previewPlaying) { cancelPreview(); return; }

    const audioContext = getPreviewAudioContext();
    if (!audioContext) return;
    if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
      await audioContext.resume();
    }

    const soundType = canonicalSoundType(priorityFilter.alert_sound_type ?? DEFAULT_PRIORITY_ALERT_SOUND_TYPE);
    const soundVolume = clampInt(
      priorityFilter.alert_sound_volume ?? DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
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

</script>

<div id="panelSettings" class="panel" class:active role="tabpanel" aria-labelledby="tabSettings">
  <div class="settings min-h-[420px] max-h-[420px] scroll-container pb-1">
    <!-- Auto-open card -->
    <div class="setting-card bg-base-100 shadow-sm border border-base-300 rounded-lg p-4 flex items-center justify-between gap-3 mb-2.5">
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
    <div class="setting-card bg-base-100 shadow-sm border border-base-300 rounded-lg p-4 mb-2.5">
      <div class="flex items-center justify-between gap-2.5 mb-0.5">
        <div class="text-sm font-semibold text-base-content">Priority filter</div>
        <input
          id="priorityFilterEnabledToggle"
          type="checkbox"
          class="toggle toggle-primary toggle-sm"
          aria-label="Priority filter"
          bind:checked={priorityFilter.enabled}
          onchange={handlePriorityCheckboxChange}
        />
      </div>
      <div class="text-xs text-base-content/50 leading-snug">Highlight and alert when newly available studies match these rules.</div>

      {#if priorityFilter.enabled}
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
            bind:value={priorityFilter.minimum_reward_major}
            oninput={handlePriorityInput}
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
            bind:value={priorityFilter.minimum_hourly_reward_major}
            oninput={handlePriorityInput}
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
            bind:value={priorityFilter.maximum_estimated_minutes}
            oninput={handlePriorityInput}
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
            bind:value={priorityFilter.minimum_places_available}
            oninput={handlePriorityInput}
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
            bind:value={alwaysKeywordsText}
            oninput={handlePriorityInput}
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
            bind:value={ignoreKeywordsText}
            oninput={handlePriorityInput}
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
          bind:checked={priorityFilter.auto_open_in_new_tab}
          onchange={handlePriorityCheckboxChange}
        />
      </div>

      <!-- Alert sound -->
      <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2 mt-2">
        <div class="inline-flex items-center gap-1.5">
          <label for="priorityAlertSoundTypeSelect" class="text-[12.5px] text-base-content/50 font-medium">Alert sound</label>
          {#if priorityFilter.alert_sound_type !== 'none'}
            <button
              id="priorityAlertSoundPreviewButton"
              class="btn btn-ghost btn-xs w-6 h-6 min-h-0 p-0 text-[11px]"
              type="button"
              aria-label="Preview sound"
              title={previewButtonTitle}
              disabled={previewButtonDisabled}
              onclick={handlePreviewClick}
            >{previewButtonText}</button>
          {/if}
        </div>
        <select
          id="priorityAlertSoundTypeSelect"
          class="select select-sm w-full"
          bind:value={priorityFilter.alert_sound_type}
          onchange={handleSoundControlChange}
        >
          {#each soundTypeOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>
      {#if priorityFilter.alert_sound_type !== 'none'}
        <div class="priority-field grid grid-cols-[156px_1fr] items-center gap-2 mt-2">
          <label for="priorityAlertSoundVolumeInput" class="text-[12.5px] text-base-content/50 font-medium">Volume</label>
          <input
            id="priorityAlertSoundVolumeInput"
            type="range"
            class="range range-primary range-xs w-full"
            min={MIN_PRIORITY_ALERT_SOUND_VOLUME}
            max={MAX_PRIORITY_ALERT_SOUND_VOLUME}
            step="1"
            bind:value={priorityFilter.alert_sound_volume}
            oninput={handleSoundControlChange}
          />
        </div>
      {/if}
      {/if}
    </div>

    <!-- Refresh cadence card -->
    <div class="setting-card bg-base-100 shadow-sm border border-base-300 rounded-lg p-4 mb-2.5">
      <div class="text-sm font-semibold text-base-content">Studies refresh rate</div>
      <div class="text-xs text-base-content/50 mt-0.5 leading-snug">Plan delayed backend refreshes inside each 2-minute Prolific auto-refresh cycle.</div>

      <div class="mt-2 flex flex-col gap-2">
        <div class="refresh-field grid grid-cols-[132px_1fr_auto] items-center gap-2">
          <label for="refreshMinDelayInput" class="text-[12.5px] text-base-content/50 font-medium">Minimum delay (s)</label>
          <input id="refreshMinDelayInput" type="range" class="range range-primary range-xs w-full" min="1" max={localRefreshPolicy.maximum_minimum_delay_seconds} step="1" bind:value={localMinDelay} oninput={handleRefreshSliderInput} />
          <span id="refreshMinDelayValue" class="text-[11px] text-base-content font-extrabold font-mono text-right min-w-[34px]">{localMinDelay}s</span>
        </div>
        <div class="refresh-field grid grid-cols-[132px_1fr_auto] items-center gap-2">
          <label for="refreshAverageDelayInput" class="text-[12.5px] text-base-content/50 font-medium">Average delay (s)</label>
          <input id="refreshAverageDelayInput" type="range" class="range range-primary range-xs w-full" min="5" max="60" step="1" bind:value={localAvgDelay} oninput={handleRefreshSliderInput} />
          <span id="refreshAverageDelayValue" class="text-[11px] text-base-content font-extrabold font-mono text-right min-w-[34px]">{localAvgDelay}s</span>
        </div>
        <div class="refresh-field grid grid-cols-[132px_1fr_auto] items-center gap-2">
          <label for="refreshSpreadInput" class="text-[12.5px] text-base-content/50 font-medium">Spread (s)</label>
          <input id="refreshSpreadInput" type="range" class="range range-primary range-xs w-full" min="0" max={localRefreshPolicy.maximum_spread_seconds} step="1" bind:value={localSpread} oninput={handleRefreshSliderInput} />
          <span id="refreshSpreadValue" class="text-[11px] text-base-content font-extrabold font-mono text-right min-w-[34px]">{localSpread}s</span>
        </div>
      </div>

      <!-- Plan summary -->
      <div id="refreshPlanSummary" class="mt-2 text-[10px] text-base-content/60 font-semibold leading-snug">
        {refreshPlanSummary}
      </div>

      <!-- Plan track visualization -->
      <div id="refreshPlanTrack" class="refresh-plan-track mt-2 border border-base-300 rounded-md bg-base-200 dark:bg-base-300/30 h-[44px] relative overflow-hidden">
        <!-- Boundary markers -->
        <span class="refresh-marker boundary absolute top-[6px] h-[22px] w-0.5 rounded-sm bg-success" style="left:0%"></span>
        <span class="refresh-marker boundary absolute top-[6px] h-[22px] w-0.5 rounded-sm bg-success" style="left:100%"></span>

        <!-- Min delay exclusion zones -->
        <span class="refresh-min-window absolute top-[8px] h-[18px] rounded-sm bg-error/20 border border-error/30" style="left:0%;width:{trackPct(localRefreshPolicy.minimum_delay_seconds)}%"></span>
        <span class="refresh-min-window absolute top-[8px] h-[18px] rounded-sm bg-error/20 border border-error/30" style="left:{trackPct(localRefreshPolicy.cycle_seconds - localRefreshPolicy.minimum_delay_seconds)}%;width:{Math.max(0, 100 - trackPct(localRefreshPolicy.cycle_seconds - localRefreshPolicy.minimum_delay_seconds))}%"></span>

        <!-- Min delay exclusion around each marker -->
        {#each refreshPlan.delays as seconds, i (i)}
          {@const left = trackPct(seconds - localRefreshPolicy.minimum_delay_seconds)}
          {@const right = trackPct(seconds + localRefreshPolicy.minimum_delay_seconds)}
          <span class="refresh-min-window absolute top-[8px] h-[18px] rounded-sm bg-error/20 border border-error/30" style="left:{left}%;width:{Math.max(0, right - left)}%"></span>
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
      <div use:refreshCardActions id="refreshCadenceActions" class="setting-actions mt-2 gap-2" class:flex={hasUnsavedRefreshChanges} class:hidden={!hasUnsavedRefreshChanges}>
        <button
          id="refreshCadenceSaveButton"
          class="btn btn-primary btn-sm flex-1"
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
    </div>

    <!-- Diagnostics collapsible -->
    <details class="debug-details border border-base-300 rounded-lg bg-base-100 shadow-sm">
      <summary class="debug-summary cursor-pointer text-[13px] font-semibold text-base-content/70 p-3 select-none list-none hover:text-base-content transition-colors">
        <span class="debug-arrow mr-1 text-[10px] text-base-content/40 inline-block">&#9654;</span>Diagnostics
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

        <div id="debugLog" class="debug-log max-h-[180px] scroll-container border border-base-300 rounded-md bg-base-100/80 p-2 font-mono text-[10px] leading-snug text-base-content/70">
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
  .debug-arrow {
    transition: transform 120ms ease;
  }
  details[open] .debug-arrow {
    transform: rotate(90deg);
    display: inline-block;
  }
</style>
