#!/usr/bin/env node
/**
 * Purge the Cloudflare edge cache for a zone after a release.
 *
 * Why this exists: releases must clear, not wait. The public-verify step
 * previously raced cached HTML on the custom domain — the new worker version
 * was at 100% traffic while lupi.live still served the previous build. A
 * post-promotion purge makes the freshly deployed bytes visible immediately.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... node tools/cloudflare-purge-cache.mjs --zone=lupi.live [--everything|--dry-run]
 *
 * Defaults to purging EVERYTHING on the zone — safe for this app because all
 * static assets are content-hashed and immutable (they revalidate by hash;
 * only the HTML documents actually change meaning per release).
 */
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const zoneName = argValue('--zone') ?? argValue('--url')?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const dryRun = args.includes('--dry-run');
const purgeEverything = args.includes('--everything') || !args.includes('--files');

function argValue(flag) {
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

assert.ok(zoneName, 'pass --zone=<zone name or domain>');
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!dryRun) assert.ok(token, 'CLOUDFLARE_API_TOKEN is required');

const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

async function cf(path, init) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const detail = body?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${path} failed: ${detail}`);
  }
  return body.result;
}

if (dryRun) {
  console.log(`[dry-run] would purge ${purgeEverything ? 'EVERYTHING' : 'HTML files'} on zone ${zoneName}`);
  process.exit(0);
}

const zone = (await cf(`/zones?name=${encodeURIComponent(zoneName)}`))?.[0];
assert.ok(zone?.id, `zone not found for ${zoneName}`);

const payload = purgeEverything
  ? { purge_everything: true }
  : { files: [`https://${zoneName}/`] };

const result = await cf(`/zones/${zone.id}/purge_cache`, { method: 'POST', body: JSON.stringify(payload) });
console.log(JSON.stringify({ zone: zoneName, zoneId: zone.id, purged: purgeEverything ? 'everything' : payload.files, result }, null, 2));
