import { browser } from 'wxt/browser';
import { nowIso, isNetworkFailureMessage, isServiceConnectingMessage } from '../../lib/format';
import type { PriorityFilter, Study } from '../../lib/types';
import type { SoundType } from '../../lib/constants';
import {
  PROLIFIC_PATTERNS,
  STUDIES_REQUEST_PATTERN,
  PARTICIPANT_SUBMISSIONS_PATTERN,
  SUBMISSION_PATTERNS,
  OAUTH_TOKEN_PATTERN,
  PROLIFIC_STUDIES_URL,
  STUDIES_COLLECTION_PATH,
  FETCH_STUDIES_API_URL,
  SERVICE_BASE_URL,
  SERVICE_OFFLINE_MESSAGE,
  SERVICE_CONNECTING_MESSAGE,
  SERVICE_WS_URL,
  SERVICE_WS_HEARTBEAT_INTERVAL_MS,
  SERVICE_WS_HEARTBEAT_TIMEOUT_MS,
  SERVICE_WS_RECONNECT_BASE_DELAY_MS,
  SERVICE_WS_RECONNECT_MAX_DELAY_MS,
  SERVICE_WS_RECONNECT_JITTER_MS,
  SERVICE_WS_CONNECT_WAIT_MS,
  SERVICE_WS_CONNECT_POLL_MS,
  TOKEN_SYNC_RETRY_DELAY_MS,
  SERVICE_WS_MESSAGE_TYPES,
  SERVICE_WS_COMMANDS,
  SERVICE_WS_SERVER_EVENT_TYPES,
  DASHBOARD_DEFAULT_STUDIES_LIMIT,
  DASHBOARD_DEFAULT_EVENTS_LIMIT,
  DASHBOARD_DEFAULT_SUBMISSIONS_LIMIT,
  DASHBOARD_MIN_LIMIT,
  DASHBOARD_MAX_LIMIT,
  STATE_KEY,
  PRIORITY_KNOWN_STUDIES_STATE_KEY,
  AUTO_OPEN_PROLIFIC_TAB_KEY,
  AUTO_OPEN_PRIORITY_STUDIES_KEY,
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
  STUDIES_REFRESH_CYCLE_SECONDS,
  DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS,
  DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
  DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS,
  MIN_STUDIES_REFRESH_MIN_DELAY_SECONDS,
  MIN_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
  MAX_STUDIES_REFRESH_MIN_DELAY_SECONDS,
  MAX_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
  MAX_STUDIES_REFRESH_SPREAD_SECONDS,
  DEFAULT_PRIORITY_FILTER_MIN_REWARD,
  DEFAULT_PRIORITY_FILTER_MIN_HOURLY_REWARD,
  DEFAULT_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
  DEFAULT_PRIORITY_FILTER_MIN_PLACES,
  MIN_PRIORITY_FILTER_MIN_REWARD,
  MAX_PRIORITY_FILTER_MIN_REWARD,
  MIN_PRIORITY_FILTER_MIN_HOURLY_REWARD,
  MAX_PRIORITY_FILTER_MIN_HOURLY_REWARD,
  MIN_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
  MAX_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
  MIN_PRIORITY_FILTER_MIN_PLACES,
  MAX_PRIORITY_FILTER_MIN_PLACES,
  MAX_PRIORITY_FILTER_KEYWORDS,
  MAX_PRIORITY_STUDY_AUTO_OPEN_PER_BATCH,
  PRIORITY_KNOWN_STUDIES_TTL_MS,
  MAX_PRIORITY_KNOWN_STUDIES,
  PRIORITY_ACTION_SEEN_TTL_MS,
  MAX_PRIORITY_ACTION_SEEN_STUDIES,
  PRIORITY_ALERT_COOLDOWN_MS,
  DEFAULT_PRIORITY_ALERT_SOUND_TYPE,
  DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
  MIN_PRIORITY_ALERT_SOUND_VOLUME,
  MAX_PRIORITY_ALERT_SOUND_VOLUME,
  PRIORITY_ALERT_SOUND_TYPE_TO_BASE64_PATH,
  DEBUG_LOG_LIMIT,
  DEBUG_LOG_SUPPRESSED_EVENTS,
  DEBUG_STATE_REPORT_DEBOUNCE_MS,
} from '../../lib/constants';
import {
  evaluatePrioritySnapshotEvent,
} from './domain';
import type { NormalizedSnapshotEvent } from './domain';
import { createPriorityState } from './state';
import { createPriorityActions } from './actions';
import { createPrioritySettings } from './settings';
import {
  extractPrioritySnapshotEventFromStudiesRefreshMessage,
  toFullSnapshotEvent,
} from './adapters';
import type { StudiesRefreshMessage } from './adapters';

