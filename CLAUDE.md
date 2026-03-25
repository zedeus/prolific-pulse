# Prolific Pulse

Go server + browser extension (Firefox & Chrome) that monitors Prolific study availability in real-time.

## Architecture

- **Go server** (`*.go`): HTTP/WS server on `:8080`. Stores studies, submissions, refresh state in SQLite.
- **Browser extension** (`src/`): WXT + Svelte 5 + TypeScript + Tailwind v4 + DaisyUI 5. MV3 for Chrome, MV2 for Firefox (auto-converted by WXT).
- **Popup**: Svelte 5 components with DaisyUI styling. Tabs: live studies, feed, submissions, settings, diagnostics.
- **Old extension** (`extension/`): Legacy vanilla JS version. Kept for reference during migration. Will be removed.

### Browser-specific paths
- **Firefox**: Uses `webRequest.filterResponseData()` for passive API response interception. Background runs as an event page. Audio via direct `AudioContext`. Guarded by `import.meta.env.FIREFOX`.
- **Chrome**: Uses MAIN-world content scripts (`intercept-main.ts` injected via `injectScript()`) to monkeypatch `fetch()`. Background runs as a service worker. Audio via `chrome.offscreen` API (`offscreen/`). Guarded by `import.meta.env.CHROME`.
- **Shared**: WebSocket protocol, priority filter engine, popup UI, all background modules, TypeScript types.

### Extension source structure (`src/`)
```
src/
  entrypoints/
    background/          # Background script + modules (domain, state, actions, settings, adapters)
    popup/               # Svelte 5 popup (App.svelte + components/)
    offscreen/           # Chrome audio offscreen document
    intercept.content.ts # Chrome content script (ISOLATED world, injects intercept-main)
    intercept-main.ts    # Chrome unlisted script (MAIN world, patches fetch/XHR)
  lib/
    types.ts             # Shared TypeScript interfaces
    constants.ts         # All constants (URLs, timings, defaults, storage keys)
    format.ts            # Shared formatting utilities
    services.ts          # comctx RPC service definitions (planned integration)
    adapters.ts          # comctx transport adapters (planned integration)
    firefox.d.ts         # Firefox-only API type declarations
  assets/
    app.css              # Tailwind v4 + DaisyUI 5 entry
    sounds/              # Alert sounds (base64 encoded)
  public/
    icons/               # Extension icons
  wxt.config.ts          # WXT configuration (manifest, vite, modules)
  package.json
  tsconfig.json
```

## Key Patterns

### WebSocket Protocol
- Extension sends typed messages (`receive-studies-refresh`, `receive-studies-response`, `report-debug-state`, etc.)
- Server responds with `ack` messages (`{type: "ack", ok: true/false}`)
- Server broadcasts `studies_refresh_event` to all connected clients
- Extension sends heartbeat every 10s, times out at 15s (heartbeat is client-side, not server-side)

### Extension Storage Keys
- `syncState`: Main state object (WS status, token status, debug logs)
- `priorityKnownStudiesState`: Known study IDs with TTL
- Priority filter settings: `priorityFilterMinimumReward`, `priorityFilterMinimumHourlyReward`, etc.
- Refresh timing: `studiesRefreshMinDelaySeconds`, `studiesRefreshAverageDelaySeconds`

### Popup DOM Selectors (used by E2E tests)
- Status: `#syncDot` (`.bad` class = offline), `#latestRefresh`, `#errorMessage`
- Tabs: `button[data-tab="live|feed|submissions|settings"]`
- Panels: `#panelLive`, `#panelFeed`, `#panelSubmissions`, `#panelSettings` (`.active` = visible)
- Priority: `#priorityFilterEnabledToggle`, `#priorityMinRewardInput`, `#priorityMinHourlyInput`
- Diagnostics: `details.debug-details`, `#debugGrid`, `#debugLog`

## Building

```bash
# Go server
go build -o prolific-pulse .

# Extension (WXT builds for both browsers)
cd src && npm run build          # Both browsers
cd src && npx wxt build -b chrome   # Chrome only
cd src && npx wxt build -b firefox  # Firefox only

# ZIP packages for store submission
cd src && npx wxt zip -b chrome
cd src && npx wxt zip -b firefox
```

Build output: `src/.output/chrome-mv3/` and `src/.output/firefox-mv2/`

## Testing

Tests use **WebdriverIO** (Node.js/Mocha) with geckodriver for Firefox extension testing.
Located in `tests-wdio/`. The WXT extension is built automatically before each test run.

### Prerequisites
1. Extension deps: `cd src && npm install`
2. Test deps: `cd tests-wdio && npm install`
3. Prolific login session: `cd tests-wdio && node setup-login.js`

### Running Tests
```bash
cd tests-wdio

# All tests (Go server is managed automatically, WXT builds automatically)
npx wdio run wdio.conf.js

# Skip slow tests (delayed refresh ~45s)
SKIP_SLOW=1 npx wdio run wdio.conf.js

# Headless mode (requires prior login session)
HEADLESS=1 npx wdio run wdio.conf.js
```

### Extension Loading
The extension has `browser_specific_settings.gecko.id` set to `prolific-pulse@prolific-pulse`.
Tests use WebdriverIO Firefox with a persistent profile at `tests/profiles/prolific/`.
The extension is zipped at runtime from WXT output and installed via `browser.installAddOn()`.
The extension UUID is pre-seeded via `extensions.webextensions.uuids` Firefox preference for deterministic popup URLs.

### Popup Navigation
Popup URL is discovered dynamically from `GET /debug/extension-state` (works for both browsers).
Tests navigate directly to the discovered URL.

### Debug State Endpoint
`GET /debug/extension-state` returns the latest state reported by the extension over WS.
Response: `{"has_state": true, "received_at": "...", "state": {"extension_url": "...", "sync_state": {...}, "debug_log_count": N}}`
Returns `{"has_state": false}` when no state has been reported yet.
Note: `debug_logs` are excluded from the WS payload to keep message size small; only `debug_log_count` is sent.

### Chrome Test Prerequisites
1. Chrome for Testing: `npx @puppeteer/browsers install chrome@stable --path ~/tmp/prolific-pulse/cft`
2. Python venv: `cd tests-wdio && uv venv .venv && .venv/bin/pip install nodriver`
3. Login session: `cd tests-wdio && .venv/bin/python setup-login-chrome.py`

### Running Tests
```bash
cd tests-wdio
npm run test:all:fast   # Both browsers, skip slow (headless)
npm run test:fast       # Firefox only
npm run test:chrome:fast # Chrome only
```

### Test Ordering
Spec files are numbered (01-07) to enforce execution order:
- `06-studies-intercept` must run before `07-debug-state` (populates server state)
- `04-server-reconnect` stops/restarts the Go server (combined into single test)
- SQLite database is cleaned in the `before` hook of each test run

### Svelte 5 Rules
- Use `$state()`, `$derived()`, `$effect()`, `$props()` (runes only)
- Use `onclick={handler}` NOT `on:click={handler}`
- Use `let { prop } = $props()` NOT `export let prop`
- Use `{@render children()}` NOT `<slot/>`

### DaisyUI 5 Rules
- `tabs-border` NOT `tabs-bordered`
- `card-border` NOT `card-bordered`
- `card-sm` NOT `card-compact`
- Inputs have borders by default — do NOT use `input-bordered`

## Commit Rules

- **Never** add `Co-Authored-By` trailers to commits.
