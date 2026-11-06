// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/reseau/_components/reseau-topbar-host.tsx).
// Mêmes props ; la sous-topbar standard du projet, sans outil.
import {
  ProjectContextualTopbar,
  type SaveStatus,
} from "../../_editor/project-contextual-topbar";

export function ReseauTopbarHost({
  saveStatus,
}: {
  saveStatus: SaveStatus;
  projectId: string;
}) {
  return <ProjectContextualTopbar saveStatus={saveStatus} />;
}
