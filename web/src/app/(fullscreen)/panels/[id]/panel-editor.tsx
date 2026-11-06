"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
  useDroppable,
  useDraggable,
  PointerSensor,
  TouchSensor,
  useSensors,
  useSensor,
  pointerWithin,
  type Modifier,
} from "@dnd-kit/core";

// Centre le DragOverlay sous le curseur / doigt
const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const ev = activatorEvent as MouseEvent & TouchEvent;
  const clientX = ev.touches ? ev.touches[0]?.clientX : ev.clientX;
  const clientY = ev.touches ? ev.touches[0]?.clientY : ev.clientY;
  if (clientX == null || clientY == null) return transform;
  return {
    ...transform,
    x: transform.x + clientX - (draggingNodeRect.left + draggingNodeRect.width / 2),
    y: transform.y + clientY - (draggingNodeRect.top + draggingNodeRect.height / 2),
  };
};
import { ConnectorIcon } from "@/components/ui/connector-icon";
import {
  Settings,
  X,
  Search,
  ZoomIn,
  ZoomOut,
  AlignHorizontalJustifyCenter,
  Trash2,
  RotateCcw,
  HelpCircle,
  Layers,
  LayoutGrid,
  GripVertical,
  MousePointer2,
  Hand,
  Move,
  Cable,
  ArrowUpDown,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { subscribeAppEvents } from "@/lib/app-events-client";
import { EmptyState } from "@/components/ui/empty-state";
import {
  InfoCard,
  ActionButton,
  ActionSwitch,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";
import { NameInput } from "@/components/synoptique/components/synoptic-general-panel";
import { Check, ChevronRight, Loader2 } from "@/components/ui/icons";
import { useLiveCursors } from "@/components/synoptique/hooks/use-live-cursors";
import { RemoteCursorsOverlay } from "@/components/synoptique/components/remote-cursors-overlay";
import { StrataBrand } from "@/components/brand/strata-brand"; // arkyo-server: habillage Strata

// ── Types ─────────────────────────────────────────────────────────────────

type ConnectorType = {
  id: string;
  name: string;
  version: string | null;
  iconId: string;
  color: string;
  category: string;
  /**
   * Catégories compatibles du connecteur (= labels des CatalogFunction liées
   * via CatalogConnectorTypeFunction). Un connecteur peut apparaître dans
   * plusieurs catégories (ex. XLR → Audio + Intercom).
   */
  categories: string[];
  isPanel: boolean;
  /** Le connecteur existe aussi en coque Neutrik D (dérivé du symbole). */
  hasNeutrikD: boolean;
  /** URL du SVG version D (override/custom) — null = rendu code `ConnectorIcon dType`. */
  dTypeSvgUrl: string | null;
};

function connectorLabel(c: ConnectorType) {
  return c.version ? `${c.name} ${c.version}` : c.name;
}

type PanelSlot = {
  id: string;
  panelId: string;
  position: number;
  sizeSlots: number;
  label: string | null;
  notes: string | null;
  connectorTypeId: string | null;
  connectorType: ConnectorType | null;
  /** Pose du connecteur en coque Neutrik D sur ce slot (choix à la pose). */
  mountD: boolean;
  /** Famille (label de fonction) choisie au drag — couleur du groupe d'origine. */
  familyLabel: string | null;
};

type PanelData = {
  id: string;
  name: string;
  heightU: number;
  slotsPerU: number;
  rearCableDepthMm: number;
  notes: string | null;
  slots: PanelSlot[];
};

type ActiveDrag =
  | { kind: "connector"; connector: ConnectorType; familyLabel: string | null }
  | { kind: "panel_slot"; slot: PanelSlot };

// ── Constants ──────────────────────────────────────────────────────────────

const PANEL_TOTAL_W = 900;
const EAR_W = 56;
const USABLE_W = PANEL_TOTAL_W - EAR_W * 2;
const U_H = 96;
/** Teinte de repli quand un connecteur n'a aucune fonction (= famille). */
const NEUTRAL_COLOR = "#888";

// ── TrashZone ─────────────────────────────────────────────────────────────

function TrashZone() {
  const { setNodeRef, isOver } = useDroppable({ id: "trash-zone" });
  return (
    <div
      ref={setNodeRef}
      className="flex items-center justify-center gap-2 transition-all"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 200,
        // arkyo-server: habillage Strata (zone de suppression : --destructive plein au survol, --danger sinon)
        background: isOver ? "var(--destructive)" : "color-mix(in srgb, var(--danger) 12%, transparent)",
        border: `2px dashed ${isOver ? "var(--destructive)" : "color-mix(in srgb, var(--danger) 50%, transparent)"}`, // arkyo-server: habillage Strata
        borderRadius: 12,
        padding: "10px 28px",
        color: isOver ? "var(--destructive-foreground)" : "var(--danger-text)", // arkyo-server: habillage Strata
        fontWeight: 600,
        fontSize: 13,
        backdropFilter: "blur(4px)",
      }}
    >
      <Trash2 size={16} />
      Supprimer le connecteur
    </div>
  );
}

// ── Coque Neutrik D (contour = coque, glyphe générique dedans) ─────────────

/**
 * Décor « vis torx » de la coque Neutrik D — 2 pastilles diagonales, posées en
 * absolu dans un conteneur `position: relative`. `box` = côté du conteneur px.
 */
function TorxDots({ color, box }: { color: string; box: number }) {
  const d = Math.max(2.5, box * 0.13);
  // Collées aux coins (haut-gauche / bas-droite), bien à l'écart l'une de
  // l'autre — comme les 2 vis d'un vrai châssis Neutrik D.
  const off = Math.max(1.5, box * 0.08);
  const base: React.CSSProperties = {
    position: "absolute",
    width: d,
    height: d,
    borderRadius: "50%",
    border: `1px solid ${color}`,
  };
  return (
    <>
      <span style={{ ...base, top: off, left: off }} />
      <span style={{ ...base, bottom: off, right: off }} />
    </>
  );
}

/**
 * Représentation Neutrik D AUTONOME (sans conteneur parent bordé) : la coque
 * carrée EST le contour visible + vis torx + glyphe générique du connecteur.
 * Même empreinte qu'un symbole générique de même `size` (contrairement à
 * `ConnectorIcon dType` dont la coque ne remplit que ~78 % du viewBox).
 * Symbole D custom (image) → l'image remplit la boîte, sans bordure ajoutée.
 *
 * Pour les conteneurs DÉJÀ bordés (slot droppable, aperçu 56px), on n'utilise
 * PAS ce composant : on transforme leur propre bordure en coque (sinon double
 * contour) — cf. `DroppableSlot` et l'aperçu du slot sélectionné.
 */
function DCoque({
  connector,
  color,
  size,
}: {
  connector: ConnectorType;
  color: string;
  size: number;
}) {
  if (connector.dTypeSvgUrl) {
    return (
      <img
        src={connector.dTypeSvgUrl}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: "contain" }}
      />
    );
  }
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        border: `1px solid ${color}`,
        flexShrink: 0,
      }}
    >
      <TorxDots color={color} box={size} />
      {/* Glyphe générique — MÊME taille que dans un cercle générique (0.68). */}
      <ConnectorIcon iconId={connector.iconId} color={color} size={Math.round(size * 0.68)} />
    </span>
  );
}

// ── Logo Neutrik (monochrome, currentColor) ────────────────────────────────

/**
 * Logo Neutrik stylisé — anneau extérieur + glyphe « N » aux traits arrondis
 * (arcs ouverts, pas de remplissage). Dessiné en `currentColor` pour hériter
 * de la couleur du bouton (accent quand actif, muted sinon).
 */
function NeutrikLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      {/* Anneau extérieur épais */}
      <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="9" />
      {/* Barre supérieure légèrement incurvée */}
      <path
        d="M30 38 Q50 33 70 38"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Descente verticale centrale */}
      <line
        x1="50"
        y1="36"
        x2="50"
        y2="76"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* Crochet gauche arqué */}
      <path
        d="M32 44 Q28 55 27 66"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* Crochet droit arqué */}
      <path
        d="M73 44 Q72 55 68 66"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Slot circulaire style D-type ──────────────────────────────────────────

// Juste le cercle — pas de numéro ni label pour éviter tout problème d'alignement
function DroppableSlot({
  position,
  slot,
  size,
  isDragTarget,
  onSelect,
  isSelected,
  familyColor,
}: {
  position: number;
  slot: PanelSlot | undefined;
  size: number;
  isDragTarget: boolean;
  onSelect: (slot: PanelSlot) => void;
  isSelected: boolean;
  /** Couleur de la famille (1re fonction) du connecteur posé — teinte le slot. */
  familyColor?: string;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `slot-${position}` });
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `panel_slot-${position}`,
    data: { type: "panel_slot", slot },
    disabled: !slot,
  });
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDropRef(node);
      setDragRef(node);
    },
    [setDropRef, setDragRef],
  );

  const occupied = !!slot;
  // Pose Neutrik D : choix par slot (`mountD`). Dégrade en générique si absent.
  const isNeutrik = slot?.mountD === true;
  // Un symbole D custom (image) est une coque complète → on la laisse remplir
  // le slot (bordure conteneur effacée). Sinon la BORDURE DU CONTENEUR est le
  // contour : cercle en générique, coque carrée en D — même empreinte `size`,
  // le glyphe intérieur est toujours générique et plus petit.
  const customD = isNeutrik ? (slot?.connectorType?.dTypeSvgUrl ?? null) : null;
  const iconSize = customD ? size : Math.round(size * 0.68);
  const radius = occupied && isNeutrik ? Math.round(size * 0.22) : "50%";
  // Teinte = couleur de la famille (1re fonction), repli sur la couleur propre.
  const color = familyColor ?? slot?.connectorType?.color ?? NEUTRAL_COLOR;
  const highlight = isOver || isDragTarget;
  // Une seule enveloppe (pas de double contour) : la bordure du conteneur EST
  // le contour visible (cercle / coque carrée). Effacée seulement quand une
  // image D custom dessine déjà sa propre coque.
  const border = customD
    ? "1px solid transparent"
    : highlight
      ? "1.5px solid var(--accent)" // arkyo-server: habillage Strata (cible du dépôt : accent)
      : isSelected
        ? `2px solid ${color}`
        : occupied
          ? `1px solid ${color}`
          : "1px dashed rgba(0,0,0,0.22)";

  return (
    <div
      ref={setNodeRef}
      {...(occupied ? listeners : {})}
      {...(occupied ? attributes : {})}
      className={cn(
        "group relative flex items-center justify-center transition-all select-none",
        occupied ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        background: "transparent",
        border,
        boxShadow: isSelected ? `0 0 0 2px ${color}44` : undefined,
        opacity: isDragging ? 0.3 : 1,
      }}
      onClick={(e) => {
        if (occupied && slot) {
          e.stopPropagation();
          onSelect(slot);
        }
      }}
    >
      {occupied && slot?.connectorType && (
        customD ? (
          <img
            src={customD}
            alt=""
            width={iconSize}
            height={iconSize}
            style={{ objectFit: "contain" }}
          />
        ) : (
          <>
            {isNeutrik && <TorxDots color={color} box={size} />}
            <ConnectorIcon iconId={slot.connectorType.iconId} color={color} size={iconSize} />
          </>
        )
      )}
    </div>
  );
}

