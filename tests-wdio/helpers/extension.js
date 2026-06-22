import archiver from 'archiver';
import { EXTENSION_DIR, WXT_SRC_DIR } from './constants.js';
import path from 'node:path';

const EXTENSION_DIR_DEV = path.join(WXT_SRC_DIR, '.output', 'firefox-mv2-dev');

function zipDir(dir) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 1 } });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve(buf.toString('base64'));
    });
    archive.on('error', reject);

    archive.directory(dir, false);
    archive.finalize();
  });
}

/**
 * Zip the production extension directory and return it as a base64 string
 * for use with browser.installAddOn().
 */
export async function zipExtensionBase64() {
  return zipDir(EXTENSION_DIR);
}

/**
 * Zip the dev extension directory (includes __ppDev helpers).
 */
export async function zipExtensionBase64Dev() {
  return zipDir(EXTENSION_DIR_DEV);
}
