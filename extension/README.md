# Prolific Pulse

Firefox extension for real-time Prolific study monitoring. Syncs study activity to the local backend service.

## What It Does

- Intercepts Prolific API responses (studies and submissions) and forwards them to the Go backend over WebSocket.
- Captures the OIDC token from the Prolific tab for authenticated in-extension API requests.
- Provides a popup dashboard with live studies, activity feed, submissions, and settings.
- Auto-open of the Prolific tab is configurable from popup settings.

## Install (Firefox)

**Temporary (development):**

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `manifest.json` in this folder

**From XPI:**

1. Run `../build-xpi.sh` to build the signed package
2. Open `about:addons` and install the `.xpi` from `../dist/`

## Use

- Keep the backend app running (`go run .` from the project root).
- Stay logged into Prolific in Firefox.
- Open the extension popup to view live studies, activity feed, and submissions.