export default defineBackground({
  main() {
    // ─────────────────────────────────────────────────────────────
    // Mutable state
    // ─────────────────────────────────────────────────────────────

    // Tracks whether the extension is currently performing its own studies fetch.
    // Used to prevent double-processing: the content script and webRequest.onCompleted
    // skip interception while this is true, since the delayed refresh handler
    // already processes the response directly.
    let extensionFetchInProgress = false;

    let delayedRefreshTimers: ReturnType<typeof setTimeout>[] = [];
    let delayedRefreshGeneration = 0;

    let syncInProgress = false;
    let pendingSyncTrigger = '';
    let studiesCompletedListenerRegistered = false;
    let studiesResponseCaptureRegistered = false;
    let submissionResponseCaptureRegistered = false;
    let participantSubmissionsResponseCaptureRegistered = false;
    let oauthCompletedListenerRegistered = false;
    let oauthResponseCaptureRegistered = false;
    let stateWriteQueue: Promise<void | Record<string, unknown>> = Promise.resolve();
    let serviceSocket: WebSocket | null = null;
    let serviceSocketConnectInFlight = false;
    let serviceSocketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let serviceSocketHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let serviceSocketReconnectAttempts = 0;
    let serviceSocketLastHeartbeatAckAt = 0;
    let tokenSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let autoOpenInFlight = false;
    let lastAutoOpenedTabId: number | null = null;

    // ─────────────────────────────────────────────────────────────
    // Priority module initialization
    // ─────────────────────────────────────────────────────────────

    const prioritySettings = createPrioritySettings({
      keys: {
        enabled: AUTO_OPEN_PRIORITY_STUDIES_KEY,
        autoOpenInNewTab: PRIORITY_FILTER_AUTO_OPEN_NEW_TAB_KEY,
        alertSoundEnabled: PRIORITY_FILTER_ALERT_SOUND_ENABLED_KEY,
        alertSoundType: PRIORITY_FILTER_ALERT_SOUND_TYPE_KEY,
        alertSoundVolume: PRIORITY_FILTER_ALERT_SOUND_VOLUME_KEY,
        minimumReward: PRIORITY_FILTER_MIN_REWARD_KEY,
        minimumHourlyReward: PRIORITY_FILTER_MIN_HOURLY_REWARD_KEY,
        maximumEstimatedMinutes: PRIORITY_FILTER_MAX_ESTIMATED_MINUTES_KEY,
        minimumPlaces: PRIORITY_FILTER_MIN_PLACES_KEY,
        alwaysOpenKeywords: PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY,
        ignoreKeywords: PRIORITY_FILTER_IGNORE_KEYWORDS_KEY,
      },
      limits: {
        maxKeywords: MAX_PRIORITY_FILTER_KEYWORDS,
        minMinReward: MIN_PRIORITY_FILTER_MIN_REWARD,
        maxMinReward: MAX_PRIORITY_FILTER_MIN_REWARD,
        minMinHourlyReward: MIN_PRIORITY_FILTER_MIN_HOURLY_REWARD,
        maxMinHourlyReward: MAX_PRIORITY_FILTER_MIN_HOURLY_REWARD,
        minEstimatedMinutes: MIN_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
        maxEstimatedMinutes: MAX_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
        minMinimumPlaces: MIN_PRIORITY_FILTER_MIN_PLACES,
        maxMinimumPlaces: MAX_PRIORITY_FILTER_MIN_PLACES,
        minAlertSoundVolume: MIN_PRIORITY_ALERT_SOUND_VOLUME,
        maxAlertSoundVolume: MAX_PRIORITY_ALERT_SOUND_VOLUME,
      },
      defaults: {
        minimumRewardMajor: DEFAULT_PRIORITY_FILTER_MIN_REWARD,
        minimumHourlyRewardMajor: DEFAULT_PRIORITY_FILTER_MIN_HOURLY_REWARD,
        maximumEstimatedMinutes: DEFAULT_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
        minimumPlacesAvailable: DEFAULT_PRIORITY_FILTER_MIN_PLACES,
        alertSoundType: DEFAULT_PRIORITY_ALERT_SOUND_TYPE as SoundType,
        alertSoundVolume: DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
      },
    });

    const {
      normalizePriorityStudyFilter,
      getPriorityStudyFilterSettings,
    } = prioritySettings;

    const priorityStateRuntime = createPriorityState({
      storageKey: PRIORITY_KNOWN_STUDIES_STATE_KEY,
      nowIso,
      limits: {
        knownStudiesTTLMS: PRIORITY_KNOWN_STUDIES_TTL_MS,
        maxKnownStudies: MAX_PRIORITY_KNOWN_STUDIES,
        actionSeenTTLMS: PRIORITY_ACTION_SEEN_TTL_MS,
        maxActionSeenStudies: MAX_PRIORITY_ACTION_SEEN_STUDIES,
      },
      onQueueError: (error: unknown, event: NormalizedSnapshotEvent) => {
        pushDebugLog('tab.priority_auto_open.error', {
          trigger: event.trigger,
          error: stringifyError(error),
        });
      },
    });

    // ─────────────────────────────────────────────────────────────
    // State management functions
    // ─────────────────────────────────────────────────────────────

    function updateState(mutator: (previous: Record<string, unknown>) => Record<string, unknown> | null): Promise<void | Record<string, unknown>> {
      stateWriteQueue = stateWriteQueue.then(async () => {
        const existing = await browser.storage.local.get(STATE_KEY);
        const previous = (existing[STATE_KEY] as Record<string, unknown>) || {};
        const patch = mutator(previous) || {};
        const next: Record<string, unknown> = {
          ...previous,
          ...patch,
          updated_at: nowIso(),
        };
        await browser.storage.local.set({ [STATE_KEY]: next });
        return next;
      }).catch(() => {
        // Keep queue alive even when one write fails.
      });
      return stateWriteQueue;
    }

    async function setState(patch: Record<string, unknown>): Promise<void> {
      await updateState((previous) => ({
        ...previous,
        ...patch,
      }));
      scheduleDebugStateReport();
    }

    async function setTokenSyncState({ ok, trigger, reason, authRequired = false, extra = {} }: {
      ok: boolean | null;
      trigger: string;
      reason: string;
      authRequired?: boolean;
      extra?: Record<string, unknown>;
    }): Promise<void> {
      await setState({
        token_ok: ok,
        token_auth_required: authRequired,
        token_trigger: trigger,
        token_reason: reason,
        ...extra,
      });
    }

    function storageSetLocal(items: Record<string, unknown>): Promise<void> {
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (err: Error | null) => {
          if (settled) {
            return;
          }
          settled = true;
          if (err) {
            reject(err);
            return;
          }
          resolve();
        };

        try {
          const maybePromise = browser.storage.local.set(items);

          if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
            (maybePromise as Promise<void>).then(() => settle(null)).catch((error: unknown) => settle(error as Error));
          } else {
            // Callback-based path (Chrome MV2 style) — should not happen with wxt/browser
            // but handle defensively.
            settle(null);
          }
        } catch (error) {
          settle(error as Error);
        }
      });
    }

    async function bumpCounter(counterName: string, by: number = 1): Promise<void> {
      try {
        await updateState((previous) => {
          const current = Number(previous[counterName]) || 0;
          return {
            [counterName]: current + by,
          };
        });
      } catch {
        // Ignore debug counter errors.
      }
    }

    async function pushDebugLog(event: string, details: Record<string, unknown> = {}): Promise<void> {
      if (DEBUG_LOG_SUPPRESSED_EVENTS.has(event)) {
        return;
      }

      try {
        await updateState((previous) => {
          const previousLogs = Array.isArray(previous.debug_logs) ? previous.debug_logs as Array<Record<string, unknown>> : [];
          const now = nowIso();
          const detailsJSON = safeJSONStringify(details);

          let nextLogs: Array<Record<string, unknown>>;
          const head = previousLogs[0];
          const headDetailsJSON = head && head.details ? safeJSONStringify(head.details) : '{}';
          if (head && head.event === event && headDetailsJSON === detailsJSON) {
            const repeated = Math.max(1, Number(head.repeat_count) || 1) + 1;
            nextLogs = [
              {
                ...head,
                at: now,
                repeat_count: repeated,
              },
              ...previousLogs.slice(1),
            ];
          } else {
            nextLogs = [
              {
                at: now,
                event,
                details,
                repeat_count: 1,
              },
              ...previousLogs,
            ];
          }
          nextLogs = nextLogs.slice(0, DEBUG_LOG_LIMIT);

          return {
            debug_logs: nextLogs,
            debug_log_count_total: (Number(previous.debug_log_count_total) || 0) + 1,
          };
        });
      } catch {
        // Ignore debug log write errors.
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Helper functions
    // ─────────────────────────────────────────────────────────────

    function stringifyError(error: unknown): string {
      const message = rawErrorMessage(error);
      if (isNetworkFailureMessage(message)) {
        return SERVICE_OFFLINE_MESSAGE;
      }
      return message;
    }

    function rawErrorMessage(error: unknown): string {
      if (error instanceof Error && error.message) {
        return error.message;
      }
      if (error == null) {
        return '';
      }
      return String(error);
    }

    async function clearTransientServiceConnectingState(): Promise<void> {
      await updateState((previous) => {
        const patch: Record<string, unknown> = {};

        if (previous.token_ok === false && isServiceConnectingMessage(previous.token_reason as string)) {
          patch.token_ok = null;
          patch.token_reason = '';
        }
        if (previous.studies_refresh_ok === false && isServiceConnectingMessage(previous.studies_refresh_reason as string)) {
          patch.studies_refresh_ok = null;
          patch.studies_refresh_reason = '';
        }
        if (
          previous.studies_response_capture_ok === false &&
          isServiceConnectingMessage(previous.studies_response_capture_reason as string)
        ) {
          patch.studies_response_capture_ok = null;
          patch.studies_response_capture_reason = '';
        }

        if (!Object.keys(patch).length) {
          return null;
        }
        return patch;
      });
    }

    function parseInternalAPIURL(raw: string | null | undefined): URL | null {
      if (!raw) {
        return null;
      }
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:') {
          return null;
        }
        if (parsed.hostname !== 'internal-api.prolific.com') {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }

    function safeJSONStringify(value: unknown): string {
      try {
        return JSON.stringify(value);
      } catch {
        return '"[unserializable]"';
      }
    }

    function notifyPopupDashboardUpdated(trigger: string, observedAt: string): void {
      const normalizedObservedAt = typeof observedAt === 'string' ? observedAt.trim() : '';
      const payload = {
        action: 'dashboardUpdated',
        trigger: String(trigger || 'unknown'),
        observed_at: normalizedObservedAt || nowIso(),
      };

      try {
        const maybePromise = browser.runtime.sendMessage(payload);
        if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === 'function') {
          (maybePromise as Promise<unknown>).catch(() => {
            // Popup may be closed; ignore delivery errors.
          });
        }
      } catch {
        // Popup may be closed; ignore delivery errors.
      }
    }

    function extractObservedAtFromStudiesRefreshEvent(parsed: StudiesRefreshMessage | null | undefined): string {
      if (!parsed || typeof parsed !== 'object') {
        return '';
      }

      const direct = typeof (parsed as Record<string, unknown>).at === 'string' ? ((parsed as Record<string, unknown>).at as string).trim() : '';
      const dataObservedAt = parsed.data && typeof parsed.data === 'object' && typeof (parsed.data as Record<string, unknown>).observed_at === 'string'
        ? ((parsed.data as Record<string, unknown>).observed_at as string).trim()
        : '';

      return dataObservedAt || direct || nowIso();
    }

    function clampDashboardLimit(value: unknown, fallback: number): number {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed)) {
        return fallback;
      }
      return Math.min(DASHBOARD_MAX_LIMIT, Math.max(DASHBOARD_MIN_LIMIT, parsed));
    }

    async function fetchServiceJSON(path: string, contextLabel: string): Promise<unknown> {
      let response: Response;
      try {
        response = await fetch(`${SERVICE_BASE_URL}${path}`);
      } catch (error) {
        const message = stringifyError(error);
        if (message === SERVICE_OFFLINE_MESSAGE) {
          throw new Error(SERVICE_OFFLINE_MESSAGE);
        }
        throw new Error(`${contextLabel}: ${rawErrorMessage(error) || 'network error'}`);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${contextLabel}: HTTP ${response.status}${text ? ` ${text}` : ''}`);
      }

      return response.json();
    }

    function extractArrayField(payload: unknown, key: string): unknown[] {
      if (!payload || !Array.isArray((payload as Record<string, unknown>)[key])) {
        return [];
      }
      return (payload as Record<string, unknown>)[key] as unknown[];
    }

    async function loadDashboardData(liveLimit: number, eventsLimit: number, submissionsLimit: number): Promise<Record<string, unknown>> {
      const [refreshResult, studiesResult, eventsResult, submissionsResult] = await Promise.allSettled([
        fetchServiceJSON('/studies-refresh', 'Failed to fetch refresh state'),
        fetchServiceJSON(`/studies?limit=${liveLimit}`, 'Failed to fetch live studies'),
        fetchServiceJSON(`/study-events?limit=${eventsLimit}`, 'Failed to fetch study events'),
        fetchServiceJSON(`/submissions?phase=all&limit=${submissionsLimit}`, 'Failed to fetch submissions'),
      ]);

      const parseResult = (result: PromiseSettledResult<unknown>, extractor: (value: unknown) => unknown): Record<string, unknown> => {
        if (result.status === 'fulfilled') {
          return {
            ok: true,
            data: extractor(result.value),
          };
        }
        return {
          ok: false,
          error: stringifyError(result.reason),
        };
      };

      return {
        refresh_state: parseResult(refreshResult, (payload) => payload || null),
        studies: parseResult(studiesResult, (payload) => extractArrayField(payload, 'results')),
        events: parseResult(eventsResult, (payload) => extractArrayField(payload, 'events')),
        submissions: parseResult(submissionsResult, (payload) => extractArrayField(payload, 'results')),
      };
    }

    function normalizeStudiesRefreshPolicy(rawMinimumDelaySeconds: unknown, rawAverageDelaySeconds: unknown, rawSpreadSeconds: unknown): Record<string, number> {
      const parseSeconds = (value: unknown, fallback: number): number => {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) {
          return fallback;
        }
        return parsed;
      };

      const averageDelaySeconds = Math.min(
        MAX_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
        Math.max(
          MIN_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS,
          parseSeconds(rawAverageDelaySeconds, DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS),
        ),
      );
      const countByAverage = Math.max(0, Math.floor(STUDIES_REFRESH_CYCLE_SECONDS / averageDelaySeconds) - 1);
      const segments = countByAverage + 1;
      const calculatedCycleSeconds = Math.max(1, Math.floor(STUDIES_REFRESH_CYCLE_SECONDS / segments));
      const maximumMinimumDelaySeconds = Math.max(
        MIN_STUDIES_REFRESH_MIN_DELAY_SECONDS,
        Math.min(MAX_STUDIES_REFRESH_MIN_DELAY_SECONDS, Math.floor(calculatedCycleSeconds / 2)),
      );
      const minimumDelaySeconds = Math.min(
        maximumMinimumDelaySeconds,
        Math.max(
          MIN_STUDIES_REFRESH_MIN_DELAY_SECONDS,
          parseSeconds(rawMinimumDelaySeconds, DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS),
        ),
      );
      const maximumSpreadSeconds = Math.max(
        0,
        Math.min(MAX_STUDIES_REFRESH_SPREAD_SECONDS, Math.floor(calculatedCycleSeconds / 2)),
      );

      const spreadSeconds = Math.min(
        maximumSpreadSeconds,
        Math.max(
          0,
          parseSeconds(rawSpreadSeconds, DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS),
        ),
      );

      return {
        minimum_delay_seconds: minimumDelaySeconds,
        average_delay_seconds: averageDelaySeconds,
        spread_seconds: spreadSeconds,
        cycle_seconds: STUDIES_REFRESH_CYCLE_SECONDS,
      };
    }

    async function getStudiesRefreshPolicySettings(): Promise<Record<string, number>> {
      const data = await browser.storage.local.get([
        STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY,
        STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY,
        STUDIES_REFRESH_SPREAD_SECONDS_KEY,
      ]);
      return normalizeStudiesRefreshPolicy(
        data[STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY],
        data[STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY],
        data[STUDIES_REFRESH_SPREAD_SECONDS_KEY],
      );
    }

    // ─────────────────────────────────────────────────────────────
    // URL normalization
    // ─────────────────────────────────────────────────────────────

    function normalizeStudiesCollectionURL(raw: string): string {
      const parsed = parseInternalAPIURL(raw);
      if (!parsed) {
        return '';
      }

      const path = parsed.pathname.replace(/\/+$/, '');
      const expected = STUDIES_COLLECTION_PATH.replace(/\/+$/, '');
      if (path !== expected) {
        return '';
      }

      parsed.pathname = STUDIES_COLLECTION_PATH;
      return parsed.toString();
    }

    function normalizeSubmissionURL(raw: string): string {
      const parsed = parseInternalAPIURL(raw);
      if (!parsed) {
        return '';
      }

      const path = parsed.pathname.replace(/\/+$/, '/');
      if (path === '/api/v1/submissions/reserve/') {
        parsed.pathname = '/api/v1/submissions/reserve/';
        parsed.search = '';
        return parsed.toString();
      }

      const transitionMatch = path.match(/^\/api\/v1\/submissions\/([^/]+)\/transition\/$/);
      if (!transitionMatch || !transitionMatch[1]) {
        return '';
      }

      parsed.pathname = `/api/v1/submissions/${transitionMatch[1]}/transition/`;
      parsed.search = '';
      return parsed.toString();
    }

    function normalizeParticipantSubmissionsURL(raw: string): string {
      const parsed = parseInternalAPIURL(raw);
      if (!parsed) {
        return '';
      }

      const path = parsed.pathname.replace(/\/+$/, '/');
      if (path !== '/api/v1/participant/submissions/') {
        return '';
      }

      parsed.pathname = '/api/v1/participant/submissions/';
      return parsed.toString();
    }

    // ─────────────────────────────────────────────────────────────
    // Token extraction
    // ─────────────────────────────────────────────────────────────

    async function extractTokenFromTab(tabId: number): Promise<Record<string, unknown>> {
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId },
          func: () => {
            try {
              let oidcKey: string | null = null;
              for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                if (key && key.startsWith('oidc.user')) {
                  oidcKey = key;
                  break;
                }
              }

              if (!oidcKey) {
                return { error: 'No oidc.user* key found in localStorage.' };
              }

              const raw = window.localStorage.getItem(oidcKey);
              if (!raw) {
                return { error: `Key ${oidcKey} has no value.` };
              }

              let parsed: Record<string, unknown>;
              try {
                parsed = JSON.parse(raw);
              } catch (parseError) {
                return { error: `Value for ${oidcKey} is not valid JSON: ${String(parseError)}` };
              }

              if (!parsed || typeof parsed !== 'object' || !parsed.access_token) {
                return { error: `Value for ${oidcKey} does not contain access_token.` };
              }

              return {
                key: oidcKey,
                origin: window.location.origin,
                access_token: parsed.access_token,
                token_type: (parsed.token_type as string) || 'Bearer',
                browser_info: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              };
            } catch (error) {
              return {
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
        });

        if (!results || !results.length) {
          return { error: 'No script execution result.' };
        }
        return (results[0] as { result: Record<string, unknown> }).result || { error: 'Empty script result.' };
      } catch (scriptError) {
        return { error: 'Script injection not available: ' + String((scriptError as Error).message || scriptError) };
      }
    }

    // ─────────────────────────────────────────────────────────────
    // MAIN-world studies fetch (runs inside the open Prolific tab)
    // ─────────────────────────────────────────────────────────────

    async function fetchStudiesInTab(tabId: number): Promise<Record<string, unknown>> {
      // Prefer scripting mode: the request runs inside the Prolific tab's context,
      // so it carries normal cookies/origin and is indistinguishable from the web
      // app's own API calls. Fall back to background fetch only if scripting fails
      // (tab navigating, dead context, etc.).
      extensionFetchInProgress = true;
      try {
        const scriptResult = await fetchStudiesInTabViaScripting(tabId);
        if (scriptResult.ok) return scriptResult;

        // Scripting failed — try background fetch with stored token
        const existing = await browser.storage.local.get(STATE_KEY);
        const state = (existing[STATE_KEY] as Record<string, unknown>) || {};
        const accessToken = state.access_token as string | undefined;
        const tokenType = (state.token_type as string) || 'Bearer';

        if (!accessToken) {
          return scriptResult;
        }

        pushDebugLog('refresh.fetch_fallback_to_background', {
          scripting_error: scriptResult.error as string,
          tab_id: tabId,
        });

        try {
          const resp = await fetch(FETCH_STUDIES_API_URL, {
            method: 'GET',
            credentials: 'omit',
            headers: {
              'Authorization': tokenType + ' ' + accessToken,
              'Accept': 'application/json, text/plain, */*',
            },
          });
          const body = await resp.text();
          return { ok: true, status_code: resp.status, body };
        } catch (err) {
          return { ok: false, error: 'fetch_failed: ' + String(err) };
        }
      } finally {
        // Small delay before clearing — ensures webRequest.onCompleted (which fires
        // asynchronously) still sees the flag for this request.
        setTimeout(() => { extensionFetchInProgress = false; }, 1000);
      }
    }

    async function fetchStudiesInTabViaScripting(tabId: number): Promise<Record<string, unknown>> {
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (apiURL: string) => {
            try {
              let oidcKey: string | null = null;
              for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                if (key && key.startsWith('oidc.user')) {
                  oidcKey = key;
                  break;
                }
              }
              if (!oidcKey) {
                return { ok: false, error: 'no_oidc_token' };
              }
              const raw = window.localStorage.getItem(oidcKey);
              if (!raw) {
                return { ok: false, error: 'empty_oidc_value' };
              }
              let parsed: Record<string, unknown>;
              try {
                parsed = JSON.parse(raw);
              } catch {
                return { ok: false, error: 'invalid_oidc_json' };
              }
              if (!parsed || !parsed.access_token) {
                return { ok: false, error: 'missing_access_token' };
              }

              const tokenType = (parsed.token_type as string) || 'Bearer';
              // Flag prevents the content script from also intercepting this request.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (window as any).__pp_ext_fetch = true;
              return fetch(apiURL, {
                method: 'GET',
                credentials: 'omit',
                headers: {
                  'Authorization': tokenType + ' ' + (parsed.access_token as string),
                  'Accept': 'application/json, text/plain, */*',
                },
              })
                .then((resp: Response) =>
                  resp.text().then((body: string) => ({
                    ok: true,
                    status_code: resp.status,
                    body,
                  })),
                )
                .catch((fetchErr: unknown) => ({
                  ok: false,
                  error: 'fetch_failed: ' + String(fetchErr),
                }))
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .finally(() => { (window as any).__pp_ext_fetch = false; });
            } catch (err) {
              return { ok: false, error: String(err) };
            }
          },
          args: [FETCH_STUDIES_API_URL],
        });

        if (!results || !results.length || !(results[0] as { result: unknown }).result) {
          return { ok: false, error: 'no_script_result' };
        }
        return (results[0] as { result: Record<string, unknown> }).result;
      } catch (scriptError) {
        return { ok: false, error: 'script_injection_failed: ' + String((scriptError as Error).message || scriptError) };
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Delayed refresh scheduling (ported from auto_refresh.go)
    // ─────────────────────────────────────────────────────────────

    function planDelayedRefreshCount(policy: Record<string, number>): number {
      const maxByMinimum = Math.floor(policy.cycle_seconds / policy.minimum_delay_seconds) - 1;
      const maxByAverage = Math.floor(policy.cycle_seconds / policy.average_delay_seconds) - 1;
      const count = Math.min(maxByMinimum, maxByAverage);
      return count < 0 ? 0 : count;
    }

    function planDelayedRefreshSchedule(policy: Record<string, number>): number[] {
      const count = planDelayedRefreshCount(policy);
      if (count <= 0) return [];

      const cycleSeconds = policy.cycle_seconds;
      const minGapSeconds = policy.minimum_delay_seconds;
      const spreadSeconds = policy.spread_seconds;
      const segments = count + 1;

      const centers: number[] = [];
      for (let i = 0; i < count; i++) {
        centers.push((cycleSeconds * (i + 1)) / segments);
      }

      const lows = new Array<number>(count);
      const highs = new Array<number>(count);
      for (let i = 0; i < count; i++) {
        let low = centers[i] - spreadSeconds;
        let high = centers[i] + spreadSeconds;
        const minByBoundary = (i + 1) * minGapSeconds;
        const maxByBoundary = cycleSeconds - (count - i) * minGapSeconds;
        if (low < minByBoundary) low = minByBoundary;
        if (high > maxByBoundary) high = maxByBoundary;
        lows[i] = low;
        highs[i] = high;
      }

      for (let i = 1; i < count; i++) {
        const minAllowed = lows[i - 1] + minGapSeconds;
        if (lows[i] < minAllowed) lows[i] = minAllowed;
      }
      for (let i = count - 2; i >= 0; i--) {
        const maxAllowed = highs[i + 1] - minGapSeconds;
        if (highs[i] > maxAllowed) highs[i] = maxAllowed;
      }

      for (let i = 0; i < count; i++) {
        if (lows[i] > highs[i]) {
          return centers.map((c) => c * 1000);
        }
      }

      const chosen = new Array<number>(count);
      for (let i = 0; i < count; i++) {
        let low = lows[i];
        if (i > 0) {
          const minAllowed = chosen[i - 1] + minGapSeconds;
          if (low < minAllowed) low = minAllowed;
        }
        const high = highs[i];
        if (low > high) low = high;
        if (high <= low) {
          chosen[i] = low;
          continue;
        }

        let lowInt = Math.ceil(low);
        const highInt = Math.floor(high);
        if (lowInt > highInt) {
          chosen[i] = low;
          continue;
        }
        if (i > 0) {
          const prevFloor = Math.floor(chosen[i - 1]);
          const minAllowedInt = prevFloor + policy.minimum_delay_seconds;
          if (lowInt < minAllowedInt) lowInt = minAllowedInt;
          if (lowInt > highInt) {
            chosen[i] = highInt;
            continue;
          }
        }
        const span = highInt - lowInt + 1;
        let pick = lowInt;
        if (span > 1) {
          let offset = Math.floor(Math.random() * span);
          if (offset < 0) offset = 0;
          if (offset >= span) offset = span - 1;
          pick = lowInt + offset;
        }
        chosen[i] = pick;
      }

      return chosen.map((s) => s * 1000);
    }

    function cancelDelayedRefreshes(reason: string): void {
      delayedRefreshGeneration++;
      for (const timer of delayedRefreshTimers) {
        clearTimeout(timer);
      }
      delayedRefreshTimers = [];
      pushDebugLog('refresh.delayed.cleared', { reason, generation: delayedRefreshGeneration });
    }

    async function runDelayedRefresh(triggerSource: string, generation: number, runIndex: number, runTotal: number): Promise<void> {
      if (generation !== delayedRefreshGeneration) return;

      const tabs = await queryProlificTabs();
      if (!tabs.length) {
        pushDebugLog('refresh.delayed.skip_no_tab', { trigger_source: triggerSource, run_index: runIndex });
        return;
      }

      const tabId = tabs[0].id;
      pushDebugLog('refresh.delayed.fetch_start', {
        trigger_source: triggerSource,
        run_index: runIndex,
        run_total: runTotal,
        tab_id: tabId,
      });

      const result = await fetchStudiesInTab(tabId!);
      if (!result.ok) {
        pushDebugLog('refresh.delayed.fetch_failed', {
          trigger_source: triggerSource,
          run_index: runIndex,
          error: result.error as string,
        });
        return;
      }

      const observedAt = nowIso();
      const normalizedURL = FETCH_STUDIES_API_URL;

      if (result.status_code === 200) {
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(result.body as string);
        } catch (parseErr) {
          pushDebugLog('refresh.delayed.body_parse_error', {
            trigger_source: triggerSource,
            run_index: runIndex,
            error: String(parseErr),
          });
        }

        if (parsedBody) {
          try {
            await sendServiceCommandByName('studiesResponse', {
              url: normalizedURL,
              status_code: result.status_code,
              observed_at: observedAt,
              body: parsedBody,
            });
          } catch (err) {
            pushDebugLog('refresh.delayed.send_response_error', {
              trigger_source: triggerSource,
              run_index: runIndex,
              error: stringifyError(err),
            });
          }

          const snapshotEvent = toFullSnapshotEvent(parsedBody, {
            normalizedURL,
            observedAt,
          }, nowIso);
          if (snapshotEvent) {
            queuePrioritySnapshotEvent(snapshotEvent);
          }
        }
      }

      try {
        await sendServiceCommandByName('studiesRefresh', {
          observed_at: observedAt,
          source: 'extension.delayed_refresh',
          url: normalizedURL,
          status_code: result.status_code,
        });
      } catch (err) {
        pushDebugLog('refresh.delayed.send_refresh_error', {
          trigger_source: triggerSource,
          run_index: runIndex,
          error: stringifyError(err),
        });
      }

      pushDebugLog('refresh.delayed.completed', {
        trigger_source: triggerSource,
        run_index: runIndex,
        run_total: runTotal,
        status_code: result.status_code,
      });
    }

    function scheduleDelayedRefreshes(triggerSource: string, policy: Record<string, number>): void {
      cancelDelayedRefreshes('reschedule:' + triggerSource);
      const currentGen = delayedRefreshGeneration;
      const delays = planDelayedRefreshSchedule(policy);

      delayedRefreshTimers = delays.map((delayMs, idx) =>
        setTimeout(() => {
          runDelayedRefresh(triggerSource, currentGen, idx + 1, delays.length).catch((err) => {
            pushDebugLog('refresh.delayed.run_error', {
              trigger_source: triggerSource,
              run_index: idx + 1,
              error: stringifyError(err),
            });
          });
        }, delayMs),
      );

      const fireTimes = delays.map((ms) => new Date(Date.now() + ms).toISOString());
      pushDebugLog('refresh.delayed.schedule', {
        trigger_source: triggerSource,
        count: delays.length,
        policy,
        fire_at: fireTimes,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // WebSocket management
    // ─────────────────────────────────────────────────────────────

    function isServiceSocketReady(): boolean {
      return serviceSocket !== null && serviceSocket.readyState === WebSocket.OPEN;
    }

    function updateServiceSocketState(connected: boolean, reason: string): void {
      setState({
        service_ws_connected: connected,
        service_ws_reason: reason,
        service_ws_last_at: nowIso(),
      });
    }

    let debugStateReportTimer: ReturnType<typeof setTimeout> | null = null;

    function sendDebugStateReport(): void {
      if (!isServiceSocketReady()) {
        return;
      }
      browser.storage.local.get(STATE_KEY).then((data) => {
        if (!isServiceSocketReady()) {
          return;
        }
        const syncState = (data[STATE_KEY] as Record<string, unknown>) || {};
        const { debug_logs, ...stateWithoutLogs } = syncState;
        const payload = {
          extension_url: browser.runtime.getURL(''),
          sync_state: stateWithoutLogs,
          debug_log_count: Array.isArray(debug_logs) ? debug_logs.length : 0,
        };
        try {
          queueServiceSocketMessage(SERVICE_WS_MESSAGE_TYPES.reportDebugState, payload);
        } catch {
          // Best effort — server may not be ready.
        }
      });
    }

    function scheduleDebugStateReport(): void {
      if (debugStateReportTimer) {
        clearTimeout(debugStateReportTimer);
      }
      debugStateReportTimer = setTimeout(() => {
        debugStateReportTimer = null;
        sendDebugStateReport();
      }, DEBUG_STATE_REPORT_DEBOUNCE_MS);
    }

    function startServiceSocketHeartbeatLoop(): void {
      if (serviceSocketHeartbeatTimer) {
        clearInterval(serviceSocketHeartbeatTimer);
      }

      serviceSocketHeartbeatTimer = setInterval(() => {
        if (!isServiceSocketReady()) {
          return;
        }

        const now = Date.now();
        if (serviceSocketLastHeartbeatAckAt > 0 && now - serviceSocketLastHeartbeatAckAt > SERVICE_WS_HEARTBEAT_TIMEOUT_MS) {
          pushDebugLog('service.ws.heartbeat_timeout', { timeout_ms: SERVICE_WS_HEARTBEAT_TIMEOUT_MS });
          try {
            serviceSocket!.close();
          } catch {
            // Best effort.
          }
          return;
        }

        try {
          serviceSocket!.send(JSON.stringify({
            type: 'heartbeat',
            sent_at: nowIso(),
          }));
        } catch {
          // Close handler will trigger reconnect.
          try {
            serviceSocket!.close();
          } catch {
            // Best effort.
          }
        }
      }, SERVICE_WS_HEARTBEAT_INTERVAL_MS);
    }

    function stopServiceSocketHeartbeatLoop(): void {
      if (serviceSocketHeartbeatTimer) {
        clearInterval(serviceSocketHeartbeatTimer);
        serviceSocketHeartbeatTimer = null;
      }
    }

    function scheduleServiceSocketReconnect(reason: string): void {
      if (serviceSocketReconnectTimer) {
        return;
      }

      const baseDelay = Math.min(
        SERVICE_WS_RECONNECT_MAX_DELAY_MS,
        SERVICE_WS_RECONNECT_BASE_DELAY_MS * (2 ** serviceSocketReconnectAttempts),
      );
      const jitter = Math.floor(Math.random() * SERVICE_WS_RECONNECT_JITTER_MS);
      const delay = baseDelay + jitter;

      serviceSocketReconnectAttempts += 1;
      serviceSocketReconnectTimer = setTimeout(() => {
        serviceSocketReconnectTimer = null;
        ensureServiceSocketConnected(reason || 'reconnect_timer');
      }, delay);
    }

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    }

    // ─────────────────────────────────────────────────────────────
    // Offscreen document for audio playback (Chrome service worker)
    // ─────────────────────────────────────────────────────────────

    let offscreenDocumentCreating: Promise<void> | null = null;

    async function ensureOffscreenDocument(): Promise<boolean> {
      if (!(browser as unknown as Record<string, unknown>).offscreen) return false;

      try {
        const contexts = await (browser.runtime as unknown as { getContexts: (opts: Record<string, unknown>) => Promise<unknown[]> }).getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
        });
        if (contexts && contexts.length > 0) return true;
      } catch {
        // getContexts unavailable — try creating anyway.
      }

      if (offscreenDocumentCreating) {
        await offscreenDocumentCreating;
        return true;
      }

      try {
        offscreenDocumentCreating = (browser as unknown as { offscreen: { createDocument: (opts: Record<string, unknown>) => Promise<void> } }).offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Play priority study alert sound',
        });
        await offscreenDocumentCreating;
        return true;
      } catch (err) {
        // "Only a single offscreen document may be created" — already exists.
        if (String(err).includes('single offscreen')) return true;
        pushDebugLog('offscreen.create.error', { error: String(err) });
        return false;
      } finally {
        offscreenDocumentCreating = null;
      }
    }

    async function playAudioViaOffscreen(soundType: string, normalizedVolume: number): Promise<void> {
      const soundPath = PRIORITY_ALERT_SOUND_TYPE_TO_BASE64_PATH[soundType as SoundType];
      if (!soundPath) return;

      const created = await ensureOffscreenDocument();
      if (!created) throw new Error('Could not create offscreen document for audio');

      await browser.runtime.sendMessage({
        action: 'offscreenPlaySound',
        soundPath,
        normalizedVolume,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // Content script intercepted response handling (Chrome)
    // ─────────────────────────────────────────────────────────────

    function handleInterceptedResponse(message: Record<string, unknown>): void {
      const { subtype, url, status, body, observed_at } = message;
      if (subtype === 'studies') {
        processInterceptedJSON(url as string, status as number, body, observed_at as string, CAPTURED_JSON_RESPONSE_OPTIONS.studies);
      } else if (subtype === 'submission') {
        processInterceptedJSON(url as string, status as number, body, observed_at as string, CAPTURED_JSON_RESPONSE_OPTIONS.submission);
      } else if (subtype === 'participant_submissions') {
        processInterceptedJSON(url as string, status as number, body, observed_at as string, CAPTURED_JSON_RESPONSE_OPTIONS.participantSubmissions);
      } else if (subtype === 'oauth_token') {
        handleOAuthTokenPayload(body as Record<string, unknown>, 'content_script_intercept', url as string);
      }
    }

    function processInterceptedJSON(url: string, status: number, body: unknown, observedAt: string, options: CapturedJSONResponseOptions): void {
      const normalizedURL = options.normalizeURL(url);
      if (!normalizedURL) return;

      const context = { normalizedURL, observedAt };

      if (typeof options.onParsed === 'function') {
        Promise.resolve(options.onParsed(body, context)).catch(() => {});
      }

      options.postToService({
        url: normalizedURL,
        status_code: status,
        observed_at: observedAt,
        body: body,
      }).then(() => {
        bumpCounter(options.ingestSuccessCounter, 1);
        pushDebugLog(options.ingestSuccessEvent, { url: normalizedURL });
        options.onIngestSuccess?.(context);
      }).catch((error: unknown) => {
        bumpCounter(options.ingestErrorCounter, 1);
        pushDebugLog(options.ingestErrorEvent, { url: normalizedURL, error: stringifyError(error) });
        options.onIngestError?.(error, context);
      });
    }

    async function waitForServiceSocketReady(messageType: string): Promise<boolean> {
      if (isServiceSocketReady()) {
        return true;
      }

      ensureServiceSocketConnected(`command:${messageType}`);
      const startedAt = Date.now();
      while (Date.now() - startedAt < SERVICE_WS_CONNECT_WAIT_MS) {
        await sleep(SERVICE_WS_CONNECT_POLL_MS);
        if (isServiceSocketReady()) {
          return true;
        }
        ensureServiceSocketConnected(`command_wait:${messageType}`);
      }
      return isServiceSocketReady();
    }

    function scheduleTokenSyncRetry(trigger: string, delayMs: number = TOKEN_SYNC_RETRY_DELAY_MS): void {
      if (tokenSyncRetryTimer) {
        return;
      }

      tokenSyncRetryTimer = setTimeout(() => {
        tokenSyncRetryTimer = null;
        requestTokenSync(trigger).catch(() => {
          // Keep extension resilient.
        });
      }, Math.max(0, Number(delayMs) || 0));
    }

    function ensureServiceSocketConnected(reason: string): void {
      if (typeof WebSocket === 'undefined') {
        return;
      }

      if (isServiceSocketReady() || serviceSocketConnectInFlight) {
        return;
      }

      if (serviceSocket && serviceSocket.readyState === WebSocket.CONNECTING) {
        return;
      }

      if (serviceSocketReconnectTimer) {
        clearTimeout(serviceSocketReconnectTimer);
        serviceSocketReconnectTimer = null;
      }

      let socket: WebSocket;
      try {
        socket = new WebSocket(SERVICE_WS_URL);
      } catch {
        scheduleServiceSocketReconnect('connect_constructor_failed');
        return;
      }

      serviceSocket = socket;
      serviceSocketConnectInFlight = true;

      socket.onopen = () => {
        if (serviceSocket !== socket) {
          return;
        }
        serviceSocketConnectInFlight = false;
        serviceSocketReconnectAttempts = 0;
        serviceSocketLastHeartbeatAckAt = Date.now();
        updateServiceSocketState(true, `connected:${reason}`);
        pushDebugLog('service.ws.connected', { reason });
        clearTransientServiceConnectingState();
        startServiceSocketHeartbeatLoop();
        scheduleTokenSyncRetry('service.ws.connected', 0);
        scheduleDebugStateReport();
      };

      socket.onmessage = (event: MessageEvent) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          return;
        }

        if (!parsed || typeof parsed !== 'object') {
          return;
        }

        const messageType = typeof parsed.type === 'string' ? parsed.type : '';
        if (messageType === 'heartbeat_ack') {
          serviceSocketLastHeartbeatAckAt = Date.now();
          return;
        }

        if (messageType === SERVICE_WS_SERVER_EVENT_TYPES.studiesRefreshEvent) {
          const observedAt = extractObservedAtFromStudiesRefreshEvent(parsed as unknown as StudiesRefreshMessage);
          notifyPopupDashboardUpdated('service.ws.studies_refresh_event', observedAt);
          queuePrioritySnapshotEvent(
            extractPrioritySnapshotEventFromStudiesRefreshMessage(
              parsed as unknown as StudiesRefreshMessage,
              nowIso,
              extractObservedAtFromStudiesRefreshEvent,
            ),
          );
          return;
        }

        if (messageType === 'ack') {
          if (parsed.ok === false) {
            const errorMessage = typeof parsed.error === 'string' && parsed.error
              ? parsed.error
              : 'request failed';
            pushDebugLog('service.ws.command_error', { error: errorMessage });
          }
          return;
        }

        if (messageType) {
          pushDebugLog('service.ws.unknown_message_type', {
            type: messageType,
          });
        }
      };

      socket.onerror = () => {
        if (serviceSocket !== socket) {
          return;
        }
        pushDebugLog('service.ws.error', { reason });
      };

      socket.onclose = () => {
        if (serviceSocket !== socket) {
          return;
        }

        serviceSocket = null;
        serviceSocketConnectInFlight = false;
        stopServiceSocketHeartbeatLoop();
        updateServiceSocketState(false, 'disconnected');
        pushDebugLog('service.ws.disconnected', { reason });
        scheduleServiceSocketReconnect('background_keepalive');
      };
    }

    function queueServiceSocketMessage(messageType: string, payload: unknown): void {
      if (!messageType) {
        throw new Error('missing websocket message type');
      }

      const encoded = JSON.stringify({
        type: messageType,
        sent_at: nowIso(),
        payload,
      });

      if (!isServiceSocketReady()) {
        throw new Error(SERVICE_CONNECTING_MESSAGE);
      }

      try {
        serviceSocket!.send(encoded);
        return;
      } catch {
        try {
          serviceSocket!.close();
        } catch {
          // Best effort.
        }
        pushDebugLog('service.ws.send_failed', { type: messageType });
        ensureServiceSocketConnected(`send_failed:${messageType}`);
        throw new Error(SERVICE_OFFLINE_MESSAGE);
      }
    }

    async function sendServiceCommand(messageType: string, payload: unknown, errorPrefix: string): Promise<void> {
      const ready = await waitForServiceSocketReady(messageType);
      if (!ready) {
        pushDebugLog('service.ws.command_dropped_not_connected', {
          type: messageType,
          wait_ms: SERVICE_WS_CONNECT_WAIT_MS,
        });
        throw new Error(SERVICE_CONNECTING_MESSAGE);
      }

      try {
        queueServiceSocketMessage(messageType, payload);
      } catch (error) {
        const message = stringifyError(error);
        if (message === SERVICE_OFFLINE_MESSAGE || message === SERVICE_CONNECTING_MESSAGE) {
          throw new Error(message);
        }
        const prefix = errorPrefix || 'WebSocket command';
        throw new Error(`${prefix} failed: ${rawErrorMessage(error)}`);
      }
    }

    function sendServiceCommandByName(commandName: string, payload: unknown): Promise<void> {
      const command = (SERVICE_WS_COMMANDS as Record<string, { messageType: string; errorPrefix: string }>)[commandName];
      if (!command) {
        return Promise.reject(new Error(`unknown service command: ${commandName}`));
      }
      return sendServiceCommand(command.messageType, payload, command.errorPrefix);
    }

    // ─────────────────────────────────────────────────────────────
    // Token sync
    // ─────────────────────────────────────────────────────────────

    async function setStudiesRefreshState(ok: boolean, reason: string): Promise<void> {
      await setState({
        studies_refresh_ok: ok,
        studies_refresh_reason: ok ? '' : reason,
        studies_refresh_last_at: nowIso(),
      });
    }

    async function queryProlificTabs(): Promise<Array<{ id?: number; url?: string }>> {
      const tabs = await browser.tabs.query({ url: PROLIFIC_PATTERNS });
      return Array.isArray(tabs) ? tabs : [];
    }

    // ─────────────────────────────────────────────────────────────
    // Priority actions runtime
    // ─────────────────────────────────────────────────────────────

    const priorityActionsRuntime = createPriorityActions({
      nowIso,
      queryProlificTabs,
      pushDebugLog,
      bumpCounter,
      setState,
      playAudioFn: import.meta.env.CHROME ? playAudioViaOffscreen : undefined,
      limits: {
        minAlertSoundVolume: MIN_PRIORITY_ALERT_SOUND_VOLUME,
        maxAlertSoundVolume: MAX_PRIORITY_ALERT_SOUND_VOLUME,
        defaultAlertSoundVolume: DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
        alertCooldownMS: PRIORITY_ALERT_COOLDOWN_MS,
        maxAutoOpenPerBatch: MAX_PRIORITY_STUDY_AUTO_OPEN_PER_BATCH,
      },
    });

    // ─────────────────────────────────────────────────────────────
    // Priority processing pipeline
    // ─────────────────────────────────────────────────────────────

    async function handlePriorityAlertAction(filter: PriorityFilter, matchingStudies: Study[], trigger: string): Promise<void> {
      const candidateStudies = priorityStateRuntime.selectAlertCandidates(matchingStudies);
      if (!candidateStudies.length) {
        return;
      }
      priorityStateRuntime.markAlertSeen(candidateStudies);
      await priorityActionsRuntime.handleAlertAction(filter, candidateStudies, trigger);
    }

    async function handlePriorityAutoOpenAction(filter: PriorityFilter, matchingStudies: Study[], trigger: string): Promise<void> {
      const candidateStudies = priorityStateRuntime.selectAutoOpenCandidates(matchingStudies);
      if (!candidateStudies.length) {
        return;
      }
      priorityStateRuntime.markAutoOpenSeen(candidateStudies);
      await priorityActionsRuntime.handleAutoOpenAction(filter, candidateStudies, trigger);
    }

    function queuePrioritySnapshotEvent(rawEvent: unknown): void {
      priorityStateRuntime.queueEvent(rawEvent, processPrioritySnapshotEvent);
    }

    async function processPrioritySnapshotEvent(event: NormalizedSnapshotEvent): Promise<void> {
      await priorityStateRuntime.ensureHydrated();

      // When studies disappear, clear alert suppression for any the user attempted
      // (clicked "Take part"). This way if the study reappears with new places,
      // the user gets a fresh alert and auto-open.
      if (event.mode === 'delta' && event.removedStudyIDs.length) {
        priorityStateRuntime.clearSeenForAttemptedStudies(event.removedStudyIDs);
      }

      const filter = await getPriorityStudyFilterSettings();
      const evaluation = evaluatePrioritySnapshotEvent(priorityStateRuntime.getSnapshot(), event, filter);
      priorityStateRuntime.setSnapshot(evaluation.nextSnapshot);
      await priorityStateRuntime.persistSnapshot(evaluation.nextSnapshot, evaluation.event.observedAtMS);

      if (evaluation.isBaseline) {
        pushDebugLog('tab.priority_auto_open.baseline', {
          trigger: evaluation.event.trigger,
          available_count: evaluation.nextSnapshot.knownStudyIDs.size,
        });
        return;
      }

      if (!evaluation.newlySeenStudies.length) {
        return;
      }

      if (!filter.enabled) {
        pushDebugLog('tab.priority_auto_open.disabled', {
          trigger: evaluation.event.trigger,
          candidate_count: evaluation.newlySeenStudies.length,
        });
        return;
      }

      if (!evaluation.newPriorityStudies.length) {
        return;
      }

      await Promise.all([
        handlePriorityAlertAction(filter, evaluation.newPriorityStudies, evaluation.event.trigger),
        handlePriorityAutoOpenAction(filter, evaluation.newPriorityStudies, evaluation.event.trigger),
      ]);
    }

    // ─────────────────────────────────────────────────────────────
    // Auto-open Prolific tab
    // ─────────────────────────────────────────────────────────────

    async function hasTrackedAutoOpenedTab(): Promise<boolean> {
      if (typeof lastAutoOpenedTabId !== 'number') {
        return false;
      }
      try {
        const trackedTab = await browser.tabs.get(lastAutoOpenedTabId);
        return Boolean(trackedTab);
      } catch {
        lastAutoOpenedTabId = null;
        return false;
      }
    }

    async function setMissingProlificTabState(trigger: string, reason: string, autoOpenEnabled: boolean): Promise<void> {
      await setTokenSyncState({
        ok: false,
        authRequired: false,
        trigger,
        reason,
        extra: {
          token_key: '',
          token_origin: '',
        },
      });

      const patch: Record<string, unknown> = { auto_open_enabled: autoOpenEnabled };
      if (autoOpenEnabled) {
        patch.auto_open_last_opened_at = nowIso();
      }
      await setState(patch);
    }

    async function maybeAutoOpenProlificTab(trigger: string, knownProlificTabs?: Array<{ id?: number; url?: string }>): Promise<boolean> {
      const stored = await browser.storage.local.get([AUTO_OPEN_PROLIFIC_TAB_KEY]);
      const autoOpenEnabled = stored[AUTO_OPEN_PROLIFIC_TAB_KEY] !== false;

      if (!autoOpenEnabled) {
        await setMissingProlificTabState(
          trigger,
          'No open Prolific tab found and auto-open is disabled.',
          false,
        );
        pushDebugLog('tab.auto_open.disabled', { trigger });
        return false;
      }

      // Dedupe strategy: allow only one open in-flight, and do not auto-open
      // again while the last auto-opened tab still exists.
      if (autoOpenInFlight) {
        pushDebugLog('tab.auto_open.dedup_skip', {
          trigger,
          in_flight: true,
        });
        return false;
      }

      if (await hasTrackedAutoOpenedTab()) {
        pushDebugLog('tab.auto_open.dedup_skip', {
          trigger,
          in_flight: false,
          last_tab_id: lastAutoOpenedTabId,
        });
        return false;
      }

      const existingTabs = Array.isArray(knownProlificTabs) ? knownProlificTabs : await queryProlificTabs();
      if (existingTabs.length > 0) {
        pushDebugLog('tab.auto_open.skip_existing_tab', {
          trigger,
          count: existingTabs.length,
        });
        return false;
      }

      autoOpenInFlight = true;
      try {
        const createdTab = await browser.tabs.create({
          url: PROLIFIC_STUDIES_URL,
          active: false,
        });
        if (createdTab && typeof createdTab.id === 'number') {
          lastAutoOpenedTabId = createdTab.id;
          try {
            await browser.tabs.update(createdTab.id, { pinned: true });
          } catch {
            // Best effort.
          }
        }
      } finally {
        autoOpenInFlight = false;
      }

      await setMissingProlificTabState(
        trigger,
        'No open Prolific tab found. Opened one automatically.',
        true,
      );
      bumpCounter('tab_auto_open_count', 1);
      pushDebugLog('tab.auto_open.created', { trigger });

      return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Token sync
    // ─────────────────────────────────────────────────────────────

    function normalizeSyncTrigger(trigger: unknown): string {
      const normalized = typeof trigger === 'string' ? trigger.trim() : '';
      return normalized || 'unknown';
    }

    function queuePendingTokenSync(trigger: string): void {
      const normalizedTrigger = normalizeSyncTrigger(trigger);
      pendingSyncTrigger = normalizedTrigger;
      pushDebugLog('token.sync.skip_in_progress', { trigger: normalizedTrigger });
    }

    function drainPendingTokenSync(): void {
      if (!pendingSyncTrigger) {
        return;
      }

      const queuedTrigger = pendingSyncTrigger;
      pendingSyncTrigger = '';
      Promise.resolve().then(() => {
        requestTokenSync(`${queuedTrigger}.queued`);
      });
    }

    function requestTokenSync(trigger: string): Promise<void> {
      return syncTokenOnce(normalizeSyncTrigger(trigger));
    }

    async function syncTokenOnce(trigger: string): Promise<void> {
      const normalizedTrigger = normalizeSyncTrigger(trigger);

      if (syncInProgress) {
        queuePendingTokenSync(normalizedTrigger);
        return;
      }
      syncInProgress = true;
      pushDebugLog('token.sync.start', { trigger: normalizedTrigger });

      try {
        const tabs = await queryProlificTabs();
        if (!tabs.length) {
          await maybeAutoOpenProlificTab(normalizedTrigger, tabs);
          return;
        }

        let extracted: Record<string, unknown> | null = null;
        let anyTabAccessible = false;
        for (const tab of tabs) {
          try {
            const result = await extractTokenFromTab(tab.id!);
            if (result && result.access_token) {
              extracted = result;
              break;
            }
            // Script ran in the tab but found no token — tab was accessible.
            // Distinguish from injection failures (page loading, dead context)
            // where the error contains "Script injection not available".
            if (result && result.error &&
                !String(result.error).includes('Script injection not available') &&
                !String(result.error).includes('No script execution result') &&
                !String(result.error).includes('Empty script result')) {
              anyTabAccessible = true;
            }
          } catch (tabError) {
            await setTokenSyncState({
              ok: false,
              authRequired: false,
              trigger: normalizedTrigger,
              reason: `Failed to inspect tab ${tab.id}: ${(tabError as Error).message}`,
            });
          }
        }

        if (!extracted) {
          // Only cancel delayed refreshes if we confirmed the user is actually
          // signed out (script ran in a tab but found no OIDC token). Transient
          // failures (tab loading, script injection unavailable) should not kill
          // pending refreshes — they'll recover once the tab is ready.
          if (anyTabAccessible) {
            cancelDelayedRefreshes('token_cleared');
          }
          pushDebugLog('token.cleared_local', { trigger: normalizedTrigger, reason: 'extension.no_oidc_user_token', tab_accessible: anyTabAccessible });

          await setTokenSyncState({
            ok: false,
            authRequired: true,
            trigger: normalizedTrigger,
            reason: 'Signed out of Prolific. Log in at app.prolific.com to resume syncing.',
            extra: {
              token_key: '',
              token_origin: '',
            },
          });
          return;
        }

        await setTokenSyncState({
          ok: true,
          authRequired: false,
          trigger: normalizedTrigger,
          reason: 'Token available.',
          extra: {
            token_key: extracted.key as string,
            token_origin: extracted.origin as string,
            token_last_success_at: nowIso(),
            access_token: extracted.access_token as string,
            token_type: (extracted.token_type as string) || 'Bearer',
          },
        });
        bumpCounter('token_sync_success_count', 1);
        pushDebugLog('token.sync.ok', { trigger: normalizedTrigger, tab_origin: extracted.origin as string });
      } catch (error) {
        const message = stringifyError(error);
        if (message === SERVICE_CONNECTING_MESSAGE) {
          pushDebugLog('token.sync.deferred_service_connecting', { trigger: normalizedTrigger });
          scheduleTokenSyncRetry(`${normalizedTrigger}.service_connecting_retry`);
          return;
        }

        await setTokenSyncState({
          ok: false,
          authRequired: false,
          trigger: normalizedTrigger,
          reason: message,
        });
        bumpCounter('token_sync_error_count', 1);
        pushDebugLog('token.sync.error', { trigger: normalizedTrigger, error: message });
      } finally {
        syncInProgress = false;
        drainPendingTokenSync();
      }
    }

    async function handleOAuthTokenPayload(payload: unknown, trigger: string, originHint: string): Promise<void> {
      const p = payload as Record<string, unknown> | null | undefined;
      if (!p || typeof p !== 'object' || !p.access_token) {
        pushDebugLog('oauth.payload.missing_access_token', { trigger });
        await requestTokenSync(`${trigger}.fallback_resync`);
        return;
      }

      await setTokenSyncState({
        ok: true,
        authRequired: false,
        trigger,
        reason: 'Captured access_token from oauth/token response.',
        extra: {
          token_key: 'oauth.token.response',
          token_origin: originHint || 'https://auth.prolific.com',
          token_last_success_at: nowIso(),
          access_token: p.access_token as string,
          token_type: (p.token_type as string) || 'Bearer',
        },
      });
      bumpCounter('oauth_token_capture_success_count', 1);
      pushDebugLog('oauth.capture.ok', { trigger, origin: originHint || 'https://auth.prolific.com' });
    }

    // ─────────────────────────────────────────────────────────────
    // Firefox webRequest capture (filterResponseData)
    // ─────────────────────────────────────────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function getFilterResponseDataFunction(): ((requestId: string) => any) | null {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = browser as any;
      if (
        b.webRequest &&
        typeof b.webRequest.filterResponseData === 'function'
      ) {
        return b.webRequest.filterResponseData.bind(b.webRequest);
      }

      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function tapOAuthTokenResponse(details: any): void {
      tapFilteredJSONResponse(details, {
        onParsed: (parsed: unknown) => {
          const originHint = details.initiator || details.originUrl || 'https://auth.prolific.com';
          handleOAuthTokenPayload(parsed, 'oauth_token_response', originHint);
        },
        onParseError: () => {
          requestTokenSync('oauth_token_response.parse_failed_resync');
        },
        onFilterError: () => {
          requestTokenSync('oauth_token_response.filter_error_resync');
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function safeDisconnectResponseFilter(filter: any): void {
      try {
        filter.disconnect();
      } catch {
        // ignore
      }
    }

    interface TapFilteredJSONResponseHandlers {
      onStop?: (observedAt: string) => void;
      onParseError?: (error: unknown, observedAt: string) => void;
      onParsed?: (parsed: unknown, observedAt: string) => void;
      onFilterError?: () => void;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function tapFilteredJSONResponse(details: any, handlers: TapFilteredJSONResponseHandlers): boolean {
      const filterResponseData = getFilterResponseDataFunction();
      if (!filterResponseData) {
        return false;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let filter: any;
      try {
        filter = filterResponseData(details.requestId);
      } catch {
        return false;
      }

      const decoder = new TextDecoder('utf-8');
      let bodyText = '';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter.ondata = (event: any) => {
        bodyText += decoder.decode(event.data, { stream: true });
        filter.write(event.data);
      };

      filter.onstop = () => {
        const observedAt = nowIso();
        handlers.onStop?.(observedAt);

        try {
          bodyText += decoder.decode();
        } catch {
          // ignore
        }
        safeDisconnectResponseFilter(filter);

        try {
          const parsed: unknown = JSON.parse(bodyText);
          handlers.onParsed?.(parsed, observedAt);
        } catch (error) {
          handlers.onParseError?.(error, observedAt);
        }
      };

      filter.onerror = () => {
        safeDisconnectResponseFilter(filter);
        handlers.onFilterError?.();
      };

      return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Captured JSON response options (shared across Firefox/Chrome)
    // ─────────────────────────────────────────────────────────────

    interface CapturedJSONResponseOptions {
      normalizeURL: (raw: string) => string;
      statusCode: number;
      postToService: (payload: Record<string, unknown>) => Promise<void>;
      parseErrorCounter: string;
      parseErrorEvent: string;
      ingestSuccessCounter: string;
      ingestSuccessEvent: string;
      ingestErrorCounter: string;
      ingestErrorEvent: string;
      filterErrorCounter: string;
      filterErrorEvent: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onParsed?: (parsed: unknown, context: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onSkip?: (details: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onStop?: (context: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onParseError?: (error: unknown, context: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onIngestSuccess?: (context: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onIngestError?: (error: unknown, context: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onFilterError?: (context: any) => void;
    }

    function buildCapturedJSONResponseOptions(config: {
      normalizeURL: (raw: string) => string;
      statusCode: number;
      commandName: string;
      counterPrefix: string;
      eventPrefix: string;
      extraHooks?: Record<string, unknown>;
    }): CapturedJSONResponseOptions {
      return Object.freeze({
        normalizeURL: config.normalizeURL,
        statusCode: config.statusCode,
        postToService: (payload: Record<string, unknown>) => sendServiceCommandByName(config.commandName, payload),
        parseErrorCounter: `${config.counterPrefix}_parse_error_count`,
        parseErrorEvent: `${config.eventPrefix}.parse.error`,
        ingestSuccessCounter: `${config.counterPrefix}_ingest_success_count`,
        ingestSuccessEvent: `${config.eventPrefix}.ingest.ok`,
        ingestErrorCounter: `${config.counterPrefix}_ingest_error_count`,
        ingestErrorEvent: `${config.eventPrefix}.ingest.error`,
        filterErrorCounter: `${config.counterPrefix}_filter_error_count`,
        filterErrorEvent: `${config.eventPrefix}.filter.error`,
        ...(config.extraHooks || {}),
      }) as CapturedJSONResponseOptions;
    }

    const CAPTURED_JSON_RESPONSE_OPTIONS = Object.freeze({
      studies: buildCapturedJSONResponseOptions({
        normalizeURL: normalizeStudiesCollectionURL,
        statusCode: 200,
        commandName: 'studiesResponse',
        counterPrefix: 'studies_response',
        eventPrefix: 'studies.response',
        extraHooks: {
          onParsed: (parsed: unknown, context: { normalizedURL: string; observedAt: string }) => {
            const event = toFullSnapshotEvent(parsed, context, nowIso);
            if (event) { queuePrioritySnapshotEvent(event); }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onSkip: (details: any) => {
            pushDebugLog('studies.response.capture.skip_non_collection', {
              url: details.url,
              request_id: details.requestId,
            });
          },
          onStop: (context: { normalizedURL: string; details: { requestId: string }; observedAt: string }) => {
            pushDebugLog('studies.response.capture.stop', {
              url: context.normalizedURL,
              request_id: context.details.requestId,
            });
          },
          onParseError: (error: unknown, context: { observedAt: string }) => {
            setState({
              studies_response_capture_ok: false,
              studies_response_capture_reason: `failed to parse studies response JSON: ${String(error)}`,
              studies_response_capture_last_at: context.observedAt,
            });
          },
          onIngestSuccess: (context: { observedAt: string }) => {
            setState({
              studies_response_capture_ok: true,
              studies_response_capture_reason: '',
              studies_response_capture_last_at: context.observedAt,
            });
          },
          onIngestError: (error: unknown, context: { observedAt: string }) => {
            const message = stringifyError(error);
            if (isServiceConnectingMessage(message)) {
              setState({
                studies_response_capture_ok: null,
                studies_response_capture_reason: '',
                studies_response_capture_last_at: context.observedAt,
              });
              return;
            }
            setState({
              studies_response_capture_ok: false,
              studies_response_capture_reason: message,
              studies_response_capture_last_at: context.observedAt,
            });
          },
          onFilterError: (context: { observedAt: string }) => {
            setState({
              studies_response_capture_ok: false,
              studies_response_capture_reason: 'response stream filter error',
              studies_response_capture_last_at: context.observedAt,
            });
          },
        },
      }),
      submission: buildCapturedJSONResponseOptions({
        normalizeURL: normalizeSubmissionURL,
        statusCode: 0,
        commandName: 'submissionResponse',
        counterPrefix: 'submission_response',
        eventPrefix: 'submission.response',
        extraHooks: {
          onParsed: (parsed: unknown) => {
            // Mark the study as attempted so it re-alerts if it disappears and
            // reappears (e.g., place freed up after "no places available" error).
            const p = parsed as Record<string, unknown> | null;
            const studyID = p && typeof p === 'object'
              ? ((p.study_id as string) || ((p.study as Record<string, unknown>)?.id as string) || '')
              : '';
            if (studyID) {
              priorityStateRuntime.markAttempted(String(studyID).trim());
              pushDebugLog('submission.reserve.study_attempted', { study_id: studyID });
            }
          },
        },
      }),
      participantSubmissions: buildCapturedJSONResponseOptions({
        normalizeURL: normalizeParticipantSubmissionsURL,
        statusCode: 200,
        commandName: 'participantSubmissionsResponse',
        counterPrefix: 'participant_submissions_response',
        eventPrefix: 'participant.submissions.response',
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function tapCapturedJSONResponse(details: any, options: CapturedJSONResponseOptions, normalizedURLOverride: string = ''): void {
      const normalizedURL = normalizedURLOverride || options.normalizeURL(details.url);
      if (!normalizedURL) {
        options.onSkip?.(details);
        return;
      }

      tapFilteredJSONResponse(details, {
        onStop: (observedAt: string) => {
          options.onStop?.({
            details,
            normalizedURL,
            observedAt,
          });
        },
        onParseError: (error: unknown, observedAt: string) => {
          bumpCounter(options.parseErrorCounter, 1);
          pushDebugLog(options.parseErrorEvent, {
            url: normalizedURL,
            error: stringifyError(error),
          });
          options.onParseError?.(error, {
            details,
            normalizedURL,
            observedAt,
          });
        },
        onParsed: (parsed: unknown, observedAt: string) => {
          // Same processing as the content script intercept path.
          processInterceptedJSON(details.url, options.statusCode, parsed, observedAt, options);
        },
        onFilterError: () => {
          const observedAt = nowIso();
          bumpCounter(options.filterErrorCounter, 1);
          pushDebugLog(options.filterErrorEvent, { url: normalizedURL });
          options.onFilterError?.({
            details,
            normalizedURL,
            observedAt,
          });
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // Studies request completed handler
    // ─────────────────────────────────────────────────────────────

    async function handleStudiesRequestCompleted(details: { url: string; statusCode?: number; requestId?: string }): Promise<void> {
      if (extensionFetchInProgress) {
        pushDebugLog('studies.request.completed.skip_extension_originated', { url: details.url });
        return;
      }

      const normalizedURL = normalizeStudiesCollectionURL(details.url);
      if (!normalizedURL) {
        await pushDebugLog('studies.request.completed.skip_non_collection', {
          url: details.url,
          status_code: details.statusCode || 0,
        });
        return;
      }

      const observedAt = nowIso();
      const refreshPolicy = await getStudiesRefreshPolicySettings();
      await bumpCounter('studies_request_completed_count', 1);
      await pushDebugLog('studies.request.completed', {
        url: normalizedURL,
        status_code: details.statusCode || 0,
      });

      try {
        await sendServiceCommandByName('studiesRefresh', {
          observed_at: observedAt,
          source: 'extension.intercepted_response',
          url: normalizedURL,
          status_code: details.statusCode || 0,
        });

        await setStudiesRefreshState(true, '');

        if (details.statusCode === 200) {
          await bumpCounter('studies_refresh_post_success_count', 1);
          await pushDebugLog('studies.refresh.post.ok', {
            url: normalizedURL,
            status_code: 200,
          });

          scheduleDelayedRefreshes('extension.intercepted_response', refreshPolicy);
        }
      } catch (error) {
        await setStudiesRefreshState(false, stringifyError(error));
        await bumpCounter('studies_refresh_post_error_count', 1);
        await pushDebugLog('studies.refresh.post.error', {
          url: normalizedURL,
          status_code: details.statusCode || 0,
          error: stringifyError(error),
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Capture listener registration
    // ─────────────────────────────────────────────────────────────

    function registerStudiesCompletedCapture(): void {
      if (studiesCompletedListenerRegistered) {
        return;
      }
      if (!browser.webRequest || !browser.webRequest.onCompleted) {
        pushDebugLog('studies.completed.listener.unavailable', {});
        return;
      }

      browser.webRequest.onCompleted.addListener(
        (details) => {
          handleStudiesRequestCompleted(details);
        },
        { urls: [STUDIES_REQUEST_PATTERN] },
      );

      studiesCompletedListenerRegistered = true;
      pushDebugLog('studies.completed.listener.registered', {});
    }

    function registerBlockingResponseCapture(options: {
      isRegistered: () => boolean;
      markRegistered: () => void;
      urls: string[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onBeforeRequest: (details: any) => void;
      onUnsupported?: () => void;
      onListenerUnavailable?: () => void;
      onRegistered?: () => void;
      onRegisterError?: (error: unknown) => void;
    }): void {
      if (options.isRegistered()) {
        return;
      }

      if (!getFilterResponseDataFunction()) {
        if (options.onUnsupported) {
          options.onUnsupported();
        }
        return;
      }

      if (!browser.webRequest || !(browser.webRequest as unknown as { onBeforeRequest: unknown }).onBeforeRequest) {
        if (options.onListenerUnavailable) {
          options.onListenerUnavailable();
        }
        return;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (browser.webRequest as any).onBeforeRequest.addListener(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (details: any) => {
            options.onBeforeRequest(details);
            return {};
          },
          { urls: options.urls },
          ['blocking'],
        );

        options.markRegistered();
        if (options.onRegistered) {
          options.onRegistered();
        }
      } catch (error) {
        if (options.onRegisterError) {
          options.onRegisterError(error);
        }
      }
    }

    function registerJSONBodyResponseCapture(options: {
      isRegistered: () => boolean;
      markRegistered: () => void;
      urls: string[];
      normalizeURL: (raw: string) => string;
      beforeRequestCounter: string;
      captureOptions: CapturedJSONResponseOptions;
      unsupportedEvent: string;
      unavailableEvent: string;
      registeredEvent: string;
      registeredDetails?: Record<string, unknown>;
      registerErrorEvent: string;
    }): void {
      registerBlockingResponseCapture({
        isRegistered: options.isRegistered,
        markRegistered: options.markRegistered,
        urls: options.urls,
        onUnsupported: () => {
          pushDebugLog(options.unsupportedEvent, {
            reason: 'filterResponseData not supported',
          });
        },
        onListenerUnavailable: () => {
          pushDebugLog(options.unavailableEvent, {});
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onBeforeRequest: (details: any) => {
          const normalizedURL = options.normalizeURL(details.url);
          if (!normalizedURL) {
            return;
          }
          bumpCounter(options.beforeRequestCounter, 1);
          tapCapturedJSONResponse(details, options.captureOptions, normalizedURL);
        },
        onRegistered: () => {
          pushDebugLog(options.registeredEvent, options.registeredDetails || {});
        },
        onRegisterError: (error: unknown) => {
          pushDebugLog(options.registerErrorEvent, { error: stringifyError(error) });
        },
      });
    }

    function registerStudiesResponseCaptureIfSupported(): void {
      registerBlockingResponseCapture({
        isRegistered: () => studiesResponseCaptureRegistered,
        markRegistered: () => {
          studiesResponseCaptureRegistered = true;
        },
        urls: [STUDIES_REQUEST_PATTERN],
        onUnsupported: () => {
          const manifest = browser.runtime && browser.runtime.getManifest
            ? browser.runtime.getManifest()
            : null;
          const manifestPermissions = manifest && Array.isArray(manifest.permissions) ? manifest.permissions : [];

          setState({
            studies_response_capture_supported: false,
            studies_response_capture_registered: false,
            studies_response_capture_ok: null,
            studies_response_capture_reason: 'filterResponseData not supported',
            studies_response_capture_checked_at: nowIso(),
          });
          pushDebugLog('studies.response.capture.unsupported', {
            reason: 'filterResponseData not supported',
            manifest_version: manifest ? manifest.manifest_version : 'unknown',
            permissions: manifestPermissions,
          });
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onBeforeRequest: (details: any) => {
          if (extensionFetchInProgress) {
            return;
          }
          const normalizedURL = normalizeStudiesCollectionURL(details.url);
          if (!normalizedURL) {
            pushDebugLog('studies.response.capture.before_request.skip_non_collection', {
              url: details.url,
              request_id: details.requestId,
            });
            return;
          }
          bumpCounter('studies_response_before_request_count', 1);
          pushDebugLog('studies.response.capture.before_request', { url: normalizedURL, request_id: details.requestId });
          tapCapturedJSONResponse(details, CAPTURED_JSON_RESPONSE_OPTIONS.studies, normalizedURL);
        },
        onRegistered: () => {
          setState({
            studies_response_capture_supported: true,
            studies_response_capture_registered: true,
            studies_response_capture_ok: null,
            studies_response_capture_reason: '',
            studies_response_capture_checked_at: nowIso(),
          });
          pushDebugLog('studies.response.capture.registered', {});
        },
        onRegisterError: (error: unknown) => {
          setState({
            studies_response_capture_supported: false,
            studies_response_capture_registered: false,
            studies_response_capture_ok: false,
            studies_response_capture_reason: stringifyError(error),
            studies_response_capture_checked_at: nowIso(),
          });
          pushDebugLog('studies.response.capture.register_error', { error: stringifyError(error) });
        },
      });
    }

    function registerSubmissionResponseCaptureIfSupported(): void {
      registerJSONBodyResponseCapture({
        isRegistered: () => submissionResponseCaptureRegistered,
        markRegistered: () => {
          submissionResponseCaptureRegistered = true;
        },
        urls: SUBMISSION_PATTERNS,
        normalizeURL: normalizeSubmissionURL,
        beforeRequestCounter: 'submission_response_before_request_count',
        captureOptions: CAPTURED_JSON_RESPONSE_OPTIONS.submission,
        unsupportedEvent: 'submission.response.capture.unsupported',
        unavailableEvent: 'submission.response.capture.listener.unavailable',
        registeredEvent: 'submission.response.capture.registered',
        registeredDetails: { patterns: SUBMISSION_PATTERNS },
        registerErrorEvent: 'submission.response.capture.register_error',
      });
    }

    function registerParticipantSubmissionsResponseCaptureIfSupported(): void {
      registerJSONBodyResponseCapture({
        isRegistered: () => participantSubmissionsResponseCaptureRegistered,
        markRegistered: () => {
          participantSubmissionsResponseCaptureRegistered = true;
        },
        urls: [PARTICIPANT_SUBMISSIONS_PATTERN],
        normalizeURL: normalizeParticipantSubmissionsURL,
        beforeRequestCounter: 'participant_submissions_response_before_request_count',
        captureOptions: CAPTURED_JSON_RESPONSE_OPTIONS.participantSubmissions,
        unsupportedEvent: 'participant.submissions.response.capture.unsupported',
        unavailableEvent: 'participant.submissions.response.capture.listener.unavailable',
        registeredEvent: 'participant.submissions.response.capture.registered',
        registeredDetails: { patterns: [PARTICIPANT_SUBMISSIONS_PATTERN] },
        registerErrorEvent: 'participant.submissions.response.capture.register_error',
      });
    }

    function registerOAuthCompletedFallbackListener(): void {
      if (oauthCompletedListenerRegistered) {
        return;
      }

      if (!browser.webRequest || !browser.webRequest.onCompleted) {
        pushDebugLog('oauth.completed.listener.unavailable', {});
        return;
      }

      browser.webRequest.onCompleted.addListener(
        () => {
          requestTokenSync('oauth_token_completed_resync');
        },
        { urls: [OAUTH_TOKEN_PATTERN] },
      );

      oauthCompletedListenerRegistered = true;
      pushDebugLog('oauth.completed.listener.registered', {});
    }

    function registerOAuthResponseCaptureIfSupported(): void {
      registerBlockingResponseCapture({
        isRegistered: () => oauthResponseCaptureRegistered,
        markRegistered: () => {
          oauthResponseCaptureRegistered = true;
        },
        urls: [OAUTH_TOKEN_PATTERN],
        onUnsupported: () => {
          pushDebugLog('oauth.response.capture.unsupported', {
            reason: 'filterResponseData not supported',
          });
        },
        onListenerUnavailable: () => {
          pushDebugLog('oauth.response.capture.listener.unavailable', {});
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onBeforeRequest: (details: any) => {
          tapOAuthTokenResponse(details);
        },
        onRegistered: () => {
          pushDebugLog('oauth.response.capture.registered', {});
        },
        onRegisterError: (error: unknown) => {
          setState({
            oauth_response_capture_supported: false,
            oauth_response_capture_reason: stringifyError(error),
            oauth_response_capture_checked_at: nowIso(),
          });
          pushDebugLog('oauth.response.capture.register_error', { error: stringifyError(error) });
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // Alarm scheduling
    // ─────────────────────────────────────────────────────────────

    function schedule(): void {
      browser.alarms.create('oidc_sync', { periodInMinutes: 1 });
      pushDebugLog('alarm.scheduled', { name: 'oidc_sync', period_minutes: 1 });
    }

    function registerCaptureListeners(): void {
      registerStudiesCompletedCapture();
      registerStudiesResponseCaptureIfSupported();
      registerSubmissionResponseCaptureIfSupported();
      registerParticipantSubmissionsResponseCaptureIfSupported();
      registerOAuthCompletedFallbackListener();
      registerOAuthResponseCaptureIfSupported();
    }

    // ─────────────────────────────────────────────────────────────
    // Settings response builder
    // ─────────────────────────────────────────────────────────────

    function buildRefreshSettingsResponse(refreshPolicy: Record<string, number>, autoOpenEnabled?: boolean, priorityFilter?: PriorityFilter | null): Record<string, unknown> {
      const settings: Record<string, unknown> = {
        studies_refresh_min_delay_seconds: refreshPolicy.minimum_delay_seconds,
        studies_refresh_average_delay_seconds: refreshPolicy.average_delay_seconds,
        studies_refresh_spread_seconds: refreshPolicy.spread_seconds,
        studies_refresh_cycle_seconds: refreshPolicy.cycle_seconds,
      };
      if (typeof autoOpenEnabled === 'boolean') {
        settings.auto_open_prolific_tab = autoOpenEnabled;
      }
      if (priorityFilter && typeof priorityFilter === 'object') {
        settings.auto_open_priority_studies = priorityFilter.enabled;
        settings.priority_filter_enabled = priorityFilter.enabled;
        settings.priority_filter_auto_open_in_new_tab = priorityFilter.auto_open_in_new_tab !== false;
        settings.priority_filter_alert_sound_enabled = priorityFilter.alert_sound_enabled !== false;
        settings.priority_filter_alert_sound_type = priorityFilter.alert_sound_type || DEFAULT_PRIORITY_ALERT_SOUND_TYPE;
        settings.priority_filter_alert_sound_volume = priorityFilter.alert_sound_volume;
        settings.priority_filter_minimum_reward = priorityFilter.minimum_reward_major;
        settings.priority_filter_minimum_hourly_reward = priorityFilter.minimum_hourly_reward_major;
        settings.priority_filter_maximum_estimated_minutes = priorityFilter.maximum_estimated_minutes;
        settings.priority_filter_minimum_places = priorityFilter.minimum_places_available;
        settings.priority_filter_always_open_keywords = Array.isArray(priorityFilter.always_open_keywords)
          ? priorityFilter.always_open_keywords
          : [];
        settings.priority_filter_ignore_keywords = Array.isArray(priorityFilter.ignore_keywords)
          ? priorityFilter.ignore_keywords
          : [];
      }
      return settings;
    }

    // ─────────────────────────────────────────────────────────────
    // Runtime message handler
    // ─────────────────────────────────────────────────────────────

    function sendRuntimeError(sendResponse: (response: Record<string, unknown>) => void, error: unknown): void {
      sendResponse({ ok: false, error: stringifyError(error) });
    }

    function runMessageTask(sendResponse: (response: Record<string, unknown>) => void, task: () => Promise<void>): boolean {
      (async () => {
        try {
          await task();
        } catch (error) {
          sendRuntimeError(sendResponse, error);
        }
      })();
      return true;
    }

    browser.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void): boolean | void => {
      const msg = message as Record<string, unknown> | null;

      // Content script intercepted API response (Chrome path).
      if (msg && msg.action === 'interceptedResponse') {
        handleInterceptedResponse(msg);
        return false;
      }

      if (msg && msg.action === 'getState') {
        browser.storage.local.get(STATE_KEY).then((data) => {
          sendResponse({ ok: true, state: data[STATE_KEY] || null });
        });
        return true;
      }

      if (msg && msg.action === 'getSettings') {
        browser.storage.local.get([
          AUTO_OPEN_PROLIFIC_TAB_KEY,
          AUTO_OPEN_PRIORITY_STUDIES_KEY,
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
        ]).then((data) => {
          const refreshPolicy = normalizeStudiesRefreshPolicy(
            data[STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY],
            data[STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY],
            data[STUDIES_REFRESH_SPREAD_SECONDS_KEY],
          );
          const priorityFilter = normalizePriorityStudyFilter(
            data[AUTO_OPEN_PRIORITY_STUDIES_KEY] === true,
            data[PRIORITY_FILTER_AUTO_OPEN_NEW_TAB_KEY] !== false,
            data[PRIORITY_FILTER_ALERT_SOUND_ENABLED_KEY] !== false,
            data[PRIORITY_FILTER_ALERT_SOUND_TYPE_KEY],
            data[PRIORITY_FILTER_ALERT_SOUND_VOLUME_KEY],
            data[PRIORITY_FILTER_MIN_REWARD_KEY],
            data[PRIORITY_FILTER_MIN_HOURLY_REWARD_KEY],
            data[PRIORITY_FILTER_MAX_ESTIMATED_MINUTES_KEY],
            data[PRIORITY_FILTER_MIN_PLACES_KEY],
            data[PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY],
            data[PRIORITY_FILTER_IGNORE_KEYWORDS_KEY],
          );
          sendResponse({
            ok: true,
            settings: buildRefreshSettingsResponse(
              refreshPolicy,
              data[AUTO_OPEN_PROLIFIC_TAB_KEY] !== false,
              priorityFilter,
            ),
          });
        });
        return true;
      }

      if (msg && msg.action === 'getDashboardData') {
        return runMessageTask(sendResponse as (response: Record<string, unknown>) => void, async () => {
          const liveLimit = clampDashboardLimit(
            msg.live_limit,
            DASHBOARD_DEFAULT_STUDIES_LIMIT,
          );
          const eventsLimit = clampDashboardLimit(
            msg.events_limit,
            DASHBOARD_DEFAULT_EVENTS_LIMIT,
          );
          const submissionsLimit = clampDashboardLimit(
            msg.submissions_limit,
            DASHBOARD_DEFAULT_SUBMISSIONS_LIMIT,
          );

          const dashboard = await loadDashboardData(liveLimit, eventsLimit, submissionsLimit);
          sendResponse({ ok: true, dashboard });
        });
      }

      if (msg && msg.action === 'setAutoOpen') {
        return runMessageTask(sendResponse as (response: Record<string, unknown>) => void, async () => {
          const enabled = Boolean(msg.enabled);
          await storageSetLocal({ [AUTO_OPEN_PROLIFIC_TAB_KEY]: enabled });
          await setState({ auto_open_enabled: enabled });
          await pushDebugLog('settings.auto_open.updated', { enabled });

          sendResponse({ ok: true, auto_open_prolific_tab: enabled });

          if (!enabled) {
            lastAutoOpenedTabId = null;
            return;
          }

          const tabs = await queryProlificTabs();
          if (tabs.length === 0) {
            await maybeAutoOpenProlificTab('settings.auto_open.enabled', tabs);
            return;
          }

          await requestTokenSync('settings.auto_open.enabled');
        });
      }

      if (msg && msg.action === 'setPriorityFilter') {
        return runMessageTask(sendResponse as (response: Record<string, unknown>) => void, async () => {
          const priorityFilter = normalizePriorityStudyFilter(
            msg.enabled,
            msg.auto_open_in_new_tab,
            msg.alert_sound_enabled,
            msg.alert_sound_type,
            msg.alert_sound_volume,
            msg.minimum_reward_major,
            msg.minimum_hourly_reward_major,
            msg.maximum_estimated_minutes,
            msg.minimum_places_available,
            msg.always_open_keywords,
            msg.ignore_keywords,
          );

          await storageSetLocal({
            [AUTO_OPEN_PRIORITY_STUDIES_KEY]: priorityFilter.enabled,
            [PRIORITY_FILTER_AUTO_OPEN_NEW_TAB_KEY]: priorityFilter.auto_open_in_new_tab,
            [PRIORITY_FILTER_ALERT_SOUND_ENABLED_KEY]: priorityFilter.alert_sound_enabled,
            [PRIORITY_FILTER_ALERT_SOUND_TYPE_KEY]: priorityFilter.alert_sound_type,
            [PRIORITY_FILTER_ALERT_SOUND_VOLUME_KEY]: priorityFilter.alert_sound_volume,
            [PRIORITY_FILTER_MIN_REWARD_KEY]: priorityFilter.minimum_reward_major,
            [PRIORITY_FILTER_MIN_HOURLY_REWARD_KEY]: priorityFilter.minimum_hourly_reward_major,
            [PRIORITY_FILTER_MAX_ESTIMATED_MINUTES_KEY]: priorityFilter.maximum_estimated_minutes,
            [PRIORITY_FILTER_MIN_PLACES_KEY]: priorityFilter.minimum_places_available,
            [PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY]: priorityFilter.always_open_keywords,
            [PRIORITY_FILTER_IGNORE_KEYWORDS_KEY]: priorityFilter.ignore_keywords,
          });

          await setState({
            auto_open_priority_studies: priorityFilter.enabled,
            priority_filter_enabled: priorityFilter.enabled,
            priority_filter_auto_open_in_new_tab: priorityFilter.auto_open_in_new_tab,
            priority_filter_alert_sound_enabled: priorityFilter.alert_sound_enabled,
            priority_filter_alert_sound_type: priorityFilter.alert_sound_type,
            priority_filter_alert_sound_volume: priorityFilter.alert_sound_volume,
            priority_filter_minimum_reward: priorityFilter.minimum_reward_major,
            priority_filter_minimum_hourly_reward: priorityFilter.minimum_hourly_reward_major,
            priority_filter_maximum_estimated_minutes: priorityFilter.maximum_estimated_minutes,
            priority_filter_minimum_places: priorityFilter.minimum_places_available,
            priority_filter_always_open_keywords: priorityFilter.always_open_keywords,
            priority_filter_ignore_keywords: priorityFilter.ignore_keywords,
          });
          await pushDebugLog('settings.priority_filter.updated', priorityFilter as unknown as Record<string, unknown>);

          const refreshPolicy = await getStudiesRefreshPolicySettings();
          const autoOpenState = await browser.storage.local.get([AUTO_OPEN_PROLIFIC_TAB_KEY]);
          sendResponse({
            ok: true,
            settings: buildRefreshSettingsResponse(
              refreshPolicy,
              autoOpenState[AUTO_OPEN_PROLIFIC_TAB_KEY] !== false,
              priorityFilter,
            ),
          });
        });
      }

      if (msg && msg.action === 'setRefreshDelays') {
        return runMessageTask(sendResponse as (response: Record<string, unknown>) => void, async () => {
          const refreshPolicy = normalizeStudiesRefreshPolicy(
            msg.minimum_delay_seconds,
            msg.average_delay_seconds,
            msg.spread_seconds,
          );

          await storageSetLocal({
            [STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY]: refreshPolicy.minimum_delay_seconds,
            [STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY]: refreshPolicy.average_delay_seconds,
            [STUDIES_REFRESH_SPREAD_SECONDS_KEY]: refreshPolicy.spread_seconds,
          });

          sendResponse({
            ok: true,
            settings: buildRefreshSettingsResponse(refreshPolicy),
          });

          scheduleDelayedRefreshes('extension.settings.save', refreshPolicy);
          pushDebugLog('settings.studies_refresh_policy.schedule_ok', refreshPolicy as unknown as Record<string, unknown>);

          setState({
            studies_refresh_min_delay_seconds: refreshPolicy.minimum_delay_seconds,
            studies_refresh_average_delay_seconds: refreshPolicy.average_delay_seconds,
            studies_refresh_spread_seconds: refreshPolicy.spread_seconds,
            studies_refresh_cycle_seconds: refreshPolicy.cycle_seconds,
          });
          pushDebugLog('settings.studies_refresh_policy.updated', refreshPolicy as unknown as Record<string, unknown>);
        });
      }

      if (msg && msg.action === 'clearDebugLogs') {
        return runMessageTask(sendResponse as (response: Record<string, unknown>) => void, async () => {
          await updateState(() => ({
            debug_logs: [],
          }));
          sendResponse({ ok: true });
        });
      }

      return false;
    });

    // ─────────────────────────────────────────────────────────────
    // Event listeners
    // ─────────────────────────────────────────────────────────────

    browser.runtime.onInstalled.addListener(() => {
      boot('onInstalled', 'runtime.installed').catch(() => {
        // Keep extension startup resilient.
      });
    });

    browser.runtime.onStartup.addListener(() => {
      boot('onStartup', 'runtime.startup').catch(() => {
        // Keep extension startup resilient.
      });
    });

    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'oidc_sync') {
        pushDebugLog('alarm.fired', { name: alarm.name });
        requestTokenSync('alarm');
        // Ensure WebSocket stays connected — critical for service worker wakeup
        // after Chrome terminates and restarts the worker.
        ensureServiceSocketConnected('alarm_wakeup');
      }
    });

    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete' || !tab.url) {
        return;
      }
      if (tab.url.includes('app.prolific.com') || tab.url.includes('auth.prolific.com')) {
        pushDebugLog('tab.updated.prolific', { tab_id: tabId });
        requestTokenSync('tabs.onUpdated');
      }
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      if (typeof tabId === 'number' && tabId === lastAutoOpenedTabId) {
        lastAutoOpenedTabId = null;
      }
      pushDebugLog('tab.removed', { tab_id: tabId });
      requestTokenSync('tabs.onRemoved');
    });

    // ─────────────────────────────────────────────────────────────
    // Boot function
    // ─────────────────────────────────────────────────────────────

    async function boot(trigger: string, logEvent?: string): Promise<void> {
      if (logEvent) {
        await pushDebugLog(logEvent, {});
      }
      ensureServiceSocketConnected(`boot:${trigger}`);
      await priorityStateRuntime.ensureHydrated();
      schedule();
      registerCaptureListeners();
      await requestTokenSync(trigger);
    }

    boot('startup-load', 'extension.init').catch(() => {
      // Keep extension startup resilient.
    });
  },
});
