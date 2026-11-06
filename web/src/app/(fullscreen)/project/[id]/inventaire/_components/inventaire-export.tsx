// arkyo-server: bouchon phase 4a (Task 12), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/inventaire-export.tsx).
// Mêmes props ; ouvert par le bouton « Exporter » du panneau droit, il
// affiche « Bientôt disponible ».
import { ComingSoon } from "@/components/coming-soon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import type { ProjectFicheData } from "../../fiche/fiche-client";
import type { InventaireRack } from "../inventaire-client";

export function InventaireExport({
  open,
  onOpenChange,
}: {
  projectId: string;
  racks: InventaireRack[];
  fiche: ProjectFicheData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Exporter</DialogTitle>
        <ComingSoon />
      </DialogContent>
    </Dialog>
  );
}
