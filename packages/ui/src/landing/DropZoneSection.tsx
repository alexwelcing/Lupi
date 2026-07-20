import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export function DropZoneSection() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const loading = useStore((state) => state.loading);
  const loadProgress = useStore((state) => state.loadProgress);
  const error = useStore((state) => state.error);
  const setFile = useStore((state) => state.setFile);
  const setLoading = useStore((state) => state.setLoading);
  const setError = useStore((state) => state.setError);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { total, parsed } = e.detail;
      if (total > 0) setLoading(true, parsed / total);
    };
    window.addEventListener('atlas:parse-progress', handler as EventListener);
    return () => window.removeEventListener('atlas:parse-progress', handler as EventListener);
  }, [setLoading]);

  const handleFiles = useCallback(async (files: FileList) => {
    // Snapshot the live FileList before the input is reset. Some browsers keep
    // FileList tied to the input, so reading it after the first await can lose
    // the selected files entirely.
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;
    const { detectFileType, parseFile, readDumpHead, analyzeDumpHead } = await import('@atlas/parsers');
    const sorted = selectedFiles.sort((a, b) => {
      const ta = detectFileType(a.name);
      const tb = detectFileType(b.name);
      if (ta === 'dump' && tb !== 'dump') return -1;
      if (ta !== 'dump' && tb === 'dump') return 1;
      return 0;
    });
    setLoading(true, 0);
    setError(null);
    try {
      // Large streamable dumps take the worker transcode path: progressive
      // frame-0 paint, off-main-thread .glimbin transcode, frames read on
      // demand — the reliable-replay path for real research trajectories.
      // Small or non-streamable files stay on the simple in-memory path.
      let streamedDump: File | null = null;
      const dumpFile = sorted.find((f) => detectFileType(f.name) === 'dump');
      if (dumpFile && dumpFile.size > 4 * 1024 * 1024) {
        try {
          const head = await readDumpHead(dumpFile);
          if (analyzeDumpHead(head).tier === 'streamable') {
            const { importDumpFileStreaming } = await import('../loadMoleculeSource');
            const res = await importDumpFileStreaming(dumpFile);
            if (res.handled) streamedDump = dumpFile;
          }
        } catch {
          // Pre-flight failed — the plain parse path below still applies.
        }
      }

      let trajectory = null;
      let thermo = null;
      const profiles: import('@atlas/parsers').ChunkProfileData[] = [];
      for (const f of sorted) {
        if (f === streamedDump) continue;
        const result = await parseFile(f);
        if (result.trajectory) trajectory = result.trajectory;
        if (result.thermo) thermo = result.thermo;
        if (result.profiles) profiles.push(...result.profiles);
      }

      const sidecarsOnly = !trajectory && (thermo || profiles.length > 0);
      if (streamedDump) {
        // Structure mounted by the streaming path; attach any output tables
        // without re-running scene setup.
        if (thermo || profiles.length > 0) {
          useStore.getState().attachFileSidecars({ thermo, profiles });
        }
      } else if (trajectory) {
        setFile({
          name: sorted[0].name,
          size: sorted.reduce((s, f) => s + f.size, 0),
          trajectory,
          thermo,
          profiles: profiles.length > 0 ? profiles : undefined,
        });
      } else if (sidecarsOnly && useStore.getState().file) {
        // Output tables dropped onto an already-loaded structure.
        useStore.getState().attachFileSidecars({ thermo, profiles });
        setLoading(false);
      } else if (sidecarsOnly) {
        throw new Error(
          'These are LAMMPS output tables (thermo log / ave-chunk profile). ' +
          'Drop them together with the structure they belong to — a .data, ' +
          '.lammpstrj, or .xyz file.',
        );
      } else {
        throw new Error('No valid trajectory data found in the uploaded files.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to parse file');
    }
  }, [setFile, setLoading, setError]);

  if (loading) {
    return (
      <section id="dropzone" style={{ padding: '100px 24px', textAlign: 'center' }}>
        <svg width="80" height="80" style={{ marginBottom: 20 }}>
          <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
          <circle
            cx="40" cy="40" r="34"
            fill="none" stroke="#d8b878" strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${Math.PI * 68}`}
            strokeDashoffset={`${Math.PI * 68 * (1 - loadProgress)}`}
            transform="rotate(-90 40 40)"
            style={{ transition: 'stroke-dashoffset 200ms ease-out', filter: 'drop-shadow(0 0 8px rgba(216,184,120,0.45))' }}
          />
        </svg>
        <div style={{ fontSize: 18, fontWeight: 500, color: '#f8fafc', marginBottom: 8 }}>Parsing...</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono, monospace)' }}>
          {Math.round(loadProgress * 100)}%
        </div>
      </section>
    );
  }

  return (
    <section
      id="dropzone"
      ref={sectionRef}
      style={{
        // The Melancholia "Part Two" heading sits directly above; this section
        // is only the drop target, so it opens with negative top padding to
        // close the gap and carries the twilight palette rather than the old
        // slate blue.
        padding: '8px 24px 96px',
        background: 'linear-gradient(180deg, #05060b 0%, #070a12 100%)',
      }}
    >
      <div style={{
        maxWidth: 720,
        margin: '0 auto',
        textAlign: 'center',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(30px)',
        transition: 'all 0.8s ease-out',
      }}>
        <input
          ref={inputRef}
          type="file"
          accept=".lammpstrj,.dump,.gz,.log,.data,.lmp,.xyz,.txt,.profile,text/plain"
          multiple
          onChange={(event) => {
            if (event.currentTarget.files) void handleFiles(event.currentTarget.files);
            // Let a researcher retry the same file after a parse error.
            event.currentTarget.value = '';
          }}
          style={{ display: 'none' }}
        />

        <button
          type="button"
          aria-label={error ? 'Choose another molecular data file' : 'Choose molecular data files'}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          style={{
            position: 'relative',
            width: '100%',
            padding: 'clamp(36px, 7vw, 72px) clamp(20px, 5vw, 48px)',
            borderRadius: 28,
            border: `1.5px dashed ${error ? 'rgba(239,68,68,0.5)' : dragOver ? '#d8b878' : 'rgba(200,214,236,0.14)'}`,
            background: error ? 'rgba(239,68,68,0.035)' : dragOver ? 'rgba(216,184,120,0.06)' : 'rgba(255,255,255,0.015)',
            cursor: 'pointer',
            transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
            animation: dragOver ? 'pulseGlow 2s ease-in-out infinite' : 'none',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          {/* Animated SVG border on drag */}
          {dragOver && (
            <svg style={{ position: 'absolute', inset: -2, width: 'calc(100% + 4px)', height: 'calc(100% + 4px)', pointerEvents: 'none' }}>
              <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="28" fill="none" stroke="#d8b878" strokeWidth="1.5" strokeDasharray="8 4" style={{ animation: 'borderDash 1s linear infinite' }} />
            </svg>
          )}

          <span style={{
            width: 72, height: 72,
            borderRadius: 24,
            background: error ? 'rgba(239,68,68,0.1)' : dragOver ? 'linear-gradient(135deg, #d8b878, #b98cae)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${error ? 'rgba(239,68,68,0.24)' : dragOver ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
            transition: 'all 0.4s ease',
            transform: dragOver ? 'scale(1.1)' : 'scale(1)',
          }}>
            {error ? (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
          </span>

          <span style={{ display: 'block', fontSize: 20, fontWeight: 600, color: '#f8fafc', marginBottom: 8 }}>
            {error ? 'That file could not be opened' : dragOver ? 'Drop it here' : 'Open your research data'}
          </span>
          <span role={error ? 'alert' : undefined} style={{ display: 'block', fontSize: 14, color: error ? 'rgba(248,113,113,0.9)' : 'rgba(255,255,255,0.48)', marginBottom: 24, lineHeight: 1.5 }}>
            {error || 'Drag files here or choose from your device — LAMMPS, XYZ, trajectories, logs, and profiles.'}
            {error && <span style={{ display: 'block', color: 'rgba(255,255,255,0.56)', marginTop: 7 }}>Choose or drop another file to try again.</span>}
          </span>

          <span style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['LAMMPS', 'Data', 'XYZ', 'GZip', 'Log', 'Profiles'].map((tag) => (
              <span key={tag} style={{
                fontSize: 11,
                padding: '4px 12px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.35)',
                fontWeight: 500,
              }}>
                {tag}
              </span>
            ))}
          </span>
        </button>
      </div>
    </section>
  );
}
