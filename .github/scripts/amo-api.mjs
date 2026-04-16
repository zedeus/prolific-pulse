// Shared AMO API helpers: JWT auth, fetch wrapper, file download.

import crypto from 'node:crypto';
import fs from 'node:fs';

export const API = 'https://addons.mozilla.org/api/v5';

export function requireCredentials() {
  const { AMO_JWT_ISSUER, AMO_JWT_SECRET } = process.env;
  if (!AMO_JWT_ISSUER || !AMO_JWT_SECRET) {
    console.error('Missing AMO_JWT_ISSUER or AMO_JWT_SECRET');
    process.exit(1);
  }
  return { AMO_JWT_ISSUER, AMO_JWT_SECRET };
}

// AMO requires a unique jti per request, so JWTs are minted per call.
export function makeJWT() {
  const { AMO_JWT_ISSUER, AMO_JWT_SECRET } = process.env;
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

export async function api(urlPath, { method = 'GET' } = {}) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: { Authorization: `JWT ${makeJWT()}` },
  });
  let data = null;
  if (res.ok) {
    data = await res.json().catch(() => null);
  } else if (res.status !== 204) {
    data = await res.text();
  }
  return { status: res.status, ok: res.ok, data };
}

export async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { Authorization: `JWT ${makeJWT()}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}
