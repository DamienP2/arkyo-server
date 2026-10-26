/**
 * Shim de `next/link` sur le `<Link>` de `react-router`.
 *
 * Props reprises : `href` (chaîne ou objet `{ pathname, query, hash }`),
 * `replace`, `scroll` (`false` → pas de remise en haut de page) ; `prefetch`
 * est ignoré. Les autres props sont passées au `<a>`.
 */

import type { AnchorHTMLAttributes, Ref } from "react";
import { Link as RouterLink } from "react-router";

type UrlObject = {
  pathname?: string | null;
  query?: Record<string, string | number | boolean | null | undefined | readonly string[]> | string | null;
  hash?: string | null;
};

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | UrlObject;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | "auto" | null;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
  ref?: Ref<HTMLAnchorElement>;
};

export function formatHref(href: string | UrlObject): string {
  if (typeof href === "string") return href;
  let out = href.pathname ?? "";
  if (href.query) {
    let qs: string;
    if (typeof href.query === "string") {
      qs = href.query.replace(/^\?/, "");
    } else {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(href.query)) {
        if (v === null || v === undefined) continue;
        if (Array.isArray(v)) for (const item of v) sp.append(k, String(item));
        else sp.append(k, String(v));
      }
      qs = sp.toString();
    }
    if (qs) out += `?${qs}`;
  }
  if (href.hash) out += href.hash.startsWith("#") ? href.hash : `#${href.hash}`;
  return out;
}

export default function Link({
  href,
  replace,
  scroll,
  prefetch: _prefetch,
  shallow: _shallow,
  passHref: _passHref,
  legacyBehavior: _legacyBehavior,
  locale: _locale,
  ref,
  ...rest
}: LinkProps) {
  return (
    <RouterLink
      ref={ref}
      to={formatHref(href)}
      replace={replace}
      preventScrollReset={scroll === false}
      {...rest}
    />
  );
}
