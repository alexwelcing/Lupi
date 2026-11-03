import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { campaignForPath, launchPaths, appStoreUrl } from '../apps/web/public/launch/model.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(await readFile(path.join(root, 'apps/web/public/launch/campaigns.json'), 'utf8'));
const target = path.resolve(process.argv[2] ?? path.join(root, 'apps/web/dist'));
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function render(pagePath) {
  const selection = campaignForPath(registry, pagePath);
  const campaign = selection?.campaign ?? registry.campaigns[0];
  const overview = pagePath === '/launch/';
  const title = overview ? 'Molecules, in everyday life.' : campaign.headline;
  const description = overview ? 'Meet a molecule. Explore it in Lupi. Find a little wonder in the everyday.' : campaign.body;
  const stage = campaign.stage === 'exploration' ? 'A closer look' : 'A collection in preparation';
  const installUrl = appStoreUrl(registry, campaign, selection?.placement ?? null);
  const appAction = installUrl ? `<a class="button primary" href="${escape(installUrl)}" data-audience-feature="app_store_open">Get the free app ↗</a>` : '<p class="availability">iPhone &amp; iPad app in preparation</p>';
  const appCopy = registry.app.public ? 'Turn it around in 3D, bring it into your space, and play with its shape.' : 'Turn it around in 3D. When Lupi arrives on the App Store, bring it into your space and play with its shape.';
  const physicalHeading = campaign.stage === 'exploration' ? 'Shape, for its<br>own sake.' : 'A little wonder.<br>Part of your day.';
  const physicalCopy = campaign.stage === 'exploration' ? 'Find the pentagons and hexagons in this illustrative geometric model. This molecule has no physical collection yet.' : 'Thoughtful physical pieces, inspired by the same molecule. A familiar shape to wear, use, or give.';
  const navigation = registry.campaigns.map((item) => `<a class="molecule-card" href="/launch/${escape(item.slug)}/" data-audience-feature="launch_molecule_select"><span class="formula">${escape(item.formula)}</span><strong>${escape(item.name)}</strong><span>${item.atoms} atoms <span aria-hidden="true">↗</span></span></a>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · Lupi</title><meta name="description" content="${escape(description)}"><meta name="lupi-launch" content="v1">
<meta name="robots" content="noindex,follow"><link rel="canonical" href="https://lupi.live${escape(pagePath)}">
<meta property="og:title" content="${escape(title)} · Lupi"><meta property="og:description" content="${escape(description)}"><meta property="og:type" content="website"><meta property="og:url" content="https://lupi.live${escape(pagePath)}">
<link rel="stylesheet" href="/launch/style.css"><script defer src="/audience.js" data-site="lupi" data-endpoint="/api/audience/events"></script><script type="module" src="/launch/page.mjs"></script>
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="masthead"><a class="wordmark" href="/launch/" aria-label="Lupi launch home">Lupi<span class="brand-dot" aria-hidden="true"></span></a><span class="masthead-note">MOLECULES, IN EVERYDAY LIFE</span><nav aria-label="Page sections"><a href="#explore">Explore</a><a href="#collection">Physical collection</a></nav></header>
<main id="main">
<section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><p class="eyebrow">${escape(campaign.name)} / ${String(campaign.atoms).padStart(2, '0')} ATOMS</p><h1 id="hero-title">${escape(title)}</h1><p class="intro">${escape(description)}</p><a class="button primary" href="${escape(campaign.moleculePath)}" data-audience-feature="molecule_open">Explore ${escape(campaign.name)} <span aria-hidden="true">↗</span></a><p class="small-note">Open the molecule in your browser.</p><div class="hero-foot"><span class="tiny-line"></span><p>A free molecular playground.<br>Optional physical pieces. The same curiosity.</p></div></div>
<div class="hero-art ${campaign.slug === 'water' ? 'projection' : ''}"><span class="orbit orbit-one" aria-hidden="true"></span><span class="orbit orbit-two" aria-hidden="true"></span><div class="image-wrap"><img src="${escape(campaign.heroImage)}" alt="${escape(campaign.heroAlt)}" fetchpriority="high"></div><p class="art-caption">${campaign.slug === 'water' ? 'WATER / A MOLECULAR PROJECTION' : 'ACTUAL LUPI APP / CAMERA-FREE PREVIEW'}</p></div></section>
<div class="section-rule"><span>SMALL STRUCTURES. EVERYDAY STORIES.</span><span>01 — 03</span></div>
<section class="ways" aria-label="Explore and collect"><article class="way-card" id="explore"><p class="eyebrow">01 / EXPLORE IT</p><h2>Give a molecule<br>some room.</h2><p>${escape(appCopy)}</p><div id="app-action">${appAction}</div><a class="text-link" href="${escape(campaign.moleculePath)}" data-audience-feature="molecule_open">Explore on the web now <span aria-hidden="true">↗</span></a></article>
<article class="way-card physical" id="collection"><p class="eyebrow">02 / ${campaign.stage === 'exploration' ? 'LOOK CLOSER' : 'LIVE WITH IT'}</p><h2>${physicalHeading}</h2><p>${escape(physicalCopy)}</p><div id="shop-action" aria-live="polite"><p class="availability">${escape(stage)}</p></div><p class="shipping">${campaign.stage === 'exploration' ? 'No physical offer is available for this molecule.' : 'Physical collection planned for US shipping.'}</p></article></section>
<section class="more" aria-labelledby="more-title"><div class="section-heading"><p class="eyebrow">KEEP LOOKING</p><h2 id="more-title">Ordinary things.<br>Extraordinary shapes.</h2><p>Caffeine is our first collection candidate. Water comes next. C60 is here to explore.</p></div><div class="molecule-grid">${navigation}</div></section>
<section class="closing"><p class="eyebrow">ONE SMALL IDEA</p><h2>The world gets more interesting<br>when you look a little closer.</h2><p>Lupi is free. Physical merchandise is optional.</p></section>
</main><footer><a class="wordmark" href="/">Lupi</a><p>Molecules, in everyday life.</p><nav aria-label="Support links"><a href="/support/ios/">Contact &amp; support</a><a href="/privacy/ios/">App privacy</a></nav><p class="analytics-note">Lupi’s page analytics use no cookies or persistent visitor identifiers.</p></footer>
</body></html>`;
}

const paths = launchPaths(registry);
if (paths.length < 2) throw new Error('No registered launch pages; refuse an empty campaign build.');
for (const pagePath of paths) {
  const directory = path.join(target, pagePath);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), render(pagePath));
}
console.log(`Generated ${paths.length} registered Lupi launch pages; App Store and shop links remain availability-gated.`);
