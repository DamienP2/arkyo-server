// arkyo-server: SPA sans SSR — le Server Component devient un composant client.
// `mainDb` / `requireTenantPermissionPage` (serveur) remplacés par l'API et la
// garde commune des pages du catalogue ; plus de plan (`catalog-visibility`).
import { api } from "@/lib/api-client";

import { NewTenantCableClient } from "./_client";
import { CatalogAdminPage } from "../../_lib/client-page";

/**
 * /admin/catalogue/cables/new — création d'un cordon personnel tenant.
 *
 * Aucune ressource n'est créée tant que l'utilisateur n'a pas cliqué sur
 * « Créer » dans le dialog.
 *
 * arkyo-server: les référentiels (`mainDb.catalog*` : connecteurs, fonctions,
 * marques) sont les tables `Tenant*`, via `/api/tenant/catalogue/lookup`.
 */
export default function NewTenantCablePage() {
  // Réservé au OWNER du tenant (ou collaborateur Arkyo en ghost, lecture seule).
  return (
    <CatalogAdminPage load={loadNewCable}>
      {(p) => <NewTenantCableClient {...p} />}
    </CatalogAdminPage>
  );
}

type Lookup = { connectorTypes: unknown[]; functions: unknown[]; brands: unknown[] };

async function loadNewCable() {
  const lookup = await api.get<Lookup>("/api/tenant/catalogue/lookup");
  return {
    connectors: lookup.connectorTypes as never,
    functions: lookup.functions as never,
    brands: lookup.brands as never,
  };
}
