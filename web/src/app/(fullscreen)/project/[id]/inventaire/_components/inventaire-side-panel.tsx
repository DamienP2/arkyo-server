"use client";

/**
 * InventaireSidePanel — panel gauche dynamique du canvas Inventaire.
 *
 * Layout aligné sur le pattern rack-editor (cf. `slide-over-panel.tsx`,
 * `right-panel.tsx`) :
 *  - Header `border-b` avec titre `text-sm font-semibold`
 *  - Sous-titre discret optionnel (description du tool)
 *  - Contenu `flex-1 overflow-auto`
 *
 * Routage :
 *  - `equipment` / `adapter` / `panel` / `accessory` → `CatalogPanel`
 *    (items draggables vers les cards via DnDContext partagé)
 *
 * Pas de bouton « Ajouter un panel » : la création de modèles de panel se
 * fait via la galerie `/panels` (admin tenant). L'inventaire ne fait que
 * consommer les modèles existants pour les glisser dans les contenants.
 */

import { CatalogPanel } from "./catalog-panel";
import type { InventaireToolId } from "./inventaire-left-toolbar";

type CatalogTab = "equipment" | "panel" | "adapter" | "accessory";

const TOOL_TO_TAB: Record<InventaireToolId, CatalogTab> = {
  equipment: "equipment",
  panel: "panel",
  adapter: "adapter",
  accessory: "accessory",
};

const TOOL_LABEL: Record<InventaireToolId, string> = {
  equipment: "Équipements",
  panel: "Panels",
  adapter: "Adaptateurs",
  accessory: "Accessoires",
};

const TOOL_HINT: Record<InventaireToolId, string> = {
  equipment: "Glissez un équipement vers un contenant.",
  panel: "Glissez un panel vers un contenant.",
  adapter: "Glissez un adaptateur vers un contenant.",
  accessory: "Composez, puis glissez l'aperçu.",
};

export function InventaireSidePanel({
  activeTool,
  projectId,
}: {
  activeTool: InventaireToolId;
  /** `null` en mode rack template (catalogue récupéré depuis l'URL tenant globale). */
  projectId: string | null;
}) {
  return (
    <SidePanelLayout title={TOOL_LABEL[activeTool]} hint={TOOL_HINT[activeTool]}>
      <CatalogPanel projectId={projectId} forceTab={TOOL_TO_TAB[activeTool]} />
    </SidePanelLayout>
  );
}

// ── Layout commun ────────────────────────────────────────────────────────────

function SidePanelLayout({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex-none border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold leading-none">{title}</h3>
        {hint && (
          <p className="mt-1 text-[11px] leading-snug text-[var(--muted-foreground)]">
            {hint}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
