/**
 * BillionAtomsPage — the ?billion-atoms route: one billion atoms in view.
 *
 * A self-contained scale showcase (own Canvas, own controls — none of the
 * viewer's file/store machinery) around <BillionAtomBlock/>: a procedural
 * 1,000,188,000-atom FCC copper block rendered through hierarchical
 * brick LOD, with an honest HUD that separates "atoms in scene" from
 * "atoms drawn at atomic detail" and shows the live draw budget.
 *
 * The quality picker scales the atom-tier brick budget: High ≈ 3.5M atom
 * impostors near the camera, Medium ≈ 1.3M, Low ≈ 0.4M — the aggregate
 * tiers absorb the rest of the block either way.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { BillionAtomBlock, type BillionAtomStats } from '@atlas/scene';

const QUALITY = {
  high: { maxAtomBricks: 32, label: 'High' },
  medium: { maxAtomBricks: 12, label: 'Medium' },
  low: { maxAtomBricks: 4, label: 'Low' },
} as const;
type QualityId = keyof typeof QUALITY;

/** Phones start at Low (~430k atom impostors), tablets/laptops with modest
 *  memory at Medium — the aggregate tiers carry the block either way, and
 *  the picker stays one tap away. */
function defaultQuality(): QualityId {
  if (typeof navigator === 'undefined') return 'high';
  const ua = navigator.userAgent;
  const uaDataMobile = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  const isMobile = uaDataMobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (isMobile) return 'low';
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (deviceMemory !== undefined && deviceMemory < 6) return 'medium';
  return 'high';
}

const nf = (n: number) => n.toLocaleString('en-US');

function useFps(): { fps: number; onFrame: () => void } {
  const [fps, setFps] = useState(0);
  const acc = useRef({ frames: 0, last: 0 });
  const onFrame = useCallback(() => {
    const now = performance.now();
    const a = acc.current;
    a.frames++;
    if (a.last === 0) a.last = now;
    if (now - a.last >= 1000) {
      setFps(Math.round((a.frames * 1000) / (now - a.last)));
      a.frames = 0;
      a.last = now;
    }
  }, []);
  return { fps, onFrame };
}

function FrameTicker({ onFrame }: { onFrame: () => void }) {
  // Mounted inside the Canvas so ticks follow the real render loop.
  useFrame(onFrame);
  return null;
}

function DevProbe() {
  // Headless QA hook: lets a driver place the camera deterministically
  // (OrbitControls interactions require a "stable" page, which a software
  // rasterizer at atom-tier load never reaches).
  const camera = useRef<{ position: { set(x: number, y: number, z: number): unknown } } | null>(null);
  useFrame(({ camera: cam }) => { camera.current = cam; });
  useEffect(() => {
    (window as any).__lupiBillion = {
      setCamera: (x: number, y: number, z: number) => {
        camera.current?.position.set(x, y, z);
      },
    };
    return () => { delete (window as any).__lupiBillion; };
  }, []);
  return null;
}

export default function BillionAtomsPage() {
  const [quality, setQuality] = useState<QualityId>(defaultQuality);
  const [stats, setStats] = useState<BillionAtomStats | null>(null);
  const [hudOpen, setHudOpen] = useState(true);
  const { fps, onFrame } = useFps();

  useEffect(() => {
    document.title = 'Lupi · One Billion Atoms';
  }, []);

  const hudRow: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', gap: 16,
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0c12', color: '#e8eef8' }}>
      <Canvas
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ position: [1350, 950, 1750], near: 2, far: 40000, fov: 55 }}
        dpr={[1, 1.5]}
        style={{ touchAction: 'none' }}
      >
        <color attach="background" args={['#0a0c12']} />
        <BillionAtomBlock
          maxAtomBricks={QUALITY[quality].maxAtomBricks}
          onStats={setStats}
        />
        <FrameTicker onFrame={onFrame} />
        <DevProbe />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={40}
          maxDistance={12000}
        />
      </Canvas>

      {/* ── HUD — collapsible so phones keep the view unobstructed ── */}
      <div style={{
        position: 'absolute', top: 12, left: 12,
        maxWidth: 'min(380px, calc(100vw - 24px))',
        padding: '12px 14px', borderRadius: 12,
        background: 'rgba(8, 11, 18, 0.82)', border: '1px solid rgba(148,163,184,0.18)',
        backdropFilter: 'blur(10px)', fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: '#7de9ff', textTransform: 'uppercase' }}>
            Scale testbed
          </div>
          <button
            onClick={() => setHudOpen((v) => !v)}
            aria-label={hudOpen ? 'Collapse details' : 'Expand details'}
            style={{
              marginLeft: 'auto', width: 26, height: 26, borderRadius: 6,
              border: '1px solid rgba(148,163,184,0.3)', cursor: 'pointer',
              background: 'rgba(20,24,34,0.9)', color: '#cbd5e1',
              fontSize: 13, lineHeight: 1, fontWeight: 700,
            }}
          >
            {hudOpen ? '–' : '+'}
          </button>
        </div>
        <div style={{ fontSize: 'clamp(17px, 4.5vw, 22px)', fontWeight: 800, margin: '2px 0 4px' }}>
          {stats ? nf(stats.totalAtoms) : '1,000,188,000'} atoms in view
        </div>
        {hudOpen && (
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, marginBottom: 10 }}>
            Procedural FCC copper, 630³ unit cells (~228 nm edge). Every atom
            position is generated on the GPU from its index — no atom data
            exists in memory. Nearby bricks render atom-by-atom; the rest of
            the block renders as aggregated splats through 3 LOD tiers.
          </div>
        )}
        {hudOpen && stats && (
          <div style={{ display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' }}>
            <div style={hudRow}><span>Atoms at full detail</span><strong>{nf(stats.atomsDrawn)}</strong></div>
            <div style={hudRow}><span>Atoms in aggregate tiers</span><strong>{nf(stats.atomsAggregated)}</strong></div>
            <div style={hudRow}><span>Aggregate splats drawn</span><strong>{nf(stats.splatsDrawn)}</strong></div>
            <div style={hudRow}>
              <span>Bricks L0/L1/L2/L3</span>
              <strong>{stats.bricks.join(' / ')}</strong>
            </div>
            <div style={hudRow}><span>FPS</span><strong>{fps || '—'}</strong></div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {(Object.keys(QUALITY) as QualityId[]).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                border: '1px solid rgba(148,163,184,0.3)', cursor: 'pointer',
                background: quality === q ? '#1edce0' : 'rgba(20,24,34,0.9)',
                color: quality === q ? '#04252d' : '#cbd5e1',
              }}
            >
              {QUALITY[q].label}
            </button>
          ))}
          <a
            href="/"
            style={{
              marginLeft: 'auto', padding: '5px 12px', borderRadius: 7,
              fontSize: 12, fontWeight: 700, textDecoration: 'none',
              border: '1px solid rgba(148,163,184,0.3)', color: '#cbd5e1',
              background: 'rgba(20,24,34,0.9)',
            }}
          >
            ← Viewer
          </a>
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 12, left: 12, right: 12, fontSize: 11, color: '#64748b',
        fontFamily: 'system-ui, sans-serif', maxWidth: 520, pointerEvents: 'none',
      }}>
        Rendering testbed — a perfect lattice with stylized thermal motion,
        not a simulation. Drag to orbit, scroll or pinch to dive in until
        individual copper atoms resolve.
      </div>
    </div>
  );
}
