"use client";
import * as Icons from "@/components/ui/icons";
import {
  Map as MapIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Focus,
  Monitor,
  FlipHorizontal,
  Layers,
  PanelLeft,
  Eye,
  Cuboid,
  Undo2,
  Redo2,
} from "@/components/ui/icons";
import { useWorkspace, useWorkspaceActions } from "./hooks/use-workspace";
import { isDivider, type ToolDef, type ToolRegistry } from "./tool-registry";
import { useTopbarActions } from "./topbar-actions-context";

function ToolButton({ tool }: { tool: ToolDef }) {
  const activeToolId = useWorkspace((s) => s.activeToolId);
  const { setTool } = useWorkspaceActions();
  const Icon = (Icons[tool.icon as keyof typeof Icons] ?? Icons.Circle) as React.ComponentType<{
    className?: string;
  }>;
  const isActive = activeToolId === tool.id;

  const onClick = () => {
    if (isActive) return;
    const nextVariant = tool.defaultVariantId ?? tool.variants?.[0]?.id ?? null;
    setTool(tool.id, nextVariant);
  };

  return (
    <button
      type="button"
      title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ""}`}
      onClick={onClick}
      className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none ${
        isActive
          ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata (accent sur l'accent à 12 % : --accent-strong)
          : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)]"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

function HistoryButtons() {
  const ws = useTopbarActions((s) => s.activeWorkspace);
  const history = useTopbarActions((s) => s.historyByWs[ws]);
  if (ws !== "synoptic") return null;
  const { onUndo, onRedo, canUndo, canRedo } = history;
  const btnCls = (enabled: boolean) =>
    `relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none ${
      enabled
        ? "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)] hover:text-foreground"
        : "text-muted-foreground/30 cursor-not-allowed"
    }`;
  return (
    <>
      <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
      <button
        type="button"
        title="Annuler (⌘Z)"
        onClick={canUndo ? onUndo : undefined}
        disabled={!canUndo}
        className={btnCls(canUndo)}
      >
        <Undo2 className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        title="Rétablir (⌘⇧Z)"
        onClick={canRedo ? onRedo : undefined}
        disabled={!canRedo}
        className={btnCls(canRedo)}
      >
        <Redo2 className="h-[18px] w-[18px]" />
      </button>
    </>
  );
}

function ViewToggleButtons() {
  const ws = useTopbarActions((s) => s.activeWorkspace);
  const visibleViews = useTopbarActions((s) => s.visibleViews);
  const toggleView = useTopbarActions((s) => s.toggleView);
  const viewMode = useTopbarActions((s) => s.viewMode);
  const setViewMode = useTopbarActions((s) => s.setViewMode);
  const hasRearInterior = useTopbarActions((s) => s.hasRearInterior);

  if (ws !== "design") return null;

  const views: { id: string; icon: React.ComponentType<{ className?: string }>; title: string }[] =
    [
      { id: "FRONT", icon: Monitor, title: "Avant" },
      { id: "REAR", icon: FlipHorizontal, title: "Arrière" },
    ];
  if (hasRearInterior) {
    views.push({ id: "REAR_INTERIOR", icon: Layers, title: "Arrière int." });
  }

  const safeToggle = (id: string) => {
    const isActive = visibleViews.includes(id);
    const viewCount = visibleViews.filter(
      (v) => v === "FRONT" || v === "REAR" || v === "REAR_INTERIOR",
    ).length;
    if (isActive && viewCount <= 1) return;
    toggleView(id);
  };

  const ModeIcon = viewMode === "real" ? Eye : Cuboid;

  return (
    <>
      <div className="text-muted-foreground/60 mx-auto py-0.5 text-[7px] font-bold tracking-widest uppercase">
        Vues
      </div>
      {views.map(({ id, icon: Icon, title }) => {
        const active = visibleViews.includes(id);
        return (
          <button
            key={id}
            type="button"
            title={title}
            onClick={() => safeToggle(id)}
            className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none ${
              active
                ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata (accent sur l'accent à 12 % : --accent-strong)
                : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)]"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
          </button>
        );
      })}
      <button
        type="button"
        title={viewMode === "real" ? "Passer en représentation" : "Passer en réel"}
        onClick={() => setViewMode(viewMode === "real" ? "schema" : "real")}
        className="text-muted-foreground hover:text-foreground relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)] active:scale-95"
      >
        <ModeIcon className="h-[18px] w-[18px]" />
      </button>
    </>
  );
}

function MiniMapButton() {
  const ws = useTopbarActions((s) => s.activeWorkspace);
  const { visible: miniMapVisible, onToggle: onToggleMiniMap } = useTopbarActions(
    (s) => s.miniMapByWs[ws],
  );
  if (!onToggleMiniMap) return null;
  return (
    <button
      type="button"
      title={miniMapVisible ? "Masquer la mini-map" : "Afficher la mini-map"}
      onClick={onToggleMiniMap}
      className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none ${
        miniMapVisible
          ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata (accent sur l'accent à 12 % : --accent-strong)
          : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)]"
      }`}
    >
      <MapIcon className="h-[18px] w-[18px]" />
    </button>
  );
}

function ZoomActionButton({
  icon: Icon,
  title,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onClick?: () => void;
}) {
  const enabled = !!onClick;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={!enabled}
      className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none ${
        enabled
          ? "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)]"
          : "text-muted-foreground/30 cursor-not-allowed"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

function ZoomQuickControls() {
  const zoom = useTopbarActions((s) => s.zoom);
  const onZoomIn = useTopbarActions((s) => s.onZoomIn);
  const onZoomOut = useTopbarActions((s) => s.onZoomOut);
  const onZoomFit = useTopbarActions((s) => s.onZoomFit);
  const onZoomReset = useTopbarActions((s) => s.onZoomReset);
  const onCenter = useTopbarActions((s) => s.onCenter);
  if (!onZoomIn && !onZoomOut && !onZoomFit && !onZoomReset && !onCenter) return null;
  return (
    <>
      <div className="text-muted-foreground/60 mx-auto py-0.5 text-[7px] font-bold tracking-widest uppercase">
        Zoom
      </div>
      <ZoomActionButton icon={ZoomIn} title="Zoom +" onClick={onZoomIn} />
      <div
        className="text-muted-foreground mx-auto py-0.5 text-center text-[9px] leading-none"
        style={{ fontFamily: "var(--font-mono)" }}
        title={`Zoom ${Math.round(zoom * 100)} %`}
      >
        {Math.round(zoom * 100)}%
      </div>
      <ZoomActionButton icon={ZoomOut} title="Zoom −" onClick={onZoomOut} />
      <ZoomActionButton icon={Maximize2} title="Ajuster" onClick={onZoomFit} />
      <ZoomActionButton icon={Focus} title="Centrer" onClick={onCenter} />
    </>
  );
}

export function LeftToolbar({ registry }: { registry: ToolRegistry }) {
  return (
    <div className="flex h-full flex-col py-1.5">
      <div className="flex flex-col gap-0.5">
        {registry.tools.map((entry) => {
          if (isDivider(entry)) {
            return <div key={entry.id} aria-hidden className="bg-border/60 mx-2 my-1 h-px" />;
          }
          return <ToolButton key={entry.id} tool={entry} />;
        })}
      </div>
      <div className="mt-auto flex flex-col gap-0.5">
        <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
        <ViewToggleButtons />
        <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
        <ZoomQuickControls />
        <HistoryButtons />
      </div>
    </div>
  );
}
