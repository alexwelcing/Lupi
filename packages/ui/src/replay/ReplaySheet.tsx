/**
 * ReplaySheet — what one tap on "Replay ↗" (or R) gives you.
 *
 * - **The live link**, ready at once: the moment as a `replay=` parameter
 *   (about a kilobyte, nothing stored anywhere). Whoever opens it watches the
 *   same moment happen in their own 3D view, then gets "Your turn".
 * - **A 9:16 clip** of the moment, developing in the sheet as it is made,
 *   with "Illustrative" burned into every frame. Where WebCodecs can encode
 *   it, the clip is rendered frame by frame from the tape at 30 fps into an
 *   MP4 (offlineClip.ts), so a slow device makes the same clip as a fast
 *   one and the live canvas never changes size. Elsewhere the viewer replays
 *   the moment off screen through the normal video export, recorded in real
 *   time by MediaRecorder. Share sends the clip and the link together; Save
 *   downloads the clip.
 *
 * Motion: Still sends a still pose link and makes no clip. A molecule with no
 * address (a dropped file) gets the clip only. Closing the sheet cancels a
 * clip still recording.
 *
 * Share and Copy run synchronously in the tap (iOS keeps the gesture): the
 * link exists before the sheet opens and the clip's file before Share
 * offers it.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { MOBILE_MEDIA_QUERY } from '../hooks/useMediaQuery';
import { useComfort } from '../motion/comfort';
import { getToyReplaySink } from '../play/toyTape';
import { createClipCompositor, ENDCARD_S, type ClipCompositor } from './clipCompositor';
import { chooseClipCodec, hasClipEncoder } from './clipEncoder';
import { tapeFlashes, type ClipFlash } from './clipSchedule';
import { ClipAbortError, clipSize, noteClipReport, renderOfflineClip } from './offlineClip';
import { ReplayPlayer, type ReplayFraming } from './player';
import { pauseRecorder } from './recorder';
import { replayStore, useReplayStore, type ReplayMoment } from './replayStore';
import { buildTape, moleculePageLabel, replayLink, replayViewContext, tapeHasToys, type BuiltTape } from './session';
import { FOIL_LABEL } from '../remix/code';
import { remixStore, shownFinish } from '../remix/remixStore';
import './replaySheet.css';

type ClipState =
  | { kind: 'off'; reason: string }
  | { kind: 'recording'; progress: number }
  | { kind: 'ready'; blob: Blob; url: string; filename: string; type: string; encoder: ClipEncoderKind; codec: string | null }
  | { kind: 'failed'; reason: string };

/** How the clip was made: rendered frame by frame (WebCodecs), or recorded in real time (MediaRecorder). */
type ClipEncoderKind = 'webcodecs' | 'mediarecorder';

