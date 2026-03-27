# Prolific Pulse

Real-time Prolific study monitoring browser extension (Firefox & Chrome).

- Cache live studies and track availability changes
- Record recent availability events (appeared / disappeared)
- Track submission state across studies
- Alert you with sound and auto-open when high-value studies appear
- Send Telegram notifications when matching studies appear

All data is stored locally in the browser using IndexedDB. No external server required.

## Installation

Download the latest release for your browser from the [Releases page](https://github.com/zedeus/prolific-pulse/releases/latest).

### Chrome

1. Download `prolific-pulse-extension-...-chrome.zip` from the latest release.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** using the toggle at the top right.
4. Drag the downloaded `.zip` file onto the extensions page.

### Firefox

This extension is not signed by Mozilla, so it cannot be permanently installed on regular Firefox. Use one of these options:

**Option A — Temporary install (any Firefox, resets on restart):**

1. Download `prolific-pulse-extension-...-firefox.zip` from the latest release.
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select the downloaded `.zip` file.
4. The extension will be removed when Firefox is closed. Repeat these steps after each restart.

**Option B — Permanent install (Developer Edition or Nightly only):**

1. Open Firefox Developer Edition or Nightly and go to `about:config`.
2. Search for `xpinstall.signatures.required` and set it to `false`.
3. Download `prolific-pulse-extension-...-firefox.zip` from the latest release.
4. Go to `about:addons`, click the gear icon (⚙) and select **Install Add-on From File...**.
5. Select the downloaded `.zip` file.

### After installing

1. Open [Prolific](https://app.prolific.com) and make sure you are logged in.
2. Click the Prolific Pulse extension icon in the toolbar to open the popup.

## Daily Use

- Keep your browser open with Prolific logged in.
- Open the popup to monitor studies, feed activity, and submissions.
- Configure priority filters in settings to get alerts for studies matching your criteria.
- If a study you tried to take was full but later reopens, you'll get a fresh alert automatically.

### Telegram Notifications

Get notified on your phone when studies appear:

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram.
2. Message [@userinfobot](https://t.me/userinfobot) to get your chat ID.
3. Open extension settings, expand Telegram, paste your bot token and chat ID.
4. Click "Send test message" to verify.

Options: per-filter notifications, notify for all studies, silent mode, and configurable message format (reward, hourly rate, duration, places, researcher, description, study link).

## Troubleshooting

- If popup data stops updating, reload the Prolific tab.
- Firefox (temporary install): reload the extension from `about:debugging#/runtime/this-firefox`.
- Chrome: reload from `chrome://extensions`.
