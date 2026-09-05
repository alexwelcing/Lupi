import { useState } from 'react';
import { STUDENT_COLLECTION, STUDENT_EXAMPLES } from '../gallery/studentCollection';

const TOPICS = ['All examples', 'Start small', 'Rings & groups', 'Carbon structures'] as const;
export function GallerySection() {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<string>('All examples');
  const examples = STUDENT_EXAMPLES.filter(example => {
    const lesson = STUDENT_COLLECTION.find(entry => entry.id === example.id)!;
    return (
      (topic === 'All examples' || topic === lesson.topic) &&
      `${example.title} ${lesson.prompt} ${lesson.topic}`.toLowerCase().includes(query.trim().toLowerCase())
    );
  });
  return (
    <section id="gallery" className="student-collection student-width" aria-labelledby="collection-title">
      <div className="student-section-head">
        <div>
          <p className="student-eyebrow">The collection</p>
          <h2 id="collection-title">Pick a starting point.</h2>
        </div>
        <label className="student-search">
          <span>Find an example</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Try caffeine, carbon, oxygen…"
          />
        </label>
      </div>
      <div className="student-filters" role="group" aria-label="Example topics">
        {TOPICS.map(label => (
          <button key={label} type="button" aria-pressed={topic === label} onClick={() => setTopic(label)}>
            {label}
          </button>
        ))}
      </div>
      <p className="student-result-count" role="status">
        {examples.length} {examples.length === 1 ? 'example' : 'examples'} · One question to start each
        exploration.
      </p>
      <div className="student-cards">
        {examples.map(example => {
          const lesson = STUDENT_COLLECTION.find(entry => entry.id === example.id)!;
          return (
            <article key={example.id} className="student-card">
              <a href={`/?sim=${encodeURIComponent(example.id)}`} aria-label={`Explore ${example.title}`}>
                <div className="student-card-image">
                  <img
                    src={`/learn/${example.id}.svg`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width="400"
                    height="270"
                  />
                  <span aria-hidden="true">↗</span>
                </div>
                <div className="student-card-copy">
                  <p className="student-caption">
                    {lesson.topic} <span>· {example.atoms} atoms</span>
                  </p>
                  <h3>{example.title}</h3>
                  <p>{lesson.prompt}</p>
                </div>
              </a>
            </article>
          );
        })}
      </div>
      {examples.length === 0 && (
        <div className="student-empty">
          <h3>No matching examples</h3>
          <p>Try a molecule name or choose a different topic.</p>
          <button
            className="student-secondary"
            onClick={() => {
              setQuery('');
              setTopic('All examples');
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <p className="student-collection-note">
        These are coordinate models, not photographs. Bond lines can be inferred visual guides; they do not
        establish bond order or material properties. Open Learn in the viewer for source details.
      </p>
    </section>
  );
}
