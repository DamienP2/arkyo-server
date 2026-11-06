// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/reseau/_components/reseau-tab-client.tsx).
// Mêmes props ; « Bientôt disponible » dans le canvas.
import { ComingSoonCanvas } from "@/components/coming-soon";

import type { ProjectStatus } from "../../_editor/project-header-block";
import type { ProjectFicheData } from "../../fiche/fiche-client";

export function ReseauTabClient(_props: {
  projectId: string;
  fiche?: ProjectFicheData;
  status?: ProjectStatus;
  onStatusChange?: (status: ProjectStatus) => void | Promise<void>;
}) {
  return <ComingSoonCanvas />;
}
