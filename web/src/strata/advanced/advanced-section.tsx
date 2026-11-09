"use client";

/**
 * Section « Avancé » des écrans que l'interface Strata dessine elle-même
 * (spec v2 §2, maquette `.adv`) : les champs rares, repliés par défaut.
 *   - l'ouverture est mémorisée par type d'écran (`kind`), dans le stockage
 *     local `strata-advanced-<kind>` ;
 *   - la préférence « Toujours afficher les sections avancées »
 *     (`strata-advanced-always`) les ouvre toutes.
 *
 * Préférence par navigateur, comme les autres réglages d'affichage d'arkyo
 * (stockage local) : aucune route d'API.
 */

import { useCallback, useId, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const ALWAYS_KEY = "strata-advanced-always";
const kindKey = (kind: string) => `strata-advanced-${kind}`;

/** Changement d'une préférence dans cet onglet (l'évènement `storage` ne couvre que les autres). */
const CHANGE = "strata-advanced-change";

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* stockage indisponible : l'état ne survit pas au rendu suivant */
  }
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Préférence booléenne du stockage local, partagée entre les composants. */
function useStoredFlag(key: string): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key), () => false);
  const set = useCallback((on: boolean) => write(key, on), [key]);
  return [value, set];
}

/** « Toujours afficher les sections avancées ». */
export function useAdvancedAlways(): [boolean, (on: boolean) => void] {
  return useStoredFlag(ALWAYS_KEY);
}

export function AdvancedSection({
  kind,
  summary,
  children,
}: {
  /** Type d'écran : la mémoire d'ouverture lui est propre. */
  kind: string;
  /** Résumé d'une ligne, lu section repliée. */
  summary: ReactNode;
  children: ReactNode;
}) {
  const [always] = useAdvancedAlways();
  const [remembered, setRemembered] = useStoredFlag(kindKey(kind));
  const open = always || remembered;
  const id = useId();
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div
      className={cn(
        "rounded-lg border",
        open ? "border-[var(--border-strong)]" : "border-[var(--border)]",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        // Préférence « toujours » : la section reste ouverte (elle se règle dans la navigation Gérer).
        onClick={() => {
          if (!always) setRemembered(!remembered);
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[var(--foreground)] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
        <strong className="font-semibold">Avancé</strong>
        <span className="min-w-0 flex-1 truncate text-[var(--muted-foreground)]">{summary}</span>
        {(always || remembered) && (
          <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
            {always ? "toujours affiché" : "mémorisé"}
          </span>
        )}
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-3 border-t border-[var(--border)] px-3 pt-2.5 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

/** Interrupteur de la préférence « Toujours afficher les sections avancées ». */
export function AdvancedAlwaysToggle({ className }: { className?: string }) {
  const [always, setAlways] = useAdvancedAlways();
  const label = "Toujours afficher les sections avancées";
  return (
    <label className={cn("flex cursor-pointer items-center gap-2.5 text-[12px] text-[var(--muted-foreground)]", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={always}
        aria-label={label}
        onClick={() => setAlways(!always)}
        className={cn(
          "relative h-[17px] w-[30px] shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          always ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-[2px] h-[13px] w-[13px] rounded-full transition-[left]",
            always ? "left-[15px] bg-[var(--accent-foreground)]" : "left-[2px] bg-[var(--card)]",
          )}
        />
      </button>
      <span aria-hidden>{label}</span>
    </label>
  );
}
