// arkyo-server: bouchon phase 6, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/recette/_components/recette-topbar-host.tsx).
// Mêmes props ; la sous-topbar standard du projet, sans outil.
import {
  ProjectContextualTopbar,
  type SaveStatus,
} from "../../_editor/project-contextual-topbar";

export function RecetteTopbarHost({ saveStatus }: { saveStatus: SaveStatus }) {
  return <ProjectContextualTopbar saveStatus={saveStatus} />;
}
