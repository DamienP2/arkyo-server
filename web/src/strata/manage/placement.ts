/**
 * « À placer » d'un contenant rackable, par la règle de l'onglet Rack
 * d'arkyo (« Éléments à placer », `rack-tab-side-panel.tsx` `BomItemsList`,
 * et `use-rack-bom.ts`) :
 *   - entrées : l'inventaire du contenant (`GET /api/tenant/projects/{id}/
 *     racks/{rackId}/inventory`, seul à porter la configuration des
 *     accessoires et la référence des panels) et ses slots (`canvas-data`) ;
 *   - restant = `computeBomRemaining` d'arkyo : quantité moins les slots posés
 *     (`startU` renseigné) de la même référence (équipement, panel, ou
 *     accessoire de même type, hauteur, style ou profondeur) ;
 *   - éléments retenus : équipements (rackables avec une hauteur, ou posés
 *     sur étagère), panels et accessoires ; ni adaptateurs ni composants de
 *     châssis.
 *
 * `slotRefsForCount` reprend la conversion `toSlotRefs` de `use-rack-bom.ts`
 * (fichier copié, fonction non exportée) à l'identique.
 */

import {
  computeBomRemaining,
  type AccessoryHeightU,
  type AccessoryType,
  type BomItem,
  type PlaqueVariant,
  type SlotRefForCount,
} from "@/lib/services/rack-inventory";
import type { InventaireBomItem } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { Slot } from "@/components/synoptique/lib/types";

/** Ligne de `GET …/racks/{rackId}/inventory` (champs utilisés). */
export type InventoryDto = {
  id: string;
  kind: "equipment" | "panel" | "adapter" | "accessory";
  refId?: string;
  accessoryType?: AccessoryType;
  accessoryHeightU?: AccessoryHeightU;
  accessoryVariant?: PlaqueVariant;
  accessoryDepthMm?: number;
  quantity: number;
  hostItemId?: string | null;
};

const HEIGHTS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** `toSlotRefs` d'arkyo : slots posés (et contenu des étagères) → références comptées. */
export function slotRefsForCount(slots: readonly Slot[]): SlotRefForCount[] {
  const refs: SlotRefForCount[] = [];
  const push = (s: Slot) => {
    if (!s.equipmentId && !s.panel && typeof s.notes === "string" && s.notes.length > 0) {
      try {
        const obj = JSON.parse(s.notes) as Record<string, unknown> | null;
        const type = obj?.accessoryType;
        if (obj && (type === "plaque" || type === "etagere" || type === "tiroir")) {
          const h = s.heightU ?? 0;
          if (HEIGHTS.includes(h)) {
            const variant = type === "plaque" && typeof obj.style === "string" ? (obj.style as PlaqueVariant) : undefined;
            const depth =
              type !== "plaque" && typeof obj.depthMm === "number" && Number.isFinite(obj.depthMm) && obj.depthMm > 0
                ? obj.depthMm
                : null;
            refs.push({
              equipmentId: null,
              panelId: null,
              accessoryType: type,
              accessoryHeightU: h as AccessoryHeightU,
              accessoryVariant: variant,
              accessoryDepthMm: depth,
            });
            return;
          }
        }
      } catch {
        /* notes non JSON : slot ignoré, comme arkyo */
      }
    }
    if (s.startU == null) return;
    refs.push({ equipmentId: s.equipmentId ?? s.catalogEquipmentId ?? null, panelId: s.panel?.id ?? null });
  };
  for (const s of slots) {
    push(s);
    for (const child of s.children ?? []) push(child);
  }
  return refs;
}

function toBomItem(dto: InventoryDto): BomItem {
  if (dto.kind === "equipment" && dto.refId) return { equipmentId: dto.refId, quantity: dto.quantity };
  if (dto.kind === "panel" && dto.refId) return { panelId: dto.refId, quantity: dto.quantity };
  if (dto.kind === "adapter" && dto.refId) return { adapterId: dto.refId, quantity: dto.quantity };
  if (dto.kind === "accessory" && dto.accessoryType !== undefined && dto.accessoryHeightU !== undefined)
    return {
      accessoryType: dto.accessoryType,
      accessoryHeightU: dto.accessoryHeightU,
      accessoryVariant: dto.accessoryVariant,
      accessoryDepthMm: dto.accessoryDepthMm,
      quantity: dto.quantity,
    };
  return { quantity: dto.quantity };
}

/**
 * Filtre de `BomItemsList` : ce qui se pose dans le contenant. Les champs
 * d'équipement (`isRackable`, `heightU`) sont ceux de la ligne d'inventaire de
 * l'éditeur, lus dans la même fiche du catalogue qu'arkyo.
 */
export function isPlaceable(item: Pick<InventaireBomItem, "kind" | "hostItemId" | "isRackable" | "heightU">): boolean {
  if (item.hostItemId) return false;
  if (item.kind === "adapter") return false;
  if (item.kind === "equipment") {
    const shelfOnly = item.isRackable === false;
    if (!shelfOnly && (item.heightU == null || item.heightU <= 0)) return false;
  }
  return item.kind === "equipment" || item.kind === "panel" || item.kind === "accessory";
}

/** Restant à placer par ligne d'inventaire (id), pour tout l'inventaire du contenant. */
export function remainingByItem(inventory: readonly InventoryDto[], slots: readonly Slot[]): Map<string, number> {
  const withRemaining = computeBomRemaining(inventory.map(toBomItem), slotRefsForCount(slots));
  return new Map(inventory.map((dto, i) => [dto.id, withRemaining[i]?.remaining ?? dto.quantity]));
}
