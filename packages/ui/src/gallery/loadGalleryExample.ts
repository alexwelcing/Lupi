import { artifactToLoadedFile } from '../MlipArtifactLoader';
import { useStore, type KnowledgeLabel } from '../store';
import {
  clearStreamingFrameCoordinator,
  DEFAULT_STREAMING_RESIDENT_FRAMES,
  installStreamingFrameCoordinator,
} from '../streamingFrameCoordinator';
import {
  formatAtomCount,
  getDeviceProfile,
  parseAtomCountLabel,
} from '../deviceCapabilities';
import type { ViewerOpenResult } from '../viewer/openTypes';
import type { Frame, Trajectory } from '@atlas/core/types';
import { resolveExampleUrl, type GalleryExample, publicAssetUrl } from './catalog';
import { scienceBundleForPathIndex } from '../science/scienceBundle';
import { minimumImageUnwrapTrajectory } from '../science/minimumImage';
import {
  assertViewerLoadCurrent,
  viewerLoadIsCurrent,
  ViewerLoadSupersededError,
  type ViewerLoadGuard,
} from '../viewer/loadGuard';

// (previous streaming lifecycle is managed by streamingFrameCoordinator)

function oversizeMessage(title: string, atomCount: number, ceiling: number, suffix: string) {
  return `"${title}" has ${suffix}${formatAtomCount(atomCount)} atoms, ` +
    `over Lupi's current ${formatAtomCount(ceiling)}-atom single-scene ceiling. ` +
    `Try a smaller frame or a chunked trajectory.`;
}

function resultFromCurrentFile(): ViewerOpenResult {
  const file = useStore.getState().file;
  if (!file) return { ok: false, message: 'No molecule file was loaded.' };
  return {
    ok: true,
    fileName: file.name,
    atomCount: file.trajectory.frames[0]?.natoms ?? 0,
  };
}

function applyCatalogFrameSemantics(frame: Frame, example: GalleryExample): Frame {
  if (!example.atomTypeMap && !example.distanceUnit) return frame;
  const typeSemantics = example.atomTypeMap && (!frame.typeSemantics || frame.typeSemantics.kind === 'opaque')
    ? {
        kind: 'explicit-element-map' as const,
        provenance: 'catalog-element-map' as const,
        elementMap: example.atomTypeMap,
      }
    : frame.typeSemantics;
  const distanceSemantics = example.distanceUnit === 'angstrom'
    && (!frame.distanceSemantics || frame.distanceSemantics.kind === 'unknown')
    ? { kind: 'angstrom' as const, provenance: 'source-declared' as const }
    : frame.distanceSemantics;
  return { ...frame, typeSemantics, distanceSemantics };
}

function applyCatalogSemantics(trajectory: Trajectory, example: GalleryExample): Trajectory {
  if (!example.atomTypeMap && !example.distanceUnit) return trajectory;
  return {
    ...trajectory,
    frames: trajectory.frames.map((frame) => frame ? applyCatalogFrameSemantics(frame, example) : frame),
  };
}

/** Pure parser for knowledge-labels JSON. Exported for unit testing. */
export function parseKnowledgeLabelsPayload(payload: unknown): KnowledgeLabel[] {
  const raw = Array.isArray(payload) ? payload : (payload as any)?.labels;
  if (!Array.isArray(raw)) {
    console.warn('[knowledge-labels] Expected array or { labels: [...] }');
    return [];
  }
  return raw
    .filter((l: any) => l && typeof l.text === 'string' && Array.isArray(l.position) && l.position.length === 3)
    .map((l: any) => ({
      id: String(l.id ?? `kl_${Math.random().toString(36).slice(2, 8)}`),
      kind: String(l.kind ?? 'unknown'),
      text: String(l.text),
      detail: l.detail ? String(l.detail) : undefined,
      sphereId: l.sphere_id ? String(l.sphere_id) : undefined,
      sphereIndex: typeof l.sphere_index === 'number' ? l.sphere_index : undefined,
      atomIndex: typeof l.atom_index === 'number' ? l.atom_index : undefined,
      nodeKind: l.node_kind ? String(l.node_kind) : undefined,
      nodeId: l.node_id ? String(l.node_id) : undefined,
      degree: typeof l.degree === 'number' ? l.degree : undefined,
      salience: typeof l.salience === 'number' ? l.salience : undefined,
      position: [Number(l.position[0]), Number(l.position[1]), Number(l.position[2])] as [number, number, number],
    }));
}

