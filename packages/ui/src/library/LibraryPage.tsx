import { lazy, Suspense, useMemo } from 'react';
import { EXTERNAL_RESEARCH_DATASETS } from '@atlas/core';
import { omolBondTruth } from '@atlas/core/omol25';
import { EXAMPLES } from '../gallery/catalog';
import { OmolOpenerStatus, OmolPickTiles, useOmolOpener } from '../landing/OmolShelf';
import { todaysOmolPicks } from '../landing/omolShelf';
import { OMOL_PICKS } from '../landing/omolShelf.data';
import { libraryPath, type LibraryCollectionId } from '../viewer/viewerRoutes';
import { LibraryBrowser } from './LibraryBrowser';
import { GalleryCollection } from './GalleryCollection';
import { ResearchCollection } from './ResearchCollection';
import { RandomStructure } from './RandomStructure';

const Omol25Collection = lazy(() => import('./Omol25Collection').then((module) => ({ default: module.Omol25Collection })));
const PotentialsCollection = lazy(() =>
  import('./PotentialsCollection').then((module) => ({ default: module.PotentialsCollection })),
);

interface CollectionNav {
  id: Exclude<LibraryCollectionId, 'random'>;
  label: string;
  note: string;
}

const NAV: CollectionNav[] = [
  { id: 'all', label: 'All sources', note: 'one search' },
  { id: 'omol25', label: 'OMol25', note: '34.3M structures' },
  { id: 'gallery', label: 'Lupi gallery', note: `${EXAMPLES.length} entries` },
  { id: 'research', label: 'Zenodo research', note: `${EXTERNAL_RESEARCH_DATASETS.length} records` },
  { id: 'potentials', label: 'NIST potentials', note: 'catalog' },
];

const TITLES: Record<LibraryCollectionId, { heading: string; lede: string }> = {
  all: {
    heading: 'Every connected source, one search.',
    lede: 'Meta’s OMol25, Lupi’s gallery, cited Zenodo research files, NIST potentials, PubChem, and your saved views. Each result names its source and what the viewer adds.',
  },
  gallery: {
    heading: 'The full Lupi gallery.',
    lede: 'Every curated coordinate file and trajectory Lupi ships or streams, by domain, type, and functional group.',
  },
  omol25: {
    heading: 'Open Molecules 2025.',
    lede: '34.3 million DFT structures, paged from the public ColabFit conversions on demand, or filtered by element.',
  },
  research: {
    heading: 'Cited research files.',
    lede: 'Eight versioned LAMMPS records fetched from Zenodo only when you open them.',
  },
  potentials: {
    heading: 'NIST interatomic potentials.',
    lede: 'The NIST Interatomic Potentials Repository catalog, with Lupi demo trajectories where they exist.',
  },
  random: {
    heading: 'Surprise me.',
    lede: 'One random structure from the 34.3M-row OMol25 neutral training set.',
  },
};

export function LibraryPage({ collection }: { collection: LibraryCollectionId }) {
  const copy = TITLES[collection];
  return (
    <main id="main" className="library student-width">
      <section className="library-hero" aria-labelledby="library-title">
        <p className="student-eyebrow">Library</p>
        <h1 id="library-title">{copy.heading}</h1>
        <p className="student-deck">{copy.lede}</p>
      </section>
      <nav className="library-nav" aria-label="Library collections">
        {NAV.map((item) => (
          <a key={item.id} href={libraryPath(item.id)} aria-current={collection === item.id ? 'page' : undefined}>
            {item.label} <small>{item.note}</small>
          </a>
        ))}
        <a href={libraryPath('random')} aria-current={collection === 'random' ? 'page' : undefined}>
          Surprise me
        </a>
      </nav>
      {collection === 'all' && <OmolPicksRow />}
      <Suspense fallback={<p className="student-result-count">Loading collection…</p>}>
        {collection === 'all' && <LibraryBrowser />}
        {collection === 'gallery' && <GalleryCollection />}
        {collection === 'omol25' && <Omol25Collection />}
        {collection === 'research' && <ResearchCollection />}
        {collection === 'potentials' && <PotentialsCollection />}
        {collection === 'random' && <RandomStructure />}
      </Suspense>
    </main>
  );
}

/** Six of today's featured OMol25 picks above the all-sources grid (bundled; no fetch). */
function OmolPicksRow() {
  const picks = useMemo(() => todaysOmolPicks(), []);
  const opener = useOmolOpener();
  return (
    <section className="omol-shelf omol-shelf--library" aria-labelledby="library-omol-picks">
      <div className="library-section-head">
        <h2 id="library-omol-picks">OMol25 picks</h2>
        <p>
          <a href="/library/omol25">All {OMOL_PICKS.length} picks and 34.3M more →</a>
        </p>
      </div>
      <OmolPickTiles picks={picks} entry="library" opener={opener} />
      <OmolOpenerStatus opener={opener} />
      <p className="omol-shelf__caption">{omolBondTruth()}</p>
    </section>
  );
}
