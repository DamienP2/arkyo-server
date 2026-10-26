/**
 * api-client.ts — Helper fetch typé centralisé pour Broadcast Hub.
 *
 * Usage :
 *   import { api, ApiError } from "@/lib/api-client";
 *
 *   const rig = await api.post<Rig>("/api/rigs", { name: "Régie A", type: "FLIGHT_CASE" });
 *   const updated = await api.patch<Equipment>(`/api/equipment/${id}`, body);
 *   await api.delete(`/api/rigs/${id}`);
 *
 * Erreurs : throw ApiError si res.ok === false.
 * Le body de l'erreur est `parsedBody` (json si possible, texte sinon, null en dernier recours).
 */

// ── Classe d'erreur ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  /** Statut HTTP (ex. 400, 401, 404, 500) */
  public status: number;
  /** Corps de la réponse, parsé en JSON si possible */
  public body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Extrait un message d'erreur lisible depuis une erreur thrown (ApiError ou
 * Error standard). Utile pour afficher dans un toast / dialog.
 *
 * Reconnaît spécialement `code: "MISSING_PERMISSION"` (403 du gate par permission)
 * et formate un message court "Action réservée — permission requise : xxx".
 *
 *   try { await api.delete(...) }
 *   catch (e) { toast.error(getApiErrorMessage(e)); }
 */
export function getApiErrorMessage(err: unknown, fallback = "Une erreur est survenue."): string {
  if (err instanceof ApiError) {
    if (err.body && typeof err.body === "object") {
      const body = err.body as { error?: unknown; code?: unknown; required?: unknown };
      // Cas spécial : refus de permission par le gate serveur
      if (body.code === "MISSING_PERMISSION") {
        const req = body.required;
        const reqStr = Array.isArray(req) ? req.join(" / ") : typeof req === "string" ? req : "";
        return reqStr
          ? `Action réservée — permission requise : ${reqStr}`
          : "Action réservée par votre rôle.";
      }
      if (typeof body.error === "string" && body.error.trim().length > 0) {
        return body.error;
      }
      // Échec de validation Zod : les routes renvoient `{ error: zodError.flatten() }`
      // (objet `{ formErrors, fieldErrors }`). Sans ce formatage, l'utilisateur
      // ne voit qu'un "API error 400" opaque.
      const zodMsg = formatZodFlattenError(body.error);
      if (zodMsg) return zodMsg;
    }
    if (typeof err.body === "string") {
      const readable = readableTextBody(err.body);
      if (readable) return readable;
    }
    // Message posé par l'appelant à la construction — il en sait plus que le
    // statut. Le défaut de la classe, lui, est une chaîne technique : on lui
    // préfère un message adossé au statut, en français.
    if (err.message && err.message !== `API error ${err.status}`) {
      return err.message;
    }
    return statusMessage(err.status);
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/**
 * Longueur au-delà de laquelle un corps texte cesse d'être un message et
 * devient un document. Un message d'erreur d'API tient en une phrase.
 */
const MAX_TEXT_BODY = 200;

/**
 * Retourne le corps s'il est réellement lisible par un humain, null sinon.
 *
 * Toutes les erreurs ne viennent pas de nos routes : un proxy, une passerelle
 * ou une redirection vers une page de connexion répondent en HTML. Ce corps-là
 * n'est pas un message — l'afficher tel quel déverse une page entière (balises,
 * scripts, données sérialisées) dans un toast ou un EmptyState, et masque
 * l'information utile qu'est le statut.
 */
function readableTextBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TEXT_BODY) return null;
  if (trimmed.startsWith("<")) return null;
  return trimmed;
}

/** Message court adossé au statut, quand le corps ne dit rien d'exploitable. */
function statusMessage(status: number): string {
  if (status === 401) return "Session expirée — reconnectez-vous.";
  if (status === 403) return "Action réservée par votre rôle.";
  if (status === 404) return "Ressource introuvable.";
  if (status === 409) return "Conflit — la ressource a changé entre-temps.";
  if (status === 413) return "Contenu trop volumineux.";
  if (status >= 500) return `Erreur du serveur (${status}).`;
  return `Requête refusée (${status}).`;
}

/**
 * Formate un `zodError.flatten()` (`{ formErrors, fieldErrors }`) en message
 * court : "Champs invalides — depthMm : Expected int, received float". Retourne
 * null si l'objet n'a pas cette forme.
 */
