// arkyo-server: bouchon phase 4b (Task 6), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/location-placement-canvas.tsx).
// Mêmes exports (`LocationPlacementCanvas`, `LocationCanvasRack`,
// `LocationPlacementCanvasHandle`, `LocationPlacementCanvasProps`), types
// recopiés d'arkyo (:68-120) et mêmes props. « Bientôt disponible » dans le
// canvas ; aucun canvas de contenant n'est enregistré auprès du provider DnD.
import { forwardRef, useImperativeHandle } from "react";

import { ComingSoonCanvas } from "@/components/coming-soon";
import type {
  Equipment,
  PanelItem,
  Rack,
  Slot,
  ViewId,
} from "@/components/synoptique/lib/types";

import type { RackPlacementCanvasHandle } from "./rack-placement-canvas";

type CategoryWithChildren = {
  id: string;
  name: string;
  color: string;
  children: { id: string; name: string; color: string }[];
};

export type LocationCanvasRack = {
  rack: Rack;
  slots: Slot[];
  allEquipment: Equipment[];
  allPanels: PanelItem[];
  rackAccessories: Equipment[];
  categories: CategoryWithChildren[];
  patchPanelDepthMm: number;
  cableSafetyDepthMm: number;
};

export type LocationPlacementCanvasHandle = {
  fitAll: () => void;
  centerContent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export type LocationPlacementCanvasProps = {
  racks: LocationCanvasRack[];
  view: ViewId;
  viewMode: "real" | "schema";
  renderMode?: "standard" | "graphic" | "photo";
  onSlotSelect?: (slot: Slot | null) => void;
  onRackSlotsChange?: (rackId: string, slots: Slot[]) => void;
  onZoomChange?: (zoom: number) => void;
  canvasTool?: "select" | "move";
  onCanvasToolChange?: (tool: "select" | "move") => void;
  registerRackCanvas?: (
    rackId: string,
    handle: RackPlacementCanvasHandle | null,
  ) => void;
  onReorderRacks?: (rackId: string, targetIdx: number) => void;
  className?: string;
};

export const LocationPlacementCanvas = forwardRef<
  LocationPlacementCanvasHandle,
  LocationPlacementCanvasProps
>(function LocationPlacementCanvas(_props, ref) {
  useImperativeHandle(
    ref,
    () => ({ fitAll: () => {}, centerContent: () => {}, zoomIn: () => {}, zoomOut: () => {} }),
    [],
  );
  return <ComingSoonCanvas />;
});
