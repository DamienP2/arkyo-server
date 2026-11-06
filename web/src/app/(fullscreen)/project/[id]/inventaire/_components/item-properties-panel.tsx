"use client";

/**
 * ItemPropertiesPanel — propriétés d'une LIGNE d'inventaire (un matériel dans
 * un contenant), affichées dans le panneau droit de l'onglet Inventaire quand
 * `selectedItem !== null`.
 *
 * Même grammaire que `ContainerPropertiesPanel` : en-tête + grille d'InfoCard
 * + actions. Les données viennent de la ligne du BOM (déjà résolue par l'API
 * inventory, fallback tenant compris) ; aucun fetch supplémentaire n'est
 * nécessaire — la ligne porte hauteur, profondeur, poids, conso, catégorie,
 * snapshot et champs modulaires.
 *
 * Le panneau ne duplique PAS le stepper de quantité de la ligne : c'est le
 * même geste, à deux endroits, sur la même route. Il affiche la quantité et
 * laisse la ligne la piloter.
 */

import { useState } from "react";
import {
  AlertTriangle,
  Box,
  Layers,
  Package,
  RefreshCw,
  Ruler,
  Server,
  Trash2,
  Weight,
  X,
  Zap,
} from "@/components/ui/icons";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import {
  ActionButton,
  InfoCard,
} from "@/components/synoptique/components/property-patterns";

import { useInventaireScope } from "./inventaire-scope";
import { categoryColor } from "./rack-mini-svg";

const KIND_LABEL: Record<string, string> = {
  equipment: "Équipement",
  panel: "Panel",
  adapter: "Adaptateur",
  accessory: "Accessoire",
};

export function ItemPropertiesPanel({
  rackId,
  itemId,
  onClose,
}: {
  rackId: string;
  itemId: string;
  onClose: () => void;
}) {
  const {
    projectId,
    racks,
    refreshRackBom,
    notifySave,
    getDrift,
    catalogOptions,
    selectItem,
  } = useInventaireScope();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const rack = racks.find((r) => r.id === rackId) ?? null;
  const item = rack?.bom.find((it) => it.id === itemId) ?? null;

  // La sélection est nettoyée par le scope dès que l'item disparaît : cet état
  // n'est donc qu'un filet le temps d'un rendu intermédiaire.
  if (!rack || !item) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground text-xs">Élément introuvable</p>
      </div>
    );
  }

  const scopeColor = item.category
    ? (catalogOptions.categories.find((c) => c.name === item.category)?.color ??
      catalogOptions.adapterCategories.find((c) => c.name === item.category)
        ?.color ??
      null)
    : null;
  const dot = item.categoryColor ?? scopeColor ?? categoryColor(item.category);
  // arkyo-server: `getDrift` (dérive du catalogue Arkyo, SaaS) n'est plus lu.

  const host = item.hostItemId
    ? (rack.bom.find((it) => it.id === item.hostItemId) ?? null)
    : null;
  const installedComponents = item.isComponentHost
    ? rack.bom.filter((it) => it.hostItemId === item.id)
    : [];
  const usedSlots = installedComponents.reduce(
    (sum, c) => sum + Math.max(1, c.componentSlotSpan ?? 1),
    0,
  );

  const heightDisplay =
    item.isRackable === false
      ? "Non rackable"
      : item.heightU != null && item.heightU > 0
        ? `${item.heightU}U`
        : "—";

  const handleRemove = async () => {
    if (busy || !projectId) return;
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

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="flex flex-col gap-3 text-xs">
        {/* ── En-tête ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="text-muted-foreground mb-1 flex min-w-0 items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: dot }}
              />
              <span className="truncate">
                {KIND_LABEL[item.kind] ?? "Élément"}
                {item.category ? ` · ${item.category}` : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="text-muted-foreground hover:bg-muted hover:text-foreground -mt-1 shrink-0 rounded p-1 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="text-sm leading-tight font-semibold">{item.name}</p>
          {(item.brandName || item.reference) && (
            <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
              {[item.brandName, item.reference].filter(Boolean).join(" · ")}
            </p>
          )}

          {/* arkyo-server: bandeau de dérive du catalogue Arkyo retiré (snapshot,
              SaaS ; catalogue unique, `getDrift` toujours nul). */}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <InfoCard
              icon={<Package className="h-4 w-4" />}
              label="Quantité"
              value={String(item.quantity)}
            />
            <InfoCard
              icon={<Server className="h-4 w-4" />}
              label="Hauteur"
              value={heightDisplay}
            />
            <InfoCard
              icon={<Ruler className="h-4 w-4" />}
              label="Profondeur"
              value={item.depthMm ? `${item.depthMm} mm` : "—"}
            />
            <InfoCard
              icon={<Weight className="h-4 w-4" />}
              label="Poids"
              value={item.weightKg ? `${item.weightKg} kg` : "—"}
            />
            <InfoCard
              icon={<Zap className="h-4 w-4" />}
              label="Conso"
              value={item.powerW ? `${item.powerW} W` : "—"}
            />
            <InfoCard
              icon={<Box className="h-4 w-4" />}
              label="Contenant"
              value={rack.isVirtual ? "Libre" : rack.name}
            />
          </div>
        </div>

        {/* ── Modulaire : châssis hôte ou composant installé ──────────── */}
        {item.isComponentHost && item.hostSlotCount != null && (
          <div className="flex flex-col gap-1.5">
            <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
              Châssis
            </div>
            <InfoCard
              icon={<Layers className="h-4 w-4" />}
              label="Slots occupés"
              value={`${usedSlots} / ${item.hostSlotCount}`}
            />
          </div>
        )}

        {host && (
          <div className="flex flex-col gap-1.5">
            <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
              Installé dans
            </div>
            <ActionButton
              icon={<Layers className="h-3.5 w-3.5" />}
              label={
                item.hostSlotIndex != null
                  ? `${host.name} · slot ${item.hostSlotIndex + 1}`
                  : host.name
              }
              onClick={() => selectItem({ rackId, itemId: host.id })}
            />
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Actions
          </div>
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Retirer du contenant"
            danger
            onClick={() => void handleRemove()}
          />
        </div>
      </div>
    </div>
  );
}
