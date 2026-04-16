// Checks the status of all versions for the addon on AMO.
// Usage: AMO_JWT_ISSUER=... AMO_JWT_SECRET=... node amo-check-status.mjs
// Optional: ADDON_ID=... to override the default addon ID

import crypto from 'node:crypto';

const { AMO_JWT_ISSUER, AMO_JWT_SECRET } = process.env;
if (!AMO_JWT_ISSUER || !AMO_JWT_SECRET) {
  console.error('Missing AMO_JWT_ISSUER or AMO_JWT_SECRET');
  process.exit(1);
}

const ADDON_ID = process.env.ADDON_ID || 'prolific-pulse@prolific-pulse';
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
  return { status: res.status, data: res.ok ? await res.json() : await res.text() };
}

async function main() {
  console.log(`Checking AMO status for addon: ${ADDON_ID}\n`);

  // Check addon info
  const addon = await api(`/addons/addon/${encodeURIComponent(ADDON_ID)}/`);
  if (addon.status === 404) {
    console.log('Addon not found on AMO. It may not have been created yet.');
    return;
  }
  if (addon.status !== 200) {
    console.error(`Addon lookup failed (${addon.status}):`, addon.data);
    return;
  }

  console.log(`Addon: ${addon.data.name?.en_US || addon.data.slug || ADDON_ID}`);
  console.log(`Status: ${addon.data.status}`);
  console.log(`URL: ${addon.data.url || 'N/A'}`);
  console.log();

  // List versions
  const versions = await api(`/addons/addon/${encodeURIComponent(ADDON_ID)}/versions/`);
  if (versions.status !== 200) {
    console.error(`Versions lookup failed (${versions.status}):`, versions.data);
    return;
  }

  const results = versions.data.results || [];
  if (results.length === 0) {
    console.log('No versions found.');
    return;
  }

  console.log(`Found ${results.length} version(s):\n`);
  for (const v of results) {
    const file = v.file || {};
    console.log(`  v${v.version}`);
    console.log(`    Channel:  ${v.channel}`);
    console.log(`    Status:   ${file.status || 'unknown'}`);
    console.log(`    Created:  ${file.created || v.create_date || 'unknown'}`);
    console.log(`    Reviewed: ${v.reviewed || 'not yet'}`);
    console.log(`    File URL: ${file.url || 'none'}`);
    if (v.validation_url_json) {
      console.log(`    Validation: ${v.validation_url_json}`);
    }
    console.log();
  }

  // Summary
  const signed = results.filter(v => v.file?.status === 'public');
  const unreviewed = results.filter(v => v.file?.status === 'unreviewed');
  const disabled = results.filter(v => v.file?.status === 'disabled');

  console.log('--- Summary ---');
  console.log(`Signed (public): ${signed.length} — ${signed.map(v => v.version).join(', ') || 'none'}`);
  console.log(`Unreviewed:      ${unreviewed.length} — ${unreviewed.map(v => v.version).join(', ') || 'none'}`);
  console.log(`Disabled:        ${disabled.length} — ${disabled.map(v => v.version).join(', ') || 'none'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
