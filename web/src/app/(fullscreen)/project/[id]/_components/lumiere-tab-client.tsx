// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/_components/lumiere-tab-client.tsx).
// Mêmes exports (`LumiereTabClient`, `LumiereSubTab`) et mêmes props. Plan de
// feu et Adressage DMX : la coquille d'arkyo avec « Bientôt disponible ».
import type { ReactNode } from "react";

import { ComingSoonCanvas } from "@/components/coming-soon";
import { EditorShell } from "@/components/editor-shell/editor-shell";

import type { ProjectFicheData } from "../fiche/fiche-client";

export type LumiereSubTab = "plan" | "dmx";

export function LumiereTabClient({
  globalTopbar,
}: {
  projectId: string;
  fiche?: ProjectFicheData;
  globalTopbar: ReactNode;
  subTab: LumiereSubTab;
}) {
  return (
    <EditorShell
      globalTopbar={globalTopbar}
      canvas={<ComingSoonCanvas />}
      globalTopbarHeight={44}
    />
  );
}
