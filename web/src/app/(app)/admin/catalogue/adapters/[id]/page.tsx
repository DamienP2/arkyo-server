// arkyo-server: SPA sans SSR — le Server Component devient un composant client.
// `mainDb` / `getTenantDb` / `requireTenantPermissionPage` (serveur) remplacés
// par l'API et la garde commune des pages du catalogue ; plus de plan
// (`catalog-visibility`) ni de fork Arkyo (`arkyo-restore`) : catalogue unique.
import { useParams } from "next/navigation";

import { api } from "@/lib/api-client";

import { TenantAdapterEditorClient } from "./_client";
import { CatalogAdminPage } from "../../_lib/client-page";

/**
 * /admin/catalogue/adapters/[id] — éditeur tenant d'un adaptateur.
 *
 * arkyo-server: catalogue unique — `params.id` est toujours un adaptateur du
 * catalogue : `GET /api/tenant/catalogue/adapters/[id]` renvoie l'item avec
 * sa `function` hydratée, comme la branche « personnel » de cette page. Pas
 * de redirection vers un fork ; un id inconnu rend la page 404 (`notFound()`).
 * Les référentiels (`mainDb.catalog*` : connecteurs, fonctions) sont les
 * tables `Tenant*`, via `/api/tenant/catalogue/lookup`.
 */
export default function TenantAdapterDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <CatalogAdminPage load={() => loadAdapterEditor(id)} loadKey={id}>
      {(p) => <TenantAdapterEditorClient {...p} />}
    </CatalogAdminPage>
  );
}

type ConnectorRow = {
  id: string;
  name: string;
  color: string | null;
  iconId: string | null;
  functionIds?: string[];
};

type Lookup = { connectorTypes: ConnectorRow[]; functions: unknown[] };

async function loadAdapterEditor(id: string) {
  const [detail, lookup] = await Promise.all([
    api.get<{ source: "PERSONAL"; isAccessible: boolean; item: Record<string, unknown> }>(
      `/api/tenant/catalogue/adapters/${encodeURIComponent(id)}`,
    ),
    api.get<Lookup>("/api/tenant/catalogue/lookup"),
  ]);

  // Projection client : on aplatit la relation many-to-many `functions`
  // en un tableau de `functionIds` consommable par la modal de sélection.
  // arkyo-server: le tableau JSON `functionIds` du connecteur (décision 3).
  const connectors = lookup.connectorTypes.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    iconId: c.iconId,
    functionIds: c.functionIds ?? [],
  }));

  return {
    item: detail.item as never,
    source: detail.source,
    isAccessible: detail.isAccessible,
    connectors: connectors as never,
    functions: lookup.functions as never,
  };
}
