/**
 * Cadre des pages `/auth*`, repris de arkyo:app/platform/auth/page.tsx (page
 * d'auth standard, L1101-1422) : fond, monogramme animé, lockup arkyo.io,
 * colonne de formulaire `max-w-xs`, bandeau d'erreur, bascule de thème et
 * sélecteur de langue. Les classes des champs, libellés et boutons sont celles
 * de l'étape « email » (libellés : ceux des formulaires multi-champs de
 * l'onboarding, espacés de `space-y-4`) ; `UsernameField` est repris de la même
 * page (L1434-1488).
 *
 * Le flux OTP (étapes email / code / onboarding) n'est pas repris : chaque page
 * `/auth*` d'arkyo-server rend son formulaire dans ce cadre.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Check, X, Loader2 } from "@/components/ui/icons";
import { LocaleSelector } from "@/components/locale-selector";
import { StrataBrand } from "@/components/brand/strata-brand"; // arkyo-server: habillage Strata

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const USERNAME_RE = /^[a-z0-9]([a-z0-9._-]{1,28}[a-z0-9])?$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Libellé de champ (formulaires multi-champs de l'onboarding d'arkyo). */
export const LABEL_CLASS =
  "mb-1.5 block text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase";

/** Champ texte (étape email d'arkyo). */
export const INPUT_CLASS =
  "h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60";

/** Bouton principal (bouton « Continuer » de l'étape email d'arkyo). */
export const SUBMIT_CLASS = // arkyo-server: habillage Strata
  "mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

/** Bouton secondaire en pied de formulaire (« ← Changer d'utilisateur » d'arkyo). */
export const FOOT_LINK_CLASS =
  "text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase transition-colors hover:text-[var(--foreground)] disabled:opacity-40";

/** Texte d'accompagnement centré (« codeSent » de l'étape code d'arkyo). */
export const HINT_CLASS = "mb-6 text-center text-xs text-[var(--muted-foreground)]";

/** Spinner du bouton de l'étape email d'arkyo. */
export function ButtonSpinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Champ libellé + saisie aux classes de l'étape email d'arkyo. */
export function AuthField({
  id,
  label,
  className,
  ...input
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={className}>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input id={id} className={INPUT_CLASS} {...input} />
    </div>
  );
}

export function AuthShell({ error, children }: { error?: string; children?: ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-4">

      {/* arkyo-server: habillage Strata (lockup empilé à la place du monogramme et d'arkyo.io) */}
      <div className="mb-2">
        <StrataBrand stacked />
      </div>

      <div className="mb-10" />

      {/* Form */}
      <div className="w-full max-w-xs">
        {error && ( // arkyo-server: habillage Strata
          <div className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-center text-xs text-[var(--danger-text)]">
            {error}
          </div>
        )}

        {children}
      </div>

      {/* Theme toggle + Language selector — empilés en bas, centrés */}
      <div className="mt-8 flex flex-col items-center gap-3">
        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            title={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{isDark ? "Mode clair" : "Mode sombre"}</span>
          </button>
        )}
        <LocaleSelector variant="inline" />
      </div>
    </div>
  );
}

/**
 * Champ Identifiant réutilisable — input + indicateur live (Check / X / Loader)
 * + hint dynamique. Utilisé en /entity (entité) et en /name (particulier).
 */
export function UsernameField({
  username,
  setUsername,
  status,
  placeholder,
  idleHint,
  fieldError,
}: {
  username: string;
  setUsername: (v: string) => void;
  status: "idle" | "checking" | "ok" | "taken" | "invalid";
  placeholder: string;
  idleHint: string;
  fieldError?: string;
}) {
  return (
    <div>
      <label
        // arkyo-server: htmlFor/id ajoutés pour lier le libellé au champ.
        htmlFor="username"
        className="mb-1.5 block text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase"
      >
        Identifiant
      </label>
      <div className="relative">
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          placeholder={placeholder}
          className="h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 pr-9 text-sm text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        <div className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
          {status === "checking" && (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
          )}
          {/* arkyo-server: habillage Strata */}
          {status === "ok" && <Check className="h-4 w-4 text-[var(--success)]" />}
          {(status === "taken" || status === "invalid") && (
            <X className="h-4 w-4 text-[var(--danger)]" />
          )}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
        {status === "invalid" && "3 à 30 caractères : a-z, 0-9, . _ -."}
        {/* arkyo-server: habillage Strata */}
        {status === "taken" && <span className="text-[var(--danger-text)]">Identifiant déjà pris.</span>}
        {status === "ok" && (
          <span className="text-[var(--success-text)]">Identifiant disponible.</span>
        )}
        {status === "checking" && "Vérification…"}
        {status === "idle" && idleHint}
      </p>
      {/* arkyo-server: habillage Strata */}
      {fieldError && <p className="mt-1 text-[11px] text-[var(--danger-text)]">{fieldError}</p>}
    </div>
  );
}
