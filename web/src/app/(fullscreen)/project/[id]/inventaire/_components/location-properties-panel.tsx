"use client";

/**
 * LocationPropertiesPanel — propriétés de l'emplacement sélectionné, rendu
 * dans le rightPanel quand `selectedLocationId !== null`.
 *
 * Même grammaire que `ContainerPropertiesPanel` : header (sous-titre + nom
 * éditable inline + InfoCards), liste d'`OptionRow`, section Actions.
 */

import { useState } from "react";
import { Boxes, MapPin, Server, Trash2, Weight, Zap } from "@/components/ui/icons";

import {
  ActionButton,
  InfoCard,
} from "@/components/synoptique/components/property-patterns";
import { OptionRow } from "@/components/synoptique/components/synoptic-general-panel";
import { useConfirm } from "@/components/ui/confirm-dialog";

import { NameInput } from "./container-properties-panel";
import { useInventaireScope } from "./inventaire-scope";
import { computeRackTotals, formatNum } from "./rack-card-canvas";

export function LocationPropertiesPanel({
  locationId,
  onClose,
}: {
  locationId: string;
  onClose: () => void;
}) {
  const { locations, racks, updateLocation, deleteLocation } =
    useInventaireScope();
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState(false);

  const location = locations.find((l) => l.id === locationId) ?? null;

  if (!location) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6 text-center">
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Emplacement introuvable.
        </p>
      </div>
    );
  }

  const containers = racks.filter(
    (r) => !r.isVirtual && r.locationId === location.id,
  );
  const virtualRack = location.virtualRackId
    ? (racks.find((r) => r.id === location.virtualRackId) ?? null)
    : null;
  const freeItems = (virtualRack?.bom ?? []).filter(
    (it) => it.hostItemId == null,
  );

  // Totaux du lieu : contenants + équipements libres (rack virtuel).
  let powerW = 0;
  let weightKg = 0;
  for (const rack of virtualRack ? [...containers, virtualRack] : containers) {
    const t = computeRackTotals(rack);
    powerW += t.powerW;
    weightKg += t.weightKg;
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Supprimer « ${location.name} » ?`,
      description:
        "L'emplacement sera supprimé. Ses contenants et ses équipements libres doivent avoir été déplacés au préalable.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(true);
    const done = await deleteLocation(location.id);
    setDeleting(false);
    if (done) onClose();
  };

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="flex flex-col gap-3 text-xs">
        {/* ── En-tête ─────────────────────────────────────────────────── */}
        <div>
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Emplacement
          </div>
          <NameInput
            value={location.name}
            onSave={(next) => void updateLocation(location.id, { name: next })}
          />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <InfoCard
              icon={<Server className="h-4 w-4" />}
              label="Contenants"
              value={String(containers.length)}
            />
            <InfoCard
              icon={<Boxes className="h-4 w-4" />}
              label="Équip. libres"
              value={String(freeItems.length)}
            />
            <InfoCard
              icon={<Zap className="h-4 w-4" />}
              label="Conso totale"
              value={powerW > 0 ? `${formatNum(powerW)} W` : "—"}
            />
            <InfoCard
              icon={<Weight className="h-4 w-4" />}
              label="Poids estimé"
              value={weightKg > 0 ? `${formatNum(weightKg)} kg` : "—"}
            />
          </div>
        </div>

        {/* ── Options ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Options
          </div>
          <OptionRow
            icon={MapPin}
            label="Code câbles"
            badge={location.cableCode ?? "—"}
          >
            <CableCodeInput
              value={location.cableCode ?? ""}
              onSave={(next) =>
                void updateLocation(location.id, {
                  cableCode: next.length > 0 ? next : null,
                })
              }
            />
          </OptionRow>
        </div>

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="mt-1 flex flex-col gap-1">
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Actions
          </div>
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={deleting ? "Suppression…" : "Supprimer cet emplacement"}
            onClick={() => {
              if (!deleting) void handleDelete();
            }}
            danger
          />
        </div>
      </div>
    </div>
  );
}

// ── Saisie du code de numérotation (uppercase, ≤ 5 caractères) ──────────────

function CableCodeInput({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  const normalize = (raw: string) =>
    raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

  return (
    <input
      type="text"
      value={draft}
      maxLength={5}
      onChange={(e) => setDraft(normalize(e.target.value))}
      onBlur={() => {
        if (draft !== value) onSave(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="REG"
      className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 font-mono text-[11px] font-semibold tracking-wider uppercase outline-none transition-colors focus:border-[var(--accent)]"
    />
  );
}
