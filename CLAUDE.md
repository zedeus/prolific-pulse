# Prolific Pulse

Go server + browser extension (Firefox & Chrome) that monitors Prolific study availability in real-time.

## Architecture

- **Go server** (`*.go`): HTTP/WS server on `:8080`. Stores studies, submissions, refresh state in SQLite.
- **Browser extension** (`extension/`): MV3 extension (Firefox & Chrome) that intercepts Prolific API responses and forwards them to the Go server via WebSocket.
- **Popup** (`popup.html/popup.js`): Extension popup with live studies, feed, submissions, settings tabs and debug diagnostics.

### Browser-specific paths
- **Firefox**: Uses `webRequest.filterResponseData()` for passive API response interception. Background runs as an event page. Audio via direct `AudioContext`.
- **Chrome**: Uses MAIN-world content scripts (`content-intercept.js` + `content-bridge.js`) to monkeypatch `fetch()` for API response interception. Background runs as a service worker (modules loaded via `importScripts`). Audio via `chrome.offscreen` API (`offscreen.html/offscreen.js`).
- **Shared**: WebSocket protocol, priority filter engine, popup UI, all background modules (`background/*.js`), and the main `background.js` (with browser detection at runtime).

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

### Popup DOM Selectors
- Status: `#syncDot` (`.bad` class = offline), `#latestRefresh`, `#errorMessage`
- Tabs: `button[data-tab="live|feed|submissions|settings"]`
- Panels: `#panelLive`, `#panelFeed`, `#panelSubmissions`, `#panelSettings` (`.active` = visible)
- Priority: `#priorityFilterEnabledToggle`, `#priorityMinRewardInput`, `#priorityMinHourlyInput`
- Diagnostics: `details.debug-details`, `#debugGrid`, `#debugLog`

## Building

```bash
# Go server
go build -o prolific-pulse .

# Extension packages (outputs to dist/)
# Produces both Firefox XPI and Chrome ZIP
./build-xpi.sh
```

## Testing

Tests use **WebdriverIO** (Node.js/Mocha) with geckodriver for Firefox extension testing.
Located in `tests-wdio/`.

### Prerequisites
1. Node.js deps: `cd tests-wdio && npm install`
2. Prolific login session: `cd tests-wdio && node setup-login.js`

### Running Tests
```bash
cd tests-wdio

# All tests (Go server is managed automatically)
npx wdio run wdio.conf.js

# Skip slow tests (delayed refresh ~45s)
SKIP_SLOW=1 npx wdio run wdio.conf.js

# Headless mode (requires prior login session)
HEADLESS=1 npx wdio run wdio.conf.js
```

### Extension Loading
The extension has `browser_specific_settings.gecko.id` set to `prolific-pulse@prolific-pulse`.
Tests use WebdriverIO Firefox with a persistent profile at `tests/profiles/prolific/`.
The extension is zipped at runtime and installed via `browser.installAddOn()`.
The extension UUID is pre-seeded via `extensions.webextensions.uuids` Firefox preference for deterministic popup URLs.

### Popup Navigation
WebdriverIO uses geckodriver (WebDriver protocol) which natively supports `moz-extension://` URLs.
Tests navigate directly to `browser.url('moz-extension://UUID/popup.html')`.

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

## Commit Rules

- **Never** add `Co-Authored-By` trailers to commits.