async function loadKnowledgeLabels(example: GalleryExample, isCurrent?: ViewerLoadGuard): Promise<void> {
  if (!example.labelsUrl) {
    if (viewerLoadIsCurrent(isCurrent)) useStore.getState().clearKnowledgeLabels();
    return;
  }
  const url = example.labelsUrl.startsWith('http://') || example.labelsUrl.startsWith('https://')
    ? example.labelsUrl
    : publicAssetUrl(example.labelsUrl);
  try {
    const resp = await fetch(url, { cache: 'reload' });
    if (!resp.ok) {
      console.warn(`[knowledge-labels] Failed to fetch ${url}: ${resp.status}`);
      if (viewerLoadIsCurrent(isCurrent)) useStore.getState().clearKnowledgeLabels();
      return;
    }
    const labels = parseKnowledgeLabelsPayload(await resp.json());
    if (viewerLoadIsCurrent(isCurrent)) useStore.getState().setKnowledgeLabels(labels);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[knowledge-labels] Load failed:', message);
    if (viewerLoadIsCurrent(isCurrent)) useStore.getState().clearKnowledgeLabels();
  }
}

/**
 * Best-effort fetch + parse of an entry's simulation output sidecars
 * (thermo table, ave/chunk profiles), attached to the already-mounted file
 * without re-running scene setup. Fire-and-forget: a missing or malformed
 * output file never fails the structure load.
 */
let sidecarGeneration = 0;

async function loadOutputSidecars(example: GalleryExample): Promise<void> {
  const outputs = example.outputs;
  if (!outputs) return;
  // Overlapping loads of the same card would otherwise both pass the
  // activeCardId check below and double-attach (profiles append).
  const generation = ++sidecarGeneration;
  const toUrl = (p: string) =>
    p.startsWith('http://') || p.startsWith('https://') ? p : publicAssetUrl(p);
  try {
    const { parseLogFile, parseChunkProfile } = await import('@atlas/parsers');
    let thermo: import('@atlas/core/types').ThermoData | null = null;
    const profiles: import('@atlas/parsers').ChunkProfileData[] = [];

    if (outputs.thermoUrl) {
      try {
        const resp = await fetch(toUrl(outputs.thermoUrl));
        if (resp.ok) {
          const name = outputs.thermoUrl.split('/').pop() ?? 'thermo.log';
          thermo = await parseLogFile(new File([await resp.blob()], name));
        }
      } catch (err) {
        console.warn('[gallery-outputs] thermo load failed:', err);
      }
    }
    for (const profileUrl of outputs.profileUrls ?? []) {
      try {
        const resp = await fetch(toUrl(profileUrl));
        if (resp.ok) profiles.push(parseChunkProfile(await resp.text()));
      } catch (err) {
        console.warn('[gallery-outputs] profile load failed:', err);
      }
    }
    if (thermo || profiles.length > 0) {
      // The fetches raced against user navigation — only attach if this
      // example is still the loaded one AND this is the newest sidecar
      // load, otherwise outputs land on the wrong molecule or attach twice.
      if (
        generation === sidecarGeneration
        && useStore.getState().activeCardId === example.id
      ) {
        useStore.getState().attachFileSidecars({ thermo, profiles });
      }
    }
  } catch (err) {
    console.warn('[gallery-outputs] sidecar load failed:', err);
  }
}

/**
 * Attach the validated Z1 science bundle to the just-loaded file when the
 * gallery entry declares `sciencePathIndex`. This is the real load path for
 * the SCIENCE deck section: gallery card / `?sim=` / `#/science/<index>` all
 * funnel through here, so the panel is never reachable from test-only state.
 * Fail-closed twice: an invalid fixture yields no bundle, and a trajectory
 * whose frame count disagrees with the path's NEB image count attaches no
 * science (a mismatch is a load error, not a warning, per the data contract).
 * Exported for unit tests.
 */
export function attachScienceBundle(example: GalleryExample): void {
  if (example.sciencePathIndex == null) return;
  const file = useStore.getState().file;
  if (!file) return;
  const science = scienceBundleForPathIndex(example.sciencePathIndex);
  if (!science) return; // validation already logged the precise errors
  if (file.trajectory.totalFrames !== science.path.imageCount) {
    console.error(
      `[science-panel] trajectory/science mismatch — failing closed: "${example.id}" loaded ` +
      `${file.trajectory.totalFrames} frames but path ${science.path.pathIndex} declares ` +
      `${science.path.imageCount} NEB images.`,
    );
    return;
  }
  // Unwrap the periodic path to minimum-image so playback interpolates the
  // short way (atoms never fly backward through the cell). Display-only
  // transform; the discrete image indices and energies are untouched.
  const unwrappedTrajectory = minimumImageUnwrapTrajectory(file.trajectory);

  // Force the SCIENCE deck section open (not the toggling setter: reloading a
  // second science path while the section is open must keep it open).
  useStore.setState({ file: { ...file, trajectory: unwrappedTrajectory, science }, activePanel: 'science' });
}

