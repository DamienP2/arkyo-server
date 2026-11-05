// arkyo-server: SPA sans SSR — le Server Component devient un composant client.
// `mainDb` / `getTenantDb` / `requireTenantPermissionPage` (serveur) remplacés
// par l'API et la garde commune des pages du catalogue ; plus de plan
// (`catalog-visibility`) ni de fork Arkyo (`arkyo-restore`) : catalogue unique.
import { useParams } from "next/navigation";

import { api } from "@/lib/api-client";

import { TenantEquipmentEditorClient } from "./_client";
import { CatalogAdminPage } from "../../_lib/client-page";
import { loadEquipmentRefs } from "../_lib/load-equipment-refs";

/**
 * /admin/catalogue/equipment/[id] — éditeur tenant d'un équipement.
 *
 * Le `params.id` peut être :
 *   - un cuid de TenantEquipment (personnel, édition libre ; fork éclipsant
 *     → action « Récupérer la version Arkyo » + flags drift/source-gone)
 *   - un cuid de CatalogEquipment (Arkyo, éditable — le fork se crée au
 *     premier enregistrement via PATCH fork-on-edit). Si un fork éclipsant
 *     existe déjà pour cet id → redirect vers le fork.
 *
 * Le routage `/new` est géré dans `new/page.tsx` (POST puis redirect).
 *
 * arkyo-server: catalogue unique — `params.id` est toujours un équipement du
 * catalogue (`GET /api/tenant/catalogue/equipment/[id]`, dont `item` est déjà
 * le payload que cette page composait : `sourceType`, `functions[]`,
 * `phases[]`, `category`). Pas de redirection vers un fork, pas de flags
 * drift/source-gone ; un id inconnu rend la page 404 (`notFound()`).
 *
 * Référentiels : voir `../_lib/load-equipment-refs.ts`.
 */
export default function TenantEquipmentEditorPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <CatalogAdminPage load={() => loadEquipmentEditor(id)} loadKey={id}>
      {(p) => <TenantEquipmentEditorClient {...p} />}
    </CatalogAdminPage>
  );
}

async function loadEquipmentEditor(id: string) {
  const [detail, refs] = await Promise.all([
    api.get<{ source: "PERSONAL"; isAccessible: boolean; item: Record<string, unknown> }>(
      `/api/tenant/catalogue/equipment/${encodeURIComponent(id)}`,
    ),
    loadEquipmentRefs(),
  ]);
  return {
    item: detail.item as never,
    source: detail.source,
    isAccessible: detail.isAccessible,
    ...refs,
  };
}
