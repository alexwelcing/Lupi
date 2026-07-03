/**
 * ShopDrawer — buy a molecule's merch without leaving the viewer.
 *
 * Two clicks to buying: the viewer's Shop button opens this drawer (click 1);
 * "Buy now" on a product goes straight to Shopify's secure checkout (click 2).
 * Browsing, variant picking, and the cart all stay in-app via the Storefront
 * API; only the final payment is Shopify's hosted page, opened in a new tab so
 * the viewer stays where it is.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { IconClose } from '../icons';
import {
  addToCart,
  buyNow,
  commerceConfigured,
  createCart,
  fetchCart,
  fetchMoleculeProducts,
  formatMoney,
  moleculeTag,
  type Cart,
  type ShopProduct,
  type ShopVariant,
} from './storefront';

const CART_KEY = 'lupi.cartId';

function defaultSelection(product: ShopProduct): Record<string, string> {
  const first = product.variants.find((v) => v.availableForSale) ?? product.variants[0];
  const sel: Record<string, string> = {};
  for (const o of first?.selectedOptions ?? []) sel[o.name] = o.value;
  return sel;
}

function resolveVariant(product: ShopProduct, selection: Record<string, string>): ShopVariant | undefined {
  return product.variants.find((v) => v.selectedOptions.every((o) => selection[o.name] === o.value))
    ?? product.variants.find((v) => v.availableForSale)
    ?? product.variants[0];
}

/** Open checkout in a pre-opened tab so async cart creation isn't popup-blocked. */
function openCheckout(run: () => Promise<string>) {
  const tab = window.open('', '_blank');
  run()
    .then((url) => {
      if (tab) tab.location.href = url;
      else window.location.href = url;
    })
    .catch((err) => {
      if (tab) tab.close();
      console.error('[shop] checkout failed:', err);
    });
}

