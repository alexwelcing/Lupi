/**
 * page.ts — the script of a zero-canvas molecule page (/m/<id>).
 *
 * The page is static HTML written at build time (scripts/generate-molecule-
 * pages.mts): the ink drawing at its opening pose, the facts, and three verbs
 * that work without this script (plain links). This script only adds:
 *
 * - the spinnable drawing (inkStage.ts), which replaces the static one in the
 *   same frame at the same pose, so nothing jumps;
 * - "Open in 3D" carrying the pose: the relay baton the viewer reads
 *   (relay/baton.ts, sessionStorage 'lupi.relay.baton') holds the drawing's
 *   view direction, so the lit molecule opens at the angle the visitor left
 *   it; a hover dwell or a press warms the viewer's entry module first;
 * - "Place on your desk": AR Quick Look on iPhone and iPad (rel="ar" and the
 *   prebuilt USDZ), Scene Viewer on Android (the prebuilt GLB);
 * - "Share": the native share sheet with the page link (its card unfurls in
 *   the chat), or the clipboard.
 *
 * No React, no three: the page stays a few kilobytes of script.
 */
import type { InkModel } from './ink';
import { createInkStage, type InkComfort, type InkStage } from './inkStage';

export interface MoleculePageData {
  id: string;
  name: string;
  model: InkModel;
  /** The viewer deep link, `/?sim=<id>`. */
  open: string;
  /** Absolute canonical URL of this page. */
  url: string;
  /** Share sheet text. */
  shareText: string;
  usdz: string;
  glb: string;
  /** The ink drawing alone (Quick Look needs an <img> inside its link). */
  ink: string;
  /** The viewer's entry module, warmed on intent. */
  appEntry?: string;
  /** The viewer's heavy chunks (three, the App), prefetched on intent into the HTTP cache. */
  warm?: string[];
}

const BATON_KEY = 'lupi.relay.baton';
const COMFORT_KEY = 'lupi.motion';
const FLASH_MS = 1600;
const DWELL_MS = 100;

function readComfort(): InkComfort {
  try {
    const stored = localStorage.getItem(COMFORT_KEY);
    if (stored === 'standard' || stored === 'gentle' || stored === 'still') return stored;
  } catch {
    /* storage blocked: follow the OS */
  }
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'still';
  } catch {
    /* no matchMedia */
  }
  return 'standard';
}

function readData(): MoleculePageData | null {
  const node = document.getElementById('lupi-molecule-data');
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as MoleculePageData;
  } catch {
    return null;
  }
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection?.saveData || /2g/.test(connection?.effectiveType ?? ''));
}

function supportsQuickLook(): boolean {
  try {
    const anchor = document.createElement('a');
    return Boolean(anchor.relList?.supports?.('ar'));
  } catch {
    return false;
  }
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

function sceneViewerUrl(data: MoleculePageData): string {
  const file = new URL(data.glb, data.url).href;
  const params = new URLSearchParams({ file, mode: 'ar_preferred', title: data.name });
  const fallback = encodeURIComponent(data.url);
  return (
    `intent://arvr.google.com/scene-viewer/1.2?${params.toString()}` +
    `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${fallback};end;`
  );
}

function openQuickLook(data: MoleculePageData): void {
  const anchor = document.createElement('a');
  anchor.rel = 'ar';
  anchor.href = `${data.usdz}#allowsContentScaling=1&canonicalWebPageURL=${encodeURIComponent(data.url)}`;
  anchor.style.position = 'absolute';
  anchor.style.opacity = '0';
  anchor.style.pointerEvents = 'none';
  const img = document.createElement('img');
  img.alt = '';
  img.src = data.ink;
  anchor.appendChild(img);
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => anchor.remove(), 1000);
}

