/**
 * Sources de la palette ⌘K (spec v2 §4.4). Une source est une fonction
 * `(q) => PaletteItem[] | Promise<PaletteItem[]>` ; la palette les interroge
 * à l'ouverture (jamais avant) et filtre elle-même les résultats. L'ordre
 * d'enregistrement fixe l'ordre des groupes. Sources : celles du site
 * (`command-palette.tsx` : projets, fiches du catalogue, utilisateurs,
 * actions) et celles du projet ouvert (`project-sources.tsx`).
 */

import type { ReactNode } from "react";

export type PaletteItem = {
  /** Titre du groupe (« Projets », « Actions »…). L'ordre des sources fixe l'ordre des groupes. */
  group: string;
  label: string;
  sub?: string;
  icon?: ReactNode;
  run(): void;
  /**
   * Seconde action de l'objet (« Modifier » une fiche du catalogue) : bouton
   * de la ligne, ou ⌘Entrée / Ctrl+Entrée sur la ligne active.
   */
  secondary?: { label: string; run(): void };
};

export type PaletteSource = (q: string) => PaletteItem[] | Promise<PaletteItem[]>;

const sources = new Map<string, PaletteSource>();

/** Enregistre (ou remplace) une source ; renvoie la fonction qui la retire. */
export function registerPaletteSource(id: string, source: PaletteSource): () => void {
  sources.set(id, source);
  return () => {
    if (sources.get(id) === source) sources.delete(id);
  };
}

export function paletteSources(): PaletteSource[] {
  return [...sources.values()];
}

/** Minuscules sans accents, pour un filtre tolérant. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr-FR");
}

export function matches(item: PaletteItem, q: string): boolean {
  const n = normalize(q.trim());
  if (!n) return true;
  const hay = normalize(`${item.label} ${item.sub ?? ""}`);
  return n.split(/\s+/).every((w) => hay.includes(w));
}

export type Lazy<T> = { get(): Promise<T>; reset(): void };

/** Lecture mise en cache pour une ouverture de la palette (réinitialisée à chaque ouverture). */
export function lazyOnce<T>(load: () => Promise<T>): Lazy<T> {
  let p: Promise<T> | null = null;
  return {
    get: () => (p ??= load()),
    reset: () => {
      p = null;
    },
  };
}