function matches(query: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function canRecordVideo(): boolean {
  if (typeof MediaRecorder === 'undefined' || typeof document === 'undefined') return false;
  const probe = document.createElement('canvas');
  return typeof probe.captureStream === 'function';
}

function shareSentence(moment: ReplayMoment, name: string): string {
  switch (moment.moment) {
    case 'flick':
      return `Watch my spin of ${name}, then it's your turn`;
    case 'chain':
      return `Watch ${name} click through its faces, then it's your turn`;
    case 'flip':
      return `Watch ${name} flip mid-spin, then it's your turn`;
    case 'toy':
      return `Watch ${moment.noun} on ${name}, then it's your turn`;
    default:
      return `${name} in 3D`;
  }
}

function sheetTitle(moment: ReplayMoment, still: boolean): string {
  if (moment.moment === 'view' || still) return 'Share this view';
  return `Replay ${moment.noun}`;
}

function copyText(text: string): boolean {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

function download(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'molecule';
}

export function ReplaySheet() {
  const moment = useReplayStore((state) => state.sheet);
  if (!moment) return null;
  return <ReplaySheetBody key={moment.id} moment={moment} />;
}

function ReplaySheetBody({ moment }: { moment: ReplayMoment }) {
  const comfort = useComfort();
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const compositorRef = useRef<ClipCompositor | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);
  const [clip, setClip] = useState<ClipState>({ kind: 'off', reason: '' });

  // The tape and link exist before anything else renders (prepare, then send on the tap).
  const built = useMemo<BuiltTape | null>(() => buildTape(moment), [moment]);
  const context = useMemo(() => replayViewContext(), []);
  const link = built ? replayLink(built.token) : null;
  const name = context?.name ?? 'Molecule';
  const still = built?.tape.still ?? true;
  const toys = built ? tapeHasToys(built.tape) : false;
  const bytes = built ? Math.ceil((built.token.length * 3) / 4) : 0;

  const close = useCallback(() => {
    abortRef.current?.abort();
    replayStore.getState().closeSheet();
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-lupi-pill] .lupi-play-pill__play-button')?.focus({ preventScroll: true });
    });
  }, []);

  // The clip: rendered frame by frame where WebCodecs can encode it, else
  // recorded again, off screen and in real time, through the video export.
  useEffect(() => {
    if (!built) return undefined;
    if (still) {
      setClip({ kind: 'off', reason: comfort === 'still' ? 'Motion is Still: the link opens on this pose, and there is no clip.' : '' });
      return undefined;
    }
    const offline = hasClipEncoder();
    if (!offline && !canRecordVideo()) {
      setClip({ kind: 'off', reason: 'This browser can’t record a clip. The link still plays it.' });
      return undefined;
    }
    const store = useStore.getState();
    if (store.exportRequest.type) {
      setClip({ kind: 'off', reason: 'Another export is running. The link still plays it.' });
      return undefined;
    }
    const phone = matches(MOBILE_MEDIA_QUERY) || matches('(hover: none) and (pointer: coarse)');
    const { width, height } = clipSize(phone);
    const duration = built.tape.duration + ENDCARD_S;
    const finish = shownFinish(remixStore.getState());
    const framing: ReplayFraming | null = context
      ? { center: context.center, radius: context.radius, fov: context.fov, aspect: width / height }
      : null;
    const makeCompositor = (flashes: ClipFlash[] | null): ClipCompositor => {
      compositorRef.current?.canvas.remove();
      const compositor = createClipCompositor({
        width,
        height,
        title: name,
        toys,
        linkLabel: moleculePageLabel(context),
        duration,
        finish: finish ? FOIL_LABEL[finish] : null,
        flashes,
      });
      compositorRef.current = compositor;
      return compositor;
    };
    const abort = new AbortController();
    abortRef.current = abort;
    replayStore.getState().setClipping(true);
    setClip({ kind: 'recording', progress: 0 });
    const onProgress = (fraction: number) => {
      setClip((current) => (current.kind === 'recording' && Math.abs(current.progress - fraction) < 0.02 ? current : { kind: 'recording', progress: fraction }));
    };
    const failed = () => {
      replayStore.getState().setClipping(false);
      setClip({ kind: 'failed', reason: 'The clip didn’t record in this browser. The link still plays it.' });
    };

    // Real time: MediaRecorder records the composed canvas while the video export replays the moment.
    const record = () => {
      const compositor = makeCompositor(null);
      const player = new ReplayPlayer(built.tape, { framing, flashes: true, toys: true });
      let resume: (() => void) | null = null;
      let ended = false;
      const resetToys = () => getToyReplaySink()?.play({ kind: 'reset' });
      const startedAt = performance.now();
      setClip({ kind: 'recording', progress: 0 });

      useStore.getState().triggerExport({
        type: 'video',
        resolution: { width, height },
        durationSeconds: duration,
        baseName: `lupi-${safeName(name)}-replay`,
        illustrative: true,
        compositor,
        signal: abort.signal,
        replay: {
          duration,
          begin: () => {
            resume = pauseRecorder();
            resetToys();
            player.start();
          },
          drive: (seconds, camera, target) => {
            player.seek(Math.min(seconds, built.tape.duration), camera, target);
          },
          end: () => {
            if (ended) return;
            ended = true;
            player.stop();
            resetToys();
            resume?.();
            resume = null;
          },
        },
        onRecordProgress: onProgress,
        onComplete: (success, blob, filename, failure) => {
          replayStore.getState().setClipping(false);
          if (abort.signal.aborted || failure?.code === 'aborted') return;
          if (success && blob) {
            const type = blob.type || 'video/webm';
            const ext = type.includes('mp4') ? 'mp4' : 'webm';
            noteClipReport({
              encoder: 'mediarecorder',
              codec: type,
              container: ext,
              width,
              height,
              fps: 30,
              frames: null,
              duration,
              ms: Math.round(performance.now() - startedAt),
              msPerFrame: null,
              split: null,
              bytes: blob.size,
              backend: null,
            });
            setClip({
              kind: 'ready',
              blob,
              url: URL.createObjectURL(blob),
              filename: filename ?? `lupi-${safeName(name)}-replay.${ext}`,
              type,
              encoder: 'mediarecorder',
              codec: null,
            });
          } else {
            failed();
          }
        },
      });
    };

    // Frame by frame: the codec first (an async question), then the clip.
    void (async () => {
      const choice = offline ? await chooseClipCodec(width, height) : null;
      if (abort.signal.aborted) return;
      if (!choice) {
        if (canRecordVideo()) record();
        else failed();
        return;
      }
      const compositor = makeCompositor(tapeFlashes(built.tape));
      setClip({ kind: 'recording', progress: 0 });
      try {
        const { blob } = await renderOfflineClip({
          tape: built.tape,
          width,
          height,
          duration,
          framing,
          compositor,
          choice,
          signal: abort.signal,
          onProgress,
        });
        if (abort.signal.aborted) return;
        replayStore.getState().setClipping(false);
        setClip({
          kind: 'ready',
          blob,
          url: URL.createObjectURL(blob),
          filename: `lupi-${safeName(name)}-replay.mp4`,
          type: blob.type || 'video/mp4',
          encoder: 'webcodecs',
          codec: choice.name,
        });
      } catch (error) {
        if (abort.signal.aborted || error instanceof ClipAbortError) return;
        // An encoder or GPU failure mid-clip: record it in real time instead.
        console.warn('[ReplaySheet] the frame-by-frame clip failed; recording it instead', error);
        if (canRecordVideo() && !useStore.getState().exportRequest.type) record();
        else failed();
      }
    })();

    return () => {
      abort.abort();
      replayStore.getState().setClipping(false);
      compositorRef.current?.canvas.remove();
      compositorRef.current = null;
    };
    // The clip is made once per sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  // The developing clip shows in the preview frame (the compositor's own canvas,
  // which the clip may make a moment after the sheet opens).
  useEffect(() => {
    const host = previewRef.current;
    const compositor = compositorRef.current;
    if (host && compositor && compositor.canvas.parentElement !== host) host.prepend(compositor.canvas);
  }, [clip]);

  // Free the clip's object URL with the sheet.
  useEffect(() => () => {
    if (clip.kind === 'ready') URL.revokeObjectURL(clip.url);
  }, [clip]);

  // Esc closes; focus starts on the first action.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const shareText = shareSentence(moment, name);
  const clipFile = useMemo(() => {
    if (clip.kind !== 'ready' || typeof File === 'undefined') return null;
    try {
      return new File([clip.blob], clip.filename, { type: clip.type });
    } catch {
      return null;
    }
  }, [clip]);
  const canShareFile = Boolean(
    clipFile && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [clipFile] }),
  );
  const canShareLink = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const onCopy = () => {
    if (!link) return;
    if (copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const onShare = () => {
    if (!navigator.share) {
      onCopy();
      return;
    }
    const text = link ? `${shareText}: ${link}` : shareText;
    const data: ShareData = canShareFile && clipFile
      ? { files: [clipFile], text, title: `${name} · Lupi` }
      : { title: `${name} · Lupi`, text: shareText, url: link ?? undefined };
    navigator.share(data).catch(() => undefined);
  };

  const onSave = () => {
    if (clip.kind === 'ready') download(clip.url, clip.filename);
  };

  if (!built) {
    return (
      <div className="lupi-replay-sheet" data-lupi-replay-sheet="" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && close()}>
        <div ref={dialogRef} className="lupi-replay-sheet__card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <h2 id={titleId} className="lupi-replay-sheet__title">Nothing to replay yet</h2>
          <p className="lupi-replay-sheet__note">Flick the molecule, or try a toy from Play, and the pill offers Replay.</p>
          <div className="lupi-replay-sheet__actions">
            <button type="button" className="lupi-replay-sheet__button" data-autofocus="" onClick={close}>OK</button>
          </div>
        </div>
      </div>
    );
  }

  const recording = clip.kind === 'recording';
  const showPreview = !still && (clip.kind === 'recording' || clip.kind === 'ready');
  const progress = clip.kind === 'recording' ? clip.progress : clip.kind === 'ready' ? 1 : 0;
  let clipNote = '';
  if (clip.kind === 'recording') clipNote = `Developing the clip… ${Math.round(progress * 100)} %`;
  else if (clip.kind === 'ready') clipNote = `${clip.type.includes('mp4') ? 'MP4' : 'WebM'} clip${clip.codec ? ` (${clip.codec})` : ''}, 9:16 · Illustrative`;
  else clipNote = clip.reason;

  return (
    <div
      className="lupi-replay-sheet"
      data-lupi-replay-sheet=""
      data-recording={recording || undefined}
      data-clip-encoder={clip.kind === 'ready' ? clip.encoder : undefined}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="lupi-replay-sheet__card"
        data-has-preview={showPreview || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <button type="button" className="lupi-replay-sheet__close" aria-label="Close" onClick={close}>
          <span aria-hidden="true">×</span>
        </button>
        {showPreview && (
          <div className="lupi-replay-sheet__preview" aria-label={recording ? 'The clip, developing' : 'The clip'}>
            <div ref={previewRef} className="lupi-replay-sheet__frame" data-ready={clip.kind === 'ready' || undefined}>
              {clip.kind === 'ready' && (
                <video
                  className="lupi-replay-sheet__video"
                  src={clip.url}
                  muted
                  playsInline
                  loop
                  autoPlay={comfort === 'standard'}
                  controls={comfort !== 'standard'}
                  aria-label={`Clip of ${moment.noun} on ${name}, illustrative`}
                />
              )}
            </div>
            {recording && (
              <div className="lupi-replay-sheet__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <span style={{ transform: `scaleX(${progress})` }} />
              </div>
            )}
          </div>
        )}
        <div className="lupi-replay-sheet__body">
          <h2 id={titleId} className="lupi-replay-sheet__title">{sheetTitle(moment, still)}</h2>
          <p id={descId} className="lupi-replay-sheet__note">
            {link
              ? still
                ? 'The link opens this molecule at this pose, in their own 3D view.'
                : 'The link plays it in their own 3D view, then hands them the molecule: “Your turn”.'
              : 'This molecule has no address to link to (it was opened from a file). The clip still works.'}
            {toys && !still ? ' The toys are illustrative motion, and the clip says so.' : ''}
          </p>
          {link && (
            <div className="lupi-replay-sheet__link">
              <input
                className="lupi-replay-sheet__link-field"
                readOnly
                value={link}
                aria-label="Live link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="lupi-replay-sheet__button" data-autofocus="" onClick={onCopy}>
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
            </div>
          )}
          {link && <p className="lupi-replay-sheet__meta">{`${bytes.toLocaleString('en-US')} bytes in the link · nothing stored`}</p>}
          <div className="lupi-replay-sheet__actions">
            {(canShareLink || canShareFile) && (
              <button
                type="button"
                className="lupi-replay-sheet__button lupi-replay-sheet__button--primary"
                data-autofocus={link ? undefined : ''}
                disabled={recording && !link}
                onClick={onShare}
              >
                {canShareFile ? 'Share clip + link' : 'Share link'}
              </button>
            )}
            {clip.kind === 'ready' && (
              <button type="button" className="lupi-replay-sheet__button" onClick={onSave}>
                Save clip
              </button>
            )}
          </div>
          {clipNote && (
            <p className="lupi-replay-sheet__clip-note" role="status" aria-live="polite">
              {clipNote}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
