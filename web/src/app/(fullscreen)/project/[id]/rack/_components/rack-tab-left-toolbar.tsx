"use client";

/**
 * RackTabLeftToolbar — barre verticale d'outils de l'onglet Rack du projet.
 *
 * Pattern aligné sur `InventaireLeftToolbar` mais avec un groupe **VUES**
 * supplémentaire (FRONT / REAR / REAR_INTERIOR / SIDE en toggles
 * indépendants) entre les outils et le zoom.
 *
 *  - Tools exclusifs : Contenant / Équipements / Adaptateurs / Panels /
 *    Accessoires (le tool "container" doit être sélectionné par défaut).
 *  - Vues : toggles indépendants — l'utilisateur peut activer plusieurs
 *    vues en parallèle (cf. spec multi-vue : Set<ViewId>).
 *  - Zoom : zoom +/-, pourcentage live, ajuster, centrer.
 */

import {
  Camera,
  FlipHorizontal,
  Focus,
  Grid3x3,
  Hand,
  Layers,
  MapPin,
  Maximize2,
  Monitor,
  MousePointer2,
  Ruler,
  Server,
  Shapes,
  SplitSquareHorizontal,
  Square,
  ZoomIn,
  ZoomOut,
} from "@/components/ui/icons";

import type { ViewId } from "@/components/synoptique/lib/types";

/** Mode de rendu des équipements rackés (radio-style). */
export type RackRenderMode = "standard" | "graphic" | "photo";

/**
 * Exporté : l'export du Rack propose le même choix par objet posé sur la
 * planche. Un seul jeu de libellés, sinon « GFX » finirait par vouloir dire
 * deux choses différentes selon l'écran.
 */
export const RENDER_MODES: {
  id: RackRenderMode;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "standard", label: "Standard", short: "STD", icon: Square },
  { id: "graphic", label: "Graphique", short: "GFX", icon: Shapes },
  { id: "photo", label: "Photo", short: "PIC", icon: Camera },
];

// Presets de vues — chaque bouton remplace l'ensemble actif (radio-style).
// La vue de côté (SIDE) est TOUJOURS incluse pour donner le contexte
// dimensionnel du contenant. L'utilisateur ne sélectionne qu'une orientation
// principale (avant / arrière / intérieur / les deux / tout).
export type RackViewPreset =
  | "front"
  | "rear"
  | "interior"
  | "front-rear"
  | "all";

export const VIEW_PRESETS: {
  id: RackViewPreset;
  label: string;
  short: string;
  views: ViewId[];
  icon: React.ComponentType<{ className?: string }>;
  /** Nécessite que le contenant ait une face arrière intérieure. */
  requiresInterior?: boolean;
}[] = [
  { id: "front", label: "Avant", short: "AV", views: ["FRONT", "SIDE"], icon: Monitor },
  { id: "rear", label: "Arrière", short: "AR", views: ["REAR", "SIDE"], icon: FlipHorizontal },
  {
    id: "interior",
    label: "Intérieur",
    short: "IN",
    views: ["REAR_INTERIOR", "SIDE"],
    icon: Layers,
    requiresInterior: true,
  },
  {
    id: "front-rear",
    label: "Avant + Arrière",
    short: "AV/AR",
    views: ["FRONT", "REAR", "SIDE"],
    icon: SplitSquareHorizontal,
  },
  {
    id: "all",
    label: "Tous",
    short: "ALL",
    views: ["FRONT", "REAR", "REAR_INTERIOR", "SIDE"],
    icon: Grid3x3,
  },
];

/** Portée d'affichage du canvas rack : un contenant, ou tout un emplacement. */
export type RackDisplayScope = "container" | "location";

/**
 * Vues disponibles en mode « par emplacement » — radio simple (une seule vue,
 * appliquée à tous les contenants du lieu). Les presets combinés (AV/AR, ALL)
 * n'ont pas de sens ici : chaque contenant occupe déjà une colonne.
 */
export const LOCATION_VIEWS: {
  id: ViewId;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Masquée si aucun contenant du lieu n'a de face arrière intérieure. */
  requiresInterior?: boolean;
}[] = [
  { id: "FRONT", label: "Avant", short: "AV", icon: Monitor },
  { id: "REAR", label: "Arrière", short: "AR", icon: FlipHorizontal },
  {
    id: "REAR_INTERIOR",
    label: "Intérieur",
    short: "IN",
    icon: Layers,
    requiresInterior: true,
  },
  { id: "SIDE", label: "Vue côté", short: "Côté", icon: Ruler },
];

/** Détecte le preset actif à partir d'un Set<ViewId>. Renvoie `null` si la
 * combinaison ne correspond à aucun preset (cas rare : Set construit hors
 * presets, par ex. lors d'un legacy localStorage). */
export function detectActivePreset(
  views: Set<ViewId>,
  hasRearInterior: boolean,
): RackViewPreset | null {
  for (const preset of VIEW_PRESETS) {
    if (preset.requiresInterior && !hasRearInterior) continue;
    if (preset.views.length !== views.size) continue;
    if (preset.views.every((v) => views.has(v))) return preset.id;
  }
  return null;
}

