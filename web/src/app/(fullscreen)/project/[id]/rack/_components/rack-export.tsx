// arkyo-server: bouchon phase 4b (Task 7), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-export.tsx).
// Mêmes props ; ouvert par le bouton « Exporter » du panneau droit, il
// affiche « Bientôt disponible ».
import { ComingSoon } from "@/components/coming-soon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ViewId } from "@/components/synoptique/lib/types";

import type { RackRenderMode } from "./rack-tab-left-toolbar";

export function RackExport({
  open,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  containers: { id: string; name: string }[];
  locations: { id: string; name: string; rackIds: string[] }[];
  current:
    | { kind: "rack"; rackId: string }
    | { kind: "location"; locationId: string }
    | null;
  currentViews: ViewId[];
  renderMode: RackRenderMode;
  viewMode: "real" | "schema";
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
