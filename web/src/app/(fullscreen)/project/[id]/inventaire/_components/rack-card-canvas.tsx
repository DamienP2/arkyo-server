"use client";

/**
 * Machinerie BOM partagée de l'inventaire (le nom du fichier est historique —
 * la carte de contenant vit désormais dans `container-sheet-card.tsx`).
 *
 * Contenu :
 *  - types `RackCardData` / `RackCardBomItem` (payload d'un contenant)
 *  - `computeRackTotals` / `formatNum` (totaux affichés en en-tête)
 *  - `BomList` / `BomRow` : lignes éditables inline (quantité, retrait, drift)
 *  - `HostSlotLines` : slots d'un châssis en lignes (mode template) — la fiche
 *    de lieu utilise `SlotRuler` via `slotVariant="ruler"`
 *  - `computeHostBadges` : badges « #n » des exemplaires d'un même châssis
 */

import {
  AlertTriangle,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "@/components/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import {
  useInventaireScope,
  type ItemMoveDragData,
} from "./inventaire-scope";
import { SlotRuler } from "./slot-ruler";
import { categoryColor, type RackMiniSlot } from "./rack-mini-svg";
// arkyo-server: `update-snapshot-modal` non porté (snapshots du catalogue
// Arkyo, SaaS), voir le montage retiré dans `BomList`.

// ── Types ────────────────────────────────────────────────────────────────────

type RackType = "STANDARD" | "FLIGHT_CASE_CLASSIC" | "FLIGHT_CASE_SKB" | "PELICAN" | "CAP";

/**
 * Forme acceptée pour la card. On accepte un sur-ensemble du type
 * `InventaireRack` pour rester découplé : tout champ optionnel non fourni
 * sera tolérant.
 */
export type RackCardSlot = RackMiniSlot & {
  equipmentName?: string | null;
  equipmentReference?: string | null;
  brandName?: string | null;
};

export type RackCardBomItem = {
  id: string;
  kind: "equipment" | "panel" | "adapter" | "accessory";
  /** Identité catalogue — sert à numéroter les exemplaires d'un même hôte. */
  refId?: string;
  quantity: number;
  name: string;
  reference: string | null;
  brandName: string | null;
  category: string | null;
  /** Couleur hex de la catégorie/fonction primaire (CatalogFunction.color). */
  categoryColor?: string | null;
  isRackable?: boolean;
  heightU?: number | null;
  depthMm?: number | null;
  weightKg?: number | null;
  powerW?: number | null;
  /**
   * ID du snapshot ProjectCatalogueSnapshot associé (items Arkyo équipement/adaptateur).
   * Utilisé pour afficher l'icône drift quand une mise à jour est disponible.
   */
  snapshotId?: string | null;
  // ── Composants modulaires (châssis type Ross openGear) ──────────────────────
  /** Non-null si cet item est un composant installé dans un hôte (pointe l'hôte). */
  hostItemId?: string | null;
  /** Position (0-based) occupée dans l'hôte — null si non imbriqué. */
  hostSlotIndex?: number | null;
  /** L'équipement de cet item peut-il accueillir des composants ? */
  isComponentHost?: boolean;
  /** Nombre de slots internes de l'hôte — null si non applicable. */
  hostSlotCount?: number | null;
  /** Cet équipement est-il conçu pour être installé comme composant ? */
  isComponent?: boolean;
  /** Nombre de slots occupés dans l'hôte une fois installé. */
  componentSlotSpan?: number;
};

export type RackCardData = {
  id: string;
  name: string;
  rackType: RackType;
  totalU: number;
  depthMm: number;
  /** Largeur extérieure mm — non-rackable (flight, pelicase, mobilier). */
  widthMm?: number | null;
  /** Hauteur extérieure mm — non-rackable. */
  heightMm?: number | null;
  /** Poids à vide du contenant (kg) — base du total poids affiché. */
  emptyWeightKg?: number | null;
  slotsCount: number;
  isRackable?: boolean;
  /** Slots pour le mini SVG + liste expanded (vide = card vide). */
  slots?: RackCardSlot[];
  /** BOM agrégé (items ajoutés via drag&drop, pré-placement). */
  bom?: RackCardBomItem[];
  /** Compteurs pour les non-rackable. Optionnels. */
  panelsCount?: number;
  accessoriesCount?: number;
};