// ── Connecteur draggable (barre latérale) ─────────────────────────────────

function DraggableConnector({
  connector,
  catColor,
  iconColor,
  familyKey,
  familyLabel,
}: {
  connector: ConnectorType;
  catColor: string;
  /** Couleur du groupe (famille) dans lequel la carte est affichée. */
  iconColor: string;
  /** Clé du groupe — rend l'id draggable unique quand un connecteur
   *  multi-familles apparaît dans plusieurs groupes. */
  familyKey: string;
  /** Label de la famille du groupe — persisté sur le slot à la pose. */
  familyLabel: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `connector-${familyKey}-${connector.id}`,
    data: { type: "connector", connectorId: connector.id, familyLabel },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 rounded-xl border transition-all select-none",
        isDragging
          ? "opacity-40"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5",
      )}
    >
      {/* Grip */}
      <div
        {...attributes}
        {...listeners}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-l-xl transition-colors hover:bg-[var(--border)] active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-2">
        {/* Symboles — teintés par la couleur de famille. Deux représentations
            à MÊME empreinte quand le connecteur existe en D : face générique
            + coque D autonome (`DCoque`, contour = coque, glyphe dedans). */}
        <div className="flex shrink-0 items-center gap-1.5">
          <ConnectorIcon iconId={connector.iconId} color={iconColor} size={20} />
          {connector.hasNeutrikD && (
            <DCoque connector={connector} color={iconColor} size={20} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* Nom + version */}
          <p className="truncate text-xs leading-tight font-medium">
            {connector.name}
            {connector.version ? ` ${connector.version}` : ""}
          </p>
          {/* Catégorie dot */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: catColor }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal placement connecteur ────────────────────────────────────────────

function PlaceConnectorModal({
  connector,
  fromPosition,
  panel,
  slotMap,
  familyColor,
  onConfirm,
  onCancel,
}: {
  connector: ConnectorType;
  fromPosition: number;
  panel: PanelData;
  slotMap: Record<number, PanelSlot>;
  /** Couleur de la famille (1re fonction) — teinte l'en-tête + l'icône générique. */
  familyColor: string;
  onConfirm: (positions: number[], mountD: boolean) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"unique" | "ligne" | "panel" | "custom">("unique");
  const [customCount, setCustomCount] = useState("1");
  // Choix du montage : générique (défaut) ou coque Neutrik D. Proposé seulement
  // si le connecteur existe en D et si le panneau reste sous 16 découpes/U.
  const [mountD, setMountD] = useState(false);
  const canChooseD = connector.hasNeutrikD && panel.slotsPerU <= 16;

  const totalSlots = panel.heightU * panel.slotsPerU;

  // Calcul des positions libres à partir de fromPosition
  const freeFromHere = useMemo(() => {
    const all: number[] = [];
    for (let i = fromPosition; i <= totalSlots; i++) {
      if (!slotMap[i]) all.push(i);
    }
    return all;
  }, [fromPosition, totalSlots, slotMap]);

  // Positions libres sur la même ligne (même rangée U)
  const rowIndex = Math.ceil(fromPosition / panel.slotsPerU) - 1;
  const rowStart = rowIndex * panel.slotsPerU + 1;
  const rowEnd = rowStart + panel.slotsPerU - 1;
  const freeInRow = useMemo(() => {
    const all: number[] = [];
    for (let i = fromPosition; i <= rowEnd; i++) {
      if (!slotMap[i]) all.push(i);
    }
    return all;
  }, [fromPosition, rowEnd, slotMap]);

  const getPositions = (): number[] => {
    if (mode === "unique") return [fromPosition];
    if (mode === "ligne") return freeInRow;
    if (mode === "panel") return freeFromHere;
    const n = Math.min(parseInt(customCount) || 1, freeFromHere.length);
    return freeFromHere.slice(0, n);
  };

  const count = getPositions().length;

  const options = [
    { key: "unique" as const, label: "Unique", sub: "1 slot", n: 1 },
    {
      key: "ligne" as const,
      label: "Toute la ligne",
      sub: `${freeInRow.length} slots libres`,
      n: freeInRow.length,
    },
    {
      key: "panel" as const,
      label: "Tout le panel",
      sub: `${freeFromHere.length} slots libres`,
      n: freeFromHere.length,
    },
    { key: "custom" as const, label: "Nombre personnalisé", sub: null, n: null },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[340px] space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `${familyColor}22`, border: `1.5px solid ${familyColor}` }}
          >
            <ConnectorIcon iconId={connector.iconId} color={familyColor} size={16} />
          </div>
          <div>
            <p className="text-sm leading-none font-semibold">{connectorLabel(connector)}</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Depuis le slot {fromPosition}
            </p>
          </div>
        </div>

        {/* Choix du montage — générique / Neutrik D (gros boutons à icône).
            Visible uniquement pour les connecteurs existant en coque D et sous
            la limite physique de 16 découpes/U. Sinon : pose générique directe. */}
        {canChooseD && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
              Montage
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMountD(false)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border px-2 py-3 transition-all",
                  !mountD
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] hover:border-[var(--accent)]/40",
                )}
              >
                <ConnectorIcon iconId={connector.iconId} color={familyColor} size={34} />
                <span
                  className={cn(
                    "text-xs font-semibold",
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                    !mountD ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]",
                  )}
                >
                  Générique
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMountD(true)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border px-2 py-3 transition-all",
                  mountD
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] hover:border-[var(--accent)]/40",
                )}
              >
                <span className={mountD ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}>
                  <NeutrikLogo size={34} />
                </span>
                <span
                  className={cn(
                    "text-xs font-semibold",
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                    mountD ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]",
                  )}
                >
                  Neutrik D
                </span>
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setMode(opt.key)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all",
                mode === opt.key
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] hover:border-[var(--accent)]/40",
              )}
            >
              <span
                className={cn(
                  "text-sm font-medium",
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                  mode === opt.key ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]",
                )}
              >
                {opt.label}
              </span>
              {opt.sub && (
                <span className="text-[11px] text-[var(--muted-foreground)]">{opt.sub}</span>
              )}
              {opt.key === "custom" && mode === "custom" && (
                <input
                  type="number"
                  min={1}
                  max={freeFromHere.length}
                  value={customCount}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setCustomCount(e.target.value)}
                  className="h-7 w-16 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-right text-sm focus-visible:ring-1 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  autoFocus
                />
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="h-8 flex-1 rounded-lg border border-[var(--border)] text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)]"
          >
            Annuler
          </button>
          <button
            onClick={() => onConfirm(getPositions(), canChooseD ? mountD : false)}
            disabled={count === 0}
            // arkyo-server: habillage Strata (texte sur accent plein : --accent-foreground)
            className="h-8 flex-1 rounded-lg bg-[var(--accent)] text-xs font-medium text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Placer {count > 1 ? `${count} connecteurs` : "le connecteur"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Panel propriétés inline ────────────────────────────────────────────────

// ── OptionRow / Switch — pattern accordéon aligné sur RackConfigInline ──────

function PanelSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-[var(--accent)]" : "bg-[var(--muted)]", // arkyo-server: habillage Strata
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full shadow transition-transform", // arkyo-server: habillage Strata
          checked ? "translate-x-[18px] bg-white" : "translate-x-0 bg-[var(--muted-foreground)]", // arkyo-server: habillage Strata
        )}
      />
    </button>
  );
}

