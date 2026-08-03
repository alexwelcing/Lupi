import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  collection,
  type Timestamp,
} from 'firebase/firestore';
import {
  ELEMENT_DATA,
  hasAngstromDistances,
  hasCompleteElementMapping,
  resolveAtomicNumber,
} from '@atlas/core';
import type { Frame } from '@atlas/core/types';
import { firebaseDb } from './auth/firebase';
import { loadInlineMolecule, loadMoleculeSource } from './loadMoleculeSource';
import { assertAllowedRemoteMoleculeUrl } from './remoteMoleculeUrlPolicy';
import { useStore, sanitizeEnvironmentPreset, type AppState, type LoadedFile } from './store';
import {
  measurementForInlineSnapshot,
  sanitizeMolecularMeasurement,
} from './measurements';
import {
  assertViewerLoadCurrent,
  viewerLoadIsCurrent,
  type ViewerLoadGuard,
} from './viewer/loadGuard';

export const SAVED_VIEW_SCHEMA_VERSION = 1;
const VIEW_COLLECTION = 'lupiViews';
const INLINE_XYZ_ATOM_LIMIT = 5_000;

export interface SavedMolecularView {
  schemaVersion: 1;
  slug: string;
  title: string;
  ownerId: string;
  visibility: 'public';
  molecule: SavedMoleculeSource;
  view: CanonicalMolecularView;
  exportDefaults: {
    baseName: string;
    canonicalSlug: string;
  };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type SavedMoleculeSource =
  | {
      kind: 'url';
      name: string;
      url: string;
      size: number;
      atomCount: number;
      totalFrames: number;
    }
  | {
      kind: 'inline-xyz';
      name: string;
      xyz: string;
      atomCount: number;
      totalFrames: number;
    };

export interface CanonicalMolecularView {
  frame: number;
  color: Pick<AppState, 'colorScheme' | 'atomColorSource' | 'colorMode' | 'colorProperty' | 'colormap' | 'uniformAtomColor' | 'elementColorOverrides' | 'propRange'>;
  display: Pick<AppState,
    | 'showCell'
    | 'showAxes'
    | 'showBonds'
    | 'bondCutoff'
    | 'bondTolerance'
    | 'bondColorMode'
    | 'bondThresholdMode'
    | 'bondPercentileRange'
    | 'grDrivenCutoff'
    | 'filamentMode'
    | 'meamScreening'
    | 'atomScale'
    | 'backgroundPreset'
    | 'backgroundStyle'
    | 'backgroundMotionPaused'
    | 'backgroundMotionSpeed'
    | 'backgroundOpacity'
    | 'backgroundBrightness'
    | 'backgroundSaturation'
    | 'backgroundContrast'
    | 'backgroundYawDegrees'
    | 'backgroundPitchDegrees'
  >;
  material: Pick<AppState,
    | 'environmentPreset'
    | 'materialPreset'
    | 'materialScene'
    | 'materialIntensity'
    | 'atomTexture'
    | 'surfaceRoughness'
    | 'surfacePolish'
    | 'surfaceClearcoat'
  >;
  lighting: Pick<AppState,
    | 'ambientLightIntensity'
    | 'dirLightIntensity'
    | 'rimLightIntensity'
    | 'keyLightAzimuth'
    | 'keyLightElevation'
    | 'fillLightAzimuth'
    | 'fillLightElevation'
    | 'rimLightAzimuth'
    | 'rimLightElevation'
    | 'fillLightColor'
    | 'rimLightColor'
  >;
  effects: Pick<AppState,
    | 'postprocessPreset'
    | 'postprocessIntensity'
    | 'propertyEmissionStrength'
    | 'ssao'
    | 'ssaoIntensity'
    | 'bloom'
    | 'bloomIntensity'
    | 'dof'
    | 'autoDepthOfField'
    | 'dofFocus'
    | 'toneMapping'
    | 'antialiasing'
  >;
  playback: Pick<AppState, 'playbackSpeed' | 'loopMode'>;
  camera: Pick<AppState, 'cameraPosition' | 'cameraTarget' | 'cameraFov' | 'cameraPreset'>;
  publication: Pick<AppState, 'showScaleBar' | 'colorblindMode' | 'viewportMode'>;
  annotations: Pick<AppState, 'annotations' | 'labelStyle'>;
  /** Derived measurement definition only. Numeric results are recomputed from
   * the reloaded frame so a saved view never upgrades a display calculation
   * into source evidence. Optional for schema-v1 backwards compatibility. */
  analysis?: Pick<AppState, 'measurement'>;
  knowledgeLabels: Pick<AppState, 'knowledgeLabelSearchQuery' | 'knowledgeLabelSearchFilter' | 'pinnedKnowledgeLabelIds'>;
  atomVisibility: {
    hiddenAtomTypes: number[];
    atomTypeScales: Record<number, number>;
  };
  flythrough: AppState['flythrough'];
}

export function slugifySavedViewTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function defaultSavedViewTitle(file: LoadedFile | null): string {
  const base = file?.name?.replace(/^MCP:\s*/i, '').replace(/\.[a-z0-9]+$/i, '') || 'Lupi View';
  return `${base} Publish`;
}

export function makeSavedViewUrl(slug: string): string {
  const encodedSlug = encodeURIComponent(slug);
  if (typeof window === 'undefined') return `/view/${encodedSlug}`;
  return `${window.location.origin}/view/${encodedSlug}`;
}

export async function saveCurrentMolecularView({
  slug,
  title,
  user,
}: {
  slug?: string;
  title: string;
  user: User;
}): Promise<{ url: string; view: SavedMolecularView }> {
  if (!firebaseDb) throw new Error('Firebase database is not configured.');

  // Ensure the Firebase ID token is fresh before Firestore writes. Stale or
  // expired tokens are the most common cause of "insufficient privilege" errors
  // when the user is otherwise signed in.
  const token = await withTimeout(
    user.getIdToken(true),
    10_000,
    'Sign-in session refresh timed out.',
  );
  if (!token) throw new Error('Your sign-in session could not be verified. Please sign in again.');

  const baseSlug = slugifySavedViewTitle(slug || title || defaultSavedViewTitle(useStore.getState().file));
  if (baseSlug.length < 3) throw new Error('Pick a title or slug with at least 3 URL-safe characters.');

  // Default to a unique slug. If the user explicitly chose a slug that they
  // already own, reuse it (update). If it belongs to someone else or is
  // orphaned, append a short random suffix so the save always succeeds.
  const cleanSlug = await findUniqueSlug(baseSlug, user.uid);
  const ref = doc(firebaseDb, VIEW_COLLECTION, cleanSlug);
  const current = await getDoc(ref);

  const molecule = readMoleculeSource();
  let canonicalView = captureCanonicalView();
  if (molecule.kind === 'inline-xyz') {
    const state = useStore.getState();
    const snapshotFrame = state.file?.trajectory.frames[state.frame]
      ?? state.file?.trajectory.frames[0];
    canonicalView = {
      ...canonicalView,
      frame: 0,
      analysis: {
        measurement: snapshotFrame
          ? measurementForInlineSnapshot(snapshotFrame, state.frame, state.measurement)
          : null,
      },
    };
  }

  const view: SavedMolecularView = {
    schemaVersion: SAVED_VIEW_SCHEMA_VERSION,
    slug: cleanSlug,
    title: title.trim() || defaultSavedViewTitle(useStore.getState().file),
    ownerId: user.uid,
    visibility: 'public',
    molecule,
    view: canonicalView,
    exportDefaults: {
      baseName: cleanSlug,
      canonicalSlug: cleanSlug,
    },
  };

  const write = async () => setDoc(ref, {
    ...view,
    createdAt: current.exists() ? current.data().createdAt ?? serverTimestamp() : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await write();
  } catch (firstError) {
    // Retry once on a permission-denied error after forcing another token
    // refresh — this covers edge cases where the first refresh produced a
    // token that was invalidated before the write reached Firestore.
    if (isFirestorePermissionDenied(firstError)) {
      await withTimeout(user.getIdToken(true), 10_000, 'Sign-in session refresh timed out.');
      await write();
    } else {
      throw firstError;
    }
  }

  return { url: makeSavedViewUrl(cleanSlug), view };
}

export async function loadSavedMolecularView(
  slug: string,
  options: { isCurrent?: ViewerLoadGuard } = {},
): Promise<SavedMolecularView> {
  assertViewerLoadCurrent(options.isCurrent);
  if (!firebaseDb) throw new Error('Firebase database is not configured.');
  const cleanSlug = slugifySavedViewTitle(slug);
  const snap = await getDoc(doc(firebaseDb, VIEW_COLLECTION, cleanSlug));
  assertViewerLoadCurrent(options.isCurrent);
  if (!snap.exists()) throw new Error(`No Lupi view found for "${cleanSlug}".`);

  const saved = snap.data() as SavedMolecularView;
  await loadSavedMolecule(saved.molecule, options);
  assertViewerLoadCurrent(options.isCurrent);
  applyCanonicalView(saved.view);
  window.setTimeout(() => {
    if (viewerLoadIsCurrent(options.isCurrent)) applyCanonicalView(saved.view);
  }, 90);
  return saved;
}

export async function listUserSavedViews(uid: string): Promise<SavedMolecularView[]> {
  if (!firebaseDb) return [];
  const viewsQuery = query(collection(firebaseDb, VIEW_COLLECTION), where('ownerId', '==', uid), limit(8));
  const snaps = await getDocs(viewsQuery);
  return snaps.docs.map((viewDoc) => viewDoc.data() as SavedMolecularView);
}

export function readMoleculeSource(): SavedMoleculeSource {
  const file = useStore.getState().file;
  const frameIndex = useStore.getState().frame;
  const frame = file?.trajectory.frames[frameIndex] ?? file?.trajectory.frames[0];
  if (!file || !frame) throw new Error('Open a molecule before saving a view.');

  const atomCount = frame.natoms;
  const totalFrames = file.trajectory.totalFrames;
  if (file.sourceUrl && file.sourceUrl !== 'procedural') {
    try {
      const allowed = assertAllowedRemoteMoleculeUrl(file.sourceUrl, 'saved-view', currentOrigin());
      return {
        kind: 'url',
        name: file.name,
        url: allowed.url,
        size: file.size,
        atomCount,
        totalFrames,
      };
    } catch {
      // Public saved views must never republish an untrusted automatic URL.
      // Small structures use the already-loaded frame as a safe inline fallback.
    }
  }

  if (atomCount <= INLINE_XYZ_ATOM_LIMIT) {
    if (!hasCompleteElementMapping(frame)) {
      throw new Error(
        'This view cannot use an inline XYZ fallback because its atom types do not have a complete element mapping. Provide an allowlisted reloadable source or map every type to an element before saving.',
      );
    }
    if (!hasAngstromDistances(frame)) {
      throw new Error(
        'This view cannot use an inline XYZ fallback because its coordinate units are unknown. Provide an allowlisted reloadable source or explicit angstrom metadata before saving.',
      );
    }
    return {
      kind: 'inline-xyz',
      name: `${file.name.replace(/\.[a-z0-9]+$/i, '') || 'lupi-view'}.xyz`,
      xyz: frameToXyz(file.name, frame),
      atomCount,
      totalFrames: 1,
    };
  }

  throw new Error('This molecule needs a reloadable source before it can be saved.');
}

function captureCanonicalView(): CanonicalMolecularView {
  const s = useStore.getState();
  return cleanJson({
    frame: s.frame,
    color: pick(s, ['colorScheme', 'atomColorSource', 'colorMode', 'colorProperty', 'colormap', 'uniformAtomColor', 'elementColorOverrides', 'propRange']),
    display: pick(s, [
      'showCell',
      'showAxes',
      'showBonds',
      'bondCutoff',
      'bondTolerance',
      'bondColorMode',
      'bondThresholdMode',
      'bondPercentileRange',
      'grDrivenCutoff',
      'filamentMode',
      'meamScreening',
      'atomScale',
      'backgroundPreset',
      'backgroundStyle',
      'backgroundMotionPaused',
      'backgroundMotionSpeed',
      'backgroundOpacity',
      'backgroundBrightness',
      'backgroundSaturation',
      'backgroundContrast',
      'backgroundYawDegrees',
      'backgroundPitchDegrees',
      'backgroundBackdropShape',
      'backgroundBackdropPattern',
      'backgroundBackdropRadius',
    ]),
    material: pick(s, [
      'environmentPreset',
      'materialPreset',
      'materialScene',
      'materialIntensity',
      'atomTexture',
      'surfaceRoughness',
      'surfacePolish',
      'surfaceClearcoat',
    ]),
    lighting: pick(s, [
      'ambientLightIntensity',
      'dirLightIntensity',
      'rimLightIntensity',
      'keyLightAzimuth',
      'keyLightElevation',
      'fillLightAzimuth',
      'fillLightElevation',
      'rimLightAzimuth',
      'rimLightElevation',
      'fillLightColor',
      'rimLightColor',
    ]),
    effects: pick(s, [
      'postprocessPreset',
      'postprocessIntensity',
      'propertyEmissionStrength',
      'ssao',
      'ssaoIntensity',
      'bloom',
      'bloomIntensity',
      'dof',
      'autoDepthOfField',
      'dofFocus',
      'toneMapping',
      'antialiasing',
    ]),
    playback: pick(s, ['playbackSpeed', 'loopMode']),
    camera: pick(s, ['cameraPosition', 'cameraTarget', 'cameraFov', 'cameraPreset']),
    publication: pick(s, ['showScaleBar', 'colorblindMode', 'viewportMode']),
    annotations: pick(s, ['annotations', 'labelStyle']),
    analysis: pick(s, ['measurement']),
    knowledgeLabels: pick(s, ['knowledgeLabelSearchQuery', 'knowledgeLabelSearchFilter', 'pinnedKnowledgeLabelIds']),
    atomVisibility: {
      hiddenAtomTypes: Array.from(s.hiddenAtomTypes),
      atomTypeScales: s.atomTypeScales,
    },
    flythrough: s.flythrough,
  }) as CanonicalMolecularView;
}

function applyCanonicalView(view: CanonicalMolecularView) {
  const file = useStore.getState().file;
  const maxFrame = Math.max(0, (file?.trajectory.totalFrames ?? 1) - 1);
  const requestedFrame = Number.isSafeInteger(view.frame) ? view.frame : 0;
  const frame = Math.max(0, Math.min(requestedFrame, maxFrame));
  const measurement = sanitizeMolecularMeasurement(view.analysis?.measurement);
  const atomVisibility = view.atomVisibility ?? { hiddenAtomTypes: [], atomTypeScales: {} };
  const knowledgeLabels = view.knowledgeLabels ?? {};
  // Views saved before the softbox studio existed may carry the retired
  // 'apartment' environment; sanitize instead of spreading it into the store.
  const material = { ...(view.material ?? {}) };
  if (material.environmentPreset !== undefined) {
    material.environmentPreset = sanitizeEnvironmentPreset(material.environmentPreset);
  }
  useStore.setState({
    ...(view.color ?? {}),
    ...(view.display ?? {}),
    ...material,
    ...(view.lighting ?? {}),
    ...(view.effects ?? {}),
    ...(view.playback ?? {}),
    ...(view.camera ?? {}),
    ...(view.publication ?? {}),
    ...(view.annotations ?? {}),
    ...(knowledgeLabels ?? {}),
    measurement,
    measurementTool: null,
    selectedAtoms: [],
    flythrough: view.flythrough ?? null,
    hiddenAtomTypes: new Set(atomVisibility.hiddenAtomTypes ?? []),
    atomTypeScales: atomVisibility.atomTypeScales ?? {},
    frame,
    playing: false,
    activePanel: null,
  });
}

export async function loadSavedMolecule(
  molecule: SavedMoleculeSource,
  options: { isCurrent?: ViewerLoadGuard } = {},
): Promise<void> {
  if (molecule.kind === 'url') {
    const allowed = assertAllowedRemoteMoleculeUrl(molecule.url, 'saved-view', currentOrigin());
    await loadMoleculeSource(allowed.url, { strictRemote: true, isCurrent: options.isCurrent });
    return;
  }
  await loadInlineMolecule(
    molecule.name,
    molecule.xyz,
    `lupi-view://${molecule.name}`,
    { isCurrent: options.isCurrent },
  );
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? 'https://lupi.live' : window.location.origin;
}

function frameToXyz(name: string, frame: Frame): string {
  if (!hasCompleteElementMapping(frame)) {
    throw new Error(
      'Inline XYZ serialization requires a complete element mapping for every atom type.',
    );
  }
  if (!hasAngstromDistances(frame)) {
    throw new Error('Inline XYZ serialization requires coordinates known to be in angstroms.');
  }
  const lines = [String(frame.natoms), name];
  for (let i = 0; i < frame.natoms; i += 1) {
    const atomicNumber = resolveAtomicNumber(frame, frame.types[i])!;
    const element = ELEMENT_DATA[atomicNumber].symbol;
    const x = frame.positions[i * 3] ?? 0;
    const y = frame.positions[i * 3 + 1] ?? 0;
    const z = frame.positions[i * 3 + 2] ?? 0;
    lines.push(`${element} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
  }
  return lines.join('\n');
}

function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  keys.forEach((key) => {
    result[key] = source[key];
  });
  return result;
}

function cleanJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isFirestorePermissionDenied(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'permission-denied';
}

async function findUniqueSlug(baseSlug: string, uid: string): Promise<string> {
  if (!firebaseDb) return baseSlug;
  const baseRef = doc(firebaseDb, VIEW_COLLECTION, baseSlug);
  const baseSnap = await getDoc(baseRef);
  if (!baseSnap.exists()) return baseSlug;

  const ownerId = baseSnap.data().ownerId;
  // The user explicitly re-used their own slug — update in place.
  if (ownerId === uid) return baseSlug;

  // Otherwise generate a short random suffix until we find a free slug.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = generateRandomSlugSuffix();
    const candidate = `${baseSlug}-${suffix}`;
    const candidateRef = doc(firebaseDb, VIEW_COLLECTION, candidate);
    const candidateSnap = await getDoc(candidateRef);
    if (!candidateSnap.exists()) return candidate;

    const candidateOwner = candidateSnap.data().ownerId;
    if (candidateOwner === uid) return candidate;
  }

  // Last resort: append a millisecond timestamp.
  return `${baseSlug}-${Date.now().toString(36)}`;
}

function generateRandomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer));
  });
}
