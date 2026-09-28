/**
 * Testbed.tsx — the testbed harness router (plan-final §5.15).
 *
 * `/?testbed&case=<id>[&renderer=webgl2]` mounts one case from
 * `testbed/cases/<id>.tsx` on LupiCanvas, over the fixed #101817 plate, with a
 * fixed perspective camera. After HARNESS_STABLE_FRAMES frames (and once the
 * case's holds are released) it reports `window.__lupiHarness.ready` and stops
 * advancing frames, so the smoke harness screenshots a still image.
 *
 * `/?testbed` alone lists the cases and publishes their ids in
 * `window.__lupiHarness.cases` (what `--cases=all` runs).
 *
 * Each rendering layer adds at most one case file and one line to CASES.
 */
import { Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import { LUPI_JOB } from '@atlas/scene';
import { detectRenderCapability } from './renderCapability';
import { LupiCanvas } from './viewer/LupiCanvas';
import {
  HARNESS_PLATE,
  HARNESS_STABLE_FRAMES,
  harnessAssert,
  harnessReady,
  harnessSettled,
  projectHarnessProbes,
  setHarnessBackend,
  startHarness,
} from './testbed/harness';

interface HarnessCaseModule {
  default: ComponentType;
}

const CASES: Record<string, () => Promise<HarnessCaseModule>> = {
  plate: () => import('./testbed/cases/plate'),
};

const CASE_IDS = Object.keys(CASES);

const CAMERA = { position: [0, 0, 5] as [number, number, number], fov: 50, near: 0.1, far: 100 };

const PAGE_STYLE = { width: '100vw', height: '100vh', background: HARNESS_PLATE } as const;

function requestedCase(): string {
  return new URLSearchParams(window.location.search).get('case') ?? '';
}

/** Projects the probes every frame; reports ready after the stable frames. */
function HarnessDriver({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const done = useRef(false);
  useFrame(
    (state) => {
      projectHarnessProbes(state.camera, state.size);
      if (done.current) return;
      frames.current += 1;
      if (frames.current >= HARNESS_STABLE_FRAMES && harnessSettled()) {
        done.current = true;
        harnessReady();
        onReady();
      }
    },
    { phase: 'finish', id: LUPI_JOB.harness },
  );
  return null;
}

function TestbedIndex({ unknown }: { unknown: string }) {
  return (
    <main style={{ ...PAGE_STYLE, color: '#d5ef9c', fontFamily: 'monospace', padding: 24, boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>Lupi testbed</h1>
      {unknown && <p role="alert">Unknown case "{unknown}".</p>}
      <ul>
        {CASE_IDS.map((id) => (
          <li key={id}>
            <a style={{ color: 'inherit' }} href={`?testbed&case=${id}`}>{id}</a>
            {' · '}
            <a style={{ color: 'inherit' }} href={`?testbed&case=${id}&renderer=webgl2`}>webgl2</a>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function Testbed() {
  const [capability] = useState(detectRenderCapability);
  const [caseId] = useState(requestedCase);
  const [Case, setCase] = useState<ComponentType | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    startHarness(caseId, CASE_IDS);
    const load = CASES[caseId];
    if (!load) {
      if (caseId) harnessAssert('case exists', false, `unknown case "${caseId}"; known: ${CASE_IDS.join(', ')}`);
      harnessReady();
      return;
    }
    let live = true;
    load().then(
      (module) => {
        if (live) setCase(() => module.default);
      },
      (error: unknown) => {
        harnessAssert('case loads', false, String(error));
        harnessReady();
      },
    );
    return () => {
      live = false;
    };
  }, [caseId]);

  if (!CASES[caseId]) return <TestbedIndex unknown={caseId} />;

  return (
    <div style={PAGE_STYLE}>
      <LupiCanvas
        id="lupi-testbed-canvas"
        capability={capability}
        frameloop={ready ? 'demand' : 'always'}
        camera={CAMERA}
        dpr={[1, 2]}
        background={HARNESS_PLATE}
        onRuntime={(runtime) => setHarnessBackend(runtime.backend)}
      >
        {Case && (
          <Suspense fallback={null}>
            <Case />
            <HarnessDriver onReady={() => setReady(true)} />
          </Suspense>
        )}
      </LupiCanvas>
    </div>
  );
}
