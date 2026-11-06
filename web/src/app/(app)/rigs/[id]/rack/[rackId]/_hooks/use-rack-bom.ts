"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeBomRemaining,
  type AccessoryHeightU,
  type AccessoryType,
  type BomItem,
  type PlaqueVariant,
  type SlotRefForCount,
} from "@/lib/services/rack-inventory";
import type { Slot } from "@/components/synoptique/lib/types";
import { subscribeAppEvents } from "@/lib/app-events-client";

/**
 * BomItem enrichi côté client avec :
 *  - métadonnées d'affichage (id stable, nom, image, etc.) qui viennent du
 *    payload `GET /api/tenant/projects/[id]/racks/[rackId]/inventory`
 *  - `remaining` : nombre d'unités encore à placer dans le rack, calculé
 *    localement par `computeBomRemaining` à partir des slots du rack-editor.
 *
 * Le `kind` discrimine la source catalogue. Pour `kind === "accessory"`,
 * `accessoryType` + `accessoryHeightU` (+ `accessoryVariant` si plaque) sont
 * définis ; pour les autres, `refId` pointe vers Equipment/Panel/Adapter.
 */
export type BomItemWithRemaining = BomItem & {
  /** ID de la ligne RackInventoryItem (Prisma) — stable côté serveur. */
  id: string;
  kind: "equipment" | "panel" | "adapter" | "accessory";
  refId?: string;
  /** Libellé d'affichage prêt à l'emploi (côté serveur). */
  name: string;
  reference: string | null;
  imageUrl: string | null;
  brandName: string | null;
  heightU: number | null;
  widthFraction: "FULL" | "HALF" | "THIRD" | "QUARTER" | null;
  panelType: "PATCH" | "ACCESSORY" | null;
  /** Catégorie/fonction primaire (label CatalogFunction). */
  category: string | null;
  /** Couleur hex de la catégorie/fonction primaire. */
  categoryColor: string | null;
  /**
   * Non-null si l'item est un composant installé dans un hôte (châssis
   * modulaire). Les composants n'ont pas d'empreinte U → exclus du placement.
   */
  hostItemId: string | null;
  /** Quantité encore à placer (`max(0, quantity - placés)`). */
  remaining: number;
};

/**
 * Discriminant pour signaler l'état du fetch :
 *   - `loading`   : requête en cours
 *   - `success`   : items disponibles (inclut tableau vide pour BOM vide)
 *   - `disabled`  : aucun projectId fourni → pas de BOM, fallback catalogue
 *   - `not-found` : 404 (rack pas dans projet) → fallback catalogue
 *   - `error`     : autre erreur réseau/HTTP → fallback catalogue
 */
export type RackBomState =
  | { status: "loading"; items: BomItemWithRemaining[]; refresh: () => void }
  | { status: "success"; items: BomItemWithRemaining[]; refresh: () => void }
  | { status: "disabled"; items: BomItemWithRemaining[]; refresh: () => void }
  | { status: "not-found"; items: BomItemWithRemaining[]; refresh: () => void }
  | {
      status: "error";
      items: BomItemWithRemaining[];
      message: string;
      refresh: () => void;
    };

/** Réponse brute de l'endpoint inventory (contrat figé dans la route handler). */
type ApiBomItemDto = {
  id: string;
  kind: "equipment" | "panel" | "adapter" | "accessory";
  refId?: string;
  accessoryType?: AccessoryType;
  accessoryHeightU?: AccessoryHeightU;
  accessoryVariant?: PlaqueVariant;
  /** Profondeur en mm — étagère/tiroir uniquement. */
  accessoryDepthMm?: number;
  quantity: number;
  name: string;
  reference: string | null;
  imageUrl: string | null;
  brandName: string | null;
  heightU: number | null;
  widthFraction: "FULL" | "HALF" | "THIRD" | "QUARTER" | null;
  panelType: "PATCH" | "ACCESSORY" | null;
  category?: string | null;
  categoryColor?: string | null;
  /** Non-null si l'item est un composant imbriqué dans un hôte. */
  hostItemId?: string | null;
};

/**
 * Convertit un `Slot` du rack-editor (top-level + children étagère) en
 * `SlotRefForCount` consommable par `computeBomRemaining`. Les accessoires
 * sont détectés via le JSON sérialisé dans `slot.notes` (convention héritée
 * du rack-editor : `{ accessoryType, style?, depthMm? }`).
 */