function PanelOptionRow({
  icon: Icon,
  label,
  checked,
  onToggle,
  expandable = true,
  children,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  checked?: boolean;
  onToggle?: (v: boolean) => void;
  expandable?: boolean;
  children?: React.ReactNode;
  badge?: string | number;
}) {
  const [open, setOpen] = useState(false);
  const isExpandable = expandable && !!children && (checked === undefined || checked);
  return (
    <div className="border-border bg-card rounded-md border">
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-2 text-[11px] select-none",
          isExpandable && "hover:bg-muted/40 cursor-pointer",
        )}
        onClick={() => {
          if (isExpandable) setOpen((v) => !v);
        }}
      >
        <Icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 font-medium">{label}</span>
        {badge !== undefined && (
          <span className="text-muted-foreground font-mono text-[10px]">{badge}</span>
        )}
        {onToggle !== undefined && checked !== undefined && (
          <PanelSwitch checked={checked} onChange={onToggle} />
        )}
        {isExpandable && (
          <ChevronRight
            className={cn(
              "text-muted-foreground h-3.5 w-3.5 transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </div>
      {isExpandable && open && (
        <div className="border-border flex flex-col gap-3 border-t px-2.5 py-2.5">{children}</div>
      )}
    </div>
  );
}

// ── Panneau propriétés — design aligné sur rack TemplateInventoryProperties ──

function PanelInventoryProperties({
  panel,
  slots,
  onSaved,
  onReset,
  notifySave,
}: {
  panel: PanelData;
  slots: PanelSlot[];
  onSaved: (updated: Partial<PanelData>, cleared: boolean) => void;
  onReset: () => void;
  notifySave?: (status: "saving" | "saved" | "error") => void;
}) {
  const occupiedCount = slots.filter((s) => s.connectorTypeId).length;
  const totalSlots = panel.heightU * panel.slotsPerU;
  const freeSlots = totalSlots - occupiedCount;

  const [heightU, setHeightU] = useState(panel.heightU);
  const [slotsPerU, setSlotsPerU] = useState(panel.slotsPerU);
  const [rearCableDepthMm, setRearCableDepthMm] = useState(panel.rearCableDepthMm ?? 80);
  const [notes, setNotes] = useState(panel.notes ?? "");

  // Sync when panel changes externally (SSE / save callback).
  useEffect(() => setHeightU(panel.heightU), [panel.heightU]);
  useEffect(() => setSlotsPerU(panel.slotsPerU), [panel.slotsPerU]);
  useEffect(() => setRearCableDepthMm(panel.rearCableDepthMm ?? 80), [panel.rearCableDepthMm]);
  useEffect(() => setNotes(panel.notes ?? ""), [panel.notes]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // autoSave avec debounce 400ms — fire 1 seule requête à la fin d'une rafale
  // d'updates. Pipe notifySave pour afficher le badge vert.
  const autoSave = useCallback(
    (patch: Record<string, unknown>, cleared = false) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        notifySave?.("saving");
        try {
          const res = await fetch(`/api/panels/${panel.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (res.ok) {
            onSaved(patch as Partial<PanelData>, cleared);
            notifySave?.("saved");
          } else {
            notifySave?.("error");
          }
        } catch {
          notifySave?.("error");
        }
      }, 400);
    },
    [panel.id, onSaved, notifySave],
  );

  const handleRename = async (newName: string) => {
    const trimmed = newName.trim() || panel.name;
    notifySave?.("saving");
    try {
      const res = await fetch(`/api/panels/${panel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        onSaved({ name: trimmed }, false);
        notifySave?.("saved");
      } else {
        notifySave?.("error");
      }
    } catch {
      notifySave?.("error");
    }
  };

  const handleHeightChange = (u: number) => {
    setHeightU(u);
    // Changement de hauteur → vide le panneau si des connecteurs y sont posés.
    // L'utilisateur a déjà confirmé via le drag du slider ou le clic preset —
    // pas de confirm bloquant ici (cohérence avec le rack et l'autosave debounce).
    const cleared = occupiedCount > 0 && u !== panel.heightU;
    autoSave({ heightU: u }, cleared);
  };

  const handleSlotsPerUChange = (n: number) => {
    setSlotsPerU(n);
    const cleared = occupiedCount > 0 && n !== panel.slotsPerU;
    autoSave({ slotsPerU: n }, cleared);
  };

  const handleRearDepthChange = (v: number) => {
    setRearCableDepthMm(v);
    autoSave({ rearCableDepthMm: v });
  };

  const handleNotesChange = (v: string) => {
    setNotes(v);
    autoSave({ notes: v || null });
  };

  const btnPreset = (active: boolean) =>
    cn(
      "py-1 rounded-md border text-[10px] font-bold transition-all",
      active
        // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]"
        : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40",
    );

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      {/* En-tête : type + NameInput (pattern rack TemplateInventoryProperties) */}
      <div>
        <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
          Panneau ({panel.heightU}U)
        </div>
        <NameInput rackName={panel.name} onRackNameChange={handleRename} />
      </div>

      {/* 2 InfoCards — Slots occupés / libres */}
      <div className="flex gap-2">
        <InfoCard
          icon={<LayoutGrid className="h-4 w-4" />}
          label="Occupés"
          value={`${occupiedCount} / ${totalSlots}`}
          className="flex-1"
        />
        <InfoCard
          icon={<Layers className="h-4 w-4" />}
          label="Libres"
          value={String(freeSlots)}
          className="flex-1"
        />
      </div>

      {/* Hauteur U — accordéon */}
      <PanelOptionRow icon={Layers} label="Hauteur" badge={`${heightU}U`}>
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => handleHeightChange(u)}
              className={btnPreset(heightU === u)}
            >
              {u}U
            </button>
          ))}
        </div>
      </PanelOptionRow>

      {/* Densité slots/U */}
      <PanelOptionRow icon={LayoutGrid} label="Densité" badge={`${slotsPerU}/U`}>
        <div className="grid grid-cols-4 gap-1">
          {([8, 12, 16, 24] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleSlotsPerUChange(n)}
              className={btnPreset(slotsPerU === n)}
            >
              {n}
            </button>
          ))}
        </div>
      </PanelOptionRow>

      {/* Câblage arrière */}
      <PanelOptionRow icon={GripVertical} label="Câblage arrière" badge={`${rearCableDepthMm}mm`}>
        <div>
          <input
            type="range"
            min={30}
            max={300}
            step={5}
            value={rearCableDepthMm}
            onChange={(e) => setRearCableDepthMm(Number(e.target.value))}
            onPointerUp={(e) =>
              handleRearDepthChange(Number((e.currentTarget as HTMLInputElement).value))
            }
            onKeyUp={(e) =>
              handleRearDepthChange(Number((e.currentTarget as HTMLInputElement).value))
            }
            className="w-full accent-[var(--accent)]"
          />
          <div className="text-muted-foreground mt-0.5 flex justify-between text-[9px]">
            <span>30 mm</span>
            <span>300 mm</span>
          </div>
        </div>
      </PanelOptionRow>

      {/* Notes */}
      <PanelOptionRow
        icon={Settings}
        label="Notes"
        badge={notes ? `${notes.length}` : undefined}
      >
        <textarea
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          rows={3}
          placeholder="Description, contexte, références…"
          className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[11px] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
        />
      </PanelOptionRow>

      {/* Actions destructives — Vider le panneau (uniquement si occupé) */}
      {occupiedCount > 0 && (
        <div className="border-border mt-2 flex flex-col gap-1.5 border-t pt-2">
          <SectionTitle>Actions</SectionTitle>
          <ActionButton
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            label="Vider le panneau"
            onClick={onReset}
            danger
          />
        </div>
      )}
    </div>
  );
}

// ── Composant legacy conservé (référencé ailleurs ?) ───────────────────────────

