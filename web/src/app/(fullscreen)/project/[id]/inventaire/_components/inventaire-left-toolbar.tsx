"use client";

/**
 * InventaireLeftToolbar — barre verticale d'outils du canvas Inventaire.
 *
 * Pattern aligné sur `LeftToolbar` du rack-editor :
 *   - Tools exclusifs (h-9 w-9, icône 18px) — un seul actif à la fois
 *   - Premier tool "Contenants" : ouvre un side panel listant les
 *     contenants existants + bouton inline "Ajouter un contenant"
 *   - Tools catalogue : Équipements / Adaptateurs / Panels / Accessoires
 *   - Bas : zoom courant (%) + zoom +/- / fit / centrer
 */

import { Fragment } from "react";
import {
  Boxes,
  Cable,
  Focus,
  LayoutPanelTop,
  Maximize2,
  Wrench,
  ZoomIn,
  ZoomOut,
} from "@/components/ui/icons";

export type InventaireToolId =
  | "equipment"
  | "adapter"
  | "panel"
  | "accessory";

const INVENTAIRE_TOOL_IDS: ReadonlySet<string> = new Set([
  "equipment",
  "adapter",
  "panel",
  "accessory",
]);

export function isInventaireToolId(v: unknown): v is InventaireToolId {
  return typeof v === "string" && INVENTAIRE_TOOL_IDS.has(v);
}

export type InventaireToolDef = {
  id: InventaireToolId;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
};

export const INVENTAIRE_TOOL_DEFS: InventaireToolDef[] = [
  { id: "equipment", icon: Boxes, label: "Équipements", shortcut: "E" },
  { id: "adapter", icon: Cable, label: "Adaptateurs", shortcut: "A" },
  { id: "panel", icon: LayoutPanelTop, label: "Panels", shortcut: "P" },
  { id: "accessory", icon: Wrench, label: "Accessoires", shortcut: "X" },
];

const TOOL_DIVIDER_AFTER: Record<InventaireToolId, boolean> = {
  equipment: false,
  adapter: false,
  panel: false,
  accessory: false,
};

export function InventaireLeftToolbar({
  activeTool,
  onToolChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onFitAll,
  onCenter,
  excludeTools,
  hideZoom,
}: {
  activeTool: InventaireToolId | null;
  /**
   * Reçoit le tool cliqué, ou `null` quand l'utilisateur clique le tool
   * déjà actif (toggle). Le parent gère la fermeture du side panel.
   */
  onToolChange: (tool: InventaireToolId | null) => void;
  /** Zoom courant du canvas (1 = 100 %). Ignoré quand `hideZoom`. */
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitAll?: () => void;
  onCenter?: () => void;
  /**
   * Liste d'outils à masquer (mode template — l'outil "container" n'a pas
   * de sens car un seul contenant existe).
   */
  excludeTools?: InventaireToolId[];
  /**
   * Masque la section zoom du bas. Toujours vrai pour l'inventaire projet
   * (page scrollable, plus de canvas pan/zoom) et le mode template.
   */
  hideZoom?: boolean;
}) {
  const zoomPct = Math.round((zoom ?? 1) * 100);
  return (
    <div className="flex h-full flex-col py-1.5">
      {/* Section tools : sélection exclusive du side panel. Les groupes sont
          séparés par un simple filet — pas de titre de groupe. */}
      <div className="flex flex-col gap-0.5">
        {INVENTAIRE_TOOL_DEFS.filter(
          (t) => !excludeTools?.includes(t.id),
        ).map(({ id, icon, label, shortcut }) => (
          // Fragment plutôt que <span> : le parent est `flex flex-col`, donc
          // chaque enfant direct doit être un block (cf. label ZOOM plus bas
          // dans le même flex column).
          <Fragment key={id}>
            <ToolButton
              icon={icon}
              label={label}
              shortcut={shortcut}
              active={activeTool === id}
              onClick={() => onToolChange(activeTool === id ? null : id)}
            />
            {TOOL_DIVIDER_AFTER[id] && (
              <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
            )}
          </Fragment>
        ))}
      </div>

      {/* Section bas : Zoom (fit / center) — masquée en mode template */}
      {!hideZoom && (
        <div className="mt-auto flex flex-col gap-0.5">
          <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
          <div className="text-muted-foreground/60 mx-auto py-0.5 text-[7px] font-bold tracking-widest uppercase">
            Zoom
          </div>
          <ZoomActionButton icon={ZoomIn} title="Zoom +" onClick={onZoomIn} />
          <div
            className="text-muted-foreground mx-auto py-0.5 text-center text-[9px] leading-none"
            style={{ fontFamily: "var(--font-mono)" }}
            title={`Zoom ${zoomPct} %`}
          >
            {zoomPct}%
          </div>
          <ZoomActionButton icon={ZoomOut} title="Zoom −" onClick={onZoomOut} />
          <ZoomActionButton icon={Maximize2} title="Ajuster" onClick={onFitAll} />
          <ZoomActionButton icon={Focus} title="Centrer" onClick={onCenter} />
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${label}${shortcut ? ` (${shortcut})` : ""}`}
      onClick={onClick}
      className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none ${
        active
          ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
          : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)]"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
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
