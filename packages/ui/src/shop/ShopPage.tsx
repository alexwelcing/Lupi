import { useEffect } from 'react';

/**
 * /shop — Lupi molecule merch entry point.
 *
 * Deliberately light: no three/R3F imports, mirrors the LandingShell aesthetic.
 * v1 links out to the Shopify storefront (headless checkout handled by Shopify).
 * The data arrays below are shaped so a Storefront-API upgrade can replace the
 * static tiles without touching layout.
 */

const STOREFRONT = 'https://lupi-8182.myshopify.com';

const COLLECTIONS: Array<{ handle: string; title: string; tagline: string; molecules: string }> = [
  {
    handle: 'molecule-merch',
    title: 'Molecule Merch',
    tagline: 'The full line — posters, tees, mugs, and more.',
    molecules: 'Everything in the archive',
  },
  {
    handle: 'happy-hormones',
    title: 'Happy Hormones',
    tagline: 'Serotonin, dopamine, oxytocin — meaning made precise.',
    molecules: 'Serotonin · Dopamine · Oxytocin',
  },
  {
    handle: 'daily-rituals-vices',
    title: 'Daily Rituals & Vices',
    tagline: 'The molecules behind the morning cup and the evening pour.',
    molecules: 'Caffeine · Theobromine · Ethanol',
  },
  {
    handle: 'fitness-lifestyle',
    title: 'Fitness & Lifestyle',
    tagline: 'Structures that move with you.',
    molecules: 'Creatine · Lactic Acid · L-Theanine',
  },
  {
    handle: 'iconic-chemistry',
    title: 'Iconic Chemistry',
    tagline: 'The ones everyone knows on sight.',
    molecules: 'Water · Oxygen · Benzene',
  },
];

/** House colorways rendered by the LUPI viewer's export pipeline. */
const COLORWAYS: Array<{ id: string; label: string; chips: string[] }> = [
  { id: 'ion', label: 'Ion', chips: ['#1edce0', '#7de9ff', '#f59e0b'] },
  { id: 'ultraviolet', label: 'Ultraviolet', chips: ['#7c3aed', '#22d3ee', '#f472b6'] },
  { id: 'ember', label: 'Ember', chips: ['#f97316', '#f59e0b', '#fb7185'] },
  { id: 'verdant', label: 'Verdant', chips: ['#16a34a', '#a3e635', '#facc15'] },
  { id: 'roseline', label: 'Roseline', chips: ['#f43f5e', '#fb7185', '#f59e0b'] },
  { id: 'lab', label: 'Lab', chips: ['#14b8a6', '#38bdf8', '#f59e0b'] },
];

const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

export default function ShopPage() {
  useEffect(() => {
    document.title = 'Lupi Shop — Molecule Merch by Lupine Science';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        'content',
        'Molecular-structure posters, apparel, and merch rendered by the LUPI viewer. The science of how you feel, drawn exactly.',
      );
    }
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #020204 0%, #06080d 60%, #0a0f18 100%)', color: '#f8fafc' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>
        {/* Header */}
        <a href="/" style={{ ...mono, fontSize: 11, color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>
          ← Lupi — Archive of Matter
        </a>
        <div style={{ marginTop: 40, marginBottom: 12, ...mono, fontSize: 11, color: '#1edce0' }}>
          Lupi Shop
        </div>
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 16px', lineHeight: 1.05 }}>
          Wear the exact molecule.
        </h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', maxWidth: 560, lineHeight: 1.7, margin: '0 0 40px' }}>
          Every structure is rendered from real chemical geometry by the LUPI viewer — the same
          instrument on this site — then printed on posters, tees, mugs, and more. The science of
          how you feel, drawn exactly.
        </p>

        {/* Colorway strip */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 48 }}>
          {COLORWAYS.map((cw) => (
            <div key={cw.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 100, background: 'rgba(255,255,255,0.03)' }}>
              <span style={{ display: 'flex', gap: 3 }}>
                {cw.chips.map((c) => (
                  <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c, display: 'inline-block' }} />
                ))}
              </span>
              <span style={{ ...mono, fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{cw.label}</span>
            </div>
          ))}
        </div>

        {/* Collection tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {COLLECTIONS.map((col) => (
            <a
              key={col.handle}
              href={`${STOREFRONT}/collections/${col.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '28px 24px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 16,
                textDecoration: 'none',
                color: '#f8fafc',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1edce0'; e.currentTarget.style.background = 'rgba(30,220,224,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
            >
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{col.title}</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>{col.tagline}</span>
              <span style={{ ...mono, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{col.molecules}</span>
              <span style={{ ...mono, fontSize: 10, color: '#1edce0', marginTop: 6 }}>Shop the collection →</span>
            </a>
          ))}
        </div>

        {/* Footnote */}
        <p style={{ marginTop: 48, fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 1.7, maxWidth: 640 }}>
          Checkout is handled securely by Shopify. Structures are drawn from public chemical data
          (PubChem geometries) and rendered by the LUPI export engine — original renders, no traced
          artwork. Questions? <a href="mailto:alex@lupinesci.com" style={{ color: 'rgba(255,255,255,0.55)' }}>alex@lupinesci.com</a>
        </p>
      </div>
    </div>
  );
}
