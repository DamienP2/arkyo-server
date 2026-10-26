"use client";

/**
 * FormField + FormErrorSummary — primitives form partagées Supervisor.
 *
 * Voir spec : `docs/superpowers/specs/2026-05-03-supervisor-forms-and-system-layout-design.md` §5.
 *
 * `FormField` standardise le tryptique label + input + erreur/hint au style
 * actuel des panels Système (label uppercase tracking wider muted-foreground,
 * erreur rouge avec XCircle, etc.). L'enfant unique reçoit `aria-invalid` et
 * `data-error` quand `error` est défini, ce qui permet à n'importe quel input
 * (composant `Input` partagé ou input inline avec `inputCls`) d'afficher une
 * bordure rouge tant qu'il porte la classe Tailwind `data-[error=true]:border-destructive`.
 *
 * `FormErrorSummary` affiche un récap cliquable en haut du formulaire qui
 * scrolle au champ correspondant (via `data-field={path}` posé sur le
 * wrapper extérieur de chaque `FormField`).
 *
 * Les deux composants ne sont PAS encore consommés — la migration des panels
 * sera faite dans une vague 2.
 */

import * as React from "react";
import { XCircle } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

// ─── RequiredPill ─────────────────────────────────────────────────────────────

/** Pastille « REQUIS » — remplace l'astérisque sur les champs obligatoires. */
export function RequiredPill() {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--accent)]/12 px-1.5 py-px text-[8px] font-bold tracking-wider text-[var(--accent)] normal-case">
      REQUIS
    </span>
  );
}

// ─── FormField ────────────────────────────────────────────────────────────────

export type FormFieldProps = {
  /** Libellé visuel du champ (uppercase tracking-wider muted-foreground). */
  label?: React.ReactNode;
  /** Aide affichée sous l'input. Cachée si `error` est défini. */
  hint?: string;
  /** Message d'erreur. `undefined` = pas d'erreur. */
  error?: string;
  /** Ajoute une pastille « REQUIS » après le label. */
  required?: boolean;
  /**
   * `htmlFor` du `<label>`. Si fourni, le label est lié à l'input via
   * `for`/`id` — sinon, le label est purement visuel et l'enfant garde son
   * id propre.
   */
  htmlFor?: string;
  /** Classes additionnelles sur le wrapper extérieur. */
  className?: string;
  /**
   * Pose `data-field={fieldName}` sur le wrapper extérieur. Utilisé par
   * `FormErrorSummary` pour scroller jusqu'au champ via
   * `document.querySelector('[data-field=...]')`.
   */
  fieldName?: string;
  /** Enfant unique : input, select, textarea, ou composant qui les expose. */
  children: React.ReactElement;
};

/**
 * Idéal pour `error`/`aria-invalid`/`aria-describedby`/`data-error` :
 * on clone l'enfant unique pour lui injecter ces attributs sans toucher
 * au composant Input partagé.
 */
export function FormField({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  fieldName,
  children,
}: FormFieldProps) {
  const reactId = React.useId();
  const errorId = `${reactId}-error`;

  const child = React.Children.only(children);
  // Quand error est défini, on injecte aria-invalid + data-error + aria-describedby.
  // Important : on préserve les props existantes du child (aria-describedby
  // existant concaténé pour ne pas écraser une description).
  const childProps: Record<string, unknown> = {};
  if (error) {
    childProps["aria-invalid"] = true;
    childProps["data-error"] = "true";
    const existingDescribed =
      typeof (child.props as { "aria-describedby"?: string })["aria-describedby"] === "string"
        ? ((child.props as { "aria-describedby"?: string })["aria-describedby"] as string)
        : null;
    childProps["aria-describedby"] = existingDescribed
      ? `${existingDescribed} ${errorId}`
      : errorId;
  }
  const enhancedChild =
    Object.keys(childProps).length > 0 ? React.cloneElement(child, childProps) : child;

  // Wrapper : div générique. Le <label> sémantique est rendu à part s'il est
  // fourni, et lié soit via `htmlFor` (recommandé), soit purement visuellement
  // (pas de htmlFor → le label ne capte pas le clic, l'enfant gère son id).
  const labelNode = label ? (
    <label
      htmlFor={htmlFor}
      className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase"
    >
      {label}
      {required ? <RequiredPill /> : null}
    </label>
  ) : null;

  return (
    <div
      className={cn("block", className)}
      data-field={fieldName}
    >
      {labelNode}
      {enhancedChild}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1 flex items-center gap-1 text-[11px] leading-snug text-destructive"
        >
          <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="mt-1 text-[10px] leading-snug text-[var(--muted-foreground)]">{hint}</p>
      ) : null}
    </div>
  );
}

