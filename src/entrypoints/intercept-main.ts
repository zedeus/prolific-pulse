export default defineUnlistedScript(() => {
  const MSG_TYPE = '__prolific_pulse_intercept__';

  const INTERCEPT_PATTERNS = [
    { pattern: /^https:\/\/internal-api\.prolific\.com\/api\/v1\/participant\/studies\//, subtype: 'studies' },
    { pattern: /^https:\/\/internal-api\.prolific\.com\/api\/v1\/participant\/submissions\//, subtype: 'participant_submissions' },
    { pattern: /^https:\/\/internal-api\.prolific\.com\/api\/v1\/submissions\/reserve\//, subtype: 'submission' },
    { pattern: /^https:\/\/internal-api\.prolific\.com\/api\/v1\/submissions\/[^/]+\/transition\//, subtype: 'submission' },
    { pattern: /^https:\/\/auth\.prolific\.com\/oauth\/token/, subtype: 'oauth_token' },
  ];

  function matchURL(url: string): { pattern: RegExp; subtype: string } | null {
    if (!url) return null;
    return INTERCEPT_PATTERNS.find((p) => p.pattern.test(url)) || null;
  }

  function relay(subtype: string, url: string, status: number, body: unknown): void {
    try {
      window.postMessage({ type: MSG_TYPE, subtype, url, status, body, observed_at: new Date().toISOString() }, '*');
    } catch {
      // Silent — never interfere with page behavior.
    }
  }

  function tryParseJSON(value: unknown): unknown {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value) return null;
    try { return JSON.parse(value); } catch { return null; }
  }

  const originalFetch = window.fetch;
  window.fetch = function (this: typeof globalThis, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const result = originalFetch.call(this, input, init);
    // Skip if the extension's own fetchStudiesInTab is active
    if ((window as any).__pp_ext_fetch) return result;
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input && typeof input === 'object' && 'url' in input
              ? input.url
              : '';
      const match = matchURL(url);
      if (match) {
        result
          .then((response) => {
            try {
              response
                .clone()
                .json()
                .then((body: unknown) => relay(match.subtype, url, response.status, body))
                .catch(() => {});
            } catch {}
          })
          .catch(() => {});
      }
    } catch {}
    return result;
  };

  const XHROpen = XMLHttpRequest.prototype.open;
  const XHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (this: any, ...args: any[]) {
    this.__pp_url = typeof args[1] === 'string' ? args[1] : String(args[1] || '');
    this.__pp_match = matchURL(this.__pp_url);
    return XHROpen.apply(this, args as any);
  };

  XMLHttpRequest.prototype.send = function (this: any, ...args: any[]) {
    if (this.__pp_match) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const xhr = this;
      const match = this.__pp_match;
      const url = this.__pp_url;
      xhr.addEventListener('load', function () {
        try {
          const body = tryParseJSON(xhr.response);
          if (body) relay(match.subtype, url, xhr.status, body);
        } catch {}
      });
    }
    return XHRSend.apply(this, args as any);
  };
});
