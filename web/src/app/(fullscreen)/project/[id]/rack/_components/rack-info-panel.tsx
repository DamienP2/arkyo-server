// arkyo-server: bouchon phase 4b, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-info-panel.tsx).
// Mêmes props ; rien n'est rendu.
import type { InventaireRack } from "../../inventaire/inventaire-client";

export function RackInfoPanel(_props: {
  rack: InventaireRack;
  onClose?: () => void;
  onCleared?: (rackId: string) => void;
}) {
  return null;
}