export async function loadGalleryExample(
  example: GalleryExample,
  options: { isCurrent?: ViewerLoadGuard } = {},
): Promise<ViewerOpenResult> {
  assertViewerLoadCurrent(options.isCurrent);
  if (!example.available) {
    return { ok: false, message: `"${example.title}" is not available.` };
  }

  const profile = getDeviceProfile();
  const estimatedAtoms = parseAtomCountLabel(example.atoms);
  if (estimatedAtoms > profile.maxAtoms) {
    const message = `"${example.title}" has ~${formatAtomCount(estimatedAtoms)} atoms, ` +
      `over Lupi's current ${formatAtomCount(profile.maxAtoms)}-atom ` +
      `single-scene ceiling (${profile.reason}). ` +
      `Try a smaller frame or a chunked trajectory.`;
    useStore.getState().setError(message);
    return { ok: false, message };
  }

  const store = useStore.getState();
  store.setLoading(true, 0);
  store.setActiveCardId(example.id);
  clearStreamingFrameCoordinator();
  store.clearKnowledgeLabels();

  try {
    const url = resolveExampleUrl(example);

    if (/\.json(?:$|\?)/i.test(url) || /\.json$/i.test(example.file)) {
      const resp = await fetch(url, { cache: 'reload' });
      if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
      const payload = await resp.json();
      assertViewerLoadCurrent(options.isCurrent);
      const loaded = artifactToLoadedFile(payload, url);
      const nextStore = useStore.getState();
      nextStore.setFile({
        ...loaded,
        name: example.title,
      }, { initialShowBonds: example.initialShowBonds ?? false });
      nextStore.setFrame(0);
      nextStore.setColorScheme('element');
      nextStore.setColorProperty(null);
      nextStore.setCameraPreset('iso');
      nextStore.setPlaybackSpeed(1);
      useStore.setState({
        atomScale: 1.35,
        playing: Boolean(example.autoPlay),
      });
      await loadKnowledgeLabels(example, options.isCurrent);
      assertViewerLoadCurrent(options.isCurrent);
      return resultFromCurrentFile();
    }

    const { isGlimbinUrl } = await import('@atlas/parsers/StreamingLoader');
    if (isGlimbinUrl(url)) {
      const { StreamingLoader } = await import('@atlas/parsers/StreamingLoader');
      const loader = new StreamingLoader(url, {
        onProgress: (phase, progress) => {
          if (!viewerLoadIsCurrent(options.isCurrent)) return;
          // Frame events continue for coordinator lookahead and playback.
          // They are telemetry, not a new top-level file load.
          if (phase === 'frame') return;
          useStore.getState().setLoading(true, progress * 0.6);
        },
        onTelemetry: (stats) => {
          if (!viewerLoadIsCurrent(options.isCurrent)) return;
          useStore.getState().setStreamingTelemetry(stats);
        },
      }, DEFAULT_STREAMING_RESIDENT_FRAMES);

      await loader.fetchHeader();
      await loader.fetchIndex();
      const frame0 = applyCatalogFrameSemantics(await loader.fetchFrame(0), example);
      assertViewerLoadCurrent(options.isCurrent, () => loader.dispose());
      const meta = loader.getMetadata()!;
      const placeholderFrames = new Array(meta.totalFrames);
      placeholderFrames[0] = frame0;

      useStore.getState().setFile({
        name: example.title,
        size: meta.fileSize,
        trajectory: {
          frames: placeholderFrames,
          totalFrames: meta.totalFrames,
          atomTypes: meta.atomTypes,
          globalBounds: meta.globalBounds,
        },
        thermo: null,
        sourceUrl: url,
      }, {
        initialShowBonds: example.initialShowBonds,
        preserveStreamingTelemetry: true,
      });

      const streamingSource = example.atomTypeMap || example.distanceUnit ? {
        fetchFrame: async (frameIndex: number, signal?: AbortSignal) => (
          applyCatalogFrameSemantics(await loader.fetchFrame(frameIndex, signal), example)
        ),
        releaseFrame: (frameIndex: number) => loader.releaseFrame(frameIndex),
        dispose: () => loader.dispose(),
      } : loader;
      installStreamingFrameCoordinator(streamingSource, {
        label: 'gallery-streaming',
        sourceUrl: url,
        initialLookahead: 12,
        playbackLookahead: 14,
      });

      if (example.autoPlay && meta.totalFrames > 1) {
        useStore.setState({ playing: true });
      }
      await loadKnowledgeLabels(example, options.isCurrent);
      assertViewerLoadCurrent(options.isCurrent);
      void loadOutputSidecars(example);
      return resultFromCurrentFile();
    }

    const STREAMING_BYTES_THRESHOLD = 5 * 1024 * 1024;
    const STREAMING_ATOM_THRESHOLD = 100_000;
    const looksDumpExt = /\.(lammpstrj|dump)$/i.test(example.file);

    if (looksDumpExt) {
      const probe = await fetch(url, { headers: { Range: 'bytes=0-4095' } });
      if (!probe.ok && probe.status !== 206) {
        throw new Error(`Failed to fetch: ${probe.status}`);
      }
      const probeBlob = await probe.blob();
      const head = await probeBlob.slice(0, 4096).text();
      const contentRange = probe.headers.get('content-range') ?? '';
      const totalMatch = contentRange.match(/\/(\d+)$/);
      const totalSize = totalMatch
        ? parseInt(totalMatch[1], 10)
        : (parseInt(probe.headers.get('content-length') ?? '0', 10) || probeBlob.size);

      const { canStreamDump } = await import('@atlas/parsers');
      const natomsMatch = head.match(/ITEM:\s*NUMBER OF ATOMS\s*\n\s*(\d+)/);
      const headerAtoms = natomsMatch ? parseInt(natomsMatch[1], 10) : 0;

      if (
        canStreamDump(head)
        && totalSize > STREAMING_BYTES_THRESHOLD
        && headerAtoms >= STREAMING_ATOM_THRESHOLD
      ) {
        if (headerAtoms > profile.maxAtoms) {
          const message = oversizeMessage(example.title, headerAtoms, profile.maxAtoms, '');
          useStore.getState().setError(message);
          return { ok: false, message };
        }
        const streamResp = await fetch(url);
        if (!streamResp.ok) throw new Error(`Failed to fetch: ${streamResp.status}`);
        const { parseDumpResponseStreaming } = await import('@atlas/parsers');
        const streamingStore = useStore.getState();
        for await (const event of parseDumpResponseStreaming(streamResp)) {
          assertViewerLoadCurrent(options.isCurrent);
          if (event.type === 'header') {
            streamingStore.setFile({
              name: example.title,
              size: totalSize,
              trajectory: event.trajectory,
              thermo: null,
              sourceUrl: url,
            }, { initialShowBonds: example.initialShowBonds });
            streamingStore.setLoadedAtomCount(0);
          } else if (event.type === 'progress') {
            streamingStore.setLoadedAtomCount(event.loadedAtoms);
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
          } else if (event.type === 'complete') {
            streamingStore.setLoadedAtomCount(event.loadedAtoms);
          }
        }
        await loadKnowledgeLabels(example, options.isCurrent);
        assertViewerLoadCurrent(options.isCurrent);
        void loadOutputSidecars(example);
        return resultFromCurrentFile();
      }
    }

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
    const blob = await resp.blob();
    const fileObj = new File([blob], example.file.split('/').pop() ?? 'file.dump');
    const { parseFile } = await import('@atlas/parsers');
    const result = await parseFile(fileObj);
    assertViewerLoadCurrent(options.isCurrent);

    if (!result.trajectory) {
      throw new Error('No trajectory data found');
    }

    const trajectory = applyCatalogSemantics(result.trajectory, example);
    const actualAtoms = trajectory.frames[0]?.natoms ?? 0;
    if (actualAtoms > profile.maxAtoms) {
      const message = oversizeMessage(example.title, actualAtoms, profile.maxAtoms, '');
      useStore.getState().setError(message);
      return { ok: false, message };
    }

    const parsedStore = useStore.getState();
    parsedStore.setFile({
      name: example.title,
      size: blob.size,
      trajectory,
      thermo: result.thermo ?? null,
      sourceUrl: url,
    }, { initialShowBonds: example.initialShowBonds });
    if (example.colorBy && result.trajectory.frames[0]?.properties?.has(example.colorBy)) {
      parsedStore.setColorScheme('property');
      parsedStore.setColorProperty(example.colorBy);
    }
    if (example.initialAtomScale != null && Number.isFinite(example.initialAtomScale)) {
      useStore.setState({ atomScale: example.initialAtomScale });
    }
    if (example.initialBackgroundPreset) {
      useStore.setState({ backgroundPreset: example.initialBackgroundPreset });
    }
    if (example.autoPlay && result.trajectory.totalFrames > 1) {
      useStore.setState({ playing: true });
    }
    attachScienceBundle(example);
    await loadKnowledgeLabels(example, options.isCurrent);
    assertViewerLoadCurrent(options.isCurrent);
    void loadOutputSidecars(example);
    return resultFromCurrentFile();
  } catch (err: unknown) {
    if (err instanceof ViewerLoadSupersededError || !viewerLoadIsCurrent(options.isCurrent)) {
      return { ok: false, message: 'Viewer load was superseded by newer navigation.' };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Gallery load failed for ${example.id}:`, message);
    const publicMessage = `Could not load "${example.title}" - try dragging the file directly.`;
    useStore.getState().setError(publicMessage);
    return { ok: false, message: publicMessage };
  }
}
