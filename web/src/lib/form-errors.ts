/**
 * form-errors.ts — Pont entre les erreurs API et les helpers de form (react-hook-form, etc.)
 *
 * Pourquoi deux formats sont supportés :
 * - Forme legacy `flatten()` de Zod : `{ error: { formErrors: string[], fieldErrors: { foo: string[] } } }`
 *   héritée des routes Supervisor existantes.
 * - Forme cible (forward-compatible) : `{ error: "Validation invalide", issues: [{ path, message }] }`
 *   produite via `zodIssuesFromError()` côté serveur.
 *
 * Le helper `mapApiErrorToForm()` accepte les deux et n'a aucune dépendance directe à
 * react-hook-form : on passe une callback `setError(path, { type?, message })` compatible
 * avec la signature de RHF mais aussi avec n'importe quel autre form lib.
 */

import type { ZodError } from "zod";
import { ApiError } from "@/lib/api-client";

// ── Types publics ─────────────────────────────────────────────────────────────

/**
 * Signature compatible avec `useForm().setError` de react-hook-form,
 * mais sans dépendance directe au package.
 */
export type FormSetError = (
  path: string,
  error: { type?: string; message: string },
) => void;

/**
 * Format wire d'une issue de validation côté API (forward-compatible).
 */
export type ApiIssue = {
  path: (string | number)[];
  message: string;
};

// ── Type guards internes ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isApiIssue(value: unknown): value is ApiIssue {
  if (!isRecord(value)) return false;
  if (typeof value.message !== "string") return false;
  if (!Array.isArray(value.path)) return false;
  return value.path.every((seg) => typeof seg === "string" || typeof seg === "number");
}

function isApiIssueArray(value: unknown): value is ApiIssue[] {
  return Array.isArray(value) && value.every(isApiIssue);
}

/**
 * Convertit un `path` d'issue en chemin de form react-hook-form.
 * - `[]` ou `["root"]` → `"root.serverError"` (convention RHF pour erreurs racine)
 * - `["foo", "bar", 0]` → `"foo.bar.0"`
 */
function pathToFormKey(path: (string | number)[]): string {
  if (path.length === 0) return "root.serverError";
  if (path.length === 1 && path[0] === "root") return "root.serverError";
  return path.map((seg) => String(seg)).join(".");
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Tente de mapper une erreur API vers des `setError` par champ.
 *
 * Reconnaît deux formats de body :
 * 1. Nouveau : `{ issues: ApiIssue[] }` — chaque issue est mappée individuellement.
 * 2. Legacy `flatten()` Zod : `{ error: { formErrors, fieldErrors } }`.
 *
 * @returns `true` si au moins une erreur a été placée sur le form (l'appelant peut
 *          alors skip le toast/feedback global), `false` sinon.
 */
export function mapApiErrorToForm(err: unknown, setError: FormSetError): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.body === null || err.body === undefined) return false;
  if (!isRecord(err.body)) return false;

  const body = err.body;
  let placed = false;

  // 1) Forme cible : `{ issues: [...] }`
  if (isApiIssueArray(body.issues)) {
    for (const issue of body.issues) {
      setError(pathToFormKey(issue.path), { type: "server", message: issue.message });
      placed = true;
    }
    return placed;
  }

  // 2) Forme legacy `flatten()` : `{ error: { formErrors, fieldErrors } }`
  if (isRecord(body.error)) {
    const errorObj = body.error;
    const fieldErrors = errorObj.fieldErrors;
    const formErrors = errorObj.formErrors;

    if (isRecord(fieldErrors)) {
      for (const [key, value] of Object.entries(fieldErrors)) {
        if (Array.isArray(value) && typeof value[0] === "string") {
          setError(key, { type: "server", message: value[0] });
          placed = true;
        }
      }
    }

    if (Array.isArray(formErrors) && typeof formErrors[0] === "string") {
      setError("root.serverError", { type: "server", message: formErrors[0] });
      placed = true;
    }

    return placed;
  }

  return false;
}

/**
 * Convertit une `ZodError` en tableau d'`ApiIssue` au format wire de la spec.
 *
 * À utiliser côté route handler :
 *   if (!parsed.success) {
 *     return NextResponse.json(
 *       { error: "Validation invalide", issues: zodIssuesFromError(parsed.error) },
 *       { status: 400 },
 *     );
 *   }
 *
 * Les paths vides sont normalisés en `["root"]` pour cohérence côté client.
 */
export function zodIssuesFromError(error: ZodError): ApiIssue[] {
  return error.issues.map((issue) => {
    if (issue.path.length === 0) {
      return { path: ["root"], message: issue.message };
    }
    // Zod 4 expose `PropertyKey[]` (string | number | symbol) ; on coerce les symbols
    // en string puisque le wire JSON ne supporte pas Symbol.
    const path: (string | number)[] = issue.path.map((seg) =>
      typeof seg === "string" || typeof seg === "number" ? seg : String(seg),
    );
    return { path, message: issue.message };
  });
}
