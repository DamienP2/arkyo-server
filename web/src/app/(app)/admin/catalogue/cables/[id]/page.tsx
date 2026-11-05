// arkyo-server: SPA sans SSR — le Server Component devient un composant client.
// `mainDb` / `getTenantDb` / `requireTenantPermissionPage` (serveur) remplacés
// par l'API et la garde commune des pages du catalogue ; plus de plan
// (`catalog-visibility`) ni de fork Arkyo (`arkyo-restore`) : catalogue unique.
import { useParams } from "next/navigation";

import { api } from "@/lib/api-client";

import { TenantCableEditorClient } from "./_client";
import { CatalogAdminPage } from "../../_lib/client-page";

/**
 * /admin/catalogue/cables/[id] — éditeur tenant d'un cordon.
 *
 * Le `params.id` peut être :
 *   - un cuid de TenantCable (personnel, édition libre ; fork éclipsant
 *     → action « Récupérer la version Arkyo » + flags drift/source-gone)
 *   - un cuid de Cable (Arkyo, éditable — le fork se crée au premier
 *     enregistrement via PATCH fork-on-edit). Si un fork éclipsant existe
 *     déjà pour cet id → redirect vers le fork.
 *
 * La création se fait via `cables/new/page.tsx`.
 *
 * arkyo-server: catalogue unique — `params.id` est toujours un cordon du
 * catalogue : `GET /api/tenant/catalogue/cables/[id]` renvoie l'item avec ses
 * relations hydratées (`function`, `brand`, `leftConnector`,
 * `rightConnector`), comme la branche « personnel » de cette page. Pas de
 * redirection vers un fork ; un id inconnu rend la page 404 (`notFound()`).
 * Les référentiels (`mainDb.catalog*` : connecteurs, fonctions, marques) sont
 * les tables `Tenant*`, via `/api/tenant/catalogue/lookup`.
 */
export default function TenantCableDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <CatalogAdminPage load={() => loadCableEditor(id)} loadKey={id}>
      {(p) => <TenantCableEditorClient {...p} />}
    </CatalogAdminPage>
  );
}

type Lookup = { connectorTypes: unknown[]; functions: unknown[]; brands: unknown[] };

async function loadCableEditor(id: string) {
  // ── 1) Item + 3) Référentiels pour le dialog d'édition (connectors / functions / brands) ──
  const [detail, lookup] = await Promise.all([
    api.get<{ source: "PERSONAL"; isAccessible: boolean; item: Record<string, unknown> }>(
      `/api/tenant/catalogue/cables/${encodeURIComponent(id)}`,
    ),
    api.get<Lookup>("/api/tenant/catalogue/lookup"),
  ]);
  return {
    item: detail.item as never,
    source: detail.source,
    isAccessible: detail.isAccessible,
    connectors: lookup.connectorTypes as never,
    functions: lookup.functions as never,
    brands: lookup.brands as never,
  };
}
