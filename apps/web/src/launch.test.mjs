import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { appStoreUrl, campaignForPath, launchPaths, shopUrl, validOffers } from '../public/launch/model.mjs';

const root = new URL('../../../', import.meta.url);
const registry = JSON.parse(readFileSync(new URL('../public/launch/campaigns.json', import.meta.url)));
const [caffeine, water, c60] = registry.campaigns;
const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const clone = (value) => structuredClone(value);
const offer = (changes = {}) => ({
  id: 'caffeine-print-01', moleculeId: 'caffeine', title: 'Caffeine test offer',
  productHandle: 'caffeine-test', shopifyProductId: 'gid://shopify/Product/123',
  shopifyVariantId: 'gid://shopify/ProductVariant/90071992547409931234',
  printArtifactDigest: `sha256:${'a'.repeat(64)}`, ready: true, countryCode: 'US',
  verifiedAt: new Date(now - day).toISOString(), expiresAt: new Date(now + day).toISOString(),
  campaignId: 'native-caffeine', creativeId: 'native-preview', ...changes,
});
const feed = (offers = [offer()], changes = {}) => ({
  schema: 'lupi.merchandise.v1', storefrontPublic: true, offers, ...changes,
});
const context = (campaign = caffeine, placement = null) => ({ registry, campaign, placement });

function trackedJson(path) {
  try { return JSON.parse(readFileSync(new URL(path, root))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Native paths can be outside this task's sparse checkout, but remain in Git.
    return JSON.parse(execFileSync('git', ['show', `HEAD:${path}`], { cwd: fileURLToPath(root), encoding: 'utf8' }));
  }
}

test('all public campaign paths resolve exactly, without query-based or unknown placements', () => {
  const paths = launchPaths(registry);
  assert.equal(paths.length, 16);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(paths[0], '/launch/');
  assert.equal(campaignForPath(registry, '/launch/'), null);
  for (const path of paths.slice(1)) {
    const selected = campaignForPath(registry, path);
    assert.ok(selected);
    assert.ok(path.length <= 200);
    assert.ok(path.split('/').every((part) => part.length <= 64));
  }
  assert.equal(campaignForPath(registry, '/launch/caffeine').campaign, caffeine);
  assert.equal(campaignForPath(registry, '/launch/caffeine/').placement, null);
  assert.equal(campaignForPath(registry, '/launch/c60/creator-cr01-a/').campaign.moleculeId, 'c60_buckyball');
  for (const path of ['/launch/unknown/', '/launch/caffeine/unknown/', '/launch/caffeine/?source=reddit',
    '/launch/caffeine/#reddit', '/launch/%63affeine/', '/launch/caffeine/../water/',
    '/launch/caffeine//', 'https://lupi.live/launch/caffeine/']) {
    assert.equal(campaignForPath(registry, path), null, path);
  }
});

test('campaign molecule identity and display facts match native starters and real web pages', () => {
  const starters = trackedJson('apps/apple/LupiKit/Sources/LupiData/Resources/starters/starters.json').starters;
  const gallery = trackedJson('packages/ui/src/gallery-data.json');
  for (const campaign of registry.campaigns) {
    const starter = starters.find((value) => value.id === campaign.moleculeId);
    assert.ok(starter, campaign.moleculeId);
    assert.equal(campaign.formula, starter.formula);
    assert.equal(campaign.atoms, starter.atoms);
    assert.equal(campaign.moleculePath, `/m/${starter.id}`);
    const entry = gallery.find((value) => value.id === starter.id);
    assert.ok(entry?.file.startsWith('gallery/curated/') && entry.file.endsWith('.xyz'));
    assert.notEqual(entry.available, false);
    assert.ok(!entry.route && !entry.isTrajectory && entry.frames === '1');
    for (const placement of campaign.placements) assert.ok(placement.appStoreToken.length <= 30);
  }
  // Every native starter is accepted; plausible names and aliases are not new identities.
  for (const starter of starters) {
    assert.equal(validOffers(feed([offer({ moleculeId: starter.id })]), starter.id, now).length, 1);
  }
  for (const moleculeId of ['geosmin', 'vanillin', 'c60', 'c60-buckyball']) {
    assert.deepEqual(validOffers(feed([offer({ moleculeId })]), moleculeId, now), []);
  }
});

test('closed, missing and malformed registries expose no offer or destination', () => {
  const closed = trackedJson('apps/web/public/commerce/merchandise.v1.json');
  assert.deepEqual(validOffers(closed, 'caffeine', now), []);
  for (const value of [null, undefined, '{', [], {}, feed([], { schema: 'other' }),
    feed(undefined, { storefrontPublic: false }), feed(undefined, { storefrontPublic: 'true' }),
    feed(undefined, { storeOrigin: 'https://loot.lupi.live.attacker.example' })]) {
    assert.deepEqual(validOffers(value, 'caffeine', now), []);
  }
  assert.equal(shopUrl(offer(), context()), null, 'raw feed objects cannot bypass feed validation');
  assert.equal(appStoreUrl(registry, caffeine, caffeine.placements[0]), null);
});

test('offer windows enforce exact boundaries, a maximum of seven days and real UTC dates', () => {
  const active = offer({ verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * day).toISOString() });
  assert.equal(validOffers(feed([active]), 'caffeine', now).length, 1);
  assert.equal(validOffers(feed([active]), 'caffeine', now + 7 * day).length, 0);
  for (const changes of [
    { ready: false }, { verifiedAt: new Date(now + 1).toISOString() },
    { expiresAt: new Date(now).toISOString() }, { expiresAt: offer().verifiedAt },
    { verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * day + 1).toISOString() },
    { verifiedAt: '2026-02-30T00:00:00Z' }, { verifiedAt: '2026-11-03T00:00:00+00:00' },
    { expiresAt: 'invalid' }, { countryCode: 'CA' },
  ]) assert.deepEqual(validOffers(feed([offer(changes)]), 'caffeine', now), [], JSON.stringify(changes));
  assert.deepEqual(validOffers(feed(), 'caffeine', NaN), []);
});

