import { useEffect, useState } from 'react';
import { markOpenEntry } from '../analytics/openEntry';

const FAILURE = 'OMol25’s host didn’t answer. Try again, or open a pick.';

/**
 * `/library/random`: open one random structure from the 34.3M-row OMol25
 * neutral training set, picked by row number (no index download). The shell
 * hands off to the viewer as soon as the file loads. One attempt per visit or
 * tap: a failure waits for the visitor instead of retrying.
 */
export function RandomStructure() {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    markOpenEntry('library');
    import('../molecules/randomOmol')
      .then(({ openRandomOmol25Molecule }) => openRandomOmol25Molecule())
      .then((result) => {
        if (alive && !result.ok && !/superseded/i.test(result.message)) setError(result.message);
      })
      .catch(() => {
        if (alive) setError(FAILURE);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  return (
    <div className="library-intro" aria-live="polite">
      {error ? (
        <>
          <p className="finder-error" role="alert">
            {error}
          </p>
          <p className="student-actions">
            <button
              type="button"
              className="student-secondary"
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
            <a className="student-secondary" href="/library/omol25">
              Open a pick
            </a>
          </p>
        </>
      ) : (
        <p>Picking a random OMol25 structure…</p>
      )}
    </div>
  );
}