// ── Maps statiques (alignées sur inventaire-client.tsx) ─────────────────────

const RACK_TYPE_LABEL: Record<RackType, string> = {
  STANDARD: 'Baie standard 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

const RACK_TYPE_COLOR: Record<RackType, string> = {
  STANDARD: "#3b82f6",
  FLIGHT_CASE_CLASSIC: "#f59e0b",
  FLIGHT_CASE_SKB: "#f59e0b",
  PELICAN: "#06b6d4",
  CAP: "#a855f7",
};

// ── Totaux d'un contenant ────────────────────────────────────────────────────

const U_HEIGHT_MM = 44.45;
const RACK_WIDTH_19_MM = 600;

export type RackTotals = {
  /** U occupés par les items rackables (composants exclus). */
  usedU: number;
  /** Poids à vide + BOM (kg). */
  weightKg: number;
  /** Consommation cumulée du BOM (W). */
  powerW: number;
  /** Volume estimé (m³) — 0 si indéterminable. */
  volumeM3: number;
};

/**
 * Sous-ensemble suffisant pour les totaux — accepte aussi bien un
 * `RackCardData` qu'un `InventaireRack` (dont les slots ont une autre forme).
 */
export type RackTotalsInput = {
  isRackable?: boolean;
  totalU: number;
  depthMm: number;
  widthMm?: number | null;
  heightMm?: number | null;
  emptyWeightKg?: number | null;
  bom?: RackCardBomItem[];
};

/** Agrège les totaux affichés dans l'en-tête d'un contenant et du lieu. */
export function computeRackTotals(rack: RackTotalsInput): RackTotals {
  const bom = rack.bom ?? [];
  let usedU = 0;
  let weightKg = rack.emptyWeightKg ?? 0;
  let powerW = 0;
  for (const it of bom) {
    // Les composants occupent des slots internes de leur châssis, pas des U.
    if (it.hostItemId == null && it.isRackable && typeof it.heightU === "number") {
      usedU += it.heightU * it.quantity;
    }
    if (typeof it.weightKg === "number") weightKg += it.weightKg * it.quantity;
    if (typeof it.powerW === "number") powerW += it.powerW * it.quantity;
  }
  let mm3 = 0;
  if (rack.isRackable && rack.totalU > 0 && rack.depthMm > 0) {
    mm3 = RACK_WIDTH_19_MM * (rack.totalU * U_HEIGHT_MM) * rack.depthMm;
  } else if (rack.widthMm && rack.heightMm && rack.depthMm > 0) {
    mm3 = rack.widthMm * rack.heightMm * rack.depthMm;
  }
  return { usedU, weightKg, powerW, volumeM3: mm3 / 1e9 };
}

/** Format FR compact (max 2 décimales, séparateur de milliers fine). */
export function formatNum(n: number): string {
  if (n === 0) return "0";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export { RACK_TYPE_LABEL, RACK_TYPE_COLOR };

// ── Sub-components ──────────────────────────────────────────────────────────

/**
 * computeHostBadges — attribue un badge « #n » aux exemplaires d'un même
 * équipement hôte quand le contenant en possède plusieurs (même `refId`).
 * Retourne une Map itemId → « #n ». Un hôte unique n'obtient pas de badge.
 * Partagé entre la card de contenant (mode projet) et la card modulaire
 * (mode template) pour une numérotation identique.
 */
export function computeHostBadges(
  bom: RackCardBomItem[],
): Map<string, string> {
  const byRef = new Map<string, RackCardBomItem[]>();
  for (const it of bom) {
    if (it.hostItemId) continue;
    if (it.kind !== "equipment") continue;
    if (it.isComponentHost !== true) continue;
    const key = it.refId ?? it.id;
    const bucket = byRef.get(key);
    if (bucket) bucket.push(it);
    else byRef.set(key, [it]);
  }
  const badges = new Map<string, string>();
  for (const bucket of byRef.values()) {
    if (bucket.length < 2) continue;
    bucket.forEach((it, i) => badges.set(it.id, `#${i + 1}`));
  }
  return badges;
}

const KIND_LABEL: Record<RackCardBomItem["kind"], string> = {
  equipment: "Équipements",
  panel: "Panels",
  adapter: "Adaptateurs",
  accessory: "Accessoires",
};
const KIND_ORDER: ReadonlyArray<RackCardBomItem["kind"]> = [
  "equipment",
  "panel",
  "adapter",
  "accessory",
];

/**
 * Rendu des slots d'un châssis modulaire :
 *  - `lines` : une ligne par slot, indentée sous la row de l'hôte (mode
 *    template / cartes étroites)
 *  - `ruler` : réglette horizontale (fiche de lieu)
 */
export type SlotVariant = "lines" | "ruler";

export function BomList({
  rackId,
  bom,
  slotVariant = "lines",
  emptyLabel = "Aucun équipement.",
}: {
  rackId: string;
  bom: RackCardBomItem[];
  slotVariant?: SlotVariant;
  /** Texte affiché quand le BOM est vide. */
  emptyLabel?: string;
}) {
  // Modal "Mise à jour disponible" — état partagé pour toutes les rows du BOM.
  const { projectId, refreshDrift, refreshRackBom } = useInventaireScope();
  const [updateSnapshot, setUpdateSnapshot] = useState<{
    snapshotId: string;
    itemName: string;
  } | null>(null);

  // Numérotation des exemplaires d'un même équipement hôte. Un badge « #n » est
  // attribué (dans l'ordre des rows) uniquement quand le contenant possède
  // plusieurs exemplaires du même hôte — sinon exemplaire unique, pas de badge.
  const hostBadges = useMemo(() => computeHostBadges(bom), [bom]);

  // Composants installés, indexés par item hôte. Les composants ne s'affichent
  // pas comme rows top-level : ils apparaissent sous les lignes de slot de leur hôte.
  const componentsByHost = useMemo(() => {
    const map = new Map<string, RackCardBomItem[]>();
    for (const it of bom) {
      if (it.hostItemId) {
        const bucket = map.get(it.hostItemId);
        if (bucket) bucket.push(it);
        else map.set(it.hostItemId, [it]);
      }
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => (a.hostSlotIndex ?? 0) - (b.hostSlotIndex ?? 0));
    }
    return map;
  }, [bom]);

  if (bom.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-5 text-center">
        <p className="text-[11px] text-[var(--muted-foreground)]">{emptyLabel}</p>
      </div>
    );
  }
  // Rows top-level : on exclut les composants imbriqués (rendus sous leur hôte).
  const byKind = bom.reduce<Record<string, RackCardBomItem[]>>((acc, it) => {
    if (it.hostItemId) return acc;
    if (!acc[it.kind]) acc[it.kind] = [];
    acc[it.kind].push(it);
    return acc;
  }, {});
  return (
    <>
      <div className="flex flex-col gap-2 px-2 py-2">
        {KIND_ORDER.map((kind) => {
          const items = byKind[kind];
          if (!items || items.length === 0) return null;
          return (
            <div key={kind} className="flex flex-col gap-0.5">
              <p className="px-2 pt-1 text-[9px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]/70">
                {KIND_LABEL[kind]}
              </p>
              {items.map((it) => (
                <BomRow
                  key={it.id}
                  rackId={rackId}
                  item={it}
                  slotVariant={slotVariant}
                  instanceBadge={hostBadges.get(it.id) ?? null}
                  installedComponents={componentsByHost.get(it.id) ?? []}
                  onUpdateRequest={(snapshotId) =>
                    setUpdateSnapshot({ snapshotId, itemName: it.name })
                  }
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Modal de mise à jour snapshot — uniquement en mode projet (le snapshot
          n'a de sens qu'avec un projectId). En mode template (projectId=null),
          ce modal n'est jamais ouvert. */}
      {/* arkyo-server: `UpdateSnapshotModal` retiré (mise à jour d'un
          snapshot du catalogue Arkyo, SaaS ; catalogue unique). `getDrift`
          renvoie toujours `null` : l'icône qui l'ouvrait n'apparaît jamais. */}
    </>
  );
}

function BomRow({
  rackId,
  item,
  slotVariant = "lines",
  instanceBadge = null,
  installedComponents = [],
  onUpdateRequest,
}: {
  rackId: string;
  item: RackCardBomItem;
  slotVariant?: SlotVariant;
  /** Badge « #n » quand plusieurs exemplaires du même hôte cohabitent. */
  instanceBadge?: string | null;
  /** Composants installés dans cet hôte — vide si l'item n'est pas un hôte. */
  installedComponents?: RackCardBomItem[];
  /** Click sur l'icône drift → demande l'ouverture du modal de mise à jour. */
  onUpdateRequest?: (snapshotId: string) => void;
}) {
  const {
    projectId,
    refreshRackBom,
    notifySave,
    getDrift,
    catalogOptions,
    selectedItem,
    selectItem,
  } = useInventaireScope();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isHost = item.isComponentHost === true && item.hostSlotCount != null;
  // Slots occupés du châssis (span inclus) — badge « SLOTS n/N » de la réglette.
  const usedSlots = installedComponents.reduce(
    (sum, c) => sum + Math.max(1, c.componentSlotSpan ?? 1),
    0,
  );
  // Couleur du point : priorité absolue à item.categoryColor (issu de
  // CatalogFunction.color via l'API inventory). Fallback sur le scope
  // (catalogOptions) puis sur le mapping legacy de `categoryColor`.
  const scopeColor = item.category
    ? (catalogOptions.categories.find((c) => c.name === item.category)?.color ??
       catalogOptions.adapterCategories.find((c) => c.name === item.category)?.color ??
       null)
    : null;
  const dot = item.categoryColor ?? scopeColor ?? categoryColor(item.category);
  // arkyo-server: `getDrift` (dérive du catalogue Arkyo, SaaS) n'est plus lu.

  const setQuantity = async (next: number) => {
    if (busy) return;
    if (next < 1) {
      void handleDelete();
      return;
    }
    setBusy(true);
    notifySave("saving");
    try {
      await api.patch(
        `/api/tenant/projects/${projectId}/racks/${rackId}/inventory/${item.id}`,
        { quantity: next },
      );
      await refreshRackBom(rackId);
      notifySave("saved");
    } catch (e) {
      notifySave("error");
      toast.error(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    const ok = await confirm({
      title: `Retirer « ${item.name} » ?`,
      description: "Cet item sera retiré de l'inventaire de ce contenant.",
      confirmLabel: "Retirer",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    notifySave("saving");
    try {
      await api.delete(
        `/api/tenant/projects/${projectId}/racks/${rackId}/inventory/${item.id}`,
      );
      await refreshRackBom(rackId);
      notifySave("saved");
    } catch (e) {
      notifySave("error");
      toast.error(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Un composant imbriqué suit son châssis : jamais draggable vers un autre
  // contenant (la route de transfert emmène les composants avec l'hôte).
  const isComponentRow = item.hostItemId != null;
  const dragData: ItemMoveDragData = useMemo(
    () => ({
      kind: "item-move",
      itemId: item.id,
      rackId,
      name: item.name,
      quantity: item.quantity,
      itemKind: item.kind,
      refId: item.refId,
    }),
    [item.id, item.name, item.quantity, item.kind, item.refId, rackId],
  );
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `bom-item-${item.id}`,
    data: dragData,
    disabled: isComponentRow || busy || !projectId,
  });

  const isSelected =
    selectedItem?.itemId === item.id && selectedItem.rackId === rackId;

  // Clic = sélection, glissé = déplacement. Le navigateur émet quand même un
  // `click` au relâchement d'un drag : on compare la distance parcourue depuis
  // le `pointerdown` (même seuil que le PointerSensor) pour ne pas sélectionner
  // à la fin d'un déplacement. `onPointerDownCapture` est un prop distinct de
  // `onPointerDown` — il ne recouvre donc pas le listener de dnd-kit.
  const pressPos = useRef<{ x: number; y: number } | null>(null);

  return (
    <div>
      <div
        ref={setDragRef}
        {...attributes}
        {...listeners}
        onPointerDownCapture={(e) => {
          pressPos.current = { x: e.clientX, y: e.clientY };
        }}
        onClick={(e) => {
          const from = pressPos.current;
          pressPos.current = null;
          if (isDragging) return;
          if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 5) {
            return;
          }
          selectItem(isSelected ? null : { rackId, itemId: item.id });
        }}
        className={cn(
          "group/row relative flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
          busy ? "opacity-60" : "hover:bg-[var(--secondary)]/40",
          !isComponentRow && !busy && projectId && "cursor-grab touch-none active:cursor-grabbing",
          isDragging && "opacity-40",
          isSelected &&
            "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] ring-1 ring-[var(--accent)]/50",
        )}
      >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-medium leading-tight">
          {instanceBadge && (
            <span className="shrink-0 rounded border border-[var(--border)] px-1 font-mono text-[9px] font-semibold tabular-nums text-[var(--muted-foreground)]">
              {instanceBadge}
            </span>
          )}
          <span className="truncate">{item.name}</span>
        </p>
        {(item.brandName || item.reference) && (
          <p className="truncate text-[9px] leading-tight text-[var(--muted-foreground)]">
            {[item.brandName, item.reference].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* arkyo-server: indicateur de dérive du catalogue Arkyo retiré (badge de
          snapshot, SaaS ; catalogue unique, `getDrift` toujours nul). */}

      {/* Occupation des slots du châssis — réglette uniquement (fiche de lieu). */}
      {isHost && slotVariant === "ruler" && (
        <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--secondary)]/60 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider tabular-nums text-[var(--muted-foreground)] uppercase">
          Slots {usedSlots}/{item.hostSlotCount ?? 0}
        </span>
      )}

      {/* Stepper quantité — masqué pour un hôte (1 exemplaire = 1 row, PATCH
          quantité interdit côté API). Trash au hover dans tous les cas. */}
      <div className="flex shrink-0 items-center gap-0.5">
        {!isHost && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void setQuantity(item.quantity - 1);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={busy}
              title={item.quantity <= 1 ? "Retirer" : "Diminuer"}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="min-w-[18px] text-center font-mono text-[10px] tabular-nums">
              {busy ? (
                <Loader2 className="mx-auto h-3 w-3 animate-spin" />
              ) : (
                item.quantity
              )}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void setQuantity(item.quantity + 1);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={busy || item.quantity >= 999} // arkyo-server: plafond de quantity (1..999), comme le serveur
              title="Augmenter"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleDelete();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={busy}
          title="Retirer"
          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-all group-hover/row:opacity-100 hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      </div>

      {/* Slots de l'hôte : réglette (fiche de lieu) ou lignes (mode template). */}
      {isHost &&
        (slotVariant === "ruler" ? (
          <SlotRuler
            rackId={rackId}
            host={item}
            installedComponents={installedComponents}
          />
        ) : (
          <HostSlotLines
            rackId={rackId}
            host={item}
            installedComponents={installedComponents}
          />
        ))}
    </div>
  );
}

// ── Lignes de slots d'un hôte modulaire ──────────────────────────────────────

/**
 * Taille de rendu des lignes de slot. `sm` (défaut) = card projet étroite
 * (320px, typo minimale) ; `md` = card template plus large où les slots
 * doivent être plus lisibles. Le rendu `sm` est INCHANGÉ par rapport à
 * l'existant — ne pas modifier ses valeurs.
 */
export type SlotSize = "sm" | "md";

const SLOT_SIZE: Record<
  SlotSize,
  {
    container: string;
    empty: string;
    emptyLabel: string;
    occupied: string;
    occupiedBadge: string;
    dot: string;
    name: string;
    ref: string;
    trash: string;
    trashIcon: string;
  }
> = {
  sm: {
    container: "mt-0.5 gap-0.5 pl-2",
    empty: "px-2 py-0.5",
    emptyLabel: "min-w-[56px] text-[9px]",
    occupied: "px-2 py-1",
    occupiedBadge: "h-4 min-w-[56px] px-1 text-[8px]",
    dot: "h-1.5 w-1.5",
    name: "text-[10px]",
    ref: "text-[8px]",
    trash: "h-5 w-5",
    trashIcon: "h-3 w-3",
  },
  md: {
    container: "mt-1 gap-1 pl-2.5",
    empty: "px-2.5 py-1.5",
    emptyLabel: "min-w-[60px] text-[10px]",
    occupied: "px-2.5 py-1.5",
    occupiedBadge: "h-5 min-w-[60px] px-1.5 text-[9px]",
    dot: "h-2 w-2",
    name: "text-[11px]",
    ref: "text-[9px]",
    trash: "h-6 w-6",
    trashIcon: "h-3.5 w-3.5",
  },
};

/**
 * HostSlotLines — rend une ligne 1-based par slot interne d'un hôte, indentée
 * sous la row de l'hôte.
 *  - Slot occupé : nom du composant (span > 1 → une seule ligne « Slot n–m »),
 *    retrait au hover.
 *  - Slot vide : ligne dashed discrète « Slot n », zone de drop directe (DnD).
 */
export function HostSlotLines({
  rackId,
  host,
  installedComponents,
  size = "sm",
}: {
  rackId: string;
  host: RackCardBomItem;
  installedComponents: RackCardBomItem[];
  /** Densité de rendu — `sm` (projet) inchangé, `md` (template) plus lisible. */
  size?: SlotSize;
}) {
  const slotCount = host.hostSlotCount ?? 0;

  // Occupation des slots : slotOwner[i] = composant démarrant en i, "covered"
  // pour les slots couverts par un composant multi-span, null si libre.
  const slotOwner = useMemo<(RackCardBomItem | "covered" | null)[]>(() => {
    const arr: (RackCardBomItem | "covered" | null)[] = new Array(slotCount).fill(null);
    for (const c of installedComponents) {
      const start = c.hostSlotIndex ?? 0;
      const span = Math.max(1, c.componentSlotSpan ?? 1);
      if (start < 0 || start >= slotCount) continue;
      arr[start] = c;
      for (let k = 1; k < span && start + k < slotCount; k++) {
        arr[start + k] = "covered";
      }
    }
    return arr;
  }, [installedComponents, slotCount]);

  if (slotCount <= 0) return null;

  const s = SLOT_SIZE[size];

  return (
    <div
      className={cn(
        "ml-3 flex flex-col border-l border-[var(--border)]",
        s.container,
      )}
    >
      {slotOwner.map((owner, i) => {
        if (owner === "covered") return null;
        if (owner) {
          const span = Math.max(1, owner.componentSlotSpan ?? 1);
          const slotLabel = span > 1 ? `Slot ${i + 1}–${i + span}` : `Slot ${i + 1}`;
          return (
            <OccupiedSlotLine
              key={owner.id}
              rackId={rackId}
              component={owner}
              slotLabel={slotLabel}
              size={size}
            />
          );
        }
        return (
          <EmptySlotDropLine
            key={`free-${i}`}
            hostItemId={host.id}
            slotIndex={i}
            rackId={rackId}
            slotLabel={`Slot ${i + 1}`}
            size={size}
          />
        );
      })}
    </div>
  );
}

/**
 * EmptySlotDropLine — ligne de slot vide, dashed, servant de cible de drop
 * directe pour un équipement glissé depuis le catalogue.
 */
function EmptySlotDropLine({
  hostItemId,
  slotIndex,
  rackId,
  slotLabel,
  size = "sm",
}: {
  hostItemId: string;
  slotIndex: number;
  rackId: string;
  slotLabel: string;
  size?: SlotSize;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `hostslot-${hostItemId}-${slotIndex}`,
    data: { hostItemId, slotIndex, rackId },
  });
  // Seuls les équipements marqués « composant » sont installables dans un
  // slot. Un drag d'équipement classique n'allume pas la ligne (le drop
  // retombe alors sur la carte → dialog quantité, comportement standard).
  const activeData = active?.data.current as
    | { kind?: string; isComponent?: boolean }
    | undefined;
  const componentDrag =
    activeData?.kind === "equipment" && activeData.isComponent === true;
  const s = SLOT_SIZE[size];
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 rounded-md border border-dashed transition-colors",
        s.empty,
        isOver && componentDrag
          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
          : componentDrag
            ? "border-[var(--accent)]/50"
            : "border-[var(--border)]/60",
      )}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center font-mono tabular-nums text-[var(--muted-foreground)]",
          s.emptyLabel,
        )}
      >
        {slotLabel}
      </span>
    </div>
  );
}

/**
 * OccupiedSlotLine — ligne d'un slot occupé par un composant : n° de slot +
 * nom, retrait au hover (même pattern delete que les rows normales).
 */
function OccupiedSlotLine({
  rackId,
  component,
  slotLabel,
  size = "sm",
}: {
  rackId: string;
  component: RackCardBomItem;
  slotLabel: string;
  size?: SlotSize;
}) {
  const { projectId, getInventoryUrl, refreshRackBom, notifySave } =
    useInventaireScope();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const handleRemove = async () => {
    if (busy) return;
    const ok = await confirm({
      title: `Retirer « ${component.name} » ?`,
      description: "Ce composant sera retiré de son châssis.",
      confirmLabel: "Retirer",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    notifySave("saving");
    try {
      await api.delete(`${getInventoryUrl(rackId)}/${component.id}`);
      await refreshRackBom(rackId);
      notifySave("saved");
    } catch (e) {
      notifySave("error");
      toast.error(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // `projectId` référencé pour rester cohérent avec le mode template/projet.
  void projectId;

  const s = SLOT_SIZE[size];

  return (
    <div
      className={cn(
        "group/sub relative flex items-center gap-2 rounded-md border border-[var(--border)]/60 bg-[var(--secondary)]/40 transition-colors",
        s.occupied,
        busy ? "opacity-60" : "hover:border-[var(--border)] hover:bg-[var(--secondary)]/60",
      )}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded border border-[var(--border)]/60 bg-[var(--card)] font-mono font-bold tabular-nums text-[var(--muted-foreground)]",
          s.occupiedBadge,
        )}
      >
        {slotLabel}
      </span>
      <span
        className={cn("shrink-0 rounded-full", s.dot)}
        style={{ background: component.categoryColor ?? "var(--muted-foreground)" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-semibold leading-tight", s.name)}>
          {component.name}
        </p>
        {component.reference && (
          <p
            className={cn(
              "truncate font-mono leading-tight text-[var(--muted-foreground)]",
              s.ref,
            )}
          >
            {component.reference}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={busy}
        title="Retirer"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-all group-hover/sub:opacity-100 hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] disabled:opacity-50",
          s.trash,
        )}
      >
        {busy ? (
          <Loader2 className={cn("animate-spin", s.trashIcon)} />
        ) : (
          <Trash2 className={s.trashIcon} />
        )}
      </button>
    </div>
  );
}

