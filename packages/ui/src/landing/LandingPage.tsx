import { DailyCard } from './DailyCard';
import { DropZoneSection } from './DropZoneSection';
import { GallerySection } from './GallerySection';
import { LandingFooter } from './LandingFooter';
import { MoleculeFinder } from './MoleculeFinder';
import { MoleculeWall } from './MoleculeWall';
import { OmolShelf } from './OmolShelf';
import { BuckyHero } from './hero/BuckyHero';
import { HOME_SEO, useSeo } from '../seo';
import './student-home.css';

/**
 * Search first, then today's OMol25 picks, today's Lupi Daily, a wall of
 * molecules and the guided starter set. The only prose left is what a
 * visitor needs to get into a structure. Beside the heading, a still ink
 * buckyball to spin, and to tap into 3D.
 */
export function LandingPage() {
  useSeo(HOME_SEO);
  return (
    <main id="main" className="student-home">
      <section className="student-hero student-hero--finder student-width" aria-labelledby="home-title">
        <h1 id="home-title">
          Small structures.
          <br />
          Big discoveries.
        </h1>
        <BuckyHero />
        <MoleculeFinder />
        <p className="student-scan-callout">
          <a className="student-secondary" href="/scan">
            <span aria-hidden="true">📷</span> Point your camera at something
          </a>
          <span className="student-caption">Eggs, a leather couch, your coffee: see what it&rsquo;s made of.</span>
        </p>
      </section>
      <OmolShelf />
      <DailyCard />
      <MoleculeWall />
      <GallerySection />
      <section id="learn" className="student-tips student-width" aria-labelledby="guide-title">
        <h2 id="guide-title">In the viewer</h2>
        <ul>
          <li>Drag to rotate, scroll or pinch to zoom.</li>
          <li>Learn shows composition and source notes.</li>
          <li>Export a picture, or sign in to save a view link.</li>
        </ul>
        <a href="/study/organic-functional-groups">Functional groups guide ↗</a>
      </section>
      <section className="student-width student-file-intro" aria-labelledby="file-title">
        <h2 id="file-title">Or open your own file.</h2>
      </section>
      <DropZoneSection />
      <LandingFooter />
    </main>
  );
}
