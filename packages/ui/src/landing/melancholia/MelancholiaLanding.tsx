/**
 * MelancholiaLanding — the home page as a place, not a tool.
 *
 * Register borrowed from von Trier's *Melancholia*: a rogue body of matter in
 * slow gravitational approach, molecules as small luminous bodies adrift in a
 * twilight of steel-blue and candle-gold. Serene, slow, a little uncanny —
 * cosmic scale shrinking the human concern. The billion-atom mass IS the
 * approaching planet; the curated structures are lesser bodies you can still
 * hold while there is time.
 *
 * No WebGL on first paint: the planet is Canvas 2D (see MatterPlanet), the
 * bodies are treated snapshots masked into spheres. Live 3D only begins when a
 * body is entered. Motion is glacial and freezes under prefers-reduced-motion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_EXAMPLES, publicAssetUrl, type GalleryExample } from '../shared';
import { openMolecule } from '../../viewer/openMolecule';
import { MatterPlanet } from './MatterPlanet';
import { MatterField } from './MatterField';

// The bodies drawn into the Collection — chosen for range and for the new
// research/scale work, weighted toward ids that carry a rendered snapshot.
const COLLECTION_IDS = [
  'hfc_r32_research',
  'this_is_water',
  'cuzr_melt',
  'hfc_r125_research',
  'c60_buckyball',
  'brilliant_diamond_macro',
  'massive_1m',
  'diamond_crystal',
  'cnt_6_6',
  'aspirin',
  'lupine_sphere_grid',
  'graphene_ribbon',
];

const FIELD_ORDER = [
  'Metals & Alloys',
  'Fluids & Solvents',
  'Biomolecules',
  'Nanomaterials',
  'Energy Materials',
  'Ceramics & Oxides',
  'Defects & Mechanics',
  'Advanced Theory & Validation',
  'Polymers & Soft Matter',
  'Atomized Media',
  'Methods',
];

const FIELD_TONE: Record<string, string> = {
  'Metals & Alloys': '#c8a06a',
  'Fluids & Solvents': '#6d9bc3',
  'Biomolecules': '#b98cae',
  'Nanomaterials': '#8fb3c9',
  'Energy Materials': '#8fbf9a',
  'Ceramics & Oxides': '#9cc2b0',
  'Defects & Mechanics': '#c9a878',
  'Advanced Theory & Validation': '#a99bc9',
  'Polymers & Soft Matter': '#cbb884',
  'Atomized Media': '#aeb9c8',
  'Methods': '#b7bccb',
};

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown] as const;
}

const nf = (n: number) => n.toLocaleString('en-US');
const catalogNo = (i: number) => `LUPI–${String(i + 1).padStart(3, '0')}`;

export function MelancholiaLanding() {
  const collection = useMemo(
    () => COLLECTION_IDS
      .map((id) => ALL_EXAMPLES.find((e) => e.id === id))
      .filter(Boolean) as GalleryExample[],
    [],
  );

  const fields = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ex of ALL_EXAMPLES) counts.set(ex.domain, (counts.get(ex.domain) ?? 0) + 1);
    return FIELD_ORDER
      .filter((d) => counts.has(d))
      .map((domain) => ({ domain, count: counts.get(domain) ?? 0 }));
  }, []);

  const totalBodies = ALL_EXAMPLES.length;
  const fieldCount = fields.length;

  const approachBillion = useCallback(() => {
    window.location.assign('/?billion-atoms');
  }, []);
  const openBody = useCallback((ex: GalleryExample) => {
    if (ex.route) { window.location.assign(ex.route); return; }
    void openMolecule({ kind: 'gallery', id: ex.id, history: 'push' });
  }, []);
  const toCollection = useCallback(() => {
    document.getElementById('mel-part-one')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const toIndex = useCallback(() => {
    document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const toMatter = useCallback(() => {
    document.getElementById('dropzone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="mel">
      <style>{MEL_CSS}</style>
      <div className="mel-sky" aria-hidden="true" />
      <div className="mel-stars" aria-hidden="true" />

      {/* ── Overture ── */}
      <Overture
        onApproach={approachBillion}
        onCollection={toCollection}
        onMatter={toMatter}
      />

      {/* ── Part One — The Collection ── */}
      <Collection bodies={collection} onOpen={openBody} />

      {/* ── The field index ── */}
      <FieldIndex fields={fields} total={totalBodies} fieldCount={fieldCount} onBrowse={toIndex} />
    </div>
  );
}