function formatZodFlattenError(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const { formErrors, fieldErrors } = error as {
    formErrors?: unknown;
    fieldErrors?: unknown;
  };
  if (!Array.isArray(formErrors) || !fieldErrors || typeof fieldErrors !== "object") {
    return null;
  }
  const fields = Object.entries(fieldErrors as Record<string, unknown>)
    .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
    .map(([field, msgs]) => `${field} : ${(msgs as string[])[0]}`);
  if (fields.length > 0) return `Champs invalides — ${fields.join(" ; ")}`;
  if (formErrors.length > 0 && typeof formErrors[0] === "string") return formErrors[0];
  return null;
}

/**
 * Indique si une erreur est un refus de permission (code MISSING_PERMISSION).
 * Utile pour différencier un toast "permission" d'une erreur fonctionnelle.
 */
export function isPermissionDenied(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    typeof err.body === "object" &&
    err.body !== null &&
    (err.body as { code?: unknown }).code === "MISSING_PERMISSION"
  );
}

// ── Helpers internes ──────────────────────────────────────────────────────────

/**
 * Retourne `true` si le body doit être JSON-stringifié et que le Content-Type
 * doit être forcé à `application/json`.
 * FormData et Blob sont laissés tels quels (fetch gère Content-Type tout seul).
 */
function isJsonBody(body: unknown): body is object {
  return (
    body !== null &&
    body !== undefined &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof ReadableStream)
  );
}

/**
 * Merge des headers : les headers de l'appelant écrasent les headers par défaut,
 * mais n'effacent pas ceux qui ne sont pas mentionnés.
 */
function mergeHeaders(defaults: Record<string, string>, overrides?: HeadersInit): Headers {
  const merged = new Headers(defaults);
  if (overrides) {
    new Headers(overrides).forEach((value, key) => {
      merged.set(key, value);
    });
  }
  return merged;
}

/**
 * Parse la réponse :
 * - 204 ou content-length 0 → `undefined`
 * - JSON valide → objet parsé
 * - Sinon → texte brut
 */
async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const contentLength = res.headers.get("content-length");
  if (contentLength === "0") return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/**
 * Noyau : exécute le fetch, throw ApiError si !res.ok.
 */
async function request<T>(
  url: string,
  method: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const defaultHeaders: Record<string, string> = {};

  let resolvedBody: BodyInit | undefined;

  if (body !== undefined) {
    if (isJsonBody(body)) {
      defaultHeaders["Content-Type"] = "application/json";
      resolvedBody = JSON.stringify(body);
    } else {
      resolvedBody = body as BodyInit;
    }
  }

  const headers = mergeHeaders(defaultHeaders, init?.headers);

  const response = await fetch(url, {
    credentials: "include",
    ...init,
    method,
    headers,
    body: resolvedBody,
  });

  if (!response.ok) {
    // Tenter de récupérer le body d'erreur pour l'exposer dans ApiError
    let errorBody: unknown = null;
    try {
      const errorText = await response.text();
      if (errorText) {
        try {
          errorBody = JSON.parse(errorText);
        } catch {
          errorBody = errorText;
        }
      }
    } catch {
      errorBody = null;
    }
    throw new ApiError(response.status, errorBody);
  }

  return parseResponse<T>(response);
}

// ── API publique ──────────────────────────────────────────────────────────────

export const api = {
  /**
   * GET — récupère une ressource.
   * @example const rig = await api.get<Rig>(`/api/rigs/${id}`);
   */
  get<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    return request<T>(url, "GET", undefined, init);
  },

  /**
   * POST — crée une ressource.
   * @example const created = await api.post<Rig>("/api/rigs", { name: "OB", type: "FLIGHT_CASE" });
   */
  post<T = unknown>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
    return request<T>(url, "POST", body, init);
  },

  /**
   * PATCH — met à jour partiellement une ressource.
   * @example const updated = await api.patch<Equipment>(`/api/equipment/${id}`, { name: "X" });
   */
  patch<T = unknown>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
    return request<T>(url, "PATCH", body, init);
  },

  /**
   * PUT — remplace intégralement une ressource.
   * @example await api.put(`/api/config`, fullConfig);
   */
  put<T = unknown>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
    return request<T>(url, "PUT", body, init);
  },

  /**
   * DELETE — supprime une ressource.
   * @example await api.delete(`/api/rigs/${id}`);
   */
  delete<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    return request<T>(url, "DELETE", undefined, init);
  },
};