test('any unsafe identity, ambiguous mapping or oversized feed fails closed as a whole', () => {
  for (const changes of [
    { productHandle: '../escape' }, { productHandle: 'ok?utm_source=attacker' }, { productHandle: '//evil.example' },
    { productHandle: '%2e%2e' }, { productHandle: 'a'.repeat(129) }, { id: 'bad\n' },
    { shopifyProductId: 'gid://shopify/ProductVariant/123' }, { shopifyVariantId: '123&redirect=https://evil.example' },
    { shopifyVariantId: 'gid://shopify/ProductVariant/0' }, { shopifyVariantId: 'gid://shopify/ProductVariant/123\n' },
    { printArtifactDigest: `sha256:${'A'.repeat(64)}` }, { campaignId: 'a'.repeat(81) },
    { creativeId: 'creative?user=secret' }, { title: 'bad\ntext' }, { title: ' ' }, { ready: 1 },
  ]) assert.deepEqual(validOffers(feed([offer(changes)]), 'caffeine', now), [], JSON.stringify(changes));
  assert.deepEqual(validOffers(feed([offer(), offer({ id: 'other' })]), 'caffeine', now), []);
  assert.deepEqual(validOffers(feed([offer(), offer({ moleculeId: 'water' })]), 'caffeine', now), []);
  assert.deepEqual(validOffers(feed([offer(), offer({ id: 'bad-other', moleculeId: 'vanillin' })]), 'caffeine', now), []);
  assert.deepEqual(validOffers(feed(Array.from({ length: 51 }, () => offer())), 'caffeine', now), []);
  assert.deepEqual(validOffers(feed(undefined, { padding: 'x'.repeat(128 * 1024) }), 'caffeine', now), []);
  assert.deepEqual(validOffers(feed(undefined, { padding: '水'.repeat(50 * 1024) }), 'caffeine', now), []);
  const bounded = feed(undefined, { padding: '' });
  bounded.padding = 'x'.repeat(128 * 1024 - Buffer.byteLength(JSON.stringify(bounded)));
  assert.equal(Buffer.byteLength(JSON.stringify(bounded)), 128 * 1024);
  assert.equal(validOffers(JSON.stringify(bounded), 'caffeine', now).length, 1);
  assert.deepEqual(validOffers(`${JSON.stringify(bounded)} `, 'caffeine', now), []);
});

