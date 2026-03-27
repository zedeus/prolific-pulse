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

1. Download `prolific-pulse-extension-...-firefox.xpi` from the latest release.
2. Open the downloaded `.xpi` file with Firefox (or drag it onto a Firefox window).
3. Click **Add** when prompted.

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
- Firefox: reload the extension from `about:addons`.
- Chrome: reload from `chrome://extensions`.
