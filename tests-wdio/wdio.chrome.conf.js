import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { SHARED_SPECS, SHARED_CONFIG, sharedBefore, sharedAfter } from './helpers/shared-setup.js';
import {
  prepareChromeExtensionDir,
  loadCookiesForChrome,
  CHROME_EXTENSION_DIR,
} from './helpers/chrome-extension.js';

const headless = process.env.HEADLESS === '1';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CHROME_PROFILE_DIR = path.join(__dirname, '..', 'tests', 'profiles', 'prolific-chrome');

function findChromeBinary() {
  if (process.env.CHROME_BINARY) return process.env.CHROME_BINARY;
  try {
    const found = execSync(`ls -1 ${process.env.HOME}/tmp/prolific-pulse/cft/chrome/*/chrome-linux64/chrome /tmp/cft/chrome/*/chrome-linux64/chrome 2>/dev/null | tail -1`)
      .toString().trim();
    if (found) return found;
  } catch { /* not found */ }
  return '/usr/bin/google-chrome-stable';
}

prepareChromeExtensionDir();
fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });

export const config = {
  ...SHARED_CONFIG,
  specs: SHARED_SPECS,

  capabilities: [{
    browserName: 'chrome',
    'goog:chromeOptions': {
      binary: findChromeBinary(),
      args: [
        `--load-extension=${CHROME_EXTENSION_DIR}`,
        `--user-data-dir=${CHROME_PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-search-engine-choice-screen',
        ...(headless ? ['--headless=new'] : []),
      ],
      excludeSwitches: ['disable-extensions'],
    },
  }],

  async before() {
    await sharedBefore({
      async beforeLogin() {
        const injected = await loadCookiesForChrome(browser);
        if (injected > 0) {
          console.log(`Injected ${injected} session cookies.`);
        }
      },
    });
  },

  after: sharedAfter,
};
