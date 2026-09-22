import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { alignPointsToMask, fitProportions, gistProfile, latheFromProfile, outlineBodyProfile, outlineProfile, profileMismatch, profileWords, type Alignment, type ColouredPoints, type Gist } from '@atlas/core/gist';
import { useStore } from '../store';
import { track, ANALYTICS_EVENTS } from '../analytics';
import { SCAN_SEO, useSeo } from '../seo';
import {
  identifyScan,
  prepareImage,
  scanCandidates,
  ScanError,
  SCAN_STATUS_LINES,
  type PreparedImage,
  type ScanCandidate,
  type ScanMolecule,
  type ScanResult,
} from './identify';
import { DEMO_GISTS, requestGist, requestPlan, requestReconstruct, requestSegment, type GistReply, type PlanReply, type ReconstructReply, type SegmentReply } from './gist/gistClient';
import { startSculptLoop, type SculptEvent, type SculptLoopHandle } from './gist/sculptLoop';
import { GistStage, moveWords, type StageLabel, type StageRenderer } from './gist/GistStage';
import { chooseRecipe, maskFromImage, stageFromMask, stageFromPhoto, type RecipeOutcome, type VolumeStage } from './gist/volumeStage';

/**
 * The remote acts, in order: Jev plans, SAM 3 confirms the mask, SAM 3D
 * rebuilds the object, the particles assemble it and the camera turns. Each
 * act is visible on the stage while it runs; the dev panel shows the rest.
 */
interface RemoteState {
  act: 'idle' | 'planning' | 'segmenting' | 'reconstructing' | 'assembling' | 'done' | 'skipped' | 'failed';
  plan: PlanReply | null;
  segment: SegmentReply | null;
  segmentApplied: boolean;
  reconstruct: ReconstructReply | null;
  alignment: Alignment | null;
  startedAt: number;
  note: string | null;
}

const REMOTE_IDLE: RemoteState = { act: 'idle', plan: null, segment: null, segmentApplied: false, reconstruct: null, alignment: null, startedAt: 0, note: null };
/** Particles the reconstruction is sampled to on the edge: one per particle at the default count. */
const RECONSTRUCT_POINTS = 60_000;
/** How long after the assembly starts the camera begins to turn, and how fast. */
const TURN_AFTER_MS = 3_200;
const TURN_RATE = 0.28;
import './scan.css';

/**
 * Point at something; get its shape and its molecules.
 *
 * One photo starts two edge calls at once: the gist (a label and a few
 * primitives, fast) and the identification (materials and molecules, a
 * little slower). Particles whirl over the photo until the gist lands, then
 * flow onto it and stay there while Jev sculpts the shape one judged move at
 * a time. The molecule cards materialize underneath when the identification
 * arrives. Every number on screen that came from a model is labeled as
 * inference.
 */
type Phase = 'idle' | 'preparing' | 'scanning' | 'done' | 'error' | 'unconfigured';

type MoleculeOpen =
  | { kind: 'gallery'; candidate: ScanCandidate; fit: number | null }
  | { kind: 'pubchem'; name: string };

interface GistState {
  gist: Gist | null;
  status: 'idle' | 'pending' | 'ready' | 'none';
  model?: string;
  ms?: number;
  cached?: boolean;
  /** Silhouette widths measured from the photo's outline, top to bottom; null without an outline. */
  photoProfile?: number[] | null;
  outlinePoints?: number;
  /** True when the free aspect fit changed the gist before Jev saw it. */
  fitted?: boolean;
  /** True when the body is the photo's outline revolved, not a primitive the model chose. */
  revolved?: boolean;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

async function openGallery(id: string): Promise<void> {
  // Code-split: the viewer's loader is the heavy half of the app.
  const { openMolecule } = await import('../viewer/openMolecule');
  const result = await openMolecule({ kind: 'gallery', id, history: 'push' });
  if (!result.ok) throw new Error(result.message);
}

async function openPubChem(name: string): Promise<void> {
  const { openPubChemMolecule } = await import('../molecules/pubchemLoad');
  await openPubChemMolecule({ name });
}

function demoFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const demo = new URLSearchParams(window.location.search).get('demo');
  return demo && DEMO_GISTS[demo] ? demo : null;
}

