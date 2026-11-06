"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type SynopticLayerKind = "equipment" | "panel" | "adapter" | "cable" | "zone" | "label" | "external";

export interface SynopticLayerItem {
  id: string;
  kind: SynopticLayerKind;
  name: string;
  color?: string | null;
  signalId?: string | null;
  signalName?: string | null;
  signalCategoryId?: string | null;
  signalCategoryName?: string | null;
  equipmentCategory?: string | null;
}

export interface LabelDefaults {
  color: string;
  fontFamily: string | null;
  fontSize: number;
  fontWeight: "bold" | "normal";
  fontStyle: "italic" | "normal";
  textDecoration: "underline" | "none";
}

export type WidthFractionFilter = "" | "FULL" | "HALF" | "THIRD" | "QUARTER";
export type HeightUFilter = "" | "1" | "2" | "3-4" | "5+";
export type SortBy = "name-asc" | "name-desc";

export interface EquipmentFilters {
  search: string;
  brandId: string; // "" = toutes
  categoryNames: string[]; // noms de catégories parentes actives
  heightU: HeightUFilter;
  widthFraction: WidthFractionFilter;
  sortBy: SortBy;
}

export interface AccessoryDefaults {
  accType: "plaque" | "etagere" | "tiroir";
  heightU: number;
  plaqueStyle: string;
  depthMm: number;
}

export interface AdapterOption {
  id: string;
  name: string;
  reference: string | null;
  imageUrl: string | null;
  inputs: Array<{
    connectorTypeId?: string | null;
    quantity?: number | null;
    label?: string | null;
    gender?: string | null;
  }> | null;
  outputs: Array<{
    connectorTypeId?: string | null;
    quantity?: number | null;
    label?: string | null;
    gender?: string | null;
  }> | null;
}

export interface BrandOption {
  id: string;
  name: string;
}
export interface CategoryOption {
  id: string;
  name: string;
  color: string;
}

export type ViewMode = "real" | "schema";

// Synoptique — options d'outils contextuelles
export type ZoneLabelPos = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type CableStyle = "ortho" | "rounded" | "arrow";
export type CableCount = "single" | "multi";
export type CableMode = "auto" | "multipoint";

export interface SynopticWriters {
  setCableStyle?: (v: CableStyle) => void;
  setCableCount?: (v: CableCount) => void;
  setCableMode?: (v: CableMode) => void;
  setLabelFont?: (v: string) => void;
  setLabelFontSize?: (v: number) => void;
  setLabelColor?: (v: string) => void;
  setZoneColor?: (v: string) => void;
}

export interface NumberingHandlers {
  onRenumberAuto?: () => void;
  onManualNumber?: () => void;
}

export interface UndoRedoHandlers {
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export type WorkspaceKey = "design" | "synoptic";

export interface MiniMapHandlers {
  visible: boolean;
  onToggle?: () => void;
}

interface TopbarActionsState {
  zoom: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomFit?: () => void;
  onZoomReset?: () => void;
  onCenter?: () => void;
  // Mini-map scopée par workspace
  miniMapByWs: Record<WorkspaceKey, MiniMapHandlers>;
  setMiniMap: (ws: WorkspaceKey, h: MiniMapHandlers) => void;
  activeWorkspace: WorkspaceKey;
  setActiveWorkspace: (ws: WorkspaceKey) => void;

  // Vue (visibilité des vues + mode d'affichage)
  visibleViews: string[];
  setVisibleViews: (views: string[]) => void;
  toggleView: (v: string) => void;
  onToggleView?: (v: string) => void;
  setOnToggleView: (fn?: (v: string) => void) => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  onViewModeChange?: (m: ViewMode) => void;
  setOnViewModeChange: (fn?: (m: ViewMode) => void) => void;

  labelDefaults: LabelDefaults;
  setLabelDefaults: (patch: Partial<LabelDefaults>) => void;

  // Filtres équipement (partagés topbar ↔ panel 240px)
  equipmentFilters: EquipmentFilters;
  setEquipmentFilters: (patch: Partial<EquipmentFilters>) => void;
  toggleEquipmentCategory: (name: string) => void;
  resetEquipmentFilters: () => void;