// ─── Overture ─────────────────────────────────────────────────────────
function Overture({
  onApproach, onCollection, onMatter,
}: { onApproach: () => void; onCollection: () => void; onMatter: () => void }) {
  const [ref, shown] = useReveal<HTMLDivElement>();
  // Faint vertical drift on the planet — the approach.
  const [drift, setDrift] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0; let t0 = 0;
    const loop = (t: number) => {
      if (!t0) t0 = t;
      setDrift(Math.sin((t - t0) / 9000) * 14);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="mel-overture" aria-label="Lupi — an archive of matter">
      <MatterField className="mel-field" />
      <div
        className="mel-planet-frame"
        style={{ transform: `translateY(${drift}px)` }}
        aria-hidden="true"
      >
        <div className="mel-loop" />
        <MatterPlanet size={640} points={7400} secondsPerTurn={260} />
      </div>

      <div ref={ref} className={`mel-overture-copy${shown ? ' is-shown' : ''}`}>
        <div className="mel-eyebrow">Lupi &mdash; an archive of matter</div>
        <h1 className="mel-title">
          Look closely<br />at the matter.
        </h1>
        <p className="mel-lede">
          Every structure here is a small body of matter &mdash; a molecule you
          could hold, a crystal, a fluid caught mid-motion. Open one from the
          archive, or drop your own, and turn it in real time: its bonds, its
          forces, its energy, its motion.
        </p>
        <div className="mel-actions">
          <button type="button" className="mel-btn mel-btn--primary" onClick={onCollection}>
            Enter the collection <span aria-hidden="true">&rarr;</span>
          </button>
          <button type="button" className="mel-btn" onClick={onMatter}>
            Bring your own matter
          </button>
        </div>
        <button type="button" className="mel-quiet" onClick={onApproach}>
          &mdash; or approach the largest body in the field &rarr;
        </button>

        <dl className="mel-readout" aria-label="The instrument">
          <div><dt>archive</dt><dd>100 bodies &middot; 11 fields of matter</dd></div>
          <div><dt>formats</dt><dd>LAMMPS &middot; XYZ &middot; trajectories &middot; profiles</dd></div>
          <div><dt>opens in</dt><dd>a live instrument, in the browser</dd></div>
        </dl>
      </div>

      <div className="mel-scrollcue" aria-hidden="true">
        <span>the collection</span>
        <div className="mel-scrollcue-line" />
      </div>
    </section>
  );
}

