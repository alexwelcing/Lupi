import { DropZoneSection } from './DropZoneSection';
import { GallerySection } from './GallerySection';
import { LandingFooter } from './LandingFooter';
import { HOME_SEO, useSeo } from '../seo';
import './student-home.css';

export function LandingPage() {
  useSeo(HOME_SEO);
  return (
    <main id="main" className="student-home">
      <section className="student-hero student-width" aria-labelledby="home-title">
        <div>
          <p className="student-eyebrow">A closer look at chemistry</p>
          <h1 id="home-title">
            Small structures.
            <br />
            Big discoveries.
          </h1>
          <p className="student-deck">
            Meet the molecules behind everyday things. Turn them around, look a little closer, and start
            making connections.
          </p>
          <div className="student-actions">
            <a className="student-primary" href="/?sim=water">
              Start with water <span aria-hidden="true">↗</span>
            </a>
            <a className="student-secondary" href="#gallery">
              Explore the collection
            </a>
          </div>
          <p className="student-caption">Free to explore. No account needed.</p>
        </div>
        <figure className="student-feature">
          <a href="/?sim=caffeine" aria-label="Explore caffeine in 3D">
            <img
              src="/learn/caffeine.svg"
              alt="Preview of the caffeine coordinate model"
              width="560"
              height="400"
              fetchPriority="high"
            />
            <figcaption>
              <span>
                <strong>Caffeine</strong>
                <small>A familiar molecule, a different perspective.</small>
              </span>
              <span aria-hidden="true">↗</span>
            </figcaption>
          </a>
        </figure>
      </section>
      <GallerySection />
      <section id="learn" className="student-guide student-width" aria-labelledby="guide-title">
        <div>
          <p className="student-eyebrow">Your first three minutes</p>
          <h2 id="guide-title">
            A model you can
            <br />
            learn from.
          </h2>
          <a href="/study/organic-functional-groups">Read the functional groups guide ↗</a>
        </div>
        <ol>
          <li>
            <strong>Open something familiar.</strong>
            <p>Each example has one question to start with. Choose a small molecule if you’re new here.</p>
          </li>
          <li>
            <strong>Look from another angle.</strong>
            <p>Drag to rotate. Scroll or pinch to zoom. Open Learn for composition and source notes.</p>
          </li>
          <li>
            <strong>Keep what you discover.</strong>
            <p>Export a picture, or sign in to save a view link. Your model stays interactive.</p>
          </li>
        </ol>
      </section>
      <section className="student-width student-file-intro" aria-labelledby="file-title">
        <p className="student-eyebrow">Have your own structure?</p>
        <h2 id="file-title">Bring it into view.</h2>
        <p>
          Open XYZ or LAMMPS files from a class or your own work. File opening is local; saving a shared view
          is a separate action.
        </p>
      </section>
      <DropZoneSection />
      <LandingFooter />
    </main>
  );
}
