import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cacheKey,
  isFresh,
  fetchFxRate,
  refreshStaleFxRates,
  resolvedFxRates,
  FX_CACHE_TTL_MS,
  type FxCache,
} from '../fx-rates';

describe('cacheKey', () => {
  it('upper-cases both codes', () => {
    expect(cacheKey('gbp', 'usd')).toBe('GBP_USD');
  });
});

describe('isFresh', () => {
  const now = new Date('2026-04-16T12:00:00Z');

  it('false for missing entries', () => {
    expect(isFresh(undefined, now)).toBe(false);
  });

  it('true when fetched within TTL', () => {
    const fetched = new Date(now.getTime() - FX_CACHE_TTL_MS + 1000).toISOString();
    expect(isFresh({ rate: 1.27, fetched_at: fetched }, now)).toBe(true);
  });

  it('false when fetched older than TTL', () => {
    const fetched = new Date(now.getTime() - FX_CACHE_TTL_MS - 1000).toISOString();
    expect(isFresh({ rate: 1.27, fetched_at: fetched }, now)).toBe(false);
  });

  it('false for invalid fetched_at', () => {
    expect(isFresh({ rate: 1.27, fetched_at: 'bogus' }, now)).toBe(false);
  });
});

describe('resolvedFxRates', () => {
  const cache: FxCache = {
    GBP_USD: { rate: 1.27, fetched_at: new Date().toISOString() },
    EUR_USD: { rate: 1.05, fetched_at: new Date().toISOString() },
  };

  it('manual overrides cache', () => {
    const resolved = resolvedFxRates(['GBP', 'EUR'], 'USD', { GBP: 1.3 }, cache);
    expect(resolved).toEqual({ GBP: 1.3, EUR: 1.05 });
  });

  it('drops identity pair', () => {
    const resolved = resolvedFxRates(['USD', 'GBP'], 'USD', {}, cache);
    expect(resolved).toEqual({ GBP: 1.27 });
  });

  it('skips currencies without cache or manual', () => {
    const resolved = resolvedFxRates(['JPY'], 'USD', {}, cache);
    expect(resolved).toEqual({});
  });

  it('ignores non-positive manual rates', () => {
    const resolved = resolvedFxRates(['GBP'], 'USD', { GBP: 0 }, cache);
    expect(resolved).toEqual({ GBP: 1.27 });
  });
});

describe('fetchFxRate + refreshStaleFxRates', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('parses the rate from Frankfurter response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rates: { USD: 1.2724 } }),
    });
    const rate = await fetchFxRate('GBP', 'USD');
    expect(rate).toBeCloseTo(1.2724, 6);
  });

  it('throws on non-ok HTTP status', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(fetchFxRate('GBP', 'USD')).rejects.toThrow(/500/);
  });

  it('refreshStaleFxRates skips fresh entries', async () => {
    const now = new Date();
    const cache: FxCache = {
      GBP_USD: { rate: 1.27, fetched_at: now.toISOString() },
    };
    const { updated, failed } = await refreshStaleFxRates(['GBP'], 'USD', cache, now);
    expect(updated).toEqual([]);
    expect(failed).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refreshStaleFxRates fetches missing entries and preserves old cache on failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ rates: { USD: 1.3 } }) })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    const now = new Date();
    const { cache, updated, failed } = await refreshStaleFxRates(['GBP', 'EUR'], 'USD', {}, now);
    expect(updated).toContain('GBP');
    expect(failed).toContain('EUR');
    expect(cache.GBP_USD?.rate).toBe(1.3);
    expect(cache.EUR_USD).toBeUndefined();
  });
});
