// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/_components/drawing-tab-client.tsx).
// Mêmes exports (`DrawingTabClient`, `DrawingKind`) et mêmes props. Onglets
// Schémas, Vidéo et Audio : la coquille d'arkyo (topbar globale fournie par
// project-editor.tsx) avec « Bientôt disponible » dans le canvas.
import type { ReactNode } from "react";

import { ComingSoonCanvas } from "@/components/coming-soon";
import { EditorShell } from "@/components/editor-shell/editor-shell";

export type DrawingKind = "SCHEMA" | "CAMERAS" | "LIGHTING" | "AUDIO";

export function DrawingTabClient({
  globalTopbar,
}: {
  projectId: string;
  projectName?: string;
  kind: DrawingKind;
  globalTopbar: ReactNode;
}) {
  return (
    <EditorShell
      globalTopbar={globalTopbar}
      canvas={<ComingSoonCanvas />}
      globalTopbarHeight={44}
    />
  );
}
