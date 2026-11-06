// arkyo-server: bouchon tâche 12, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/container-sheet-card.tsx).
// Mêmes props. Carte réduite : liseré de la couleur du type de contenant, nom,
// clic sur l'en-tête pour sélectionner, `data-rack-id` (cible de dépôt du
// scope) et la liste du bouchon `BomList`. Repli, totaux, affectation et
// suppression arrivent avec la copie.
import { cn } from "@/lib/utils";

import { BomList, RACK_TYPE_COLOR, type RackCardData } from "./rack-card-canvas";
import type { InventaireLocation } from "../inventaire-client";

export function ContainerSheetCard({
  rack,
  selected,
  isOver,
  flash,
  onSelect,
}: {
  rack: RackCardData;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selected?: boolean;
  isOver?: boolean;
  flash?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
  assignableLocations?: InventaireLocation[];
  onAssign?: (locationId: string) => void;
  assignVariant?: "assign" | "move";
}) {
  return (
    <div
      data-rack-id={rack.id}
      className={cn(
        "overflow-hidden rounded-xl border bg-[var(--card)] transition-colors",
        isOver
          ? "border-[var(--accent)]/60"
          : selected
            ? "border-[var(--accent)]/40"
            : "border-[var(--border)]",
        flash && "ring-2 ring-[var(--accent)]",
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: RACK_TYPE_COLOR[rack.rackType] }}
    >
      <div
        onClick={() => onSelect?.()}
        className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--border)]/50 bg-[var(--secondary)]/30 px-3 py-2 select-none"
      >
        <span className="truncate text-[13px] font-bold uppercase">{rack.name}</span>
      </div>
      <div className="px-2 pt-1 pb-3">
        <BomList rackId={rack.id} bom={rack.bom ?? []} slotVariant="ruler" />
      </div>
    </div>
  );
}