test('shop handoffs preserve exact variant digits and only registered non-personal UTMs', (t) => {
  const [validated] = validOffers(feed([offer({ url: 'https://evil.example' })]), 'caffeine', now);
  assert.ok(Object.isFrozen(validated));
  const owned = new URL(shopUrl(validated, { ...context(), source: 'evil', utm_source: 'secret', query: '?gclid=secret' }));
  assert.equal(owned.origin, 'https://loot.lupi.live');
  assert.equal(owned.pathname, '/products/caffeine-test');
  assert.deepEqual(Object.fromEntries(owned.searchParams), {
    variant: '90071992547409931234', utm_source: 'lupi', utm_medium: 'owned',
    utm_campaign: 'us26-caffeine-01', utm_content: 'owned',
  });
  const placement = { ...caffeine.placements[0], source: 'attacker', creativeId: 'secret' };
  const paid = new URL(shopUrl(validated, context(caffeine, placement)));
  assert.equal(paid.searchParams.get('utm_source'), 'youtube');
  assert.equal(paid.searchParams.get('utm_medium'), 'paid-video');
  assert.equal(paid.searchParams.get('utm_content'), 'youtube-orbit-a');
  assert.equal(shopUrl(validated, context(water)), null);
  assert.equal(shopUrl(validated, context(caffeine, { id: 'unknown' })), null);
  assert.equal(shopUrl(validated, { ...context(), campaign: { id: 'not-registered' } }), null);
  assert.equal(shopUrl(clone(validated), context()), null);
  const [cage] = validOffers(feed([offer({ moleculeId: 'c60_buckyball' })]), 'c60_buckyball', now);
  assert.equal(shopUrl(cage, context(c60)), null, 'exploration campaigns never advertise a physical offer');
  t.mock.method(Date, 'now', () => now + day);
  assert.equal(shopUrl(validated, context()), null, 'a previously validated offer must expire before the click');
});

test('App Store links require the public gate and never invent or leave dangling campaign parameters', () => {
  const live = clone(registry);
  live.app.public = true;
  assert.equal(appStoreUrl(live, caffeine), 'https://apps.apple.com/us/app/id6830237119');
  live.app.campaignProviderToken = '123456';
  const placement = caffeine.placements[1];
  const campaignLink = new URL(appStoreUrl(live, caffeine, { ...placement, appStoreToken: 'attacker' }));
  assert.deepEqual(Object.fromEntries(campaignLink.searchParams), {
    pt: '123456', ct: placement.appStoreToken, mt: '8',
  });
  assert.equal(new URL(appStoreUrl(live, caffeine)).searchParams.get('ct'), 'us26-caffeine-01-owned');
  assert.equal(appStoreUrl(live, caffeine, { id: 'unknown' }), null);
  for (const token of ['', 123456, '0', '123&ct=secret', 'https://evil.example', '1'.repeat(21)]) {
    live.app.campaignProviderToken = token;
    assert.equal(appStoreUrl(live, caffeine), null);
  }
  live.app.id = '0000000000';
  assert.equal(appStoreUrl(live, caffeine), null);
});

test('malformed campaign registries cannot supply routes or arbitrary destination context', () => {
  for (const mutate of [
    (value) => { value.schema = 'other'; },
    (value) => { value.campaigns[0].slug = 'a'.repeat(65); },
    (value) => { value.campaigns[0].moleculeId = 'geosmin'; },
    (value) => { value.campaigns[0].moleculePath = '//evil.example'; },
    (value) => { value.campaigns[0].heroImage = 'https://tracker.example/pixel.png'; },
    (value) => { value.campaigns[0].heroImage = '//tracker.example/pixel.png'; },
    (value) => { value.campaigns[0].heroImage = '/launch/assets/../secret.png'; },
    (value) => { value.campaigns[0].heroImage = '/learn/water.svg?user=secret'; },
    (value) => { value.campaigns[0].heroImage = '/learn\\water.svg'; },
    (value) => { value.campaigns[0].heroAlt = ''; },
    (value) => { value.campaigns[0].placements[0].source = 'youtube&user=secret'; },
    (value) => { value.campaigns[0].placements[0].appStoreToken = 'a'.repeat(31); },
    (value) => { value.campaigns[1].placements[0].appStoreToken = value.campaigns[0].placements[0].appStoreToken; },
    (value) => { value.campaigns[0].placements.push(value.campaigns[0].placements[0]); },
    (value) => { value.campaigns.push(value.campaigns[0]); },
  ]) {
    const invalid = clone(registry);
    mutate(invalid);
    assert.deepEqual(launchPaths(invalid), []);
    assert.equal(campaignForPath(invalid, '/launch/caffeine/'), null);
    assert.equal(appStoreUrl(invalid, caffeine), null);
  }
});
