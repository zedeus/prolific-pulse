/**
 * Shared test setup used by both Firefox and Chrome WDIO configs.
 *
 * Each browser config provides capabilities and an optional
 * `installExtension` callback. Everything else — Go server lifecycle,
 * popup URL discovery, login, token sync — is identical.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROLIFIC_STUDIES_URL, GO_SERVER_URL, WXT_SRC_DIR } from './constants.js';
import { GoServerManager } from './go-server.js';
import { isLoggedIn, automatedLogin } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const headless = process.env.HEADLESS === '1';
const skipSlow = process.env.SKIP_SLOW === '1';
const loginTimeout = 300_000;
const loginPollInterval = 3_000;

export const SHARED_SPECS = [[
  './specs/01-server-health.js',
  './specs/02-popup-display.js',
  './specs/03-popup-tabs.js',
  './specs/04-server-reconnect.js',
  './specs/05-settings.js',
  './specs/06-studies-intercept.js',
  './specs/07-debug-state.js',
]];

export const SHARED_CONFIG = {
  runner: 'local',
  maxInstances: 1,
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: skipSlow ? 120_000 : 180_000,
    ...(skipSlow ? { grep: /^(?!.*@slow)/ } : {}),
  },
};

/**
 * Discover the extension popup URL by polling the Go server's debug state.
 * Works for both Firefox (moz-extension://) and Chrome (chrome-extension://).
 */
async function discoverPopupUrl(timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${GO_SERVER_URL}/debug/extension-state`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.has_state && data.state?.extension_url) {
          return `${data.state.extension_url.replace(/\/$/, '')}/popup.html`;
        }
      }
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Extension did not report state within ${timeout}ms.`);
}

/**
 * Shared before hook.
 *
 * @param {object} opts
 * @param {() => Promise<void>} [opts.installExtension]
 *   Browser-specific extension installation (e.g. Firefox installAddOn).
 *   Omit if the extension is loaded via capabilities (Chrome).
 * @param {() => Promise<void>} [opts.beforeLogin]
 *   Runs after extension connects but before the login check.
 *   Used by Chrome to inject session cookies from the Firefox profile.
 */
export async function sharedBefore(opts = {}) {
  // Clean stale database so timestamps are fresh for this run.
  for (const f of ['prolific_pulse.db', 'prolific_pulse.db-shm', 'prolific_pulse.db-wal']) {
    try { fs.rmSync(path.join(PROJECT_ROOT, f)); } catch { /* ok */ }
  }

  // Build extension with WXT for both browsers.
  const browserName = browser.capabilities?.browserName || 'firefox';
  const wxtTarget = browserName === 'chrome' ? 'chrome' : 'firefox';
  console.log(`Building extension with WXT for ${wxtTarget}...`);
  execSync(`npx wxt build -b ${wxtTarget}`, { cwd: WXT_SRC_DIR, stdio: 'inherit' });
  console.log('Extension built.');

  // Build and start Go server.
  const goServer = new GoServerManager();
  console.log('Building Go server...');
  goServer.build();
  console.log('Starting Go server...');
  goServer.start();
  await goServer.waitHealthy();
  console.log('Go server is healthy.');
  browser.goServer = goServer;

  // Browser-specific extension installation (Firefox).
  if (opts.installExtension) {
    await opts.installExtension();
  }

  // Discover popup URL from the Go server's debug state endpoint.
  // Works identically for both browsers.
  console.log('Waiting for extension to connect...');
  const popupUrl = await discoverPopupUrl();
  browser.popupUrl = popupUrl;
  console.log(`Extension connected. Popup: ${popupUrl}`);

  // Browser-specific pre-login hook (Chrome cookie injection).
  if (opts.beforeLogin) {
    await opts.beforeLogin();
  }

  // Handle login.
  if (!(await isLoggedIn())) {
    if (headless) {
      const browser_ = browser.capabilities?.browserName || 'browser';
      const hint = browser_ === 'chrome'
        ? 'Run: cd tests-wdio && .venv/bin/python setup-login-chrome.py'
        : 'Run: cd tests-wdio && node setup-login.js';
      throw new Error(
        `Not logged in to Prolific (session cookies expired?).\n${hint}`,
      );
    }
    console.log('Not logged in. Attempting automated login...');
    if (!(await automatedLogin())) {
      console.log(
        `Automated login failed. Please log in manually.\n` +
        `Waiting up to ${loginTimeout / 1000}s for login...`,
      );
      const deadline = Date.now() + loginTimeout;
      let loggedIn = false;
      while (Date.now() < deadline) {
        await browser.pause(loginPollInterval);
        if (await isLoggedIn()) { loggedIn = true; break; }
      }
      if (!loggedIn) throw new Error('Login timed out after 5 minutes');
    }
    console.log('Logged in to Prolific successfully.');
  }

  // Navigate to studies to trigger token interception.
  await browser.url(PROLIFIC_STUDIES_URL);
  await browser.pause(5000);
  console.log('Prolific studies page loaded for token sync.');

  // Verify token sync by checking popup status dot.
  const syncDeadline = Date.now() + 20_000;
  let synced = false;
  while (Date.now() < syncDeadline) {
    try {
      await browser.url(popupUrl);
      await (await $('#syncDot')).waitForDisplayed({ timeout: 3000 });
      const dotBad = await browser.execute(() => {
        const dot = document.getElementById('syncDot');
        return dot ? dot.classList.contains('bad') : true;
      });
      if (!dotBad) { synced = true; break; }
    } catch { /* retry */ }
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(3000);
  }
  if (synced) {
    console.log('Extension token sync verified.');
  } else {
    console.log('WARNING: Token sync not confirmed within 20s.');
  }
}

export async function sharedAfter() {
  if (browser.goServer) {
    await browser.goServer.stop();
    console.log('Go server stopped.');
  }
}
