/**
 * App Shell primitives — thin React wrappers over the CSS utility classes
 * in apps/web/src/styles/global.css ("App Shell Primitives").
 *
 * Dynamic values (tone, direction, gap) are passed as data attributes or
 * semantic props so the components stay style-agnostic.
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export interface GlassPanelProps {
  children: ReactNode;
  variant?: 'default' | 'compact';
  className?: string;
}

export function GlassPanel({ children, variant = 'default', className }: GlassPanelProps) {
  return (
    <div className={cn('lupine-glass-panel', variant === 'compact' && 'lupine-glass-panel--compact', className)}>
      {children}
    </div>
  );
}

export type OverlayPosition = 'bottom' | 'top-right' | 'top-left' | 'center';

export interface OverlayProps {
  children: ReactNode;
  position: OverlayPosition;
  className?: string;
  style?: CSSProperties;
}

export function Overlay({ children, position, className, style }: OverlayProps) {
  return (
    <div
      className={cn('lupine-overlay', `lupine-overlay--${position}`, className)}
      style={style}
    >
      {children}
    </div>
  );
}

export interface FlexRowProps {
  children: ReactNode;
  gap?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function FlexRow({ children, gap, className, style }: FlexRowProps) {
  return (
    <div
      className={cn('lupine-flex-row', className)}
      style={{ gap, ...style }}
    >
      {children}
    </div>
  );
}

export interface FlexColProps {
  children: ReactNode;
  gap?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function FlexCol({ children, gap, className, style }: FlexColProps) {
  return (
    <div
      className={cn('lupine-flex-col', className)}
      style={{ gap, ...style }}
    >
      {children}
    </div>
  );
}

export interface TruncatedProps {
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Truncated({ children, className, title }: TruncatedProps) {
  return (
    <span className={cn('lupine-truncate', className)} title={title}>
      {children}
    </span>
  );
}

export type BadgeTone = 'buffering' | 'warming' | 'warning';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'> {
  children: ReactNode;
  tone: BadgeTone;
  className?: string;
}

export function Badge({ children, tone, className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn('lupine-badge', `lupine-badge--${tone}`, className)}
      data-tone={tone}
      {...rest}
    >
      {children}
    </span>
  );
}

export type RailDirection = 'row' | 'col';

export interface RailProps {
  children: ReactNode;
  direction?: RailDirection;
  className?: string;
  role?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  style?: CSSProperties;
}

export function Rail({ children, direction = 'row', className, role, 'aria-label': ariaLabel, 'data-testid': testId, style }: RailProps) {
  return (
    <div
      className={cn('lupine-rail', `lupine-rail--${direction}`, className)}
      data-direction={direction}
      role={role}
      aria-label={ariaLabel}
      data-testid={testId}
      style={style}
    >
      {children}
    </div>
  );
}

export interface SheetProps {
  children: ReactNode;
  tall?: boolean;
  className?: string;
}

export function Sheet({ children, tall, className }: SheetProps) {
  return <div className={cn('lupine-sheet', tall && 'lupine-sheet--tall', className)}>{children}</div>;
}
