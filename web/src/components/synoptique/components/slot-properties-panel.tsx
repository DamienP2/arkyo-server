// arkyo-server: bouchon phase 4b, remplacé par la copie d'arkyo
// (arkyo:components/synoptique/components/slot-properties-panel.tsx).
// Mêmes props ; rien n'est rendu (aucun slot n'est sélectionnable tant que le
// canvas de l'onglet Rack est un bouchon).
import type { Slot } from "../lib/types";

export function SlotPropertiesPanel(_props: {
  slot: Slot;
  rackId: string;
  allSlots: Slot[];
  onClose: () => void;
  onUpdate: (updated: Slot) => void;
  connectorTypes?: {
    id: string;
    name: string;
    version: string | null;
    iconId: string;
    color: string;
    category: string;
  }[];
  onOpenLabelling?: () => void;
  onRemove?: () => void;
  rackDepthMm?: number | null;
  cableSafetyDepthMm?: number;
}) {
  return null;
}
