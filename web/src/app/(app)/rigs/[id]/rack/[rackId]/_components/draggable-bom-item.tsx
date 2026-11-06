"use client";

import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "@/components/ui/icons";
import type { Equipment } from "@/components/synoptique/lib/types";
import { cn } from "@/lib/utils";

import type { BomItemWithRemaining } from "../_hooks/use-rack-bom";
import { useCategoryColor } from "@/components/synoptique/lib/colors";
import type { AccessoryType, PanelItem, WidthFraction } from "@/components/synoptique/lib/types";

/**
 * Card draggable pour un item BOM. Selon `kind` :
 *   - `equipment` : émet le drag data type=equipment (compatible avec
 *     `DraggableEquipment`) en récupérant l'Equipment depuis `equipmentMap`.
 *   - `panel`     : émet type=panel (depuis `panelMap`).
 *   - `accessory` : émet type=configured-accessory.
 *   - `adapter`   : actuellement non draggable depuis la sidebar (les
 *     adapters ne se posent pas dans des slots), affiché en lecture seule.
 *
 * Deux modes d'affichage, exclusifs :
 *   - AGRÉGÉ (`remainingCount`) : une carte par référence, compteur « ×N » du
 *     reste à placer. Utilisé par l'onglet Rack du projet.
 *   - PAR INSTANCE (`instanceIndex`) : une carte par exemplaire physique.
 *     Conservé pour le rack-editor historique.
 *
 * Dans les deux cas, `placed` grise la carte, affiche « Placé » et coupe le
 * drag.
 */
export interface DraggableBomItemProps {
  item: BomItemWithRemaining;
  /** Map equipmentId → Equipment (catalogue) pour résoudre les drag data. */
  equipmentMap: Map<string, Equipment>;
  /** Map panelId → PanelItem. */
  panelMap: Map<string, PanelItem>;
  /** Callback quand l'utilisateur clique l'item (pour mode tap-to-place). */
  onSelectEquipment?: (eq: Equipment | null) => void;
  /** ID Equipment actuellement sélectionné (mode tap). */
  selectedEquipmentId?: string | null;
  /**
   * Si fourni : mode "N instances individuelles" — l'item BOM est rendu N
   * fois, une carte par instance. `instanceIndex` est la position 1-based de
   * cette instance et sert à générer un dragId unique. Le compteur "i/N"
   * n'est plus affiché à l'écran (cf. demande UX : pas de chiffre).
   */
  instanceIndex?: number;
  /** Total d'instances visibles. Conservé pour cohérence d'API. */
  instancesTotal?: number;
  /**
   * Mode « carte agrégée » (onglet Rack projet) : une seule carte par
   * référence, avec le nombre d'exemplaires RESTANT à placer. Un drag pose un
   * exemplaire, le compteur décrémente. Exclusif de `instanceIndex` — le
   * rack-editor historique, lui, reste en mode « une carte par instance ».
   */
  remainingCount?: number;
  /**
   * Marque cette instance comme déjà placée dans le rack — la carte est
   * grisée, le drag désactivé, et le badge affiche "Placé" en gris.
   */
  placed?: boolean;
  /**
   * Contenant qui possède cette ligne d'inventaire — propagé dans le payload
   * de drag (`sourceRackId` / `sourceRackName`). Un affichage multi-contenants
   * s'en sert pour REFUSER un dépôt dans un autre contenant et l'expliquer.
   * Optionnel : sans lui, comportement inchangé.
   */
  sourceRackId?: string;
  sourceRackName?: string;
}

