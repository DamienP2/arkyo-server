// arkyo-server: bouchon phase 4c, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/synoptique/synoptique-tab-client.tsx).
// Mêmes props. Comme l'original, l'onglet monte sa propre coquille (workspace
// `synoptic`) sous la topbar globale fournie par project-editor.tsx, avec
// « Bientôt disponible » dans le canvas.
import type { ReactNode } from "react";

import { ComingSoonCanvas } from "@/components/coming-soon";
import { EditorShell } from "@/components/editor-shell/editor-shell";
import { WorkspaceProvider } from "@/components/editor-shell/workspace-context";

import {
  ProjectContextualTopbar,
  type SaveStatus,
} from "../_editor/project-contextual-topbar";
import type {
  InventaireLocation,
  InventaireRack,
} from "../inventaire/inventaire-client";

export function SynoptiqueTabClient({
  globalTopbar,
  saveStatus = "idle",
}: {
  projectId: string;
  projectName: string;
  racks: InventaireRack[];
  locations?: InventaireLocation[];
  globalTopbar: ReactNode;
  saveStatus?: SaveStatus;
}) {
  return (
    <WorkspaceProvider workspace="synoptic">
      <EditorShell
        globalTopbar={globalTopbar}
        contextualTopbar={<ProjectContextualTopbar saveStatus={saveStatus} />}
        canvas={<ComingSoonCanvas />}
        globalTopbarHeight={44}
      />
    </WorkspaceProvider>
  );
}
