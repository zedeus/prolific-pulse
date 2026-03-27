export const PROLIFIC_PATTERNS = ['*://app.prolific.com/*', '*://auth.prolific.com/*'];
export const STUDIES_REQUEST_PATTERN = '*://internal-api.prolific.com/api/v1/participant/studies/*';
export const PARTICIPANT_SUBMISSIONS_PATTERN = '*://internal-api.prolific.com/api/v1/participant/submissions/*';
const SUBMISSIONS_RESERVE_PATTERN = '*://internal-api.prolific.com/api/v1/submissions/reserve/*';
const SUBMISSIONS_TRANSITION_PATTERN = '*://internal-api.prolific.com/api/v1/submissions/*/transition/*';
export const SUBMISSION_PATTERNS = [SUBMISSIONS_RESERVE_PATTERN, SUBMISSIONS_TRANSITION_PATTERN];
export const OAUTH_TOKEN_PATTERN = '*://auth.prolific.com/oauth/token*';
export const PROLIFIC_STUDIES_URL = 'https://app.prolific.com/studies';
export const STUDIES_COLLECTION_PATH = '/api/v1/participant/studies/';
export const FETCH_STUDIES_API_URL = 'https://internal-api.prolific.com/api/v1/participant/studies/?sortBy=published_at&orderBy=asc';

export const DASHBOARD_DEFAULT_STUDIES_LIMIT = 50;
export const DASHBOARD_DEFAULT_EVENTS_LIMIT = 25;
export const DASHBOARD_DEFAULT_SUBMISSIONS_LIMIT = 100;

export const STATE_KEY = 'syncState';
export const PRIORITY_KNOWN_STUDIES_STATE_KEY = 'priorityKnownStudiesState';
export const AUTO_OPEN_PROLIFIC_TAB_KEY = 'autoOpenProlificTab';
export const PRIORITY_FILTERS_KEY = 'priorityFilters';
export const TELEGRAM_SETTINGS_KEY = 'telegramSettings';
export const MAX_PRIORITY_FILTERS = 10;

// Legacy keys — used only for one-time migration to PRIORITY_FILTERS_KEY
export const LEGACY_PRIORITY_FILTER_ENABLED_KEY = 'priorityFilterEnabled';
export const LEGACY_PRIORITY_FILTER_AUTO_OPEN_NEW_TAB_KEY = 'priorityFilterAutoOpenInNewTab';
export const LEGACY_PRIORITY_FILTER_ALERT_SOUND_ENABLED_KEY = 'priorityFilterAlertSoundEnabled';
export const LEGACY_PRIORITY_FILTER_ALERT_SOUND_TYPE_KEY = 'priorityFilterAlertSoundType';
export const LEGACY_PRIORITY_FILTER_ALERT_SOUND_VOLUME_KEY = 'priorityFilterAlertSoundVolume';
export const LEGACY_PRIORITY_FILTER_MIN_REWARD_KEY = 'priorityFilterMinimumReward';
export const LEGACY_PRIORITY_FILTER_MIN_HOURLY_REWARD_KEY = 'priorityFilterMinimumHourlyReward';
export const LEGACY_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES_KEY = 'priorityFilterMaximumEstimatedMinutes';
export const LEGACY_PRIORITY_FILTER_MIN_PLACES_KEY = 'priorityFilterMinimumPlaces';
export const LEGACY_PRIORITY_FILTER_ALWAYS_OPEN_KEYWORDS_KEY = 'priorityFilterKeywords';
export const LEGACY_PRIORITY_FILTER_IGNORE_KEYWORDS_KEY = 'priorityFilterIgnoreKeywords';
export const STUDIES_REFRESH_MIN_DELAY_SECONDS_KEY = 'studiesRefreshMinDelaySeconds';
export const STUDIES_REFRESH_AVERAGE_DELAY_SECONDS_KEY = 'studiesRefreshAverageDelaySeconds';
export const STUDIES_REFRESH_SPREAD_SECONDS_KEY = 'studiesRefreshSpreadSeconds';

export const STUDIES_REFRESH_CYCLE_SECONDS = 120;
export const DEFAULT_STUDIES_REFRESH_MIN_DELAY_SECONDS = 20;
export const DEFAULT_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS = 30;
export const DEFAULT_STUDIES_REFRESH_SPREAD_SECONDS = 0;
export const MIN_STUDIES_REFRESH_MIN_DELAY_SECONDS = 5;
export const MIN_STUDIES_REFRESH_AVERAGE_DELAY_SECONDS = 25;
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

export const SOUND_TYPE_NONE = 'none';
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

export const AUTH_REQUIRED_MESSAGE = 'Signed out of Prolific. Log in at app.prolific.com to resume syncing.';
export const AUTH_REQUIRED_PANEL_MESSAGE = 'Waiting for login.';

export const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';
export const TELEGRAM_SETTINGS_PERSIST_DEBOUNCE_MS = 400;
export const TELEGRAM_VERIFY_DEBOUNCE_MS = 800;
export const TELEGRAM_MESSAGE_MAX_STUDIES = 10;

export const DEFAULT_TELEGRAM_SETTINGS = Object.freeze({
  enabled: false,
  bot_token: '',
  chat_id: '',
  notify_all_studies: false,
  silent_notifications: false,
  message_format: Object.freeze({
    include_reward: true,
    include_hourly_rate: true,
    include_duration: true,
    include_places: true,
    include_researcher: true,
    include_description: false,
    include_link: true,
  }),
});

export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
export const REACTIVE_REFRESH_DEBOUNCE_MS = 150;
export const PRIORITY_FILTER_PERSIST_DEBOUNCE_MS = 250;
