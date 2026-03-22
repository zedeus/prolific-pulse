# Prolific Pulse

Real-time Prolific study monitoring. A Go backend and Firefox extension work together to:

- Cache live studies and track availability changes
- Record recent availability events (appeared / disappeared)
- Track submission state across studies

## Architecture

- **Go server** (`*.go`) -- HTTP/WebSocket server on `:8080` with SQLite storage.
- **Browser extension** (`extension/`) -- Firefox MV3 extension that intercepts Prolific API responses and forwards them to the server.
- **Tests** (`tests-wdio/`) -- WebdriverIO integration tests with geckodriver.

## Setup

1. Start backend:

```bash
go run .
```

2. Load extension (pick one):

   **Temporary (development):**
   - Open `about:debugging#/runtime/this-firefox`
   - Click `Load Temporary Add-on...`
   - Select `extension/manifest.json`

   **From XPI:**
   ```bash
   ./build-xpi.sh          # produces dist/prolific-pulse-<version>.xpi
   ```
   Then install the `.xpi` via `about:addons`.

3. Open Prolific and stay logged in.
4. Open the extension popup.

## Daily Use

- Keep the backend running.
- Keep Firefox open with Prolific logged in.
- Open the popup to monitor studies, feed activity, and submissions.

## Troubleshooting

- If popup data stops updating, confirm the backend is running on `http://localhost:8080`.
- Reload the extension from `about:debugging`.
- Re-open a Prolific tab, then reopen the popup.