  brandOptions: BrandOption[];
  setBrandOptions: (b: BrandOption[]) => void;
  categoryOptions: CategoryOption[];
  setCategoryOptions: (c: CategoryOption[]) => void;

  // Accessoire (plaque/étagère/tiroir) — defaults partagés topbar ↔ panel
  accessoryDefaults: AccessoryDefaults;
  setAccessoryDefaults: (patch: Partial<AccessoryDefaults>) => void;
  accessoryUHeights: number[];
  accessoryDepths: number[];
  setAccessoryUHeights: (u: number[]) => void;
  setAccessoryDepths: (d: number[]) => void;

  // Synoptique — cable tool
  cableStyle: CableStyle;
  cableCount: CableCount;
  cableMode: CableMode;
  setCableStyle: (v: CableStyle) => void;
  setCableCount: (v: CableCount) => void;
  setCableMode: (v: CableMode) => void;

  // Synoptique — label tool (distinct du labelDefaults Design)
  synopticLabelFont: string;
  synopticLabelFontSize: number;
  synopticLabelColor: string;
  synopticLabelPill: boolean;
  synopticLabelPillBg: string;
  synopticLabelPillRadius: number;
  setSynopticLabelFont: (v: string) => void;
  setSynopticLabelFontSize: (v: number) => void;
  setSynopticLabelColor: (v: string) => void;
  setSynopticLabelPill: (v: boolean) => void;
  setSynopticLabelPillBg: (v: string) => void;
  setSynopticLabelPillRadius: (v: number) => void;

  // Synoptique — zone tool
  zoneColor: string;
  setZoneColor: (v: string) => void;
  zoneLabel: string;
  zoneLabelPosition: ZoneLabelPos;
  setZoneDefaults: (patch: { zoneLabel?: string; zoneLabelPosition?: ZoneLabelPos }) => void;

  // Synoptique — numbering actions
  onRenumberAuto?: () => void;
  onManualNumber?: () => void;
  setNumberingHandlers: (h: NumberingHandlers) => void;

  // Undo/redo scopé par workspace
  historyByWs: Record<WorkspaceKey, UndoRedoHandlers>;
  setHistory: (ws: WorkspaceKey, h: UndoRedoHandlers) => void;

  // Synoptique — adapter tool
  onPickAdapter?: () => void;
  setOnPickAdapter: (fn: (() => void) | undefined) => void;
  availableAdapters: AdapterOption[];
  setAvailableAdapters: (a: AdapterOption[]) => void;
  pickingAdapterId: string | null;
  setPickingAdapterId: (id: string | null) => void;
  pendingAdapterPort: {
    slotId: string;
    portIndex: number;
    connectorTypeId: string | null;
    side: "left" | "right" | null;
  } | null;
  setPendingAdapterPort: (
    p: {
      slotId: string;
      portIndex: number;
      connectorTypeId: string | null;
      side: "left" | "right" | null;
    } | null,
  ) => void;
  onInsertAdapterAtPort?: (
    adapterId: string,
    port: { slotId: string; portIndex: number; side: "left" | "right" | null },
  ) => void;
  setOnInsertAdapterAtPort: (
    fn:
      | ((
          adapterId: string,
          port: { slotId: string; portIndex: number; side: "left" | "right" | null },
        ) => void)
      | undefined,
  ) => void;

  // Synoptique — erase tool (bulk actions)
  onSynopticClearLabels?: () => void;
  onSynopticDecable?: () => void;
  setSynopticEraseHandlers: (h: { onClearLabels?: () => void; onDecable?: () => void }) => void;

  // Synoptique — pont vers synoptic-view (setters internes)
  synopticWriters: SynopticWriters;
  setSynopticWriters: (w: SynopticWriters) => void;

  // Synoptique — grille + snap + règles
  gridEnabled: boolean;
  gridStep: number;
  snapEnabled: boolean;
  rulersEnabled: boolean;
  guidesVisible: boolean;
  guideDefaultColor: string | null; // null = accent
  setGridEnabled: (v: boolean) => void;
  setGridStep: (v: number) => void;
  setSnapEnabled: (v: boolean) => void;
  setRulersEnabled: (v: boolean) => void;
  setGuidesVisible: (v: boolean) => void;
  setGuideDefaultColor: (v: string | null) => void;

