// Checks the status of all versions for the addon on AMO.
// Usage: AMO_JWT_ISSUER=... AMO_JWT_SECRET=... node amo-check-status.mjs
// Optional env: ADDON_ID, CHECK_VERSIONS (comma-separated), DELETE_VERSION, VERBOSE

import { api, requireCredentials } from './amo-api.mjs';

requireCredentials();

const ADDON_ID = process.env.ADDON_ID || '{fae5de21-ec2a-4a34-92ba-d1d2dc76553e}';
const encodedId = encodeURIComponent(ADDON_ID);

async function main() {
  console.log(`Checking AMO status for addon: ${ADDON_ID}\n`);

  const [addon, versions] = await Promise.all([
    api(`/addons/addon/${encodedId}/`),
    api(`/addons/addon/${encodedId}/versions/?filter=all_with_unlisted`),
  ]);

  if (addon.status === 404) {
    console.log('Addon not found on AMO. It may not have been created yet.');
    return;
  }
  if (!addon.ok) {
    console.error(`Addon lookup failed (${addon.status}):`, addon.data);
    return;
  }

  console.log(`Addon: ${addon.data.name?.en_US || addon.data.slug || ADDON_ID}`);
  console.log(`Status: ${addon.data.status}`);
  console.log(`URL: ${addon.data.url || 'N/A'}`);
  console.log();

  if (!versions.ok) {
    console.error(`Versions lookup failed (${versions.status}):`, versions.data);
    return;
  }

  const results = versions.data.results || [];

  // Unlisted versions may be hidden from the list endpoint — fetch each named one directly.
  const knownVersions = (process.env.CHECK_VERSIONS?.split(',') ?? [])
    .map((v) => v.trim())
    .filter((v) => v && !results.some((r) => r.version === v));
  const direct = await Promise.all(
    knownVersions.map(async (version) => ({
      version,
      res: await api(`/addons/addon/${encodedId}/versions/${version}/`),
    })),
  );
  for (const { version, res } of direct) {
    if (res.ok) {
      console.log(`(Found unlisted version ${version} via direct query)`);
      results.push(res.data);
    }
  }

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

  const byStatus = { public: [], unreviewed: [], disabled: [], other: [] };
  for (const v of results) {
    const bucket = byStatus[v.file?.status] ?? byStatus.other;
    bucket.push(v.version);
  }
  console.log('--- Summary ---');
  console.log(`Signed (public): ${byStatus.public.length} — ${byStatus.public.join(', ') || 'none'}`);
  console.log(`Unreviewed:      ${byStatus.unreviewed.length} — ${byStatus.unreviewed.join(', ') || 'none'}`);
  console.log(`Disabled:        ${byStatus.disabled.length} — ${byStatus.disabled.join(', ') || 'none'}`);
  if (byStatus.other.length) {
    console.log(`Other:           ${byStatus.other.length} — ${byStatus.other.join(', ')}`);
  }

  const deleteVersion = process.env.DELETE_VERSION;
  if (deleteVersion) {
    console.log(`\nDeleting version ${deleteVersion}...`);
    const { status, data } = await api(
      `/addons/addon/${encodedId}/versions/${deleteVersion}/`,
      { method: 'DELETE' },
    );
    if (status === 204) {
      console.log(`Successfully deleted version ${deleteVersion}`);
    } else {
      console.error(`Delete failed (${status}):`, data);
    }
  }

  if (process.env.VERBOSE) {
    console.log('\n--- Full Version Data ---');
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
