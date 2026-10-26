/**
 * Titre d'onglet, comme le `metadata.title` d'arkyo:app/layout.tsx :
 * `arkyo.io` par défaut, `arkyo.io | <page>` quand la page a un titre.
 */

import { useEffect } from "react";

export const DEFAULT_TITLE = "arkyo.io";

export function pageTitle(title?: string | null): string {
  return title ? `${DEFAULT_TITLE} | ${title}` : DEFAULT_TITLE;
}

export function usePageTitle(title?: string | null): void {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