  // Calques synoptique
  layerGroupMode: "type" | "category" | "signal";
  hiddenLayerIds: Set<string>;
  lockedLayerIds: Set<string>;
  synopticLayerItems: SynopticLayerItem[];
  // IDs sélectionnés (publié par synoptic-view, consommé par le panneau calques pour highlight)
  selectedSynopticIds: Set<string>;
  setSelectedSynopticIds: (ids: Set<string>) => void;
  // Demande de sélection depuis le panneau calques (consommée puis clearée par synoptic-view)
  pendingLayerSelection: { id: string; kind: SynopticLayerKind } | null;
  requestLayerSelection: (id: string, kind: SynopticLayerKind) => void;
  clearPendingLayerSelection: () => void;
  // Multi-sélection depuis le panneau (shift/ctrl click)
  layerMultiSelectIds: Set<string>;
  setLayerMultiSelectIds: (ids: Set<string>) => void;
  clearLayerMultiSelect: () => void;
  // Renommer un élément (zone ou label) depuis le panneau
  onRenameLayerItem?: (id: string, kind: SynopticLayerKind, name: string) => void;
  setOnRenameLayerItem: (fn?: (id: string, kind: SynopticLayerKind, name: string) => void) => void;
  onBulkDeleteLayerItems?: (items: SynopticLayerItem[]) => void;
  setOnBulkDeleteLayerItems: (fn?: (items: SynopticLayerItem[]) => void) => void;
  // Faisceaux de câbles — liste publiée par synoptic-view, consommée par le panneau général
  synopticBundles: Array<{ id: string; name: string; color: string; count: number }>;
  setSynopticBundles: (
    items: Array<{ id: string; name: string; color: string; count: number }>,
  ) => void;
  onBundleAction?: (
    action: "rename" | "color" | "delete",
    bundleId: string,
    payload?: string,
  ) => void;
  setOnBundleAction: (
    fn?: (action: "rename" | "color" | "delete", bundleId: string, payload?: string) => void,
  ) => void;
  // Écartement des câbles parallèles entre mêmes nodes (toggle visuel)
  cableSpreadEnabled: boolean;
  setCableSpreadEnabled: (v: boolean) => void;
  // Affichage de la légende sur le canvas synoptique
  synopticLegendVisible: boolean;
  onToggleSynopticLegend?: () => void;
  setSynopticLegendHandlers: (h: { visible: boolean; onToggle?: () => void }) => void;
  // Validation BOM / graphe
  onValidateRack?: () => void;
  setOnValidateRack: (fn?: () => void) => void;
  validationErrorCount: number;
  validationWarningCount: number;
  validationInfoCount: number;
  setValidationCounts: (errors: number, warnings: number, infos: number) => void;
  validationReport: import("@/lib/services/rack-validation").ValidationReport | null;
  setValidationReport: (
    r: import("@/lib/services/rack-validation").ValidationReport | null,
  ) => void;
  onSelectValidationIssue?: (i: import("@/lib/services/rack-validation").ValidationIssue) => void;
  setOnSelectValidationIssue: (
    fn?: (i: import("@/lib/services/rack-validation").ValidationIssue) => void,
  ) => void;
  // Historique audit
  onToggleAuditPanel?: () => void;
  setOnToggleAuditPanel: (fn?: () => void) => void;
  // Rack config — rear interior exists
  hasRearInterior: boolean;
  setHasRearInterior: (v: boolean) => void;
  // Design grid (separate from synoptic grid)
  designGridEnabled: boolean;
  designGridColor: string;
  designGridOpacity: number;
  setDesignGridEnabled: (v: boolean) => void;
  setDesignGridColor: (v: string) => void;
  setDesignGridOpacity: (v: number) => void;
  // Construction — filtre checklist
  constructionFilter: "all" | "todo" | "done";
  setConstructionFilter: (v: "all" | "todo" | "done") => void;
  setLayerGroupMode: (v: "type" | "category" | "signal") => void;
  toggleLayerHidden: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  setManyLayersHidden: (ids: string[], hidden: boolean) => void;
  setManyLayersLocked: (ids: string[], locked: boolean) => void;
  setSynopticLayerItems: (items: SynopticLayerItem[]) => void;

