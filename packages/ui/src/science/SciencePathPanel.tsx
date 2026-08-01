/**
 * SciencePathPanel — first-class Z1 science panel (phase-0 prototype).
 *
 * Renders one golden path of the Z1 union campaign as a REACTION-PATH
 * SEQUENCE: per-image energy series (model profiles, GPAW anchors, VASP
 * reference) with per-series zero conventions, anchor/extrema marks, and the
 * T1 convention-wander panel (E_GPAW − E_VASP per NEB image).
 *
 * Deliberate non-goals (scientific display contract,
 * lupine-rhizo docs/plans/2026-07-24-visualization-pipeline-plan.md):
 *   - no ThermoMinimap / temperature colormap over image index;
 *   - no time axes, no dynamics framing — NEB image index only;
 *   - missing values stay missing; lines never interpolate across them;
 *   - cross-engine evidence is secondary and turns ochre when the T1
 *     wander gate fails; ochre is used for warnings/contamination only.
 */

import { useMemo, useState } from 'react';
import type {
  ScienceEnergySeries,
  SciencePanelFixture,
  SciencePathData,
} from './sciencePanelTypes';

const PAPER = '#faf9f6';
const INK = '#16171d';
const INDIGO = '#3d4db3';
const OCHRE = '#b97a1c';
const GRID = '#e4e2da';
const MUTED = '#6b6f7a';
/** Model profiles: four distinguishable grays + dash patterns (never ochre). */
const MODEL_STYLES = [
  { stroke: '#8b90a0', dash: '6 3' },
  { stroke: '#a8adbb', dash: '2 2' },
  { stroke: '#787d8c', dash: '8 3 2 3' },
  { stroke: '#c0c4cf', dash: '1 2' },
];

const FONT = 'system-ui, -apple-system, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const PLOT_W = 960;
const M = { l: 66, r: 20, t: 30, b: 46 };

function xFor(i: number, n: number) {
  return M.l + (n <= 1 ? 0 : (i / (n - 1)) * (PLOT_W - M.l - M.r));
}

const fmtMev = (v: number, digits = 1) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtEv = (v: number) => v.toFixed(6);

/** Polyline segments that break at missing values — a gap never becomes an observation. */
function segmentsFor<T extends { image: number; energyEv: number | null }>(
  points: T[],
  yFor: (ev: number) => number,
): string[] {
  const segs: string[] = [];
  let cur: string[] = [];
  for (const p of points) {
    if (p.energyEv == null) {
      if (cur.length > 0) segs.push(cur.join(' '));
      cur = [];
      continue;
    }
    cur.push(`${cur.length === 0 ? 'M' : 'L'}${xFor(p.image, points.length).toFixed(1)},${yFor(p.energyEv).toFixed(1)}`);
  }
  if (cur.length > 0) segs.push(cur.join(' '));
  return segs;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (n <= step) return step * pow;
  }
  return 10 * pow;
}

interface SeriesStyle {
  stroke: string;
  dash?: string;
  width: number;
}

function styleForSeries(series: ScienceEnergySeries, modelSlot: number): SeriesStyle {
  if (series.id === 'vasp-reference') return { stroke: INK, width: 1.8 };
  if (series.id === 'gpaw-anchors') return { stroke: INDIGO, width: 2.4 };
  const m = MODEL_STYLES[modelSlot % MODEL_STYLES.length];
  return { stroke: m.stroke, dash: m.dash, width: 1.5 };
}

/* ------------------------------------------------------------------ */
/* Energy plot                                                         */
/* ------------------------------------------------------------------ */

const ENERGY_H = 330;

