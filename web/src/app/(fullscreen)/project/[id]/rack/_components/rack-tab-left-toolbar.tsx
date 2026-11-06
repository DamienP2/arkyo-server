// arkyo-server: bouchon phase 4b, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-tab-left-toolbar.tsx).
// Mêmes types et mêmes props ; rien n'est rendu.
import type { ViewId } from "@/components/synoptique/lib/types";

export type RackRenderMode = "standard" | "graphic" | "photo";

export type RackViewPreset =
  | "front"
  | "rear"
  | "interior"
  | "front-rear"
  | "all";

export type RackDisplayScope = "container" | "location";

export function RackTabLeftToolbar(_props: {
  canvasTool?: "select" | "move";
  onCanvasToolChange?: (tool: "select" | "move") => void;
  visibleViews: Set<ViewId>;
  onSelectViewPreset: (preset: RackViewPreset) => void;
  hasRearInterior?: boolean;
  displayScope?: RackDisplayScope;
  onDisplayScopeChange?: (scope: RackDisplayScope) => void;
  locationView?: ViewId;
  onLocationViewChange?: (view: ViewId) => void;
  renderMode?: RackRenderMode;
  onRenderModeChange?: (mode: RackRenderMode) => void;
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitAll?: () => void;
  onCenter?: () => void;
}) {
  return null;
}
