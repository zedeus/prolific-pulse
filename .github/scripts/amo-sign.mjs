// Signs a Firefox extension via AMO, or downloads an already-signed version.
// Usage: node amo-sign.mjs <source-dir> <output-xpi-path>
// Env: AMO_JWT_ISSUER, AMO_JWT_SECRET

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const [sourceDir, outputPath] = process.argv.slice(2);
if (!sourceDir || !outputPath) {
  console.error('Usage: node amo-sign.mjs <source-dir> <output-xpi-path>');
  process.exit(1);
}

const { AMO_JWT_ISSUER, AMO_JWT_SECRET } = process.env;
if (!AMO_JWT_ISSUER || !AMO_JWT_SECRET) {
  console.error('Missing AMO_JWT_ISSUER or AMO_JWT_SECRET');
  process.exit(1);
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'),
);
const addonId = manifest.browser_specific_settings?.gecko?.id;
const version = manifest.version;
if (!addonId || !version) {
  console.error('Could not read addon ID or version from manifest.json');
  process.exit(1);
}

const API = 'https://addons.mozilla.org/api/v5';

function makeJWT() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: AMO_JWT_ISSUER,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 300,
  })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', AMO_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function api(urlPath) {
  const res = await fetch(`${API}${urlPath}`, {
    headers: { Authorization: `JWT ${makeJWT()}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`AMO API ${res.status}: ${await res.text()}`);
  }
  return { status: res.status, data: res.status !== 404 ? await res.json() : null };
}

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { Authorization: `JWT ${makeJWT()}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function pollForSigned() {
  const urlPath = `/addons/addon/${encodeURIComponent(addonId)}/versions/${version}/`;
  console.log(`Polling AMO for ${addonId} v${version}...`);

  for (let i = 0; i < 120; i++) {
    const { status, data } = await api(urlPath);
    if (status === 404) {
      return false; // version not on AMO yet
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
  throw new Error('Timed out waiting for AMO signing (30 minutes)');
}

async function main() {
  // Check if already signed on AMO
  const alreadySigned = await pollForSigned();
  if (alreadySigned) {
    console.log(`Signed XPI saved to ${outputPath}`);
    return;
  }

  // Not on AMO yet — submit via web-ext sign
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
    // web-ext may exit non-zero if approval-timeout is 0 — that's expected
  }

  // Now poll for the signed file
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