function toSlotRefs(slots: Slot[]): SlotRefForCount[] {
  const refs: SlotRefForCount[] = [];

  const pushSlot = (s: Slot) => {
    // Accessoire : détecté via notes JSON.
    if (!s.equipmentId && !s.panel && typeof s.notes === "string" && s.notes.length > 0) {
      try {
        const parsed: unknown = JSON.parse(s.notes);
        if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          const aType = obj.accessoryType;
          if (aType === "plaque" || aType === "etagere" || aType === "tiroir") {
            const aHeightU = (s as unknown as { heightU?: number }).heightU ?? 0;
            // Bornes calquées sur `AccessoryHeightU` (lib/services/rack-inventory.ts).
            if (
              aHeightU === 1 ||
              aHeightU === 2 ||
              aHeightU === 3 ||
              aHeightU === 4 ||
              aHeightU === 5 ||
              aHeightU === 6 ||
              aHeightU === 7 ||
              aHeightU === 8
            ) {
              const aVariant =
                aType === "plaque" && typeof obj.style === "string"
                  ? (obj.style as PlaqueVariant)
                  : undefined;
              // Profondeur stockée dans `notes.depthMm` (cf. placeAccessory).
              // Sert à dissocier le compteur étagère 300mm vs 450mm.
              const aDepthMm =
                aType !== "plaque" &&
                typeof obj.depthMm === "number" &&
                Number.isFinite(obj.depthMm) &&
                obj.depthMm > 0
                  ? (obj.depthMm as number)
                  : null;
              refs.push({
                equipmentId: null,
                panelId: null,
                accessoryType: aType,
                accessoryHeightU: aHeightU,
                accessoryVariant: aVariant,
                accessoryDepthMm: aDepthMm,
              });
              return;
            }
          }
        }
      } catch {
        /* notes non-JSON — slot ignoré pour le compteur BOM */
      }
    }

    // Ne compte que les slots PLACÉS (startU != null). Les slots fantômes
    // créés par sync inventaire (vague 5B) ont startU=null et représentent
    // des items "à placer" — ils ne doivent pas décrémenter `remaining`.
    if (s.startU == null) return;
    // `equipmentId` est l'alias déprécié de `catalogEquipmentId`. Les slots
    // venant via SSE (use-rack-sync) n'ont que `catalogEquipmentId`. Fallback.
    const eqId = s.equipmentId ?? s.catalogEquipmentId ?? null;
    refs.push({
      equipmentId: eqId,
      panelId: s.panel?.id ?? null,
    });
  };

  for (const s of slots) {
    pushSlot(s);
    for (const child of s.children ?? []) {
      pushSlot(child);
    }
  }

  return refs;
}

/**
 * Fetch le BOM d'un rack et calcule les compteurs `remaining` à partir des
 * slots passés en paramètre.
 *
 * Re-fetch sur changement de `projectId` ou `rackId`. Les compteurs `remaining`
 * sont recalculés en pure logique à chaque changement de `slots` (pas de
 * re-fetch réseau).
 *
 * Si `projectId` est null, le hook fetche `/api/racks/[id]/inventory` (mode
 * "rack template" standalone). Si on veut explicitement le désactiver, passer
 * `mode: "disabled"` en 4e argument.
 */
