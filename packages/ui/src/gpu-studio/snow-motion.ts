/** Display-only inertia. Source atoms never move; these values stir the tiny worlds inside them. */
export class SnowMotion {
  time = 0;
  energy = 0;
  x = 0;
  y = 0;

  kick(x = 0.7, y = 0.4, strength = 1) {
    if (![x, y, strength].every(Number.isFinite)) return;
    this.energy = Math.min(1, this.energy + Math.max(0, strength));
    this.x = Math.max(-1, Math.min(1, this.x + x * 0.4));
    this.y = Math.max(-1, Math.min(1, this.y + y * 0.4));
  }

  step(seconds: number) {
    const dt = Math.max(
      0,
      Math.min(Number.isFinite(seconds) ? seconds : 0, 0.1),
    );
    this.time += dt * (0.25 + this.energy * 1.8);
    this.energy *= Math.exp(-0.58 * dt);
    this.x *= Math.exp(-1.8 * dt);
    this.y *= Math.exp(-1.8 * dt);
    if (this.energy < 0.006) this.calm();
    return this.energy > 0;
  }

  calm() {
    this.energy = 0;
    this.x = 0;
    this.y = 0;
  }
}

export type MotionStatus =
  | "requesting"
  | "listening"
  | "active"
  | "denied"
  | "unavailable";

/** User-gesture only. No storage, telemetry, background sampling, or automatic permission prompt. */
export async function enablePhoneSnow(
  signal: AbortSignal,
  onImpulse: (x: number, y: number, strength: number) => void,
  onStatus: (status: MotionStatus) => void,
) {
  const motion = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<string>;
  };
  if (!window.isSecureContext || !motion) {
    onStatus("unavailable");
    return;
  }
  onStatus("requesting");
  try {
    // Must remain before any await: iOS requires transient user activation here.
    const permission = motion.requestPermission?.();
    if (permission && (await permission) !== "granted") {
      if (!signal.aborted) onStatus("denied");
      return;
    }
  } catch {
    if (!signal.aborted) onStatus("denied");
    return;
  }
  if (signal.aborted) return;
  onStatus("listening");
  let previous: [number, number, number] | null = null;
  let last = -Infinity;
  let received = false;
  const timeout = window.setTimeout(() => {
    if (!received) {
      cleanup();
      onStatus("unavailable");
    }
  }, 5000);
  const onMotion = (event: DeviceMotionEvent) => {
    if (document.hidden) {
      previous = null;
      return;
    }
    const now = performance.now();
    if (now - last < 50) return;
    const a = event.acceleration;
    const includesGravity = !a || a.x === null || a.y === null || a.z === null;
    const source = includesGravity ? event.accelerationIncludingGravity : a;
    if (
      !source ||
      ![source.x, source.y, source.z].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      )
    )
      return;
    const current: [number, number, number] = [source.x!, source.y!, source.z!];
    if (!received) {
      received = true;
      window.clearTimeout(timeout);
      onStatus("active");
    }
    last = now;
    const delta = includesGravity
      ? current.map((value, i) => (previous ? value - previous[i] : 0))
      : current;
    previous = current;
    const force = Math.hypot(...delta);
    if (force < 1.2) return;
    const angle = ((window.screen.orientation?.angle || 0) * Math.PI) / 180;
    const x = delta[0] * Math.cos(angle) - delta[1] * Math.sin(angle);
    const y = delta[0] * Math.sin(angle) + delta[1] * Math.cos(angle);
    onImpulse(
      Math.max(-1, Math.min(1, x / 12)),
      Math.max(-1, Math.min(1, y / 12)),
      Math.min(0.6, force / 30),
    );
  };
  function cleanup() {
    window.clearTimeout(timeout);
    window.removeEventListener("devicemotion", onMotion);
    signal.removeEventListener("abort", cleanup);
  }
  window.addEventListener("devicemotion", onMotion, { passive: true });
  signal.addEventListener("abort", cleanup, { once: true });
}
