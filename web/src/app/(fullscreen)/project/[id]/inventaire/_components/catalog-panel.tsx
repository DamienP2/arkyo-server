// arkyo-server: bouchon tâche 11, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/catalog-panel.tsx).
// Exports lus par l'inventaire : `CatalogPanel` (panneau latéral, « Bientôt
// disponible »), `CatalogDragPreview` et le type `CatalogDragData` (recopiés
// d'arkyo :136-189 et :1472-1490), que le scope lit au dépôt d'un item.
import { GripVertical } from "@/components/ui/icons";

import { ComingSoonCanvas } from "@/components/coming-soon";

export type CatalogKind = "equipment" | "panel" | "adapter" | "accessory";

type Tab = "equipment" | "panel" | "adapter" | "accessory";

export type AccessoryType = "plaque" | "etagere" | "tiroir";
export type AccessoryHeightU = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type AccessoryVariant = "plein" | "pass-cable" | "aere";

/**
 * Payload sérialisable transporté via `active.data.current` lors d'un drag.
 * Inclut les infos minimales pour rendre une preview dans le DragOverlay du
 * BomDetailView, sans avoir à re-fetcher.
 *
 * Pour les accessoires, on ne porte pas un `refId` (pas d'entité catalogue
 * dédiée) mais directement les attributs accessoire.
 */
export type CatalogDragData =
  | {
      kind: "equipment" | "panel" | "adapter";
      refId: string;
      name: string;
      dotHex: string;
      metaSummary: string; // short text shown in DragOverlay preview
      /** Attributs physiques pour les checks (rackable, U dispo, profondeur). */
      isRackable?: boolean;
      heightU?: number | null;
      depthMm?: number | null;
      weightKg?: number | null;
      powerW?: number | null;
      /** Équipement « composant » — seul type installable dans un slot d'hôte. */
      isComponent?: boolean;
      /** Équipement « hôte » (châssis modulaire) — déclenche le flux « nouvel exemplaire ». */
      isComponentHost?: boolean;
    }
  | {
      kind: "accessory";
      accessoryType: AccessoryType;
      accessoryHeightU: AccessoryHeightU;
      accessoryVariant?: AccessoryVariant;
      /** Profondeur en mm — étagère/tiroir uniquement. */
      accessoryDepthMm?: number;
      name: string;
      dotHex: string;
      metaSummary: string;
      /** Pour cohérence avec equipment, accessoires sont rackable, sans poids. */
      isRackable?: boolean;
      heightU?: number | null;
      depthMm?: number | null;
      weightKg?: number | null;
      powerW?: number | null;
    };

export function CatalogPanel(_props: {
  /** `null` en mode rack template (catalogue récupéré depuis l'URL tenant globale). */
  projectId: string | null;
  forceTab?: Tab;
}) {
  return <ComingSoonCanvas />;
}

/**
 * Preview rendu dans le `<DragOverlay>` du parent — visuellement aligné sur
 * la `CardDraggable` mais sans handlers DnD (statique, suit le curseur).
 */
export function CatalogDragPreview({ data }: { data: CatalogDragData }) {
  return (
    <div className="pointer-events-none flex w-72 items-center gap-2 rounded-md border border-[var(--accent)]/50 bg-[var(--card)] shadow-lg ring-2 ring-[var(--accent)]/30 select-none">
      <div className="flex w-7 shrink-0 items-center justify-center self-stretch rounded-l-md">
        <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: data.dotHex }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-tight font-medium">{data.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">
            {data.metaSummary}
          </p>
        </div>
      </div>
    </div>
  );
}