export function RackTabLeftToolbar({
  canvasTool,
  onCanvasToolChange,
  visibleViews,
  onSelectViewPreset,
  hasRearInterior = false,
  displayScope = "container",
  onDisplayScopeChange,
  locationView = "FRONT",
  onLocationViewChange,
  renderMode = "standard",
  onRenderModeChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onFitAll,
  onCenter,
}: {
  /** Outil canvas courant. */
  canvasTool?: "select" | "move";
  onCanvasToolChange?: (tool: "select" | "move") => void;
  visibleViews: Set<ViewId>;
  /** Sélectionne un preset de vues (radio-style). Le canvas reflète le set
   * complet du preset choisi. */
  onSelectViewPreset: (preset: RackViewPreset) => void;
  /**
   * Portée « Intérieur » : en mode contenant = le contenant courant a une face
   * arrière intérieure ; en mode emplacement = AU MOINS un contenant du lieu
   * en a une. Si faux, la vue « Intérieur » est masquée.
   */
  hasRearInterior?: boolean;
  /** Portée d'affichage (radio CONT / LIEU). */
  displayScope?: RackDisplayScope;
  onDisplayScopeChange?: (scope: RackDisplayScope) => void;
  /** Vue unique du mode emplacement (radio AV / AR / IN / Côté). */
  locationView?: ViewId;
  onLocationViewChange?: (view: ViewId) => void;
  /** Mode de rendu des équipements rackés (radio-style). */
  renderMode?: RackRenderMode;
  onRenderModeChange?: (mode: RackRenderMode) => void;
  zoom?: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAll: () => void;
  onCenter: () => void;
}) {
  const zoomPct = Math.round((zoom ?? 1) * 100);
  const activePreset = detectActivePreset(visibleViews, hasRearInterior);
  const isLocationScope = displayScope === "location";
  return (
    <div className="flex h-full flex-col py-1.5">
      {/* Outils canvas — Sélection / Déplacement (équivalent rack-editor classique). */}
      {onCanvasToolChange && (
        <div className="flex flex-col gap-0.5">
          <ToolIconButton
            icon={MousePointer2}
            title="Sélection (S)"
            active={canvasTool === "select"}
            onClick={() => onCanvasToolChange("select")}
          />
          <ToolIconButton
            icon={Hand}
            title="Déplacer (H)"
            active={canvasTool === "move"}
            onClick={() => onCanvasToolChange("move")}
          />
        </div>
      )}

      {/* Section bas : Affichage + Vues (presets radio) + Zoom — collés en bas */}
      <div className="mt-auto flex flex-col gap-0.5">
        {/* Portée d'affichage — par contenant ou par emplacement (radio). */}
        <div className="text-muted-foreground/60 mx-auto py-0.5 text-[7px] font-bold tracking-widest uppercase">
          Affich.
        </div>
        <ViewPresetButton
          icon={Server}
          title="Par contenant"
          short="CONT"
          active={!isLocationScope}
          disabled={!onDisplayScopeChange}
          onClick={() => onDisplayScopeChange?.("container")}
        />
        <ViewPresetButton
          icon={MapPin}
          title="Par emplacement"
          short="LIEU"
          active={isLocationScope}
          disabled={!onDisplayScopeChange}
          onClick={() => onDisplayScopeChange?.("location")}
        />
        <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
        <div className="text-muted-foreground/60 mx-auto py-0.5 text-[7px] font-bold tracking-widest uppercase">
          Vues
        </div>
        {isLocationScope
          ? // Mode emplacement : une seule vue à la fois, appliquée à tous les
            // contenants du lieu (chacun occupe déjà sa colonne).
            LOCATION_VIEWS.filter(
              (v) => !v.requiresInterior || hasRearInterior,
            ).map((v) => (
              <ViewPresetButton
                key={v.id}
                icon={v.icon}
                title={v.label}
                short={v.short}
                active={locationView === v.id}
                onClick={() => onLocationViewChange?.(v.id)}
              />
            ))
          : VIEW_PRESETS.filter(
              (p) => !p.requiresInterior || hasRearInterior,
            ).map((p) => (
              <ViewPresetButton
                key={p.id}
                icon={p.icon}
                title={p.label}
                short={p.short}
                active={activePreset === p.id}
                onClick={() => onSelectViewPreset(p.id)}
              />
            ))}

        {onRenderModeChange && (
          <>
            <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
            <div className="text-muted-foreground/60 mx-auto py-0.5 text-[7px] font-bold tracking-widest uppercase">
              Mode
            </div>
            {RENDER_MODES.map((m) => (
              <ViewPresetButton
                key={m.id}
                icon={m.icon}
                title={m.label}
                short={m.short}
                active={renderMode === m.id}
                onClick={() => onRenderModeChange(m.id)}
              />
            ))}
          </>
        )}

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
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ToolIconButton({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
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

function ViewPresetButton({
  icon: Icon,
  title,
  short,
  active,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  short: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`relative mx-auto flex h-9 w-9 flex-col items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none ${
        disabled
          ? "text-muted-foreground/30 cursor-not-allowed"
          : active
            ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata
            : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)]"
      }`}
    >
      <Icon className="h-[14px] w-[14px]" />
      <span className="mt-0.5 text-[7px] font-bold tracking-wider uppercase leading-none">
        {short}
      </span>
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
