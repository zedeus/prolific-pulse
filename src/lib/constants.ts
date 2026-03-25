export const PROLIFIC_PATTERNS = ['*://app.prolific.com/*', '*://auth.prolific.com/*'];
export const STUDIES_REQUEST_PATTERN = '*://internal-api.prolific.com/api/v1/participant/studies/*';
export const PARTICIPANT_SUBMISSIONS_PATTERN = '*://internal-api.prolific.com/api/v1/participant/submissions/*';
export const SUBMISSIONS_RESERVE_PATTERN = '*://internal-api.prolific.com/api/v1/submissions/reserve/*';
export const SUBMISSIONS_TRANSITION_PATTERN = '*://internal-api.prolific.com/api/v1/submissions/*/transition/*';
export const SUBMISSION_PATTERNS = [SUBMISSIONS_RESERVE_PATTERN, SUBMISSIONS_TRANSITION_PATTERN];
export const OAUTH_TOKEN_PATTERN = '*://auth.prolific.com/oauth/token*';
export const PROLIFIC_STUDIES_URL = 'https://app.prolific.com/studies';
export const STUDIES_COLLECTION_PATH = '/api/v1/participant/studies/';
export const FETCH_STUDIES_API_URL = 'https://internal-api.prolific.com/api/v1/participant/studies/';

export const SERVICE_BASE_URL = 'http://localhost:8080';
export const SERVICE_OFFLINE_MESSAGE = 'Local service offline, start the Go server to continue.';
export const SERVICE_CONNECTING_MESSAGE = 'Local service connecting; retrying shortly.';
export const SERVICE_WS_URL = SERVICE_BASE_URL.replace(/^http/i, 'ws') + '/ws';

export const SERVICE_WS_HEARTBEAT_INTERVAL_MS = 10_000;
export const SERVICE_WS_HEARTBEAT_TIMEOUT_MS = 15_000;
export const SERVICE_WS_RECONNECT_BASE_DELAY_MS = 500;
export const SERVICE_WS_RECONNECT_MAX_DELAY_MS = 15_000;
export const SERVICE_WS_RECONNECT_JITTER_MS = 250;
export const SERVICE_WS_CONNECT_WAIT_MS = 1_500;
export const SERVICE_WS_CONNECT_POLL_MS = 50;
export const TOKEN_SYNC_RETRY_DELAY_MS = 1_000;

export const SERVICE_WS_MESSAGE_TYPES = Object.freeze({
  studiesRefresh: 'receive-studies-refresh',
  studiesResponse: 'receive-studies-response',
  submissionResponse: 'receive-submission-response',
  participantSubmissionsResponse: 'receive-participant-submissions-response',
  reportDebugState: 'report-debug-state',
} as const);

export const SERVICE_WS_COMMANDS = Object.freeze({
  studiesRefresh: Object.freeze({
    messageType: SERVICE_WS_MESSAGE_TYPES.studiesRefresh,
    errorPrefix: 'Studies refresh endpoint',
  }),
  studiesResponse: Object.freeze({
    messageType: SERVICE_WS_MESSAGE_TYPES.studiesResponse,
    errorPrefix: 'Studies response endpoint',
  }),
  submissionResponse: Object.freeze({
    messageType: SERVICE_WS_MESSAGE_TYPES.submissionResponse,
    errorPrefix: 'Submission response endpoint',
  }),
  participantSubmissionsResponse: Object.freeze({
    messageType: SERVICE_WS_MESSAGE_TYPES.participantSubmissionsResponse,
    errorPrefix: 'Participant submissions response endpoint',
  }),
  reportDebugState: Object.freeze({
    messageType: SERVICE_WS_MESSAGE_TYPES.reportDebugState,
    errorPrefix: 'Debug state report',
  }),
} as const);

export const SERVICE_WS_SERVER_EVENT_TYPES = Object.freeze({
  studiesRefreshEvent: 'studies_refresh_event',
} as const);

export const DASHBOARD_DEFAULT_STUDIES_LIMIT = 50;
export const DASHBOARD_DEFAULT_EVENTS_LIMIT = 25;
export const DASHBOARD_DEFAULT_SUBMISSIONS_LIMIT = 100;
export const DASHBOARD_MIN_LIMIT = 1;
export const DASHBOARD_MAX_LIMIT = 500;

