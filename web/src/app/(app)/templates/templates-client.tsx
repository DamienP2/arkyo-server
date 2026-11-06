"use client";

/**
 * TemplatesClient — route vers les 3 sous-vues (Contenants / Panels /
 * Dossiers) selon le query param `?tab=racks|panels|dossiers` (défaut =
 * `racks`). La navigation se fait via les entrées « Contenant » / « Panel » /
 * « Dossier » de la sidebar gauche (plus d'onglets dans la topbar). La clé URL
 * reste `racks` pour la compatibilité des anciens liens.
 */

import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

import { RacksClient } from "@/app/(app)/racks/racks-client";
import { PanelsClient } from "@/app/(app)/panels/panels-client";
// arkyo-server: phase 6. `DossierModelsClient` (./_components/dossier-models-client)
// tire l'assistant de dossier, lib/print et lib/pdf : `ComingSoon` en attendant.
import { ComingSoon } from "@/components/coming-soon";

type TabKey = "racks" | "panels" | "dossiers";

type Props = {
  racks: ComponentProps<typeof RacksClient>["racks"];
  panels: ComponentProps<typeof PanelsClient>["initialPanels"];
};

export function TemplatesClient({ racks, panels }: Props) {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const currentTab: TabKey =
    rawTab === "panels" ? "panels" : rawTab === "dossiers" ? "dossiers" : "racks";

  return (
    <div className="flex h-full flex-col">
      {/* ── Contenu tab ── */}
      <div className="flex min-h-0 flex-1 flex-col pt-6">
        {currentTab === "racks" && <RacksClient racks={racks} />}
        {currentTab === "panels" && <PanelsClient initialPanels={panels} />}
        {/* arkyo-server: phase 6 */}
        {currentTab === "dossiers" && <ComingSoon />}
      </div>
    </div>
  );
}
