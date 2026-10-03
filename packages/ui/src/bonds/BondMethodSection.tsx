/**
 * BondMethodSection — Learn's "How these bonds were drawn" (strategy §2.11).
 *
 * Every line comes from the recipe's own constants and this frame's
 * perceived graph (counts before any display filter), so the copy cannot
 * drift from what the rule did. "How sure" quotes the committed validation
 * receipt, and "Copy method" copies the citable method sentence.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  CLASH_FLOOR_A,
  LONG_EXCESS_A,
  MOLECULAR_RECIPE_ID,
  bondMethodParagraph,
  bondMethodSentence,
  type PerceivedBonds,
} from '@atlas/core/bonds';
import { omolChargeSourcePhrase, omolDomainCaveat, omolSignedCharge } from '@atlas/core/omol25';
import type { Frame } from '@atlas/core/types';
// The receipt is not a package export; only these top-level fields are read.
import { hard, recipe as validatedRecipe, reported, rows, tolerance as validatedTolerance } from '../../../core/src/bonds/validation-v1.json';

export const BOND_METHOD_SECTION_ID = 'learn-bond-method';

export interface BondMethodCopy {
  paragraph: string;
  counts: string;
  inputs: string | null;
  notClaimed: string;
  longBonds: string | null;
  domainCaveat: string | null;
  clashes: string | null;
  howSure: string | null;
  /** What Copy method puts on the clipboard. */
  method: string;
}

const angstrom = (value: number) => `${value.toFixed(2)} Å`;

/** The section's lines for one frame's molecular graph. */
export function bondMethodCopy(
  perceived: PerceivedBonds,
  frame: Pick<Frame, 'chemistry' | 'sourceRecord'>,
): BondMethodCopy {
  const { counts } = perceived;
  const tolerance = perceived.params.tolerance;
  const record = frame.sourceRecord?.dataset === 'omol25' ? frame.sourceRecord : null;
  const chemistry = frame.chemistry ?? null;
  const supplier = record ? 'OMol25' : 'the file';

  const paragraph = record
    ? bondMethodParagraph({ tolerance })
    : bondMethodParagraph({ tolerance }).replace('OMol25 provides none', 'the file provides none');

  let inputs: string | null = null;
  if (chemistry) {
    const charge = chemistry.totalCharge === null ? 'not recorded' : omolSignedCharge(chemistry.totalCharge);
    const spin = chemistry.spinMultiplicity === null ? 'not recorded' : String(chemistry.spinMultiplicity);
    inputs = `Inputs from ${supplier}: charge ${charge}, spin multiplicity ${spin} (${omolChargeSourcePhrase(chemistry.source)}).`;
  }

  const notClaimed = counts.ionCarbonClose > 0
    ? 'Not claimed: bond orders, hydrogen bonds, or carbon bonds to lithium or magnesium (organometallic s-block bonds are not drawn).'
    : 'Not claimed: bond orders, hydrogen bonds.';

  const longBonds = counts.long > 0
    ? `${counts.long} ${counts.long === 1 ? 'bond is' : 'bonds are'} more than ${angstrom(LONG_EXCESS_A)} longer than usual: this is a snapshot away from equilibrium, or a bond is breaking.`
    : null;

  const clashes = counts.clashes > 0
    ? `Atoms closer than ${angstrom(CLASH_FLOOR_A)} — likely a coordinate problem in the source.`
    : null;

  let howSure: string | null = null;
  if (
    perceived.recipe === MOLECULAR_RECIPE_ID
    && validatedRecipe === MOLECULAR_RECIPE_ID
    && hard.multiBondH === 0
    && hard.overValent === 0
    && hard.covalentIonSticks === 0
  ) {
    const scope = tolerance === validatedTolerance ? 'On' : `At the default ${angstrom(validatedTolerance)} tolerance, on`;
    howSure = `${scope} all ${rows.toLocaleString('en-US')} OMol25 neutral-validation structures: no hydrogen with two bonds, no over-valent atom, no covalent stick to an s-block ion; ${reported.ionsWithContactPct}% of ions have 1 or more contacts.`;
  }

  return {
    paragraph,
    counts: `This structure: ${counts.covalent} bonds · ${counts.coordination} metal–ligand · ${counts.ionicContact} ionic contacts · ${counts.long} long bonds · ${counts.removed} removed by the rule · ${counts.clashes} clashes.`,
    inputs,
    notClaimed,
    longBonds,
    domainCaveat: omolDomainCaveat(chemistry?.domain ?? null),
    clashes,
    howSure,
    method: bondMethodSentence({
      recipe: perceived.recipe,
      tolerance,
      collection: record?.collection ?? null,
      row: record?.row ?? null,
    }),
  };
}

// The bond legend's ⓘ asks Learn to open on this section.
let focusRequested = false;
const focusListeners = new Set<() => void>();

export function requestBondMethodFocus(): void {
  focusRequested = true;
  focusListeners.forEach((listener) => listener());
}

export function BondMethodSection({
  perceived,
  frame,
  muted,
  heading,
}: {
  perceived: PerceivedBonds;
  frame: Pick<Frame, 'chemistry' | 'sourceRecord'>;
  muted: CSSProperties;
  heading: CSSProperties;
}) {
  const copy = bondMethodCopy(perceived, frame);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    const focus = () => {
      if (!focusRequested || !detailsRef.current) return;
      focusRequested = false;
      detailsRef.current.open = true;
      detailsRef.current.scrollIntoView?.({ block: 'nearest' });
    };
    focusListeners.add(focus);
    focus();
    return () => {
      focusListeners.delete(focus);
    };
  }, []);

  useEffect(() => {
    if (copied === 'idle') return undefined;
    const timer = window.setTimeout(() => setCopied('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyMethod = async () => {
    try {
      await navigator.clipboard.writeText(copy.method);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <details
      ref={detailsRef}
      id={BOND_METHOD_SECTION_ID}
      data-testid="bond-method-section"
      style={{ borderTop: '1px solid #526253', paddingTop: 14, marginTop: 14 }}
    >
      <summary style={{ cursor: 'pointer', minHeight: 40 }}>How these bonds were drawn</summary>
      <p>{copy.paragraph}</p>
      <p>{copy.counts}</p>
      {copy.inputs && <p>{copy.inputs}</p>}
      <p>{copy.notClaimed}</p>
      {copy.longBonds && <p>{copy.longBonds}</p>}
      {copy.domainCaveat && <p>{copy.domainCaveat}</p>}
      {copy.clashes && <p>{copy.clashes}</p>}
      {copy.howSure && (
        <>
          <h3 style={heading}>How sure</h3>
          <p>{copy.howSure}</p>
        </>
      )}
      <button
        type="button"
        onClick={copyMethod}
        style={{
          minHeight: 40,
          padding: '0 14px',
          borderRadius: 6,
          color: 'inherit',
          border: '1px solid #526253',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        Copy method
      </button>
      <span role="status" style={{ ...muted, marginLeft: 10 }}>
        {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : ''}
      </span>
    </details>
  );
}
