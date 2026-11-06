// arkyo-server: bouchon tâche 11, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/add-container-wizard.tsx).
// Mêmes props ; ouvert par « Ajouter un contenant », il affiche « Bientôt
// disponible ».
import { ComingSoon } from "@/components/coming-soon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import type { InventaireRack } from "../inventaire-client";

export function AddContainerWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  onCreated: (rack: InventaireRack) => void;
  /** Emplacement pré-sélectionné (celui de la fiche courante). */
  defaultLocationId?: string | null;
  existingNames?: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Ajouter un contenant</DialogTitle>
        <ComingSoon />
      </DialogContent>
    </Dialog>
  );
}
