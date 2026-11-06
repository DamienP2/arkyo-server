"use client";

/**
 * InventaireInfoPanel — panneau d'INFOS de l'onglet Inventaire quand aucun
 * contenant n'est sélectionné.
 *
 * Body seul : 4 InfoCard (Contenants · Poids · Consommation · Volume) + actions
 * (Raccourcis · Aide). Le déclencheur d'export n'est PAS ici — il vit dans le
 * footer d'`InventaireRightPanel`, commun aux trois corps possibles du panneau
 * droit, pour rester atteignable quel que soit ce qui est sélectionné.
 */

import { useState } from "react";
import { Box, HelpCircle, Keyboard, Server, Weight, Zap } from "@/components/ui/icons";

import {
  ActionButton,
  InfoCard,
} from "@/components/synoptique/components/property-patterns";

import { useInventaireScope } from "./inventaire-scope";
import { InventaireHelpModal } from "./inventaire-help-modal";
import { InventaireShortcutsModal } from "./inventaire-shortcuts-modal";

export function InventaireInfoPanel() {
  const { racks } = useInventaireScope();
  // Contenants réels — les racks virtuels des lieux ne sont pas comptés ni
  // exportés comme contenants (leurs items restent dans les totaux).
  const containers = racks.filter((r) => !r.isVirtual);

  // ── Stats agrégées ──────────────────────────────────────────────────────
  let totalEmptyWeight = 0;
  let totalBomWeight = 0;
  let totalBomPower = 0;
  let totalVolumeMm3 = 0;
  const U_HEIGHT_MM = 44.45;
  const RACK_WIDTH_19_MM = 600;
  for (const r of racks) {
    // Le BOM d'un rack virtuel (équipements libres d'un lieu) compte dans les
    // totaux ; le contenant lui-même n'existe pas physiquement (ni poids à
    // vide, ni volume).
    if (typeof r.emptyWeightKg === "number" && !r.isVirtual)
      totalEmptyWeight += r.emptyWeightKg;
    for (const it of r.bom) {
      if (typeof it.weightKg === "number") {
        totalBomWeight += it.weightKg * it.quantity;
      }
      if (typeof it.powerW === "number") {
        totalBomPower += it.powerW * it.quantity;
      }
    }
    if (r.isVirtual) continue;
    if (r.isRackable && r.totalU > 0 && r.depthMm > 0) {
      totalVolumeMm3 += RACK_WIDTH_19_MM * (r.totalU * U_HEIGHT_MM) * r.depthMm;
    } else if (r.depthMm > 0) {
      totalVolumeMm3 += r.depthMm * r.depthMm * r.depthMm;
    }
  }
  const totalWeight = totalEmptyWeight + totalBomWeight;
  const totalVolumeM3 = totalVolumeMm3 / 1e9;

  // ── Modals Aide / Raccourcis ────────────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3 text-xs">
          <InfoCard
            icon={<Server className="h-3.5 w-3.5" />}
            label="Nombre de contenants"
            value={String(containers.length)}
          />
          <InfoCard
            icon={<Weight className="h-3.5 w-3.5" />}
            label="Poids estimé"
            value={totalWeight > 0 ? `${totalWeight.toFixed(1)} kg` : "—"}
          />
          <InfoCard
            icon={<Zap className="h-3.5 w-3.5" />}
            label="Consommation électrique"
            value={totalBomPower > 0 ? `${totalBomPower} W` : "—"}
          />
          <InfoCard
            icon={<Box className="h-3.5 w-3.5" />}
            label="Volume estimé"
            value={totalVolumeM3 > 0 ? `${totalVolumeM3.toFixed(2)} m³` : "—"}
          />

          <div className="text-muted-foreground mt-2 mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Actions
          </div>
          <ActionButton
            icon={<Keyboard className="h-3.5 w-3.5" />}
            label="Raccourcis clavier"
            onClick={() => setShowShortcuts(true)}
          />
          <ActionButton
            icon={<HelpCircle className="h-3.5 w-3.5" />}
            label="Aide"
            onClick={() => setShowHelp(true)}
          />
      </div>

      <InventaireShortcutsModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
      <InventaireHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
