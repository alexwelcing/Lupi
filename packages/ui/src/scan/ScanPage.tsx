import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import type { ScanSwirl } from './swirl';
import './scan.css';

/**
 * Point at something; get its molecules. The photo never leaves the page
 * until it has been downscaled; the swirl runs while the edge looks; the
 * answer materializes as cards you can open in 3D. Every number on screen
 * that came from a model is labeled as inference.
 */
type Phase = 'idle' | 'preparing' | 'scanning' | 'done' | 'error' | 'unconfigured';

type MoleculeOpen =
  | { kind: 'gallery'; candidate: ScanCandidate; fit: number | null }
  | { kind: 'pubchem'; name: string };

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
  const [renderer, setRenderer] = useState<'pending' | 'gpu' | 'css'>('pending');
  const [dragging, setDragging] = useState(false);
  const storeError = useStore((state) => state.error);
  const storeLoading = useStore((state) => state.loading);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const swirl = useRef<ScanSwirl | null>(null);
  const swirlPending = useRef<Promise<void> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const id = useId();

  const candidates = useMemo(() => scanCandidates(), []);
  const candidateByKey = useMemo(() => new Map(candidates.map((candidate) => [candidate.key, candidate])), [candidates]);

  /* ─── Swirl lifecycle ─── */
  const ensureSwirl = useCallback(() => {
    if (swirl.current || swirlPending.current || renderer === 'css') return;
    const node = canvas.current;
    if (!node) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('gpu' in navigator)) {
      setRenderer('css');
      return;
    }
    swirlPending.current = import('./swirl')
      .then(({ createScanSwirl }) => createScanSwirl(node, () => {
        swirl.current = null;
        setRenderer('css');
      }))
      .then((instance) => {
        swirl.current = instance;
        setRenderer('gpu');
        if (phase === 'preparing' || phase === 'scanning') instance.setEnergy(1);
      })
      .catch(() => setRenderer('css'))
      .finally(() => {
        swirlPending.current = null;
      });
  }, [phase, renderer]);

  useEffect(() => {
    if (phase === 'preparing' || phase === 'scanning') {
      ensureSwirl();
      swirl.current?.setEnergy(1);
    } else if (phase === 'done' || phase === 'error') {
      swirl.current?.reveal();
    } else {
      swirl.current?.setEnergy(0);
    }
  }, [phase, ensureSwirl]);

  useEffect(
    () => () => {
      swirl.current?.dispose();
      swirl.current = null;
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

  /* ─── The pipeline ─── */
  const scan = useCallback(
    async (prepared: PreparedImage, hintText: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setError(null);
      setResult(null);
      setPhase('scanning');
      track(ANALYTICS_EVENTS.SCAN_STARTED, { hasHint: hintText.trim().length > 0, bytes: prepared.blob.size, width: prepared.width, height: prepared.height });
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
    },
    [candidates],
  );

  const accept = useCallback(
    async (file: Blob | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setError('That is not an image. Try a photo.');
        setPhase('error');
        return;
      }
      setPhase('preparing');
      setError(null);
      setResult(null);
      try {
        const prepared = await prepareImage(file);
        setImage((previous) => {
          if (previous) URL.revokeObjectURL(previous.previewUrl);
          return prepared;
        });
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
    setPhase('idle');
    setResult(null);
    setError(null);
    setOpening(null);
    setImage((previous) => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
    if (cameraInput.current) cameraInput.current.value = '';
    if (fileInput.current) fileInput.current.value = '';
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
  const showStage = image !== null;

  return (
    <main id="main" className="student-home scan">
      <section className="student-hero student-hero--finder student-width scan-hero" aria-labelledby="scan-title">
        <p className="student-eyebrow">Molecular scanner</p>
        <h1 id="scan-title">
          Point at anything.
          <br />
          See what it&rsquo;s made of.
        </h1>
        <p className="student-deck">
          Eggs, a leather couch, your coffee. Take a photo and Lupi names the molecules, then opens them in 3D. The whole
          thing runs at the edge; the photo is resized on your device and never stored.
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
          <div className={`scan-stage${busy ? ' is-scanning' : ''}${phase === 'done' ? ' is-done' : ''}`} data-renderer={renderer}>
            <img className="scan-photo" src={image.previewUrl} alt="" width={image.width} height={image.height} />
            <canvas ref={canvas} className="scan-swirl" aria-hidden="true" />
            {busy && (
              <div className="scan-status" role="status">
                <strong>{phase === 'preparing' ? 'Getting the photo ready…' : SCAN_STATUS_LINES[statusIndex]}</strong>
                <span>{formatMs(elapsed)}</span>
              </div>
            )}
          </div>
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

                <details className="scan-dev">
                  <summary>Under the hood</summary>
                  <dl>
                    <dt>Vision</dt>
                    <dd>
                      {result?.model?.vision ?? '—'} · {formatMs(result?.timing?.visionMs)}
                    </dd>
                    <dt>Jev</dt>
                    <dd>
                      {result?.model?.jev ?? 'off'} · {formatMs(result?.timing?.jevMs)}
                      {result?.jev?.intent ? ` · intent ${result.jev.intent.choice} ${percent(result.jev.intent.confidence)}` : ''}
                    </dd>
                    <dt>Round trip</dt>
                    <dd>
                      {formatMs(result?.timing?.totalMs)}
                      {result?.cached ? ' · served from the edge cache' : ''}
                    </dd>
                    <dt>Gallery matches</dt>
                    <dd>
                      {matches.length} of {candidates.length} in the pool
                      {matches.length > 0 && `: ${matches.map((match) => match.title).join(', ')}`}
                    </dd>
                    <dt>Photo</dt>
                    <dd>{image ? `${image.width}×${image.height} · ${Math.round(image.blob.size / 1024)} KB JPEG` : '—'}</dd>
                  </dl>
                  <pre>{JSON.stringify(result, null, 2)}</pre>
                </details>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default ScanPage;
