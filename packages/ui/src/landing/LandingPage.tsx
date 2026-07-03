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

        {/* Part Two — bring your own matter */}
        <div className="mel">
          <section className="mel-part mel-part--tight" aria-labelledby="mel-part-two">
            <div className="mel-part-head is-shown">
              <span className="mel-part-mark">Part Two</span>
              <h2 id="mel-part-two" className="mel-part-title">Bring your own matter.</h2>
              <p className="mel-part-sub">
                Drop a LAMMPS dump, a data file, a trajectory, an ave/chunk
                profile. It becomes a body you can turn in your hands &mdash; its
                forces, its energy, its motion, replayed.
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
              Lupi is a browser-native instrument for molecular matter &mdash;
              open data, verified, and cited. Nothing here is a picture of a
              structure; it is the structure, turned in real time.
            </p>
          </section>
        </div>

        <LandingFooter />
      </div>
    </>
  );
}