// ─── FormErrorSummary ─────────────────────────────────────────────────────────

export type FormErrorSummaryProps = {
  /**
   * Objet d'erreurs (typiquement `form.formState.errors` de react-hook-form,
   * ou tout dictionnaire `{ path: { message?: string } }` éventuellement nested).
   */
  errors: Record<string, { message?: string } | undefined> | unknown;
  /**
   * Map `pathDotté → libellé lisible`. Ex.: `{ canonicalUrl: "URL canonique" }`.
   * Fallback sur le path brut si pas de label.
   */
  fieldLabels: Record<string, string>;
  /** Classes additionnelles sur le wrapper. */
  className?: string;
};

type CollectedError = { path: string; message: string };

/**
 * Walker récursif qui collecte les erreurs `react-hook-form`-like.
 * - Une node-erreur a `{ message?: string, type?: string, ref? }`.
 * - Une node nested est un objet sans `message` qu'on récurse.
 *
 * On ignore les nodes `root.serverError` (gérées séparément ailleurs) si
 * souhaité — ici on les inclut, l'appelant fournit `fieldLabels` adéquat.
 */
function collectErrors(
  node: unknown,
  prefix: string,
  out: CollectedError[],
): void {
  if (!node || typeof node !== "object") return;
  // Détection node-erreur RHF
  const maybe = node as { message?: unknown };
  if (typeof maybe.message === "string" && maybe.message.length > 0) {
    out.push({ path: prefix, message: maybe.message });
    return;
  }
  // Récurse sur les clés
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const child = (node as Record<string, unknown>)[key];
    const nextPath = prefix ? `${prefix}.${key}` : key;
    collectErrors(child, nextPath, out);
  }
}

/**
 * Trouve l'élément focusable à l'intérieur d'un `[data-field=...]` wrapper.
 */
function findFocusable(wrapper: Element): HTMLElement | null {
  const candidate = wrapper.querySelector(
    "input, select, textarea, [contenteditable=\"true\"]",
  );
  return candidate instanceof HTMLElement ? candidate : null;
}

export function FormErrorSummary({
  errors,
  fieldLabels,
  className,
}: FormErrorSummaryProps) {
  const collected = React.useMemo(() => {
    const out: CollectedError[] = [];
    collectErrors(errors, "", out);
    return out;
  }, [errors]);

  if (collected.length === 0) return null;

  const handleClick = (path: string) => {
    if (typeof document === "undefined") return;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(path)
        : path.replace(/"/g, '\\"');
    const wrapper = document.querySelector(`[data-field="${escaped}"]`);
    if (!wrapper) return;
    wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = findFocusable(wrapper);
    if (focusable) {
      // Délai pour laisser le scroll s'installer avant le focus
      window.setTimeout(() => focusable.focus({ preventScroll: true }), 250);
    }
  };

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Corrigez les champs ci-dessous
      </p>
      <ul className="mt-2 space-y-1">
        {collected.map(({ path, message }) => {
          const label = fieldLabels[path] ?? path;
          return (
            <li key={path}>
              <button
                type="button"
                onClick={() => handleClick(path)}
                className="text-left text-[11px] leading-snug text-destructive underline decoration-destructive/40 underline-offset-2 hover:decoration-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 rounded"
              >
                <span className="font-medium">{label}</span>
                <span className="text-destructive/80"> — {message}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