export function DraggableBomItem({
  item,
  equipmentMap,
  panelMap,
  onSelectEquipment,
  selectedEquipmentId,
  instanceIndex,
  instancesTotal: _instancesTotal,
  remainingCount,
  placed = false,
  sourceRackId,
  sourceRackName,
}: DraggableBomItemProps) {
  // Résolution Equipment / Panel depuis la map injectée. Si introuvable
  // (catalogue obsolète), on dégrade l'affichage mais garde l'item visible.
  const equipment =
    item.kind === "equipment" && item.refId ? (equipmentMap.get(item.refId) ?? null) : null;
  const panel =
    item.kind === "panel" && item.refId ? (panelMap.get(item.refId) ?? null) : null;

  // Construction du drag data — type compatible avec handleDragStart du
  // rack-editor (cf branches `equipment`, `panel`, `configured-accessory`).
  // Mode N instances : suffixe l'index pour générer un dragId unique par carte.
  const dragId =
    typeof instanceIndex === "number"
      ? `bom-${item.id}-i${instanceIndex}`
      : `bom-${item.id}`;
  const dragData = useMemo(() => {
    // Provenance : contenant propriétaire. Les affichages multi-contenants
    // s'en servent pour refuser un dépôt hors de ce contenant (un équipement
    // appartient à son contenant). Champs inertes en mono-rack.
    const origin = { sourceRackId, sourceRackName };
    if (item.kind === "equipment" && equipment) {
      // Non rackable : aucune empreinte en U, il ne se pose que SUR une
      // étagère. Même payload que la palette historique
      // (`DraggableShelfEquipment`) → le chemin de drop étagère du canvas
      // s'applique sans adaptation.
      if (equipment.isRackable === false) {
        return { type: "shelf-equipment" as const, equipment, ...origin };
      }
      const wf = (equipment.widthFraction as WidthFraction | null) ?? "FULL";
      return { type: "equipment" as const, equipment, widthFraction: wf, ...origin };
    }
    if (item.kind === "panel" && panel) {
      return { type: "panel" as const, panel, ...origin };
    }
    if (
      item.kind === "accessory" &&
      item.accessoryType !== undefined &&
      item.accessoryHeightU !== undefined
    ) {
      // Maps `accessoryVariant` (BOM) → `style` (rack-editor accessory drag data).
      // Convention plaque : variant `plein|pass-cable|aere` → `style` correspondant.
      // Pour les non-plaques, pas de style.
      // depthMm vient du BOM (étagère/tiroir) — propagé au placement pour
      // que la dissociation par profondeur soit respectée côté slot.notes.
      return {
        type: "configured-accessory" as const,
        accessoryType: item.accessoryType as AccessoryType,
        heightU: item.accessoryHeightU as number,
        style: item.accessoryType === "plaque" ? item.accessoryVariant : undefined,
        depthMm:
          item.accessoryType !== "plaque" ? item.accessoryDepthMm : undefined,
        ...origin,
      };
    }
    // adapter : pas de drag (renvoie un payload "noop")
    return { type: "bom-adapter" as const };
  }, [item, equipment, panel, sourceRackId, sourceRackName]);

  /**
   * Équipement sans empreinte U : sa seule cible de dépôt est une étagère.
   * Test sur `false` explicite — un payload incomplet reste rackable.
   */
  const shelfOnly = item.kind === "equipment" && equipment?.isRackable === false;

  const draggable =
    !placed &&
    (item.kind === "equipment" || item.kind === "panel" || item.kind === "accessory");

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
    disabled: !draggable,
  });

  // Couleur du dot : priorité absolue à item.categoryColor (CatalogFunction
  // primaire fournie par l'API inventory), fallback sur useCategoryColor
  // (mapping via CategoryColorCtx) puis sur Equipment.category.
  const ctxHex = useCategoryColor(
    item.category ?? equipment?.category ?? (item.kind === "panel" ? "Panels de patch" : null),
  );
  const accentHex =
    item.kind === "accessory"
      ? "#71717a"
      : (item.categoryColor ?? ctxHex);

  const isSelected =
    item.kind === "equipment" && selectedEquipmentId && selectedEquipmentId === item.refId;

  // En mode "instance par carte", `placed` détermine seul l'état visuel
  // (placé / à placer). Pas de compteur affiché côté badge — on indique
  // simplement "Placé" pour les cards déjà placées, rien pour les autres.
  const greyOut = placed;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={() => {
        if (item.kind === "equipment" && equipment && onSelectEquipment) {
          onSelectEquipment(equipment);
        }
      }}
      className={cn(
        "flex items-center gap-2 rounded-md border transition-all select-none",
        isDragging && "opacity-40",
        greyOut && !isDragging && "opacity-40",
        isSelected
          ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5",
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className={cn(
          "flex w-7 shrink-0 touch-none items-center justify-center self-stretch rounded-l-md transition-colors",
          draggable
            ? "cursor-grab hover:bg-[var(--border)] active:cursor-grabbing"
            : "cursor-not-allowed opacity-30",
        )}
      >
        <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accentHex }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-tight font-medium">{item.name}</p>
          {item.brandName && (
            <p className="mt-0.5 truncate text-[10px] leading-tight text-[var(--muted-foreground)]">
              {item.brandName}
            </p>
          )}
        </div>
        {placed ? (
          <span
            className="shrink-0 rounded-sm bg-[var(--muted)] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-foreground)]"
            title={`${item.quantity} au BOM, ${item.quantity - item.remaining} placé(s)`}
          >
            Placé
          </span>
        ) : (
          <>
            {shelfOnly && (
              <span
                className="shrink-0 rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-foreground)]"
                title="Équipement non rackable — se pose sur une étagère"
              >
                Étagère
              </span>
            )}
            {/* Carte agrégée : reste à placer. Pas de « ×1 » — un seul
                exemplaire restant n'a pas besoin d'être compté. */}
            {remainingCount != null && remainingCount > 1 && (
              <span
                className="shrink-0 tabular-nums text-[11px] font-semibold text-[var(--muted-foreground)]"
                style={{ fontFamily: "var(--font-mono)" }}
                title={`${remainingCount} à placer sur ${item.quantity}`}
              >
                ×{remainingCount}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
