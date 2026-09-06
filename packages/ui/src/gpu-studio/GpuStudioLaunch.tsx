import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  snapshotForStudio,
  type StudioLook,
  type StudioSnapshot,
} from "./snapshot";
import type { StudioRuntime } from "./runtime";
import { LupiActionButton } from "../LupiActionButton";
import {
  IconBack,
  IconOptics,
  IconPause,
  IconRecenter,
  IconRemix,
  IconTick,
} from "../icons";
import "./gpu-studio.css";
import { enablePhoneSnow, type MotionStatus } from "./snow-motion";

function IconSnowglobe() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M6 18a8 8 0 1 1 12 0M7 18h10l2 3H5l2-3Z" />
      <path d="M8 13l2-2 3 3 2-2 3 3M9 6v3m-1.5-1.5h3M15 6v2m-1-1h2" />
    </svg>
  );
}

function PhoneSnow({
  runtime,
}: {
  runtime: React.RefObject<StudioRuntime | null>;
}) {
  const controller = useRef<AbortController | null>(null);
  const [motionStatus, setMotionStatus] = useState<MotionStatus | "off">("off");
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReducedMotion(preference?.matches ?? false);
      controller.current?.abort();
      setMotionStatus("off");
    };
    preference?.addEventListener("change", change);
    return () => preference?.removeEventListener("change", change);
  }, []);
  const enabled = ["requesting", "listening", "active"].includes(motionStatus);
  const messages = {
    off: "Optional. Motion stays on this device. A gentle movement is plenty.",
    requesting: "Waiting for motion permission…",
    listening: "Listening for your phone. Try a gentle shake.",
    active: "Phone motion is on. Give your tiny worlds a gentle shake.",
    denied: "Motion permission was not granted. Shake it and drag still work.",
    unavailable:
      "No motion sensor is available here. Use Shake it or drag instead.",
  };
  if (reducedMotion)
    return (
      <p className="gpu-studio__hint">
        Reduced motion is on. Shake it creates a new still snowglobe.
      </p>
    );
  return (
    <div className="gpu-studio__phone">
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => {
          controller.current?.abort();
          if (enabled) {
            setMotionStatus("off");
            return;
          }
          const next = new AbortController();
          controller.current = next;
          void enablePhoneSnow(
            next.signal,
            (x, y, strength) => runtime.current?.shake(x, y, strength),
            (status) => {
              if (!next.signal.aborted) setMotionStatus(status);
            },
          );
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="8" y="3" width="8" height="18" rx="2" />
          <path d="M11 18h2M4 7 2 10l2 3M20 11l2 3-2 3" />
        </svg>
        {enabled ? "Turn phone motion off" : "Enable phone motion"}
      </button>
      <p className="gpu-studio__hint" role="status">
        {messages[motionStatus]}
      </p>
    </div>
  );
}

interface Preview {
  snapshot?: StudioSnapshot;
  error?: string;
}

