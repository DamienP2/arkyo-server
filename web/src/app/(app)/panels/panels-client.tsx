// arkyo-server: remplacé par la copie d'arkyo en Task 10
// (arkyo:app/(app)/panels/panels-client.tsx). En attendant : même export,
// mêmes props (types `PanelSlot` / `Panel` d'arkyo), et `<ComingSoon />`.

import { ComingSoon } from "@/components/coming-soon";

type PanelSlot = {
  id: string;
  position: number;
  connectorTypeId: string | null;
  connectorType: {
    id: string;
    name: string;
    version: string | null;
    color: string;
    category: string;
  } | null;
};

type Panel = {
  id: string;
  name: string;
  heightU: number;
  slotsPerU: number;
  notes: string | null;
  slots: PanelSlot[];
  createdBy: { name: string | null };
};

export function PanelsClient(_props: { initialPanels: Panel[] }) {
  return <ComingSoon />;
}
