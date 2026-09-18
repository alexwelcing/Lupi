import { PotentialBrowser } from '../panels/PotentialBrowser';

/**
 * NIST Interatomic Potentials Repository catalog. The browser component
 * survived the reset intact; it loads the bundled catalog lazily and opens a
 * pre-computed demo trajectory when one exists.
 */
export function PotentialsCollection() {
  return (
    <div>
      <div className="library-intro">
        <p>
          Interatomic potentials from the NIST Interatomic Potentials Repository, searchable by element, pair style, and
          year. Entries with a demo trajectory open it directly; the rest select the potential only. A demo is Lupi's
          own small simulation with that potential, not a NIST-published result.
        </p>
      </div>
      <div className="library-legacy-panel">
        <PotentialBrowser />
      </div>
    </div>
  );
}
