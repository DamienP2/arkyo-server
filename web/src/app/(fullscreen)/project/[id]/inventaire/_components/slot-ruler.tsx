"use client";

/**
 * SlotRuler — réglette horizontale des slots internes d'un châssis modulaire
 * (type Ross openGear), affichée sous la row du châssis dans la fiche du lieu.
 *
 *  - Grille `repeat(hostSlotCount, 1fr)` : une case par slot, numérotée.
 *  - Composant occupant `componentSlotSpan > 1` → `grid-column: span N`, avec
 *    un numéro de plage (« 7–8 »).
 *  - Case pleine : nom du composant + retrait au survol (route d'items) ;
 *    draggable (drag interne `component-move`) vers une case vide du MÊME
 *    châssis → PATCH { hostSlotIndex }.
 *  - Case vide : dashed, cible de drop dnd-kit (`hostslot-{hostItemId}-{i}` —
 *    mêmes id/data que les lignes de slot, le scope les résout tel quel) et
 *    clic → `ComponentConfigModal` ouvert directement sur ce slot.
 */

import { useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Loader2, Plus, X } from "@/components/ui/icons";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { ComponentConfigModal } from "./component-config-modal";
import { useInventaireScope } from "./inventaire-scope";
import type { RackCardBomItem } from "./rack-card-canvas";

export function SlotRuler({
  rackId,
  host,
  installedComponents,
}: {
  rackId: string;
  host: RackCardBomItem;
  installedComponents: RackCardBomItem[];
}) {
  const { getInventoryUrl, refreshRackBom } = useInventaireScope();
  const slotCount = host.hostSlotCount ?? 0;
  // Slot ciblé par l'installation en cours (0-based) — ouvre le picker du
  // ComponentConfigModal directement sur ce slot.
  const [installSlot, setInstallSlot] = useState<number | null>(null);

  // Occupation : slotOwner[i] = composant démarrant en i, "covered" pour les
  // slots couverts par un composant multi-span, null si libre.
  const slotOwner = useMemo<(RackCardBomItem | "covered" | null)[]>(() => {
    const arr: (RackCardBomItem | "covered" | null)[] = new Array(slotCount).fill(
      null,
    );
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

  return (
    <>
      <div className="mt-1.5 mb-1 rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/25 p-2">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}
        >
          {slotOwner.map((owner, i) => {
            if (owner === "covered") return null;
            if (owner) {
              const span = Math.max(1, owner.componentSlotSpan ?? 1);
              return (
                <OccupiedCell
                  key={owner.id}
                  rackId={rackId}
                  component={owner}
                  label={span > 1 ? `${i + 1}–${i + span}` : `${i + 1}`}
                  span={span}
                />
              );
            }
            return (
              <EmptyCell
                key={`free-${i}`}
                rackId={rackId}
                hostItemId={host.id}
                slotIndex={i}
                onInstall={() => setInstallSlot(i)}
              />
            );
          })}
        </div>
      </div>

      {installSlot !== null && (
        <ComponentConfigModal
          host={host}
          components={installedComponents}
          baseUrl={getInventoryUrl(rackId)}
          initialSlotIndex={installSlot}
          onChanged={() => void refreshRackBom(rackId)}
          onClose={() => setInstallSlot(null)}
        />
      )}
    </>
  );
}

// ── Cases ────────────────────────────────────────────────────────────────────

function OccupiedCell({
  rackId,
  component,
  label,
  span,
}: {
  rackId: string;
  component: RackCardBomItem;
  label: string;
  span: number;
}) {
  const { getInventoryUrl, refreshRackBom, notifySave } = useInventaireScope();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Drag interne « component-move » : la case suit le curseur via le
  // DragOverlay du scope ; le drop sur une case vide du même châssis déclenche
  // le PATCH { hostSlotIndex }.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `movecomp-${component.id}`,
    data: {
      kind: "component-move",
      itemId: component.id,
      rackId,
      hostItemId: component.hostItemId,
      name: component.name,
    },
    disabled: busy,
  });

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

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "group/cell relative flex min-h-[54px] cursor-grab touch-none flex-col gap-0.5 rounded-md border border-[var(--border)] bg-[var(--secondary)]/70 px-1.5 py-1 transition-colors active:cursor-grabbing",
        busy && "opacity-60",
        isDragging && "opacity-40",
      )}
      style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
      title={`${component.name} — glisser vers un autre slot`}
    >
      <span className="font-mono text-[8.5px] font-semibold tabular-nums text-[var(--muted-foreground)]">
        {label}
      </span>
      <span className="line-clamp-2 text-[9.5px] leading-tight font-semibold break-words">
        {component.name}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={busy}
        title="Retirer"
        className="absolute top-0.5 right-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-all group-hover/cell:opacity-100 hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}

function EmptyCell({
  rackId,
  hostItemId,
  slotIndex,
  onInstall,
}: {
  rackId: string;
  hostItemId: string;
  slotIndex: number;
  onInstall: () => void;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `hostslot-${hostItemId}-${slotIndex}`,
    data: { hostItemId, slotIndex, rackId },
  });
  // Cibles valides : équipement « composant » du catalogue, ou déplacement
  // d'un composant déjà installé dans CE châssis.
  const activeData = active?.data.current as
    | { kind?: string; isComponent?: boolean; hostItemId?: string }
    | undefined;
  const componentDrag =
    (activeData?.kind === "equipment" && activeData.isComponent === true) ||
    (activeData?.kind === "component-move" &&
      activeData.hostItemId === hostItemId);

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onInstall();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={`Slot ${slotIndex + 1}`}
      className={cn(
        "relative flex min-h-[54px] flex-col items-center justify-center gap-0.5 rounded-md border border-dashed transition-colors",
        isOver && componentDrag
          // arkyo-server: habillage Strata (texte d'accent sur l'accent à 12 % : --accent-strong)
          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)]"
          : componentDrag
            ? "border-[var(--accent)]/50 text-[var(--muted-foreground)]"
            : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
      )}
    >
      <span className="absolute top-1 left-1.5 font-mono text-[8.5px] font-semibold tabular-nums opacity-70">
        {slotIndex + 1}
      </span>
      <Plus className="h-3.5 w-3.5" />
    </button>
  );
}
