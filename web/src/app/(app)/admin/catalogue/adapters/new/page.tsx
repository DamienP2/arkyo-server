// arkyo-server: SPA sans SSR — le Server Component devient un composant client.
// `mainDb` / `requireTenantPermissionPage` (serveur) remplacés par l'API et la
// garde commune des pages du catalogue ; plus de plan (`catalog-visibility`).
import { api } from "@/lib/api-client";

import { NewTenantAdapterClient } from "./_client";
import { CatalogAdminPage } from "../../_lib/client-page";

/**
 * /admin/catalogue/adapters/new — création d'un adaptateur personnel tenant.
 *
 * arkyo-server: les référentiels (`mainDb.catalog*` : connecteurs, fonctions)
 * sont les tables `Tenant*`, via `/api/tenant/catalogue/lookup`.
 */
export default function NewTenantAdapterPage() {
  // Réservé au OWNER du tenant (ou collaborateur Arkyo en ghost, lecture seule).
  return (
    <CatalogAdminPage load={loadNewAdapter}>
      {(p) => <NewTenantAdapterClient {...p} />}
    </CatalogAdminPage>
  );
}

type Lookup = { connectorTypes: unknown[]; functions: unknown[] };

async function loadNewAdapter() {
  const lookup = await api.get<Lookup>("/api/tenant/catalogue/lookup");
  return {
    connectors: lookup.connectorTypes as never,
    functions: lookup.functions as never,
  };
}
