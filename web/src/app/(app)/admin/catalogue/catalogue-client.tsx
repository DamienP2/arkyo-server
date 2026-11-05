"use client";

/**
 * /admin/catalogue — orchestrateur client à 3 onglets dans la topbar :
 *   Équipements / Cordons / Adaptateurs
 *
 * L'onglet "Connecteurs" a été déplacé dans Paramètres (catalogue de
 * référence partagé) — le panel vit désormais dans
 * `parametres/_components/connectors-panel.tsx`.
 *
 * Chaque panel mélange items Arkyo (lecture seule) et items personnels du
 * tenant (CRUD via API tenant). Le toggle "Accessible / Étendu" permet de
 * voir tout le catalogue Arkyo, items hors plan grisés.
 *
 * Onglet actif persisté en localStorage (`tenant-admin-catalogue-tab`).
 * Le param URL `?tab=` (utilisé par les redirects compat) prend le pas sur
 * la valeur stockée au mount.
 */

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Cable, Package, Spline } from "@/components/ui/icons";

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { useTopbarTabs } from "@/lib/topbar-tabs-context";
import { cn } from "@/lib/utils";

import { AdaptersListPanel } from "./_components/adapters-list-panel";
import { CablesListPanel } from "./_components/cables-list-panel";
import { EquipmentListPanel } from "./_components/equipment-list-panel";

type Section = "equipment" | "cables" | "adapters";

const TABS: { key: Section; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }[] = [
  { key: "equipment", label: "Équipements", icon: Package },
  { key: "cables", label: "Cordons", icon: Spline },
  { key: "adapters", label: "Adaptateurs", icon: Cable },
];

const STORAGE_KEY = "tenant-admin-catalogue-tab";

function isSection(v: unknown): v is Section {
  return v === "equipment" || v === "cables" || v === "adapters";
}

// Mapping ?tab= → Section (utilisé par les redirects compat depuis /admin?s=…).
// "connectors" était dans cette liste mais l'onglet a été déplacé vers
// Paramètres — un lien legacy retombe désormais sur "equipment" pour ne pas
// envoyer un état invalide.
const TAB_PARAM: Record<string, Section> = {
  equipment: "equipment",
  cables: "cables",
  cordons: "cables",
  adapters: "adapters",
  adaptateurs: "adapters",
  connectors: "equipment",
  connecteurs: "equipment",
};

export function CatalogueClient() {
  const [section, setSection] = useLocalStorageState<Section>(STORAGE_KEY, "equipment", {
    isValid: isSection,
  });
  const { setTabs } = useTopbarTabs();
  const searchParams = useSearchParams();

  // Si `?tab=` est présent, on l'applique au mount (et à chaque changement de
  // querystring — utile quand la redirection arrive depuis /admin?s=…).
  const tabParam = searchParams.get("tab");
  useEffect(() => {
    if (!tabParam) return;
    const mapped = TAB_PARAM[tabParam];
    if (mapped) setSection(mapped);
  }, [tabParam, setSection]);

  useEffect(() => {
    setTabs(
      // arkyo-server: habillage Strata — onglets `.tabs` de Strata (conteneur --surface
      // bordé, onglet actif --muted, rayon 6px, 13px, 500).
      <div className="flex items-center gap-1 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] p-[3px]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === section;
          return (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={cn(
                // arkyo-server: habillage Strata
                "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-[5px] text-[13px] font-medium whitespace-nowrap transition-all",
                active
                  ? "bg-[var(--muted)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>,
    );
    return () => setTabs(null);
  }, [section, setSection, setTabs]);

  return (
    <>
      {section === "equipment" && <EquipmentListPanel />}
      {section === "cables" && <CablesListPanel />}
      {section === "adapters" && <AdaptersListPanel />}
    </>
  );
}
