import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { App } from '@modelcontextprotocol/ext-apps';
import { getElementSpec } from '@atlas/core';
import { LupiCanvas } from '@atlas/ui/viewer/LupiCanvas';
import { detectRenderCapability } from '@atlas/ui/renderCapability';
import { MoleculeScene, type CameraActions } from './MoleculeScene';
import { elementAtomIds, readMoleculeToolResult, type MoleculeCard, type MoleculeView } from './toolResult';

declare global {
  interface Window {
    /** Read-only acceptance evidence. No mutation or result-injection API. */
    __lupiChatgpt?: Readonly<{ state: () => Record<string, unknown> }>;
  }
}

function Mark() {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="m7 20 6-13 9 10M7 20l15-3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7" cy="20" r="4" fill="currentColor" /><circle cx="13" cy="7" r="3.5" fill="currentColor" /><circle cx="22" cy="17" r="3" fill="currentColor" />
    </svg>
  );
}

function Icon({ name }: { name: 'reset' | 'expand' | 'arrow' | 'plus' | 'minus' }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {name === 'reset' && <><path d="M4 7a6.4 6.4 0 1 1-0.4 5M4 7V2M4 7h5" /></>}
      {name === 'expand' && <><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" /></>}
      {name === 'arrow' && <><path d="M5 15 15 5M6 5h9v9" /></>}
      {name === 'plus' && <path d="M4 10h12M10 4v12" />}
      {name === 'minus' && <path d="M4 10h12" />}
    </svg>
  );
}

function SourceLink({ href, open, children, className }: { href: string; open: (url: string, event: MouseEvent<HTMLAnchorElement>) => void; children: ReactNode; className?: string }) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => open(href, event)}>{children}</a>;
}

function readableTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function MoleculeApp() {
  const appRef = useRef<App | null>(null);
  const cardRef = useRef<MoleculeCard | null>(null);
  const contextQueue = useRef(Promise.resolve());
  const cameraActions = useRef<CameraActions | null>(null);
  const [card, setCard] = useState<MoleculeCard | null>(null);
  const [hostState, setHostState] = useState<'connecting' | 'connected' | 'unavailable'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [resultVersion, setResultVersion] = useState(0);
  const [rendererReady, setRendererReady] = useState(false);
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [displayMode, setDisplayMode] = useState('inline');
  const capability = useMemo(detectRenderCapability, []);

  useEffect(() => {
    const diagnostics = Object.freeze({
      state: (): Record<string, unknown> => {
        const current = cardRef.current;
        const molecule = current?.molecule;
        const scene = cameraActions.current?.sceneSnapshot();
        const expectedBondCount = current?.view.style === 'ball-and-stick' ? molecule?.bonds.aid1.length ?? 0 : 0;
        return {
          ready: document.querySelector('.viewport')?.getAttribute('data-render-state') === 'ready'
            && scene?.atomLayerInstanceCounts.includes(molecule?.atoms.ids.length ?? -1) === true
            && scene.bondInstanceCount === expectedBondCount,
          rendererBackend: document.getElementById('lupi-molecule-canvas')?.dataset.rendererBackend ?? null,
          source: molecule?.schemaVersion === 'lupi.omol25.v1' ? 'OMol25' : molecule ? 'PubChem' : null,
          cid: molecule?.schemaVersion === 'lupi.pubchem.v1' ? molecule.cid : null,
          collection: molecule?.schemaVersion === 'lupi.omol25.v1' ? molecule.collection : null,
          rowIndex: molecule?.schemaVersion === 'lupi.omol25.v1' ? molecule.rowIndex : null,
          name: molecule?.name ?? null,
          structureRef: current?.structureRef ?? null,
          dimension: molecule?.dimension ?? null,
          coordinateUnits: molecule?.coordinateUnits ?? null,
          sourceUrl: molecule?.sourceUrl ?? null,
          atomCount: molecule?.atoms.ids.length ?? 0,
          atomIds: molecule?.atoms.ids.slice() ?? [],
          atomicNumbers: molecule?.atoms.elements.slice() ?? [],
          bondCount: molecule?.bonds.aid1.length ?? 0,
          bonds: molecule ? { aid1: molecule.bonds.aid1.slice(), aid2: molecule.bonds.aid2.slice(), order: molecule.bonds.order.slice() } : null,
          view: current ? { ...current.view, highlightAtomIds: current.view.highlightAtomIds.slice(), highlightElements: current.view.highlightElements.slice() } : null,
          camera: cameraActions.current?.snapshot() ?? null,
          scene: scene ?? null,
        };
      },
    });
    window.__lupiChatgpt = diagnostics;
    return () => { if (window.__lupiChatgpt === diagnostics) delete window.__lupiChatgpt; };
  }, []);

  useEffect(() => {
    // The installed resource only accepts a host tool-result. A bare URL never
    // invents a demo structure or silently swaps in a bundled molecule.
    if (window.parent === window) {
      setHostState('unavailable');
      return;
    }
    const app = new App({ name: 'Lupi Live', version: '0.2.0' }, {}, { autoResize: true });
    appRef.current = app;
    let active = true;
    // Register before connect: the host may replay the initial result during
    // initialization, including when reopening a conversation.
    app.ontoolresult = (result) => {
      if (!active) return;
      try {
        const incoming = readMoleculeToolResult(result);
        cardRef.current = incoming;
        setCard(incoming);
        setError(null);
        setNotice(null);
        setGraphicsFailed(false);
        setRendererReady(false);
        setResetVersion((version) => version + 1);
        setResultVersion((version) => version + 1);
      } catch (cause) {
        cardRef.current = null;
        setCard(null);
        setError(cause instanceof Error ? cause.message : 'The molecule result could not be read.');
      }
    };
    app.onhostcontextchanged = (context) => {
      if (!active) return;
      if (context.theme) document.documentElement.dataset.theme = context.theme;
      if (context.displayMode) setDisplayMode(context.displayMode);
      if (context.availableDisplayModes) setCanExpand(context.availableDisplayModes.includes('fullscreen'));
    };
    void app.connect().then(() => {
      if (!active) return;
      setHostState('connected');
      const context = app.getHostContext();
      if (context?.theme) document.documentElement.dataset.theme = context.theme;
      setCanExpand(context?.availableDisplayModes?.includes('fullscreen') ?? false);
      setDisplayMode(context?.displayMode ?? 'inline');
    }).catch(() => {
      if (active) setHostState('unavailable');
    });
    return () => {
      active = false;
      appRef.current = null;
      void app.close();
    };
  }, []);

  useEffect(() => {
    const unavailable = () => { setGraphicsFailed(true); setRendererReady(false); };
    window.addEventListener('lupi:renderer-unavailable', unavailable);
    return () => window.removeEventListener('lupi:renderer-unavailable', unavailable);
  }, []);

  const publishView = useCallback((next: MoleculeView) => {
    const current = cardRef.current;
    const app = appRef.current;
    if (!current) return;
    const updated = { ...current, view: next };
    cardRef.current = updated;
    setCard(updated);
    setNotice(null);
    if (!app) return;
    // Serialize context changes; fast taps cannot race a newer selection.
    contextQueue.current = contextQueue.current.catch(() => undefined).then(async () => {
      if (cardRef.current !== updated) return;
      const sourceIdentity = current.molecule.schemaVersion === 'lupi.omol25.v1'
        ? `OMol25 ${current.molecule.collection} row ${current.molecule.rowIndex}`
        : `PubChem CID ${current.molecule.cid}`;
      await app.updateModelContext({
        structuredContent: {
          app: 'Lupi Live',
          structureRef: current.structureRef,
          source: current.molecule.schemaVersion === 'lupi.omol25.v1' ? 'OMol25' : 'PubChem',
          ...(current.molecule.schemaVersion === 'lupi.omol25.v1'
            ? { collection: current.molecule.collection, rowIndex: current.molecule.rowIndex, atomIdKind: current.molecule.atomIdKind, bondTopology: current.molecule.bondTopology }
            : { cid: current.molecule.cid }),
          name: current.molecule.name,
          sourceUrl: current.molecule.sourceUrl,
          dimension: current.molecule.dimension,
          view: next,
        },
        content: [{ type: 'text', text: `This Lupi card shows ${current.molecule.name}, ${sourceIdentity}. Its ${next.highlightAtomIds.length} highlighted atoms have ${current.molecule.schemaVersion === 'lupi.omol25.v1' ? 'IDs generated from source row order' : 'source AIDs'} ${next.highlightAtomIds.join(', ') || '(none)'}. Use this structureRef for a follow-up; another card can show a different molecule.` }],
      });
    }).catch(() => {
      if (cardRef.current === updated) setNotice('The view changed here, but ChatGPT could not receive this selection.');
    });
  }, []);

  const openLink = useCallback((url: string, event: MouseEvent<HTMLAnchorElement>) => {
    const app = appRef.current;
    if (!app || hostState !== 'connected') return;
    event.preventDefault();
    void app.openLink({ url }).then((result) => {
      if (result.isError) setNotice('The host could not open that link. You can copy its address from the link menu.');
    }).catch(() => setNotice('The host could not open that link. You can copy its address from the link menu.'));
  }, [hostState]);

  const resetView = useCallback(() => {
    const current = cardRef.current;
    if (!current) return;
    publishView({ ...current.view, highlightAtomIds: [], highlightElements: [] });
    setResetVersion((version) => version + 1);
  }, [publishView]);

  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const rotations: Record<string, [number, number]> = {
      ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12],
    };
    if (event.key in rotations) cameraActions.current?.rotate(...rotations[event.key]);
    else if (event.key === '+' || event.key === '=') cameraActions.current?.zoom(0.85);
    else if (event.key === '-') cameraActions.current?.zoom(1.18);
    else if (event.key === 'Home') resetView();
    else return;
    event.preventDefault();
  };

  const molecule = card?.molecule;
  const isOmol = molecule?.schemaVersion === 'lupi.omol25.v1';
  const sourceLabel = isOmol ? `OMol25 ${molecule.collection} · row ${molecule.rowIndex}` : molecule ? `PubChem CID ${molecule.cid}` : '';
  const websiteUrl = isOmol ? molecule.websiteUrl : molecule ? `https://lupi.live/?molecule=cid:${molecule.cid}` : 'https://lupi.live';
  const elements = useMemo(() => {
    if (!molecule) return [];
    const counts = new Map<number, number>();
    molecule.atoms.elements.forEach((number) => counts.set(number, (counts.get(number) ?? 0) + 1));
    return Array.from(counts, ([number, count]) => ({ number, count, ...getElementSpec(number) }));
  }, [molecule]);

  const selectedIds = new Set(card?.view.highlightAtomIds ?? []);
  const selectedNames = elements.filter((element) => {
    const ids = card ? elementAtomIds(card.molecule, element.number) : [];
    return ids.length > 0 && ids.every((id) => selectedIds.has(id));
  }).map((element) => element.name.toLowerCase());
  const multipleBonds = card?.molecule.bonds.order.filter((order) => [2, 3, 4].includes(order)).length ?? 0;
  const unavailable = graphicsFailed || !capability.canRender;

  return (
    <main className={`molecule-card ${displayMode === 'fullscreen' ? 'is-expanded' : ''}`} data-host={hostState} data-source={molecule?.schemaVersion === 'lupi.omol25.v1' ? 'OMol25' : molecule ? 'PubChem' : undefined} data-cid={molecule?.schemaVersion === 'lupi.pubchem.v1' ? molecule.cid : undefined} data-selected-atom-ids={card?.view.highlightAtomIds.join(',')} data-coordinate-dimension={molecule?.dimension}>
      <header className="card-header">
        <div className="brand"><span className="brand-mark"><Mark /></span><span>Lupi Live</span><span className="brand-divider" /><span className="brand-descriptor">Molecular explorer</span></div>
        {card && <span className={`dimension-tag ${card.molecule.dimension === '2d' ? 'is-2d' : ''}`}><span />{card.molecule.dimension === '3d' ? '3D coordinates' : '2D depiction'}</span>}
      </header>

      {!card ? (
        <section className="empty-state" aria-live="polite">
          <span className="empty-mark"><Mark /></span>
          <h1>{error ? 'This structure could not be shown' : hostState === 'unavailable' ? 'Open Lupi Live in ChatGPT' : 'Waiting for your molecule'}</h1>
          <p>{error ?? (hostState === 'unavailable' ? 'This molecular viewer opens from a Lupi tool result. Ask “Explore OMol25 molecules” with Lupi enabled.' : 'Lupi will show the identified OMol25 or PubChem record here when its tool result arrives.')}</p>
        </section>
      ) : (
        <>
          <section className="compound-header">
            <div className="compound-identity">
              <h1>{card.molecule.name}</h1>
              <div className="compound-meta"><span className="formula">{card.molecule.formula}</span><span aria-hidden="true">·</span><SourceLink href={card.molecule.sourceUrl} open={openLink}>{sourceLabel}<Icon name="arrow" /></SourceLink></div>
            </div>
            <div className="compound-count"><strong>{card.molecule.atoms.ids.length}</strong><span>atoms</span></div>
          </section>

          <div className="viewport" tabIndex={0} onKeyDown={handleKeys} role="region" aria-label={`${card.molecule.name} ${card.molecule.dimension === '3d' ? 'interactive 3D' : '2D'} molecule. Arrow keys rotate a 3D view, plus and minus zoom, Home resets.`} data-render-state={unavailable ? 'unavailable' : rendererReady ? 'ready' : 'starting'}>
            {unavailable ? (
              <div className="graphics-unavailable" role="status"><span className="empty-mark"><Mark /></span><h2>Interactive graphics are unavailable here</h2><p>The source record is identified below. Open this same molecule in Lupi to try its full viewer.</p><SourceLink href={websiteUrl} open={openLink}>Open {card.molecule.name} in Lupi<Icon name="arrow" /></SourceLink></div>
            ) : (
              <LupiCanvas
                key={`${card.structureRef}:${resultVersion}`}
                id="lupi-molecule-canvas"
                capability={capability}
                camera={{ position: [0, 0, 20], fov: 36, near: 0.01, far: 1000 }}
                frameloop="demand"
                dpr={[1, 1.75]}
                background="#142820"
                onRuntime={() => setRendererReady(true)}
              >
                <MoleculeScene frame={card.frame} view={card.view} is3d={card.molecule.dimension === '3d'} resetVersion={resetVersion} actions={cameraActions} />
              </LupiCanvas>
            )}
            {!unavailable && <><div className="viewport-label"><span className="live-dot" />{rendererReady ? card.molecule.dimension === '3d' ? 'Interactive structure' : 'Source depiction' : 'Starting viewer…'}</div><div className="viewport-actions"><button type="button" className="viewport-button reset-button" onClick={resetView} aria-label="Reset view and clear atom highlights" title="Reset view and clear highlights"><Icon name="reset" /><span>Reset view</span></button>{canExpand && <button type="button" className="viewport-button" aria-label={displayMode === 'fullscreen' ? 'Return to inline view' : 'Expand molecule viewer'} title="Expand molecule viewer" onClick={() => { void appRef.current?.requestDisplayMode({ mode: displayMode === 'fullscreen' ? 'inline' : 'fullscreen' }).catch(() => setNotice('Expanded viewing is unavailable in this host.')); }}><Icon name="expand" /></button>}</div><div className="zoom-controls"><button type="button" className="viewport-button" aria-label="Zoom in" onClick={() => cameraActions.current?.zoom(0.82)}><Icon name="plus" /></button><button type="button" className="viewport-button" aria-label="Zoom out" onClick={() => cameraActions.current?.zoom(1.22)}><Icon name="minus" /></button></div><p className="interaction-hint"><span>{card.molecule.dimension === '3d' ? 'Drag to rotate' : '2D source depiction'}</span><span className="hint-separator" aria-hidden="true">·</span><span>Pinch or scroll to zoom</span></p></>}
          </div>

          <section className="view-controls" aria-label="Molecule display controls">
            <div className="element-legend" aria-label="Highlight by element">{elements.map((element) => {
              const ids = elementAtomIds(card.molecule, element.number);
              const pressed = ids.every((id) => selectedIds.has(id));
              return <button key={element.number} type="button" className="element-button" disabled={unavailable} aria-pressed={pressed} title={`Highlight ${element.name.toLowerCase()} (${element.count} atoms)`} onClick={() => publishView({ ...card.view, highlightAtomIds: pressed ? [] : ids, highlightElements: pressed ? [] : [element.symbol] })}><span className="element-dot" style={{ backgroundColor: element.color }} /><span>{element.symbol}</span><span className="element-count">{element.count}</span></button>;
            })}</div>
            <div className="style-switch" role="group" aria-label="Molecule representation"><button type="button" disabled={unavailable} aria-pressed={card.view.style === 'ball-and-stick'} onClick={() => publishView({ ...card.view, style: 'ball-and-stick' })}>{isOmol ? 'Atoms' : 'Ball & stick'}</button><button type="button" disabled={unavailable} aria-pressed={card.view.style === 'spacefill'} onClick={() => publishView({ ...card.view, style: 'spacefill' })}>Space fill</button></div>
          </section>

          <div className="selection-status" aria-live="polite">{unavailable ? <span>Source data is available; interactive controls need graphics.</span> : selectedIds.size ? <><span className="selection-dot" /><span>{selectedNames.length ? `${selectedNames.join(', ')} highlighted` : 'Atoms highlighted'}<span className="selection-count"> · {selectedIds.size} {selectedIds.size === 1 ? 'atom' : 'atoms'}</span></span><button type="button" onClick={() => publishView({ ...card.view, highlightAtomIds: [], highlightElements: [] })}>Clear</button></> : <span>Choose an element to highlight its atoms.</span>}</div>

          <footer className="card-footer"><details className="source-details"><summary>Source &amp; structure details</summary><dl><div><dt>Source</dt><dd><SourceLink href={card.molecule.sourceUrl} open={openLink}>{sourceLabel}</SourceLink></dd></div><div><dt>Coordinates</dt><dd>{card.molecule.dimension === '3d' ? '3D coordinates · ångström (Å)' : '2D depiction · no physical distance units'}</dd></div><div><dt>Connectivity</dt><dd>{isOmol ? 'No source bond topology; atoms shown without bonds' : `${card.molecule.bonds.aid1.length} source bonds${multipleBonds > 0 ? ` · ${multipleBonds} multiple bonds` : ''}`}</dd></div><div><dt>Retrieved</dt><dd>{readableTime(card.molecule.retrievedAt)}</dd></div></dl><p>{isOmol ? 'Coordinates come from the OMol25 source row. Displayed atom IDs are generated from row order; bonds are not supplied. Atom radii are scaled for illustration.' : `Atoms and connectivity come from the retrieved PubChem record. Cylinders show connectivity; the source record retains bond orders. Atom radii are scaled for illustration.${card.molecule.dimension === '2d' ? ' Hydrogens may be implicit in 2D records.' : ''}`}</p><SourceLink href={card.molecule.recordUrl} open={openLink}>Open source record<Icon name="arrow" /></SourceLink></details><SourceLink className="open-lupi" href={websiteUrl} open={openLink}>Open in Lupi<Icon name="arrow" /></SourceLink></footer>
        </>
      )}
      {notice && <p className="host-notice" role="status">{notice}</p>}
    </main>
  );
}
