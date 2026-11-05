/**
 * BroadcastChannel cross-tab pour signaler une mise à jour du catalogue
 * (équipement / panel / adaptateur). Consommé par les inventaires
 * (`catalog-panel.tsx`) qui refetchent automatiquement.
 *
 * Pattern : les pages de création (equipment new, adapters new, panels)
 * appellent `broadcastCatalogUpdated()` après un POST réussi → tout onglet
 * inventaire ouvert reçoit l'event et refetch sa liste sans intervention
 * de l'utilisateur.
 *
 * En complément du `visibilitychange` côté inventaire (qui refetch au
 * retour sur l'onglet), ce canal permet une sync immédiate quand les
 * deux onglets restent visibles côte à côte.
 */
export function broadcastCatalogUpdated() {
  if (typeof window === "undefined") return;
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const bc = new BroadcastChannel("arkyo-catalog");
    bc.postMessage("updated");
    bc.close();
  } catch {
    // Navigateurs anciens ou contextes sécurisés — silent fail.
  }
}