export const STATE_KEY = 'syncState';
export const PRIORITY_KNOWN_STUDIES_STATE_KEY = 'priorityKnownStudiesState';
export const AUTO_OPEN_PROLIFIC_TAB_KEY = 'autoOpenProlificTab';
export const AUTO_OPEN_PRIORITY_STUDIES_KEY = 'autoOpenPriorityStudies';
export const PRIORITY_FILTER_AUTO_OPEN_NEW_TAB_KEY = 'priorityFilterAutoOpenInNewTab';
export const PRIORITY_FILTER_ALERT_SOUND_ENABLED_KEY = 'priorityFilterAlertSoundEnabled';
export const PRIORITY_FILTER_ALERT_SOUND_TYPE_KEY = 'priorityFilterAlertSoundType';
export const PRIORITY_FILTER_ALERT_SOUND_VOLUME_KEY = 'priorityFilterAlertSoundVolume';
export const PRIORITY_FILTER_MIN_REWARD_KEY = 'priorityFilterMinimumReward';
export const PRIORITY_FILTER_MIN_HOURLY_REWARD_KEY = 'priorityFilterMinimumHourlyReward';
export const PRIORITY_FILTER_MAX_ESTIMATED_MINUTES_KEY = 'priorityFilterMaximumEstimatedMinutes';
export const PRIORITY_FILTER_MIN_PLACES_KEY = 'priorityFilterMinimumPlaces';
export const PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY = 'priorityFilterKeywords';
export const PRIORITY_FILTER_IGNORE_KEYWORDS_KEY = 'priorityFilterIgnoreKeywords';
export const STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY = 'studiesRefreshMinDelaySeconds';
export const STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY = 'studiesRefreshAverageDelaySeconds';
export const STUDIES_REFRESH_SPREAD_SECONDS_KEY = 'studiesRefreshSpreadSeconds';

export const STUDIES_REFRESH_CYCLE_SECONDS = 120;
export const DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS = 20;
export const DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS = 30;
export const DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS = 0;
export const MIN_STUDIES_REFRESH_MIN_DELAY_SECONDS = 1;
export const MIN_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS = 5;
export const MAX_STUDIES_REFRESH_MIN_DELAY_SECONDS = 60;
export const MAX_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS = 60;
export const MAX_STUDIES_REFRESH_SPREAD_SECONDS = 60;

export const DEFAULT_PRIORITY_FILTER_MIN_REWARD = 0;
export const DEFAULT_PRIORITY_FILTER_MIN_HOURLY_REWARD = 10;
export const DEFAULT_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES = 20;
export const DEFAULT_PRIORITY_FILTER_MIN_PLACES = 1;
export const MIN_PRIORITY_FILTER_MIN_REWARD = 0;
export const MAX_PRIORITY_FILTER_MIN_REWARD = 100;
export const MIN_PRIORITY_FILTER_MIN_HOURLY_REWARD = 0;
export const MAX_PRIORITY_FILTER_MIN_HOURLY_REWARD = 100;
export const MIN_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES = 1;
export const MAX_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES = 240;
export const MIN_PRIORITY_FILTER_MIN_PLACES = 1;
export const MAX_PRIORITY_FILTER_MIN_PLACES = 1000;
export const MAX_PRIORITY_FILTER_KEYWORDS = 20;
export const MAX_PRIORITY_STUDY_AUTO_OPEN_PER_BATCH = 3;

export const PRIORITY_KNOWN_STUDIES_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const MAX_PRIORITY_KNOWN_STUDIES = 3000;
export const PRIORITY_ACTION_SEEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_PRIORITY_ACTION_SEEN_STUDIES = 1000;
export const PRIORITY_ALERT_COOLDOWN_MS = 7000;

export const DEFAULT_PRIORITY_ALERT_SOUND_TYPE = 'pay';
export const DEFAULT_PRIORITY_ALERT_SOUND_VOLUME = 100;
export const MIN_PRIORITY_ALERT_SOUND_VOLUME = 0;
export const MAX_PRIORITY_ALERT_SOUND_VOLUME = 100;

export const PRIORITY_ALERT_SOUND_TYPE_TO_BASE64_PATH = Object.freeze({
  pay: 'sounds/pay.base64',
  metal_gear: 'sounds/metal_gear.base64',
  twitch: 'sounds/twitch.base64',
  chime: 'sounds/chime.base64',
  money: 'sounds/money.base64',
  samsung: 'sounds/samsung.base64',
  lbp: 'sounds/lbp.base64',
  taco: 'sounds/taco.base64',
} as const);

export type SoundType = keyof typeof PRIORITY_ALERT_SOUND_TYPE_TO_BASE64_PATH;
export const PRIORITY_ALERT_SOUND_TYPES = new Set<SoundType>(
  Object.keys(PRIORITY_ALERT_SOUND_TYPE_TO_BASE64_PATH) as SoundType[],
);

export const DEBUG_LOG_LIMIT = 200;
export const DEBUG_LOG_SUPPRESSED_EVENTS = new Set([
  'alarm.scheduled',
  'alarm.fired',
  'token.sync.start',
  'token.sync.skip_in_progress',
  'tab.updated.prolific',
  'tab.removed',
  'studies.request.completed',
  'studies.request.completed.skip_non_collection',
  'studies.response.capture.before_request',
  'studies.response.capture.before_request.skip_non_collection',
  'studies.response.capture.stop',
  'studies.response.capture.skip_non_collection',
]);
export const DEBUG_STATE_REPORT_DEBOUNCE_MS = 2000;

export const AUTH_REQUIRED_MESSAGE = 'Signed out of Prolific. Log in at app.prolific.com to resume syncing.';
export const AUTH_REQUIRED_PANEL_MESSAGE = 'Waiting for login.';
export const RETRY_INTERVAL_MS = 5000;
export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
export const REACTIVE_REFRESH_DEBOUNCE_MS = 150;
export const PRIORITY_FILTER_PERSIST_DEBOUNCE_MS = 250;
