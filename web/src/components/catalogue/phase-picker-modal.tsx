"use client";

/**
 * PhasePickerModal — modal de sélection multi-select des phases
 * (CatalogPhase) pour l'éditeur d'équipement.
 *
 * Aligné sur ConnectorPickerModal mais en mode multi-toggle :
 *  - Dialog Radix
 *  - Recherche par nom
 *  - Cards toggleables (checkmark + ring quand actif)
 *  - Footer : bouton "Confirmer N sélection(s)" + Annuler
 *  - Le state interne est buffered jusqu'au "Confirmer" pour permettre
 *    d'annuler les changements.
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

export type PhasePickerPhase = {
  id: string;
  label: string;
  key?: string;
  color?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phases: PhasePickerPhase[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Couleur d'accent par défaut (catColor de l'équipement). */
  accentColor?: string;
};

export function PhasePickerModal({
  open,
  onOpenChange,
  phases,
  selectedIds,
  onChange,
  accentColor = "var(--accent)",
}: Props) {
  const [query, setQuery] = useState("");
  const [buffer, setBuffer] = useState<string[]>(selectedIds);

  // Synchronise le buffer interne avec les props quand on (ré)ouvre la modal.
  useEffect(() => {
    if (open) {
      setBuffer(selectedIds);
      setQuery("");
    }
  }, [open, selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? phases.filter(
          (p) =>
            p.label.toLowerCase().includes(q) ||
            (p.key?.toLowerCase().includes(q) ?? false),
        )
      : phases;
    // Mettre les phases déjà sélectionnées en premier (dans l'ordre de
    // `buffer`, puis les autres dans l'ordre originel).
    const selSet = new Set(buffer);
    const head = matched.filter((p) => selSet.has(p.id));
    const tail = matched.filter((p) => !selSet.has(p.id));
    return [...head, ...tail];
  }, [phases, query, buffer]);

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
              Choisir les phases
            </DialogTitle>
            <DialogDescription className="text-xs">
              Plusieurs phases possibles — cliquez pour activer / désactiver.
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
              placeholder="Rechercher par nom (Préprod, Direct, Postprod…)"
              autoFocus
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phases.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Aucune phase définie
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Ajoutez-en dans Paramètres → Catégories.
              </p>
            </div>
          ) : filtered.length === 0 && query ? (
            <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Aucune phase ne correspond
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Essayez d&apos;ajuster la recherche.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((p) => {
                const active = buffer.includes(p.id);
                const color = p.color ?? accentColor;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={cn(
                      "group flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
                        : "border-[var(--border)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    <span
                      className="relative flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/40"
                      style={{ backgroundColor: active ? `${color}20` : undefined }}
                    >
                      {active ? (
                        <Check className="h-5 w-5" style={{ color }} />
                      ) : (
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: color, opacity: 0.6 }}
                        />
                      )}
                    </span>
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {p.label}
                    </p>
                    {p.key && (
                      <p className="truncate font-mono text-[9px] text-[var(--muted-foreground)]">
                        {p.key}
                      </p>
                    )}
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
            {buffer.length !== phases.length && (
              <span className="opacity-60"> / {phases.length}</span>
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
 * PhasePickerTrigger — bouton standard qui ouvre la modal et affiche
 * un résumé des phases sélectionnées (chips).
 */
export function PhasePickerTrigger({
  phases,
  selectedIds,
  placeholder = "Sélectionner des phases",
  onClick,
  error,
  disabled,
  accentColor = "var(--accent)",
  readOnly,
}: {
  phases: PhasePickerPhase[];
  selectedIds: string[];
  placeholder?: string;
  onClick: () => void;
  error?: string;
  disabled?: boolean;
  accentColor?: string;
  /** Lecture pure : pas de hover, pas de ChevronRight, pas d'event onClick. */
  readOnly?: boolean;
}) {
  const selected = phases.filter((p) => selectedIds.includes(p.id));

  if (readOnly) {
    return (
      <div className="space-y-1">
        <div
          role="presentation"
          className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 py-1.5 text-left"
        >
          {selected.length > 0 ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {selected.map((p) => {
                const color = p.color ?? accentColor;
                return (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      borderColor: `${color}40`,
                      backgroundColor: `${color}15`,
                      color,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {p.label}
                  </span>
                );
              })}
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
        {selected.length > 0 ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {selected.map((p) => {
              const color = p.color ?? accentColor;
              return (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    borderColor: `${color}40`,
                    backgroundColor: `${color}15`,
                    color,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {p.label}
                </span>
              );
            })}
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