export function ScanPage() {
  useSeo(SCAN_SEO);
  const [phase, setPhase] = useState<Phase>('idle');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [renderer, setRenderer] = useState<StageRenderer>('pending');
  const [dragging, setDragging] = useState(false);
  const [gistState, setGistState] = useState<GistState>({ gist: null, status: 'idle' });
  const [sculptEvents, setSculptEvents] = useState<SculptEvent[]>([]);
  const [sculpting, setSculpting] = useState(false);
  const [demo, setDemo] = useState<string | null>(() => demoFromLocation());
  /** The photo's own shape: built on the device the moment the photo is ready, refined by Jev's recipe. */
  const [volumeStage, setVolumeStage] = useState<VolumeStage | null>(null);
  const [recipe, setRecipe] = useState<RecipeOutcome | null>(null);
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [remote, setRemote] = useState<RemoteState>(REMOTE_IDLE);
  const [points, setPoints] = useState<ColouredPoints | null>(null);
  const [spin, setSpin] = useState(0);
  const storeError = useStore((state) => state.error);
  const storeLoading = useStore((state) => state.loading);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const sculpt = useRef<SculptLoopHandle | null>(null);
  const stageRef = useRef<VolumeStage | null>(null);
  const id = useId();

  const candidates = useMemo(() => scanCandidates(), []);
  const candidateByKey = useMemo(() => new Map(candidates.map((candidate) => [candidate.key, candidate])), [candidates]);

  const stopSculpt = useCallback(() => {
    sculpt.current?.stop();
    sculpt.current = null;
    setSculpting(false);
  }, []);

  /* ─── The remote acts: Jev plans, SAM 3 masks, SAM 3D rebuilds, the particles assemble ─── */

  const runRemote = useCallback(async (prepared: PreparedImage, subject: string, signal: AbortSignal) => {
    const stage = stageRef.current;
    if (!stage?.masked) return;
    const startedAt = Date.now();
    setRemote({ ...REMOTE_IDLE, act: 'planning', startedAt });
    const plan = await requestPlan(subject, stage.candidate.features, { masked: stage.masked, pieces: stage.candidate.features.components }, signal).catch(() => null);
    if (signal.aborted) return;
    if (!plan || plan.configured === false || !plan.remote) {
      setRemote((state) => ({ ...state, act: 'skipped', plan, note: !plan ? 'the plan call failed' : plan.configured === false ? 'Jev is off' : 'no Hugging Face token on the edge' }));
      return;
    }
    setRemote((state) => ({ ...state, plan }));
    const image = { mediaType: prepared.mediaType, data: prepared.base64 };

    // Act one: SAM 3's mask, when Jev doubts the device's cut.
    if (plan.mask?.choice === 'sam3' && plan.services?.sam3.stage === 'RUNNING') {
      setRemote((state) => ({ ...state, act: 'segmenting' }));
      const segment = await requestSegment(image, subject, signal).catch(() => null);
      if (signal.aborted) return;
      let applied = false;
      const best = segment?.masks?.[0];
      const current = stageRef.current;
      if (best && current) {
        const mask = await maskFromImage(best.image, current.photo.width, current.photo.height).catch(() => null);
        if (signal.aborted) return;
        if (mask) {
          // Same photo object, so the particles hold; the volume under them is recut.
          const next = { ...stageFromMask(current.photo, mask, current.candidate.tolerance, current.volume.depth, current.volume.fatness), photo: current.photo };
          if (next.masked) {
            stageRef.current = next;
            setVolumeStage(next);
            applied = true;
          }
        }
      }
      setRemote((state) => ({ ...state, segment, segmentApplied: applied }));
    }

    // Act two: SAM 3D's reconstruction, when the subject is worth a turn.
    if (plan.reconstruct?.choice === 'sam3d' && plan.services?.sam3d.stage === 'RUNNING') {
      setRemote((state) => ({ ...state, act: 'reconstructing' }));
      const reconstruct = await requestReconstruct(image, subject, RECONSTRUCT_POINTS, signal).catch(() => null);
      if (signal.aborted) return;
      if (!reconstruct) {
        setRemote((state) => ({ ...state, act: 'failed', note: 'SAM 3D did not answer' }));
        return;
      }
      // Turn the reconstruction to face the way the photo saw it, then let every particle fly to its point.
      const mask = stageRef.current?.candidate.mask;
      const aligned = mask ? alignPointsToMask(reconstruct.points, mask) : null;
      setRemote((state) => ({ ...state, act: 'assembling', reconstruct, alignment: aligned?.alignment ?? null }));
      setPoints(aligned?.points ?? reconstruct.points);
      window.setTimeout(() => {
        if (signal.aborted) return;
        setSpin(TURN_RATE);
        setRemote((state) => (state.act === 'assembling' ? { ...state, act: 'done' } : state));
      }, TURN_AFTER_MS);
      return;
    }
    setRemote((state) => ({ ...state, act: 'done' }));
  }, []);

  /* ─── Jev sculpts the gist, fast ─── */
  const beginSculpt = useCallback(
    (subject: string, gist: Gist, photoProfile: number[] | null = null) => {
      stopSculpt();
      setSculptEvents([]);
      setSculpting(true);
      sculpt.current = startSculptLoop({
        subject,
        gist,
        photoProfile,
        onGist: (next) => setGistState((previous) => ({ ...previous, gist: next })),
        onEvent: (event) => setSculptEvents((previous) => [...previous, event]),
        onDone: () => setSculpting(false),
      });
    },
    [stopSculpt],
  );

  useEffect(
    () => () => {
      sculpt.current?.stop();
      abort.current?.abort();
    },
    [],
  );

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.previewUrl);
    },
    [image],
  );

  /* ─── Demo mode: a hand-built gist, no photo, no keys ─── */
  useEffect(() => {
    if (!demo) return;
    const gist = DEMO_GISTS[demo];
    setGistState({ gist, status: 'ready' });
    setPhase('done');
    setResult(null);
    beginSculpt(gist.label, gist);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per demo pick.
  }, [demo]);

  /* ─── Scanning ticker ─── */
  useEffect(() => {
    if (phase !== 'scanning' && phase !== 'preparing') return;
    const started = performance.now();
    const timer = setInterval(() => {
      const ms = performance.now() - started;
      setElapsed(ms);
      setStatusIndex(Math.min(SCAN_STATUS_LINES.length - 1, Math.floor(ms / 1400)));
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  /* ─── The pipeline: gist and identification in parallel ─── */
  const scan = useCallback(
    async (prepared: PreparedImage, hintText: string) => {
      abort.current?.abort();
      stopSculpt();
      const controller = new AbortController();
      abort.current = controller;
      setError(null);
      setResult(null);
      setSculptEvents([]);
      setGistState({ gist: null, status: 'pending' });
      setRecipe(null);
      setPhase('scanning');
      track(ANALYTICS_EVENTS.SCAN_STARTED, { hasHint: hintText.trim().length > 0, bytes: prepared.blob.size, width: prepared.width, height: prepared.height });

      const gistPromise = requestGist(prepared, hintText, controller.signal).then(async (reply: GistReply | null) => {
        if (controller.signal.aborted) return;
        // With a usable silhouette the shape is the photo's own; the model's
        // gist supplies the label, and Jev judges the recipe over candidate masks.
        if (reply?.gist && stageRef.current?.masked) {
          setGistState({ gist: reply.gist, status: 'ready', model: reply.model, ms: reply.timing?.ms, cached: reply.cached, outlinePoints: reply.outline?.length ?? 0 });
          setRecipeBusy(true);
          const outcome = await chooseRecipe(prepared.pixels, reply.gist.label, controller.signal).catch(() => null);
          if (controller.signal.aborted) return;
          setRecipeBusy(false);
          if (outcome?.configured) {
            setRecipe(outcome);
            // The same cut keeps the same photo object, so the particles are
            // not reseeded mid-settle; only the volume underneath them changes.
            const current = stageRef.current;
            const next = current && current.candidate.tolerance === outcome.stage.candidate.tolerance ? { ...outcome.stage, photo: current.photo } : outcome.stage;
            stageRef.current = next;
            setVolumeStage(next);
          }
          await runRemote(prepared, reply.gist.label, controller.signal);
          return;
        }
        if (reply?.gist) {
          // The measured step: the photo's own silhouette, as numbers. The
          // free aspect fit runs here, before Jev is asked anything.
          const photoProfile = reply.outline && reply.outline.length >= 3 ? outlineProfile(reply.outline) : null;
          // A revolved object gets the outline itself as its body: the exact
          // silhouette the camera saw, turned on a lathe. Everything else
          // keeps the model's body with its aspect fitted to the photo.
          const bodyProfile = reply.revolved && reply.outline && reply.outline.length >= 3 ? outlineBodyProfile(reply.outline) : null;
          const revolved = Boolean(bodyProfile && Math.max(...bodyProfile) > 0.05);
          const gist: Gist = revolved
            ? { ...reply.gist, primitives: [latheFromProfile(bodyProfile!), ...reply.gist.primitives.slice(1)] }
            : photoProfile
              ? fitProportions(reply.gist, photoProfile)
              : reply.gist;
          setGistState({
            gist,
            status: 'ready',
            model: reply.model,
            ms: reply.timing?.ms,
            cached: reply.cached,
            photoProfile,
            outlinePoints: reply.outline?.length ?? 0,
            fitted: !revolved && gist !== reply.gist,
            revolved,
          });
          beginSculpt(gist.label, gist, photoProfile);
        } else {
          setGistState({ gist: null, status: 'none' });
        }
      });

      try {
        const answer = await identifyScan({ image: prepared, hint: hintText, candidates }, controller.signal);
        if (controller.signal.aborted) return;
        if (!answer.configured) {
          setPhase('unconfigured');
          return;
        }
        setResult(answer);
        setPhase('done');
        const identification = answer.identification;
        track(ANALYTICS_EVENTS.SCAN_IDENTIFIED, {
          confidence: identification?.confidence ?? null,
          materials: identification?.materials.length ?? 0,
          molecules: identification?.materials.reduce((sum, material) => sum + material.molecules.length, 0) ?? 0,
          matched: answer.matches?.length ?? 0,
          jev: Boolean(answer.jev),
          cached: Boolean(answer.cached),
          ms: answer.timing?.totalMs ?? null,
          nothingToScan: identification?.nothingToScan ?? false,
        });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof ScanError ? caught.message : 'Something went wrong while scanning.');
        setPhase('error');
      }
      await gistPromise;
    },
    [beginSculpt, candidates, runRemote, stopSculpt],
  );

  const accept = useCallback(
    async (file: Blob | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setError('That is not an image. Try a photo.');
        setPhase('error');
        return;
      }
      setDemo(null);
      setPhase('preparing');
      setError(null);
      setResult(null);
      try {
        const prepared = await prepareImage(file);
        setImage((previous) => {
          if (previous) URL.revokeObjectURL(previous.previewUrl);
          return prepared;
        });
        // The shape, right now, from the photo alone: no network yet.
        const stage = stageFromPhoto(prepared.pixels);
        stageRef.current = stage;
        setVolumeStage(stage);
        await scan(prepared, hint);
      } catch (caught) {
        setError(caught instanceof ScanError ? caught.message : 'Could not read that photo.');
        setPhase('error');
      }
    },
    [hint, scan],
  );

  /* ─── Paste and drop anywhere on the page ─── */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        void accept(file);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [accept]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void accept(event.dataTransfer.files?.[0]);
  };

  const reset = () => {
    abort.current?.abort();
    stopSculpt();
    setPhase('idle');
    setResult(null);
    setError(null);
    setOpening(null);
    setDemo(null);
    setGistState({ gist: null, status: 'idle' });
    setSculptEvents([]);
    setVolumeStage(null);
    setRecipe(null);
    setRemote(REMOTE_IDLE);
    setPoints(null);
    setSpin(0);
    stageRef.current = null;
    setImage((previous) => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
    if (cameraInput.current) cameraInput.current.value = '';
    if (fileInput.current) fileInput.current.value = '';
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('demo');
      window.history.replaceState({}, '', url);
    }
  };

  const runDemo = (name: string) => {
    abort.current?.abort();
    setVolumeStage(null);
    setRemote(REMOTE_IDLE);
    setPoints(null);
    setSpin(0);
    stageRef.current = null;
    setImage((previous) => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
    setError(null);
    setDemo(name);
  };

  /* ─── Opening molecules ─── */
  const open = useCallback(
    async (target: MoleculeOpen, label: string) => {
      if (opening) return;
      setOpening(label);
      track(ANALYTICS_EVENTS.SCAN_MOLECULE_OPENED, { source: target.kind, fit: target.kind === 'gallery' ? target.fit : null });
      try {
        if (target.kind === 'gallery') await openGallery(target.candidate.galleryId);
        else await openPubChem(target.name);
      } catch {
        // The store carries the readable error; the page stays usable.
      } finally {
        setOpening(null);
      }
    },
    [opening],
  );

  const identification = result?.identification ?? null;
  const matches = useMemo(() => result?.matches ?? [], [result]);
  const fit = result?.jev?.fit ?? {};
  const matchByMolecule = useMemo(() => new Map(matches.map((match) => [`${match.molecule.material}\u0000${match.molecule.name}`, match])), [matches]);

  const targetFor = (materialName: string, molecule: ScanMolecule): MoleculeOpen => {
    const match = matchByMolecule.get(`${materialName}\u0000${molecule.name}`);
    const candidate = match ? candidateByKey.get(match.key) : undefined;
    if (candidate) return { kind: 'gallery', candidate, fit: typeof fit[candidate.key] === 'number' ? fit[candidate.key] : null };
    return { kind: 'pubchem', name: molecule.name };
  };

  const jevBest = result?.jev?.best && result.jev.best.confidence >= 0.3 ? candidateByKey.get(result.jev.best.key) ?? null : null;
  const busy = phase === 'preparing' || phase === 'scanning';
  const showStage = image !== null || demo !== null;
  const gist = gistState.gist;
  const latestLikeness = [...sculptEvents].reverse().find((event) => event.likeness !== null)?.likeness ?? null;
  const lastApplied = [...sculptEvents].reverse().find((event) => event.applied)?.move ?? null;
  const stageLabel: StageLabel | null = gist
    ? {
        text: gist.label,
        confidence: gist.confidence,
        likeness: latestLikeness,
        judgments: sculptEvents.length,
        lastMove: lastApplied,
        sculpting,
        model: sculptEvents[sculptEvents.length - 1]?.model,
      }
    : null;
  // While the remote acts run, the stage says so: the viewer is watching the
  // on-device shape hold, and should know something better is on its way.
  const remoteLine =
    remote.act === 'segmenting'
      ? 'SAM 3 is checking the outline…'
      : remote.act === 'reconstructing'
        ? 'SAM 3D is rebuilding it in the round…'
        : remote.act === 'assembling'
          ? 'Assembling…'
          : null;
  const stageStatus = busy
    ? {
        line:
          phase === 'preparing'
            ? 'Getting the photo ready…'
            : gistState.status === 'ready'
              ? 'Now the molecules…'
              : SCAN_STATUS_LINES[statusIndex],
        elapsedMs: elapsed,
      }
    : remoteLine
      ? { line: remoteLine, elapsedMs: Date.now() - remote.startedAt }
      : null;

  return (
    <main id="main" className="student-home scan">
      <section className="student-hero student-hero--finder student-width scan-hero" aria-labelledby="scan-title">
        <p className="student-eyebrow">Molecular scanner</p>
        <h1 id="scan-title">
          Point at anything.
          <br />
          Watch it take shape.
        </h1>
        <p className="student-deck">
          Eggs, a screw, your coffee. Take a photo: particles whirl into its shape while Lupi names what it&rsquo;s made of,
          molecule by molecule, and opens each one in 3D. The photo is resized on your device and never stored.
        </p>
      </section>

      <section className="student-width scan-body" aria-live="polite">
        {!showStage && (
          <div
            className={`scan-drop${dragging ? ' is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div className="scan-actions">
              <button type="button" className="student-primary scan-capture" onClick={() => cameraInput.current?.click()} disabled={busy}>
                <span aria-hidden="true">📷</span> Take a photo
              </button>
              <button type="button" className="student-secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
                Choose an image
              </button>
            </div>
            <p className="scan-drop-hint">or drop an image here, or paste one from your clipboard</p>
            <label className="scan-hint" htmlFor={`${id}-hint`}>
              <span>Optional hint</span>
              <input
                id={`${id}-hint`}
                type="text"
                maxLength={200}
                placeholder="e.g. it's a candle, it's my dog's collar"
                value={hint}
                onChange={(event) => setHint(event.target.value)}
              />
            </label>
            <p className="scan-demo-links">
              No camera handy? Watch the particles find a shape:
              {Object.keys(DEMO_GISTS).map((name) => (
                <a
                  key={name}
                  href={`/scan?demo=${name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    runDemo(name);
                  }}
                >
                  {DEMO_GISTS[name].label}
                </a>
              ))}
            </p>
            {phase === 'error' && error && <p className="finder-error" role="alert">{error}</p>}
            {phase === 'unconfigured' && (
              <p className="finder-error" role="alert">
                The scanner is not switched on for this deployment yet. It needs an <code>ANTHROPIC_API_KEY</code> on the edge Worker.
              </p>
            )}
          </div>
        )}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => void accept(event.target.files?.[0])}
        />
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void accept(event.target.files?.[0])} />

        {showStage && (
          <GistStage
            photoUrl={image?.previewUrl ?? null}
            photoWidth={image?.width}
            photoHeight={image?.height}
            photoPixels={volumeStage?.photo ?? image?.pixels ?? null}
            points={points}
            spin={spin}
            active={busy}
            gist={gist}
            volume={volumeStage?.masked ? volumeStage.volume : null}
            palette={volumeStage?.masked ? volumeStage.palette : null}
            settled={phase === 'done'}
            status={stageStatus}
            label={stageLabel}
            onRenderer={setRenderer}
          />
        )}

        {showStage && phase === 'error' && error && (
          <div className="scan-panel scan-panel--error" role="alert">
            <p>{error}</p>
            <div className="scan-actions">
              <button type="button" className="student-primary" onClick={() => image && void scan(image, hint)}>
                Try again
              </button>
              <button type="button" className="student-secondary" onClick={reset}>
                Different photo
              </button>
            </div>
          </div>
        )}

        {showStage && phase === 'unconfigured' && (
          <div className="scan-panel scan-panel--error" role="alert">
            <p>
              The scanner is not switched on for this deployment yet. It needs an <code>ANTHROPIC_API_KEY</code> on the edge
              Worker. See <code>docs/scan-pipeline.md</code>.
            </p>
            <button type="button" className="student-secondary" onClick={reset}>
              Back
            </button>
          </div>
        )}

        {demo && phase === 'done' && !identification && (
          <div className="scan-panel scan-again">
            <p>
              A hand-built {DEMO_GISTS[demo].label}: the same shape vocabulary the model writes from a photo. With the edge keys
              set, Jev sculpts it live.
            </p>
            <div className="scan-actions">
              <button type="button" className="student-primary" onClick={reset}>
                Scan something real
              </button>
            </div>
          </div>
        )}

        {phase === 'done' && identification && (
          <div className="scan-result">
            {identification.nothingToScan ? (
              <div className="scan-panel">
                <h2>Nothing to scan here.</h2>
                <p>{identification.headline || 'That looks like a blank frame or a screen. Point at a physical thing.'}</p>
                <button type="button" className="student-primary" onClick={reset}>
                  Scan something else
                </button>
              </div>
            ) : (
              <>
                <header className="scan-verdict">
                  <p className="student-eyebrow">
                    Looks like <span className="scan-inference">inferred · {percent(identification.confidence)}</span>
                  </p>
                  <h2>{identification.subject}</h2>
                  {identification.headline && <p className="scan-headline">{identification.headline}</p>}
                  {identification.guesses.length > 1 && (
                    <ul className="scan-guesses" aria-label="Other possibilities">
                      {identification.guesses.map((guess) => (
                        <li key={guess.label}>
                          <span className="scan-bar" style={{ ['--share' as string]: guess.probability }} aria-hidden="true" />
                          <span className="scan-guess-label">{guess.label}</span>
                          <span className="scan-guess-value">{percent(guess.probability)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {identification.elements.length > 0 && (
                    <p className="scan-elements">
                      Mostly <strong>{identification.elements.join(' · ')}</strong> by mass
                    </p>
                  )}
                </header>

                {jevBest && (
                  <div className="scan-panel scan-jev">
                    <div className="finder-text">
                      <strong>Open {jevBest.title} first</strong>
                      <small>
                        Jev&rsquo;s pick · {percent(result?.jev?.best?.confidence ?? 0)} · inferred
                        {result?.model?.jev ? ` · ${result.model.jev}` : ''}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="student-primary"
                      disabled={opening !== null || storeLoading}
                      onClick={() => void open({ kind: 'gallery', candidate: jevBest, fit: fit[jevBest.key] ?? null }, jevBest.key)}
                    >
                      {opening === jevBest.key ? 'Opening…' : 'Open in 3D ↗'}
                    </button>
                  </div>
                )}

                <ol className="scan-materials">
                  {identification.materials.map((material) => (
                    <li key={material.name} className="scan-material">
                      <div className="scan-material-head">
                        <h3>{material.name}</h3>
                        <span className="scan-share" aria-label={`about ${percent(material.share)} of it`}>
                          <span className="scan-bar" style={{ ['--share' as string]: material.share }} aria-hidden="true" />
                          {percent(material.share)}
                        </span>
                      </div>
                      {material.summary && <p>{material.summary}</p>}
                      <ul className="scan-molecules">
                        {material.molecules.map((molecule) => {
                          const target = targetFor(material.name, molecule);
                          const key = `${material.name}:${molecule.name}`;
                          const gallery = target.kind === 'gallery';
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                className={`scan-molecule${gallery ? ' is-gallery' : ''}`}
                                disabled={opening !== null || storeLoading}
                                onClick={() => void open(target, key)}
                              >
                                {gallery && target.candidate.image ? (
                                  <img src={target.candidate.image} alt="" width="40" height="40" loading="lazy" decoding="async" />
                                ) : (
                                  <span className="finder-glyph" aria-hidden="true">
                                    {gallery ? '◉' : '⌕'}
                                  </span>
                                )}
                                <span className="finder-text">
                                  <strong>
                                    {molecule.name}
                                    {molecule.formula && <em className="scan-formula"> {molecule.formula}</em>}
                                  </strong>
                                  <small>
                                    {molecule.role}
                                    {molecule.share !== null && ` · ~${percent(molecule.share)}`}
                                    {gallery && typeof target.fit === 'number' && ` · fit ${percent(target.fit)} inferred`}
                                  </small>
                                </span>
                                <span className="scan-open" aria-hidden="true">
                                  {opening === key ? 'Opening…' : gallery ? 'Open in 3D ↗' : 'PubChem ↗'}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ol>

                {storeError && <p className="finder-error" role="alert">{storeError}</p>}

                <div className="scan-panel scan-again">
                  <label className="scan-hint" htmlFor={`${id}-rehint`}>
                    <span>Not {identification.subject.toLowerCase()}? Tell it what it is</span>
                    <input
                      id={`${id}-rehint`}
                      type="text"
                      maxLength={200}
                      placeholder="e.g. it's a ceramic mug, not a glass"
                      value={hint}
                      onChange={(event) => setHint(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && image) void scan(image, hint);
                      }}
                    />
                  </label>
                  <div className="scan-actions">
                    <button type="button" className="student-secondary" onClick={() => image && void scan(image, hint)}>
                      Scan again with the hint
                    </button>
                    <button type="button" className="student-primary" onClick={reset}>
                      Scan something else
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {phase === 'done' && (gist || identification || volumeStage) && (
          <details className="scan-dev">
            <summary>Under the hood</summary>
            <dl>
              <dt>Stage</dt>
              <dd>
                {renderer === 'particles' ? 'vgpu compute particles' : renderer === 'swirl' ? 'vgpu swirl (particles unavailable)' : renderer === 'css' ? 'CSS fallback' : 'starting'}
              </dd>
              <dt>Gist</dt>
              <dd>
                {gist
                  ? `${gist.primitives.length} primitive${gist.primitives.length === 1 ? '' : 's'} · ${gistState.model ?? (demo ? 'hand-built demo' : '—')} · ${formatMs(gistState.ms)}${gistState.cached ? ' · edge cache' : ''}`
                  : gistState.status === 'none'
                    ? 'no sketch came back'
                    : '—'}
              </dd>
              <dt>Shape</dt>
              <dd>
                {volumeStage?.masked
                  ? `the photo's own silhouette, inflated: ${volumeStage.volume.filled.toLocaleString()} of ${(volumeStage.volume.n ** 3).toLocaleString()} cells · ${volumeStage.volume.depth} · fatness ${volumeStage.volume.fatness} · cut at ${volumeStage.candidate.tolerance} · fill ${(volumeStage.candidate.features.fill * 100).toFixed(0)}% · ${volumeStage.candidate.features.components} piece${volumeStage.candidate.features.components === 1 ? '' : 's'} before cleanup`
                  : volumeStage
                    ? 'nothing stood out from the background; the model\u2019s primitives stand in'
                    : demo
                      ? 'hand-built primitives'
                      : '—'}
              </dd>
              <dt>Recipe</dt>
              <dd>
                {recipeBusy
                  ? 'asking Jev about the candidate silhouettes…'
                  : recipe?.configured
                    ? `${recipe.judged.length} silhouettes judged in parallel · winner cut at ${recipe.judged[0].tolerance} reads ${percent(recipe.judged[0].reply.reads ?? 0)} · ${recipe.winner.depth?.choice ?? '—'} ${percent(recipe.winner.depth?.confidence ?? 0)} · ${recipe.winner.fatness?.choice ?? '—'} ${percent(recipe.winner.fatness?.confidence ?? 0)} · ${recipe.judged.map((entry) => `${entry.tolerance}: ${percent(entry.reply.reads ?? 0)} ${entry.reply.depth?.choice ?? ''} ${formatMs(entry.reply.timing?.ms)}`).join(' · ')}`
                    : volumeStage?.masked
                      ? 'not judged (Jev off, or no answer)'
                      : '—'}
              </dd>
              <dt>Plan</dt>
              <dd>
                {remote.act === 'planning'
                  ? 'asking Jev whether the remote models are worth the wait…'
                  : remote.plan?.configured
                    ? `mask ${remote.plan.mask?.choice ?? '—'} ${percent(remote.plan.mask?.confidence ?? 0)} · reconstruct ${remote.plan.reconstruct?.choice ?? '—'} ${percent(remote.plan.reconstruct?.confidence ?? 0)} · a turn gains ${percent(remote.plan.gains ?? 0)} · SAM 3 ${remote.plan.services?.sam3.stage.toLowerCase() ?? '?'} on ${remote.plan.services?.sam3.hardware ?? '?'} · SAM 3D ${remote.plan.services?.sam3d.stage.toLowerCase() ?? '?'} on ${remote.plan.services?.sam3d.hardware ?? '?'} · ${formatMs(remote.plan.timing?.ms)}`
                    : remote.act === 'skipped'
                      ? `not planned: ${remote.note ?? 'no reason given'}`
                      : '—'}
              </dd>
              <dt>SAM 3</dt>
              <dd>
                {remote.act === 'segmenting'
                  ? 'asking SAM 3 for the subject’s mask…'
                  : remote.segment
                    ? `${remote.segment.masks?.length ?? 0} mask${(remote.segment.masks?.length ?? 0) === 1 ? '' : 's'} · best ${remote.segment.masks?.[0]?.label ?? '—'} · ${remote.segmentApplied ? 'the volume was recut from it' : 'kept the device’s cut'} · ${formatMs(remote.segment.timing?.ms)} via ${remote.segment.space ?? '?'}`
                    : remote.plan?.mask?.choice === 'device'
                      ? 'not asked: Jev trusted the device’s cut'
                      : '—'}
              </dd>
              <dt>SAM 3D</dt>
              <dd>
                {remote.act === 'reconstructing'
                  ? `SAM 3D Objects is rebuilding the subject… ${Math.round((Date.now() - remote.startedAt) / 1000)} s`
                  : remote.reconstruct
                    ? `${remote.reconstruct.triangles.toLocaleString()} triangles → ${remote.reconstruct.points.count.toLocaleString()} coloured points · turned ${remote.alignment ? `${Math.round((remote.alignment.yaw * 180) / Math.PI)}°${remote.alignment.mirrored ? ' mirrored' : ''} to match the photo (overlap ${remote.alignment.overlap.toFixed(2)})` : 'as it came'} · ${formatMs(remote.reconstruct.spaceMs ?? undefined)} on the Space, ${formatMs(remote.reconstruct.ms ?? undefined)} in all · ${remote.act === 'done' ? 'assembled, turning' : 'assembling'}`
                    : remote.act === 'failed'
                      ? `failed: ${remote.note ?? 'no detail'}`
                      : remote.plan?.reconstruct?.choice === 'skip'
                        ? 'not asked: Jev judged a turn not worth the wait'
                        : '—'}
              </dd>
              <dt>Silhouette</dt>
              <dd>
                {gistState.photoProfile && gist
                  ? `photo ${profileWords(gistState.photoProfile)} · shape ${profileWords(gistProfile(gist))} · mismatch ${profileMismatch(gistProfile(gist), gistState.photoProfile).toFixed(3)}${gistState.revolved ? ' · body is the outline revolved' : gistState.fitted ? ' · aspect fitted before Jev' : ''} · ${gistState.outlinePoints} outline points`
                  : demo
                    ? 'no photo to measure against'
                    : 'no outline came back; Jev judged by words alone'}
              </dd>
              <dt>Sculpting</dt>
              <dd>
                {sculptEvents.length === 0
                  ? sculpting
                    ? 'asking Jev…'
                    : 'no judgments (Jev off, or nothing to judge)'
                  : `${sculptEvents.length} judgments · ${sculptEvents.filter((event) => event.applied).length} applied · median ${formatMs(
                      [...sculptEvents].map((event) => event.ms).sort((a, b) => a - b)[Math.floor(sculptEvents.length / 2)],
                    )} each${sculptEvents[0]?.model ? ` · ${sculptEvents[0].model}` : ''}`}
              </dd>
              {result && (
                <>
                  <dt>Vision</dt>
                  <dd>
                    {result.model?.vision ?? '—'} · {formatMs(result.timing?.visionMs)}
                  </dd>
                  <dt>Jev</dt>
                  <dd>
                    {result.model?.jev ?? 'off'} · {formatMs(result.timing?.jevMs)}
                    {result.jev?.intent ? ` · intent ${result.jev.intent.choice} ${percent(result.jev.intent.confidence)}` : ''}
                  </dd>
                  <dt>Round trip</dt>
                  <dd>
                    {formatMs(result.timing?.totalMs)}
                    {result.cached ? ' · served from the edge cache' : ''}
                  </dd>
                  <dt>Gallery matches</dt>
                  <dd>
                    {matches.length} of {candidates.length} in the pool
                    {matches.length > 0 && `: ${matches.map((match) => match.title).join(', ')}`}
                  </dd>
                </>
              )}
              <dt>Photo</dt>
              <dd>{image ? `${image.width}×${image.height} · ${Math.round(image.blob.size / 1024)} KB JPEG` : 'none (demo)'}</dd>
            </dl>
            {sculptEvents.length > 0 && (
              <ol className="scan-sculpt-log" aria-label="Sculpting judgments">
                {sculptEvents.map((event) => (
                  <li key={event.call} className={event.applied ? 'is-applied' : undefined}>
                    <span>#{event.call}</span>
                    <span>{event.applied ? moveWords(event.move) : `${moveWords(event.move)} (not applied)`}</span>
                    <span>{percent(event.confidence)}</span>
                    <span>
                      {event.likeness === null ? '—' : `likeness ${percent(event.likeness)}`}
                      {event.mismatch !== null && ` · mismatch ${event.mismatch.toFixed(2)}`}
                    </span>
                    <span>{formatMs(event.ms)}</span>
                  </li>
                ))}
              </ol>
            )}
            <pre>{JSON.stringify({ gist, result }, null, 2)}</pre>
          </details>
        )}
      </section>
    </main>
  );
}

export default ScanPage;
