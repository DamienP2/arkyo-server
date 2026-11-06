"use client";

/**
 * RackInfoPanel — panneau d'INFOS en lecture seule pour un contenant
 * sélectionné dans l'onglet Rack du projet.
 *
 * Pattern aligné sur `SlotPropertiesPanel` (panel équipement) du rack-editor :
 *  - En-tête : type uppercase + nom du contenant
 *  - Cards `InfoCard` (icône + label + valeur mono) pour les attributs physiques
 *  - Section Actions : "Vider la baie" (modal de confirmation + DELETE slots)
 *
 * Aucun champ éditable hors action destructive. La modification des
 * propriétés se fait depuis l'onglet Inventaire.
 */

import { useState } from "react";
import { Ruler, Server, Trash2, Weight, Zap } from "@/components/ui/icons";

import {
  ActionButton,
  InfoCard,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";
import { useConfirm } from "@/components/ui/confirm-dialog";

import type { InventaireRack } from "../../inventaire/inventaire-client";

const RACK_TYPE_LABEL: Record<InventaireRack["rackType"], string> = {
  STANDARD: 'Baie 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

const RACK_TYPE_DOT: Record<InventaireRack["rackType"], string> = {
  STANDARD: "#3b82f6",
  FLIGHT_CASE_CLASSIC: "#f59e0b",
  FLIGHT_CASE_SKB: "#f59e0b",
  PELICAN: "#06b6d4",
  CAP: "#a855f7",
};

export function RackInfoPanel({
  rack,
  onCleared,
}: {
  rack: InventaireRack;
  /** Conservé pour compat des call sites — non utilisé (plus de bouton fermer). */
  onClose?: () => void;
  /**
   * Callback appelé après un "Vider la baie" réussi, pour permettre au parent
   * de rafraîchir le canvas / re-fetcher les slots du rack. Si absent, on se
   * fie au SSE `rack_cleared` propagé par l'API DELETE /api/racks/{id}/slots.
   */
  onCleared?: (rackId: string) => void;
}) {
  const dotHex = RACK_TYPE_DOT[rack.rackType];
  const confirm = useConfirm();
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    const ok = await confirm({
      title: `Vider « ${rack.name} » ?`,
      description:
        "Tous les équipements, panels, accessoires, câbles, adaptateurs, zones et labels du contenant seront supprimés définitivement.",
      confirmLabel: "Vider",
      variant: "destructive",
    });
    if (!ok) return;
    setClearing(true);
    try {
      const res = await fetch(`/api/racks/${rack.id}/slots`, { method: "DELETE" });
      if (!res.ok) {
        window.alert("Erreur lors du vidage du contenant.");
        return;
      }
      onCleared?.(rack.id);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Body */}
      <div className="flex flex-col gap-4 overflow-auto p-3 text-xs">
        {/* Identité contenant — nom + badge type. ID retiré (non utilisé). */}
        <div>
          <SectionTitle>Contenant</SectionTitle>
          <div className="text-foreground text-sm font-semibold uppercase">
            {rack.name}
          </div>
          <span
            className="mt-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
            style={{ background: `${dotHex}18`, color: dotHex }}
          >
            {RACK_TYPE_LABEL[rack.rackType]}
          </span>
        </div>

        {/* Cards info stackées — Hauteur + Profondeur + Poids + Conso.
            Poids = poids à vide + Σ(weightKg × quantité) du BOM.
            Conso = Σ(powerW × quantité) du BOM. Pas d'arrondi à l'entier
            (cohérence avec card contenant inventaire). */}
        {(() => {
          const formatFr = (n: number) =>
            n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
          let totalWeight = rack.emptyWeightKg ?? 0;
          let totalPower = 0;
          for (const it of rack.bom ?? []) {
            if (typeof it.weightKg === "number")
              totalWeight += it.weightKg * it.quantity;
            if (typeof it.powerW === "number")
              totalPower += it.powerW * it.quantity;
          }
          const weightDisplay =
            totalWeight > 0 ? `${formatFr(totalWeight)} kg` : "—";
          const powerDisplay =
            totalPower > 0 ? `${formatFr(totalPower)} W` : "—";
          return (
            <div className="flex flex-col gap-2">
              {rack.isRackable && (
                <InfoCard
                  icon={<Server className="h-3.5 w-3.5" />}
                  label="Hauteur"
                  value={`${rack.totalU} U`}
                />
              )}
              <InfoCard
                icon={<Ruler className="h-3.5 w-3.5" />}
                label="Profondeur"
                value={`${rack.depthMm} mm`}
              />
              <InfoCard
                icon={<Weight className="h-3.5 w-3.5" />}
                label="Poids"
                value={weightDisplay}
              />
              <InfoCard
                icon={<Zap className="h-3.5 w-3.5" />}
                label="Conso totale"
                value={powerDisplay}
              />
            </div>
          );
        })()}

        {/* Actions destructives — vidage du contenant */}
        <div className="border-border flex flex-col gap-1.5 border-t pt-3">
          <SectionTitle>Actions</SectionTitle>
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={clearing ? "Vidage en cours…" : "Vider la baie"}
            onClick={clearing ? () => {} : handleClear}
            danger
          />
        </div>
      </div>
    </div>
  );
}
