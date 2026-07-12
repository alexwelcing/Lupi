import { MelancholiaLanding } from './melancholia/MelancholiaLanding';
import { DropZoneSection } from './DropZoneSection';
import { GallerySection } from './GallerySection';
import { LandingFooter } from './LandingFooter';
import { ANIMATION_CSS } from './shared';
import { HOME_SEO, useSeo } from '../seo';

/**
 * LandingPage — the home page in the register of *Melancholia*.
 *
 * A twilight of matter up top: the approaching billion-atom planet, a curated
 * collection of lesser bodies, the field index. Then the working layer beneath
 * — bring your own matter, the complete searchable archive — introduced in the
 * same restrained voice rather than a second, louder design. The fixed sky
 * carries the cinematic sections; the working sections bring their own darkness
 * so the shift from dream to instrument is deliberate, not accidental.
 */
export function LandingPage() {
  useSeo(HOME_SEO);

  return (
    <>
      <style>{ANIMATION_CSS}</style>
      <div style={{ width: '100%', minHeight: '100vh', background: '#05060b' }}>
        <MelancholiaLanding />

        {/* Open research data in the same restrained visual register. */}
        <div className="mel">
          <section className="mel-part mel-part--tight" aria-labelledby="mel-part-two">
            <div className="mel-part-head is-shown">
              <span className="mel-part-mark">Open your data</span>
              <h2 id="mel-part-two" className="mel-part-title">Bring your own research data.</h2>
              <p className="mel-part-sub">
                Drop a LAMMPS dump, data file, XYZ structure, trajectory, or
                profile. Lupi opens it locally so you can inspect its structure,
                forces, properties, and motion in the same viewer.
              </p>
            </div>
          </section>
        </div>

        <DropZoneSection />
        <GallerySection />

        {/* Colophon */}
        <div className="mel">
          <section className="mel-colophon" aria-label="Colophon">
            <p className="mel-colophon-line">The light that reaches you left long ago.</p>
            <p className="mel-colophon-sub">
              Lupi is a browser-native viewer for molecules and materials &mdash;
              open data, inspect properties, preserve sources, and export the
              result. Every example is a live structure, not a static picture.
            </p>
          </section>
        </div>

        <LandingFooter />
      </div>
    </>
  );
}
