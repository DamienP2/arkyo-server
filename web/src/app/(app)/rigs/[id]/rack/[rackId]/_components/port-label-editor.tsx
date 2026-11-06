// arkyo-server: bouchon phase 4b, remplacé par la copie d'arkyo
// (arkyo:app/(app)/rigs/[id]/rack/[rackId]/_components/port-label-editor.tsx).
// Mêmes props ; rien n'est rendu.
import type { RowLevels, Slot } from "@/components/synoptique/lib/types";

export function PortLabelEditor(_props: {
  slot: Slot;
  onClose: () => void;
  onSave: (
    slotId: string,
    instanceName: string,
    panelLevels: Record<number, RowLevels>,
    close?: boolean,
  ) => void;
}) {
  return null;
}