export function useRackBom(
  projectId: string | null,
  rackId: string,
  slots: Slot[],
  mode: "auto" | "disabled" = "auto",
): RackBomState {
  const [rawItems, setRawItems] = useState<ApiBomItemDto[] | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "not-found" | "error" | "disabled">(
    mode === "disabled" ? "disabled" : "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string>("");
  // Bump pour forcer un refetch sans changer projectId/rackId.
  const [refreshTick, setRefreshTick] = useState(0);
  // Le fetch en cours peut être abandonné depuis un effect cancel ou un nouveau tick.
  const cancelledRef = useRef(false);

  // Callable depuis l'effet SSE pour bump le tick (refetch).
  const bumpRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (mode === "disabled") {
      setStatus("disabled");
      setRawItems(null);
      return;
    }
    cancelledRef.current = false;
    let cancelled = false;
    // Premier fetch : passe en "loading" + reset items. Pour les refetch
    // SSE-trigger (refreshTick > 0), on garde les items précédents pour
    // éviter un flash "loading" — la résolution écrasera ensuite.
    if (refreshTick === 0) {
      setStatus("loading");
      setRawItems(null);
    }

    // Si projectId est fourni → route projet (snapshot-aware).
    // Sinon → route template (sans snapshot).
    const url = projectId
      ? `/api/tenant/projects/${projectId}/racks/${rackId}/inventory`
      : `/api/racks/${rackId}/inventory`;

    fetch(url, {
      method: "GET",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setStatus("not-found");
          setRawItems([]);
          return;
        }
        if (!res.ok) {
          setStatus("error");
          setErrorMessage(`HTTP ${res.status}`);
          setRawItems([]);
          return;
        }
        const data = (await res.json()) as { items?: ApiBomItemDto[] };
        if (cancelled) return;
        setRawItems(Array.isArray(data?.items) ? data.items : []);
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setRawItems([]);
      });

    return () => {
      cancelled = true;
      cancelledRef.current = true;
    };
  }, [projectId, rackId, refreshTick, mode]);

  // ── SSE : refetch BOM dès qu'un autre client modifie l'inventaire ─────────
  // L'API publie `publishAppUpdate("rack_inventory", "updated", rackId)` à
  // chaque create / update / delete. On filtre sur le rackId courant.
  useEffect(() => {
    if (mode === "disabled") return;
    return subscribeAppEvents((data) => {
      const payload = data as {
        type?: string;
        entity?: string;
        action?: string;
        id?: string;
      } | null;
      if (!payload) return;
      if (payload.type === "ping" || payload.type === "connected") return;
      if (payload.entity !== "rack_inventory") return;
      if (payload.id && payload.id !== rackId) return;
      bumpRefresh();
    });
  }, [mode, rackId, bumpRefresh]);

  // Calcul `remaining` côté client (pure, sans appel réseau).
  const items = useMemo<BomItemWithRemaining[]>(() => {
    if (!rawItems || rawItems.length === 0) return [];

    // Convertit les ApiBomItemDto en BomItem nus pour computeBomRemaining.
    const bomItems: BomItem[] = rawItems.map((dto) => {
      if (dto.kind === "equipment" && dto.refId) {
        return { equipmentId: dto.refId, quantity: dto.quantity };
      }
      if (dto.kind === "panel" && dto.refId) {
        return { panelId: dto.refId, quantity: dto.quantity };
      }
      if (dto.kind === "adapter" && dto.refId) {
        return { adapterId: dto.refId, quantity: dto.quantity };
      }
      if (
        dto.kind === "accessory" &&
        dto.accessoryType !== undefined &&
        dto.accessoryHeightU !== undefined
      ) {
        return {
          accessoryType: dto.accessoryType,
          accessoryHeightU: dto.accessoryHeightU,
          accessoryVariant: dto.accessoryVariant,
          accessoryDepthMm: dto.accessoryDepthMm,
          quantity: dto.quantity,
        };
      }
      // Cas dégénéré : on retourne un item vide (remaining = quantity).
      return { quantity: dto.quantity };
    });

    const slotRefs = toSlotRefs(slots);
    const withRemaining = computeBomRemaining(bomItems, slotRefs);

    // Re-zip les métadonnées d'affichage.
    return rawItems.map((dto, idx): BomItemWithRemaining => {
      const r = withRemaining[idx]?.remaining ?? dto.quantity;
      const base: BomItemWithRemaining = {
        id: dto.id,
        kind: dto.kind,
        refId: dto.refId,
        accessoryType: dto.accessoryType,
        accessoryHeightU: dto.accessoryHeightU,
        accessoryVariant: dto.accessoryVariant,
        accessoryDepthMm: dto.accessoryDepthMm,
        quantity: dto.quantity,
        name: dto.name,
        reference: dto.reference,
        imageUrl: dto.imageUrl,
        brandName: dto.brandName,
        heightU: dto.heightU,
        widthFraction: dto.widthFraction,
        panelType: dto.panelType,
        category: dto.category ?? null,
        categoryColor: dto.categoryColor ?? null,
        hostItemId: dto.hostItemId ?? null,
        remaining: r,
      };
      // Recopie les champs équipement/panel/adapter/accessory au top-level
      // (compatibilité BomItem).
      if (dto.kind === "equipment" && dto.refId) base.equipmentId = dto.refId;
      else if (dto.kind === "panel" && dto.refId) base.panelId = dto.refId;
      else if (dto.kind === "adapter" && dto.refId) base.adapterId = dto.refId;
      return base;
    });
  }, [rawItems, slots]);

  if (status === "disabled") {
    return { status: "disabled", items: [], refresh: bumpRefresh };
  }
  if (status === "loading") {
    return { status: "loading", items: [], refresh: bumpRefresh };
  }
  if (status === "not-found") {
    return { status: "not-found", items, refresh: bumpRefresh };
  }
  if (status === "error") {
    return { status: "error", items, message: errorMessage, refresh: bumpRefresh };
  }
  return { status: "success", items, refresh: bumpRefresh };
}