function EnergyPlot({
  data,
  currentImage,
  onSelectImage,
}: {
  data: SciencePathData;
  currentImage: number;
  onSelectImage: (i: number) => void;
}) {
  const [hoverImage, setHoverImage] = useState<number | null>(null);
  const n = data.imageCount;

  /** Display values: each series zeroed at its own path minimum, in meV. */
  const prepared = useMemo(() => {
    let modelSlot = 0;
    let maxMev = 0;
    const rows = data.series.map((s) => {
      const values = s.points.map((p) => p.energyEv);
      const present = values.filter((v): v is number => v != null);
      const min = present.length ? Math.min(...present) : 0;
      const shifted = s.points.map((p) => ({
        ...p,
        mev: p.energyEv == null ? null : (p.energyEv - min) * 1000,
      }));
      for (const p of shifted) if (p.mev != null && p.mev > maxMev) maxMev = p.mev;
      const isModel = s.id.startsWith('model-');
      const style = isModel ? styleForSeries(s, modelSlot++) : styleForSeries(s, 0);
      return { series: s, shifted, style, isModel };
    });
    return { rows, yMax: niceCeil(maxMev * 1.06) };
  }, [data]);

  const yFor = (mev: number) =>
    M.t + (1 - mev / prepared.yMax) * (ENERGY_H - M.t - M.b);
  const yForEv = (seriesRow: (typeof prepared.rows)[number]) => {
    const present = seriesRow.series.points.filter((p) => p.energyEv != null);
    const min = present.length ? Math.min(...present.map((p) => p.energyEv!)) : 0;
    return (ev: number) => yFor((ev - min) * 1000);
  };

  const activeImage = hoverImage ?? currentImage;
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = niceCeil(prepared.yMax / 4.2);
    for (let v = 0; v <= prepared.yMax + 1e-9; v += step) ticks.push(v);
    return ticks;
  }, [prepared.yMax]);

  return (
    <figure style={{ margin: 0 }} data-testid="science-energy-plot">
      <svg
        viewBox={`0 0 ${PLOT_W} ${ENERGY_H}`}
        width="100%"
        role="img"
        aria-label="Per-image energy profiles along the reaction-path sequence"
        onMouseLeave={() => setHoverImage(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * PLOT_W;
          let best = 0;
          for (let i = 0; i < n; i++) if (Math.abs(xFor(i, n) - x) < Math.abs(xFor(best, n) - x)) best = i;
          setHoverImage(best);
        }}
        onClick={() => onSelectImage(activeImage)}
        style={{ cursor: 'crosshair', display: 'block' }}
      >
        <rect x={0} y={0} width={PLOT_W} height={ENERGY_H} fill={PAPER} />
        {/* grid + axes */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={PLOT_W - M.r} y1={yFor(v)} y2={yFor(v)} stroke={GRID} strokeWidth={1} />
            <text x={M.l - 8} y={yFor(v) + 3.5} textAnchor="end" fontSize={10.5} fill={MUTED} fontFamily={MONO}>
              {fmtMev(v, 0)}
            </text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => (
          <g key={i}>
            <line x1={xFor(i, n)} x2={xFor(i, n)} y1={M.t} y2={ENERGY_H - M.b} stroke={GRID} strokeWidth={i === 0 || i === n - 1 ? 0 : 0.6} />
            <text x={xFor(i, n)} y={ENERGY_H - M.b + 16} textAnchor="middle" fontSize={11} fill={INK} fontFamily={MONO}>
              {i}
            </text>
          </g>
        ))}
        <text x={(M.l + PLOT_W - M.r) / 2} y={ENERGY_H - 8} textAnchor="middle" fontSize={11.5} fill={INK} fontFamily={FONT}>
          NEB image index — reaction-path sequence (zero-based; not a time axis)
        </text>
        <text x={16} y={M.t - 12} fontSize={11} fill={MUTED} fontFamily={FONT}>
          meV above each series’ own path minimum
        </text>

        {/* current-image indicator */}
        <line
          x1={xFor(currentImage, n)} x2={xFor(currentImage, n)} y1={M.t} y2={ENERGY_H - M.b}
          stroke={INK} strokeWidth={1} strokeDasharray="2 3" opacity={0.55}
        />

        {/* series lines + points */}
        {prepared.rows.map(({ series, shifted, style }) => (
          <g key={series.id}>
            {segmentsFor(shifted.map((p) => ({ ...p, energyEv: p.mev })), yFor).map((d, k) => (
              <path key={k} d={d} fill="none" stroke={style.stroke} strokeWidth={style.width} strokeDasharray={style.dash} />
            ))}
            {shifted.map((p) => {
              if (p.mev == null) {
                // Missing stays missing: an explicit gap marker, not a value.
                if (series.id !== 'gpaw-anchors') return null;
                return (
                  <g key={p.image} opacity={0.5}>
                    <line x1={xFor(p.image, n) - 4} x2={xFor(p.image, n) + 4} y1={ENERGY_H - M.b - 4} y2={ENERGY_H - M.b + 4} stroke={MUTED} strokeWidth={1.2} />
                    <line x1={xFor(p.image, n) + 4} x2={xFor(p.image, n) - 4} y1={ENERGY_H - M.b - 4} y2={ENERGY_H - M.b + 4} stroke={MUTED} strokeWidth={1.2} />
                    <title>{`${series.label} — NEB image ${p.image}: missing (not evaluated)`}</title>
                  </g>
                );
              }
              const cx = xFor(p.image, n);
              const cy = yFor(p.mev);
              const title = `${series.label} — NEB image ${p.image}: ${p.energyEv != null ? fmtEv(p.energyEv) : '—'} eV absolute (${fmtMev(p.mev)} meV above own minimum)`;
              if (series.id === 'gpaw-anchors') {
                const evaluated = p.status === 'evaluated';
                return (
                  <g key={p.image}>
                    <circle
                      cx={cx} cy={cy} r={5}
                      fill={evaluated ? INDIGO : PAPER}
                      stroke={INDIGO} strokeWidth={2}
                    >
                      <title>{`${title} · ${evaluated ? 'evaluated anchor' : 'nominated, not evaluated'}`}</title>
                    </circle>
                    {p.denseExtension && (
                      <text
                        x={cx} y={cy - 9}
                        textAnchor={p.image === n - 1 ? 'end' : 'middle'}
                        fontSize={8.5} fill={INDIGO} fontFamily={MONO} fontWeight={700}
                        style={{ paintOrder: 'stroke' }} stroke={PAPER} strokeWidth={3}
                      >
                        dense-ext
                      </text>
                    )}
                  </g>
                );
              }
              if (series.id === 'vasp-reference') {
                return (
                  <rect key={p.image} x={cx - 3.6} y={cy - 3.6} width={7.2} height={7.2} fill={INK}>
                    <title>{title}</title>
                  </rect>
                );
              }
              return (
                <circle key={p.image} cx={cx} cy={cy} r={3} fill={PAPER} stroke={style.stroke} strokeWidth={1.6}>
                  <title>{title}</title>
                </circle>
              );
            })}
          </g>
        ))}

        {/* extrema marks: every series gets argmin (▼) and argmax (▲), stacked per series.
            Both sit above their point: a normalized series' argmin always rests on the
            bottom axis, so marks below it would collide with the tick labels. */}
        {prepared.rows.map(({ series, style }, slot) => {
          const ex = data.extrema[series.id];
          if (!ex || ex.argmin < 0 || ex.argmax < 0) return null;
          const row = prepared.rows[slot];
          const yOfEv = yForEv(row);
          const pts = series.points;
          const minV = pts[ex.argmin]?.energyEv;
          const maxV = pts[ex.argmax]?.energyEv;
          if (minV == null || maxV == null) return null;
          const upY = yOfEv(maxV) - 11 - slot * 6.5;
          const dnY = yOfEv(minV) - 11 - slot * 6.5;
          return (
            <g key={`ex-${series.id}`} fill={style.stroke}>
              <path d={`M${xFor(ex.argmax, n) - 4},${upY + 5} L${xFor(ex.argmax, n) + 4},${upY + 5} L${xFor(ex.argmax, n)},${upY} Z`}>
                <title>{`${series.label} argmax: NEB image ${ex.argmax} (tie rule: first index)`}</title>
              </path>
              <path d={`M${xFor(ex.argmin, n) - 4},${dnY} L${xFor(ex.argmin, n) + 4},${dnY} L${xFor(ex.argmin, n)},${dnY + 5} Z`}>
                <title>{`${series.label} argmin: NEB image ${ex.argmin} (tie rule: first index)`}</title>
              </path>
            </g>
          );
        })}

        {/* barrier bracket for the primary same-engine series; every series' barrier
            and barrier-defining pair also appear in the legend below */}
        {prepared.rows
          .filter(({ series }) => series.id === 'gpaw-anchors')
          .map(({ series, style }) => {
            const ex = data.extrema[series.id];
            if (!ex || ex.barrierEv == null || ex.argmin < 0 || ex.argmax < 0) return null;
            const row = prepared.rows.find((r) => r.series.id === series.id)!;
            const yOfEv = yForEv(row);
            const maxV = series.points[ex.argmax].energyEv!;
            const lastImage = ex.argmax === data.imageCount - 1;
            const x = xFor(ex.argmax, data.imageCount);
            const labelX = lastImage ? x - 8 : x + 8;
            return (
              <g key={`bar-${series.id}`}>
                <line x1={x} x2={x} y1={yOfEv(maxV)} y2={yOfEv(maxV - ex.barrierEv)} stroke={style.stroke} strokeWidth={1.2} strokeDasharray="3 2" />
                <text
                  x={labelX} y={(yOfEv(maxV) + yOfEv(maxV - ex.barrierEv)) / 2}
                  textAnchor={lastImage ? 'end' : 'start'}
                  fontSize={10.5} fill={style.stroke} fontFamily={MONO} fontWeight={600}
                  style={{ paintOrder: 'stroke' }} stroke={PAPER} strokeWidth={3.5}
                >
                  {`GPAW barrier ${fmtMev(ex.barrierEv * 1000)} meV`}
                </text>
              </g>
            );
          })}

        {/* hover cursor */}
        {hoverImage != null && (
          <line x1={xFor(hoverImage, n)} x2={xFor(hoverImage, n)} y1={M.t} y2={ENERGY_H - M.b} stroke={INDIGO} strokeWidth={1} opacity={0.35} />
        )}
      </svg>

      {/* legend: series identity, role, zero convention, extrema + barrier-defining pair */}
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, fontSize: 12, fontFamily: FONT, color: INK }}>
        {prepared.rows.map(({ series, style }) => {
          const ex = data.extrema[series.id];
          return (
            <li key={series.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '1.5px 0', flexWrap: 'wrap' }}>
              <svg width={34} height={8} style={{ flex: '0 0 auto', alignSelf: 'center' }}>
                <line x1={0} x2={34} y1={4} y2={4} stroke={style.stroke} strokeWidth={style.width + 0.4} strokeDasharray={style.dash} />
              </svg>
              <strong>{series.label}</strong>
              <span style={{ color: MUTED }}>{series.role}</span>
              {ex && ex.barrierEv != null && (
                <span style={{ fontFamily: MONO, color: MUTED }}>
                  min@{ex.argmin} · max@{ex.argmax} · barrier {fmtMev(ex.barrierEv * 1000)} meV
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: MUTED, fontFamily: FONT }}>
        Zero convention: each series shifted to its own path minimum for display; absolute eV values in point tooltips and the readout below.
        Extrema tie rule: first index. ▲/▼ mark each series’ argmax/argmin (the barrier-defining pair).
      </p>

      {/* absolute-value readout at the hovered/selected image */}
      <div
        data-testid="science-energy-readout"
        style={{
          marginTop: 6, padding: '6px 10px', border: `1px solid ${GRID}`, borderRadius: 4,
          fontFamily: MONO, fontSize: 11.5, color: INK, background: '#f4f2ec',
          display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 2,
        }}
      >
        <span style={{ fontWeight: 700, flex: '0 0 100%' }}>
          NEB image {activeImage} (zero-based index; images 0–{n - 1})
        </span>
        {prepared.rows.map(({ series, shifted }) => {
          const p = shifted[activeImage];
          return (
            <span key={series.id} style={{ whiteSpace: 'nowrap' }}>
              {series.id === 'gpaw-anchors' ? 'GPAW' : series.id === 'vasp-reference' ? 'VASP' : series.engine}:{' '}
              {p?.energyEv == null ? 'missing' : `${fmtEv(p.energyEv)} eV`}
            </span>
          );
        })}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Anchor strip                                                        */
/* ------------------------------------------------------------------ */

const STRIP_H = 74;

function AnchorStrip({ data, currentImage }: { data: SciencePathData; currentImage: number }) {
  const n = data.imageCount;
  const union = new Set(data.anchors.unionNominated);
  const evaluated = new Set(data.anchors.evaluated);
  const denseExt = new Set(data.anchors.denseExtensionImages);
  const y = 22;
  return (
    <figure style={{ margin: '18px 0 0' }} data-testid="science-anchor-strip">
      <svg viewBox={`0 0 ${PLOT_W} ${STRIP_H}`} width="100%" role="img" aria-label="Anchor nomination and evaluation marks per NEB image">
        <rect x={0} y={0} width={PLOT_W} height={STRIP_H} fill={PAPER} />
        {Array.from({ length: n }, (_, i) => {
          const cx = xFor(i, n);
          const isEval = evaluated.has(i);
          const isUnion = union.has(i);
          const isDense = denseExt.has(i);
          return (
            <g key={i}>
              <line x1={cx} x2={cx} y1={y - 12} y2={y + 12} stroke={GRID} strokeWidth={1} />
              {isEval ? (
                <circle cx={cx} cy={y} r={5.5} fill={INDIGO} stroke={INDIGO}>
                  <title>{`NEB image ${i}: evaluated GPAW anchor${isDense ? ' (dense extension — evaluated beyond union nominations)' : ''}`}</title>
                </circle>
              ) : isUnion ? (
                <circle cx={cx} cy={y} r={5.5} fill={PAPER} stroke={INDIGO} strokeWidth={2}>
                  <title>{`NEB image ${i}: nominated by union, not evaluated`}</title>
                </circle>
              ) : (
                <circle cx={cx} cy={y} r={3} fill="none" stroke={GRID} strokeWidth={1.2}>
                  <title>{`NEB image ${i}: not nominated, not evaluated`}</title>
                </circle>
              )}
              {isDense && (
                <text
                  x={cx} y={y + 22}
                  textAnchor={i === n - 1 ? 'end' : 'middle'}
                  fontSize={9} fill={INDIGO} fontFamily={MONO} fontWeight={700}
                >
                  dense-ext
                </text>
              )}
              <text x={cx} y={STRIP_H - 6} textAnchor="middle" fontSize={10} fill={MUTED} fontFamily={MONO}>
                {i}
              </text>
              {i === currentImage && <circle cx={cx} cy={y} r={9} fill="none" stroke={INK} strokeWidth={1} strokeDasharray="2 2" />}
            </g>
          );
        })}
      </svg>
      <p style={{ margin: '2px 0 0', fontSize: 11.5, color: MUTED, fontFamily: FONT }}>
        Anchors: <MarkSwatch kind="evaluated" /> evaluated · <MarkSwatch kind="nominated" /> nominated (not evaluated) ·{' '}
        <MarkSwatch kind="union-only" /> union-only (nominated by the union, absent from this model’s set) ·{' '}
        <span style={{ color: INDIGO, fontFamily: MONO, fontWeight: 700, fontSize: 10 }}>dense-ext</span> dense-extension
        (evaluated beyond the union nomination). Union nominated [{data.anchors.unionNominated.join(', ') || '—'}]; evaluated [
        {data.anchors.evaluated.join(', ')}].
      </p>
    </figure>
  );
}

function MarkSwatch({ kind }: { kind: 'evaluated' | 'nominated' | 'union-only' }) {
  if (kind === 'union-only') {
    return (
      <svg width={12} height={12} style={{ verticalAlign: '-1px' }}>
        <rect x={3} y={3} width={6} height={6} transform="rotate(45 6 6)" fill={PAPER} stroke={INDIGO} strokeWidth={1.6} />
      </svg>
    );
  }
  return (
    <svg width={12} height={12} style={{ verticalAlign: '-1px' }}>
      <circle cx={6} cy={6} r={4.5} fill={kind === 'evaluated' ? INDIGO : PAPER} stroke={INDIGO} strokeWidth={1.6} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* T1 convention-wander panel                                          */
/* ------------------------------------------------------------------ */

const T1_H = 210;

function T1Panel({
  data,
  currentImage,
  onSelectImage,
}: {
  data: SciencePathData;
  currentImage: number;
  onSelectImage: (i: number) => void;
}) {
  const n = data.imageCount;
  const { t1 } = data;
  const contaminated = t1.verdict === 'contaminated';
  const accent = contaminated ? OCHRE : INDIGO;

  const values = t1.offsets.map((o) => o.offsetMev);
  const present = values.filter((v): v is number => v != null);
  const min = Math.min(...present);
  const max = Math.max(...present);
  const pad = Math.max((max - min) * 0.14, t1.thresholdMev * 0.6);
  const yFor = (v: number) => M.t + (1 - (v - (min - pad)) / (max + pad - (min - pad))) * (T1_H - M.t - M.b);

  const [d0, d1] = t1.driverPair;
  const yTicks = [min, (min + max) / 2, max];

  return (
    <figure style={{ margin: 0 }} data-testid="science-t1-panel" data-verdict={t1.verdict}>
      <svg
        viewBox={`0 0 ${PLOT_W} ${T1_H}`}
        width="100%"
        role="img"
        aria-label="T1 per-image offset, E_GPAW minus E_VASP, in meV"
        style={{ cursor: 'crosshair', display: 'block' }}
        onClick={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * PLOT_W;
          let best = 0;
          for (let i = 0; i < n; i++) if (Math.abs(xFor(i, n) - x) < Math.abs(xFor(best, n) - x)) best = i;
          onSelectImage(best);
        }}
      >
        <rect x={0} y={0} width={PLOT_W} height={T1_H} fill={PAPER} />
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={PLOT_W - M.r} y1={yFor(v)} y2={yFor(v)} stroke={GRID} strokeWidth={1} />
            <text x={M.l - 8} y={yFor(v) + 3.5} textAnchor="end" fontSize={10.5} fill={MUTED} fontFamily={MONO}>
              {fmtMev(v, 0)}
              </text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => (
          <text key={i} x={xFor(i, n)} y={T1_H - M.b + 16} textAnchor="middle" fontSize={11} fill={INK} fontFamily={MONO}>
            {i}
          </text>
        ))}
        <text x={(M.l + PLOT_W - M.r) / 2} y={T1_H - 8} textAnchor="middle" fontSize={11.5} fill={INK} fontFamily={FONT}>
          NEB image index — offsets exist at evaluated anchors only; missing stays missing
        </text>
        <text x={16} y={M.t - 12} fontSize={11} fill={MUTED} fontFamily={FONT}>
          E_GPAW(i) − E_VASP(i), meV
        </text>

        {/* wander bracket between driver-pair levels */}
        <line x1={M.l} x2={xFor(Math.max(d0, d1), n)} y1={yFor(min)} y2={yFor(min)} stroke={accent} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
        <line x1={M.l} x2={xFor(Math.max(d0, d1), n)} y1={yFor(max)} y2={yFor(max)} stroke={accent} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
        <line x1={xFor(Math.max(d0, d1), n) + 10} x2={xFor(Math.max(d0, d1), n) + 10} y1={yFor(min)} y2={yFor(max)} stroke={accent} strokeWidth={1.6} />
        {(() => {
          const label = `wander ${fmtMev(t1.wanderMev, 2)} meV vs gate ${fmtMev(t1.thresholdMev, 0)} meV`;
          const natural = xFor(Math.max(d0, d1), n) + 18;
          const maxX = PLOT_W - M.r - label.length * 6.8;
          const lx = Math.max(M.l + 8, Math.min(natural, maxX));
          return (
            <text
              x={lx} y={yFor(max) + 18}
              fontSize={11} fill={accent} fontFamily={MONO} fontWeight={700}
              style={{ paintOrder: 'stroke' }} stroke={PAPER} strokeWidth={3}
            >
              {label}
            </text>
          );
        })()}

        {/* gate reference bracket (threshold in the same meV units; unlabeled on
            purpose — the comparison is in the wander label and stats strip) */}
        <g>
          <line x1={M.l + 6} x2={M.l + 6} y1={yFor(min)} y2={yFor(min + t1.thresholdMev)} stroke={MUTED} strokeWidth={1.4}>
            <title>{`T1 gate: ${fmtMev(t1.thresholdMev, 0)} meV, drawn in the same units as the offsets`}</title>
          </line>
        </g>

        {/* offset polyline (breaks at missing) + points */}
        {segmentsFor(t1.offsets.map((o) => ({ image: o.image, energyEv: o.offsetMev })), yFor).map((d, k) => (
          <path key={k} d={d} fill="none" stroke={INDIGO} strokeWidth={1.8} />
        ))}
        {t1.offsets.map((o) => {
          if (o.offsetMev == null) return null;
          const cx = xFor(o.image, n);
          const cy = yFor(o.offsetMev);
          const isDriver = o.image === d0 || o.image === d1;
          const isMaxDriver = isDriver && o.offsetMev === max;
          return (
            <g key={o.image}>
              {isDriver && <circle cx={cx} cy={cy} r={8.5} fill="none" stroke={accent} strokeWidth={2.2} />}
              <circle cx={cx} cy={cy} r={4.5} fill={o.image === currentImage ? INK : INDIGO} stroke={PAPER} strokeWidth={1}>
                <title>{`NEB image ${o.image}: offset ${fmtMev(o.offsetMev, 2)} meV${isDriver ? ' — T1 driver image' : ''}`}</title>
              </circle>
              {isDriver && (
                <text
                  x={cx} y={isMaxDriver ? cy - 13 : cy + 21}
                  textAnchor="middle" fontSize={9.5} fill={accent} fontFamily={MONO} fontWeight={700}
                  style={{ paintOrder: 'stroke' }} stroke={PAPER} strokeWidth={3}
                >
                  driver
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div
        style={{
          marginTop: 6, padding: '8px 12px', borderRadius: 4, fontFamily: FONT, fontSize: 12.5,
          border: `1px solid ${contaminated ? OCHRE : GRID}`,
          background: contaminated ? '#faf3e6' : '#f4f2ec', color: INK,
        }}
        data-testid="science-t1-verdict"
      >
        <strong style={{ color: accent, letterSpacing: '0.02em' }}>
          T1 {contaminated ? 'CONTAMINATED' : 'CLEAN'}
        </strong>
        <span style={{ marginLeft: 10, fontFamily: MONO }}>
          wander {fmtMev(t1.wanderMev, 2)} meV {contaminated ? '>' : '≤'} gate {fmtMev(t1.thresholdMev, 0)} meV
        </span>
        <span style={{ marginLeft: 10, fontFamily: MONO }}>
          driver pair: NEB images {d0} &amp; {d1}
        </span>
        <span style={{ marginLeft: 10, color: accent, fontFamily: MONO, fontWeight: 600 }}>
          selected img {currentImage}: offset{' '}
          {t1.offsets[currentImage]?.offsetMev == null
            ? 'missing'
            : `${fmtMev(t1.offsets[currentImage].offsetMev as number, 1)} meV`}
        </span>
        <span style={{ marginLeft: 10, color: MUTED, fontFamily: MONO }}>
          mean offset {fmtMev(t1.offsetMeanMev, 0)} meV (cell-convention shift; only the wander is gated)
        </span>
        <div style={{ marginTop: 4, fontSize: 11.5, color: MUTED }}>
          Same-engine evidence (GPAW anchors vs dense GPAW profile) is primary. Cross-engine comparison to the VASP
          reference is secondary{contaminated ? ' and marked contaminated here because the wander gate fails.' : '.'}{' '}
          Offsets: {t1.definition}.
        </div>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Guidance, model failure, dense extension                            */
/* ------------------------------------------------------------------ */

function GuidanceSection({ data }: { data: SciencePathData }) {
  const models = Object.entries(data.anchors.perModel);
  const union = new Set(data.anchors.unionNominated);
  const deficitValues = models
    .map(([, m]) => m.sameEngineAbsErrorMev)
    .filter((v): v is number => v != null);
  const maxDeficit = deficitValues.length ? Math.max(...deficitValues) : null;

  return (
    <section data-testid="science-guidance" style={{ marginTop: 20, fontFamily: FONT }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 13.5, color: INK }}>Guidance, anchor selection, and model failures</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: MUTED, borderBottom: `1px solid ${GRID}` }}>
            <th style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>model</th>
            <th style={{ padding: '4px 8px', fontWeight: 600 }}>status</th>
            <th style={{ padding: '4px 8px', fontWeight: 600 }}>nominated → evaluated</th>
            <th style={{ padding: '4px 8px', fontWeight: 600 }}>same-engine deficit</th>
            <th style={{ padding: '4px 8px', fontWeight: 600 }}>cross-engine |err|</th>
            <th style={{ padding: '4px 8px', fontWeight: 600 }}>notes</th>
          </tr>
        </thead>
        <tbody>
          {models.map(([model, m]) => {
            const failed = m.status !== 'guided';
            const unionOnly = [...union].filter((i) => !m.nominated.includes(i));
            return (
              <tr key={model} style={{ borderBottom: `1px solid ${GRID}`, color: failed ? OCHRE : INK }}>
                <td style={{ padding: '4px 8px 4px 0', fontFamily: MONO }}>{model}</td>
                <td style={{ padding: '4px 8px', fontWeight: failed ? 700 : 400 }}>{m.status}</td>
                <td style={{ padding: '4px 8px', fontFamily: MONO }}>
                  [{m.nominated.join(', ')}] → [{m.evaluated.join(', ')}]
                  {unionOnly.length > 0 && (
                    <span title="union-only anchors: nominated by the union but absent from this model's set">
                      {' '}· ◇ [{unionOnly.join(', ')}]
                    </span>
                  )}
                </td>
                <td style={{ padding: '4px 8px', fontFamily: MONO }}>
                  {m.sameEngineAbsErrorMev == null ? '—' : `${fmtMev(m.sameEngineAbsErrorMev)} meV`}
                </td>
                <td style={{ padding: '4px 8px', fontFamily: MONO }}>
                  {m.vaspAbsErrorMev == null ? '—' : `${fmtMev(m.vaspAbsErrorMev)} meV`}
                </td>
                <td style={{ padding: '4px 8px', color: MUTED }}>
                  {[
                    m.shortPathFallback ? 'short-path fallback' : null,
                    m.window != null ? `window ±${m.window}` : null,
                    !m.profileAvailable && !failed ? 'no profile in cell result' : null,
                  ].filter(Boolean).join(' · ') || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: INK }}>
        {data.guidance.misses.length === 0 ? (
          <li>
            No guidance misses: every guided model’s evaluated anchor set contains both dense-profile extrema
            (images {data.extrema['gpaw-anchors'].argmin} and {data.extrema['gpaw-anchors'].argmax}).
          </li>
        ) : (
          data.guidance.misses.map((miss) => (
            <li key={miss.model} style={{ color: miss.kind === 'model-failed' ? OCHRE : INK }}>
              {miss.kind === 'model-failed'
                ? `${miss.model}: guide failed (${miss.reason}) — counted in the denominator, not hidden`
                : `${miss.model}: missed dense extremum image(s) [${(miss.missedImages ?? []).join(', ')}]` +
                  (miss.sameEngineAbsErrorMev != null ? ` · same-engine deficit ${fmtMev(miss.sameEngineAbsErrorMev)} meV` : '')}
            </li>
          ))
        )}
        <li>
          Model availability: {data.quality.guidedModelCount} of {data.quality.modelDenominator} models guided this path
          {data.quality.failedModelCount > 0 ? `; ${data.quality.failedModelCount} failed` : ''}.
          {maxDeficit != null && <> Same-engine deficit (max over models): {fmtMev(maxDeficit)} meV.</>}
        </li>
        <li>
          Dense extension {data.dense.applied ? `applied (${data.dense.complete ? 'complete' : 'incomplete'})` : 'not applied'}
          {data.anchors.denseExtensionImages.length > 0
            ? ` — images [${data.anchors.denseExtensionImages.join(', ')}] evaluated beyond the union nomination`
            : ' — no images beyond the union nomination needed'}
          . Dense-profile barrier {fmtMev(data.dense.barrierEv * 1000)} meV.
        </li>
        <li style={{ color: MUTED }}>
          Subset theorem used by Z1: {data.guidance.subsetTheorem}.
        </li>
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Header + quality banner                                             */
/* ------------------------------------------------------------------ */

function qualityCopy(data: SciencePathData, fixture: SciencePanelFixture): { title: string; detail: string; warn: boolean } {
  const q = data.quality;
  const gate = fixture.campaign.thresholds.t1GateMev;
  const win = fixture.campaign.thresholds.winMev;
  switch (q.state) {
    case 'clean': {
      const sole = fixture.campaign.t1Summary.pathsContaminated === fixture.campaign.t1Summary.pathsWithOffsets - 1;
      return {
        title: 'CLEAN — T1 gate passed',
        detail: `wander ${fmtMev(data.t1.wanderMev, 2)} meV ≤ ${fmtMev(gate, 0)} meV; same-engine strong win` +
          (sole ? `; the only T1-clean path of ${fixture.campaign.t1Summary.pathsWithOffsets}` : ''),
        warn: false,
      };
    }
    case 'strong-win-contaminated':
      return {
        title: 'STRONG WIN (same-engine) — but cross-engine CONTAMINATED',
        detail: `cross-engine error ${fmtMev(q.crossEngineSignedErrorMev ?? q.crossEngineErrorMev, 1)} meV (signed) looks acceptable (≤ ${fmtMev(win, 0)} meV), ` +
          `yet T1 wander ${fmtMev(data.t1.wanderMev, 2)} meV > ${fmtMev(gate, 0)} meV gate — the agreement is a convention coincidence`,
        warn: true,
      };
    case 'contaminated':
      return {
        title: 'CONTAMINATED — T1 wander gate failed',
        detail: `wander ${fmtMev(data.t1.wanderMev, 2)} meV > ${fmtMev(gate, 0)} meV (drivers: NEB images ${data.t1.driverPair[0]} & ${data.t1.driverPair[1]}); ` +
          `cross-engine error ${fmtMev(q.crossEngineSignedErrorMev ?? q.crossEngineErrorMev, 1)} meV (signed)`,
        warn: true,
      };
    case 'all-guides-failed':
      return {
        title: 'ALL GUIDES FAILED — dense extension supplied the profile',
        detail: `0 of ${q.modelDenominator} models produced a profile; every GPAW image evaluated as dense extension. ` +
          `This path stays visible as a failure case, not dropped from averages`,
        warn: true,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Main panel                                                          */
/* ------------------------------------------------------------------ */

export interface SciencePathPanelProps {
  data: SciencePathData;
  fixture: SciencePanelFixture;
  currentImage?: number;
  onImageChange?: (image: number) => void;
}

export function SciencePathPanel({ data, fixture, currentImage, onImageChange }: SciencePathPanelProps) {
  const [internalImage, setInternalImage] = useState(0);
  const image = Math.min(currentImage ?? internalImage, data.imageCount - 1);
  const setImage = (i: number) => {
    const clamped = Math.max(0, Math.min(i, data.imageCount - 1));
    setInternalImage(clamped);
    onImageChange?.(clamped);
  };

  const quality = qualityCopy(data, fixture);
  const campaign = fixture.campaign;

  return (
    <article
      data-testid="science-path-panel"
      data-path-index={data.pathIndex}
      data-quality-state={data.qualityState}
      data-bundle-status={data.revision.status}
      data-bundle-quality={data.revision.qualityState}
      style={{
        background: PAPER, color: INK, fontFamily: FONT,
        border: `1px solid ${GRID}`, borderRadius: 8,
        padding: '20px 22px', maxWidth: 1060, margin: '0 auto',
        boxShadow: '0 1px 4px rgba(22,23,29,0.08)',
      }}
    >
      {/* header: campaign / run / path identity, bundle revision, quality, citation */}
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: MUTED, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Z1 union campaign · run recorded {campaign.recordedAt.slice(0, 10)}
          </div>
          <h2 style={{ margin: '2px 0', fontSize: 19, color: INK }}>
            Path {data.pathIndex} · <span style={{ fontFamily: MONO, fontSize: 16 }}>{data.pathId}</span> · {data.chemicalSystem}
          </h2>
          <div style={{ fontSize: 11.5, color: MUTED, fontFamily: MONO }}>
            manifest: {data.revision.manifestSha256.slice(0, 23)}… · bundle: {data.revision.bundleId.slice(0, 23)}…
          </div>
          <div
            data-testid="science-run-provenance"
            style={{ fontSize: 11.5, color: MUTED, fontFamily: MONO, marginTop: 2, overflowWrap: 'anywhere' }}
          >
            Source campaign: {data.revision.campaignId}<br />
            Run id: {data.revision.runId}<br />
            Bundle digest: {data.revision.bundleId}<br />
            Manifest digest: {data.revision.manifestSha256}<br />
            Campaign source: {data.revision.sources.campaign}<br />
            Barrier-lock source: {data.revision.sources.barrierLock}<br />
            Supersedes chain: {data.revision.supersedesChain.length > 0 ? data.revision.supersedesChain.join(' → ') : 'none'}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
            {campaign.citation}
          </div>
        </div>
        <div
          data-testid="science-quality-badge"
          style={{
            alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 5,
            border: `1.5px solid ${quality.warn ? OCHRE : INDIGO}`,
            color: quality.warn ? OCHRE : INDIGO,
            fontWeight: 700, fontSize: 12, letterSpacing: '0.03em', whiteSpace: 'nowrap',
          }}
        >
          {data.qualityState.replace(/-/g, ' ').toUpperCase()}
        </div>
      </header>

      {/* quality banner */}
      <div
        data-testid="science-quality-banner"
        role={quality.warn ? 'alert' : 'status'}
        style={{
          marginTop: 12, padding: '9px 12px', borderRadius: 5,
          border: `1px solid ${quality.warn ? OCHRE : INDIGO}`,
          background: quality.warn ? '#faf3e6' : '#eef0fa',
          fontSize: 13,
        }}
      >
        <strong style={{ color: quality.warn ? OCHRE : INDIGO }}>{quality.title}</strong>
        <span style={{ marginLeft: 8, color: INK }}>{quality.detail}.</span>
      </div>

      {/* reaction-path position control — explicitly not a time control */}
      <div
        data-testid="science-image-stepper"
        style={{
          marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 12px', border: `1px solid ${GRID}`, borderRadius: 5, background: '#f4f2ec',
        }}
      >
        <strong style={{ fontSize: 13 }}>
          Reaction-path sequence — NEB image {image} of {data.imageCount} (zero-based; indices 0–{data.imageCount - 1})
        </strong>
        <button onClick={() => setImage(image - 1)} disabled={image <= 0} style={stepButtonStyle}>
          ← previous image
        </button>
        <button onClick={() => setImage(image + 1)} disabled={image >= data.imageCount - 1} style={stepButtonStyle}>
          next image →
        </button>
        <span style={{ fontSize: 11.5, color: MUTED }}>
          {data.reactionCoordinate.definition}. Click either plot to select an image.
        </span>
      </div>

      {/* energy profiles */}
      <section style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 13.5 }}>Energy along the reaction path</h3>
        <EnergyPlot data={data} currentImage={image} onSelectImage={setImage} />
        <AnchorStrip data={data} currentImage={image} />
      </section>

      {/* T1 wander */}
      <section style={{ marginTop: 22 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 13.5 }}>T1 convention wander (same-path GPAW − VASP offset)</h3>
        <T1Panel data={data} currentImage={image} onSelectImage={setImage} />
      </section>

      <GuidanceSection data={data} />

      {/* provenance + contract footer */}
      <footer style={{ marginTop: 20, borderTop: `1px solid ${GRID}`, paddingTop: 10, fontSize: 11.5, color: MUTED }}>
        <p style={{ margin: '0 0 4px' }}>
          Source vs derived: raw values come from the campaign record, anchor receipts, barrier lock, and model cell
          results (digests in fixture provenance). Derived on top: T1 offsets are recomputed per-image differences
          (E_GPAW − E_VASP); displayed profile energies are source values shifted so each series' own path minimum is
          zero (absolute values remain in tooltips and the readout); barriers, extrema, anchor sets, wander, and driver
          pairs are recomputed and cross-checked against the campaign record. No inferred series are drawn; missing
          values stay missing. Geometry, bonds, and coordination are out of scope for this panel prototype; when bound,
          bonds must be labeled source topology vs viewer inference.
        </p>
        <p style={{ margin: '0 0 4px' }}>
          Canonical revision: {data.revision.manifestSha256} · run {data.revision.runId} · status {data.revision.status}
          {' '}· quality {data.revision.qualityState}. Quality checks passed:{' '}
          {data.revision.qualityChecks.filter((check) => check.status === 'pass').length}/{data.revision.qualityChecks.length}.
        </p>
        {data.revision.qualityWarnings.map((warning) => (
          <p key={warning} style={{ margin: '0 0 4px' }}>Bundle warning: {warning}</p>
        ))}
        <p style={{ margin: 0 }}>
          This panel describes a reaction-path sequence (climbing-image NEB). Image index orders configurations along
          the path; it is never elapsed time, temperature, or dynamics.
        </p>
      </footer>
    </article>
  );
}

const stepButtonStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 4,
  border: `1px solid ${INDIGO}`,
  background: PAPER,
  color: INDIGO,
  cursor: 'pointer',
};
