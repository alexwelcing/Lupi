import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { snapshotForStudio, type StudioLook, type StudioSnapshot } from './snapshot';
import type { StudioRuntime } from './runtime';
import './gpu-studio.css';

interface Preview {
  snapshot?: StudioSnapshot;
  error?: string;
}

export function GpuStudioLaunch({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const launchButton = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const file = useStore(state => state.file);
  useEffect(() => {
    setPreview(null);
  }, [file]);
  useEffect(() => {
    onOpenChange(preview !== null);
    return () => onOpenChange(false);
  }, [preview, onOpenChange]);
  const open = () => {
    const state = useStore.getState();
    useStore.setState({ playing: false });
    try {
      setPreview({
        snapshot: snapshotForStudio(
          state.file?.trajectory.frames[state.frame],
          state.loadedAtomCount,
          state.file?.name.replace(/\.[^.]+$/, '') || 'Your molecule',
          state.frame + 1,
        ),
      });
    } catch (error) {
      setPreview({ error: (error as Error).message });
    }
  };
  if (!file) return null;
  return (
    <>
      <button
        ref={launchButton}
        className="gpu-studio-launch"
        type="button"
        onClick={open}
        aria-label="Open GPU Studio"
        aria-haspopup="dialog"
      >
        <span className="gpu-studio-launch__mark" aria-hidden="true">
          ✳
        </span>
        <span>
          GPU<span className="gpu-studio-launch__word"> Studio</span>
        </span>
        <span className="gpu-studio-launch__new">New</span>
      </button>
      {preview && (
        <GpuStudio
          preview={preview}
          onClose={() => {
            setPreview(null);
            launchButton.current?.focus();
          }}
        />
      )}
    </>
  );
}

function GpuStudio({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<StudioRuntime | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    preview.error ? 'unavailable' : 'loading',
  );
  const [error, setError] = useState(preview.error || '');
  const [look, setLook] = useState<StudioLook>('studio');
  const [spinning, setSpinning] = useState(false);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    if (!preview.snapshot || !host.current) return;
    const controller = new AbortController();
    const fail = (message: string) => {
      if (controller.signal.aborted) return;
      setError(message);
      setStatus('unavailable');
      controller.abort();
      runtime.current = null;
    };
    const timer = window.setTimeout(
      () => fail('WebGPU took too long to start. Return to the viewer and try again.'),
      20_000,
    );
    if (!navigator.gpu) {
      fail(
        'WebGPU is unavailable in this browser or on this device. The regular viewer still works.',
      );
    } else {
      const element = host.current;
      // Neither vgpu nor Three's node-material renderer is imported before opening.
      import('./runtime')
        .then(module => {
          if (controller.signal.aborted) return undefined;
          return module.createStudio(element, preview.snapshot!, controller.signal, fail);
        })
        .then(instance => {
          if (!instance) return;
          if (controller.signal.aborted) {
            instance.dispose();
            return;
          }
          runtime.current = instance;
          window.clearTimeout(timer);
          setStatus('ready');
        })
        .catch(reason =>
          fail(
            reason instanceof Error
              ? reason.message
              : 'GPU Studio could not start. The regular viewer is still available.',
          ),
        );
    }
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      runtime.current?.dispose();
      runtime.current = null;
    };
  }, [preview]);
  return (
    <dialog
      ref={dialog}
      className="gpu-studio"
      aria-labelledby="gpu-studio-title"
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      data-look={look}
      data-status={status}
    >
      <header className="gpu-studio__header">
        <button type="button" onClick={close} className="gpu-studio__back" autoFocus>
          <span aria-hidden="true">←</span> Back to viewer
        </button>
        <span className="gpu-studio__edition">
          Lupi / GPU Studio <span>Preview</span>
        </span>
      </header>
      <div className="gpu-studio__body">
        <section className="gpu-studio__intro">
          <p className="gpu-studio__eyebrow">A new way to look</p>
          <h1 id="gpu-studio-title">
            Same molecule.
            <br />
            <em>Different light.</em>
          </h1>
          <p className="gpu-studio__lede">
            Turn familiar structures into something worth a closer look.
          </p>
          <div className="gpu-studio__looks" role="group" aria-label="Studio look">
            <button
              type="button"
              aria-pressed={look === 'studio'}
              disabled={status !== 'ready'}
              onClick={() => {
                runtime.current?.setLook('studio');
                setLook('studio');
              }}
            >
              <span className="gpu-studio__swatch gpu-studio__swatch--studio" aria-hidden="true" />
              <span>
                Studio light<small>Warm, sculptural, tactile</small>
              </span>
              <span aria-hidden="true">01</span>
            </button>
            <button
              type="button"
              aria-pressed={look === 'contours'}
              disabled={status !== 'ready'}
              onClick={() => {
                runtime.current?.setLook('contours');
                setLook('contours');
              }}
            >
              <span
                className="gpu-studio__swatch gpu-studio__swatch--contours"
                aria-hidden="true"
              />
              <span>
                Graphic contours<small>Trace every curve</small>
              </span>
              <span aria-hidden="true">02</span>
            </button>
          </div>
          <p className="gpu-studio__boundary">
            A visual study of one frame. Atom positions stay unchanged; sphere sizes, lighting and
            lines are display choices, not measured properties. Bonds and other viewer layers are
            not shown here.
          </p>
        </section>
        <section className="gpu-studio__stage" aria-label="Molecule studio">
          <div className="gpu-studio__stage-label">
            <span>{preview.snapshot?.name || 'Your molecule'}</span>
            <span>Frame {preview.snapshot?.frameNumber || '—'}</span>
          </div>
          <div className="gpu-studio__canvas" ref={host} />
          {status !== 'ready' && (
            <div className="gpu-studio__message" role="status">
              <span className="gpu-studio__message-mark" aria-hidden="true">
                ✳
              </span>
              <h2>
                {status === 'loading' ? 'Finding the light…' : 'Stay with the regular viewer'}
              </h2>
              <p>{status === 'loading' ? 'Starting a WebGPU preview on your device.' : error}</p>
              {status === 'unavailable' && (
                <button type="button" onClick={close}>
                  Return to my molecule →
                </button>
              )}
            </div>
          )}
          <div className="gpu-studio__stage-footer">
            <div className="gpu-studio__legend" aria-label="Atom color key">
              {preview.snapshot?.groups.map((group, index) => (
                <span key={index}>
                  <i style={{ backgroundColor: group.color }} />
                  {group.label}
                </span>
              ))}
            </div>
            <span>{preview.snapshot?.atomCount.toLocaleString() || '—'} atoms</span>
          </div>
        </section>
      </div>
      <footer className="gpu-studio__footer">
        <p>
          <span className="gpu-studio__live" data-ready={status === 'ready'} />
          {status === 'ready' ? 'WebGPU active' : 'WebGPU preview'}
          <span className="gpu-studio__credit"> · Powered by Vercel Labs vgpu + Three.js</span>
        </p>
        <div className="gpu-studio__tools">
          <span className="gpu-studio__gesture">Drag to orbit · Scroll to zoom</span>
          <button
            type="button"
            disabled={status !== 'ready'}
            aria-pressed={spinning}
            onClick={() => {
              runtime.current?.setSpin(!spinning);
              setSpinning(!spinning);
            }}
          >
            {spinning ? 'Stop rotation' : 'Rotate'}
          </button>
          <button
            type="button"
            disabled={status !== 'ready'}
            onClick={() => runtime.current?.reset()}
          >
            Reset view
          </button>
        </div>
      </footer>
    </dialog>
  );
}
