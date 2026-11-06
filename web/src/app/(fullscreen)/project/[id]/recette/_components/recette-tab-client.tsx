// arkyo-server: bouchon phase 6, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/recette/_components/recette-tab-client.tsx).
// Onglet Livraison > Recette : mêmes props, « Bientôt disponible » dans le canvas.
import { ComingSoonCanvas } from "@/components/coming-soon";

export function RecetteTabClient(_props: {
  projectId: string;
  projectName?: string;
  location?: string | null;
}) {
  return <ComingSoonCanvas />;
}
