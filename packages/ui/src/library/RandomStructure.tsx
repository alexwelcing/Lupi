import { useEffect, useState } from 'react';

/**
 * `/library/random`: open one random structure from the OMol25 validation
 * slice. The shell hands off to the viewer as soon as the file loads.
 */
export function RandomStructure() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import('../molecules/randomOmol')
      .then(({ openRandomOmol25Molecule }) => openRandomOmol25Molecule())
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : 'No structure could be opened.');
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="library-intro" aria-live="polite">
      {error ? (
        <>
          <p className="finder-error" role="alert">
            {error}
          </p>
          <a className="student-secondary" href="/library/omol25">
            Browse OMol25 instead
          </a>
        </>
      ) : (
        <p>Picking a random OMol25 structure…</p>
      )}
    </div>
  );
}
