// Public labels only. Neither raw query parameters nor visitor identifiers are link inputs.
const APP_ID = '6830237119';
const STORE_ORIGIN = 'https://loot.lupi.live';
const MAX_FEED_BYTES = 128 * 1024;
const MAX_VALIDITY = 7 * 24 * 60 * 60 * 1000;
const VALIDATED_OFFER = Symbol('validated merchandise offer');
// Kept aligned with the frozen native starter manifest by launch.test.mjs.
const NATIVE_IDS = new Set([
  'hydrogen', 'water', 'carbon_dioxide', 'methane', 'ammonia', 'ethanol',
  'benzene', 'caffeine', 'c60_buckyball', 'glucose', 'salt_cluster',
  'tryptophan', 'hydrogen_peroxide',
]);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const slug = (value, maximum = 80) => typeof value === 'string' && value.length <= maximum
  && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const pathSlug = (value) => slug(value, 48) && /^[a-z]/.test(value);
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0
  && value.length <= maximum && !/[\r\n\u000b\u000c\u0085\u2028\u2029]/u.test(value);
const assetPath = (value) => typeof value === 'string' && value.length <= 200
  && /^\/(?:launch\/assets|learn)\/[a-z0-9][a-z0-9_-]*\.(?:png|jpe?g|webp|svg)$/.test(value);
const unique = (values) => new Set(values).size === values.length;

function campaigns(registry) {
  if (!object(registry) || registry.schema !== 'lupi.launch.v1' || !object(registry.app)
    || registry.app.id !== APP_ID || typeof registry.app.public !== 'boolean'
    || !Array.isArray(registry.campaigns) || registry.campaigns.length > 50) return null;
  const values = registry.campaigns;
  if (!values.every((campaign) => object(campaign) && slug(campaign.id)
    && pathSlug(campaign.slug) && NATIVE_IDS.has(campaign.moleculeId)
    && campaign.moleculePath === `/m/${campaign.moleculeId}`
    && text(campaign.name, 120) && text(campaign.formula, 80)
    && Number.isSafeInteger(campaign.atoms) && campaign.atoms > 0
    && text(campaign.headline, 200) && text(campaign.body, 1000)
    && assetPath(campaign.heroImage) && text(campaign.heroAlt, 300)
    && ['first-drop-candidate', 'next-drop-candidate', 'exploration'].includes(campaign.stage)
    && Array.isArray(campaign.placements) && campaign.placements.length <= 20
    && campaign.placements.every((placement) => object(placement) && pathSlug(placement.id)
      && slug(placement.source) && slug(placement.medium) && slug(placement.creativeId)
      && slug(placement.appStoreToken, 30))
    && unique(campaign.placements.map((placement) => placement.id)))) return null;
  const tokens = values.flatMap((campaign) => campaign.placements.map((placement) => placement.appStoreToken));
  return unique(values.map((campaign) => campaign.id)) && unique(values.map((campaign) => campaign.slug))
    && unique(values.map((campaign) => campaign.moleculeId)) && unique(tokens) ? values : null;
}

/** Canonical static pages; query strings never identify a placement. */
export function launchPaths(registry) {
  const values = campaigns(registry);
  return values ? ['/launch/', ...values.flatMap((campaign) => [
    `/launch/${campaign.slug}/`,
    ...campaign.placements.map((placement) => `/launch/${campaign.slug}/${placement.id}/`),
  ])] : [];
}

/** Null also denotes the overview page; its hero uses the registered owned campaign. */
export function campaignForPath(registry, pathname) {
  const values = campaigns(registry);
  if (!values || typeof pathname !== 'string') return null;
  const match = /^\/launch\/([a-z][a-z0-9-]{0,47})(?:\/([a-z][a-z0-9-]{0,47}))?\/?$/.exec(pathname);
  if (!match) return null;
  const campaign = values.find((value) => value.slug === match[1]);
  if (!campaign) return null;
  const placement = match[2] ? campaign.placements.find((value) => value.id === match[2]) : null;
  return match[2] && !placement ? null : { campaign, placement };
}

function timestamp(value) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return NaN;
  const result = Date.parse(value);
  // Date.parse normalizes some impossible calendar dates; the native parser does not accept them.
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 19) === value.slice(0, 19)
    ? result : NaN;
}

