// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/cartographie/_components/cartographie-scope.tsx).
// Mêmes exports que ceux qu'utilise project-editor.tsx (`CartographieScope`,
// `useCartographieScope`, `CartoMap`), avec le sous-ensemble du contexte qu'il
// lit (`maps`, `activeTool`, zoom). La route `editor` renvoie `maps = []` :
// la coquille montre alors le canvas seul, comme un projet sans plan.
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { SaveStatus } from "../../_editor/project-contextual-topbar";
import type { InventaireRack } from "../../inventaire/inventaire-client";

export type CartoTool =
  | "select"
  | "pan"
  | "move"
  | "place"
  | "cable"
  | "measure"
  | "text"
  | "erase"
  | "calibrate";

export type CartoZoomHandlers = {
  zoomIn: () => void;
  zoomOut: () => void;
  fitAll: () => void;
  center: () => void;
};

const NOOP_ZOOM_HANDLERS: CartoZoomHandlers = {
  zoomIn: () => {},
  zoomOut: () => {},
  fitAll: () => {},
  center: () => {},
};

/** Plan du projet (arkyo:…/cartographie-scope.tsx:236-247), contenu typé en phase 5. */
export type CartoMap = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  floors: unknown[];
  placements: unknown[];
  cablePaths: unknown[];
  textLabels: unknown[];
  connectionPoints: unknown[];
  connectionPointLinks: unknown[];
};

export type CartographieScopeValue = {
  projectId: string;
  maps: CartoMap[];
  activeTool: CartoTool;
  setActiveTool: (t: CartoTool) => void;
  zoom: number;
  zoomHandlers: CartoZoomHandlers;
  isSpaceHeld: boolean;
};

const CartographieScopeContext = createContext<CartographieScopeValue | null>(null);

export function useCartographieScope(): CartographieScopeValue {
  const ctx = useContext(CartographieScopeContext);
  if (!ctx) {
    throw new Error("useCartographieScope must be used within <CartographieScope>");
  }
  return ctx;
}

export function CartographieScope({
  projectId,
  initialMaps,
  children,
}: {
  projectId: string;
  initialMaps: CartoMap[];
  racks: InventaireRack[];
  notifySave?: (status: SaveStatus) => void;
  headless?: boolean;
  children: ReactNode;
}) {
  const [activeTool, setActiveTool] = useState<CartoTool>("select");
  const value = useMemo<CartographieScopeValue>(
    () => ({
      projectId,
      maps: initialMaps,
      activeTool,
      setActiveTool,
      zoom: 1,
      zoomHandlers: NOOP_ZOOM_HANDLERS,
      isSpaceHeld: false,
    }),
    [projectId, initialMaps, activeTool],
  );
  return (
    <CartographieScopeContext.Provider value={value}>
      {children}
    </CartographieScopeContext.Provider>
  );
}
