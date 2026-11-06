/**
 * client-id.ts — Identifiant unique par tab navigateur, utilisé pour
 * filtrer ses propres events SSE (évite les loops d'écho lors d'une
 * mutation locale → publication serveur → réception côté même tab →
 * refetch qui écrase l'état optimiste).
 *
 * - Côté client : `getClientId()` génère/lit un UUID en sessionStorage
 *   (un ID par tab navigateur ; un nouvel onglet = nouvel ID).
 * - `apiFetch(url, opts)` wrapper léger autour de `fetch` qui injecte
 *   automatiquement le header `X-Client-Id` sur toutes les requêtes
 *   non-GET (mutations).
 * - Côté serveur : `readClientIdFromRequest(req)` lit le header sur
 *   les routes API, pour le forwarder à `publishAppUpdate({ clientId })`.
 */

const STORAGE_KEY = "arkyo.clientId";

/**
 * Génère un UUID v4-like. `crypto.randomUUID` n'est dispo qu'en contexte
 * sécurisé (https/localhost) sur les navigateurs récents. Fallback :
 * `crypto.getRandomValues` (largement supporté), puis `Math.random` en
 * dernier recours (entropie faible mais suffisante pour un ID de tab).
 */
function generateUuid(): string {
  // 1) Path optimal : crypto.randomUUID
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 2) Fallback : crypto.getRandomValues (supporté partout depuis ~2015)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // RFC 4122 v4 — bits de version et variant
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  // 3) Dernier recours : Math.random (faible entropie — OK pour un ID de tab)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Retourne l'ID client de l'onglet courant. Génère un nouvel UUID si
 * absent. Stocké en sessionStorage (scope onglet). Coté SSR, retourne
 * une chaîne vide (jamais utilisée côté serveur de toute façon).
 */
export function getClientId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.sessionStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = generateUuid();
    window.sessionStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage indisponible (cookies désactivés, mode privé…) :
    // on génère un ID volatile en mémoire — l'écho ne sera pas filtré
    // mais le système ne plante pas.
    return generateUuid();
  }
}

/**
 * Wrapper léger autour de `fetch` qui injecte automatiquement le
 * header `X-Client-Id` sur toutes les requêtes. Usage drop-in :
 *
 *     const res = await apiFetch("/api/...", { method: "PATCH", body });
 *
 * Préserve toutes les options Fetch (headers, signal, credentials…).
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("X-Client-Id")) {
    headers.set("X-Client-Id", getClientId());
  }
  return fetch(input, { ...init, headers });
}

/**
 * Lit le header `X-Client-Id` côté serveur. Utilisé par les routes API
 * pour propager l'ID originateur au payload SSE via `publishAppUpdate`.
 */
export function readClientIdFromRequest(
  req: Request | { headers: Headers | { get: (k: string) => string | null } },
): string | undefined {
  try {
    const h = req.headers as Headers | { get: (k: string) => string | null };
    const v = "get" in h && typeof h.get === "function" ? h.get("x-client-id") : null;
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}
