import { lazy, Suspense } from 'react';
import { EXTERNAL_RESEARCH_DATASETS } from '@atlas/core';
import { EXAMPLES } from '../gallery/catalog';
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
  { id: 'gallery', label: 'Lupi gallery', note: `${EXAMPLES.length} entries` },
  { id: 'omol25', label: 'OMol25', note: '34.3M structures' },
  { id: 'research', label: 'Zenodo research', note: `${EXTERNAL_RESEARCH_DATASETS.length} records` },
  { id: 'potentials', label: 'NIST potentials', note: 'catalog' },
];

const TITLES: Record<LibraryCollectionId, { heading: string; lede: string }> = {
  all: {
    heading: 'Every connected source, one search.',
    lede: 'Lupi’s gallery, Meta’s OMol25, cited Zenodo research files, NIST potentials, PubChem, and your saved views. Each result names its source and what the viewer adds.',
  },
  gallery: {
    heading: 'The full Lupi gallery.',
    lede: 'Every curated coordinate file and trajectory Lupi ships or streams, by domain, type, and functional group.',
  },
  omol25: {
    heading: 'Open Molecules 2025.',
    lede: 'Tens of millions of DFT structures, paged from the public ColabFit conversions on demand.',
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
    lede: 'One random structure from the OMol25 validation slice.',
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
