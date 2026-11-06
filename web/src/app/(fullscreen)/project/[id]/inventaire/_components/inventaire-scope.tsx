// arkyo-server: bouchon phase 4a (Task 10), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/inventaire-scope.tsx).
// Mêmes props que `InventaireScope` et sous-ensemble du contexte que lit
// project-editor.tsx (`InventaireRightPanel`, :1602-1610) : contenants et
// emplacements de la route `editor`, sans sélection.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { SaveStatus } from "../../_editor/project-contextual-topbar";
import type {
  InventaireLocation,
  InventaireRack,
} from "../inventaire-client";

/**
 * Pseudo-id du lieu « À affecter » (contenants sans emplacement).
 */
export const UNASSIGNED_LOCATION_ID = "__unassigned__";

export type InventaireScopeValue = {
  projectId: string | null;
  racks: InventaireRack[];
  locations: InventaireLocation[];
  selectedLocationId: string | null;
  expandedRackId: string | null;
  setExpandedRackId: (id: string | null) => void;
  selectedItem: { rackId: string; itemId: string } | null;
  selectItem: (sel: { rackId: string; itemId: string } | null) => void;
};

const InventaireScopeContext = createContext<InventaireScopeValue | null>(null);

export function useInventaireScope(): InventaireScopeValue {
  const ctx = useContext(InventaireScopeContext);
  if (!ctx) {
    throw new Error("useInventaireScope must be used within <InventaireScope>");
  }
  return ctx;
}

export function InventaireScope({
  projectId,
  initialRacks,
  initialLocations,
  children,
}: {
  projectId: string | null;
  initialRacks: InventaireRack[];
  initialLocations?: InventaireLocation[];
  notifySave?: (status: SaveStatus) => void;
  children: ReactNode;
}) {
  const [expandedRackId, setExpandedRackId] = useState<string | null>(null);
  const [selectedItem, selectItem] = useState<{ rackId: string; itemId: string } | null>(null);
  const value = useMemo<InventaireScopeValue>(
    () => ({
      projectId,
      racks: initialRacks,
      locations: initialLocations ?? [],
      selectedLocationId: null,
      expandedRackId,
      setExpandedRackId,
      selectedItem,
      selectItem,
    }),
    [projectId, initialRacks, initialLocations, expandedRackId, selectedItem],
  );
  return (
    <InventaireScopeContext.Provider value={value}>
      {children}
    </InventaireScopeContext.Provider>
  );
}
