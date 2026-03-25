import { browser } from 'wxt/browser';
import type { PriorityFilter } from '../../lib/types';
import type { SoundType } from '../../lib/constants';
import {
  PRIORITY_ALERT_SOUND_TYPES,
} from '../../lib/constants';

export interface PrioritySettingsKeys {
  enabled: string;
  autoOpenInNewTab: string;
  alertSoundEnabled: string;
  alertSoundType: string;
  alertSoundVolume: string;
  minimumReward: string;
  minimumHourlyReward: string;
  maximumEstimatedMinutes: string;
  minimumPlaces: string;
  alwaysOpenKeywords: string;
  ignoreKeywords: string;
}

export interface PrioritySettingsLimits {
  maxKeywords: number;
  maxMinReward: number;
  minMinReward: number;
  maxMinHourlyReward: number;
  minMinHourlyReward: number;
  maxEstimatedMinutes: number;
  minEstimatedMinutes: number;
  maxMinimumPlaces: number;
  minMinimumPlaces: number;
  maxAlertSoundVolume: number;
  minAlertSoundVolume: number;
}

export interface PrioritySettingsDefaults {
  minimumRewardMajor: number;
  minimumHourlyRewardMajor: number;
  maximumEstimatedMinutes: number;
  minimumPlacesAvailable: number;
  alertSoundType: SoundType;
  alertSoundVolume: number;
}

export interface CreatePrioritySettingsOptions {
  keys: PrioritySettingsKeys;
  limits: PrioritySettingsLimits;
  defaults: PrioritySettingsDefaults;
}

export interface PrioritySettings {
  normalizePriorityStudyFilter: (
    rawEnabled: unknown,
    rawAutoOpenInNewTab: unknown,
    rawAlertSoundEnabled: unknown,
    rawAlertSoundType: unknown,
    rawAlertSoundVolume: unknown,
    rawMinimumRewardMajor: unknown,
    rawMinimumHourlyRewardMajor: unknown,
    rawMaximumEstimatedMinutes: unknown,
    rawMinimumPlacesAvailable: unknown,
    rawAlwaysOpenKeywords: unknown,
    rawIgnoreKeywords: unknown,
  ) => PriorityFilter;
  getPriorityStudyFilterSettings: () => Promise<PriorityFilter>;
}

export function createPrioritySettings(options: CreatePrioritySettingsOptions): PrioritySettings {
  const {
    keys,
    limits,
    defaults,
  } = options;

  function normalizePriorityKeywordList(rawKeywords: unknown): string[] {
    const values = Array.isArray(rawKeywords)
      ? rawKeywords
      : String(rawKeywords || '').split(',');

    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const value of values) {
      const keyword = String(value || '').trim().toLowerCase();
      if (!keyword || seen.has(keyword)) {
        continue;
      }
      seen.add(keyword);
      normalized.push(keyword);
      if (normalized.length >= limits.maxKeywords) {
        break;
      }
    }
    return normalized;
  }

  function canonicalPriorityAlertSoundType(value: unknown): SoundType {
    const raw = String(value || '').trim();
    if (PRIORITY_ALERT_SOUND_TYPES.has(raw as SoundType)) {
      return raw as SoundType;
    }
    return defaults.alertSoundType;
  }

  function normalizePriorityStudyFilter(
    rawEnabled: unknown,
    rawAutoOpenInNewTab: unknown,
    rawAlertSoundEnabled: unknown,
    rawAlertSoundType: unknown,
    rawAlertSoundVolume: unknown,
    rawMinimumRewardMajor: unknown,
    rawMinimumHourlyRewardMajor: unknown,
    rawMaximumEstimatedMinutes: unknown,
    rawMinimumPlacesAvailable: unknown,
    rawAlwaysOpenKeywords: unknown,
    rawIgnoreKeywords: unknown,
  ): PriorityFilter {
    const parseNumber = (value: unknown, fallback: number): number => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return fallback;
      }
      return parsed;
    };
    const parseInteger = (value: unknown, fallback: number): number => {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed)) {
        return fallback;
      }
      return parsed;
    };

    const minimumRewardMajor = Math.min(
      limits.maxMinReward,
      Math.max(
        limits.minMinReward,
        parseNumber(rawMinimumRewardMajor, defaults.minimumRewardMajor),
      ),
    );
    const minimumHourlyRewardMajor = Math.min(
      limits.maxMinHourlyReward,
      Math.max(
        limits.minMinHourlyReward,
        parseNumber(rawMinimumHourlyRewardMajor, defaults.minimumHourlyRewardMajor),
      ),
    );
    const maximumEstimatedMinutes = Math.min(
      limits.maxEstimatedMinutes,
      Math.max(
        limits.minEstimatedMinutes,
        parseInteger(rawMaximumEstimatedMinutes, defaults.maximumEstimatedMinutes),
      ),
    );
    const minimumPlacesAvailable = Math.min(
      limits.maxMinimumPlaces,
      Math.max(
        limits.minMinimumPlaces,
        parseInteger(rawMinimumPlacesAvailable, defaults.minimumPlacesAvailable),
      ),
    );
    const alwaysOpenKeywords = normalizePriorityKeywordList(rawAlwaysOpenKeywords);
    const ignoreKeywords = normalizePriorityKeywordList(rawIgnoreKeywords);
    const normalizedAlertSoundType = canonicalPriorityAlertSoundType(rawAlertSoundType);
    const alertSoundVolume = Math.min(
      limits.maxAlertSoundVolume,
      Math.max(
        limits.minAlertSoundVolume,
        parseInteger(rawAlertSoundVolume, defaults.alertSoundVolume),
      ),
    );
    return {
      enabled: rawEnabled === true,
      auto_open_in_new_tab: rawAutoOpenInNewTab !== false,
      alert_sound_enabled: rawAlertSoundEnabled !== false,
      alert_sound_type: normalizedAlertSoundType,
      alert_sound_volume: alertSoundVolume,
      minimum_reward_major: Math.round(minimumRewardMajor * 100) / 100,
      minimum_hourly_reward_major: Math.round(minimumHourlyRewardMajor * 100) / 100,
      maximum_estimated_minutes: maximumEstimatedMinutes,
      minimum_places_available: minimumPlacesAvailable,
      always_open_keywords: alwaysOpenKeywords,
      ignore_keywords: ignoreKeywords,
    };
  }

  async function getPriorityStudyFilterSettings(): Promise<PriorityFilter> {
    const data = await browser.storage.local.get([
      keys.enabled,
      keys.autoOpenInNewTab,
      keys.alertSoundEnabled,
      keys.alertSoundType,
      keys.alertSoundVolume,
      keys.minimumReward,
      keys.minimumHourlyReward,
      keys.maximumEstimatedMinutes,
      keys.minimumPlaces,
      keys.alwaysOpenKeywords,
      keys.ignoreKeywords,
    ]);
    return normalizePriorityStudyFilter(
      data[keys.enabled] === true,
      data[keys.autoOpenInNewTab] !== false,
      data[keys.alertSoundEnabled] !== false,
      data[keys.alertSoundType],
      data[keys.alertSoundVolume],
      data[keys.minimumReward],
      data[keys.minimumHourlyReward],
      data[keys.maximumEstimatedMinutes],
      data[keys.minimumPlaces],
      data[keys.alwaysOpenKeywords],
      data[keys.ignoreKeywords],
    );
  }

  return Object.freeze({
    normalizePriorityStudyFilter,
    getPriorityStudyFilterSettings,
  });
}
