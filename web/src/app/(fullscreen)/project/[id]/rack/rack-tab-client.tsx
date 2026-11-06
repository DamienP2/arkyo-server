// arkyo-server: bouchon phase 4b, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/rack-tab-client.tsx).
// Mêmes exports que ceux qu'utilise project-editor.tsx (`RackTabClient`,
// `RackTabDndProvider`, `RackTabClientHandle`, `RackCanvasData`,
// `LocationCanvasData`), types recopiés d'arkyo (:74-136) et mêmes props.
// « Bientôt disponible » dans le canvas ; aucun appel à `canvas-data`.
import { forwardRef, useImperativeHandle, type ReactNode } from "react";

import { ComingSoonCanvas } from "@/components/coming-soon";
import type {
  Equipment,
  PanelItem,
  Rack,
  Slot,
  ViewId,
} from "@/components/synoptique/lib/types";

type CategoryWithChildren = {
  id: string;
  name: string;
  color: string;
  children: { id: string; name: string; color: string }[];
};

type ConnectorTypeDef = {
  id: string;
  name: string;
  version: string | null;
  iconId: string;
  color: string;
  category: string;
};

type SignalTypeDef = {
  name: string;
  color: string;
  cablePrefix: string | null;
  cableSuffix: string | null;
  category?: string | null;
  categoryRef?: {
    name: string;
    cablePrefix: string | null;
    cableSuffix: string | null;
  } | null;
};

type SignalCategoryDef = {
  name: string;
  cablePrefix: string | null;
  cableSuffix: string | null;
};

export type RackCanvasData = {
  rack: Rack;
  allEquipment: Equipment[];
  rackAccessories: Equipment[];
  allPanels: PanelItem[];
  categories: CategoryWithChildren[];
  connectorTypes: ConnectorTypeDef[];
  signals: SignalTypeDef[];
  signalCategories: SignalCategoryDef[];
  patchPanelDepthMm: number;
  cableSafetyDepthMm: number;
};

export type LocationCanvasData = {
  locationId: string;
  racks: RackCanvasData[];
};

export type RackTabClientHandle = {
  fitAll: () => void;
  centerContent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export function RackTabDndProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const RackTabClient = forwardRef<
  RackTabClientHandle,
  {
    projectId: string;
    selectedRackId: string | null;
    visibleViews: ViewId[];
    viewMode: "real" | "schema";
    renderMode?: "standard" | "graphic" | "photo";
    onSlotSelect?: (slot: Slot | null) => void;
    onCanvasDataChange?: (data: RackCanvasData | null) => void;
    onZoomChange?: (zoom: number) => void;
    onSlotsChange?: (slots: Slot[]) => void;
    canvasTool?: "select" | "move";
    onCanvasToolChange?: (tool: "select" | "move") => void;
    displayScope?: "container" | "location";
    locationId?: string | null;
    locationRackIds?: string[];
    locationView?: ViewId;
    onLocationDataChange?: (data: LocationCanvasData | null) => void;
    onLocationRackSlotsChange?: (rackId: string, slots: Slot[]) => void;
    onReorderLocationRacks?: (rackId: string, targetIdx: number) => void;
  }
>(function RackTabClient(_props, ref) {
  useImperativeHandle(
    ref,
    () => ({ fitAll: () => {}, centerContent: () => {}, zoomIn: () => {}, zoomOut: () => {} }),
    [],
  );
  return <ComingSoonCanvas />;
});
