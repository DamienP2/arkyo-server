"use client";

/**
 * FunctionPickerModal — modal de sélection d'une fonction principale
 * (CatalogFunction) pour l'éditeur d'équipement.
 *
 * Aligné sur ConnectorPickerModal :
 *  - Dialog Radix
 *  - Recherche par nom
 *  - Grille monochrome de cards (pastille couleur + label)
 *  - Item sélectionné en premier dans la liste filtrée
 */

import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type FunctionPickerFunction = {
  id: string;
  label: string;
  color: string;
  key?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  functions: FunctionPickerFunction[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function FunctionPickerModal({
  open,
  onOpenChange,
  functions,
  selectedId,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? functions.filter(
          (f) =>
            f.label.toLowerCase().includes(q) ||
            (f.key?.toLowerCase().includes(q) ?? false),
        )
      : functions;
    if (!selectedId) return matched;
    const idx = matched.findIndex((f) => f.id === selectedId);
    if (idx <= 0) return matched;
    const head = matched[idx];
    return [head, ...matched.slice(0, idx), ...matched.slice(idx + 1)];
  }, [functions, query, selectedId]);

  const handleSelect = (id: string | null) => {
    onSelect(id);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setQuery("");
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="max-w-4xl p-0 flex flex-col max-h-[80vh]"
        showClose={false}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)]/60 px-5 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold">
              Choisir une fonction principale
            </DialogTitle>
            <DialogDescription className="text-xs">
              Sélectionnez la fonction broadcast principale.
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => onOpenChange(false)}
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
          {functions.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Aucune fonction définie
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Ajoutez-en dans Paramètres → Classification.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {/* Card "Aucune" — toujours en premier */}
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className={cn(
                  "group flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all",
                  !selectedId
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
                    : "border-[var(--border)] hover:bg-[var(--secondary)]",
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border)]/60 bg-[var(--secondary)]/40">
                  <span className="font-mono text-[11px] font-bold text-[var(--muted-foreground)]">
                    —
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">
                    Aucune
                  </p>
                  <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                    Fonction non spécifiée
                  </p>
                </div>
              </button>

              {filtered.length === 0 && query ? (
                <div className="col-span-full flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    Aucune fonction ne correspond
                  </p>
                </div>
              ) : (
                filtered.map((f) => {
                  const active = f.id === selectedId;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => handleSelect(f.id)}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all",
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
                          : "border-[var(--border)] hover:bg-[var(--secondary)]",
                      )}
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${f.color}20` }}
                      >
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: f.color }}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
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
                })
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--border)]/60 px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            Annuler
          </button>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {filtered.length} fonction{filtered.length > 1 ? "s" : ""}
            {filtered.length !== functions.length && (
              <span className="opacity-60"> / {functions.length}</span>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * FunctionPickerTrigger — bouton standard qui ouvre la modal et affiche
 * l'état de sélection courant (pastille couleur + label).
 */
export function FunctionPickerTrigger({
  fn,
  placeholder = "Sélectionner une fonction",
  onClick,
  error,
  disabled,
  readOnly,
}: {
  fn: FunctionPickerFunction | null;
  placeholder?: string;
  onClick: () => void;
  error?: string;
  disabled?: boolean;
  /** Lecture pure : div `role="presentation"` (non focusable, non cliquable),
   *  bordure neutre, pas de hover, pas de ChevronRight. */
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <div className="space-y-1">
        <div
          role="presentation"
          className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 text-left"
        >
          {fn ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: `${fn.color}20` }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: fn.color }}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {fn.label}
                </p>
                {fn.key && (
                  <p className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
                    {fn.key}
                  </p>
                )}
              </div>
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
          "flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border bg-transparent px-3 text-left transition-colors hover:bg-[var(--secondary)]",
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
        {fn ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: `${fn.color}20` }}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: fn.color }}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                {fn.label}
              </p>
              {fn.key && (
                <p className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
                  {fn.key}
                </p>
              )}
            </div>
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
