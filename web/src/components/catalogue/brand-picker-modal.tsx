"use client";

/**
 * BrandPickerModal — modal de sélection d'une marque pour l'éditeur
 * d'équipement (et autres éditeurs catalogue futurs).
 *
 * Aligné sur ConnectorPickerModal :
 *  - Dialog Radix (max-w-4xl, max-h-[80vh])
 *  - Recherche par nom
 *  - Grille monochrome de cards (logo si dispo, sinon initiales)
 *  - Item sélectionné en premier dans la liste filtrée
 *  - Card "Aucune" en premier (avant tri)
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

export type BrandPickerBrand = {
  id: string;
  name: string;
  logoUrl?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brands: BrandPickerBrand[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function BrandPickerModal({
  open,
  onOpenChange,
  brands,
  selectedId,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? brands.filter((b) => b.name.toLowerCase().includes(q))
      : brands;
    if (!selectedId) return matched;
    const idx = matched.findIndex((b) => b.id === selectedId);
    if (idx <= 0) return matched;
    const head = matched[idx];
    return [head, ...matched.slice(0, idx), ...matched.slice(idx + 1)];
  }, [brands, query, selectedId]);

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
              Choisir une marque
            </DialogTitle>
            <DialogDescription className="text-xs">
              Sélectionnez le constructeur de l&apos;équipement.
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
              placeholder="Rechercher par nom (Sony, Blackmagic, Yamaha…)"
              autoFocus
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {/* Card "Aucune" — toujours en premier */}
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className={cn(
                "group flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all",
                !selectedId
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
                  : "border-[var(--border)] hover:bg-[var(--secondary)]",
              )}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-[var(--border)]/60 bg-[var(--secondary)]/40">
                <span className="font-mono text-[11px] font-bold text-[var(--muted-foreground)]">
                  —
                </span>
              </div>
              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                Aucune
              </p>
            </button>

            {filtered.length === 0 && query ? (
              <div className="col-span-full flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Aucune marque ne correspond
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Essayez d&apos;ajuster la recherche.
                </p>
              </div>
            ) : (
              filtered.map((b) => {
                const active = b.id === selectedId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleSelect(b.id)}
                    className={cn(
                      "group flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
                        : "border-[var(--border)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)]/60 bg-white dark:bg-white/5">
                      {b.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={b.logoUrl}
                          alt=""
                          className="h-full w-full object-contain p-1.5"
                        />
                      ) : (
                        <span className="text-[11px] font-bold text-[var(--muted-foreground)]">
                          {b.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {b.name}
                    </p>
                  </button>
                );
              })
            )}
          </div>
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
            {filtered.length} marque{filtered.length > 1 ? "s" : ""}
            {filtered.length !== brands.length && (
              <span className="opacity-60"> / {brands.length}</span>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * BrandPickerTrigger — bouton standard qui ouvre la modal et affiche
 * l'état de sélection courant (logo/initiales + nom).
 */
export function BrandPickerTrigger({
  brand,
  placeholder = "Sélectionner une marque",
  onClick,
  error,
  disabled,
  readOnly,
}: {
  brand: BrandPickerBrand | null;
  placeholder?: string;
  onClick: () => void;
  error?: string;
  disabled?: boolean;
  /** Lecture pure : div `role="presentation"` (non focusable, non cliquable),
   *  bordure neutre, pas de hover, pas de ChevronRight. Si pas de valeur,
   *  on affiche un placeholder sobre "—" (pas d'incitation au clic). */
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <div className="space-y-1">
        <div
          role="presentation"
          className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 text-left"
        >
          {brand ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)]/60 bg-white dark:bg-white/5">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brand.logoUrl}
                    alt=""
                    className="h-full w-full object-contain p-0.5"
                  />
                ) : (
                  <span className="text-[9px] font-bold text-[var(--muted-foreground)]">
                    {brand.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </span>
              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                {brand.name}
              </p>
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
        {brand ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)]/60 bg-white dark:bg-white/5">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brand.logoUrl}
                  alt=""
                  className="h-full w-full object-contain p-0.5"
                />
              ) : (
                <span className="text-[9px] font-bold text-[var(--muted-foreground)]">
                  {brand.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </span>
            <p className="truncate text-sm font-medium text-[var(--foreground)]">
              {brand.name}
            </p>
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