function PanelConfigInline({
  panel,
  slots,
  onSaved,
  onReset,
}: {
  panel: PanelData;
  slots: PanelSlot[];
  onSaved: (updated: Partial<PanelData>, cleared: boolean) => void;
  onReset: () => void;
}) {
  const occupiedCount = slots.filter((s) => s.connectorTypeId).length;
  const totalSlots = panel.heightU * panel.slotsPerU;
  const fillPct = totalSlots > 0 ? Math.round((occupiedCount / totalSlots) * 100) : 0;

  const [name, setName] = useState(panel.name);
  const [heightU, setHeightU] = useState(panel.heightU);
  const [slotsPerU, setSlotsPerU] = useState(panel.slotsPerU);
  const [rearCableDepthMm, setRearCableDepthMm] = useState(panel.rearCableDepthMm ?? 80);
  const [notes, setNotes] = useState(panel.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Sync when panel changes externally (SSE)
  useEffect(() => {
    setName(panel.name);
  }, [panel.name]);
  useEffect(() => {
    setHeightU(panel.heightU);
  }, [panel.heightU]);
  useEffect(() => {
    setSlotsPerU(panel.slotsPerU);
  }, [panel.slotsPerU]);
  useEffect(() => {
    setRearCableDepthMm(panel.rearCableDepthMm ?? 80);
  }, [panel.rearCableDepthMm]);
  useEffect(() => {
    setNotes(panel.notes ?? "");
  }, [panel.notes]);

  const dimensionsChanged = heightU !== panel.heightU || slotsPerU !== panel.slotsPerU;
  const willClear = dimensionsChanged && occupiedCount > 0;
  const isDirty =
    name !== panel.name ||
    dimensionsChanged ||
    rearCableDepthMm !== (panel.rearCableDepthMm ?? 80) ||
    notes !== (panel.notes ?? "");

  const fieldCls =
    "flex h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]/50";
  const btnPreset = (active: boolean) =>
    cn(
      "py-1.5 rounded-lg border text-[11px] font-bold transition-all",
      active
        // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
        : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40",
    );

  const doSave = async () => {
    setSaving(true);
    const body = {
      name: name.trim() || panel.name,
      heightU,
      slotsPerU,
      rearCableDepthMm,
      notes: notes || null,
    };
    const res = await fetch(`/api/panels/${panel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setConfirmClear(false);
    if (res.ok) onSaved(body, dimensionsChanged);
  };

  const handleSave = () => {
    if (willClear && !confirmClear) {
      setConfirmClear(true);
      return;
    }
    doSave();
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats occupation */}
      <div className="space-y-3 border-b border-[var(--border)] px-4 pt-4 pb-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
              Occupation
            </p>
            <span className="text-[10px] font-bold text-[var(--foreground)] tabular-nums">
              {occupiedCount}/{totalSlots} slots
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ background: "var(--secondary)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${fillPct}%`, background: "var(--accent)" }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div
            className="rounded-xl border border-[var(--border)] p-2.5"
            style={{ background: "var(--background)" }}
          >
            <p className="mb-1 text-[10px] text-[var(--muted-foreground)]">Occupés</p>
            <p className="text-sm font-bold text-[var(--accent)] tabular-nums">{occupiedCount}</p>
          </div>
          <div
            className="rounded-xl border border-[var(--border)] p-2.5"
            style={{ background: "var(--background)" }}
          >
            <p className="mb-1 text-[10px] text-[var(--muted-foreground)]">Libres</p>
            <p className="text-sm font-bold text-[var(--foreground)] tabular-nums">
              {totalSlots - occupiedCount}
            </p>
          </div>
        </div>
      </div>

      {/* Formulaire */}
      <div className="space-y-5 px-4 py-4">
        {/* Nom */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Nom
          </label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
        </div>

        {/* Hauteur U */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
              Hauteur
            </label>
            <span className="text-[11px] font-bold text-[var(--accent)]">{heightU}U</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {Array.from({ length: 8 }, (_, i) => i + 1).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setHeightU(u)}
                className={btnPreset(heightU === u)}
              >
                {u}U
              </button>
            ))}
          </div>
        </div>

        {/* Slots / U */}
        <div className="space-y-2">
          <label className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Densité (slots / U)
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {([8, 12, 16, 24] as const).map((n) => {
              const hasNeutrik = n <= 16;
              const active = slotsPerU === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSlotsPerU(n)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2 text-center transition-all",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)]/10"
                      : "border-[var(--border)] hover:border-[var(--accent)]/40",
                  )}
                >
                  <span
                    className={cn(
                      "text-sm leading-none font-black tabular-nums",
                      // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                      active ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]",
                    )}
                  >
                    {n}
                  </span>
                  <div className="flex items-center justify-center gap-0.5">
                    {hasNeutrik && (
                      <svg
                        width={13}
                        height={13}
                        viewBox="0 0 40 40"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <circle cx="20" cy="20" r="20" fill="#52525b" />
                        <circle
                          cx="20"
                          cy="20"
                          r="14"
                          fill="none"
                          stroke="#E8E8E8"
                          strokeWidth="2.5"
                        />
                        <circle
                          cx="20"
                          cy="20"
                          r="9"
                          fill="none"
                          stroke="#E8E8E8"
                          strokeWidth="2"
                        />
                        <line
                          x1="20"
                          y1="11"
                          x2="20"
                          y2="29"
                          stroke="#E8E8E8"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M20 15 Q15 15 15 20"
                          stroke="#E8E8E8"
                          strokeWidth="2.2"
                          fill="none"
                          strokeLinecap="round"
                        />
                        <path
                          d="M20 15 Q25 15 25 20"
                          stroke="#E8E8E8"
                          strokeWidth="2.2"
                          fill="none"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                    <svg
                      width={13}
                      height={13}
                      viewBox="0 0 32 32"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect width="32" height="32" rx="6" fill="#52525b" />
                      <text
                        x="16"
                        y="22"
                        textAnchor="middle"
                        fontSize="18"
                        fontWeight="700"
                        fontFamily="system-ui,sans-serif"
                        fill="white"
                      >
                        G
                      </text>
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Câblage arrière */}
        <div
          className="space-y-2 rounded-xl border border-[var(--border)] p-3"
          style={{ background: "var(--background)" }}
        >
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
              Câblage arrière
            </label>
            <span className="text-[11px] font-bold text-[var(--accent)] tabular-nums">
              {rearCableDepthMm} mm
            </span>
          </div>
          <input
            type="range"
            min={30}
            max={300}
            step={5}
            value={rearCableDepthMm}
            onChange={(e) => setRearCableDepthMm(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[9px] text-[var(--muted-foreground)]">
            <span>30 mm</span>
            <span>300 mm</span>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="flex w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[12px] focus-visible:ring-1 focus-visible:ring-[var(--accent)]/50 focus-visible:outline-none"
          />
        </div>

        {/* Avertissement vidage */}
        {confirmClear && (
          <div
            // arkyo-server: habillage Strata (alerte : --warning, icône en --warning-text)
            className="space-y-3 rounded-xl border border-[var(--warning)]/30 p-3"
            style={{ background: "color-mix(in srgb, var(--warning) 6%, transparent)" }}
          >
            <div className="flex items-start gap-2">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning-text)]" />
              <div>
                <p className="text-xs font-semibold text-[var(--foreground)]">
                  Le panneau sera vidé
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                  {occupiedCount} connecteur{occupiedCount > 1 ? "s" : ""} seront supprimés.
                </p>
              </div>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setConfirmClear(false)}
                className="h-8 flex-1 rounded-lg border border-[var(--border)] text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                Annuler
              </button>
              <button
                onClick={doSave}
                disabled={saving}
                // arkyo-server: habillage Strata (alerte pleine : fond --warning-text, texte --surface)
                className="h-8 flex-1 rounded-lg bg-[var(--warning-text)] text-[11px] font-semibold text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Confirmer
              </button>
            </div>
          </div>
        )}

        {/* Enregistrer */}
        {isDirty && !confirmClear && (
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            // arkyo-server: habillage Strata (texte sur accent plein : --accent-foreground)
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Sauvegarde…" : "Enregistrer"}
          </button>
        )}

        {/* Vider */}
        {occupiedCount > 0 && (
          <button
            onClick={onReset}
            // arkyo-server: habillage Strata (danger : --danger, texte en --danger-text)
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--danger)]/30 text-[11px] font-semibold text-[var(--danger-text)] transition-colors hover:bg-[var(--danger)]/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Vider le panneau
          </button>
        )}
      </div>
    </div>
  );
}

// ── PanelEditor principal ─────────────────────────────────────────────────

