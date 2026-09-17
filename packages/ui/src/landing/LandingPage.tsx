import { DropZoneSection } from './DropZoneSection';
import { GallerySection } from './GallerySection';
import { LandingFooter } from './LandingFooter';
import { MoleculeFinder } from './MoleculeFinder';
import { MoleculeWall } from './MoleculeWall';
import { HOME_SEO, useSeo } from '../seo';
import './student-home.css';

/**
 * Search first, then a wall of molecules, then the guided starter set. The
 * only prose left is what a visitor needs to get into a structure.
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
        <MoleculeFinder />
      </section>
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
