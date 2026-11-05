/**
 * safeGetList — wrapper autour de `api.get` qui retourne `[]` proprement quand
 * la route est encore absente (404), le tenant n'a aucune visibilité (403),
 * ou que la réponse n'est pas un tableau. Évite de faire crasher la page
 * pendant que les routes API du catalogue sont en cours de mise en place.
 *
 * Utilisé exclusivement par les panneaux read-only du Catalogue tenant.
 */

import { api, ApiError } from "@/lib/api-client";

export async function safeGetList<T>(url: string): Promise<T[]> {
  try {
    const data = await api.get<T[] | unknown>(url);
    if (Array.isArray(data)) return data as T[];
    return [];
  } catch (err) {
    if (err instanceof ApiError) {
      // 404 = route pas encore disponible (livraison parallèle agent B).
      // 403 = plan sans accès — on retourne aussi [] pour ne pas planter l'UI,
      // l'EmptyState s'occupe de l'expliquer.
      if (err.status === 404 || err.status === 403) return [];
    }
    // Autre erreur : on remonte pour signaler côté caller.
    throw err;
  }
}
