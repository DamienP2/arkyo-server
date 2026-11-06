"use client";

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "@/components/ui/icons";

import { cn } from "@/lib/utils";
import { PLAQUE_STYLES, U_HEIGHT_PX } from "@/components/synoptique/lib/constants";
import {
  AccessoryFace,
  SHELF_FLANGE_W,
} from "@/components/synoptique/components/accessory-face";
import {
  CategoryColorCtx,
  DEFAULT_HEX,
  SPECIAL_HEX,
  hexDarken,
  hexTint,
  useCategoryColor,
} from "@/components/synoptique/lib/colors";
import type { AccessoryType, PanelSlotData, Slot } from "@/components/synoptique/lib/types";
import { PanelRackVisual } from "./panel-rack-visual";

/** Trie les enfants d'une étagère selon l'ordre persisté dans notes.childOrder */
export function sortByChildOrder(children: Slot[], notes: string | null): Slot[] {
  let order: string[] = [];
  try {
    order = (JSON.parse(notes ?? "{}") as { childOrder?: string[] }).childOrder ?? [];
  } catch {
    /* */
  }
  if (!order.length) return children;
  return [...children].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

/** Enfant d'étagère rendu comme un draggable pour permettre le réarrangement */
function ShelfChildItem({
  child,
  count,
  fontSize,
  parentSlotId,
  onSelectChild,
  resolveChildHex,
  isSelected,
}: {
  child: Slot;
  count: number;
  fontSize: number;
  parentSlotId: string;
  onSelectChild?: (childId: string) => void;
  resolveChildHex: (cat?: string | null) => string;
  isSelected?: boolean;
}) {
  const childHex = resolveChildHex(child.equipment?.category);
  const childName = child.equipment
    ? [(child.equipment as any).brand?.name, child.equipment.name].filter(Boolean).join(" ")
    : "—";
  const dragData = useMemo(
    () => ({ type: "shelf-child", slot: child, parentSlotId }),
    [child, parentSlotId],
  );
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `shelf-child-${child.id}`,
    data: dragData,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (!isDragging) {
          e.stopPropagation();
          onSelectChild?.(child.id);
        }
      }}
      className={cn(
        "pointer-events-auto relative flex cursor-grab touch-none items-stretch overflow-hidden rounded-sm border transition-all hover:brightness-95 active:cursor-grabbing",
        isDragging && "opacity-20",
        isSelected && "ring-2 ring-offset-0",
      )}
      style={{
        flex: `1 1 ${100 / count}%`,
        minWidth: 0,
        background: hexTint(childHex, 0.18),
        borderColor: isSelected ? childHex : childHex,
        ...(isSelected ? { ringColor: childHex, boxShadow: `0 0 0 2px ${childHex}` } : {}),
      }}
    >
      {isSelected && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, currentColor 0, currentColor 1.5px, transparent 0, transparent 50%)",
            backgroundSize: "7px 7px",
            color: childHex,
            opacity: 0.15,
          }}
        />
      )}
      <span className="shrink-0 self-stretch" style={{ width: 4, background: childHex }} />
      <span
        className="flex min-w-0 flex-1 flex-col justify-center px-1"
        style={{ color: hexDarken(childHex, 0.7) }}
      >
        <span className="truncate leading-tight font-semibold" style={{ fontSize }}>
          {childName}
        </span>
        {child.label && (
          <span
            className="truncate leading-tight"
            style={{ fontSize: Math.max(fontSize - 1, 6), color: "var(--muted-foreground)" }}
          >
            {child.label}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Slot posé dans le rack, draggable via @dnd-kit. Rend soit la "vue infos"
 * (barre avec nom + libellé), soit la "vue réelle" (visuel fidèle du panel ou
 * image de l'équipement).
 *
 * Exception : les ACCESSOIRES (plaque / étagère / tiroir) sortent en amont de
 * cet arbitrage et sont toujours rendus par `AccessoryFace` — le même dessin
 * que l'aperçu du configurateur Accessoires, dans les deux vues et dans les
 * trois modes (STD / GFX / PIC).
 */
export function DraggableSlot({
  slot,
  onRemove,
  showInfo,
  onSelect,
  isSelected,
  onSelectChild,
  selectedChildId,
  renderMode = "standard",
  rackId,
  rackName,
  dropDisabled = false,
}: {
  slot: Slot;
  onRemove: (id: string) => void;
  /**
   * Contenant qui porte ce slot — propagé dans le payload de drag
   * (`sourceRackId` / `sourceRackName`). Un affichage multi-contenants s'en
   * sert pour REFUSER un dépôt dans un autre contenant et le dire à
   * l'utilisateur. Optionnel : sans lui le drag est inchangé.
   */
  rackId?: string;
  rackName?: string;
  showInfo?: boolean;
  onSelect?: () => void;
  isSelected?: boolean;
  onSelectChild?: (childId: string) => void;
  selectedChildId?: string | null;
  /**
   * Mode de rendu des ÉQUIPEMENTS uniquement (onglet Rack projet) :
   *  - "standard" : rendu box couleur + nom (défaut, inchangé)
   *  - "graphic"  : image du symbole vecto (rackSymbolUrl / rackSymbolRearUrl)
   *  - "photo"    : photo (rackPhotoFrontUrl / rackPhotoRearUrl)
   * Repli automatique sur "standard" si l'image de la face est absente.
   * Panels et accessoires ignorent totalement ce mode.
   */
  renderMode?: "standard" | "graphic" | "photo";
  /**
   * Contenant inerte pour le drag en cours (affichage par emplacement) : la
   * zone de dépôt de l'étagère est désactivée, sinon elle resterait la seule
   * cible atteignable d'une colonne pourtant éteinte.
   */
  dropDisabled?: boolean;
}) {
  const category = slot.panel ? "Panels de patch" : slot.equipment?.category;
  const hex = useCategoryColor(category);
  const catColorMap = useContext(CategoryColorCtx);
  const resolveChildHex = (cat?: string | null) => {
    if (!cat) return DEFAULT_HEX;
    if (SPECIAL_HEX[cat]) return SPECIAL_HEX[cat];
    return catColorMap[cat] ?? DEFAULT_HEX;
  };
  const dragData = useMemo(
    () => ({ type: "slot", slot, sourceRackId: rackId, sourceRackName: rackName }),
    [slot, rackId, rackName],
  );
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: `slot-${slot.id}`,
      data: dragData,
    });

  // Shelf droppable — accepts non-rackable equipment
  const isEtagereSlot =
    !slot.panel &&
    !slot.equipment &&
    (() => {
      try {
        return (
          (JSON.parse(slot.notes ?? "{}") as { accessoryType?: string }).accessoryType === "etagere"
        );
      } catch {
        return false;
      }
    })();
  const { setNodeRef: setDropRef, isOver: isShelfOver } = useDroppable({
    id: `shelf-drop-${slot.id}`,
    data: { type: "shelf-drop", shelfSlotId: slot.id },
    disabled: !isEtagereSlot || dropDisabled,
  });
  const sortedChildren = useMemo(
    () => sortByChildOrder(slot.children ?? [], slot.notes),
    [slot.children, slot.notes],
  );

  // Track insert position when a drag hovers over this shelf
  const [insertIdx, setInsertIdx] = useState<number | null>(null);
  const shelfContainerRef = useRef<HTMLDivElement>(null);
  const handleShelfPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isShelfOver || sortedChildren.length === 0) {
        setInsertIdx(null);
        return;
      }
      const el = shelfContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const childWidth = rect.width / sortedChildren.length;
      setInsertIdx(Math.max(0, Math.min(sortedChildren.length, Math.round(relX / childWidth))));
    },
    [isShelfOver, sortedChildren.length],
  );
  // Reset insert index when drag leaves
  useEffect(() => {
    if (!isShelfOver) setInsertIdx(null);
  }, [isShelfOver]);

  const displayName = slot.label ?? slot.panel?.name ?? slot.equipment?.name ?? "—";

  // ── Mode graphique / photo (équipements uniquement) ────────────────────────
  // Un slot est TOUJOURS rendu dans sa vue de montage (viewSlots filtre
  // slot.view === vue affichée) : on voit donc sa FACE, quelle que soit la
  // face de montage (un équipement monté à l'arrière montre sa face quand on
  // regarde l'arrière). L'image de DOS (rackSymbolRearUrl / rackPhotoRearUrl)
  // est réservée aux PROJECTIONS (cf. ProjectedSlot), jamais rendue ici.
  // SIDE et absence d'image → `null` = repli sur le rendu standard (jamais de
  // case vide). Les panels/accessoires n'entrent jamais dans ce chemin.
  const modeImageUrl = useMemo<string | null>(() => {
    if (renderMode === "standard") return null;
    if (slot.panel || !slot.equipment) return null;
    if (slot.view === "SIDE") return null;
    const eq = slot.equipment;
    if (renderMode === "graphic") return eq.rackSymbolUrl ?? null;
    return eq.rackPhotoFrontUrl ?? null;
  }, [renderMode, slot.panel, slot.equipment, slot.view]);

  // Infobulle qui suit la souris en mode image (remplace le badge de libellé).
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
  const imageTip = modeImageUrl != null && !!slot.label;

  const panelSlotMap = useMemo(() => {
    if (!slot.panel) return {} as Record<number, PanelSlotData>;
    const m: Record<number, PanelSlotData> = {};
    for (const ps of slot.panel.slots) m[ps.position] = ps;
    return m;
  }, [slot.panel]);

  const accessoryMeta = useMemo(() => {
    if (slot.panel || slot.equipment) return null;
    try {
      return JSON.parse(slot.notes ?? "{}") as {
        accessoryType?: AccessoryType;
        style?: string;
        depthMm?: number;
      };
    } catch {
      return null;
    }
  }, [slot.notes, slot.panel, slot.equipment]);

  const isEtagere = accessoryMeta?.accessoryType === "etagere";
  const isTiroir = accessoryMeta?.accessoryType === "tiroir";
  const isPlaque = accessoryMeta?.accessoryType === "plaque";
  const accessoryName = accessoryMeta
    ? (() => {
        const labelMap: Record<AccessoryType, string> = {
          plaque: "Plaque",
          etagere: "Étagère",
          tiroir: "Tiroir",
        };
        const styleLabel = accessoryMeta.style
          ? ` ${PLAQUE_STYLES.find((s) => s.id === accessoryMeta.style)?.label ?? accessoryMeta.style}`
          : "";
        const depthLabel = accessoryMeta.depthMm ? ` ${accessoryMeta.depthMm}mm` : "";
        return `${labelMap[accessoryMeta.accessoryType!] ?? "Accessoire"}${styleLabel}${depthLabel}`;
      })()
    : null;

  // ── Accessoire : face dessinée, identique partout ─────────────────────────
  // Un accessoire n'a jamais de visuel uploadé : la face dessinée EST sa
  // représentation, dans les trois modes (STD / GFX / PIC) comme dans les deux
  // vues (infos / réelle). C'est exactement le composant de l'aperçu du
  // configurateur Accessoires, dimensionné à la hauteur réelle du slot.
  if (isEtagere || isTiroir || isPlaque) {
    const faceHeight = (slot.heightU ?? 1) * U_HEIGHT_PX;
    const faceType = isEtagere ? "etagere" : isTiroir ? "tiroir" : "plaque";
    const count = sortedChildren.length;
    const childFontSize = count <= 3 ? 9 : count <= 6 ? 8 : 7;
    const childGap = count <= 5 ? 2 : 1;
    const insertBar = (key: string) => (
      <div
        key={key}
        className="pointer-events-none shrink-0 self-stretch rounded-full"
        style={{ width: 3, background: "var(--accent)" }}
      />
    );

    return (
      <div
        ref={setNodeRef}
        data-slot="true"
        data-slot-id={slot.id}
        onClick={(e) => {
          if (!isDragging) {
            e.stopPropagation();
            onSelect?.();
          }
        }}
        style={{
          transform: isDragging ? undefined : CSS.Translate.toString(transform),
          ...(isSelected ? { zIndex: 30 } : {}),
        }}
        {...attributes}
        className={cn(
          "group relative h-full w-full cursor-default touch-none",
          isDragging && "opacity-20",
        )}
      >
        <AccessoryFace
          type={faceType}
          variant={accessoryMeta?.style}
          height={faceHeight}
          fill
          aria-label={accessoryName ?? undefined}
        >
          {isEtagere && (
            <div
              ref={(el) => {
                setDropRef(el);
                (shelfContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
              }}
              data-shelf-id={slot.id}
              className="relative flex h-full w-full items-stretch overflow-hidden px-1 pt-[3px] pb-[2px]"
              style={{
                gap: childGap,
                background: isShelfOver
                  ? "color-mix(in srgb, var(--accent) 20%, transparent)"
                  : "transparent",
                transition: "background 150ms",
              }}
              onPointerMove={handleShelfPointerMove}
            >
              {sortedChildren.map((child, i) => (
                <React.Fragment key={child.id}>
                  {isShelfOver && insertIdx === i && insertBar(`ins-${i}`)}
                  <ShelfChildItem
                    child={child}
                    count={count}
                    fontSize={childFontSize}
                    parentSlotId={slot.id}
                    onSelectChild={onSelectChild}
                    resolveChildHex={resolveChildHex}
                    isSelected={selectedChildId === child.id}
                  />
                </React.Fragment>
              ))}
              {isShelfOver && insertIdx === count && insertBar("ins-end")}
            </div>
          )}
        </AccessoryFace>

        {/* Poignée de drag : les oreilles pour une étagère (le centre reste
            réceptif au dépôt d'équipements), toute la façade sinon. */}
        {isEtagere ? (
          (["left", "right"] as const).map((side) => (
            <div
              key={side}
              ref={side === "left" ? setActivatorNodeRef : undefined}
              {...listeners}
              className="absolute inset-y-0 z-[5] cursor-grab touch-none active:cursor-grabbing"
              style={
                side === "left"
                  ? { left: 0, width: SHELF_FLANGE_W }
                  : { right: 0, width: SHELF_FLANGE_W }
              }
            />
          ))
        ) : (
          <div
            ref={setActivatorNodeRef}
            {...listeners}
            className="absolute inset-0 z-[5] cursor-grab touch-none active:cursor-grabbing"
          />
        )}

        {/* Trame de sélection — même code couleur que les autres slots. */}
        {isSelected && (
          <div
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, currentColor 0, currentColor 2.5px, transparent 0, transparent 50%)",
              backgroundSize: "10px 10px",
              color: hex,
              opacity: 0.12,
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-slot="true"
      data-slot-id={slot.id}
      onClick={(e) => {
        if (!isDragging) {
          e.stopPropagation();
          onSelect?.();
        }
      }}
      onMouseMove={
        imageTip ? (e) => setTipPos({ x: e.clientX, y: e.clientY }) : undefined
      }
      onMouseLeave={imageTip ? () => setTipPos(null) : undefined}
      style={{
        // Ne pas déplacer l'original quand isDragging — DragOverlay gère le visuel
        transform: isDragging ? undefined : CSS.Translate.toString(transform),
        ...(slot.panel && !showInfo
          ? {}
          : { background: hexTint(hex, 0.18), borderColor: hex }),
        // En mode image (graphique/photo) : pas de cadre coloré autour du
        // visuel — l'image porte seule la représentation.
        ...(modeImageUrl ? { background: "transparent", borderColor: "transparent" } : {}),
        ...(isSelected ? { zIndex: 30 } : {}),
      }}
      {...attributes}
      className={cn(
        "group relative flex h-full w-full cursor-default touch-none items-stretch",
        // En mode image, le visuel déborde de la boîte (rails + inset ±1px) :
        // pas de clipping. Sinon on garde le clipping du contenu standard.
        modeImageUrl ? "overflow-visible" : "overflow-hidden",
        slot.panel && !showInfo ? "border-0" : "border",
        isDragging && "opacity-20",
      )}
    >
      {/* Overlay image mode graphique / photo — recouvre le rendu standard
          (qui reste dessous et porte le drag/selection). `pointer-events-none`
          → le drag (poignée) et la sélection (clic root) fonctionnent à
          l'identique. z-[6] : au-dessus du contenu (z 0), sous la trame de
          sélection (z-10) qui reste ainsi visible par-dessus l'image. */}
      {modeImageUrl && (
        <div
          className="pointer-events-none absolute z-[6] bg-[var(--card)]"
          // La zone de slots est à la largeur hors-tout du 19" (FRONT_OUTER_W,
          // rails de labels EXCLUS) : la boîte d'un slot est exactement au
          // ratio de crop de l'image. Le wrapper compense seulement l'inset
          // ±1px + la bordure 1px de la boîte pour que les bords touchent les
          // séparations de U et les côtés de la zone → object-fill remplit
          // bord à bord sans déformation perceptible.
          style={{ top: -2, bottom: -2, left: -1, right: -1 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={modeImageUrl}
            alt={slot.equipment?.name ?? ""}
            className="h-full w-full object-fill"
            draggable={false}
          />
        </div>
      )}
      {/* Infobulle de libellé qui suit le curseur (remplace le badge). Rendue
          via un portal car le slot porte un `transform` qui casserait un
          `position: fixed`. */}
      {imageTip &&
        tipPos &&
        !isDragging &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999] max-w-[240px] truncate rounded-md bg-black/80 px-2 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur-sm"
            style={{ left: tipPos.x + 14, top: tipPos.y + 14 }}
          >
            {slot.label}
          </div>,
          document.body,
        )}
      {/* Hatch overlay when selected */}
      {isSelected && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, currentColor 0, currentColor 2.5px, transparent 0, transparent 50%)",
            backgroundSize: "10px 10px",
            color: hex,
            opacity: 0.1,
          }}
        />
      )}
      {showInfo ? (
        /* ── VUE INFOS ── */
        /* Équipements / panels — les accessoires ne passent jamais ici, ils
           ont leur propre rendu (face dessinée) sorti plus haut. */
        <>
            <div
              ref={setActivatorNodeRef}
              {...listeners}
              className="flex shrink-0 cursor-grab touch-none items-center justify-center px-1 active:cursor-grabbing"
            >
              <GripVertical className="h-3 w-3 text-[var(--muted-foreground)] opacity-40" />
            </div>
            <span className="shrink-0 self-stretch" style={{ width: 4, background: hex }} />
            <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden pl-2">
              {(() => {
                const eqLabel = slot.equipment
                  ? [(slot.equipment as any).brand?.name, slot.equipment.name]
                      .filter(Boolean)
                      .join(" ")
                  : (slot.panel?.name ?? "—");
                // Si l'utilisateur a saisi un label custom, il devient le titre
                // principal et l'équipement passe en sous-titre. Sinon : titre
                // équipement seul (comportement historique).
                if (slot.label) {
                  return (
                    <>
                      <p
                        className="truncate text-[17px] leading-tight font-bold"
                        style={{ color: hexDarken(hex, 0.7) }}
                      >
                        {slot.label}
                      </p>
                      <p
                        className="truncate text-[13px] leading-tight font-medium"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        {eqLabel}
                      </p>
                    </>
                  );
                }
                return (
                  <p
                    className="truncate text-[17px] leading-tight font-semibold"
                    style={{ color: hexDarken(hex, 0.7) }}
                  >
                    {eqLabel}
                  </p>
                );
              })()}
            </div>
        </>
      ) : slot.panel ? (
        /* ── VUE RÉELLE — Panel : visual connecteurs fidèle ── */
        <div className="h-full w-full" style={{ background: "#fff" }}>
          <PanelRackVisual panel={slot.panel} slotMap={panelSlotMap} />
        </div>
      ) : (slot.equipment as any)?.rackSymbolUrl ? (
        /* ── VUE RÉELLE — Équipement avec symbole rack ── */
        <>
          <img
            src={(slot.equipment as any).rackSymbolUrl}
            alt={(slot.equipment as any).name ?? ""}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
          {/* Overlay du label custom — masqué si pas de label */}
          {slot.label && (
            <div className="absolute top-1 right-1 z-10 max-w-[60%] truncate rounded-sm bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm backdrop-blur-sm">
              {slot.label}
            </div>
          )}
        </>
      ) : (
        /* ── VUE RÉELLE — Équipement sans photo : fallback vue infos ── */
        <>
          <div
            ref={setActivatorNodeRef}
            {...listeners}
            className="flex shrink-0 cursor-grab touch-none items-center justify-center px-1 active:cursor-grabbing"
          >
            <GripVertical className="h-3 w-3 opacity-30" />
          </div>
          <span className="w-1 shrink-0 self-stretch" style={{ background: hex }} />
          <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden pl-2">
            {(() => {
              const eqLabel = slot.equipment
                ? [(slot.equipment as any).brand?.name, slot.equipment.name]
                    .filter(Boolean)
                    .join(" ")
                : displayName;
              if (slot.label) {
                return (
                  <>
                    <p
                      className="truncate text-[17px] leading-tight font-bold"
                      style={{ color: hexDarken(hex, 0.7) }}
                    >
                      {slot.label}
                    </p>
                    <p
                      className="truncate text-[13px] leading-tight font-medium"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {eqLabel}
                    </p>
                  </>
                );
              }
              return (
                <p
                  className="truncate text-[17px] leading-tight font-semibold"
                  style={{ color: hexDarken(hex, 0.7) }}
                >
                  {eqLabel}
                </p>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
