// arkyo-server: bouchon phase 4b (Task 5), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas.tsx).
// Mêmes exports (`RackPlacementCanvas`, `RackPlacementCanvasHandle`,
// `RackPlacementCanvasProps`, `RackDragOverlayContent`), types recopiés
// d'arkyo (:118-245) et mêmes props. « Bientôt disponible » dans le canvas ;
// le handle ne fait rien (aucun slot, aucun drop).
import { forwardRef, useImperativeHandle } from "react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";

import { ComingSoonCanvas } from "@/components/coming-soon";
import type {
  ActiveItem,
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

export type RackPlacementCanvasHandle = {
  rackId: string;
  ownsSlot: (slotId: string) => boolean;
  handleDragStart: (e: DragStartEvent) => void;
  handleDragOver: (e: DragOverEvent) => void;
  handleDragEnd: (e: DragEndEvent) => Promise<void>;
  cancelDrag: () => void;
  notifyShelfOnlyMiss: () => boolean;
  clearSelection: () => void;
  fitAll: () => void;
  centerContent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export type RackPlacementCanvasProps = {
  rack: Rack;
  initialSlots: Slot[];
  allEquipment: Equipment[];
  allPanels: PanelItem[];
  rackAccessories: Equipment[];
  categories: CategoryWithChildren[];
  patchPanelDepthMm: number;
  cableSafetyDepthMm: number;
  visibleViews: ViewId[];
  viewMode: "real" | "schema";
  renderMode?: "standard" | "graphic" | "photo";
  onViewsChange?: (views: ViewId[]) => void;
  onSlotSelect?: (slot: Slot | null) => void;
  canvasTool?: "select" | "move";
  onCanvasToolChange?: (tool: "select" | "move") => void;
  onSlotsChange?: (slots: Slot[]) => void;
  onZoomChange?: (zoom: number) => void;
  className?: string;
  embedded?: boolean;
  headerLabel?: string;
  getExternalZoom?: () => number;
  renderDragOverlay?: boolean;
  onActiveItemChange?: (item: ActiveItem | null) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  onDropInvalidChange?: (reason: string | null) => void;
  dropDisabled?: boolean;
};

export function RackDragOverlayContent(_props: {
  active: ActiveItem | null;
  invalidReason?: string | null;
}) {
  return null;
}

export const RackPlacementCanvas = forwardRef<
  RackPlacementCanvasHandle,
  RackPlacementCanvasProps
>(function RackPlacementCanvas({ rack }, ref) {
  useImperativeHandle(
    ref,
    () => ({
      rackId: rack.id,
      ownsSlot: () => false,
      handleDragStart: () => {},
      handleDragOver: () => {},
      handleDragEnd: async () => {},
      cancelDrag: () => {},
      notifyShelfOnlyMiss: () => false,
      clearSelection: () => {},
      fitAll: () => {},
      centerContent: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
    }),
    [rack.id],
  );
  return <ComingSoonCanvas />;
});
