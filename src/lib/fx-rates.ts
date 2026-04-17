/**
 * Currency conversion via the free Frankfurter API (ECB-backed, no key).
 *   https://www.frankfurter.app/docs/
 *
 * Rates are cached locally; each currency pair is refreshed at most once per
 * FX_CACHE_TTL_MS. Manual user-set rates always override auto-fetched ones.
 */

export const FX_API_BASE_URL = 'https://api.frankfurter.dev/v1';
export const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface FxCacheEntry {
  rate: number;
  fetched_at: string; // ISO timestamp
}

export type FxCache = Record<string, FxCacheEntry>;

export function cacheKey(from: string, to: string): string {
  return `${from.toUpperCase()}_${to.toUpperCase()}`;
}

export function isFresh(entry: FxCacheEntry | undefined, now: Date = new Date()): boolean {
  if (!entry || typeof entry.fetched_at !== 'string') return false;
  const fetched = new Date(entry.fetched_at);
  if (Number.isNaN(fetched.getTime())) return false;
  return now.getTime() - fetched.getTime() < FX_CACHE_TTL_MS;
}

/**
 * Fetch a single FROM→TO conversion rate from Frankfurter.
 * Throws on network/parse failure.
 */
export async function fetchFxRate(from: string, to: string): Promise<number> {
  const url = `${FX_API_BASE_URL}/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FX fetch failed: HTTP ${resp.status}`);
  const data = await resp.json() as { rates?: Record<string, number> };
  const rate = data?.rates?.[to.toUpperCase()];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`FX response missing rate ${from}→${to}`);
  }
  return rate;
}

/**
 * Refresh any stale or missing rates for the given set of source currencies.
 * Never throws; failed pairs stay at their previous cache value (which may be
 * stale or missing — caller's choice of how to surface).
 */
export async function refreshStaleFxRates(
  sources: string[],
  target: string,
  currentCache: FxCache,
  now: Date = new Date(),
): Promise<{ cache: FxCache; updated: string[]; failed: string[] }> {
  const cache: FxCache = { ...currentCache };
  const updated: string[] = [];
  const failed: string[] = [];
  const tasks = sources
    .filter((from) => from !== target)
    .map(async (from) => {
      const key = cacheKey(from, target);
      if (isFresh(cache[key], now)) return;
      try {
        const rate = await fetchFxRate(from, target);
        cache[key] = { rate, fetched_at: now.toISOString() };
        updated.push(from);
      } catch {
        failed.push(from);
      }
    });
  await Promise.all(tasks);
  return { cache, updated, failed };
}

/**
 * Refresh any stale/missing FX pairs (detected + seeded currencies, minus
 * target) and persist via `onCacheUpdated` only when the cache changed.
 * Caller owns the in-flight guard.
 */
export async function maybeRefreshFxRatesForPrefs<T>(opts: {
  submissions: T[];
  primaryCurrency: string | null;
  fxCache: FxCache;
  seedCurrencies: readonly string[];
  detectCurrency: (records: T[]) => string | null;
  listCurrencies: (records: T[]) => { currency: string; count: number }[];
  onCacheUpdated: (cache: FxCache) => Promise<void> | void;
}): Promise<void> {
  const target =
    opts.primaryCurrency
    ?? opts.detectCurrency(opts.submissions)
    ?? opts.seedCurrencies[0];
  if (!target) return;
  const detected = opts.listCurrencies(opts.submissions).map((c) => c.currency);
  const sources = [...new Set([...detected, ...opts.seedCurrencies])].filter((c) => c !== target);
  if (sources.length === 0) return;
  const { cache, updated } = await refreshStaleFxRates(sources, target, opts.fxCache);
  if (updated.length > 0) await opts.onCacheUpdated(cache);
}

/**
 * Combine manual overrides with auto-fetched cache into a single rate map
 * ready to hand to `convertRewards`. Manual rates win over cached ones.
 */
export function resolvedFxRates(
  sources: string[],
  target: string,
  manual: Record<string, number>,
  cache: FxCache,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const from of sources) {
    if (from === target) continue;
    const manualRate = manual[from];
    if (Number.isFinite(manualRate) && manualRate > 0) {
      out[from] = manualRate;
      continue;
    }
    const entry = cache[cacheKey(from, target)];
    if (entry) out[from] = entry.rate;
  }
  return out;
}
