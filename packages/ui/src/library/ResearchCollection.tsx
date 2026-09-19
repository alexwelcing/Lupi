import { EXTERNAL_RESEARCH_DATASETS } from '@atlas/core';
import { LibraryBrowser } from './LibraryBrowser';

/**
 * Eight cited Zenodo records. Bytes stay on Zenodo; the edge proxies only the
 * pinned files, verifies the SHA-256, and caps the size.
 */
export function ResearchCollection() {
  const coarse = EXTERNAL_RESEARCH_DATASETS.filter((dataset) => dataset.representation === 'coarse-grained').length;
  return (
    <div>
      <div className="library-intro">
        <p>
          {EXTERNAL_RESEARCH_DATASETS.length} versioned LAMMPS records under CC BY 4.0. Each entry pins a Zenodo record, exact
          file name, byte count, and an independently verified SHA-256. Lupi fetches a file only when you open it, through a
          fixed allowlist that rejects any other upstream URL.
        </p>
        <p>
          LAMMPS numeric type IDs are opaque; an element map is applied only where the catalog records one from the source.
          {coarse > 0 ? ` ${coarse} of these are coarse-grained bead models, shown as spheres at the source centers.` : ''}
        </p>
      </div>
      <LibraryBrowser lockedSource="research" />
    </div>
  );
}