  // Synoptique — repères (guides)
  synopticGuidesCount: number;
  onClearSynopticGuides?: () => void;
  selectedGuide?: { orientation: "h" | "v"; index: number; pos: number } | null;
  selectedGuideCount: number;
  selectedGuideColor?: string | null; // couleur commune si tous les sélectionnés partagent la même, sinon null
  onDeleteSelectedGuide?: () => void;
  onSetSelectedGuideColor?: (color: string | null) => void;
  setSynopticGuidesHandlers: (h: {
    count: number;
    onClear?: () => void;
    selected?: { orientation: "h" | "v"; index: number; pos: number } | null;
    selectedCount?: number;
    selectedColor?: string | null;
    onDeleteSelected?: () => void;
    onSetSelectedColor?: (color: string | null) => void;
  }) => void;

  // Synoptique — customisation grille/règles
  gridMajorEvery: number; // N sous-pas par majeur (ex. 4)
  gridColor: string;
  gridOpacity: number; // 0-1, multiplie les opacités mineures/majeures
  rulerColor: string;
  setGridMajorEvery: (v: number) => void;
  setGridColor: (v: string) => void;
  setGridOpacity: (v: number) => void;
  setRulerColor: (v: string) => void;

  // Setters utilisés par rack-editor au montage pour publier les callbacks
  setZoomHandlers: (handlers: {
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onZoomFit?: () => void;
    onZoomReset?: () => void;
    onCenter?: () => void;
  }) => void;
  setZoomValue: (zoom: number) => void;
}

const defaultEquipmentFilters: EquipmentFilters = {
  search: "",
  brandId: "",
  categoryNames: [],
  heightU: "",
  widthFraction: "",
  sortBy: "name-asc",
};

export const useTopbarActions = create<TopbarActionsState>()(
  persist(
    (set, get) => ({
      zoom: 1,
      labelDefaults: {
        color: "#64748b",
        fontFamily: null,
        fontSize: 14,
        fontWeight: "normal",
        fontStyle: "normal",
        textDecoration: "none",
      },
      setLabelDefaults: (patch) =>
        set((s) => ({ labelDefaults: { ...s.labelDefaults, ...patch } })),

      equipmentFilters: defaultEquipmentFilters,
      setEquipmentFilters: (patch) =>
        set((s) => ({ equipmentFilters: { ...s.equipmentFilters, ...patch } })),
      toggleEquipmentCategory: (name) =>
        set((s) => {
          const has = s.equipmentFilters.categoryNames.includes(name);
          return {
            equipmentFilters: {
              ...s.equipmentFilters,
              categoryNames: has
                ? s.equipmentFilters.categoryNames.filter((n) => n !== name)
                : [...s.equipmentFilters.categoryNames, name],
            },
          };
        }),
      resetEquipmentFilters: () =>
        set((s) => ({
          equipmentFilters: {
            ...defaultEquipmentFilters,
            search: s.equipmentFilters.search,
            sortBy: s.equipmentFilters.sortBy,
          },
        })),

      brandOptions: [],
      setBrandOptions: (brandOptions) => set({ brandOptions }),
      categoryOptions: [],
      setCategoryOptions: (categoryOptions) => set({ categoryOptions }),

      accessoryDefaults: {
        accType: "plaque",
        heightU: 1,
        plaqueStyle: "plein",
        depthMm: 200,
      },
      setAccessoryDefaults: (patch) =>
        set((s) => ({ accessoryDefaults: { ...s.accessoryDefaults, ...patch } })),
      accessoryUHeights: [1, 2, 3, 4],
      accessoryDepths: [100, 200, 300, 400, 500, 600],
      setAccessoryUHeights: (accessoryUHeights) => set({ accessoryUHeights }),
      setAccessoryDepths: (accessoryDepths) => set({ accessoryDepths }),

      // Vue state
      visibleViews: ["FRONT"],
      setVisibleViews: (visibleViews) => set({ visibleViews }),
      toggleView: (v) =>
        set((s) => {
          if (s.onToggleView) {
            s.onToggleView(v);
            return {};
          }
          const has = s.visibleViews.includes(v);
          if (has && s.visibleViews.length === 1) return {};
          return {
            visibleViews: has ? s.visibleViews.filter((x) => x !== v) : [...s.visibleViews, v],
          };
        }),
      setOnToggleView: (onToggleView) => set({ onToggleView }),
      viewMode: "real",
      setViewMode: (viewMode) =>
        set((s) => {
          s.onViewModeChange?.(viewMode);
          return { viewMode };
        }),
      setOnViewModeChange: (onViewModeChange) => set({ onViewModeChange }),

      setZoomHandlers: (handlers) => set({ ...handlers }),
      setZoomValue: (zoom) => set({ zoom }),
      miniMapByWs: {
        design: { visible: false, onToggle: undefined },
        synoptic: { visible: false, onToggle: undefined },
      },
      setMiniMap: (ws, h) => set((s) => ({ miniMapByWs: { ...s.miniMapByWs, [ws]: h } })),
      activeWorkspace: "design",
      setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),

      // Synoptique — cable defaults
      cableStyle: "ortho",
      cableCount: "single",
      cableMode: "auto",
      setCableStyle: (v) => {
        set({ cableStyle: v });
        get().synopticWriters.setCableStyle?.(v);
      },
      setCableCount: (v) => {
        set({ cableCount: v });
        get().synopticWriters.setCableCount?.(v);
      },
      setCableMode: (v) => {
        set({ cableMode: v });
        get().synopticWriters.setCableMode?.(v);
      },

      // Synoptique — label defaults
      synopticLabelFont: "system-ui",
      synopticLabelFontSize: 14,
      synopticLabelColor: "#64748b",
      setSynopticLabelFont: (v) => {
        set({ synopticLabelFont: v });
        get().synopticWriters.setLabelFont?.(v);
      },
      setSynopticLabelFontSize: (v) => {
        set({ synopticLabelFontSize: v });
        get().synopticWriters.setLabelFontSize?.(v);
      },
      setSynopticLabelColor: (v) => {
        set({ synopticLabelColor: v });
        get().synopticWriters.setLabelColor?.(v);
      },
      synopticLabelPill: false,
      synopticLabelPillBg: "#fde68a",
      synopticLabelPillRadius: 12,
      setSynopticLabelPill: (v) => set({ synopticLabelPill: v }),
      setSynopticLabelPillBg: (v) => set({ synopticLabelPillBg: v }),
      setSynopticLabelPillRadius: (v) => set({ synopticLabelPillRadius: v }),

      // Synoptique — zone defaults
      zoneColor: "#6366f1",
      setZoneColor: (v) => {
        set({ zoneColor: v });
        get().synopticWriters.setZoneColor?.(v);
      },
      zoneLabel: "Zone",
      zoneLabelPosition: "top-left",
      setZoneDefaults: (patch) =>
        set((s) => ({
          zoneLabel: patch.zoneLabel !== undefined ? patch.zoneLabel : s.zoneLabel,
          zoneLabelPosition:
            patch.zoneLabelPosition !== undefined ? patch.zoneLabelPosition : s.zoneLabelPosition,
        })),

      // Synoptique — numbering handlers
      setNumberingHandlers: (h) =>
        set({ onRenumberAuto: h.onRenumberAuto, onManualNumber: h.onManualNumber }),

      // Undo/redo par workspace
      historyByWs: {
        design: { onUndo: undefined, onRedo: undefined, canUndo: false, canRedo: false },
        synoptic: { onUndo: undefined, onRedo: undefined, canUndo: false, canRedo: false },
      },
      setHistory: (ws, h) => set((s) => ({ historyByWs: { ...s.historyByWs, [ws]: h } })),

      // Synoptique — adapter picker handler
      setOnPickAdapter: (fn) => set({ onPickAdapter: fn }),
      availableAdapters: [],
      setAvailableAdapters: (availableAdapters) => set({ availableAdapters }),
      pickingAdapterId: null,
      setPickingAdapterId: (pickingAdapterId) => set({ pickingAdapterId }),
      pendingAdapterPort: null,
      setPendingAdapterPort: (pendingAdapterPort) => set({ pendingAdapterPort }),
      setOnInsertAdapterAtPort: (fn) => set({ onInsertAdapterAtPort: fn }),

      // Synoptique — erase bulk handlers
      setSynopticEraseHandlers: (h) =>
        set({ onSynopticClearLabels: h.onClearLabels, onSynopticDecable: h.onDecable }),

      // Synoptique — writers bridge
      synopticWriters: {},
      setSynopticWriters: (w) => set({ synopticWriters: w }),

      // Grille + snap + règles (defaults)
      // Pas fixe à PORT_H (28 px) — aligné sur la distance entre 2 connecteurs d'un équipement.
      gridEnabled: true,
      gridStep: 28,
      snapEnabled: true,
      rulersEnabled: true, // règles affichées en permanence
      guidesVisible: true,
      guideDefaultColor: null,

      // Calques — defaults
      layerGroupMode: "type",
      hiddenLayerIds: new Set<string>(),
      lockedLayerIds: new Set<string>(),
      synopticLayerItems: [],
      selectedSynopticIds: new Set<string>(),
      setSelectedSynopticIds: (ids) => set({ selectedSynopticIds: ids }),
      pendingLayerSelection: null,
      requestLayerSelection: (id, kind) => set({ pendingLayerSelection: { id, kind } }),
      clearPendingLayerSelection: () => set({ pendingLayerSelection: null }),
      layerMultiSelectIds: new Set<string>(),
      setLayerMultiSelectIds: (ids) => set({ layerMultiSelectIds: ids }),
      clearLayerMultiSelect: () => set({ layerMultiSelectIds: new Set<string>() }),
      setOnRenameLayerItem: (fn) => set({ onRenameLayerItem: fn }),
      setOnBulkDeleteLayerItems: (fn) => set({ onBulkDeleteLayerItems: fn }),
      synopticBundles: [],
      setSynopticBundles: (items) => set({ synopticBundles: items }),
      setOnBundleAction: (fn) => set({ onBundleAction: fn }),
      cableSpreadEnabled: true,
      setCableSpreadEnabled: (v) => set({ cableSpreadEnabled: v }),
      synopticLegendVisible: false,
      setSynopticLegendHandlers: (h) =>
        set({ synopticLegendVisible: h.visible, onToggleSynopticLegend: h.onToggle }),
      setOnValidateRack: (fn) => set({ onValidateRack: fn }),
      validationErrorCount: 0,
      validationWarningCount: 0,
      validationInfoCount: 0,
      setValidationCounts: (errors, warnings, infos) =>
        set({
          validationErrorCount: errors,
          validationWarningCount: warnings,
          validationInfoCount: infos,
        }),
      validationReport: null,
      setValidationReport: (r) => set({ validationReport: r }),
      setOnSelectValidationIssue: (fn) => set({ onSelectValidationIssue: fn }),
      setOnToggleAuditPanel: (fn) => set({ onToggleAuditPanel: fn }),
      hasRearInterior: false,
      setHasRearInterior: (v) => set({ hasRearInterior: v }),
      designGridEnabled: true,
      designGridColor: "#808080",
      designGridOpacity: 0.3,
      setDesignGridEnabled: (v) => set({ designGridEnabled: v }),
      setDesignGridColor: (v) => set({ designGridColor: v }),
      setDesignGridOpacity: (v) => set({ designGridOpacity: Math.max(0, Math.min(1, v)) }),
      constructionFilter: "all",
      setConstructionFilter: (v) => set({ constructionFilter: v }),
      setLayerGroupMode: (v) => set({ layerGroupMode: v }),
      toggleLayerHidden: (id) =>
        set((s) => {
          const next = new Set(s.hiddenLayerIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { hiddenLayerIds: next };
        }),
      toggleLayerLocked: (id) =>
        set((s) => {
          const next = new Set(s.lockedLayerIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { lockedLayerIds: next };
        }),
      setManyLayersHidden: (ids, hidden) =>
        set((s) => {
          const next = new Set(s.hiddenLayerIds);
          ids.forEach((id) => (hidden ? next.add(id) : next.delete(id)));
          return { hiddenLayerIds: next };
        }),
      setManyLayersLocked: (ids, locked) =>
        set((s) => {
          const next = new Set(s.lockedLayerIds);
          ids.forEach((id) => (locked ? next.add(id) : next.delete(id)));
          return { lockedLayerIds: next };
        }),
      setSynopticLayerItems: (items) => set({ synopticLayerItems: items }),
      setGridEnabled: (v) => set({ gridEnabled: v }),
      setGridStep: (v) => set({ gridStep: Math.max(2, Math.min(128, v)) }),
      setSnapEnabled: (v) => set({ snapEnabled: v }),
      setRulersEnabled: (v) => set({ rulersEnabled: v }),
      setGuidesVisible: (v) => set({ guidesVisible: v }),
      setGuideDefaultColor: (v) => set({ guideDefaultColor: v }),

      synopticGuidesCount: 0,
      selectedGuide: null,
      selectedGuideCount: 0,
      selectedGuideColor: null,
      setSynopticGuidesHandlers: (h) =>
        set({
          synopticGuidesCount: h.count,
          onClearSynopticGuides: h.onClear,
          selectedGuide: h.selected ?? null,
          selectedGuideCount: h.selectedCount ?? (h.selected ? 1 : 0),
          selectedGuideColor: h.selectedColor ?? null,
          onDeleteSelectedGuide: h.onDeleteSelected,
          onSetSelectedGuideColor: h.onSetSelectedColor,
        }),

      // Customisation grille / règles
      gridMajorEvery: 4,
      gridColor: "#808080",
      // Grille synoptique discrète par défaut (30 %) — le toggle « Grille »
      // et le curseur d'opacité restent inchangés.
      gridOpacity: 0.3,
      rulerColor: "#808080",
      setGridMajorEvery: (v) => set({ gridMajorEvery: Math.max(2, Math.min(16, Math.round(v))) }),
      setGridColor: (v) => set({ gridColor: v }),
      setGridOpacity: (v) => set({ gridOpacity: Math.max(0, Math.min(1, v)) }),
      setRulerColor: (v) => set({ rulerColor: v }),
    }),
    {
      name: "arkyo:topbar-prefs",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        // Synoptique — câble
        cableStyle: s.cableStyle,
        cableCount: s.cableCount,
        cableMode: s.cableMode,
        cableSpreadEnabled: s.cableSpreadEnabled,
        // Synoptique — label
        synopticLabelFont: s.synopticLabelFont,
        synopticLabelFontSize: s.synopticLabelFontSize,
        synopticLabelColor: s.synopticLabelColor,
        synopticLabelPill: s.synopticLabelPill,
        synopticLabelPillBg: s.synopticLabelPillBg,
        synopticLabelPillRadius: s.synopticLabelPillRadius,
        // Synoptique — zone
        zoneColor: s.zoneColor,
        zoneLabel: s.zoneLabel,
        zoneLabelPosition: s.zoneLabelPosition,
        // Design — labels
        labelDefaults: s.labelDefaults,
        // Accessoires
        accessoryDefaults: s.accessoryDefaults,
        // Vue
        viewMode: s.viewMode,
        // Grille synoptique
        gridEnabled: s.gridEnabled,
        gridStep: s.gridStep,
        snapEnabled: s.snapEnabled,
        rulersEnabled: s.rulersEnabled,
        gridMajorEvery: s.gridMajorEvery,
        gridColor: s.gridColor,
        gridOpacity: s.gridOpacity,
        rulerColor: s.rulerColor,
        // Repères
        guidesVisible: s.guidesVisible,
        guideDefaultColor: s.guideDefaultColor,
        // Calques
        layerGroupMode: s.layerGroupMode,
        // Légende synoptique (affichage on/off — l'utilisateur veut le voir
        // survivre au reload).
        synopticLegendVisible: s.synopticLegendVisible,
        // Grille design
        designGridEnabled: s.designGridEnabled,
        designGridColor: s.designGridColor,
        designGridOpacity: s.designGridOpacity,
        // Construction — filtre checklist
        constructionFilter: s.constructionFilter,
      }),
    },
  ),
);
