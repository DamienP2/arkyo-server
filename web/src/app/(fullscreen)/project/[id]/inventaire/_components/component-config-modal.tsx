"use client";

/**
 * ComponentConfigModal — configuration des composants modulaires d'un item
 * hôte de l'inventaire (châssis type Ross openGear).
 *
 * Un hôte (`isComponentHost`) expose `hostSlotCount` slots internes. On y
 * installe des équipements « composants » (`isComponent`), chacun occupant
 * `componentSlotSpan` slots contigus. Un composant installé = un item
 * d'inventaire imbriqué (quantité fixe 1) qui n'apparaît jamais dans les
 * éléments « à placer ».
 *
 * Deux vues dans le même Dialog :
 *  - vue slots : liste 1-based des slots (occupés / libres) avec bouton dashed
 *    « Ajouter un composant » sur chaque slot libre + retrait au clic.
 *  - vue picker : liste filtrée du catalogue (`isComponent === true`) avec
 *    recherche texte simple ; sélection → POST vers l'inventaire.
 *
 * Contrat API :
 *   POST   {baseUrl}  body { catalogEquipmentId, hostItemId, hostSlotIndex }
 *   DELETE {baseUrl}/{itemId}
 *   GET    /api/tenant/catalogue/equipment?scope=all  → { arkyo, personal }
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Search, Server, Trash2, X } from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Forme minimale d'un item requise par le modal — structurellement compatible
 * avec `BomItem` (bom-panel) ET `RackCardBomItem` (rack-card-canvas), qui sont
 * les deux appelants. On ne dépend d'aucun des deux pour rester découplé.
 */
type ComponentModalItem = {
  id: string;
  name: string;
  reference: string | null;
  brandName: string | null;
  hostSlotIndex?: number | null;
  hostSlotCount?: number | null;
  componentSlotSpan?: number;
};

/** Équipement composant du catalogue (shape minimal utilisé par le picker). */
type PickerEquipment = {
  id: string;
  name: string;
  reference: string | null;
  brand: { id: string; name: string } | null;
  isComponent?: boolean;
  componentSlotSpan?: number;
};

type CatalogueResponse = {
  arkyo?: PickerEquipment[];
  personal?: PickerEquipment[];
};

// ── Component ────────────────────────────────────────────────────────────────

