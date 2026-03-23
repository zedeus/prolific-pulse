import fs from 'node:fs';
import { FIREFOX_PREFS, PROFILE_DIR } from './helpers/constants.js';
import { zipExtensionBase64 } from './helpers/extension.js';
import { SHARED_SPECS, SHARED_CONFIG, sharedBefore, sharedAfter } from './helpers/shared-setup.js';

const headless = process.env.HEADLESS === '1';
fs.mkdirSync(PROFILE_DIR, { recursive: true });

export const config = {
  ...SHARED_CONFIG,
  specs: SHARED_SPECS,

  capabilities: [{
    browserName: 'firefox',
    'moz:firefoxOptions': {
      args: [
        '-profile', PROFILE_DIR,
        ...(headless ? ['-headless'] : []),
      ],
      prefs: FIREFOX_PREFS,
    },
  }],

  async before() {
    await sharedBefore({
      async installExtension() {
        console.log('Installing extension...');
        const xpiBase64 = await zipExtensionBase64();
        await browser.installAddOn(xpiBase64, true);
        console.log('Extension installed.');
        await browser.pause(3000);
      },
    });
  },

  after: sharedAfter,
};
