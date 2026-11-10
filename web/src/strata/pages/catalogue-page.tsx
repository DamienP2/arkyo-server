"use client";

/**
 * Catalogue de l'interface Strata v2 (`/admin/catalogue` en Strata ; spec v2
 * §4.3, maquette `#catalogue`). En Classique, l'URL reste la page d'arkyo
 * (`CatalogueClient`, ses trois panneaux).
 *
 * - Onglets `Équipements` · `Cordons` (le mot d'arkyo) · `Adaptateurs` ·
 *   `Modèles`, dans l'URL (`?tab=`, mêmes valeurs que les liens d'arkyo :
 *   `cables` / `cordons`, `adapters` / `adaptateurs`) ; sans `?tab=`, le
 *   dernier onglet ouvert (`strata-catalogue-tab`). La fiche montrée suit
 *   `?id=`.
 * - Liste filtrable (filtres d'arkyo, pickers modaux) et fiche en lecture.
 *   « Modifier » ouvre l'éditeur existant de la fiche, « Nouveau … »
 *   l'assistant existant.
 * - Modèles : les pages existantes (`/templates`).
 *
 * Données : les routes des panneaux d'arkyo (`GET /api/tenant/catalogue/
 * {equipment,cables,adapters}`, `lookup`), sans route nouvelle. Garde
 * `catalog:admin` comme la page d'arkyo ; « Modifier » et « Nouveau »
 * suivent `catalog:write`, la permission d'écriture des routes.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router";
import { useRouter, useSearchParams } from "next/navigation";
import { useCatalogAdminGuard } from "@/components/client-page";
import { useTenantPermissions } from "@/components/tenant-permissions-context";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { Package } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useCatalogueLookup } from "../catalogue-model";
import { readStoredTab, writeStoredTab } from "../catalogue/catalogue-filters";
import { AdaptersTab } from "../catalogue/adapters-tab";
import { CablesTab } from "../catalogue/cables-tab";
import { EquipmentTab } from "../catalogue/equipment-tab";
import { ModelsTab } from "../catalogue/models-tab";
import {
  useCatalogueItems,
  type CatalogueAdapter,
  type CatalogueCable,
  type CatalogueEquipment,
  type CatalogueItems,
} from "../catalogue/use-catalogue-items";
import { TabPanel, Tabs, useTabIds, type TabDef } from "../manage/manage-ui";

type Tab = "equipment" | "cables" | "adapters" | "modeles";

/** `?tab=` → onglet (valeurs et alias des liens d'arkyo). */
const TAB_PARAM: Record<string, Tab> = {
  equipment: "equipment",
  equipements: "equipment",
  cables: "cables",
  cordons: "cables",
  adapters: "adapters",
  adaptateurs: "adapters",
  modeles: "modeles",
};

const BASE = "/admin/catalogue";

function catalogueUrl(tab: Tab, id: string | null): string {
  const q = new URLSearchParams();
  q.set("tab", tab);
  if (id) q.set("id", id);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

export default function CataloguePage() {
  usePageTitle();
  // Garde d'arkyo (`requireTenantPermissionPage("catalog", "admin")`).
  const guard = useCatalogAdminGuard();
  if (guard === "loading") return <LoadingState className="px-8 pt-10" />;
  if (guard === "denied") return <Navigate to="/dashboard" replace />;
  return <CatalogueContent />;
}

function CatalogueContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Onglet : `?tab=` d'abord, sinon le dernier ouvert (mémorisé), sinon Équipements.
  const [storedTab] = useState(() => TAB_PARAM[readStoredTab() ?? ""] ?? "equipment");
  const tab = TAB_PARAM[searchParams.get("tab") ?? ""] ?? storedTab;
  const selectedId = searchParams.get("id");
  const { has } = useTenantPermissions();
  const canWrite = has("catalog", "write");
  const idBase = useTabIds();

  const lookup = useCatalogueLookup();
  const equipment = useCatalogueItems<CatalogueEquipment>("equipment");
  const cables = useCatalogueItems<CatalogueCable>("cables");
  const adapters = useCatalogueItems<CatalogueAdapter>("adapters");

  useEffect(() => writeStoredTab(tab), [tab]);
  const setTab = (t: Tab) => router.replace(catalogueUrl(t, null));
  const select = useCallback((id: string) => router.replace(catalogueUrl(tab, id)), [router, tab]);

  const count = (s: CatalogueItems<unknown>) => (s.loading && s.items.length === 0 ? undefined : s.items.length);
  const tabs: TabDef<Tab>[] = [
    { id: "equipment", label: "Équipements", count: count(equipment) },
    { id: "cables", label: "Cordons", count: count(cables) },
    { id: "adapters", label: "Adaptateurs", count: count(adapters) },
    { id: "modeles", label: "Modèles" },
  ];

  let body: ReactNode;
  if (tab === "modeles") {
    body = <ModelsTab />;
  } else if (tab === "equipment") {
    body = (
      <Loaded state={equipment}>
        <EquipmentTab list={equipment} lookup={lookup} selectedId={selectedId} onSelect={select} canWrite={canWrite} />
      </Loaded>
    );
  } else if (tab === "cables") {
    body = (
      <Loaded state={cables}>
        <CablesTab list={cables} lookup={lookup} selectedId={selectedId} onSelect={select} canWrite={canWrite} />
      </Loaded>
    );
  } else {
    body = (
      <Loaded state={adapters}>
        <AdaptersTab list={adapters} lookup={lookup} selectedId={selectedId} onSelect={select} canWrite={canWrite} />
      </Loaded>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-7 pt-6 pb-16">
      <div className="flex flex-col gap-3">
        <h1 className="m-0 text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-[var(--foreground)]">
          Catalogue
        </h1>
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Catalogue" idBase={idBase} />
      </div>
      <TabPanel idBase={idBase} value={tab} className="flex min-w-0 flex-col gap-2.5">
        {body}
      </TabPanel>
    </div>
  );
}

/** Attente (`LoadingState`) ou erreur (`EmptyState` et « Réessayer ») d'une liste. */
function Loaded({ state, children }: { state: CatalogueItems<unknown>; children: ReactNode }) {
  if (state.loading && state.items.length === 0 && !state.error) return <LoadingState className="py-16" />;
  if (state.error) {
    return (
      <EmptyState
        icon={<Package strokeWidth={1.5} />}
        title="Erreur"
        description={state.error}
        action={<EmptyStateAction onClick={state.reload}>Réessayer</EmptyStateAction>}
      />
    );
  }
  return <>{children}</>;
}
