"use client";

import { cn } from "@/lib/utils";
import { Check } from "@/components/ui/icons";

import type { StepperKey } from "./types";

const STEPS: { key: StepperKey; label: string }[] = [
  { key: "file", label: "Fichier" },
  { key: "map", label: "Colonnes" },
  { key: "verify", label: "Vérification" },
  { key: "done", label: "Rapport" },
];

/**
 * Stepper sobre : numéros + libellés. Étape courante en accent, étapes passées
 * cliquables pour revenir en arrière.
 */
export function Stepper({
  current,
  onStepClick,
  disabled,
}: {
  current: StepperKey;
  onStepClick: (key: StepperKey) => void;
  disabled?: boolean;
}) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <ol className="flex items-center gap-1 text-xs">
      {STEPS.map((s, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        const clickable = isPast && !disabled;
        return (
          <li key={s.key} className="flex items-center gap-1">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick(s.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors",
                isCurrent && "bg-[var(--accent)]/10 text-[var(--accent)]",
                isPast && "text-[var(--foreground)] hover:bg-[var(--secondary)]",
                !isPast && !isCurrent && "text-[var(--muted-foreground)]",
                !clickable && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  isCurrent && "bg-[var(--accent)] text-[var(--accent-foreground)]",
                  isPast && "bg-[var(--foreground)] text-[var(--background)]",
                  !isPast && !isCurrent && "bg-[var(--border)] text-[var(--muted-foreground)]",
                )}
              >
                {isPast ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <span className="h-px w-4 bg-[var(--border)]" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
