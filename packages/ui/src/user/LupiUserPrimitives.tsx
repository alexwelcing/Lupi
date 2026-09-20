import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const lupiUserColors = {
  ink: '#050505',
  panel: 'rgba(6, 8, 8, 0.96)',
  panelSoft: 'rgba(244, 239, 229, 0.055)',
  paper: '#f4efe5',
  muted: 'rgba(244, 239, 229, 0.62)',
  line: 'rgba(244, 239, 229, 0.18)',
  lineStrong: 'rgba(244, 239, 229, 0.34)',
  amber: '#f2aa45',
  cyan: '#84d7ff',
  green: '#63b879',
  pink: '#f3a9c7',
};

const gridSurface = `
  linear-gradient(90deg, rgba(244,239,229,0.07) 1px, transparent 1px) 0 0 / 22px 22px,
  linear-gradient(rgba(244,239,229,0.055) 1px, transparent 1px) 0 0 / 22px 22px,
  linear-gradient(145deg, rgba(6,8,8,0.98), rgba(18,22,22,0.94))
`;

export function LupiUserTrigger({
  active = false,
  compact = false,
  controls,
  expanded,
  glyph,
  label,
  photoUrl,
  testId,
  title,
  onClick,
}: {
  active?: boolean;
  compact?: boolean;
  controls?: string;
  expanded?: boolean;
  glyph: ReactNode;
  label: string;
  photoUrl?: string | null;
  testId?: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : '26px auto',
        alignItems: 'center',
        justifyItems: 'center',
        gap: compact ? 0 : 8,
        width: compact ? 36 : 'auto',
        height: 36,
        minWidth: compact ? 36 : 92,
        padding: compact ? 0 : '0 11px 0 5px',
        color: active ? lupiUserColors.paper : 'var(--text-muted)',
        background: active
          ? `linear-gradient(135deg, rgba(242,170,69,0.18), rgba(31,139,212,0.14)), ${gridSurface}`
          : 'rgba(5,5,5,0.34)',
        border: active ? `1px solid ${lupiUserColors.lineStrong}` : '1px solid var(--border-default)',
        borderRadius: 8,
        boxShadow: active ? '0 0 0 1px rgba(242,170,69,0.12), 0 14px 42px rgba(0,0,0,0.34)' : 'none',
        cursor: 'pointer',
      }}
    >
      <span style={glyphFrameStyle(active)}>
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            referrerPolicy="no-referrer"
            style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover' }}
          />
        ) : (
          glyph
        )}
      </span>
      {!compact && (
        <span
          style={{
            maxWidth: 92,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono), ui-monospace, monospace',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0,
          }}
        >
          {label}
        </span>
      )}
    </button>
  );
}

