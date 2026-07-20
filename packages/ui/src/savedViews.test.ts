import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import {
  defaultSavedViewTitle,
  loadSavedMolecule,
  makeSavedViewUrl,
  readMoleculeSource,
  slugifySavedViewTitle,
  type SavedMoleculeSource,
} from './savedViews';
import type { LoadedFile } from './store';
import { useStore } from './store';
import { resetStore } from './test-utils';

const loaderSeams = vi.hoisted(() => ({
  loadMoleculeSource: vi.fn(),
  loadInlineMolecule: vi.fn(),
}));

vi.mock('./loadMoleculeSource', () => loaderSeams);

describe('slugifySavedViewTitle', () => {
  it('lowercases, trims, and replaces non-alphanumeric runs with hyphens', () => {
    expect(slugifySavedViewTitle('  Hello World!  ')).toBe('hello-world');
  });

  it('removes quotes and apostrophes', () => {
    expect(slugifySavedViewTitle("It's a 'Test' View")).toBe('its-a-test-view');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugifySavedViewTitle('---foo-bar---')).toBe('foo-bar');
  });

  it('caps length at 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugifySavedViewTitle(long).length).toBe(80);
  });

  it('returns an empty string for punctuation-only input', () => {
    expect(slugifySavedViewTitle('!!!')).toBe('');
  });
});

describe('defaultSavedViewTitle', () => {
  it('strips MCP: prefix and file extensions', () => {
    const file = { name: 'MCP: my-molecule.pdb' } as LoadedFile;
    expect(defaultSavedViewTitle(file)).toBe('my-molecule Publish');
  });

  it('falls back to a generic title when no file is loaded', () => {
    expect(defaultSavedViewTitle(null)).toBe('Lupi View Publish');
  });
});

describe('makeSavedViewUrl', () => {
  it('uses window.location when available', () => {
    const originalLocation = window.location;
    // @ts-expect-error readonly override for test
    window.location = { origin: 'https://lupi.live', pathname: '/' } as Location;
    expect(makeSavedViewUrl('my-view')).toBe('https://lupi.live/view/my-view');
    // @ts-expect-error readonly override for test
    window.location = originalLocation;
  });

  it('falls back to a path URL when window is undefined', () => {
    const savedWindow = globalThis.window;
    // @ts-expect-error deleting window for SSR test
    delete globalThis.window;
    expect(makeSavedViewUrl('my-view')).toBe('/view/my-view');
    globalThis.window = savedWindow;
  });
});

describe('saved molecule source policy', () => {
  beforeEach(() => {
    resetStore();
    loaderSeams.loadMoleculeSource.mockReset();
    loaderSeams.loadInlineMolecule.mockReset();
    window.history.replaceState({}, '', '/');
  });

  function setLoadedSource(sourceUrl: string, atomCount = 2) {
    const trajectory = createMockTrajectory(1, atomCount);
    const frame = trajectory.frames[0]!;
    frame.typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
    frame.distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };
    useStore.getState().setFile({
      name: 'source.xyz',
      size: 123,
      trajectory,
      thermo: null,
      sourceUrl,
    });
  }

  function urlSource(url: string): SavedMoleculeSource {
    return { kind: 'url', name: 'saved.xyz', url, size: 123, atomCount: 2, totalFrames: 1 };
  }

  it('persists allowlisted absolute and portable root-relative gallery URLs', () => {
    setLoadedSource('https://lupi.live/gallery/curated/source.xyz');
    expect(readMoleculeSource()).toMatchObject({
      kind: 'url',
      url: 'https://lupi.live/gallery/curated/source.xyz',
    });

    setLoadedSource('/gallery/curated/./portable.xyz');
    expect(readMoleculeSource()).toMatchObject({
      kind: 'url',
      url: '/gallery/curated/portable.xyz',
    });
  });

  it('saves a disallowed human-opened remote source as inline XYZ', () => {
    setLoadedSource('https://untrusted.example/molecule.xyz');
    const source = readMoleculeSource();
    expect(source.kind).toBe('inline-xyz');
    if (source.kind === 'inline-xyz') expect(source.xyz).toMatch(/^2\nsource\.xyz\n/m);
  });

  it('rejects an inline XYZ fallback when raw types lack an element map', () => {
    setLoadedSource('https://untrusted.example/molecule.xyz');
    const frame = useStore.getState().file!.trajectory.frames[0]!;
    frame.typeSemantics = { kind: 'opaque', provenance: 'legacy-unknown' };

    expect(() => readMoleculeSource()).toThrow(/complete element mapping/i);
  });

  it('rejects an inline XYZ fallback when coordinate units are unknown', () => {
    setLoadedSource('https://untrusted.example/molecule.xyz');
    const frame = useStore.getState().file!.trajectory.frames[0]!;
    frame.distanceSemantics = { kind: 'unknown', provenance: 'lammps-dump' };

    expect(() => readMoleculeSource()).toThrow(/coordinate units are unknown/i);
  });

  it('loads allowlisted saved URLs with strict redirect denial', async () => {
    loaderSeams.loadMoleculeSource.mockResolvedValue(undefined);
    await loadSavedMolecule(urlSource('https://storage.googleapis.com/shed-489901-omol25/demo.xyz'));
    expect(loaderSeams.loadMoleculeSource).toHaveBeenCalledWith(
      'https://storage.googleapis.com/shed-489901-omol25/demo.xyz',
      { strictRemote: true },
    );
  });

  it.each([
    'https://user:password@lupi.live/gallery/a.xyz',
    'http://lupi.live/gallery/a.xyz',
    'https://127.0.0.1/a.xyz',
    'https://10.0.0.1/a.xyz',
    'https://169.254.169.254/a.xyz',
    'https://molecule.local/a.xyz',
    'https://unknown.example/a.xyz',
    'https://lupi.live.evil.example/gallery/a.xyz',
    'https://lupi.live/gallery/not-data?file=a.xyz',
  ])('rejects an unsafe public document URL before the loader: %s', async (url) => {
    await expect(loadSavedMolecule(urlSource(url))).rejects.toThrow();
    expect(loaderSeams.loadMoleculeSource).not.toHaveBeenCalled();
  });

  it('does not retry a redirect failure inside the saved-view loader', async () => {
    loaderSeams.loadMoleculeSource.mockRejectedValue(new TypeError('redirect mode is set to error'));
    await expect(loadSavedMolecule(urlSource('https://lupi.live/gallery/redirect.xyz'))).rejects.toThrow(/redirect/i);
    expect(loaderSeams.loadMoleculeSource).toHaveBeenCalledTimes(1);
  });
});