export function GpuStudioLaunch({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const launchButton = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const file = useStore((state) => state.file);
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
          state.file?.name.replace(/\.[^.]+$/, "") || "Your molecule",
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
      <LupiActionButton
        ref={launchButton}
        className="gpu-studio-launch"
        type="button"
        onClick={open}
        aria-label="Open GPU Studio"
        aria-haspopup="dialog"
      >
        <span className="gpu-studio-launch__mark" aria-hidden="true">
          <IconOptics />
        </span>
        <span>
          GPU<span className="gpu-studio-launch__word"> Studio</span>
        </span>
        <span className="gpu-studio-launch__new">New</span>
      </LupiActionButton>
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

function GpuStudio({
  preview,
  onClose,
}: {
  preview: Preview;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<StudioRuntime | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    preview.error ? "unavailable" : "loading",
  );
  const [error, setError] = useState(preview.error || "");
  const [look, setLook] = useState<StudioLook>("snowglobe");
  const [spinning, setSpinning] = useState(false);
  const [light, setLight] = useState(-35);
  const [focus, setFocus] = useState<number | null>(null);
  const snapshot = preview.snapshot;
  const focusedGroup = focus === null ? undefined : snapshot?.groups[focus];
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
      setStatus("unavailable");
      controller.abort();
      runtime.current = null;
    };
    const timer = window.setTimeout(
      () =>
        fail(
          "WebGPU took too long to start. Return to the viewer and try again.",
        ),
      20_000,
    );
    if (!navigator.gpu) {
      fail(
        "WebGPU is unavailable in this browser or on this device. The regular viewer still works.",
      );
    } else {
      const element = host.current;
      // Neither vgpu nor Three's node-material renderer is imported before opening.
      import("./runtime")
        .then((module) => {
          if (controller.signal.aborted) return undefined;
          return module.createStudio(
            element,
            preview.snapshot!,
            controller.signal,
            fail,
          );
        })
        .then((instance) => {
          if (!instance) return;
          if (controller.signal.aborted) {
            instance.dispose();
            return;
          }
          runtime.current = instance;
          window.clearTimeout(timer);
          setStatus("ready");
        })
        .catch((reason) =>
          fail(
            reason instanceof Error
              ? reason.message
              : "GPU Studio could not start. The regular viewer is still available.",
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
      aria-label="GPU Studio"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      data-look={look}
      data-status={status}
    >
      <header className="gpu-studio__header">
        <button
          type="button"
          onClick={close}
          className="gpu-studio__back"
          autoFocus
        >
          <IconBack /> Back to viewer
        </button>
        <span className="gpu-studio__edition">
          <span aria-hidden="true">
            <IconOptics />
          </span>{" "}
          GPU Studio <small>by Lupi</small>
        </span>
        <span className="gpu-studio__connection">
          <i className="gpu-studio__live" data-ready={status === "ready"} />
          {status === "ready" ? "WebGPU active" : "WebGPU preview"}
        </span>
      </header>
      <div className="gpu-studio__body">
        <section className="gpu-studio__stage" aria-label="Molecule studio">
          <div className="gpu-studio__stage-label">
            <div>
              <p className="gpu-studio__eyebrow">
                {look === "snowglobe"
                  ? "Pocket universe / 01"
                  : "A study in structure"}
              </p>
              <h1>{snapshot?.name || "Your molecule"}</h1>
            </div>
            <p className="gpu-studio__frame">
              Frame{" "}
              <span>
                {snapshot ? String(snapshot.frameNumber).padStart(2, "0") : "—"}
              </span>
              <small>{snapshot?.atomCount.toLocaleString() || "—"} atoms</small>
            </p>
          </div>
          <div className="gpu-studio__canvas" ref={host} />
          {status !== "ready" && (
            <div className="gpu-studio__message" role="status">
              <span className="gpu-studio__message-mark" aria-hidden="true">
                <IconOptics />
              </span>
              <h2>
                {status === "loading"
                  ? "Bottling a little wonder…"
                  : "Stay with the regular viewer"}
              </h2>
              <p>
                {status === "loading"
                  ? "Building tiny worlds inside your atoms."
                  : error}
              </p>
              {status === "unavailable" && (
                <button type="button" onClick={close}>
                  Return to my molecule
                </button>
              )}
            </div>
          )}
          <div className="gpu-studio__stage-footer">
            {look === "snowglobe" && (
              <div className="gpu-studio__snow-actions">
                <LupiActionButton
                  className="gpu-studio__shake"
                  disabled={status !== "ready"}
                  onClick={() => runtime.current?.shake()}
                >
                  <IconSnowglobe /> Shake it
                </LupiActionButton>
                <button
                  type="button"
                  disabled={status !== "ready"}
                  onClick={() => runtime.current?.calm()}
                >
                  Settle snow
                </button>
              </div>
            )}
            <p className="gpu-studio__gesture">
              {look === "snowglobe"
                ? "Drag to stir & explore"
                : "Drag to explore"}{" "}
              <span>·</span> Scroll or pinch to zoom
            </p>
            <div className="gpu-studio__tools">
              <button
                type="button"
                disabled={status !== "ready"}
                aria-pressed={spinning}
                onClick={() => {
                  runtime.current?.setSpin(!spinning);
                  setSpinning(!spinning);
                }}
              >
                <span aria-hidden="true">
                  {spinning ? <IconPause /> : <IconRemix />}
                </span>
                {spinning ? "Stop rotation" : "Rotate"}
              </button>
              <button
                type="button"
                disabled={status !== "ready"}
                onClick={() => runtime.current?.reset()}
              >
                <IconRecenter /> Reset view
              </button>
            </div>
          </div>
        </section>
        <aside className="gpu-studio__controls" aria-label="Studio controls">
          <div className="gpu-studio__control-heading">
            <p className="gpu-studio__eyebrow">The wonder room</p>
            <h2>
              Small atoms.
              <br />
              Entire little worlds.
            </h2>
            <p>
              Stir up a snowstorm. Catch a glint. Let it all settle, then do it
              again.
            </p>
          </div>
          <section
            className="gpu-studio__control-section"
            aria-label="Appearance"
          >
            <h3>
              <span>01</span> Choose a finish
            </h3>
            <div
              className="gpu-studio__looks"
              role="group"
              aria-label="Studio look"
            >
              <button
                type="button"
                aria-pressed={look === "snowglobe"}
                disabled={status !== "ready"}
                onClick={() => {
                  runtime.current?.setLook("snowglobe");
                  setLook("snowglobe");
                }}
              >
                <span
                  className="gpu-studio__swatch gpu-studio__swatch--snow"
                  aria-hidden="true"
                >
                  <IconSnowglobe />
                </span>
                <span>
                  Snowglobe<small>A storm in every sphere</small>
                </span>
                <span className="gpu-studio__selected" aria-hidden="true">
                  {look === "snowglobe" && <IconTick />}
                </span>
              </button>
              <button
                type="button"
                aria-pressed={look === "studio"}
                disabled={status !== "ready"}
                onClick={() => {
                  runtime.current?.setLook("studio");
                  setLook("studio");
                }}
              >
                <span
                  className="gpu-studio__swatch gpu-studio__swatch--studio"
                  aria-hidden="true"
                />
                <span>
                  Studio light<small>Soft light. Real depth.</small>
                </span>
                <span className="gpu-studio__selected" aria-hidden="true">
                  {look === "studio" && <IconTick />}
                </span>
              </button>
              <button
                type="button"
                aria-pressed={look === "contours"}
                disabled={status !== "ready"}
                onClick={() => {
                  runtime.current?.setLook("contours");
                  setLook("contours");
                }}
              >
                <span
                  className="gpu-studio__swatch gpu-studio__swatch--contours"
                  aria-hidden="true"
                />
                <span>
                  Graphic contours<small>Trace every curve</small>
                </span>
                <span className="gpu-studio__selected" aria-hidden="true">
                  {look === "contours" && <IconTick />}
                </span>
              </button>
            </div>
            {look === "snowglobe" && status === "ready" && (
              <PhoneSnow runtime={runtime} />
            )}
          </section>
          <section
            className="gpu-studio__control-section"
            aria-label="Lighting"
          >
            <h3>
              <span>02</span> Move the light
            </h3>
            <label
              className="gpu-studio__light-label"
              htmlFor="gpu-studio-light"
            >
              Light angle <output>{light}°</output>
            </label>
            <input
              id="gpu-studio-light"
              type="range"
              min={-180}
              max={180}
              step={5}
              value={light}
              disabled={status !== "ready"}
              aria-valuetext={`${light} degrees`}
              onChange={(event) => {
                const value = Number(event.target.value);
                runtime.current?.setLight(value);
                setLight(value);
              }}
            />
            <p className="gpu-studio__hint">
              Sweep the highlights around your molecule.
            </p>
          </section>
          <section
            className="gpu-studio__control-section"
            aria-label="Atom focus"
          >
            <h3>
              <span>03</span> Look a little closer
            </h3>
            <div
              className="gpu-studio__legend"
              role="group"
              aria-label="Focus by atom type"
            >
              <button
                type="button"
                aria-pressed={focus === null}
                disabled={status !== "ready"}
                onClick={() => {
                  runtime.current?.setFocus(null);
                  setFocus(null);
                }}
              >
                All atoms
              </button>
              {snapshot?.groups.map((group, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Focus ${group.label} atoms`}
                  aria-pressed={focus === index}
                  disabled={status !== "ready"}
                  onClick={() => {
                    const next = focus === index ? null : index;
                    runtime.current?.setFocus(next);
                    setFocus(next);
                  }}
                >
                  <i
                    style={{ backgroundColor: group.color }}
                    aria-hidden="true"
                  />
                  {group.label}
                  <small>{group.positions.length / 3}</small>
                </button>
              ))}
            </div>
            <p className="gpu-studio__hint" role="status">
              {focusedGroup
                ? `${focusedGroup.positions.length / 3} ${focusedGroup.label} atoms highlighted. Other atoms stay visible for context.`
                : "Choose an atom type to highlight it in the structure."}
            </p>
          </section>
          <p className="gpu-studio__boundary">
            Real structure. Imaginary little worlds.
            <br />
            Snow and glass are creative effects, not a simulation of atoms. Your
            molecule is unchanged. Bonds and other viewer layers are not shown
            here.
          </p>
        </aside>
      </div>
      <footer className="gpu-studio__footer">
        <p>A little more wonder. The same molecule.</p>
        <p>
          Preview <span>·</span> Vercel Labs vgpu + Three.js
        </p>
      </footer>
    </dialog>
  );
}
