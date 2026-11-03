import { campaignForPath, appStoreUrl, validOffers, shopUrl } from './model.mjs';

const registry = await fetch('/launch/campaigns.json', { credentials: 'omit', cache: 'no-store', redirect: 'error' }).then((response) => {
  if (!response.ok) throw new Error('Campaign unavailable');
  return response.json();
}).catch(() => null);
const selection = registry && (campaignForPath(registry, location.pathname)
  ?? (location.pathname === '/launch/' && typeof registry.campaigns?.[0]?.slug === 'string'
    ? campaignForPath(registry, `/launch/${registry.campaigns[0].slug}/`) : null));

function closeApp() {
  const app = document.querySelector('#app-action');
  if (!app) return;
  const status = document.createElement('p');
  status.className = 'availability';
  status.textContent = 'iPhone & iPad app in preparation';
  app.replaceChildren(status);
}
if (registry !== null && !selection) closeApp();

if (selection) {
  const context = { ...selection, registry };
  const app = document.querySelector('#app-action');
  const shop = document.querySelector('#shop-action');
  const shipping = document.querySelector('.shipping');
  const plannedShipping = shipping?.textContent;
  const appUrl = appStoreUrl(registry, selection.campaign, selection.placement);
  if (app && appUrl) {
    const link = document.createElement('a');
    link.href = appUrl;
    link.className = 'button primary';
    link.textContent = 'Get the free app ↗';
    link.dataset.audienceFeature = 'app_store_open';
    app.replaceChildren(link);
  } else closeApp();

  let generation = 0;
  let activeController;
  function closed() {
    if (!shop) return;
    if (shipping) shipping.textContent = plannedShipping;
    const status = document.createElement('p');
    status.className = 'availability';
    status.textContent = selection.campaign.stage === 'exploration' ? 'A closer look' : 'Physical collection in preparation';
    shop.replaceChildren(status);
  }
  async function feed() {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    let reader;
    try {
      const response = await fetch('/commerce/merchandise.v1.json', { signal: controller.signal,
        credentials: 'omit', cache: 'no-store', redirect: 'error' });
      const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (response.status !== 200 || mime !== 'application/json' || !response.body) {
        await response.body?.cancel();
        return null;
      }
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024) { await reader.cancel(); return null; }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder().decode(bytes);
    } catch { return null; }
    finally { clearTimeout(timer); reader?.releaseLock(); }
  }
  async function refresh(open = false) {
    const current = ++generation;
    closed();
    if (!shop || document.visibilityState === 'hidden') { activeController?.abort(); return; }
    const raw = await feed();
    if (current !== generation) return;
    const offer = validOffers(raw, selection.campaign.moleculeId)[0];
    const target = offer && shopUrl(offer, context);
    if (!target) return;
    if (shipping) shipping.textContent = 'Physical goods · US shipping. Delivery and total shown at checkout.';
    if (open) {
      window.audience?.track('merchandise_open');
      location.assign(target);
      return;
    }
    // A button keeps ordinary open-in-new-tab/context-menu navigation from bypassing
    // the fresh feed and expiry check performed immediately before the handoff.
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'button primary';
    link.textContent = `${offer.title} ↗`;
    link.dataset.audienceFeature = 'merchandise_intent';
    link.addEventListener('click', (event) => { event.preventDefault(); void refresh(true); });
    shop.replaceChildren(link);
  }
  if (shop) {
    void refresh();
    document.addEventListener('visibilitychange', () => { void refresh(); });
    setInterval(() => { void refresh(); }, 30_000);
  }
}
