// Signs a Firefox extension via AMO, or downloads an already-signed version.
// Usage: node amo-sign.mjs <source-dir> <output-xpi-path>
// Env: AMO_JWT_ISSUER, AMO_JWT_SECRET

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { api, downloadFile, requireCredentials } from './amo-api.mjs';

const [sourceDir, outputPath] = process.argv.slice(2);
if (!sourceDir || !outputPath) {
  console.error('Usage: node amo-sign.mjs <source-dir> <output-xpi-path>');
  process.exit(1);
}

requireCredentials();
const { AMO_JWT_ISSUER, AMO_JWT_SECRET } = process.env;

const manifest = JSON.parse(
  fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'),
);
const addonId = manifest.browser_specific_settings?.gecko?.id;
const version = manifest.version;
if (!addonId || !version) {
  console.error('Could not read addon ID or version from manifest.json');
  process.exit(1);
}

async function pollForSigned() {
  const urlPath = `/addons/addon/${encodeURIComponent(addonId)}/versions/${version}/`;
  const maxPolls = parseInt(process.env.AMO_POLL_MAX || '120', 10); // 120 * 15s = 30min default
  console.log(`Polling AMO for ${addonId} v${version} (max ${maxPolls * 15}s)...`);

  for (let i = 0; i < maxPolls; i++) {
    const { status, ok, data } = await api(urlPath);
    if (status === 404) {
      return false; // version not on AMO yet
    }
    if (!ok) {
      throw new Error(`AMO API ${status}: ${data}`);
    }
    const fileUrl = data?.file?.url;
    const fileStatus = data?.file?.status;
    if (fileUrl && fileStatus === 'public') {
      console.log('Signed XPI available, downloading...');
      await downloadFile(fileUrl, outputPath);
      return true;
    }
    console.log(`  Status: ${fileStatus || 'pending'}, waiting 15s...`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(`Timed out waiting for AMO signing (${maxPolls * 15}s)`);
}

async function main() {
  const alreadySigned = await pollForSigned();
  if (alreadySigned) {
    console.log(`Signed XPI saved to ${outputPath}`);
    return;
  }

  console.log('Version not found on AMO, submitting via web-ext sign...');
  const tmpDir = fs.mkdtempSync('/tmp/amo-sign-');
  try {
    execSync(
      `npx web-ext sign` +
      ` --source-dir ${sourceDir}` +
      ` --api-key "${AMO_JWT_ISSUER}"` +
      ` --api-secret "${AMO_JWT_SECRET}"` +
      ` --channel unlisted` +
      ` --artifacts-dir ${tmpDir}` +
      ` --approval-timeout 0`,
      { stdio: 'inherit' },
    );
  } catch {
    // web-ext exits non-zero with --approval-timeout 0; expected.
  }

  const signed = await pollForSigned();
  if (!signed) {
    throw new Error('Failed to sign extension');
  }
  console.log(`Signed XPI saved to ${outputPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
