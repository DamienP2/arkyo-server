// arkyo-server: SPA sans SSR — le Server Component devient un composant client.
// `mainDb` / `getTenantDb` / `requireTenantPermissionPage` (serveur) remplacés
// par l'API et la garde commune des pages du catalogue ; plus de plan
// (`catalog-visibility`) : catalogue unique.
import { NewTenantEquipmentClient } from "./_client";
import { CatalogAdminPage } from "../../_lib/client-page";
import { loadEquipmentRefs } from "../_lib/load-equipment-refs";

/**
 * /admin/catalogue/equipment/new — création d'un équipement personnel tenant.
 *
 * Server Component qui hydrate les référentiels (marques, connecteurs,
 * signaux, fonctions/phases/types) puis délègue à un client en mode CREATE.
 * Aucune ressource n'est créée en DB tant que l'utilisateur n'a pas cliqué
 * sur « Enregistrer ».
 *
 * arkyo-server: les référentiels (mêmes que la page [id]) sont chargés via
 * l'API, voir `../_lib/load-equipment-refs.ts`.
 */
export default function NewTenantEquipmentPage() {
  // Réservé au OWNER du tenant (ou collaborateur Arkyo en ghost, lecture seule).
  return (
    <CatalogAdminPage load={loadEquipmentRefs}>
      {(refs) => <NewTenantEquipmentClient {...refs} />}
    </CatalogAdminPage>
  );
}
