// arkyo-server: bouchon phase 4b (Task 8), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-export-composer.tsx).
// Mêmes exports que l'original, pour `rack-export.tsx` et
// `rack-export-capture.ts` (Task 7). Les sélecteurs, `standardComposerZone` et
// les types sont repris tels quels d'arkyo. Le composant ne pose aucun objet :
// il montre la feuille blanche (`[data-rack-page]`) et le cartouche par-dessus,
// avec « Bientôt disponible » en ornement d'édition (masqué à la capture).
import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { standardCartoucheContentZone } from "@/lib/print/technical-frame";
import type { ViewId } from "@/components/synoptique/lib/types";
import type { Orientation, PaperFormat } from "@/lib/services/print-layout";

import { pageSizeMm, type Rect, type RackExportLayout } from "./rack-export-layout";
import type { RackRenderMode } from "./rack-export-stage";

/** Pixels d'affichage par millimètre de feuille, à zoom 1. */
const MM_PX = 4;

/** Sélecteur de la page composée — cible de la capture « Image ». */
export const RACK_COMPOSER_PAGE_SELECTOR = "[data-rack-page]";
/** Ornements d'édition (ring, poignées, guides) à masquer pendant une capture. */
export const RACK_COMPOSER_CHROME_SELECTOR = "[data-composer-chrome]";
/** Sélecteur d'un objet à taille naturelle, par identifiant. */
export function rackViewCaptureSelector(itemId: string): string {
  return `[data-rack-view-capture="${itemId}"]`;
}

/**
 * Zone de composition du cartouche INTÉGRÉ, retrait de confort compris : les
 * objets ne viennent pas lécher les filets.
 */
export function standardComposerZone(page: { w: number; h: number }): Rect {
  const z = standardCartoucheContentZone(page.w, page.h);
  const inset = 4;
  return {
    x: z.x + inset,
    y: z.y + inset,
    w: z.w - inset * 2,
    h: z.h - inset * 2,
  };
}

export type RackExportComposerActions = {
  addPlaceholder: () => void;
  duplicateSelection: () => void;
  removeSelection: () => void;
  /** Rend à la sélection sa taille d'origine. Sélection unique uniquement. */
  resetSize: () => void;
  /** Centre la sélection — sa boîte englobante — dans la zone de composition. */
  centerSelection: () => void;
};

export type RackExportContainer = { id: string; name: string };
export type RackExportLocation = {
  id: string;
  name: string;
  /** Contenants rackables du lieu, dans l'ordre de l'inventaire. */
  rackIds: string[];
};

export function RackExportComposer({
  paperFormat,
  orientation,
  cartoucheUrl,
  cartoucheError,
}: {
  projectId: string;
  containers: RackExportContainer[];
  locations: RackExportLocation[];
  layout: RackExportLayout;
  onLayoutChange: (next: RackExportLayout) => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onActionsReady?: (actions: RackExportComposerActions | null) => void;
  seed?:
    | { kind: "rack"; rackId: string; views: ViewId[] }
    | { kind: "location"; locationId: string; view: ViewId }
    | null;
  paperFormat: PaperFormat;
  orientation: Orientation;
  cartoucheUrl: string | null;
  cartoucheError?: string | null;
  contentZone?: Rect | null;
  renderMode: RackRenderMode;
  showInfo: boolean;
}): ReactNode {
  const page = pageSizeMm(paperFormat, orientation);
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-auto p-4">
      <div
        data-rack-page=""
        className="relative mx-auto"
        style={{
          width: page.w * MM_PX,
          height: page.h * MM_PX,
          background: "#ffffff",
          overflow: "hidden",
        }}
      >
        {cartoucheUrl && (
          <img
            src={cartoucheUrl}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        )}
        <div
          data-composer-chrome=""
          className="absolute inset-0 flex items-center justify-center"
        >
          {/* `EmptyState` de `ComingSoon`, sans `usePageTitle` : le titre
              d'onglet reste celui du projet. */}
          <EmptyState title="Bientôt disponible" />
        </div>
      </div>
      {cartoucheError && (
        <p className="mt-2 text-center text-xs text-[var(--danger-text)]">
          {cartoucheError}
        </p>
      )}
    </div>
  );
}
