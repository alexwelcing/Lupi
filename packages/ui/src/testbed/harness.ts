/**
 * harness.ts — the testbed harness contract (plan-final §5.15).
 *
 * `/?testbed&case=<id>[&renderer=webgl2]` mounts one case from
 * `testbed/cases/<id>.tsx` inside the Testbed router. The page publishes
 * `window.__lupiHarness`; the smoke harness (`tools/verify-viewer-smoke.mjs
 * --scenarios=testbed`) waits for `ready`, screenshots the canvas, judges each
 * probe on the median of a 3×3 patch and reports every assertion.
 *
 * Case helpers:
 * - `useHarnessProbe(name, worldPoint, expect)` projects a world point with
 *   the active camera each frame into CSS pixels of the canvas.
 * - `harnessAssert(name, pass, detail)` records (or replaces) an assertion.
 * - `harnessHold(name)` delays readiness until the returned release is called,
 *   for assertions that resolve asynchronously.
 *
 * The router calls `harnessReady()` after HARNESS_STABLE_FRAMES frames once
 * no hold is open, and then stops advancing frames.
 */
import { useEffect } from 'react';
import { Vector3, type Camera } from 'three';
import type { LupiBackend } from '../viewer/createLupiRenderer';

/** The fixed testbed plate, the viewer's dark sage. */
export const HARNESS_PLATE = '#101817';

/** Frames rendered after a case mounts before it may report ready. */
export const HARNESS_STABLE_FRAMES = 8;

export type HarnessFamily = 'C' | 'O' | 'N' | 'H' | 'S';

/**
 * What a probe pixel must show. Families and `plate`/`not-plate` are judged by
 * the runner (§5.15): plate is within ±6 of (16,24,23); not-plate is more than
 * 12 away from it in some channel.
 */
export type HarnessExpect =
  | 'plate'
  | 'not-plate'
  | { rgb: [number, number, number]; tol: number }
  | { family: HarnessFamily };

export interface HarnessProbe {
  name: string;
  /** CSS pixels from the canvas's top-left corner. */
  x: number;
  y: number;
  expect: HarnessExpect;
}

export interface HarnessAssertion {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface LupiHarness {
  ready: boolean;
  case: string;
  backend: LupiBackend | null;
  probes: HarnessProbe[];
  assertions: HarnessAssertion[];
  /** Every case id the router knows (the `--cases=all` list). */
  cases: string[];
}

declare global {
  interface Window {
    __lupiHarness?: LupiHarness;
  }
}

interface ProbeSpec {
  name: string;
  world: Vector3;
  expect: HarnessExpect;
}

const probeSpecs = new Map<string, ProbeSpec>();
const holds = new Set<string>();
const scratch = new Vector3();

function harness(): LupiHarness {
  if (typeof window === 'undefined') {
    throw new Error('the testbed harness needs a window');
  }
  window.__lupiHarness ??= { ready: false, case: '', backend: null, probes: [], assertions: [], cases: [] };
  return window.__lupiHarness;
}

/** Reset the page API for a new case. Called by the router. */
export function startHarness(caseId: string, cases: readonly string[]): void {
  probeSpecs.clear();
  holds.clear();
  if (typeof window === 'undefined') return;
  window.__lupiHarness = { ready: false, case: caseId, backend: null, probes: [], assertions: [], cases: [...cases] };
}

export function setHarnessBackend(backend: LupiBackend): void {
  harness().backend = backend;
}

export function harnessAssert(name: string, pass: boolean, detail?: string): void {
  const entry: HarnessAssertion = detail === undefined ? { name, pass } : { name, pass, detail };
  const assertions = harness().assertions;
  const index = assertions.findIndex((assertion) => assertion.name === name);
  if (index === -1) assertions.push(entry);
  else assertions[index] = entry;
}

/** Keep the case un-ready until the returned function is called. */
export function harnessHold(name: string): () => void {
  holds.add(name);
  return () => {
    holds.delete(name);
  };
}

/** True when no hold is open. */
export function harnessSettled(): boolean {
  return holds.size === 0;
}

export function harnessReady(): void {
  harness().ready = true;
}

/** Declare a probe at a world point for the lifetime of the calling component. */
export function useHarnessProbe(
  name: string,
  worldPoint: readonly [number, number, number],
  expect: HarnessExpect,
): void {
  const [x, y, z] = worldPoint;
  const expectKey = JSON.stringify(expect);
  useEffect(() => {
    probeSpecs.set(name, { name, world: new Vector3(x, y, z), expect: JSON.parse(expectKey) as HarnessExpect });
    return () => {
      probeSpecs.delete(name);
    };
  }, [name, x, y, z, expectKey]);
}

/** Project every declared probe with `camera` into a canvas of `size` CSS pixels. */
export function projectHarnessProbes(camera: Camera, size: { width: number; height: number }): void {
  const probes: HarnessProbe[] = [];
  for (const spec of probeSpecs.values()) {
    scratch.copy(spec.world).project(camera);
    probes.push({
      name: spec.name,
      x: ((scratch.x + 1) / 2) * size.width,
      y: ((1 - scratch.y) / 2) * size.height,
      expect: spec.expect,
    });
  }
  harness().probes = probes;
}
