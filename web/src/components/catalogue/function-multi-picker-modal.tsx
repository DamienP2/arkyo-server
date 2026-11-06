"use client";

/**
 * FunctionMultiPickerModal — modal de sélection multi-select des fonctions
 * additionnelles (CatalogFunction) pour l'éditeur d'équipement.
 *
 * Aligné sur PhasePickerModal en pattern multi-toggle :
 *  - Dialog Radix monochrome
 *  - Recherche par nom
 *  - Cards toggleables (checkmark + ring quand actif)
 *  - Footer : Annuler + Confirmer N sélection(s)
 *  - Buffer interne jusqu'au Confirmer
 *
 * La fonction marquée comme `primaryFunctionId` est EXCLUE de la liste
 * (elle est déjà sélectionnée comme principale).
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Search, X } from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type FunctionMultiPickerFunction = {
  id: string;
  label: string;
  color: string;
  key?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  functions: FunctionMultiPickerFunction[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Identifiant de la fonction principale (exclue de la liste). */
  primaryFunctionId?: string | null;
};

export function FunctionMultiPickerModal({
  open,
  onOpenChange,
  functions,
  selectedIds,
  onChange,
  primaryFunctionId = null,
}: Props) {
  const [query, setQuery] = useState("");
  const [buffer, setBuffer] = useState<string[]>(selectedIds);

  // Resync au (re)open
  useEffect(() => {
    if (open) {
      setBuffer(selectedIds);
      setQuery("");
    }
  }, [open, selectedIds]);

  // Liste effective : on exclut la fonction principale
  const eligible = useMemo(
    () =>
      primaryFunctionId
        ? functions.filter((f) => f.id !== primaryFunctionId)
        : functions,
    [functions, primaryFunctionId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? eligible.filter(
          (f) =>
            f.label.toLowerCase().includes(q) ||
            (f.key?.toLowerCase().includes(q) ?? false),
        )
      : eligible;
    // Sélectionnées en tête
    const selSet = new Set(buffer);
    const head = matched.filter((f) => selSet.has(f.id));
    const tail = matched.filter((f) => !selSet.has(f.id));
    return [...head, ...tail];
  }, [eligible, query, buffer]);

  const toggle = (id: string) => {
    setBuffer((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleConfirm = () => {
    onChange(buffer);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setBuffer(selectedIds);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel();
        else onOpenChange(v);
      }}
    >
      <DialogContent
        className="max-w-4xl p-0 flex flex-col max-h-[80vh]"
        showClose={false}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)]/60 px-5 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold">
              Fonctions supplémentaires
            </DialogTitle>
            <DialogDescription className="text-xs">
              Plusieurs fonctions possibles — cliquez pour activer / désactiver.
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={handleCancel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 border-b border-[var(--border)]/60 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par nom (Vidéo, Audio, Lumière…)"
              autoFocus
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {eligible.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Aucune fonction additionnelle disponible
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {primaryFunctionId
                  ? "La fonction principale couvre déjà toutes les fonctions définies."
                  : "Ajoutez-en dans Paramètres → Classification."}
              </p>
            </div>
          ) : filtered.length === 0 && query ? (
            <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Aucune fonction ne correspond
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Essayez d&apos;ajuster la recherche.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((f) => {
                const active = buffer.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]/10"
                        : "border-[var(--border)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    {active && (
                      <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${f.color}20` }}
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: f.color }}
                      />
                    </span>
                    <div className="min-w-0 flex-1 pr-6">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {f.label}
                      </p>
                      {f.key && (
                        <p className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
                          {f.key}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--border)]/60 px-5 py-3">
          <button
            type="button"
            onClick={handleCancel}
            className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            Annuler
          </button>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {buffer.length} sélection{buffer.length > 1 ? "s" : ""}
            {eligible.length > 0 && buffer.length !== eligible.length && (
              <span className="opacity-60"> / {eligible.length}</span>
            )}
          </span>
          <button
            type="button"
            onClick={handleConfirm}
            // arkyo-server: habillage Strata
            className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
          >
            Confirmer
            {buffer.length > 0 && (
              <span className="font-mono text-[10px] opacity-80">
                ({buffer.length})
              </span>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * FunctionMultiPickerTrigger — bouton standard qui ouvre la modal et
 * affiche un résumé des fonctions sélectionnées (chips).
 */
export function FunctionMultiPickerTrigger({
  functions,
  selectedIds,
  placeholder = "Aucune fonction supplémentaire",
  onClick,
  error,
  disabled,
  primaryFunctionId = null,
  readOnly,
}: {
  functions: FunctionMultiPickerFunction[];
  selectedIds: string[];
  placeholder?: string;
  onClick: () => void;
  error?: string;
  disabled?: boolean;
  primaryFunctionId?: string | null;
  /** Lecture pure : pas de hover, pas de ChevronRight, pas d'event onClick. */
  readOnly?: boolean;
}) {
  // Affichage : on filtre la principale, et on ne montre que les
  // sélectionnées (les non sélectionnées ne sont visibles que dans la modal).
  const visible = functions.filter(
    (f) => f.id !== primaryFunctionId && selectedIds.includes(f.id),
  );

  if (readOnly) {
    return (
      <div className="space-y-1">
        <div
          role="presentation"
          className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 py-1.5 text-left"
        >
          {visible.length > 0 ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {visible.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    borderColor: `${f.color}40`,
                    backgroundColor: `${f.color}15`,
                    color: f.color,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: f.color }}
                  />
                  {f.label}
                </span>
              ))}
            </div>
          ) : (
            <span className="font-mono text-sm text-[var(--muted-foreground)]">—</span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg border bg-transparent px-3 py-1.5 text-left transition-colors hover:bg-[var(--secondary)]",
          error
            ? "border-[var(--destructive)]"
            : "border-[var(--border)]",
        )}
        role="button"
        tabIndex={0}
        onClick={disabled ? undefined : onClick}
        onKeyDown={
          disabled
            ? undefined
            : (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
        }
      >
        {visible.length > 0 ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {visible.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium"
                style={{
                  borderColor: `${f.color}40`,
                  backgroundColor: `${f.color}15`,
                  color: f.color,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: f.color }}
                />
                {f.label}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm text-[var(--muted-foreground)]">
            {placeholder}
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      </div>
      {error && (
        // arkyo-server: habillage Strata
        <p className="text-[11px] text-[var(--danger-text)]">{error}</p>
      )}
    </div>
  );
}
