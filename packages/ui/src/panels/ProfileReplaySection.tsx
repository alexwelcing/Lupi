/**
 * ProfileReplaySection — replay LAMMPS `fix ave/chunk` spatial profiles in
 * sync with trajectory playback.
 *
 * Real research runs (thermal conductivity, viscosity) produce profile
 * time series: temperature/density/velocity per spatial bin, one block per
 * timestep. This section renders the active snapshot as a line chart with
 * the all-time envelope behind it, advancing with the viewer's frame.
 *
 * Snapshot selection: when the trajectory's timestep range overlaps the
 * profile's, the nearest snapshot by timestep is shown (same-run outputs
 * line up exactly); otherwise playback fraction maps proportionally, so a
 * profile from a longer production run still replays alongside a short
 * showcase trajectory.
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import type { ChunkProfileData } from '@atlas/parsers';

interface ProfileReplaySectionProps {
  profiles: ChunkProfileData[];
  /** Timestep of the frame being viewed (drives same-run sync). */
  currentTimestep: number | undefined;
  currentFrameIndex: number;
  totalFrames: number;
}

function nearestSnapshotIndex(
  profile: ChunkProfileData,
  currentTimestep: number | undefined,
  currentFrameIndex: number,
  totalFrames: number,
): number {
  const snaps = profile.snapshots;
  if (snaps.length <= 1) return 0;
  const t0 = snaps[0].timestep;
  const t1 = snaps[snaps.length - 1].timestep;
  if (
    currentTimestep !== undefined &&
    Number.isFinite(currentTimestep) &&
    currentTimestep >= t0 &&
    currentTimestep <= t1
  ) {
    // Binary search for the nearest timestep.
    let lo = 0;
    let hi = snaps.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (snaps[mid].timestep <= currentTimestep) lo = mid;
      else hi = mid;
    }
    return currentTimestep - snaps[lo].timestep <= snaps[hi].timestep - currentTimestep ? lo : hi;
  }
  // Proportional fallback for cross-run replay.
  const f = totalFrames > 1 ? currentFrameIndex / (totalFrames - 1) : 0;
  return Math.max(0, Math.min(snaps.length - 1, Math.round(f * (snaps.length - 1))));
}

export function ProfileReplaySection({
  profiles,
  currentTimestep,
  currentFrameIndex,
  totalFrames,
}: ProfileReplaySectionProps) {
  const [profileIdx, setProfileIdx] = useState(0);
  const [valueIdx, setValueIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const profile = profiles[Math.min(profileIdx, profiles.length - 1)];
  const valueCol = Math.min(valueIdx, (profile?.valueColumns.length ?? 1) - 1);

  const snapIdx = useMemo(
    () => (profile ? nearestSnapshotIndex(profile, currentTimestep, currentFrameIndex, totalFrames) : 0),
    [profile, currentTimestep, currentFrameIndex, totalFrames],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !profile) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || 260;
    const height = 96;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padL = 6, padR = 6, padT = 6, padB = 6;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const { min, max } = profile.valueRanges[valueCol] ?? { min: 0, max: 1 };
    const range = max - min || 1;
    const snap = profile.snapshots[snapIdx];
    if (!snap) return;
    const coords = snap.coords[0] ?? null;
    const n = snap.nchunks;
    const xAt = (r: number) => {
      if (coords && n > 1) {
        // Normalize by the coord span so reduced (0..1) and absolute (Å) both work.
        const c0 = coords[0];
        const c1 = coords[n - 1];
        const span = c1 - c0 || 1;
        return padL + ((coords[r] - c0) / span) * chartW;
      }
      return padL + (n > 1 ? (r / (n - 1)) * chartW : chartW / 2);
    };
    const yAt = (v: number) => padT + chartH - ((v - min) / range) * chartH;

    // All-time envelope: every snapshot as a faint line — the "history" the
    // current profile moves within.
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
    ctx.lineWidth = 1;
    const stride = Math.max(1, Math.floor(profile.snapshots.length / 40));
    for (let s = 0; s < profile.snapshots.length; s += stride) {
      if (s === snapIdx) continue;
      const past = profile.snapshots[s];
      if (past.nchunks !== n) continue;
      ctx.beginPath();
      for (let r = 0; r < n; r++) {
        const x = xAt(r);
        const y = yAt(past.values[valueCol][r]);
        r === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Current snapshot — bold accent line with soft glow.
    ctx.strokeStyle = '#1edce0';
    ctx.lineWidth = 1.8;
    ctx.shadowColor = 'rgba(30, 220, 224, 0.55)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let r = 0; r < n; r++) {
      const x = xAt(r);
      const y = yAt(snap.values[valueCol][r]);
      r === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [profile, valueCol, snapIdx]);

  if (!profile || profile.snapshots.length === 0) return null;
  const snap = profile.snapshots[snapIdx];
  const { min, max } = profile.valueRanges[valueCol] ?? { min: 0, max: 1 };

  return (
    <div
      data-testid="profile-replay"
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
      }}
    >
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
        color: 'var(--text-dim)', textTransform: 'uppercase',
        marginBottom: 6, display: 'flex', justifyContent: 'space-between',
      }}>
        <span>SPATIAL PROFILE REPLAY</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
          t = {snap.timestep.toLocaleString()}
        </span>
      </div>

      {(profiles.length > 1 || profile.valueColumns.length > 1) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {profiles.length > 1 && profiles.map((p, i) => (
            <button
              key={`p${i}`}
              onClick={() => { setProfileIdx(i); setValueIdx(0); }}
              style={{
                padding: '3px 8px', fontSize: 10, fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                background: i === profileIdx ? 'var(--accent)' : 'var(--bg-surface)',
                color: i === profileIdx ? '#000' : 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              {p.fixName ?? `profile ${i + 1}`}
            </button>
          ))}
          {profile.valueColumns.length > 1 && profile.valueColumns.map((col, i) => (
            <button
              key={`v${col}`}
              onClick={() => setValueIdx(i)}
              style={{
                padding: '3px 8px', fontSize: 10, fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                background: i === valueCol ? 'var(--lupine-400, #7c3aed)' : 'var(--bg-surface)',
                color: i === valueCol ? '#000' : 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              {col}
            </button>
          ))}
        </div>
      )}

      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm, 4px)',
        padding: 6,
      }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: 96, display: 'block' }} />
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 4,
        fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
      }}>
        <span>{profile.valueColumns[valueCol]} ∈ [{min.toPrecision(4)}, {max.toPrecision(4)}]</span>
        <span>
          {snap.nchunks} bins · snapshot {snapIdx + 1}/{profile.snapshots.length}
        </span>
      </div>
    </div>
  );
}
