// arkyo-server: bouchon phase 6, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/_components/dossier-wizard/dossier-wizard.tsx).
// Mêmes props que `DossierWizard` (appel : project-editor.tsx:791-803). Le
// bouton « Exporter un dossier » de la topbar l'ouvre : la boîte affiche
// « Bientôt disponible » à la place de l'assistant.
import { ComingSoon } from "@/components/coming-soon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import type { ProjectTabId } from "../../_editor/tab-bar";
import type { CartoMap } from "../../cartographie/_components/cartographie-scope";
import type { InventaireRack } from "../../inventaire/inventaire-client";
import type {
  DossierDocId,
  DossierGenerator,
  DossierPreviewData,
  TechnicalPageFormat,
} from "../dossier-generators";

export function DossierWizard({
  open,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  espaceName?: string | null;
  locationLabel?: string | null;
  generators: (
    opts: {
      formats: Partial<Record<DossierDocId, TechnicalPageFormat>>;
      columns: Partial<Record<DossierDocId, string[]>>;
      meta: { projectName: string; location: string | null };
      titles: Partial<Record<DossierDocId, string>>;
    },
    espace: { name?: string | null; logoUrl?: string | null },
  ) => Partial<Record<DossierDocId, DossierGenerator>>;
  sources: Partial<Record<DossierDocId, () => Promise<DossierPreviewData>>>;
  rack?: {
    containers: { id: string; name: string }[];
    locations: { id: string; name: string; rackIds: string[] }[];
  } | null;
  synoptic?: { locations: Array<{ id: string; name: string }> } | null;
  carto?: { maps: CartoMap[]; racks: InventaireRack[] } | null;
  onGoToTabExport?: (tab: ProjectTabId) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Exporter un dossier</DialogTitle>
        <ComingSoon />
      </DialogContent>
    </Dialog>
  );
}
