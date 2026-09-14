import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import type { Navigate } from '../nav';

/** Unmodified primary-button click: safe to handle in-app (modified clicks open new tabs as usual). */
export function isPlainClick(e: MouseEvent): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; navigate: Navigate };

/** A real link (shareable, middle-clickable) that navigates without a page reload. */
export function Link({ href, navigate, onClick, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (!isPlainClick(e)) return;
        e.preventDefault();
        navigate(href);
      }}
    />
  );
}
