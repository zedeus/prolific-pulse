# Prolific Pulse

Real-time Prolific study monitoring. A Go backend and browser extension work together to:

- Cache live studies and track availability changes
- Record recent availability events (appeared / disappeared)
- Track submission state across studies
- Alert you with sound and auto-open when high-value studies appear

## Architecture

- **Go server** (`*.go`) -- HTTP/WebSocket server on `:8080` with SQLite storage.
- **Browser extension** (`extension/`) -- Works on both Firefox and Chrome. Intercepts Prolific API responses and forwards them to the server.
- **Tests** (`tests-wdio/`) -- WebdriverIO integration tests for both browsers.

## Setup

1. Start backend:

```bash
go run .
```

2. Load extension:

   **Firefox:**
   - Open `about:debugging#/runtime/this-firefox`
   - Click `Load Temporary Add-on...`
   - Select `extension/manifest.json`

   Or build and install the XPI:
   ```bash
   ./build-xpi.sh          # produces dist/prolific-pulse-<version>.xpi
   ```

   **Chrome:**
   - Open `chrome://extensions`
   - Enable Developer mode (top right)
   - Click `Load unpacked` and select `extension/`
   - Or drag `dist/prolific-pulse-<version>-chrome.zip` (from `./build-xpi.sh`) onto the page

3. Open Prolific and stay logged in.
4. Open the extension popup.

## Daily Use

- Keep the backend running.
- Keep your browser open with Prolific logged in.
- Open the popup to monitor studies, feed activity, and submissions.
- Configure the priority filter in settings to get alerts for studies matching your criteria.
- If a study you tried to take was full but later reopens, you'll get a fresh alert automatically.

## Troubleshooting

- If popup data stops updating, confirm the backend is running on `http://localhost:8080`.
- Firefox: reload the extension from `about:debugging`.
- Chrome: reload from `chrome://extensions`.
- Re-open a Prolific tab, then reopen the popup.