export function LupiPanel({
  align = 'right',
  children,
  testId,
  width = 372,
  zIndex = 430,
}: {
  /**
   * Which edge of the trigger the popover hangs from. Triggers in the
   * top-left header capsule must use `left`, otherwise a wide panel is pushed
   * off the left edge of the viewport.
   */
  align?: 'left' | 'right';
  children: ReactNode;
  testId?: string;
  width?: number;
  zIndex?: number;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        position: 'absolute',
        ...(align === 'left' ? { left: 0 } : { right: 0 }),
        top: 44,
        width: `min(${width}px, calc(100vw - 24px))`,
        padding: 0,
        zIndex,
        color: lupiUserColors.paper,
        background: gridSurface,
        border: `1px solid ${lupiUserColors.lineStrong}`,
        borderRadius: 8,
        boxShadow: '0 28px 86px rgba(0,0,0,0.54)',
        overflow: 'hidden',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Mobile counterpart to `LupiPanel`: a bottom sheet portaled to `document.body`
 * so it escapes the header's layout containment and the popover's right-edge
 * anchoring (which pushed it off the left of a phone screen). The header and
 * footer stay pinned; only the body scrolls, so the primary action is always
 * reachable above the keyboard and the home indicator.
 */
export function LupiSheet({
  children,
  footer,
  header,
  labelledBy,
  onDismiss,
  sheetRef,
  testId,
  zIndex = 600,
}: {
  children: ReactNode;
  footer?: ReactNode;
  header: ReactNode;
  labelledBy?: string;
  onDismiss: () => void;
  sheetRef?: (node: HTMLDivElement | null) => void;
  testId?: string;
  zIndex?: number;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const setRef = (node: HTMLDivElement | null) => {
    localRef.current = node;
    sheetRef?.(node);
  };

  useEffect(() => {
    // Focus the sheet itself (not the first field) so the phone keyboard does
    // not shoot up before the person has read the header.
    localRef.current?.focus({ preventScroll: true });
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-lupi-sheet-root=""
      style={{ position: 'fixed', inset: 0, zIndex, display: 'grid', alignItems: 'end' }}
    >
      <div
        aria-hidden="true"
        data-testid={testId ? `${testId}-backdrop` : undefined}
        onClick={onDismiss}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(3,5,6,0.62)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
        }}
      />
      <div
        ref={setRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={testId}
        tabIndex={-1}
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
          width: '100%',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 20px)',
          margin: '0 auto',
          maxWidth: 560,
          color: lupiUserColors.paper,
          background: gridSurface,
          borderTop: `1px solid ${lupiUserColors.lineStrong}`,
          borderLeft: `1px solid ${lupiUserColors.lineStrong}`,
          borderRight: `1px solid ${lupiUserColors.lineStrong}`,
          borderRadius: '18px 18px 0 0',
          boxShadow: '0 -18px 64px rgba(0,0,0,0.6)',
          outline: 'none',
          overflow: 'hidden',
        }}
      >
        <div>
          <div
            aria-hidden="true"
            style={{
              width: 42,
              height: 4,
              margin: '10px auto 0',
              borderRadius: 999,
              background: lupiUserColors.lineStrong,
            }}
          />
          {header}
        </div>
        <div
          style={{
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            paddingBottom: footer ? 0 : 'env(safe-area-inset-bottom)',
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: 'grid',
              gap: 8,
              padding: '10px 14px calc(12px + env(safe-area-inset-bottom))',
              borderTop: `1px solid ${lupiUserColors.line}`,
              background: 'rgba(5,5,5,0.5)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function LupiPanelHeader({
  accessory,
  kicker,
  onClose,
  title,
  titleId,
}: {
  accessory?: ReactNode;
  kicker: string;
  onClose?: () => void;
  title: string;
  titleId?: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: onClose ? '1fr auto auto' : '1fr auto',
        gap: 12,
        alignItems: 'center',
        padding: 14,
        borderBottom: `1px solid ${lupiUserColors.line}`,
        background: 'rgba(5,5,5,0.32)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={kickerStyle}>{kicker}</div>
        <div id={titleId} style={titleStyle}>{title}</div>
      </div>
      {accessory}
      {onClose && (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 40,
            height: 40,
            borderRadius: 8,
            border: `1px solid ${lupiUserColors.line}`,
            background: 'rgba(244,239,229,0.06)',
            color: lupiUserColors.paper,
            fontSize: 20,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

export function LupiButton({
  children,
  disabled = false,
  size = 'default',
  tone = 'quiet',
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  /** `touch` is the 48px phone size used inside `LupiSheet` footers. */
  size?: 'default' | 'touch';
  tone?: 'primary' | 'quiet' | 'danger';
  onClick?: () => void;
}) {
  const palette = tone === 'primary'
    ? {
        background: `linear-gradient(135deg, ${lupiUserColors.amber}, #ff7a2c)`,
        border: '1px solid rgba(242,170,69,0.72)',
        color: '#120c05',
      }
    : tone === 'danger'
    ? {
        background: 'rgba(97,37,29,0.42)',
        border: '1px solid rgba(243,169,199,0.28)',
        color: '#ffd7df',
      }
    : {
        background: 'rgba(244,239,229,0.055)',
        border: `1px solid ${lupiUserColors.line}`,
        color: lupiUserColors.paper,
      };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: size === 'touch' ? 48 : 38,
        padding: '0 12px',
        borderRadius: size === 'touch' ? 10 : 6,
        border: palette.border,
        background: palette.background,
        color: palette.color,
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: size === 'touch' ? 13 : 11,
        fontWeight: 860,
        letterSpacing: 0,
        opacity: disabled ? 0.48 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function LupiProviderButton({
  disabled = false,
  label,
  onClick,
  provider,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  provider: 'google' | 'github';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr',
        alignItems: 'center',
        gap: 9,
        minHeight: 46,
        padding: '0 12px',
        borderRadius: 6,
        border: `1px solid ${provider === 'github' ? 'rgba(244,239,229,0.28)' : 'rgba(132,215,255,0.34)'}`,
        background: provider === 'github'
          ? 'rgba(244,239,229,0.045)'
          : 'linear-gradient(135deg, rgba(132,215,255,0.14), rgba(242,170,69,0.08))',
        color: lupiUserColors.paper,
        opacity: disabled ? 0.46 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span style={providerMarkStyle(provider)}>{provider === 'github' ? 'GH' : 'G'}</span>
      <span style={{ justifySelf: 'start', fontSize: 13, fontWeight: 780 }}>{label}</span>
    </button>
  );
}

export function LupiField({
  autoCapitalize,
  autoCorrect,
  hint,
  label,
  placeholder,
  size = 'default',
  spellCheck,
  value,
  onChange,
}: {
  autoCapitalize?: 'off' | 'none' | 'sentences' | 'words';
  autoCorrect?: 'on' | 'off';
  /** Helper line under the input, for example the resulting share URL. */
  hint?: ReactNode;
  label: string;
  placeholder?: string;
  /** `touch` uses a 16px font so iOS does not zoom the page on focus. */
  size?: 'default' | 'touch';
  spellCheck?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        style={{
          width: '100%',
          height: size === 'touch' ? 46 : 38,
          padding: '0 12px',
          borderRadius: size === 'touch' ? 10 : 6,
          border: `1px solid ${lupiUserColors.line}`,
          background: 'rgba(5,5,5,0.52)',
          color: lupiUserColors.paper,
          outline: 'none',
          fontSize: size === 'touch' ? 16 : 13,
        }}
      />
      {hint && (
        <span
          style={{
            minWidth: 0,
            overflowWrap: 'anywhere',
            color: lupiUserColors.cyan,
            fontFamily: 'var(--font-mono), ui-monospace, monospace',
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

export function LupiMetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '92px 1fr',
        gap: 10,
        alignItems: 'center',
        minHeight: 34,
        borderBottom: `1px solid ${lupiUserColors.line}`,
      }}
    >
      <span style={labelStyle}>{label}</span>
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: lupiUserColors.paper,
          fontFamily: 'var(--font-mono), ui-monospace, monospace',
          fontSize: 11,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function LupiNotice({
  children,
  tone = 'amber',
}: {
  children: ReactNode;
  tone?: 'amber' | 'green' | 'pink';
}) {
  const color = tone === 'green' ? lupiUserColors.green : tone === 'pink' ? lupiUserColors.pink : lupiUserColors.amber;
  return (
    <div
      style={{
        padding: 10,
        border: `1px solid ${color}66`,
        borderRadius: 6,
        background: `linear-gradient(135deg, ${color}24, rgba(5,5,5,0.34))`,
        color: tone === 'pink' ? '#ffd7df' : tone === 'green' ? '#c7f7d3' : '#ffe2a8',
        fontSize: 12,
        lineHeight: 1.42,
      }}
    >
      {children}
    </div>
  );
}

export function LupiStatusPill({
  label,
  tone = 'green',
}: {
  label: string;
  tone?: 'green' | 'amber' | 'cyan';
}) {
  const color = tone === 'amber' ? lupiUserColors.amber : tone === 'cyan' ? lupiUserColors.cyan : lupiUserColors.green;
  return (
    <span
      style={{
        display: 'inline-grid',
        gridTemplateColumns: '8px auto',
        alignItems: 'center',
        gap: 8,
        minHeight: 28,
        padding: '0 9px',
        borderRadius: 999,
        border: `1px solid ${color}55`,
        background: `${color}17`,
        color: lupiUserColors.paper,
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: 10,
        fontWeight: 800,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, boxShadow: `0 0 16px ${color}` }} />
      {label}
    </span>
  );
}

export function LupiIndexRow({
  after,
  before,
  href,
  label,
  onClick,
}: {
  after?: ReactNode;
  before?: ReactNode;
  href?: string;
  label: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      {before}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {after}
    </>
  );
  const style = indexRowStyle(before ? 'auto 1fr auto' : '1fr auto');

  if (href) {
    return (
      <a href={href} style={style}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} style={style}>
      {content}
    </button>
  );
}

export function LupiOpticalMark({ active = false }: { active?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        border: `1px solid ${active ? 'rgba(242,170,69,0.72)' : lupiUserColors.line}`,
        borderRadius: 6,
        background: `
          repeating-linear-gradient(90deg, ${active ? 'rgba(242,170,69,0.74)' : 'rgba(244,239,229,0.42)'} 0 2px, transparent 2px 6px),
          rgba(5,5,5,0.5)
        `,
        transform: active ? 'skewX(-7deg)' : 'none',
      }}
    />
  );
}

export const panelBodyStyle = {
  display: 'grid',
  gap: 12,
  padding: 14,
} satisfies CSSProperties;

export const labelStyle = {
  color: lupiUserColors.muted,
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0,
  textTransform: 'uppercase',
} satisfies CSSProperties;

export const valueStyle = {
  color: lupiUserColors.paper,
  fontSize: 13,
  fontWeight: 760,
  lineHeight: 1.25,
} satisfies CSSProperties;

function glyphFrameStyle(active: boolean): CSSProperties {
  return {
    display: 'grid',
    placeItems: 'center',
    width: 26,
    height: 26,
    color: active ? lupiUserColors.ink : lupiUserColors.paper,
    background: active ? lupiUserColors.amber : 'rgba(244,239,229,0.08)',
    border: `1px solid ${active ? 'rgba(242,170,69,0.7)' : lupiUserColors.line}`,
    borderRadius: 5,
    overflow: 'hidden',
  };
}

function providerMarkStyle(provider: 'google' | 'github'): CSSProperties {
  return {
    display: 'grid',
    placeItems: 'center',
    width: 28,
    height: 28,
    borderRadius: 5,
    color: provider === 'github' ? lupiUserColors.paper : lupiUserColors.ink,
    background: provider === 'github' ? 'rgba(244,239,229,0.1)' : lupiUserColors.paper,
    border: `1px solid ${lupiUserColors.line}`,
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    fontSize: 9,
    fontWeight: 900,
  };
}

function indexRowStyle(templateColumns: string): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: templateColumns,
    alignItems: 'center',
    gap: 9,
    width: '100%',
    minHeight: 38,
    padding: '0 10px',
    color: lupiUserColors.paper,
    background: 'rgba(244,239,229,0.045)',
    border: `1px solid ${lupiUserColors.line}`,
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
  };
}

const kickerStyle = {
  color: lupiUserColors.amber,
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0,
  textTransform: 'uppercase',
} satisfies CSSProperties;

const titleStyle = {
  marginTop: 4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: lupiUserColors.paper,
  fontSize: 17,
  fontWeight: 820,
  letterSpacing: 0,
} satisfies CSSProperties;