export function mountMoleculePage(): void {
  const data = readData();
  const host = document.getElementById('ink-stage');
  if (!data || !host) return;
  document.documentElement.classList.add('mp-js');

  const caption = document.getElementById('ink-caption');
  const hint = caption?.querySelector<HTMLElement>('.mp-caption__hint') ?? null;
  const flash = caption?.querySelector<HTMLElement>('.mp-caption__flash') ?? null;
  const live = document.getElementById('ink-live');
  const openLink = document.getElementById('open-3d') as HTMLAnchorElement | null;
  const desk = document.getElementById('desk') as HTMLButtonElement | null;
  const share = document.getElementById('share') as HTMLButtonElement | null;
  const status = document.getElementById('share-status');
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let warmed = false;
  let opening = false;
  let stage: InkStage | null = null;

  const warm = () => {
    if (warmed || !data.appEntry || saveData()) return;
    warmed = true;
    const add = (rel: string, href: string) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (rel === 'prefetch' && href.endsWith('.js')) link.as = 'script';
      document.head.appendChild(link);
    };
    add('modulepreload', data.appEntry);
    for (const href of data.warm ?? []) add('prefetch', href);
  };

  const showFlash = (label: string) => {
    if (!flash || !hint) return;
    flash.textContent = label;
    flash.dataset.on = '';
    hint.dataset.hidden = '';
    if (live) live.textContent = label;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      delete flash.dataset.on;
      delete hint.dataset.hidden;
    }, FLASH_MS);
  };

  const hideFlash = () => {
    if (!flash || !hint || flash.dataset.on === undefined) return;
    if (flashTimer) clearTimeout(flashTimer);
    delete flash.dataset.on;
    delete hint.dataset.hidden;
  };

  /** Hand the pose to the viewer and go: the same baton the home hero leaves. */
  const openIn3D = () => {
    if (opening) return;
    opening = true;
    warm();
    document.documentElement.dataset.opening = '';
    try {
      const baton = {
        galleryId: data.id,
        source: 'page',
        viewDir: stage?.viewDir() ?? null,
        bodyOmegaY: stage?.getBodyOmegaY() ?? 0,
        t: 0,
      };
      sessionStorage.setItem(BATON_KEY, JSON.stringify({ baton, savedAt: Date.now() }));
    } catch {
      /* storage blocked: the viewer opens at its own fitted pose */
    }
    window.location.assign(data.open);
  };

  stage = createInkStage(host, {
    model: data.model,
    interactive: true,
    idPrefix: `mp-${data.id}`,
    comfort: readComfort,
    onTap: openIn3D,
    onDetent: showFlash,
    onSpinDegrees: (total) => {
      hideFlash();
      if (total >= 30) warm();
    },
  });
  host.dataset.live = '';

  if (openLink) {
    openLink.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openIn3D();
    });
    let dwell: ReturnType<typeof setTimeout> | null = null;
    openLink.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      dwell = setTimeout(warm, DWELL_MS);
    });
    openLink.addEventListener('pointerleave', () => {
      if (dwell) clearTimeout(dwell);
    });
    openLink.addEventListener('pointerdown', warm);
    openLink.addEventListener('focus', warm);
  }

  // A back navigation can restore this page from the bfcache mid-"opening".
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    opening = false;
    delete document.documentElement.dataset.opening;
  });

  if (desk) {
    if (supportsQuickLook()) {
      desk.hidden = false;
      desk.addEventListener('click', () => openQuickLook(data));
    } else if (isAndroid()) {
      desk.hidden = false;
      desk.addEventListener('click', () => {
        window.location.href = sceneViewerUrl(data);
      });
    }
  }

  if (share) {
    share.addEventListener('click', () => {
      const say = (text: string) => {
        if (status) status.textContent = text;
      };
      if (typeof navigator.share === 'function') {
        navigator
          .share({ title: `${data.name} · Lupi`, text: data.shareText, url: data.url })
          .catch((error: unknown) => {
            if ((error as DOMException)?.name !== 'AbortError') say('Could not open the share sheet.');
          });
        return;
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(data.url).then(
          () => say('Link copied.'),
          () => say(data.url),
        );
        return;
      }
      say(data.url);
    });
  }
}
