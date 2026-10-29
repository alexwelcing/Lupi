/**
 * App Shell primitives — thin React wrappers over the CSS utility classes
 * in apps/web/src/styles/global.css ("App Shell Primitives").
 *
 * Dynamic values (tone) are passed as data attributes or semantic props so
 * the components stay style-agnostic.
 */

import type { HTMLAttributes, ReactNode } from 'react';

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

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
