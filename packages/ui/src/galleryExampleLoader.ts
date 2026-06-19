import {
  getDeviceProfile,
  parseAtomCountLabel,
  formatAtomCount,
} from './deviceCapabilities';
import { loadMoleculeSource } from './loadMoleculeSource';
import { artifactToLoadedFile } from './MlipArtifactLoader';
import { ALL_EXAMPLES, publicAssetUrl, type GalleryExample } from './landing/shared';
import { useStore } from './store';

export function findGalleryExample(id: string): GalleryExample | undefined {
  return ALL_EXAMPLES.find((example) => example.id === id);
}

export function resolveGalleryExampleUrl(example: GalleryExample): string {
  if (example.file.startsWith('http://') || example.file.startsWith('https://')) {
    return maybeDevStorageProxy(example.file);
  }
  const localUrl = publicAssetUrl(example.file);
  const isDev = (import.meta as any).env?.DEV;
  return (isDev || !example.sourceUrl) ? localUrl : example.sourceUrl;
}

export async function openGalleryExampleById(id: string): Promise<boolean> {
  const example = findGalleryExample(id);
  if (!example) {
    useStore.getState().setError(`Could not find gallery scene "${id}".`);
    return false;
  }
  return openGalleryExample(example);
}

export async function openGalleryExample(example: GalleryExample): Promise<boolean> {
  if (!example.available) return false;

  const profile = getDeviceProfile();
  const estimatedAtoms = parseAtomCountLabel(example.atoms);
  if (estimatedAtoms > profile.maxAtoms) {
    useStore.getState().setError(
      `"${example.title}" has ~${formatAtomCount(estimatedAtoms)} atoms, ` +
      `over Lupi's current ${formatAtomCount(profile.maxAtoms)}-atom ` +
      `single-scene ceiling (${profile.reason}). ` +
      `Try a smaller frame or a chunked trajectory.`,
    );
    return false;
  }

  const url = resolveGalleryExampleUrl(example);
  const store = useStore.getState();
  store.setActiveCardId(example.id);
  store.setLoading(true, 0);

  try {
    if (/\.json(?:$|\?)/i.test(url) || /\.json$/i.test(example.file)) {
      const resp = await fetch(url, { cache: 'reload' });
      if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
      const payload = await resp.json();
      store.setFile({
        ...artifactToLoadedFile(payload, url),
        name: example.title,
      });
    } else {
      await loadMoleculeSource(url);
      const loaded = useStore.getState().file;
      if (loaded) {
        useStore.setState({
          file: { ...loaded, name: example.title },
        });
      }
    }

    applyGalleryExampleDefaults(example);
    syncGalleryExampleUrl(example.id);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Gallery load failed for ${example.id}:`, message);
    useStore.getState().setError(
      `Could not load "${example.title}" - try dragging the file directly.`,
    );
    return false;
  }
}

function applyGalleryExampleDefaults(example: GalleryExample): void {
  const store = useStore.getState();
  const file = store.file;
  if (!file) return;

  store.setActiveCardId(example.id);
  store.setFrame(0);
  store.setCameraPreset('iso');
  store.setPlaybackSpeed(1);
  useStore.setState({ playing: Boolean(example.autoPlay) });

  const firstFrame = file.trajectory.frames[0];
  if (example.colorBy && firstFrame?.properties?.has(example.colorBy)) {
    store.setColorScheme('property');
    store.setColorProperty(example.colorBy);
  }
}

function syncGalleryExampleUrl(id: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('sim') === id) return;
  url.searchParams.set('sim', id);
  window.history.pushState({}, '', url);
}

function maybeDevStorageProxy(url: string): string {
  const isDev = (import.meta as any).env?.DEV;
  if (!isDev) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'storage.googleapis.com') return url;
    return `/__lupi_gcs${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
