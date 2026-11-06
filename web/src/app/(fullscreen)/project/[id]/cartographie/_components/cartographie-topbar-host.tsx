// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/cartographie/_components/cartographie-topbar-host.tsx).
// Mêmes props ; la sous-topbar standard du projet, sans outil.
import {
  ProjectContextualTopbar,
  type SaveStatus,
} from "../../_editor/project-contextual-topbar";

export function CartographieTopbarHost({
  saveStatus,
}: {
  saveStatus: SaveStatus;
}) {
  return <ProjectContextualTopbar saveStatus={saveStatus} />;
}
