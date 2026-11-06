// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/cartographie/_components/cartographie-left-toolbar.tsx).
// Mêmes exports et mêmes props ; rien n'est rendu (la coquille masque la barre
// d'outils tant que le projet n'a pas de plan).
export type CartoToolId =
  | "select"
  | "pan"
  | "move"
  | "place"
  | "cable"
  | "measure"
  | "text"
  | "erase"
  | "calibrate";

export function CartographieLeftToolbar(_props: {
  activeTool: CartoToolId;
  onToolChange: (tool: CartoToolId) => void;
  isSpaceHeld?: boolean;
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitAll?: () => void;
  onCenter?: () => void;
}) {
  return null;
}