function offerShape(offer) {
  if (!object(offer)) return false;
  const verified = timestamp(offer.verifiedAt);
  const expires = timestamp(offer.expiresAt);
  return NATIVE_IDS.has(offer.moleculeId) && slug(offer.id) && slug(offer.productHandle, 128)
    && slug(offer.campaignId) && slug(offer.creativeId)
    && typeof offer.shopifyProductId === 'string' && /^gid:\/\/shopify\/Product\/[1-9][0-9]{0,19}$/.test(offer.shopifyProductId)
    && typeof offer.shopifyVariantId === 'string' && /^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,19}$/.test(offer.shopifyVariantId)
    && typeof offer.printArtifactDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(offer.printArtifactDigest)
    && typeof offer.ready === 'boolean' && offer.countryCode === 'US' && text(offer.title, 120)
    && Number.isFinite(verified) && Number.isFinite(expires) && expires > verified
    && expires - verified <= MAX_VALIDITY;
}

function currentOffer(offer, now) {
  return Number.isFinite(now) && offer.ready === true
    && timestamp(offer.verifiedAt) <= now && now < timestamp(offer.expiresAt);
}

/** Validates the entire native-compatible feed before exposing any current offer. */
export function validOffers(feed, moleculeId, now = Date.now()) {
  try {
    const raw = typeof feed === 'string' ? feed : JSON.stringify(feed);
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_FEED_BYTES) return [];
    const value = JSON.parse(raw);
    if (!object(value) || value.schema !== 'lupi.merchandise.v1' || value.storefrontPublic !== true
      || (value.storeOrigin != null && value.storeOrigin !== STORE_ORIGIN)
      || !NATIVE_IDS.has(moleculeId) || !Array.isArray(value.offers) || value.offers.length > 50
      || !value.offers.every(offerShape) || !unique(value.offers.map((offer) => offer.id))
      || !unique(value.offers.map((offer) => offer.moleculeId))) return [];
    return value.offers.filter((offer) => offer.moleculeId === moleculeId && currentOffer(offer, now))
      .map((offer) => Object.freeze(Object.defineProperty(offer, VALIDATED_OFFER, { value: true })));
  } catch {
    return [];
  }
}

function registeredContext(registry, candidate, placement) {
  const values = campaigns(registry);
  if (!values || !object(candidate)) return null;
  const campaign = values.find((value) => value.id === candidate.id);
  if (!campaign) return null;
  if (placement == null) return { campaign, placement: null };
  if (!object(placement)) return null;
  const registered = campaign.placements.find((value) => value.id === placement.id);
  return registered ? { campaign, placement: registered } : null;
}

/** Only a validOffers result and a registered campaign can produce a shop handoff. */
export function shopUrl(offer, context) {
  if (!object(context) || !object(offer) || offer[VALIDATED_OFFER] !== true
    || !offerShape(offer) || !currentOffer(offer, Date.now())) return null;
  const selected = registeredContext(context.registry, context.campaign, context.placement);
  if (!selected || selected.campaign.moleculeId !== offer.moleculeId
    || selected.campaign.stage === 'exploration') return null;
  const url = new URL(`/products/${offer.productHandle}`, STORE_ORIGIN);
  url.searchParams.set('variant', offer.shopifyVariantId.split('/').at(-1));
  url.searchParams.set('utm_source', selected.placement?.source ?? 'lupi');
  url.searchParams.set('utm_medium', selected.placement?.medium ?? 'owned');
  url.searchParams.set('utm_campaign', selected.campaign.id);
  url.searchParams.set('utm_content', selected.placement?.creativeId ?? 'owned');
  return url.href;
}

/** A public listing is independent of campaign measurement. Never synthesize Apple's pt. */
export function appStoreUrl(registry, campaign, placement = null) {
  const selected = registeredContext(registry, campaign, placement);
  if (!selected || registry.app.public !== true) return null;
  const url = new URL(`https://apps.apple.com/us/app/id${APP_ID}`);
  const provider = registry.app.campaignProviderToken;
  if (provider == null) return url.href;
  if (typeof provider !== 'string' || !/^[1-9][0-9]{0,19}$/.test(provider)) return null;
  const token = selected.placement?.appStoreToken ?? `${selected.campaign.id}-owned`;
  if (!slug(token, 30)) return null;
  // https://developer.apple.com/help/app-store-connect-analytics/acquisition/campaign-links
  url.searchParams.set('pt', provider);
  url.searchParams.set('ct', token);
  url.searchParams.set('mt', '8');
  return url.href;
}