// ─── Part One — The Collection ────────────────────────────────────────
function Collection({ bodies, onOpen }: { bodies: GalleryExample[]; onOpen: (ex: GalleryExample) => void }) {
  const [ref, shown] = useReveal<HTMLDivElement>();
  return (
    <section className="mel-part" aria-labelledby="mel-part-one">
      <div ref={ref} className={`mel-part-head${shown ? ' is-shown' : ''}`}>
        <span className="mel-part-mark">Part One</span>
        <h2 id="mel-part-one" className="mel-part-title">The Collection</h2>
        <p className="mel-part-sub">
          {bodies.length} bodies drawn from the archive. Each opens into the same
          instrument &mdash; turn it, cut through it, colour it by force or energy.
        </p>
      </div>

      <div className={`mel-bodies${shown ? ' is-shown' : ''}`}>
        {bodies.map((ex, i) => (
          <CollectionBody key={ex.id} ex={ex} index={i} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function CollectionBody({ ex, index, onOpen }: { ex: GalleryExample; index: number; onOpen: (ex: GalleryExample) => void }) {
  const [hovered, setHovered] = useState(false);
  const [imgOk, setImgOk] = useState(false);
  const tone = FIELD_TONE[ex.domain] ?? '#9fb0c8';
  const frames = Number(String(ex.frames ?? '').replace(/[^0-9]/g, '')) || 1;
  const isTrajectory = Boolean(ex.isTrajectory) || frames > 1;

  return (
    <button
      type="button"
      className="mel-body"
      style={{ ['--tone' as any]: tone, animationDelay: `${index * 90}ms` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(ex)}
    >
      <span className="mel-body-cat">{catalogNo(index)}</span>
      <span className="mel-moon">
        <span className="mel-moon-shadow" />
        <img
          src={publicAssetUrl(`gallery/snapshots/${ex.id}.jpg`)}
          alt=""
          loading="lazy"
          onLoad={() => setImgOk(true)}
          className="mel-moon-img"
          style={{ opacity: imgOk ? 1 : 0 }}
        />
        <span className="mel-moon-limb" />
        <span className={`mel-loop-measure${hovered ? ' is-on' : ''}`} />
      </span>

      <span className="mel-body-meta">
        <span className="mel-body-field">{ex.domain}</span>
        <h3 className="mel-body-title">{ex.title}</h3>
        <span className="mel-body-data">
          {ex.atoms} atoms{isTrajectory ? ` · ${frames} frames` : ''}
        </span>
      </span>

      <span className="mel-body-enter" aria-hidden="true">{hovered ? 'approach →' : ''}</span>
    </button>
  );
}

// ─── The field index ──────────────────────────────────────────────────
function FieldIndex({
  fields, total, fieldCount, onBrowse,
}: { fields: { domain: string; count: number }[]; total: number; fieldCount: number; onBrowse: () => void }) {
  const [ref, shown] = useReveal<HTMLDivElement>();
  return (
    <section className="mel-index" aria-labelledby="mel-index-title">
      <div ref={ref} className={`mel-index-inner${shown ? ' is-shown' : ''}`}>
        <div className="mel-index-head">
          <span className="mel-part-mark">The complete index</span>
          <h2 id="mel-index-title" className="mel-part-title">
            {nf(total)} bodies, across {fieldCount} fields.
          </h2>
          <p className="mel-part-sub">
            The whole archive lies below &mdash; search every source, or narrow to
            a single field of matter.
          </p>
        </div>

        <ul className="mel-fields">
          {fields.map(({ domain, count }) => (
            <li key={domain}>
              <button type="button" className="mel-field" style={{ ['--tone' as any]: FIELD_TONE[domain] ?? '#9fb0c8' }} onClick={onBrowse}>
                <span className="mel-field-mark" aria-hidden="true" />
                <span className="mel-field-name">{domain}</span>
                <span className="mel-field-count">{count}</span>
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="mel-btn mel-index-cta" onClick={onBrowse}>
          Open the full index <span aria-hidden="true">&darr;</span>
        </button>
      </div>
    </section>
  );
}

// ─── Styling ──────────────────────────────────────────────────────────
const MEL_CSS = `
.mel {
  --ink: #cdd6e4;
  --ink-dim: #8794a8;
  --ink-faint: #5b6678;
  --gold: #d8b878;
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Times New Roman', serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  position: relative;
  width: 100%;
  color: var(--ink);
  background: #05060b;
  overflow: clip;
}
.mel-sky {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(120% 80% at 72% 88%, rgba(120,146,186,0.14), transparent 55%),
    linear-gradient(180deg,
      #04050a 0%, #070a12 24%, #0c121e 46%, #131c2c 66%, #1d283c 82%, #2b3a54 100%);
}
.mel-stars {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: 0.5;
  background-image:
    radial-gradient(1px 1px at 12% 22%, rgba(220,230,245,0.7), transparent),
    radial-gradient(1px 1px at 28% 12%, rgba(220,230,245,0.5), transparent),
    radial-gradient(1px 1px at 47% 30%, rgba(220,230,245,0.6), transparent),
    radial-gradient(1px 1px at 63% 8%, rgba(220,230,245,0.4), transparent),
    radial-gradient(1px 1px at 82% 26%, rgba(220,230,245,0.55), transparent),
    radial-gradient(1px 1px at 91% 14%, rgba(220,230,245,0.4), transparent),
    radial-gradient(1px 1px at 8% 44%, rgba(220,230,245,0.35), transparent),
    radial-gradient(1px 1px at 38% 52%, rgba(220,230,245,0.3), transparent);
}

/* Overture */
.mel-overture {
  position: relative; z-index: 1;
  min-height: 100vh; min-height: 100svh;
  display: grid; align-items: center;
  padding: clamp(28px, 6vw, 96px);
  box-sizing: border-box;
}
.mel-field {
  position: absolute; inset: 0; z-index: 0;
  width: 100%; height: 100%;
  pointer-events: none;
}
.mel-planet-frame {
  position: absolute;
  z-index: 1;
  right: clamp(-220px, -6vw, -40px);
  bottom: clamp(-180px, -8vw, -60px);
  width: 640px; height: 640px;
  display: grid; place-items: center;
  pointer-events: none;
  will-change: transform;
}
.mel-loop {
  position: absolute; width: 720px; height: 720px; border-radius: 50%;
  border: 1px solid rgba(216,184,120,0.14);
  box-shadow: inset 0 0 60px rgba(120,146,186,0.06);
}
.mel-overture-copy {
  position: relative; z-index: 2;
  max-width: 620px;
  opacity: 0; transform: translateY(26px);
  transition: opacity 1.4s cubic-bezier(0.2,0.7,0.2,1), transform 1.4s cubic-bezier(0.2,0.7,0.2,1);
}
.mel-overture-copy.is-shown { opacity: 1; transform: none; }
.mel-eyebrow {
  font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.34em;
  text-transform: uppercase; color: var(--gold); opacity: 0.82; margin-bottom: 26px;
}
.mel-title {
  font-family: var(--serif); font-weight: 400;
  font-size: clamp(38px, 6vw, 82px); line-height: 1.02;
  letter-spacing: -0.01em; margin: 0 0 26px; color: #eef2f8;
  text-wrap: balance;
  text-shadow: 0 2px 34px rgba(4, 6, 11, 0.8), 0 0 2px rgba(4, 6, 11, 0.5);
}
.mel-lede {
  font-size: clamp(15px, 1.5vw, 18px); line-height: 1.72; max-width: 46ch;
  color: var(--ink-dim); margin: 0 0 34px; font-weight: 380;
  text-shadow: 0 1px 16px rgba(4, 6, 11, 0.92);
}
.mel-eyebrow, .mel-readout dt, .mel-readout dd { text-shadow: 0 1px 12px rgba(4, 6, 11, 0.85); }
.mel-actions { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 18px; }
.mel-btn {
  appearance: none; cursor: pointer;
  font-family: var(--mono); font-size: 13px; letter-spacing: 0.04em;
  padding: 13px 22px; border-radius: 2px;
  color: var(--ink); background: rgba(200,214,236,0.03);
  border: 1px solid rgba(200,214,236,0.16);
  transition: border-color 0.5s ease, background 0.5s ease, color 0.5s ease;
}
.mel-btn:hover { border-color: rgba(216,184,120,0.5); color: #f2ead8; background: rgba(216,184,120,0.06); }
.mel-btn--primary {
  color: #10131b; background: var(--gold);
  border-color: var(--gold); font-weight: 600;
}
.mel-btn--primary:hover { background: #e6c98c; color: #0c0f16; }
.mel-quiet {
  appearance: none; background: none; border: none; cursor: pointer;
  font-family: var(--serif); font-style: italic; font-size: 15px;
  color: var(--ink-faint); padding: 6px 0; transition: color 0.5s ease;
}
.mel-quiet:hover { color: var(--ink-dim); }
.mel-readout {
  margin: 40px 0 0; display: grid; gap: 9px; max-width: 40ch;
  border-top: 1px solid rgba(200,214,236,0.1); padding-top: 22px;
}
.mel-readout div { display: grid; grid-template-columns: 92px 1fr; gap: 14px; align-items: baseline; }
.mel-readout dt {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.22em;
  text-transform: uppercase; color: var(--ink-faint);
}
.mel-readout dd { margin: 0; font-family: var(--mono); font-size: 12.5px; color: var(--ink-dim); }
.mel-scrollcue {
  position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%);
  display: grid; justify-items: center; gap: 10px; z-index: 2;
}
.mel-scrollcue span {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.28em;
  text-transform: uppercase; color: var(--ink-faint);
}
.mel-scrollcue-line { width: 1px; height: 44px; background: linear-gradient(180deg, rgba(216,184,120,0.5), transparent); animation: melFall 3.4s ease-in-out infinite; }
@keyframes melFall { 0%,100% { opacity: 0.3; transform: scaleY(0.7); transform-origin: top; } 50% { opacity: 1; transform: scaleY(1); } }

/* Part scaffolding */
.mel-part, .mel-index { position: relative; z-index: 1; padding: clamp(64px, 10vw, 150px) clamp(24px, 6vw, 96px); }
.mel-part-head, .mel-index-head { max-width: 720px; margin: 0 auto clamp(40px, 6vw, 72px); text-align: center; }
.mel-part-head { opacity: 0; transform: translateY(22px); transition: opacity 1.2s ease, transform 1.2s ease; }
.mel-part-head.is-shown { opacity: 1; transform: none; }
.mel-part-mark {
  font-family: var(--mono); font-size: 11px; letter-spacing: 0.34em;
  text-transform: uppercase; color: var(--gold); opacity: 0.78;
}
.mel-part-title {
  font-family: var(--serif); font-weight: 400;
  font-size: clamp(30px, 4.4vw, 54px); line-height: 1.06; letter-spacing: -0.01em;
  color: #eef2f8; margin: 16px 0 18px; text-wrap: balance;
}
.mel-part-sub { font-size: 16px; line-height: 1.7; color: var(--ink-dim); margin: 0 auto; max-width: 54ch; font-weight: 380; }

/* Collection bodies */
.mel-bodies {
  max-width: 1240px; margin: 0 auto;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: clamp(26px, 3vw, 48px) clamp(20px, 2.4vw, 36px);
}
.mel-body {
  appearance: none; background: none; border: none; cursor: pointer;
  display: grid; justify-items: center; gap: 4px; padding: 8px;
  opacity: 0; transform: translateY(24px);
  color: inherit; text-align: center;
}
.mel-bodies.is-shown .mel-body { animation: melRise 1.2s cubic-bezier(0.2,0.7,0.2,1) forwards; }
@keyframes melRise { to { opacity: 1; transform: none; } }
.mel-body-cat {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.24em;
  color: var(--ink-faint); margin-bottom: 8px;
}
.mel-moon {
  position: relative; width: clamp(150px, 15vw, 188px); aspect-ratio: 1;
  border-radius: 50%; overflow: hidden;
  background: radial-gradient(circle at 34% 30%, #1a2536, #070b13 78%);
  box-shadow: 0 20px 50px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(200,214,236,0.05);
  transition: transform 0.9s cubic-bezier(0.2,0.7,0.2,1), box-shadow 0.9s ease;
}
.mel-body:hover .mel-moon { transform: translateY(-6px) scale(1.02); box-shadow: 0 28px 66px rgba(0,0,0,0.6), 0 0 0 1px color-mix(in srgb, var(--tone) 40%, transparent); }
.mel-moon-img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  filter: saturate(0.62) brightness(0.86) contrast(1.05);
  transition: opacity 0.7s ease, transform 0.9s cubic-bezier(0.2,0.7,0.2,1);
  transform: scale(1.02);
}
.mel-body:hover .mel-moon-img { transform: scale(1.08); }
.mel-moon-shadow {
  position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background: radial-gradient(circle at 66% 72%, transparent 40%, rgba(4,6,11,0.72) 82%);
}
.mel-moon-limb {
  position: absolute; inset: 0; z-index: 3; pointer-events: none; border-radius: 50%;
  box-shadow: inset 8px 7px 22px -8px rgba(232,201,138,0.5), inset -6px -8px 30px -6px rgba(4,6,11,0.9);
}
.mel-loop-measure {
  position: absolute; inset: -14px; z-index: 4; border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--tone) 60%, transparent);
  opacity: 0; transform: scale(0.9); transition: opacity 0.6s ease, transform 0.9s cubic-bezier(0.2,0.7,0.2,1);
}
.mel-loop-measure.is-on { opacity: 0.7; transform: scale(1); }
.mel-body-meta { display: grid; gap: 4px; margin-top: 16px; }
.mel-body-field {
  font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase;
  color: color-mix(in srgb, var(--tone) 78%, #ffffff 10%);
}
.mel-body-title {
  font-family: var(--serif); font-weight: 400; font-size: 18px; line-height: 1.2;
  color: #eaf0f8; margin: 2px 0;
}
.mel-body-data { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }
.mel-body-enter {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.16em; color: var(--gold);
  min-height: 15px; margin-top: 4px;
}

/* Field index */
.mel-index-inner { max-width: 900px; margin: 0 auto; opacity: 0; transform: translateY(22px); transition: opacity 1.2s ease, transform 1.2s ease; }
.mel-index-inner.is-shown { opacity: 1; transform: none; }
.mel-fields {
  list-style: none; margin: 0 auto clamp(30px, 4vw, 48px); padding: 0; max-width: 640px;
  border-top: 1px solid rgba(200,214,236,0.09);
}
.mel-field {
  width: 100%; appearance: none; background: none; cursor: pointer;
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 16px;
  padding: 15px 6px; border: none; border-bottom: 1px solid rgba(200,214,236,0.09);
  color: var(--ink); text-align: left; transition: padding 0.5s ease, color 0.5s ease;
}
.mel-field:hover { padding-left: 16px; color: #f2f5fa; }
.mel-field-mark { width: 8px; height: 8px; border-radius: 50%; background: var(--tone); opacity: 0.85; box-shadow: 0 0 12px var(--tone); }
.mel-field-name { font-family: var(--serif); font-size: clamp(17px, 2vw, 22px); }
.mel-field-count { font-family: var(--mono); font-size: 12px; color: var(--ink-faint); }
.mel-index-cta { display: block; margin: 0 auto; }

/* Part Two intro sits tighter above the drop zone */
.mel-part--tight { padding-bottom: clamp(28px, 4vw, 48px); }

/* Colophon */
.mel-colophon {
  position: relative; z-index: 1;
  padding: clamp(70px, 9vw, 130px) clamp(24px, 6vw, 96px) clamp(40px, 5vw, 70px);
  text-align: center;
  background: linear-gradient(180deg, #04050a, #070a12);
}
.mel-colophon-line {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  font-size: clamp(20px, 3vw, 32px); color: #d6dce8; margin: 0 auto 18px; max-width: 24ch;
  letter-spacing: 0.01em;
}
.mel-colophon-sub {
  font-size: 14.5px; line-height: 1.75; color: var(--ink-dim);
  max-width: 56ch; margin: 0 auto; font-weight: 380;
}

@media (max-width: 760px) {
  /* Planet rises from the bottom-right, below the copy, so it never sits
     behind the text; the field thins and the copy carries its own shadow. */
  .mel-planet-frame { right: -150px; top: auto; bottom: -170px; width: 380px; height: 380px; opacity: 0.6; }
  .mel-loop { width: 440px; height: 440px; }
  .mel-overture { align-items: start; padding-top: 84px; padding-bottom: 60px; }
  .mel-scrollcue { display: none; }
  .mel-readout div { grid-template-columns: 78px 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .mel-overture-copy, .mel-part-head, .mel-index-inner { transition: none; opacity: 1; transform: none; }
  .mel-bodies .mel-body { animation: none; opacity: 1; transform: none; }
  .mel-scrollcue-line { animation: none; }
  .mel-planet-frame { transform: none !important; }
}
`;

export default MelancholiaLanding;
