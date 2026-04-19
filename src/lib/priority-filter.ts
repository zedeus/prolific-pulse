import type { PriorityFilter } from './types';
import {
  DEFAULT_PRIORITY_ALERT_SOUND_TYPE,
  DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
  MIN_PRIORITY_FILTER_MIN_REWARD,
  MIN_PRIORITY_FILTER_MIN_HOURLY_REWARD,
  MAX_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
  MIN_PRIORITY_FILTER_MIN_PLACES,
} from './constants';

export function createDefaultPriorityFilter(overrides: Partial<PriorityFilter> = {}): PriorityFilter {
  return {
    id: crypto.randomUUID(),
    name: 'Filter',
    enabled: true,
    auto_open_in_new_tab: true,
    alert_sound_enabled: true,
    alert_sound_type: DEFAULT_PRIORITY_ALERT_SOUND_TYPE,
    alert_sound_volume: DEFAULT_PRIORITY_ALERT_SOUND_VOLUME,
    telegram_notify: true,
    minimum_reward_major: MIN_PRIORITY_FILTER_MIN_REWARD,
    minimum_hourly_reward_major: MIN_PRIORITY_FILTER_MIN_HOURLY_REWARD,
    maximum_estimated_minutes: MAX_PRIORITY_FILTER_MAX_ESTIMATED_MINUTES,
    minimum_places_available: MIN_PRIORITY_FILTER_MIN_PLACES,
    match_keywords: [],
    ignore_keywords: [],
    match_researchers: [],
    ignore_researchers: [],
    ...overrides,
  };
}