export function PanelEditor({
  panel: initialPanel,
  availableConnectors,
  connectorCategories,
  tenantName,
}: {
  panel: PanelData;
  availableConnectors: ConnectorType[];
  connectorCategories: { name: string; color: string }[];
  /** Nom du tenant — affiché dans le lockup arkyo.io | Tenant. */
  tenantName?: string | null;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState(initialPanel);
  const [slots, setSlots] = useState<PanelSlot[]>(initialPanel.slots);
  const pendingDrag = useRef(false);

  // Maps catégories de connecteurs (key → color / label)
  const catColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of connectorCategories) m[c.name] = c.color;
    return m;
  }, [connectorCategories]);

  // Couleur de la famille d'un connecteur = couleur de sa 1re fonction.
  // Résolution PAR ID via la palette : le `connectorType` d'un slot posé
  // vient de l'enrichisseur serveur (CatalogConnectorTypeLite) dont
  // `category` est null — seul l'id est fiable des deux côtés.
  const familyColorById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of availableConnectors) {
      m[c.id] = catColorMap[c.category] || c.color || NEUTRAL_COLOR;
    }
    return m;
  }, [availableConnectors, catColorMap]);

  const familyColorOf = useCallback(
    (c: ConnectorType | null | undefined): string => {
      if (!c) return NEUTRAL_COLOR;
      return (
        familyColorById[c.id] ??
        (catColorMap[c.category] || c.color || NEUTRAL_COLOR)
      );
    },
    [familyColorById, catColorMap],
  );

  // Couleur d'un SLOT posé : la famille choisie au drag (persistée sur le
  // slot) prime — un BNC glissé depuis le groupe RF reste rose. Repli : 1re
  // fonction du connecteur.
  const slotFamilyColor = useCallback(
    (slot: PanelSlot | null | undefined): string => {
      if (!slot) return NEUTRAL_COLOR;
      if (slot.familyLabel && catColorMap[slot.familyLabel]) {
        return catColorMap[slot.familyLabel];
      }
      return familyColorOf(slot.connectorType);
    },
    [catColorMap, familyColorOf],
  );

  // Liste distincte des noms de connecteurs disponibles (pour le filtre
  // multi-sélection « Connecteur » de la sous-topbar).
  const availableConnectorNames = useMemo(() => {
    const set = new Set<string>();
    for (const c of availableConnectors) set.add(c.name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [availableConnectors]);

  // Sync temps réel — re-fetch depuis l'API sur tout event SSE concernant ce panel
  useEffect(() => {
    return subscribeAppEvents((data) => {
      const payload = data as { type?: string; entity?: string; id?: string } | null;
      if (!payload) return;
      if (payload.type === "ping" || payload.type === "connected") return;
      if (pendingDrag.current) return; // ne pas interrompre un drag en cours
      fetch(`/api/panels/${initialPanel.id}`)
        .then((r) => r.json())
        .then((d) => {
          setPanel(d);
          setSlots(d.slots ?? []);
        })
        .catch(() => {});
    });
  }, [initialPanel.id]);

  const [showReset, setShowReset] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<PanelSlot | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [search, setSearch] = useState("");
  // gender filter removed — gender now lives on equipment ConnectorEntry, not on ConnectorType
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  // Filtre par nom de connecteur (ex. BNC, XLR…) — multi-sélection. Indépendant
  // du champ recherche libre : permet de cibler précisément un sous-ensemble
  // sans avoir à connaître l'orthographe exacte.
  const [activeConnectorNames, setActiveConnectorNames] = useState<Set<string>>(
    new Set(),
  );
  const [sortBy, setSortBy] = useState<"name-asc" | "name-desc">("name-asc");
  // groupMode + openGroups (ex-accordéon) supprimés : liste plate par catégorie
  // (pattern catalog-panel.tsx du mode inventaire) — pas de toggle ouvert/fermé.
  const [zoom, setZoom] = useState(1);
  // Statut de sauvegarde — alimenté par les handlers de PanelInventoryProperties
  // (autoSave + clear) et lu par le badge vert "Enregistré" dans la sous-topbar.
  // Auto-hide après 2.2s (succès) ou 4s (erreur), pattern aligné sur project-editor.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (saveStatus !== "saved" && saveStatus !== "error") return;
    const ms = saveStatus === "saved" ? 2200 : 4000;
    const t = setTimeout(() => setSaveStatus("idle"), ms);
    return () => clearTimeout(t);
  }, [saveStatus]);
  // Outil actif dans la barre d'outils gauche. La palette "connectors" ouvre
  // le side panel ; les autres outils (select/pan/move) ne ferment pas le
  // panel mais changent le cursor / l'interaction canvas.
  const [activeTool, setActiveTool] = useState<
    "select" | "pan" | "move" | "connectors"
  >("connectors");
  const contextOpen = activeTool === "connectors";
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [pendingPlace, setPendingPlace] = useState<{
    connectorId: string;
    fromPosition: number;
    familyLabel: string | null;
  } | null>(null);
  const [overSlotPos, setOverSlotPos] = useState<number | null>(null);
  const panelAreaRef = useRef<HTMLDivElement>(null);
  // Ref sur le div à l'échelle (`transform: scale(zoom)`) — sert de repère
  // exact écran→monde pour les curseurs live (sa bounding box inclut le scale).
  const panelScaleRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // ── Curseurs live (Phase 3b) ─────────────────────────────────────────────
  // Salle = "panel:{panelId}". Le serveur préfixe le tenant. Tout est silencieux
  // si le service WS est absent. Repère MONDE = espace LOCAL du panneau (pixels,
  // origine au coin haut-gauche du panneau, indépendant du scroll/zoom de chaque
  // client) — stable et partagé entre participants. Sélections distantes NON
  // câblées ici (curseurs seuls).
  const { peers: livePeers, sendCursor: sendLiveCursor } = useLiveCursors(
    `panel:${panel.id}`,
  );
  const sendLiveCursorRef = useRef(sendLiveCursor);
  sendLiveCursorRef.current = sendLiveCursor;

  const slotMap = useMemo(() => {
    const m: Record<number, PanelSlot> = {};
    for (const s of slots) m[s.position] = s;
    return m;
  }, [slots]);

  // Sync selectedSlot avec les données live (SSE / suppression)
  useEffect(() => {
    if (!selectedSlot) return;
    const live = slots.find((s) => s.id === selectedSlot.id);
    if (!live) setSelectedSlot(null);
    else if (live !== selectedSlot) setSelectedSlot(live);
  }, [slots, selectedSlot]);

  const activeFilterCount = activeCategories.size;

  const filtered = useMemo(() => {
    const list = availableConnectors.filter((c) => {
      // Match si AU MOINS une catégorie du connecteur est dans le filtre actif.
      if (
        activeCategories.size > 0 &&
        !c.categories.some((cat) => activeCategories.has(cat))
      )
        return false;
      // Filtre par nom de connecteur (multi-sélection).
      if (activeConnectorNames.size > 0 && !activeConnectorNames.has(c.name))
        return false;
      if (search) {
        const q = search.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !(c.version ?? "").toLowerCase().includes(q))
          return false;
      }
      return true;
    });
    list.sort((a, b) =>
      sortBy === "name-asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name),
    );
    return list;
  }, [availableConnectors, search, activeCategories, activeConnectorNames, sortBy]);

  // Regroupement par Catégorie compatible (= CatalogFunction.label).
  // - Sans filtre catégorie : un connecteur avec N catégories apparaît dans N
  //   groupes (recherche par usage).
  // - Avec filtre catégorie actif : on n'affiche QUE les groupes filtrés, et
  //   chaque connecteur n'apparaît que sous les catégories sélectionnées —
  //   pas dans ses autres catégories compatibles.
  type Group = { key: string; label: string; color: string; items: ConnectorType[] };

  const groups = useMemo((): Group[] => {
    const map: Record<string, ConnectorType[]> = {};
    for (const c of filtered) {
      for (const cat of c.categories) {
        if (activeCategories.size > 0 && !activeCategories.has(cat)) continue;
        (map[cat] ??= []).push(c);
      }
    }
    return Object.entries(map).map(([cat, items]) => ({
      key: cat,
      label: cat,
      color: catColorMap[cat] ?? "#888",
      items,
    }));
  }, [filtered, activeCategories, catColorMap]);

  const fitAll = useCallback(() => {
    const contentW = PANEL_TOTAL_W + 48;
    const contentH = panel.heightU * U_H + 80;
    const availW = (panelAreaRef.current?.clientWidth ?? window.innerWidth - 224) - 48;
    const availH = window.innerHeight - 56 - 48;
    const z = Math.min(2, Math.max(0.15, Math.min(availW / contentW, availH / contentH)));
    setZoom(parseFloat(z.toFixed(2)));
  }, [panel.heightU]);

  useEffect(() => {
    const t = setTimeout(fitAll, 60);
    return () => clearTimeout(t);
  }, [fitAll]);

  useEffect(() => {
    const el = panelAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) => Math.min(2, Math.max(0.3, z - e.deltaY * 0.002)));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Diffusion curseur live (coords MONDE = pixels panneau) ────────────────
  // Le repère MONDE est l'espace LOCAL du panneau (origine = coin haut-gauche du
  // div à l'échelle). La bounding box de `panelScaleRef` inclut déjà le
  // `scale(zoom)` (origine centre) : un point local (wx,wy) est à l'écran en
  // rect.left + wx*zoom / rect.top + wy*zoom → on inverse. L'overlay, monté DANS
  // ce div à l'échelle, applique la contre-échelle 1/zoom. Throttle 33 Hz intégré.
  useEffect(() => {
    const el = panelAreaRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const box = panelScaleRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const z = zoomRef.current || 1;
      const wx = (e.clientX - rect.left) / z;
      const wy = (e.clientY - rect.top) / z;
      sendLiveCursorRef.current(wx, wy);
    };
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, []);

  const rows = useMemo(() => {
    const r: number[][] = [];
    for (let u = 0; u < panel.heightU; u++) {
      const row: number[] = [];
      for (let s = 0; s < panel.slotsPerU; s++) row.push(u * panel.slotsPerU + s + 1);
      r.push(row);
    }
    return r;
  }, [panel.heightU, panel.slotsPerU]);

  const totalSlots = panel.heightU * panel.slotsPerU;
  const occupiedSlots = slots.filter((s) => s.connectorTypeId).length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 10 } }),
  );

  const handleDragStart = (e: DragStartEvent) => {
    pendingDrag.current = true;
    const data = e.active.data.current;
    if (data?.type === "connector") {
      const connector = availableConnectors.find((c) => c.id === data.connectorId);
      if (connector)
        setActiveDrag({
          kind: "connector",
          connector,
          familyLabel: (data.familyLabel as string | null | undefined) ?? null,
        });
    } else if (data?.type === "panel_slot" && data.slot) {
      setActiveDrag({ kind: "panel_slot", slot: data.slot });
    }
  };

  const handleDragOver = (e: DragOverEvent) => {
    const overId = String(e.over?.id ?? "");
    if (overId.startsWith("slot-")) {
      setOverSlotPos(parseInt(overId.replace("slot-", ""), 10));
    } else {
      setOverSlotPos(null);
    }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    pendingDrag.current = false;
    const prev = activeDrag;
    setActiveDrag(null);
    setOverSlotPos(null);
    const { active, over } = e;

    // Déposer un slot occupé dans la poubelle ou en dehors → supprimer
    if (prev?.kind === "panel_slot") {
      if (!over || over.id === "trash-zone") {
        await handleRemove(prev.slot.id);
        return;
      }
      const overId = String(over.id);
      if (!overId.startsWith("slot-")) return;
      const targetPos = parseInt(overId.replace("slot-", ""), 10);
      if (targetPos === prev.slot.position) return; // même position
      if (slotMap[targetPos]) return; // cible déjà occupée

      // Déplacer le slot vers la nouvelle position
      const res = await fetch(`/api/panels/${panel.id}/slots/${prev.slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: targetPos }),
      });
      if (!res.ok) return;
      const updated: PanelSlot = await res.json();
      setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      return;
    }

    // Déposer un connecteur depuis la barre latérale → ouvrir modal de quantité
    if (prev?.kind === "connector") {
      if (!over) return;
      const overId = String(over.id);
      if (!overId.startsWith("slot-")) return;
      const position = parseInt(overId.replace("slot-", ""), 10);
      if (slotMap[position]) return;

      const dragData = active.data.current as
        | { type?: string; connectorId?: string; familyLabel?: string | null }
        | undefined;
      if (dragData?.type !== "connector" || !dragData.connectorId) return;

      setPendingPlace({
        connectorId: dragData.connectorId,
        fromPosition: position,
        familyLabel: dragData.familyLabel ?? null,
      });
    }
  };

  const handleRemove = useCallback(
    async (slotId: string) => {
      setSaveStatus("saving");
      const res = await fetch(`/api/panels/${panel.id}/slots/${slotId}`, { method: "DELETE" });
      if (!res.ok) {
        setSaveStatus("error");
        return;
      }
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
      setSaveStatus("saved");
    },
    [panel.id],
  );

  // Pose / retrait de la coque Neutrik D sur un slot. Maj optimiste, avec
  // rollback si l'API refuse (connecteur sans D ou panneau > 16/U → 400).
  const handleToggleMountD = useCallback(
    async (slot: PanelSlot, mountD: boolean) => {
      setSaveStatus("saving");
      setSlots((prev) => prev.map((s) => (s.id === slot.id ? { ...s, mountD } : s)));
      try {
        const res = await fetch(`/api/panels/${panel.id}/slots/${slot.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mountD }),
        });
        if (!res.ok) {
          setSlots((prev) => prev.map((s) => (s.id === slot.id ? { ...s, mountD: !mountD } : s)));
          setSaveStatus("error");
          return;
        }
        const updated: PanelSlot = await res.json();
        setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSaveStatus("saved");
      } catch {
        setSlots((prev) => prev.map((s) => (s.id === slot.id ? { ...s, mountD: !mountD } : s)));
        setSaveStatus("error");
      }
    },
    [panel.id],
  );

  const handleReset = async () => {
    setSaveStatus("saving");
    const res = await fetch(`/api/panels/${panel.id}/slots`, { method: "DELETE" });
    setSlots([]);
    setShowReset(false);
    setSaveStatus(res.ok ? "saved" : "error");
  };

  const handlePlaceConnectors = async (
    connectorId: string,
    positions: number[],
    mountD: boolean,
    familyLabel: string | null,
  ) => {
    setSaveStatus("saving");
    const results = await Promise.all(
      positions.map((position) =>
        fetch(`/api/panels/${panel.id}/slots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            position,
            connectorTypeId: connectorId,
            sizeSlots: 1,
            mountD,
            familyLabel,
          }),
        }).then((r) => (r.ok ? r.json() : null)),
      ),
    );
    const newSlots = results.filter(Boolean) as PanelSlot[];
    setSlots((prev) => [...prev, ...newSlots]);
    setPendingPlace(null);
    setSaveStatus(newSlots.length === positions.length ? "saved" : "error");
  };

  const handleSettingsSaved = (updated: Partial<PanelData>, cleared: boolean) => {
    setPanel((prev) => ({ ...prev, ...updated }));
    if (cleared) setSlots([]);
    setTimeout(fitAll, 80);
  };

  const isDraggingSlot = activeDrag?.kind === "panel_slot";

  return (
    <DndContext
      id="panel-dnd"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div
        className="fixed right-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden bg-[var(--background)]"
        style={{ top: "calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))" }}
      >
        {/* ── Topbar — design aligné sur le rack-editor (GlobalTopbar) ── */}
        {/* arkyo-server: habillage Strata (topbar claire ou sombre selon le thème, comme la topbar principale) */}
        <div className="relative flex h-11 shrink-0 items-center gap-3 bg-[var(--surface)] px-3 text-[11px] text-[var(--muted-foreground)]">
          {/* Lockup Strata Arkyo | TenantName (arkyo-server: habillage Strata) */}
          <Link
            href="/dashboard"
            className="group flex shrink-0 items-center gap-2.5 transition-all"
            title={tenantName ? `Espace ${tenantName}` : "Accueil"}
          >
            {/* arkyo-server: habillage Strata */}
            <StrataBrand />
            {tenantName && (
              <>
                {/* arkyo-server: habillage Strata */}
                <span className="text-[13px] text-[var(--border-strong)]">|</span>
                <span className="text-[13px] font-medium text-[var(--text-tertiary)]">
                  {tenantName}
                </span>
              </>
            )}
          </Link>

          {/* Nom du panel — bold blanc cloud */}
          <div className="ml-2 flex min-w-0 items-center gap-6 text-[11px]">
            {/* arkyo-server: habillage Strata */}
            <span className="truncate text-[13px] font-bold uppercase text-[var(--foreground)]">
              {panel.name}
            </span>
          </div>

          <div className="flex-1" />

          {/* Croix discrète — pattern modal web, cohérent avec rack template mode */}
          <button
            type="button"
            onClick={() => router.back()}
            title="Fermer l'édition"
            aria-label="Fermer l'édition"
            // arkyo-server: habillage Strata
            className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors duration-150 hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Sous-topbar contextuelle — change selon l'outil actif.
            Pattern aligné sur rack ProjectContextualTopbar. Pour l'outil
            "connectors" : recherche + catégories + tri. Pour les autres :
            uniquement le label + shortcut du tool. */}
        <div className="relative flex h-9 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 text-xs">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[color-mix(in_srgb,var(--accent)_28%,transparent)]"
          />
          {(() => {
            const TOOL_META: Record<typeof activeTool, { label: string; shortcut?: string }> = {
              select: { label: "Sélection", shortcut: "V" },
              pan: { label: "Main", shortcut: "H" },
              move: { label: "Déplacer", shortcut: "M" },
              connectors: { label: "Connecteurs", shortcut: "C" },
            };
            const tool = TOOL_META[activeTool];
            return (
              <div className="flex shrink-0 items-center gap-2 border-r border-[var(--border)] pr-3">
                {tool.shortcut && (
                  <kbd
                    // arkyo-server: habillage Strata (touche inversée selon le thème : fond --foreground, texte --background)
                    className="inline-flex items-center rounded-md bg-[var(--foreground)] px-2 py-0.5 text-[10px] font-semibold text-[var(--background)] shadow-[0_1px_2px_rgba(0,0,0,0.15),inset_0_-1px_0_rgba(255,255,255,0.1)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {tool.shortcut}
                  </kbd>
                )}
                <span className="text-foreground text-[13px] font-semibold">{tool.label}</span>
              </div>
            );
          })()}

          {/* Filtres connecteurs — recherche + catégories + tri */}
          {activeTool === "connectors" && (
            <div className="flex flex-1 items-center gap-3 overflow-x-auto">
              <div className="relative shrink-0">
                <Search className="text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher…"
                  className="h-7 w-44 rounded-md border border-[var(--border)] bg-[var(--background)] pl-7 pr-2 text-[11px] outline-none transition-colors duration-150 hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
                />
              </div>
              {/* Sélecteur catégorie (multi) */}
              {connectorCategories.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const cat = e.target.value;
                    if (!cat) return;
                    setActiveCategories((prev) => {
                      const next = new Set(prev);
                      if (next.has(cat)) next.delete(cat);
                      else next.add(cat);
                      return next;
                    });
                  }}
                  className="h-7 max-w-[180px] shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[11px] outline-none transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:border-[var(--accent)]"
                  title="Catégorie signal"
                >
                  <option value="">
                    {activeCategories.size === 0
                      ? "Toutes catégories"
                      : `Catégories (${activeCategories.size})`}
                  </option>
                  {connectorCategories.map((c) => {
                    const active = activeCategories.has(c.name);
                    return (
                      <option key={c.name} value={c.name}>
                        {active ? "✓ " : ""}
                        {c.name}
                      </option>
                    );
                  })}
                </select>
              )}
              {/* Pills catégories actives */}
              {Array.from(activeCategories).map((c) => {
                const cat = connectorCategories.find((x) => x.name === c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      setActiveCategories((prev) => {
                        const next = new Set(prev);
                        next.delete(c);
                        return next;
                      })
                    }
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors"
                    style={
                      cat
                        ? {
                            borderColor: `${cat.color}55`,
                            background: `${cat.color}15`,
                            color: cat.color,
                          }
                        : undefined
                    }
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: cat?.color ?? "currentColor" }}
                    />
                    {c}
                    <X className="ml-0.5 h-2.5 w-2.5 opacity-60" />
                  </button>
                );
              })}
              {/* Sélecteur connecteur (multi par nom — ex. BNC, XLR…) */}
              {availableConnectorNames.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) return;
                    setActiveConnectorNames((prev) => {
                      const next = new Set(prev);
                      if (next.has(name)) next.delete(name);
                      else next.add(name);
                      return next;
                    });
                  }}
                  className="h-7 max-w-[180px] shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[11px] outline-none transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:border-[var(--accent)]"
                  title="Connecteur"
                >
                  <option value="">
                    {activeConnectorNames.size === 0
                      ? "Tous connecteurs"
                      : `Connecteurs (${activeConnectorNames.size})`}
                  </option>
                  {availableConnectorNames.map((n) => {
                    const active = activeConnectorNames.has(n);
                    return (
                      <option key={n} value={n}>
                        {active ? "✓ " : ""}
                        {n}
                      </option>
                    );
                  })}
                </select>
              )}
              {/* Pills connecteur actifs */}
              {Array.from(activeConnectorNames).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() =>
                    setActiveConnectorNames((prev) => {
                      const next = new Set(prev);
                      next.delete(n);
                      return next;
                    })
                  }
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--secondary)]/40 px-2 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]/60"
                >
                  {n}
                  <X className="ml-0.5 h-2.5 w-2.5 opacity-60" />
                </button>
              ))}
              {/* Tri */}
              <button
                type="button"
                onClick={() =>
                  setSortBy(sortBy === "name-asc" ? "name-desc" : "name-asc")
                }
                title={sortBy === "name-asc" ? "Trier Z → A" : "Trier A → Z"}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] hover:text-[var(--foreground)]"
              >
                <ArrowUpDown className="h-3 w-3" />
                {sortBy === "name-asc" ? "A→Z" : "Z→A"}
              </button>
              {/* Reset */}
              {(search || activeCategories.size > 0 || activeConnectorNames.size > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setActiveCategories(new Set());
                    setActiveConnectorNames(new Set());
                  }}
                  // arkyo-server: habillage Strata (danger : --danger, texte en --danger-text)
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--danger)]/50 px-2 text-[11px] font-medium text-[var(--danger-text)] hover:bg-[var(--danger)]/10"
                  title="Effacer les filtres"
                >
                  Effacer
                </button>
              )}
            </div>
          )}

          {/* Badge statut sauvegarde — pattern aligné sur ProjectContextualTopbar */}
          <div className="ml-auto flex shrink-0 items-center">
            {saveStatus === "saving" && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--secondary)]/60 px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Sauvegarde…
              </span>
            )}
            {saveStatus === "saved" && (
              // arkyo-server: habillage Strata (succès : --success, texte en --success-text)
              <span className="animate-fade-in inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--success)]/15 px-2 py-1 text-[11px] font-medium text-[var(--success-text)]">
                <Check className="h-3 w-3" strokeWidth={2.5} />
                Enregistré
              </span>
            )}
            {saveStatus === "error" && (
              // arkyo-server: habillage Strata (échec : --danger, texte en --danger-text)
              <span className="animate-fade-in inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--danger)]/15 px-2 py-1 text-[11px] font-medium text-[var(--danger-text)]">
                <X className="h-3 w-3" strokeWidth={2.5} />
                Échec
              </span>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Rail gauche — pattern aligné sur rack LeftToolbar (bg-card) ── */}
          <div className="flex h-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)] py-1.5"
            style={{ width: "48px" }}
          >
            {/* Section tools : 4 outils canvas (select / pan / move / connectors).
                Sélection exclusive : un seul actif à la fois. Seul "connectors"
                ouvre le side panel — les autres changent l'interaction canvas. */}
            <div className="flex flex-col gap-0.5">
              {[
                {
                  id: "select" as const,
                  icon: <MousePointer2 className="h-[18px] w-[18px]" />,
                  label: "Sélection",
                  shortcut: "V",
                },
                {
                  id: "pan" as const,
                  icon: <Hand className="h-[18px] w-[18px]" />,
                  label: "Main",
                  shortcut: "H",
                },
                {
                  id: "move" as const,
                  icon: <Move className="h-[18px] w-[18px]" />,
                  label: "Déplacer",
                  shortcut: "M",
                },
                {
                  id: "connectors" as const,
                  icon: <Cable className="h-[18px] w-[18px]" />,
                  label: "Connecteurs",
                  shortcut: "C",
                },
              ].map(({ id, icon, label, shortcut }) => {
                const active = activeTool === id;
                return (
                  <button
                    key={id}
                    type="button"
                    title={`${label}${shortcut ? ` (${shortcut})` : ""}`}
                    onClick={() => setActiveTool(id)}
                    className={cn(
                      "relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none",
                      active
                        // arkyo-server: habillage Strata (icône active sur accent doux : --accent-strong, comme --rail-icon-active)
                        ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)]"
                        : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)]",
                    )}
                  >
                    {icon}
                  </button>
                );
              })}
            </div>

            {/* Section bas : Zoom + Aide + Reset (pattern aligné sur rack LeftToolbar) */}
            <div className="mt-auto flex flex-col gap-0.5">
              <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
              <div className="text-muted-foreground/60 mx-auto py-0.5 text-[7px] font-bold tracking-widest uppercase">
                Zoom
              </div>
              <button
                type="button"
                title="Zoom +"
                onClick={() => setZoom((z) => Math.min(2, parseFloat((z + 0.1).toFixed(2))))}
                className="text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)] relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none"
              >
                <ZoomIn className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                title="Réinitialiser le zoom"
                className="text-muted-foreground hover:text-foreground mx-auto py-0.5 text-center text-[9px] leading-none tabular-nums transition-colors"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                title="Zoom −"
                onClick={() => setZoom((z) => Math.max(0.3, parseFloat((z - 0.1).toFixed(2))))}
                className="text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)] relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none"
              >
                <ZoomOut className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                title="Ajuster la vue"
                onClick={fitAll}
                className="text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)] relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none"
              >
                <AlignHorizontalJustifyCenter className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                title="Aide"
                onClick={() => setShowHelp(true)}
                className="text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--border)_60%,transparent)] relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none"
              >
                <HelpCircle className="h-[18px] w-[18px]" />
              </button>
              {/* Reset destructif — séparé par un divider, en dernier */}
              <div aria-hidden className="bg-border/60 mx-2 my-1 h-px" />
              <button
                type="button"
                title="Vider le panneau"
                onClick={() => setShowReset(true)}
                // arkyo-server: habillage Strata (danger : --danger, icône en --danger-text)
                className="text-muted-foreground/70 relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all active:scale-95 focus:outline-none focus-visible:outline-none hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
              >
                <RotateCcw className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>

          {/* ── Panneau contextuel (240px) — design aligné sur inventaire catalog-panel ── */}
          {contextOpen && (
            <div
              className="flex shrink-0 flex-col overflow-hidden border-r border-[var(--border)]"
              style={{ width: "240px", background: "var(--card)" }}
            >
              {/* Liste plate par Catégorie compatible — titre gris + trait + compteur,
                  pas d'accordéon (pattern catalog-panel.tsx du mode inventaire). */}
              <div className="flex-1 overflow-y-auto px-2 py-3">
                {filtered.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      icon={<Cable strokeWidth={1.5} />}
                      title={
                        search ||
                        activeCategories.size > 0 ||
                        activeConnectorNames.size > 0
                          ? "Aucun résultat"
                          : "Aucun connecteur"
                      }
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {groups.map((group) => (
                      <div key={group.key} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 px-1 pt-1 pb-0.5">
                          <p
                            className="text-[10px] font-bold tracking-widest uppercase"
                            style={{ color: group.color }}
                          >
                            {group.label}
                          </p>
                          <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]/60">
                            {group.items.length}
                          </span>
                          <div className="ml-1 h-px flex-1 bg-[var(--border)]/60" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {group.items.map((c) => (
                            <DraggableConnector
                              key={`${group.key}-${c.id}`}
                              connector={c}
                              catColor={group.color}
                              // Un connecteur multi-familles (ex. BNC ∈ Vidéo+RF+Sync)
                              // prend la couleur du GROUPE où il est affiché, pas
                              // celle de sa première fonction.
                              iconColor={group.color}
                              familyKey={group.key}
                              familyLabel={group.label}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Zone principale ── */}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            {/* Grille de points */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(circle, color-mix(in srgb, var(--foreground) 7%, transparent) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
            />

            {/* Canvas panel */}
            <div
              ref={panelAreaRef}
              className="absolute inset-0 flex items-center justify-center overflow-auto p-10"
              onClick={() => setSelectedSlot(null)}
            >
              <div
                ref={panelScaleRef}
                style={{
                  position: "relative",
                  transform: `scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: "transform 0.15s ease",
                }}
              >
                {/* Curseurs distants — montés DANS le div à l'échelle, donc en
                    repère MONDE = pixels panneau. L'overlay applique la
                    contre-échelle 1/zoom pour une taille écran constante. */}
                <RemoteCursorsOverlay peers={livePeers} zoom={zoom} />
                {(() => {
                  const cellW = USABLE_W / panel.slotsPerU;
                  // Taille physique réelle : slot vide = 23.6mm, panneau 19" = 482.6mm
                  // PANEL_TOTAL_W px = 482.6mm → 1mm = PANEL_TOTAL_W/482.6 px
                  const SCALE_PX_PER_MM = PANEL_TOTAL_W / 482.6;
                  // Neutrik D = 23.6mm, connecteur simple = 10mm
                  const slotSize = Math.round((panel.slotsPerU > 16 ? 10 : 23.6) * SCALE_PX_PER_MM);
                  const panelH = panel.heightU * U_H;

                  const MountHole = () => (
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        border: "1.5px solid rgba(0,0,0,0.35)",
                        background: "transparent",
                      }}
                    />
                  );

                  return (
                    <div
                      style={{
                        width: PANEL_TOTAL_W,
                        height: panelH,
                        borderRadius: 4,
                        border: "2px solid #aaa",
                        display: "flex",
                        background: "transparent",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: EAR_W,
                          height: panelH,
                          flexShrink: 0,
                          borderRight: "1px solid #bbb",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 0",
                        }}
                      >
                        <MountHole />
                        <MountHole />
                      </div>

                      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                        {rows.map((row, ri) => {
                          const cols = `repeat(${panel.slotsPerU}, 1fr)`;
                          const numFontSize = Math.max(8, Math.round(slotSize * 0.22));
                          const labelFontSize = Math.max(6, Math.round(slotSize * 0.18));
                          return (
                            <div
                              key={ri}
                              style={{
                                flex: 1,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                padding: "2px 8px",
                                overflow: "visible",
                              }}
                            >
                              {/* Row 1 — numéros */}
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: cols,
                                  marginBottom: 2,
                                }}
                              >
                                {row.map((_, i) => (
                                  <div
                                    key={i}
                                    style={{
                                      textAlign: "center",
                                      fontSize: numFontSize,
                                      color: "rgba(0,0,0,0.35)",
                                      fontFamily: "monospace",
                                      lineHeight: 1,
                                    }}
                                  >
                                    {i + 1}
                                  </div>
                                ))}
                              </div>
                              {/* Row 2 — cercles (DroppableSlot) */}
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: cols,
                                  alignItems: "center",
                                  justifyItems: "center",
                                }}
                              >
                                {row.map((pos) => (
                                  <DroppableSlot
                                    key={pos}
                                    position={pos}
                                    slot={slotMap[pos]}
                                    size={slotSize}
                                    isDragTarget={
                                      overSlotPos === pos && isDraggingSlot && !slotMap[pos]
                                    }
                                    onSelect={setSelectedSlot}
                                    isSelected={selectedSlot?.id === slotMap[pos]?.id}
                                    familyColor={slotFamilyColor(slotMap[pos])}
                                  />
                                ))}
                              </div>
                              {/* Row 3 — labels */}
                              <div
                                style={{ display: "grid", gridTemplateColumns: cols, marginTop: 2 }}
                              >
                                {row.map((pos) => {
                                  const ct = slotMap[pos]?.connectorType;
                                  return (
                                    <div
                                      key={pos}
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        gap: 2,
                                      }}
                                    >
                                      {ct ? (
                                        <>
                                          <span
                                            style={{
                                              textAlign: "center",
                                              fontSize: labelFontSize,
                                              color: slotFamilyColor(slotMap[pos]),
                                              fontWeight: 600,
                                              lineHeight: 1.2,
                                              wordBreak: "break-word",
                                              padding: "0 1px",
                                            }}
                                          >
                                            {connectorLabel(ct)}
                                          </span>
                                        </>
                                      ) : (
                                        <span
                                          style={{ color: "transparent", fontSize: labelFontSize }}
                                        >
                                          .
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div
                        style={{
                          width: EAR_W,
                          height: panelH,
                          flexShrink: 0,
                          borderLeft: "1px solid #bbb",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 0",
                        }}
                      >
                        <MountHole />
                        <MountHole />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Zoom / Aide / Reset déplacés vers le bas du rail gauche
                (cf. section "Section bas" du rail — pattern aligné sur rack
                LeftToolbar). */}
          </div>

          {/* ── Panneau propriétés (droite) ── */}
          <div
            className="flex shrink-0 flex-col overflow-hidden border-l border-[var(--border)]"
            style={{ width: "280px", background: "var(--card)" }}
          >
            {selectedSlot ? (
              <>
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
                  <p className="text-[10px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
                    Connecteur
                  </p>
                  <button
                    onClick={() => setSelectedSlot(null)}
                    className="rounded p-1 transition-colors hover:bg-[var(--border)]"
                  >
                    <X className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  </button>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                  {selectedSlot.connectorType &&
                    (() => {
                      const ct = selectedSlot.connectorType!;
                      const isNeutrik = selectedSlot.mountD === true;
                      // Éligible à la pose D : le connecteur existe en D ET le
                      // panneau reste sous la limite physique des 16 découpes/U.
                      const canMountD = ct.hasNeutrikD && panel.slotsPerU <= 16;
                      // Teinte = famille choisie au drag (persistée), sinon 1re fonction.
                      const famColor = slotFamilyColor(selectedSlot);
                      return (
                        <>
                          {/* Aperçu visuel */}
                          <div
                            className="flex items-center justify-center rounded-2xl border border-[var(--border)] py-5"
                            style={{ background: "var(--background)" }}
                          >
                            <div className="flex flex-col items-center gap-3">
                              {(() => {
                                // Empreinte constante (56) : la bordure du
                                // conteneur EST le contour (cercle / coque D).
                                // Image D custom → bordure effacée, image pleine.
                                const previewCustomD = isNeutrik ? ct.dTypeSvgUrl : null;
                                return (
                                  <div
                                    className="relative flex items-center justify-center"
                                    style={{
                                      width: 56,
                                      height: 56,
                                      borderRadius: isNeutrik ? Math.round(56 * 0.22) : "50%",
                                      border: previewCustomD
                                        ? "2px solid transparent"
                                        : `2px solid ${famColor}`,
                                      boxShadow: `0 0 20px ${famColor}44`,
                                    }}
                                  >
                                    {previewCustomD ? (
                                      <img
                                        src={previewCustomD}
                                        alt=""
                                        width={56}
                                        height={56}
                                        style={{ objectFit: "contain" }}
                                      />
                                    ) : (
                                      <>
                                        {isNeutrik && <TorxDots color={famColor} box={56} />}
                                        <ConnectorIcon
                                          iconId={ct.iconId}
                                          color={famColor}
                                          size={38}
                                        />
                                      </>
                                    )}
                                  </div>
                                );
                              })()}
                              <p
                                className="text-center text-sm font-bold"
                                style={{ color: famColor }}
                              >
                                {ct.name}
                                {ct.version ? ` ${ct.version}` : ""}
                              </p>
                            </div>
                          </div>

                          {/* Infos */}
                          <div
                            className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]"
                            style={{ background: "var(--background)" }}
                          >
                            <div className="flex items-center justify-between px-3 py-2.5">
                              <span className="text-[11px] text-[var(--muted-foreground)]">
                                Position
                              </span>
                              <span className="text-[11px] font-bold tabular-nums">
                                #{selectedSlot.position}
                              </span>
                            </div>
                            <div className="flex items-center justify-between px-3 py-2.5">
                              <span className="text-[11px] text-[var(--muted-foreground)]">
                                Catégorie
                              </span>
                              <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ background: famColor }}
                                />
                                {ct.category}
                              </span>
                            </div>
                          </div>

                          {/* Pose Neutrik D — visible uniquement si le connecteur
                              existe en D et si le panneau reste sous 16 découpes/U. */}
                          {canMountD && (
                            <ActionSwitch
                              label="Pose en Neutrik D"
                              checked={isNeutrik}
                              onChange={(v) => handleToggleMountD(selectedSlot, v)}
                            />
                          )}

                          {/* Supprimer */}
                          <button
                            onClick={() => {
                              handleRemove(selectedSlot.id);
                              setSelectedSlot(null);
                            }}
                            // arkyo-server: habillage Strata (danger : --danger, texte en --danger-text)
                            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--danger)]/30 text-[11px] font-semibold text-[var(--danger-text)] transition-colors hover:bg-[var(--danger)]/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Retirer du panneau
                          </button>
                        </>
                      );
                    })()}
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <PanelInventoryProperties
                  panel={panel}
                  slots={slots}
                  onSaved={handleSettingsSaved}
                  onReset={() => setShowReset(true)}
                  notifySave={setSaveStatus}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Poubelle — visible uniquement quand on déplace un slot occupé */}
      {isDraggingSlot && <TrashZone />}

      {/* DragOverlay */}
      <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
        {(activeDrag?.kind === "connector" || activeDrag?.kind === "panel_slot") &&
          (() => {
            const ct =
              activeDrag.kind === "connector"
                ? activeDrag.connector
                : activeDrag.slot.connectorType;
            if (!ct) return null;
            // Overlay de drag : toujours générique — le connecteur se pose en
            // générique, le choix D se fait ensuite dans le modal / par slot.
            const famColor =
              activeDrag.kind === "connector"
                ? (activeDrag.familyLabel && catColorMap[activeDrag.familyLabel]) ||
                  familyColorOf(ct)
                : slotFamilyColor(activeDrag.slot);
            const size = 56;
            const iconSize = Math.round(size * 0.68);
            const labelFontSize = Math.max(6, Math.round(size * 0.13));
            return (
              <div className="flex flex-col items-center" style={{ gap: 4 }}>
                <div
                  className="relative flex items-center justify-center"
                  style={{
                    width: size,
                    height: size,
                    borderRadius: "50%",
                    background: "transparent",
                    border: `2px solid ${famColor}`,
                    boxShadow: `0 8px 32px ${famColor}55`,
                    opacity: 0.92,
                  }}
                >
                  <ConnectorIcon iconId={ct.iconId} color={famColor} size={iconSize} />
                </div>
                <span
                  className="font-mono font-semibold"
                  style={{ fontSize: labelFontSize, color: famColor }}
                >
                  {connectorLabel(ct)}
                </span>
              </div>
            );
          })()}
      </DragOverlay>

      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="max-h-[85vh] w-[600px] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/15">
                  <HelpCircle className="h-4 w-4 text-[var(--accent)]" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Guide de l'éditeur de panneaux</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Panneau de brassage 19" — échelle réelle
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="rounded-lg p-1.5 transition-colors hover:bg-[var(--border)]"
              >
                <X className="h-4 w-4 text-[var(--muted-foreground)]" />
              </button>
            </div>

            {/* Sections */}
            <div className="space-y-3 p-6">
              {[
                {
                  icon: (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  ),
                  color: "#3b82f6",
                  title: "Placer un connecteur",
                  steps: [
                    "Parcourez la liste de gauche — filtrez par style ou genre si besoin",
                    "Glissez un connecteur et déposez-le sur un slot vide du panneau",
                    "Un modal apparaît : choisissez unique, toute la ligne, tout le panel ou un nombre personnalisé",
                    "Le remplissage démarre toujours depuis le slot cible, en ignorant les slots déjà occupés",
                  ],
                },
                {
                  icon: (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 9l4-4 4 4M9 5v14M19 15l-4 4-4-4M15 19V5" />
                    </svg>
                  ),
                  color: "#22c55e",
                  title: "Déplacer un connecteur",
                  steps: [
                    "Glissez un connecteur déjà placé depuis le panneau vers un autre slot libre",
                    "Le connecteur se déplace sans être supprimé",
                  ],
                },
                {
                  icon: (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  ),
                  color: "#ef4444",
                  title: "Supprimer un connecteur",
                  steps: [
                    "Survolez un slot occupé → cliquez sur la croix rouge qui apparaît",
                    "Ou glissez-le hors du panneau vers la zone poubelle qui s'affiche en bas",
                    "Le bouton ↺ dans la barre du haut vide tout le panneau en une fois",
                  ],
                },
                {
                  icon: (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
                    </svg>
                  ),
                  color: "#f59e0b",
                  title: "Zoom et navigation",
                  steps: [
                    "Boutons + / − pour zoomer, clic sur le % pour revenir à 100 %",
                    "Le bouton ⊟ ajuste automatiquement le zoom pour afficher tout le panneau",
                  ],
                },
                {
                  icon: (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                    </svg>
                  ),
                  color: "#8b5cf6",
                  title: "Types de connecteurs",
                  steps: [
                    "8 / 12 / 16 slots par U : Neutrik D et connecteurs simples disponibles",
                    "24 slots par U : connecteurs simples uniquement (pas assez de place pour du Neutrik D)",
                    "Les slots Neutrik D sont représentés par un carré arrondi, les simples par un cercle",
                  ],
                },
                {
                  icon: <Settings width={18} height={18} />,
                  color: "#64748b",
                  title: "Paramètres du panneau",
                  steps: [
                    "Bouton ⚙ pour renommer, changer la hauteur (U) ou la densité de slots",
                    "⚠ Modifier les dimensions efface tous les connecteurs placés — une confirmation est demandée",
                  ],
                },
              ].map(({ icon, color, title, steps }) => (
                <div
                  key={title}
                  className="flex gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4"
                >
                  <div
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `${color}18`, color }}
                  >
                    {icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-sm font-semibold">{title}</p>
                    <ul className="space-y-1">
                      {steps.map((s, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]"
                        >
                          <span
                            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                            style={{ background: `${color}20`, color }}
                          >
                            {i + 1}
                          </span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 pb-6">
              <button
                onClick={() => setShowHelp(false)}
                // arkyo-server: habillage Strata (texte sur accent plein : --accent-foreground)
                className="h-9 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
              >
                Compris, merci !
              </button>
            </div>
          </div>
        </div>
      )}

      {showReset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowReset(false)}
        >
          <div
            className="w-[320px] space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              {/* arkyo-server: habillage Strata (danger : --danger, icône en --danger-text) */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--danger)]/15">
                <RotateCcw className="h-4 w-4 text-[var(--danger-text)]" />
              </div>
              <div>
                <p className="text-sm font-semibold">Vider le panneau</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Tous les connecteurs placés seront supprimés. Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowReset(false)}
                className="h-8 flex-1 rounded-lg border border-[var(--border)] text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)]"
              >
                Annuler
              </button>
              <button
                onClick={handleReset}
                // arkyo-server: habillage Strata (danger plein : --destructive, comme le bouton destructive)
                className="h-8 flex-1 rounded-lg bg-[var(--destructive)] text-xs font-medium text-[var(--destructive-foreground)] transition-opacity hover:opacity-90"
              >
                Vider le panneau
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingPlace &&
        (() => {
          const conn = availableConnectors.find((c) => c.id === pendingPlace.connectorId);
          if (!conn) return null;
          return (
            <PlaceConnectorModal
              connector={conn}
              fromPosition={pendingPlace.fromPosition}
              panel={panel}
              slotMap={slotMap}
              familyColor={
                (pendingPlace.familyLabel && catColorMap[pendingPlace.familyLabel]) ||
                familyColorOf(conn)
              }
              onConfirm={(positions, mountD) =>
                handlePlaceConnectors(
                  pendingPlace.connectorId,
                  positions,
                  mountD,
                  pendingPlace.familyLabel,
                )
              }
              onCancel={() => setPendingPlace(null)}
            />
          );
        })()}
    </DndContext>
  );
}