export function ShopDrawer() {
  const shopOpen = useStore((s) => s.shopOpen);
  const setShopOpen = useStore((s) => s.setShopOpen);
  const file = useStore((s) => s.file);

  const tag = file ? moleculeTag(file.name) : '';
  const configured = commerceConfigured();

  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [cart, setCart] = useState<Cart | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loadedTag = useRef<string | null>(null);

  // Restore an existing cart once when the drawer first opens.
  useEffect(() => {
    if (!shopOpen || !configured) return;
    const id = localStorage.getItem(CART_KEY);
    if (id && !cart) {
      fetchCart(id).then((c) => { if (c && c.totalQuantity > 0) setCart(c); else localStorage.removeItem(CART_KEY); }).catch(() => {});
    }
  }, [shopOpen, configured, cart]);

  // Load the loaded molecule's products when the drawer opens (or the molecule changes).
  useEffect(() => {
    if (!shopOpen || !configured || !tag) return;
    if (loadedTag.current === tag && status !== 'idle') return;
    loadedTag.current = tag;
    setStatus('loading');
    setError('');
    fetchMoleculeProducts(tag)
      .then((p) => { setProducts(p); setStatus('ready'); })
      .catch((err) => { setError(err.message); setStatus('error'); });
  }, [shopOpen, configured, tag, status]);

  const addLine = useCallback(async (variantId: string) => {
    setBusy(variantId);
    try {
      let next: Cart;
      const id = cart?.id ?? localStorage.getItem(CART_KEY);
      if (id) {
        next = await addToCart(id, variantId);
      } else {
        next = await createCart(variantId);
      }
      localStorage.setItem(CART_KEY, next.id);
      setCart(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to cart');
    } finally {
      setBusy(null);
    }
  }, [cart]);

  if (!shopOpen) return null;

  const moleculeName = file ? file.name.replace(/^MCP:\s*/i, '') : '';

  return (
    <>
      <div style={sScrim} onClick={() => setShopOpen(false)} aria-hidden="true" />
      <aside data-testid="shop-drawer" style={sDrawer} role="dialog" aria-label="Shop this molecule">
        <header style={sHeader}>
          <div style={{ minWidth: 0 }}>
            <div style={sKicker}>Shop</div>
            <div style={sTitle}>{moleculeName || 'This molecule'}</div>
          </div>
          <button aria-label="Close shop" onClick={() => setShopOpen(false)} style={sIconBtn}><IconClose /></button>
        </header>

        <div style={sBody}>
          {!configured && (
            <div style={sEmpty}>
              <div style={sEmptyTitle}>Storefront not connected</div>
              <p style={sEmptyText}>
                Set <code style={sCode}>VITE_SHOPIFY_STOREFRONT_TOKEN</code> (and{' '}
                <code style={sCode}>VITE_SHOPIFY_STORE_DOMAIN</code>) to sell from the viewer.
                Create a public Storefront token in Shopify admin → Apps → Develop apps.
              </p>
            </div>
          )}

          {configured && status === 'loading' && <div style={sHint}>Loading merch…</div>}
          {configured && status === 'error' && <div style={{ ...sHint, color: '#f87171' }}>{error}</div>}
          {configured && status === 'ready' && products.length === 0 && (
            <div style={sEmpty}>
              <div style={sEmptyTitle}>No merch for {moleculeName} yet</div>
              <p style={sEmptyText}>Generate it in the Merch Studio, publish it, and it appears here to buy.</p>
            </div>
          )}

          {configured && products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              busy={busy}
              onAdd={addLine}
            />
          ))}
        </div>

        {cart && cart.totalQuantity > 0 && (
          <footer style={sCartBar}>
            <div>
              <div style={sCartCount}>{cart.totalQuantity} item{cart.totalQuantity === 1 ? '' : 's'} in cart</div>
              <div style={sCartSub}>{formatMoney(cart.subtotal)}</div>
            </div>
            <button
              data-testid="shop-checkout"
              style={sCheckout}
              onClick={() => openCheckout(async () => cart.checkoutUrl)}
            >
              Checkout →
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}

function ProductCard({
  product, busy, onAdd,
}: {
  product: ShopProduct;
  busy: string | null;
  onAdd: (variantId: string) => void;
}) {
  const [selection, setSelection] = useState<Record<string, string>>(() => defaultSelection(product));
  const variant = useMemo(() => resolveVariant(product, selection), [product, selection]);
  const soldOut = !variant?.availableForSale;
  const busyThis = busy === variant?.id;

  return (
    <article data-testid={`shop-product-${product.handle}`} style={sCard}>
      <div style={sThumbWrap}>
        {(variant?.imageUrl ?? product.featuredImageUrl) && (
          <img src={variant?.imageUrl ?? product.featuredImageUrl} alt={product.title} style={sThumb} />
        )}
      </div>
      <div style={sCardBody}>
        <div style={sCardTitle}>{product.title}</div>
        <div style={sCardPrice}>{formatMoney(variant?.price ?? product.minPrice)}</div>

        {product.options.filter((o) => o.name !== 'Title').map((opt) => (
          <div key={opt.name} style={sOptRow}>
            <span style={sOptName}>{opt.name}</span>
            <div style={sChips}>
              {opt.values.map((val) => {
                const active = selection[opt.name] === val;
                return (
                  <button
                    key={val}
                    style={sChip(active)}
                    onClick={() => setSelection((s) => ({ ...s, [opt.name]: val }))}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div style={sActions}>
          <button
            data-testid={`shop-buy-${product.handle}`}
            disabled={!variant || soldOut}
            style={sBuy(!variant || soldOut)}
            onClick={() => variant && openCheckout(() => buyNow(variant.id))}
          >
            {soldOut ? 'Sold out' : 'Buy now'}
          </button>
          <button
            disabled={!variant || soldOut || busyThis}
            style={sAdd}
            onClick={() => variant && onAdd(variant.id)}
          >
            {busyThis ? 'Adding…' : 'Add to cart'}
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── styles ─────────────────────────────────────────────────────────
const sScrim: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,4,8,0.5)', backdropFilter: 'blur(2px)', zIndex: 300 };
const sDrawer: React.CSSProperties = {
  position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(420px, 100vw)', zIndex: 301,
  display: 'flex', flexDirection: 'column', background: '#0b0e14', color: '#eef2f8',
  borderLeft: '1px solid rgba(216,184,120,0.2)', boxShadow: '-24px 0 60px -30px rgba(0,0,0,0.8)',
};
const sHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '16px 18px', borderBottom: '1px solid rgba(216,184,120,0.16)', flexShrink: 0,
};
const sKicker: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#d8b878' };
const sTitle: React.CSSProperties = { fontFamily: "'Iowan Old Style', Palatino, Georgia, serif", fontSize: 22, marginTop: 2 };
const sIconBtn: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 30, height: 30, color: 'rgba(226,232,240,0.8)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, cursor: 'pointer' };
const sBody: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'grid', gap: 14, alignContent: 'start' };
const sCard: React.CSSProperties = { display: 'grid', gridTemplateColumns: '108px 1fr', gap: 14, border: '1px solid rgba(125,211,252,0.14)', borderRadius: 14, overflow: 'hidden', background: 'rgba(15,23,42,0.5)' };
const sThumbWrap: React.CSSProperties = { background: '#141a26' };
const sThumb: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block', aspectRatio: '1 / 1' };
const sCardBody: React.CSSProperties = { padding: '12px 14px 12px 0', display: 'grid', gap: 8, alignContent: 'start' };
const sCardTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, lineHeight: 1.2 };
const sCardPrice: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 13, color: '#d8b878' };
const sOptRow: React.CSSProperties = { display: 'grid', gap: 4 };
const sOptName: React.CSSProperties = { fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(148,163,184,0.7)', fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const sChips: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 5 };
const sChip = (active: boolean): React.CSSProperties => ({
  fontSize: 11, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
  color: active ? '#06202b' : 'rgba(226,232,240,0.85)',
  background: active ? '#d8b878' : 'rgba(255,255,255,0.04)',
  border: `1px solid ${active ? '#d8b878' : 'rgba(148,163,184,0.24)'}`, fontWeight: active ? 700 : 500,
});
const sActions: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 4 };
const sBuy = (disabled: boolean): React.CSSProperties => ({
  minHeight: 36, borderRadius: 8, fontWeight: 750, fontSize: 12.5, cursor: disabled ? 'not-allowed' : 'pointer',
  color: disabled ? 'rgba(148,163,184,0.5)' : '#06202b',
  background: disabled ? 'rgba(15,23,42,0.5)' : 'linear-gradient(135deg,#d8b878,#7dd3fc)',
  border: '1px solid rgba(125,211,252,0.3)',
});
const sAdd: React.CSSProperties = { minHeight: 36, padding: '0 12px', borderRadius: 8, fontWeight: 650, fontSize: 12, cursor: 'pointer', color: 'rgba(226,232,240,0.85)', background: 'transparent', border: '1px solid rgba(148,163,184,0.24)' };
const sCartBar: React.CSSProperties = {
  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '14px 18px', borderTop: '1px solid rgba(216,184,120,0.2)', background: 'rgba(8,11,16,0.9)',
};
const sCartCount: React.CSSProperties = { fontSize: 12, color: 'rgba(203,213,225,0.8)' };
const sCartSub: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 15, fontWeight: 700, color: '#eef2f8' };
const sCheckout: React.CSSProperties = { minHeight: 42, padding: '0 20px', borderRadius: 10, fontWeight: 780, fontSize: 14, cursor: 'pointer', color: '#06202b', background: 'linear-gradient(135deg,#d8b878,#7dd3fc)', border: 'none' };
const sHint: React.CSSProperties = { fontSize: 13, color: 'rgba(203,213,225,0.72)', padding: '8px 2px' };
const sEmpty: React.CSSProperties = { padding: '28px 8px', textAlign: 'center' };
const sEmptyTitle: React.CSSProperties = { fontFamily: "'Iowan Old Style', Palatino, Georgia, serif", fontSize: 18, marginBottom: 8 };
const sEmptyText: React.CSSProperties = { fontSize: 13, color: 'rgba(203,213,225,0.7)', lineHeight: 1.55, maxWidth: 320, margin: '0 auto' };
const sCode: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 11, color: '#7dd3fc', background: 'rgba(216,184,120,0.1)', padding: '1px 5px', borderRadius: 5 };
