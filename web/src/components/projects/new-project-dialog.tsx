// arkyo-server: remplacé par la copie d'arkyo en Task 8
// (arkyo:components/projects/new-project-dialog.tsx). En attendant : mêmes
// exports et mêmes props, et `<ComingSoon />` dans la modale partagée.

import { ComingSoon } from "@/components/coming-soon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export type InterventionType = "PRESTATION" | "INTEGRATION";

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  interventionType: InterventionType;
  knownClients?: string[];
  /**
   * Liste des noms de projets déjà utilisés dans le tenant (toutes interventions
   * confondues). Sert à la validation d'unicité à l'étape 3, insensible à la
   * casse et aux espaces de bord.
   */
  existingNames?: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="sr-only">Nouveau projet</DialogTitle>
        <ComingSoon />
      </DialogContent>
    </Dialog>
  );
}
