import { browser } from 'wxt/browser';
import {
  EARNINGS_PREFS_KEY,
  DEFAULT_EARNINGS_INCLUDE_PENDING,
} from './constants';

import type { FxCache } from './fx-rates';

export interface EarningsPrefs {
  include_pending: boolean;
  include_outliers: boolean;
  primary_currency: string | null; // null = auto-detect most common
  /** User-set FX rate overrides; value is units of primary currency per 1 source unit. */
  fx_rates: Record<string, number>;
  /** Auto-fetched FX rates cache, keyed by "FROM_TO". */
  fx_rates_cache: FxCache;
}

export const DEFAULT_EARNINGS_PREFS: EarningsPrefs = Object.freeze({
  include_pending: DEFAULT_EARNINGS_INCLUDE_PENDING,
  include_outliers: false,
  primary_currency: null,
  fx_rates: {},
  fx_rates_cache: {},
}) as EarningsPrefs;

function parseFxCache(raw: unknown): FxCache {
  if (!raw || typeof raw !== 'object') return {};
  const out: FxCache = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const entry = v as Record<string, unknown>;
    const rate = Number(entry.rate);
    const fetched_at = String(entry.fetched_at ?? '');
    if (Number.isFinite(rate) && rate > 0 && fetched_at) {
      out[k.toUpperCase()] = { rate, fetched_at };
    }
  }
  return out;
}

export async function loadEarningsPrefs(): Promise<EarningsPrefs> {
  const data = await browser.storage.local.get(EARNINGS_PREFS_KEY);
  const raw = data[EARNINGS_PREFS_KEY];
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EARNINGS_PREFS, fx_rates: {}, fx_rates_cache: {} };
  const r = raw as Record<string, unknown>;
  return {
    include_pending: r.include_pending !== false,
    include_outliers: r.include_outliers === true,
    primary_currency: typeof r.primary_currency === 'string' && r.primary_currency
      ? r.primary_currency.toUpperCase()
      : null,
    fx_rates: r.fx_rates && typeof r.fx_rates === 'object'
      ? Object.fromEntries(
          Object.entries(r.fx_rates as Record<string, unknown>)
            .filter(([k, v]) => typeof k === 'string' && Number.isFinite(Number(v)) && Number(v) > 0)
            .map(([k, v]) => [k.toUpperCase(), Number(v)]),
        )
      : {},
    fx_rates_cache: parseFxCache(r.fx_rates_cache),
  };
}

export async function saveEarningsPrefs(prefs: EarningsPrefs): Promise<void> {
  // JSON round-trip strips Svelte $state Proxies — Firefox's structured-clone
  // bridge can't serialise them and throws DataCloneError.
  const plain = JSON.parse(JSON.stringify(prefs)) as EarningsPrefs;
  await browser.storage.local.set({ [EARNINGS_PREFS_KEY]: plain });
}
