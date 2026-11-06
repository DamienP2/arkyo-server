import { createStore } from "zustand/vanilla";
import type { WorkspaceId } from "./tool-registry";

export interface WorkspaceState {
  workspace: WorkspaceId;
  activeToolId: string | null;
  activeVariantId: string | null;
  hiddenLayers: string[];
  lockedLayers: string[];
  layerColors: Record<string, string>;
  rightPanelTab: "properties" | "layers";
  rightPanelWidth: number;
  slideOver: { id: string; payload?: unknown } | null;
}

export interface WorkspaceActions {
  setWorkspace: (w: WorkspaceId) => void;
  setTool: (toolId: string | null, variantId?: string | null) => void;
  setVariant: (variantId: string | null) => void;
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerLock: (layerId: string) => void;
  setLayerColor: (layerId: string, color: string) => void;
  isolateLayer: (layerId: string, allLayerIds: string[]) => void;
  setRightPanelTab: (tab: "properties" | "layers") => void;
  setRightPanelWidth: (w: number) => void;
  openSlideOver: (id: string, payload?: unknown) => void;
  closeSlideOver: () => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

export interface CreateWorkspaceStoreOptions {
  workspace: WorkspaceId;
  initialRightPanelWidth?: number;
}

export function createWorkspaceStore(opts: CreateWorkspaceStoreOptions) {
  return createStore<WorkspaceStore>((set, get) => ({
    workspace: opts.workspace,
    activeToolId: null,
    activeVariantId: null,
    hiddenLayers: [],
    lockedLayers: [],
    layerColors: {},
    rightPanelTab: "properties",
    rightPanelWidth: opts.initialRightPanelWidth ?? 300,
    slideOver: null,

    setWorkspace: (workspace) =>
      set({ workspace, activeToolId: null, activeVariantId: null, slideOver: null }),
    setTool: (activeToolId, activeVariantId = null) => set({ activeToolId, activeVariantId }),
    setVariant: (activeVariantId) => set({ activeVariantId }),
    toggleLayerVisibility: (id) => {
      const cur = get().hiddenLayers;
      set({ hiddenLayers: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    },
    toggleLayerLock: (id) => {
      const cur = get().lockedLayers;
      set({ lockedLayers: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    },
    setLayerColor: (id, color) => set({ layerColors: { ...get().layerColors, [id]: color } }),
    isolateLayer: (id, allLayerIds) => set({ hiddenLayers: allLayerIds.filter((x) => x !== id) }),
    setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
    setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),
    openSlideOver: (id, payload) => set({ slideOver: { id, payload } }),
    closeSlideOver: () => set({ slideOver: null }),
  }));
}
