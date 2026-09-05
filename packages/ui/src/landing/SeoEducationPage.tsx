import { FUNCTIONAL_GROUPS_SEO, useSeo } from '../seo';
import './student-home.css';
export type SeoEducationKind =
  | 'functional-groups'
  | 'functional-group-examples'
  | 'ochem-viewer'
  | 'omol25'
  | 'omol25-geometry'
  | 'million-atom-viewer';

const EXERCISES = [
  {
    id: 'ethanol',
    name: 'Ethanol',
    group: 'Alcohol',
    notation: 'C–OH',
    question: 'Find oxygen and its nearby hydrogen. Follow the carbon chain away from it.',
  },
  {
    id: 'acetone',
    name: 'Acetone',
    group: 'Ketone',
    notation: 'C–C(=O)–C',
    question: 'Find the oxygen and the central carbon. Compare the carbon groups on either side.',
  },
  {
    id: 'benzene',
    name: 'Benzene',
    group: 'Arene',
    notation: 'Aromatic carbon ring',
    question: 'View the ring from above and from the side. Sketch its arrangement.',
  },
] as const;

export function SeoEducationPage({ kind }: { kind: SeoEducationKind }) {
  useSeo(FUNCTIONAL_GROUPS_SEO);
  const retired = ['omol25', 'omol25-geometry', 'million-atom-viewer'].includes(kind);
  if (retired)
    return (
      <main className="student-home">
        <section className="student-width" style={{ paddingBlock: 64 }}>
          <h1>This workspace has retired from Lupi.</h1>
          <p>Large dataset browsing and research execution are separate from the learning app.</p>
          <a className="student-primary" href="/">
            Explore the collection
          </a>
        </section>
      </main>
    );
  return (
    <main className="student-home">
      <article className="student-width student-reader">
        <p className="student-eyebrow">A short learning guide</p>
        <h1>
          Get to know
          <br />
          functional groups.
        </h1>
        <p className="student-deck">
          Start with three familiar structures. Look for a small pattern, compare its surroundings, and
          connect a 3D model to a chemical drawing.
        </p>
        <h2>Patterns within a molecule</h2>
        <p>
          A functional group is a recurring arrangement of atoms associated with characteristic chemical
          behaviour. Recognising these arrangements helps you compare different molecules.
        </p>
        <p>
          The group definitions below follow{' '}
          <a href="https://openstax.org/books/organic-chemistry/pages/3-1-functional-groups">
            John McMurry’s Organic Chemistry, section 3.1 (OpenStax)
          </a>
          . The observation exercises are Lupi’s own prompts, using the coordinate models in our collection.
        </p>
        <div className="student-reader-table">
          <table>
            <caption>Three patterns to start with</caption>
            <thead>
              <tr>
                <th scope="col">Family</th>
                <th scope="col">Pattern to recognise</th>
                <th scope="col">Open a model</th>
              </tr>
            </thead>
            <tbody>
              {EXERCISES.map(entry => (
                <tr key={entry.id}>
                  <th scope="row">{entry.group}</th>
                  <td>
                    <code>{entry.notation}</code>
                  </td>
                  <td>
                    <a href={`/?sim=${entry.id}`}>{entry.name} ↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2>Look, sketch, compare</h2>
        <ol>
          {EXERCISES.map(entry => (
            <li key={entry.id}>
              <strong>{entry.name}.</strong> {entry.question}
            </li>
          ))}
        </ol>
        <h2>Read the model carefully</h2>
        <p>
          The files contain coordinates. The lines in the viewer can be distance-inferred guides, not supplied
          bond orders. Use an authoritative chemical drawing to identify double bonds, aromaticity, formal
          charge, and stereochemistry.
        </p>
        <p>
          A static structure alone does not establish a reaction mechanism, a spectrum, or a material
          property. Open Learn in the viewer to check what came from the file.
        </p>
        <a className="student-primary" href="/#gallery">
          Back to the collection
        </a>
      </article>
    </main>
  );
}
