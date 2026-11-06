// arkyo-server: bouchon phase 6, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/cablage/_components/cablage-tab-client.tsx).
// Onglet Livraison > Préparation : mêmes props, « Bientôt disponible » dans le canvas.
import { ComingSoonCanvas } from "@/components/coming-soon";

import type { ProjectFicheData } from "../../fiche/fiche-client";

export function CablageTabClient(_props: {
  projectId: string;
  fiche?: ProjectFicheData;
}) {
  return <ComingSoonCanvas />;
}
