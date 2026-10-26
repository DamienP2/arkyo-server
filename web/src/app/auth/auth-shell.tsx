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
export const SUBMIT_CLASS =
  "mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--arkyo-blue)] text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

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

      {/* Monogramme */}
      <div className="group mb-6 cursor-pointer">
        <svg width={72} height={72} viewBox="0 0 100 100">
          <defs>
            <linearGradient id="flow-auth" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--arkyo-blue-light)" stopOpacity="0">
                <animate
                  attributeName="offset"
                  values="-0.3;1"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
              </stop>
              <stop offset="15%" stopColor="var(--arkyo-blue-light)" stopOpacity="0.9">
                <animate
                  attributeName="offset"
                  values="-0.15;1.15"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
              </stop>
              <stop offset="30%" stopColor="var(--arkyo-blue-light)" stopOpacity="0">
                <animate
                  attributeName="offset"
                  values="0;1.3"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
              </stop>
            </linearGradient>
            <filter id="glow-auth">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d="M26 84 L26 28 C26 6 74 6 74 28 L74 84"
            fill="none"
            stroke="var(--arkyo-blue-light)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="26"
            y1="58"
            x2="74"
            y2="58"
            stroke="var(--arkyo-blue-light)"
            strokeWidth="2.8"
            strokeLinecap="round"
            opacity="0.4"
          />
          <line
            x1="26"
            y1="58"
            x2="74"
            y2="58"
            stroke="url(#flow-auth)"
            strokeWidth="3.5"
            strokeLinecap="round"
            filter="url(#glow-auth)"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          />
          <circle
            cx="62"
            cy="58"
            r="2.5"
            fill="var(--arkyo-blue-light)"
            opacity="0.7"
            className="group-hover:hidden"
          />
          <circle
            cx="50"
            cy="58"
            r="3"
            fill="var(--arkyo-blue-light)"
            opacity="0.8"
            className="hidden group-hover:block"
          >
            <animate attributeName="cx" values="30;70;30" dur="1.5s" repeatCount="indefinite" />
            <animate
              attributeName="opacity"
              values="0.3;1;0.3"
              dur="1.5s"
              repeatCount="indefinite"
            />
            <animate attributeName="r" values="2;3.5;2" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <line
            x1="34"
            y1="42"
            x2="66"
            y2="42"
            stroke="var(--arkyo-blue-light)"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.15"
          />
          <line
            x1="34"
            y1="72"
            x2="66"
            y2="72"
            stroke="var(--arkyo-blue-light)"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.15"
          />
        </svg>
      </div>

      {/* Lockup */}
      <div className="mb-2 flex items-baseline gap-0.5">
        <span className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          arkyo
        </span>
        <span className="text-3xl font-light tracking-tight text-[var(--muted-foreground)]">
          .io
        </span>
      </div>

      <div className="mb-10" />

      {/* Form */}
      <div className="w-full max-w-xs">
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
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
          {status === "ok" && <Check className="h-4 w-4 text-emerald-500" />}
          {(status === "taken" || status === "invalid") && (
            <X className="h-4 w-4 text-red-500" />
          )}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
        {status === "invalid" && "3 à 30 caractères : a-z, 0-9, . _ -."}
        {status === "taken" && <span className="text-red-500">Identifiant déjà pris.</span>}
        {status === "ok" && (
          <span className="text-emerald-600">Identifiant disponible.</span>
        )}
        {status === "checking" && "Vérification…"}
        {status === "idle" && idleHint}
      </p>
      {fieldError && <p className="mt-1 text-[11px] text-red-500">{fieldError}</p>}
    </div>
  );
}