export function ComponentConfigModal({
  host,
  components,
  baseUrl,
  initialSlotIndex = null,
  onChanged,
  onClose,
}: {
  host: ComponentModalItem;
  /** Composants déjà installés dans cet hôte (dérivés du BOM par le parent). */
  components: ComponentModalItem[];
  /** URL de base de l'inventaire (`.../inventory`). */
  baseUrl: string;
  /**
   * Slot (0-based) sur lequel ouvrir directement le picker — utilisé par la
   * réglette de slots (clic sur une case vide). `null` = vue slots.
   */
  initialSlotIndex?: number | null;
  /** Rafraîchit le BOM après install / retrait. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const slotCount = host.hostSlotCount ?? 0;

  // Slot ciblé par le picker (null = vue slots). 0-based.
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(
    initialSlotIndex,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usedSlots = components.reduce(
    (sum, c) => sum + Math.max(1, c.componentSlotSpan ?? 1),
    0,
  );

  // Occupation des slots : slotOwner[i] = composant démarrant en i, "covered"
  // pour les slots couverts par un composant multi-span, null si libre.
  const slotOwner = useMemo<(ComponentModalItem | "covered" | null)[]>(() => {
    const arr: (ComponentModalItem | "covered" | null)[] = new Array(slotCount).fill(null);
    for (const c of components) {
      const start = c.hostSlotIndex ?? 0;
      const span = Math.max(1, c.componentSlotSpan ?? 1);
      if (start < 0 || start >= slotCount) continue;
      arr[start] = c;
      for (let k = 1; k < span && start + k < slotCount; k++) {
        arr[start + k] = "covered";
      }
    }
    return arr;
  }, [components, slotCount]);

  // ── Retrait d'un composant ────────────────────────────────────────────────
  const handleRemove = async (component: ComponentModalItem) => {
    const ok = await confirm({
      title: "Retirer ce composant ?",
      description: (
        <>
          <strong>{component.name}</strong> sera retiré de {host.name}.
        </>
      ),
      variant: "destructive",
      confirmLabel: "Retirer",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`${baseUrl}/${component.id}`);
      onChanged();
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Installation d'un composant ───────────────────────────────────────────
  const handleInstall = async (equipment: PickerEquipment, slotIndex: number) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(baseUrl, {
        catalogEquipmentId: equipment.id,
        hostItemId: host.id,
        hostSlotIndex: slotIndex,
      });
      onChanged();
      setPickerSlotIndex(null);
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-8 text-base">
            {pickerSlotIndex !== null ? "Ajouter un composant" : host.name}
          </DialogTitle>
          <p className="font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
            {pickerSlotIndex !== null
              ? `Slot ${pickerSlotIndex + 1}`
              : `${usedSlots}/${slotCount} slots`}
          </p>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            // arkyo-server: habillage Strata
            className="mb-3 rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--danger-text)]"
          >
            {error}
          </p>
        )}

        {pickerSlotIndex !== null ? (
          <ComponentPicker
            onBack={() => {
              setPickerSlotIndex(null);
              setError(null);
            }}
            onSelect={(equipment) => handleInstall(equipment, pickerSlotIndex)}
            busy={busy}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {slotOwner.map((owner, i) => {
              if (owner === "covered") return null;
              if (owner) {
                const span = Math.max(1, owner.componentSlotSpan ?? 1);
                const slotLabel =
                  span > 1 ? `Slot ${i + 1}–${i + span}` : `Slot ${i + 1}`;
                return (
                  <OccupiedSlotRow
                    key={owner.id}
                    component={owner}
                    slotLabel={slotLabel}
                    onRemove={() => handleRemove(owner)}
                    busy={busy}
                  />
                );
              }
              return (
                <FreeSlotButton
                  key={`free-${i}`}
                  slotLabel={`Slot ${i + 1}`}
                  onClick={() => {
                    setPickerSlotIndex(i);
                    setError(null);
                  }}
                  disabled={busy}
                />
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Slot rows ─────────────────────────────────────────────────────────────────

function OccupiedSlotRow({
  component,
  slotLabel,
  onRemove,
  busy,
}: {
  component: ComponentModalItem;
  slotLabel: string;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] py-1.5 pr-1.5 pl-2.5">
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">
        {slotLabel}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-tight">{component.name}</p>
        {(component.brandName || component.reference) && (
          <p className="truncate font-mono text-[10px] leading-tight text-[var(--muted-foreground)]">
            {[component.brandName, component.reference].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] disabled:pointer-events-none disabled:opacity-50"
        title="Retirer le composant"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FreeSlotButton({
  slotLabel,
  onClick,
  disabled,
}: {
  slotLabel: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-md border-2 border-dashed border-[var(--border)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">
        {slotLabel}
      </span>
      <span className="flex flex-1 items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)]">
        <Plus className="h-3.5 w-3.5" />
        Ajouter un composant
      </span>
    </button>
  );
}

// ── Picker ────────────────────────────────────────────────────────────────────

function ComponentPicker({
  onBack,
  onSelect,
  busy,
}: {
  onBack: () => void;
  onSelect: (equipment: PickerEquipment) => void;
  busy: boolean;
}) {
  const [items, setItems] = useState<PickerEquipment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<CatalogueResponse>(
          "/api/tenant/catalogue/equipment?scope=all",
        );
        if (cancelled) return;
        const merged = [...(res.arkyo ?? []), ...(res.personal ?? [])];
        setItems(merged.filter((e) => e.isComponent === true));
      } catch (e) {
        if (cancelled) return;
        setLoadError(getApiErrorMessage(e));
        setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.reference?.toLowerCase().includes(q) ?? false) ||
        (e.brand?.name.toLowerCase().includes(q) ?? false),
    );
  }, [items, search]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          title="Retour"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un composant…"
            className="flex h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 pl-8 text-sm focus:border-[var(--accent)] focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-[var(--border)]"
              title="Effacer"
            >
              <X className="h-3 w-3 text-[var(--muted-foreground)]" />
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <p
          role="alert"
          // arkyo-server: habillage Strata
          className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--danger-text)]"
        >
          {loadError}
        </p>
      )}

      {items === null ? (
        <LoadingState label="Chargement du catalogue…" className="py-10" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Server strokeWidth={1.5} />}
          title="Aucun composant"
          description={
            search
              ? "Aucun composant ne correspond à cette recherche."
              : "Aucun équipement du catalogue n'est marqué comme composant."
          }
          className="py-10"
        />
      ) : (
        <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
          {filtered.map((equipment) => (
            <PickerRow
              key={equipment.id}
              equipment={equipment}
              onSelect={() => onSelect(equipment)}
              disabled={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PickerRow({
  equipment,
  onSelect,
  disabled,
}: {
  equipment: PickerEquipment;
  onSelect: () => void;
  disabled: boolean;
}) {
  const span = Math.max(1, equipment.componentSlotSpan ?? 1);
  const meta = [
    equipment.brand?.name,
    equipment.reference,
    span > 1 ? `${span} slots` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-left transition-colors",
        "hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-tight">{equipment.name}</p>
        {meta && (
          <p className="truncate font-mono text-[10px] leading-tight text-[var(--muted-foreground)]">
            {meta}
          </p>
        )}
      </div>
      <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
    </button>
  );
}
