"use client";

/**
 * Section VUES de la colonne de réglages du composeur de planche.
 *
 * Extraite parce qu'elle a DEUX consommateurs qui doivent offrir exactement la
 * même chose : l'export de l'onglet Rack, et la planche d'élévations du dossier.
 * La première version du sur-modal du dossier n'embarquait que la scène — on
 * pouvait déplacer un objet, mais ni en ajouter, ni changer sa cible, ni ses
 * vues. Un panneau jumeau aurait divergé au premier ajout de réglage ; c'est
 * donc le même composant des deux côtés.
 *
 * Ce qui NE figure pas ici : le papier et son habillage (section DOCUMENT). Le
 * dossier les impose, l'onglet les propose — c'est la seule différence légitime
 * entre les deux, et elle porte sur la feuille, pas sur son contenu.
 */

import { Plus } from "@/components/ui/icons";

import type {
  RackExportComposerActions,
  RackExportContainer,
  RackExportLocation,
} from "./rack-export-composer";
import type { RackExportItem, RackExportLayout } from "./rack-export-layout";
import {
  RackExportObjectPanel,
  RackExportSelectionActions,
  type ObjectPatch,
} from "./rack-export-object-panel";
import type { RackRenderMode } from "./rack-export-stage";

/**
 * Applique un réglage à un objet de la composition.
 *
 * Une cible vide ramène l'objet à l'état d'emplacement — c'est ce qui le tient
 * hors de l'export tant qu'il n'est pas configuré, sans avoir à inventer un
 * drapeau « incomplet ».
 *
 * Fonction pure : les deux consommateurs persistent la composition différemment
 * (réglages de l'onglet, état du dossier), seule la transformation est commune.
 */
export function applyObjectPatch(
  layout: RackExportLayout,
  itemId: string,
  patch: ObjectPatch,
): RackExportLayout {
  return {
    ...layout,
    items: layout.items.map((i): RackExportItem => {
      if (i.id !== itemId) return i;
      if ("renderMode" in patch) return { ...i, renderMode: patch.renderMode };
      // Libellé vidé → champ retiré, l'entête automatique reprend la main.
      if ("label" in patch) {
        const label = patch.label.trim();
        return { ...i, label: label || undefined };
      }
      const base = {
        id: i.id,
        x: i.x,
        y: i.y,
        w: i.w,
        renderMode: i.renderMode,
        label: i.label,
      };
      if (patch.kind === "rack") {
        return patch.rackId
          ? { ...base, kind: "rack", rackId: patch.rackId, views: patch.views }
          : { ...base, kind: "placeholder" };
      }
      return patch.locationId
        ? {
            ...base,
            kind: "location",
            locationId: patch.locationId,
            view: patch.view,
          }
        : { ...base, kind: "placeholder" };
    }),
  };
}

export function RackExportViewsPanel({
  layout,
  onLayoutChange,
  selectedIds,
  containers,
  locations,
  fallbackRenderMode,
  actions,
}: {
  layout: RackExportLayout;
  onLayoutChange: (next: RackExportLayout) => void;
  selectedIds: string[];
  containers: RackExportContainer[];
  locations: RackExportLocation[];
  /** Mode de rendu qu'affiche une vue sans mode propre. */
  fallbackRenderMode: RackRenderMode;
  /**
   * Actions du composeur, lues au moment du clic. Une boîte mutable et non des
   * fonctions : le composeur les publie dans un effet, en faire un state
   * relancerait son rendu à chaque montage.
   */
  actions: { readonly current: RackExportComposerActions | null };
}) {
  const selectedItem =
    selectedIds.length === 1
      ? (layout.items.find((i) => i.id === selectedIds[0]) ?? null)
      : null;

  return (
    <section className="space-y-3">
      <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
        Vues
      </p>
      <button
        type="button"
        onClick={() => actions.current?.addPlaceholder()}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-[var(--border)] px-2 text-[11px] font-semibold text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        Ajouter une vue
      </button>

      {selectedIds.length > 0 && (
        <div className="border-border/60 space-y-3 rounded-md border p-2">
          {selectedItem ? (
            <RackExportObjectPanel
              item={selectedItem}
              containers={containers}
              locations={locations}
              fallbackRenderMode={fallbackRenderMode}
              onChange={(patch) =>
                onLayoutChange(applyObjectPatch(layout, selectedItem.id, patch))
              }
            />
          ) : (
            <p className="text-[11px] font-medium">
              {selectedIds.length} vues sélectionnées
            </p>
          )}
          <RackExportSelectionActions
            onDuplicate={() => actions.current?.duplicateSelection()}
            onCenter={() => actions.current?.centerSelection()}
            onReset={
              selectedIds.length === 1
                ? () => actions.current?.resetSize()
                : null
            }
            onRemove={() => actions.current?.removeSelection()}
          />
        </div>
      )}
    </section>
  );
}
