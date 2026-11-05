"use client";

/**
 * /admin/parametres — orchestrateur client à 9 onglets dans la topbar.
 *
 * Onglets :
 *   Catégories / Fabricants / Signaux / Câblage : read-only
 *     (miroirs des référentiels Arkyo globaux, d'office pour tous les plans)
 *   Numérotation / Dimensions / Impression / Application / Intégrations :
 *     éditables côté tenant.
 *
 * Onglet actif persisté en localStorage (`tenant-admin-parametres-tab`).
 * Le param URL `?tab=` (utilisé par les redirects compat) prend le pas sur
 * la valeur stockée au mount.
 *
 * Note : l'ancien onglet « Symboles » a été retiré — les symboles sont
 * désormais portés par l'onglet « Connecteurs » du Catalogue tenant.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowDownUp,
  Building2,
  Cable,
  CircleDot,
  Hash,
  Printer,
  Ruler,
  Tag,
  Waves,
} from "@/components/ui/icons";

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { useTopbarTabs } from "@/lib/topbar-tabs-context";
import { cn } from "@/lib/utils";

import { BrandsPanel } from "./_components/brands-panel";
import { CablingPanel } from "./_components/cabling-panel";
import { CategoriesPanel } from "./_components/categories-panel";
import { ConnectorsPanel } from "./_components/connectors-panel";
import { DimensionsPanel } from "./_components/dimensions-panel";
import { ImportExportPanel } from "./_components/import-export-panel";
import { NumberingPanel } from "./_components/numbering-panel";
import { PrintPanel } from "./_components/print-panel";
import { SignalsPanel } from "./_components/signals-panel";

// L'onglet "Espace" (clé `application`) a été déplacé vers la page dédiée
// `/admin/espace` (sub-tabs : Dashboard / Informations / Abonnements /
// Factures / Suppression). Voir `app/(app)/admin/espace/`.
type Section =
  | "categories"
  | "brands"
  | "signals"
  | "connectors"
  | "cabling"
  | "numbering"
  | "dimensions"
  | "print"
  | "import-export";

const TABS: { key: Section; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }[] = [
  { key: "categories", label: "Classification", icon: Tag },
  { key: "brands", label: "Fabricants", icon: Building2 },
  { key: "connectors", label: "Connecteurs", icon: CircleDot },
  { key: "signals", label: "Signaux", icon: Waves },
  { key: "cabling", label: "Câblage", icon: Cable },
  { key: "dimensions", label: "Dimensions", icon: Ruler },
  { key: "print", label: "Impression", icon: Printer },
  { key: "numbering", label: "Numérotation", icon: Hash },
  { key: "import-export", label: "Importer / Exporter", icon: ArrowDownUp },
];

const STORAGE_KEY = "tenant-admin-parametres-tab";

function isSection(v: unknown): v is Section {
  return (
    typeof v === "string" &&
    [
      "categories",
      "brands",
      "signals",
      "connectors",
      "cabling",
      "numbering",
      "dimensions",
      "print",
      "import-export",
    ].includes(v)
  );
}

// Mapping ?tab= → Section (utilisé par les redirects compat).
// Note : `application` n'est plus mappé ici — la page Espace vit dans /admin/espace.
const TAB_PARAM: Record<string, Section> = {
  categories: "categories",
  brands: "brands",
  fabricants: "brands",
  signals: "signals",
  signaux: "signals",
  connectors: "connectors",
  connecteurs: "connectors",
  cabling: "cabling",
  cablage: "cabling",
  numbering: "numbering",
  numerotation: "numbering",
  dimensions: "dimensions",
  print: "print",
  impression: "print",
  "import-export": "import-export",
  import: "import-export",
};

type Props = {
  appConfig: Record<string, string>;
};

export function ParametresClient({ appConfig }: Props) {
  const [section, setSection] = useLocalStorageState<Section>(STORAGE_KEY, "categories", {
    isValid: isSection,
  });
  const { setTabs } = useTopbarTabs();
  const searchParams = useSearchParams();

  // Re-sync localement appConfig (les onglets éditables ont leur propre state
  // mais on garde une trace de la version SSR pour les valeurs initiales).
  const [config, setConfig] = useState(appConfig);
  useEffect(() => {
    setConfig(appConfig);
  }, [appConfig]);

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
      {section === "categories" && <CategoriesPanel />}
      {section === "brands" && <BrandsPanel />}
      {section === "signals" && <SignalsPanel />}
      {section === "connectors" && <ConnectorsPanel />}
      {section === "cabling" && <CablingPanel />}
      {section === "numbering" && <NumberingPanel initialAppConfig={config} />}
      {section === "dimensions" && <DimensionsPanel />}
      {section === "print" && <PrintPanel initialAppConfig={config} />}
      {section === "import-export" && <ImportExportPanel />}
    </>
  );
}
