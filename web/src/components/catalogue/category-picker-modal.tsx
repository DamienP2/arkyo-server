"use client";

/**
 * CategoryPickerModal — modal de sélection d'une catégorie d'équipement
 * (arbre parent → enfants) avec recherche par nom.
 *
 * Comportement :
 *  - Recherche texte sur le nom (parent + enfant)
 *  - Cards affichent chemin : "Vidéo › Caméra plateau"
 *  - Click sur card = sélectionne et ferme la modal
 *  - Card "Aucune" en premier
 *
 * Note : la sélection est faite par nom (form.category est un string).
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

export type CategoryPickerCategory = {
  id: string;
  name: string;
  color: string;
  parentId?: string | null;
  children?: CategoryPickerCategory[];
  iconId?: string | null;
};

type FlatCategory = {
  id: string;
  name: string;
  color: string;
  parentName: string | null;
  parentColor: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryPickerCategory[];
  /** Sélection courante (nom de la catégorie). */
  selectedName: string | null;
  onSelect: (name: string | null) => void;
};

function flatten(categories: CategoryPickerCategory[]): FlatCategory[] {
  const roots = categories.filter((c) => !c.parentId);
  const out: FlatCategory[] = [];
  for (const p of roots) {
    // Le parent est aussi une catégorie sélectionnable (ex. "Vidéo" seul).
    out.push({
      id: p.id,
      name: p.name,
      color: p.color,
      parentName: null,
      parentColor: null,
    });
    for (const c of p.children ?? []) {
      out.push({
        id: c.id,
        name: c.name,
        color: c.color,
        parentName: p.name,
        parentColor: p.color,
      });
    }
  }
  return out;
}

export function CategoryPickerModal({
  open,
  onOpenChange,
  categories,
  selectedName,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");

  const flat = useMemo(() => flatten(categories), [categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? flat.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.parentName?.toLowerCase().includes(q) ?? false),
        )
      : flat;
    if (!selectedName) return matched;
    const idx = matched.findIndex((c) => c.name === selectedName);
    if (idx <= 0) return matched;
    const head = matched[idx];
    return [head, ...matched.slice(0, idx), ...matched.slice(idx + 1)];
  }, [flat, query, selectedName]);

  const handleSelect = (name: string | null) => {
    onSelect(name);
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
              Choisir une catégorie
            </DialogTitle>
            <DialogDescription className="text-xs">
              Sélectionnez la catégorie de l&apos;équipement.
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
              placeholder="Rechercher par nom (Vidéo, Audio…)"
              autoFocus
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {/* Card "Aucune" — toujours en premier */}
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className={cn(
                "group flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all",
                !selectedName
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
                  Catégorie non spécifiée
                </p>
              </div>
            </button>

            {filtered.length === 0 && query ? (
              <div className="col-span-full flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Aucune catégorie ne correspond
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Essayez d&apos;ajuster la recherche.
                </p>
              </div>
            ) : (
              filtered.map((c) => {
                const active = c.name === selectedName;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelect(c.name)}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
                        : "border-[var(--border)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${c.color}20` }}
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {c.name}
                      </p>
                      {c.parentName && (
                        <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                          {c.parentName} › {c.name}
                        </p>
                      )}
                    </div>
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
            {filtered.length} catégorie{filtered.length > 1 ? "s" : ""}
            {filtered.length !== flat.length && (
              <span className="opacity-60"> / {flat.length}</span>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * CategoryPickerTrigger — bouton standard qui ouvre la modal et affiche
 * l'état de sélection courant (pastille couleur + nom + chemin parent).
 */
export function CategoryPickerTrigger({
  category,
  placeholder = "Sélectionner une catégorie",
  onClick,
  error,
  disabled,
}: {
  category: { name: string; color: string; parentName?: string | null } | null;
  placeholder?: string;
  onClick: () => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-3 text-left transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-50",
          error
            ? "border-[var(--destructive)]"
            : "border-[var(--border)]",
        )}
      >
        {category ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: `${category.color}20` }}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: category.color }}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                {category.name}
              </p>
              {category.parentName && (
                <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                  {category.parentName} › {category.name}
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
      </button>
      {error && (
        <p className="text-[11px] text-[var(--destructive)]">{error}</p>
      )}
    </div>
  );
}
