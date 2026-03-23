# Prolific Pulse

Browser extension for real-time Prolific study monitoring. Works on both Firefox and Chrome. Syncs study activity to the local backend service.

## What It Does

- Intercepts Prolific API responses (studies and submissions) and forwards them to the Go backend over WebSocket.
- Captures the OIDC token from the Prolific tab for authenticated API requests.
- Provides a popup dashboard with live studies, activity feed, submissions, and settings.
- Alerts you with sound and auto-opens studies matching your priority filter.
- Re-alerts when a study you tried to take was full but later reopens with new places.

## Install

**Firefox:**

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `manifest.json` in this folder

Or build and install the XPI:
```bash
../build-xpi.sh   # produces ../dist/prolific-pulse-<version>.xpi
```

**Chrome:**

1. Open `chrome://extensions`
2. Enable Developer mode (top right)
3. Click `Load unpacked` and select this folder
4. Or drag `../dist/prolific-pulse-<version>-chrome.zip` (from `../build-xpi.sh`) onto the page

## Use

- Keep the backend app running (`go run .` from the project root).
- Stay logged into Prolific in your browser.
- Open the extension popup to view live studies, activity feed, and submissions.
