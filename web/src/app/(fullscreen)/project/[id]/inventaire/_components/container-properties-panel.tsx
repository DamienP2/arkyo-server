// arkyo-server: bouchon phase 4a (Task 12), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/container-properties-panel.tsx).
// Mêmes props ; rien n'est rendu.
import type { SaveStatus } from "../../_editor/project-contextual-topbar";
import type { InventaireRack } from "../inventaire-client";

export function ContainerPropertiesPanel(_props: {
  rackId: string;
  onClose: () => void;
  onDeleted?: (rackId: string) => void;
  rack?: InventaireRack;
  projectId?: string;
  onPatch?: (data: Record<string, unknown>) => Promise<void> | void;
  notifySave?: (status: SaveStatus) => void;
}) {
  return null;
}
