# Prolific Pulse

Browser extension (Firefox & Chrome) that monitors Prolific study availability in real-time. All data storage and processing happens locally in the extension using IndexedDB (via Dexie.js).

## Architecture

- **Browser extension** (`src/`): WXT + Svelte 5 + TypeScript + Tailwind v4 + DaisyUI 5. MV3 for Chrome, MV2 for Firefox (auto-converted by WXT).
- **Popup**: Svelte 5 components with DaisyUI styling. Tabs: live studies, feed, submissions, settings, diagnostics.
- **Data storage**: IndexedDB via Dexie.js. Stores studies, submissions, availability events, and refresh state locally in the browser.

### Browser-specific paths
- **Firefox**: Uses `webRequest.filterResponseData()` for passive API response interception. Background runs as an event page. Audio via direct `AudioContext`. Guarded by `import.meta.env.FIREFOX`.
- **Chrome**: Uses MAIN-world content scripts (`intercept-main.ts` injected via `injectScript()`) to monkeypatch `fetch()`. Background runs as a service worker. Audio via `chrome.offscreen` API (`offscreen/`). Guarded by `import.meta.env.CHROME`.
- **Shared**: Priority filter engine, popup UI, all background modules, TypeScript types.

### Extension source structure (`src/`)
```
src/
  entrypoints/
    background/          # Background script + modules (domain, state, actions, settings, ingest)
    popup/               # Svelte 5 popup (App.svelte + components/)
    offscreen/           # Chrome audio offscreen document
    intercept.content.ts # Chrome content script (ISOLATED world, injects intercept-main)
    intercept-main.ts    # Chrome unlisted script (MAIN world, patches fetch/XHR)
  lib/
    db.ts                # Dexie.js database schema (6 IndexedDB stores)
    store.ts             # Data access layer (queries, reconciliation, upserts)
    normalize.ts         # Study and submission normalization from Prolific API
    types.ts             # Shared TypeScript interfaces
    constants.ts         # All constants (URLs, timings, defaults, storage keys)
    format.ts            # Shared formatting utilities
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

### Data Flow
1. Content script / webRequest intercepts Prolific API responses
2. Background script receives intercepted data
3. Background normalizes and stores in IndexedDB via `ingest.ts` → `store.ts`
4. Background reconciles study availability (detects new/departed studies)
5. Background runs priority filter, triggers alerts/auto-open for matching studies
6. Popup reads dashboard data directly from IndexedDB (settings writes go through background via runtime messages)

### IndexedDB Schema (Dexie.js)
Defined in `src/lib/db.ts`:
- `studiesLatest` — Current normalized study data (PK: `study_id`)
- `studiesHistory` — Complete observation history for analytics (auto-increment PK, indexed on `study_id`, `observed_at`)
- `studiesActiveSnapshot` — Currently available studies for reconciliation (PK: `study_id`)
- `studyAvailabilityEvents` — Feed of availability changes (auto-increment PK)
- `serviceState` — Singleton refresh metadata (PK: `id`)
- `submissions` — Submission lifecycle tracking with smart merge (PK: `submission_id`)

## Key Patterns

### Extension Storage Keys
- `syncState`: Main state object (token status, debug logs)
- `priorityKnownStudiesState`: Known study IDs with TTL
- Priority filter settings: `priorityFilterMinimumReward`, `priorityFilterMinimumHourlyReward`, etc.
- Refresh timing: `studiesRefreshMinDelaySeconds`, `studiesRefreshAverageDelaySeconds`

### Popup DOM Selectors (used by E2E tests)
- Status: `#syncDot` (`.bad` class = error), `#latestRefresh`, `#errorMessage`
- Tabs: `button[data-tab="live|feed|submissions|settings"]`
- Panels: `#panelLive`, `#panelFeed`, `#panelSubmissions`, `#panelSettings` (`.active` = visible)
- Priority: `#priorityFilterEnabledToggle`, `#priorityMinRewardInput`, `#priorityMinHourlyInput`
- Diagnostics: `details.debug-details`, `#debugGrid`, `#debugLog`

## Building

```bash
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

# All tests (WXT builds automatically, no external server needed)
npx wdio run wdio.conf.js

# Skip slow tests (delayed refresh ~45s)
SKIP_SLOW=1 npx wdio run wdio.conf.js

# Headless mode (requires prior login session)
HEADLESS=1 npx wdio run wdio.conf.js
```

### Extension Loading
The extension has `browser_specific_settings.gecko.id` set to `{fae5de21-ec2a-4a34-92ba-d1d2dc76553e}`.
Tests use WebdriverIO Firefox with a persistent profile at `tests/profiles/prolific/`.
The extension is zipped at runtime from WXT output and installed via `browser.installAddOn()`.
The extension UUID is pre-seeded via `extensions.webextensions.uuids` Firefox preference for deterministic popup URLs.

### Popup Navigation
Firefox: popup URL is deterministic from the pre-seeded UUID.
Chrome: popup URL is discovered via `chrome.runtime.getURL()`.
Tests navigate directly to the popup URL.

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
Spec files are numbered (01-09) to enforce execution order:
- `06-studies-intercept` must run before `07-debug-state` (populates extension state)
- `04-extension-resilience` tests navigation away/back and popup reopen

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
