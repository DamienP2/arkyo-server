// arkyo-server: bouchon phase 4b, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-tab-side-panel.tsx).
// Mêmes exports et mêmes props ; rien n'est rendu.
import type {
  Equipment,
  PanelItem,
  Slot,
} from "@/components/synoptique/lib/types";

export function RackTabSidePanel(_props: {
  projectId: string;
  selectedRackId: string | null;
  selectedRackSlots: Slot[];
  equipmentMap: Map<string, Equipment>;
  panelMap: Map<string, PanelItem>;
}) {
  return null;
}

export function RackTabLocationSidePanel(_props: {
  projectId: string;
  racks: { id: string; name: string; slots: Slot[] }[];
  equipmentMap: Map<string, Equipment>;
  panelMap: Map<string, PanelItem>;
}) {
  return null;
}
