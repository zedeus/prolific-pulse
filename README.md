# Prolific Pulse

Real-time Prolific study monitoring browser extension (Firefox & Chrome).

- Cache live studies and track availability changes
- Record recent availability events (appeared / disappeared)
- Track submission state across studies
- Alert you with sound and auto-open when high-value studies appear

All data is stored locally in the browser using IndexedDB. No external server required.

## Setup

1. Build extension:

```bash
cd src && npm install && npx wxt build -b firefox   # Firefox
cd src && npm install && npx wxt build -b chrome    # Chrome
```

2. Load extension:

   **Firefox:**
   - Open `about:debugging#/runtime/this-firefox`
   - Click `Load Temporary Add-on...`
   - Select any file in `src/.output/firefox-mv2/`

   **Chrome:**
   - Open `chrome://extensions`
   - Enable Developer mode (top right)
   - Click `Load unpacked` and select `src/.output/chrome-mv3/`

3. Open Prolific and stay logged in.
4. Open the extension popup.

## Daily Use

- Keep your browser open with Prolific logged in.
- Open the popup to monitor studies, feed activity, and submissions.
- Configure the priority filter in settings to get alerts for studies matching your criteria.
- If a study you tried to take was full but later reopens, you'll get a fresh alert automatically.

## Troubleshooting

- If popup data stops updating, reload the Prolific tab.
- Firefox: reload the extension from `about:debugging`.
- Chrome: reload from `chrome://extensions`.
