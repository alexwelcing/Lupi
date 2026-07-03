/**
 * MerchStudio — the interface half of the merch system.
 *
 * Takes the molecule that's loaded in the viewer and turns it into a set of
 * print-on-demand products: it drives the same `lupi.export_merch` pipeline the
 * CLI uses (render → compose Gooten print files + storefront mockups → Shopify
 * listing shape), previews each product, and hands the pack off to the
 * Shopify/Gooten connector.
 *
 * Publishing to Shopify itself needs the Admin API token, which must stay
 * server-side — so the Studio's job is to GENERATE the pack (print files +
 * listing.json) and show the exact publish command. `tools/merch-publish.mjs`
 * does the store write + Gooten manifest.
 */

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import { IconClose } from '../icons';
import type { LupiMcpMerchListing } from '../mcpViewerBridge';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'ready' }
  | { kind: 'error'; label: string };

interface McpDriver {
  execute: (req: { id: string; tool: string; arguments: Record<string, unknown> }) => Promise<{
    ok: boolean;
    result?: { merch?: LupiMcpMerchListing[] };
    error?: { message: string };
  }>;
}

function driver(): McpDriver | null {
  return (window as unknown as { __lupiViewerMcp?: McpDriver }).__lupiViewerMcp ?? null;
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function priceRange(listing: LupiMcpMerchListing): string {
  const prices = listing.variants.map((v) => v.priceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)}–$${max.toFixed(2)}`;
}

export function MerchStudio({ showCloseButton = true }: { showCloseButton?: boolean }) {
  const setActivePanel = useStore((s) => s.setActivePanel);
  const file = useStore((s) => s.file);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [listings, setListings] = useState<LupiMcpMerchListing[]>([]);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    const mcp = driver();
    if (!mcp) {
      setStatus({ kind: 'error', label: 'Viewer bridge not ready' });
      return;
    }
    setStatus({ kind: 'working', label: 'Rendering molecule and composing products…' });
    try {
      const resp = await mcp.execute({
        id: 'merch-studio',
        tool: 'lupi.export_merch',
        arguments: { product: 'all', download: false, view: 'current' },
      });
      if (!resp.ok || !resp.result?.merch) {
        setStatus({ kind: 'error', label: resp.error?.message ?? 'Merch generation failed' });
        return;
      }
      setListings(resp.result.merch);
      setStatus({ kind: 'ready' });
    } catch (err) {
      setStatus({ kind: 'error', label: err instanceof Error ? err.message : 'Merch generation failed' });
    }
  }, []);

  const downloadPack = useCallback(() => {
    for (const listing of listings) {
      for (const asset of listing.assets) downloadDataUrl(asset.dataUrl, asset.filename);
    }
    // The listing manifest (dataUrls stripped — assets reference filenames).
    const manifest = listings.map((l) => ({
      ...l,
      assets: l.assets.map((a) => ({ product: a.product, kind: a.kind, filename: a.filename, width: a.width, height: a.height })),
    }));
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, 'listing.json');
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [listings]);

  const copySkus = useCallback(async () => {
    const skus = listings.flatMap((l) => l.variants.map((v) => v.sku)).join('\n');
    try {
      await navigator.clipboard.writeText(skus);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  }, [listings]);

  const molecule = file ? file.name.replace(/^MCP:\s*/, '') : '';

  return (
    <div data-testid="merch-studio" style={sPanel}>
      <div style={sHeader}>
        <div style={{ minWidth: 0 }}>
          <div style={sKicker}>Merch Studio</div>
          <div style={sSub}>
            {molecule ? `${molecule} → print-on-demand` : 'Load a molecule to begin'}
          </div>
        </div>
        {showCloseButton && (
          <button aria-label="Close merch studio" onClick={() => setActivePanel(null)} style={sIconBtn}>
            <IconClose />
          </button>
        )}
      </div>

      <div style={sBody}>
        {status.kind !== 'ready' && (
          <button
            data-testid="merch-generate"
            disabled={!file || status.kind === 'working'}
            onClick={generate}
            style={sPrimary(!file || status.kind === 'working')}
          >
            {status.kind === 'working' ? 'Composing…' : 'Generate merch from this molecule'}
          </button>
        )}

        {status.kind === 'working' && (
          <div style={sHint}>{status.label}</div>
        )}
        {status.kind === 'error' && (
          <div style={{ ...sHint, color: '#f87171' }}>{status.label}</div>
        )}

        {listings.length > 0 && (
          <>
            <div style={sGrid}>
              {listings.map((l) => {
                const mockup = l.assets.find((a) => a.kind === 'mockup');
                return (
                  <div key={l.product} data-testid={`merch-card-${l.product}`} style={sCard}>
                    {mockup && (
                      <img src={mockup.dataUrl} alt={l.title} style={sThumb} />
                    )}
                    <div style={sCardTitle}>{l.title}</div>
                    <div style={sCardMeta}>
                      {priceRange(l)} · {l.variants.length} variant{l.variants.length === 1 ? '' : 's'}
                    </div>
                    <div style={sCardGooten}>Gooten · {l.gootenProductName}</div>
                  </div>
                );
              })}
            </div>

            <Section label="1 · Export the pack">
              <button data-testid="merch-download" onClick={downloadPack} style={sSecondary}>
                Download print files + listing.json
              </button>
              <button onClick={copySkus} style={sGhost}>
                {copied ? 'SKUs copied' : `Copy ${listings.reduce((n, l) => n + l.variants.length, 0)} SKUs`}
              </button>
            </Section>

            <Section label="2 · Publish to Shopify (Gooten-fulfilled)">
              <div style={sHint}>
                Run the connector with the pack. It creates/updates each product (DRAFT),
                uploads the design, sets the <code style={sCode}>lupi.*</code> / <code style={sCode}>gooten.*</code>{' '}
                metafields, and writes a Gooten manifest to map each SKU.
              </div>
              <pre style={sCmd}>node tools/merch-publish.mjs --dir merch/{molecule ? slug(molecule) : 'molecule'} --execute</pre>
              <div style={sHint}>
                Then import <code style={sCode}>gooten-manifest.csv</code> in Gooten Hub to bind
                each SKU to a Gooten product. Add <code style={sCode}>--publish</code> to go live.
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 8, marginTop: 4 }}>
      <div style={sSectionLabel}>{label}</div>
      {children}
    </section>
  );
}

function slug(v: string) {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'molecule';
}

// ─── styles ─────────────────────────────────────────────────────────
const sPanel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
  boxSizing: 'border-box', overflowY: 'auto', background: '#080b10', color: '#e5edf7',
};
const sHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '14px 16px 12px', borderBottom: '1px solid rgba(148,163,184,0.16)', flexShrink: 0,
};
const sKicker: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.2, color: '#d8b878', textTransform: 'uppercase' };
const sSub: React.CSSProperties = { marginTop: 4, color: 'rgba(203,213,225,0.68)', fontSize: 11, fontFamily: 'var(--font-mono), ui-monospace, monospace' };
const sIconBtn: React.CSSProperties = {
  display: 'grid', placeItems: 'center', width: 28, height: 28, color: 'rgba(226,232,240,0.76)',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
};
const sBody: React.CSSProperties = { display: 'grid', gap: 14, padding: 12 };
const sGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 };
const sCard: React.CSSProperties = {
  border: '1px solid rgba(125,211,252,0.16)', borderRadius: 10, overflow: 'hidden', background: 'rgba(15,23,42,0.5)',
};
const sThumb: React.CSSProperties = { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block', background: '#0b0e14' };
const sCardTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, padding: '8px 10px 0', lineHeight: 1.2 };
const sCardMeta: React.CSSProperties = { fontSize: 11, color: 'rgba(203,213,225,0.7)', padding: '2px 10px 0' };
const sCardGooten: React.CSSProperties = { fontSize: 10, color: 'rgba(216,184,120,0.85)', padding: '2px 10px 10px', fontFamily: 'var(--font-mono), ui-monospace, monospace' };
const sSectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'rgba(203,213,225,0.6)' };
const sHint: React.CSSProperties = { fontSize: 11, lineHeight: 1.5, color: 'rgba(203,213,225,0.72)' };
const sCode: React.CSSProperties = { fontFamily: 'var(--font-mono), ui-monospace, monospace', color: '#7dd3fc', fontSize: 10 };
const sCmd: React.CSSProperties = {
  margin: 0, padding: '9px 10px', borderRadius: 8, background: 'rgba(2,6,12,0.7)', border: '1px solid rgba(125,211,252,0.16)',
  color: '#c7f0ff', fontSize: 10.5, fontFamily: 'var(--font-mono), ui-monospace, monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
};
const sPrimary = (disabled: boolean): React.CSSProperties => ({
  minHeight: 46, borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 750, fontSize: 13,
  color: disabled ? 'rgba(148,163,184,0.5)' : '#06202b',
  background: disabled ? 'rgba(15,23,42,0.5)' : 'linear-gradient(135deg,#d8b878,#7dd3fc)',
  border: '1px solid rgba(125,211,252,0.3)',
});
const sSecondary: React.CSSProperties = {
  minHeight: 42, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12.5, color: '#eaf7ff',
  background: 'rgba(15,23,42,0.72)', border: '1px solid rgba(125,211,252,0.28)',
};
const sGhost: React.CSSProperties = {
  minHeight: 36, borderRadius: 8, cursor: 'pointer', fontWeight: 650, fontSize: 12, color: 'rgba(203,213,225,0.8)',
  background: 'transparent', border: '1px solid rgba(148,163,184,0.2)',
};
