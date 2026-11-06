"use client";

/**
 * ConnectorPickerModal — modal de sélection d'un type de connecteur avec
 * filtrage par fonction broadcast.
 *
 * Utilisé par l'éditeur d'adaptateur (`app/(app)/admin/catalogue/adapters/[id]/adapter-editor.tsx`)
 * pour remplacer le dropdown de sélection. Conçu pour être réutilisable
 * (cordon, éditeurs futurs).
 *
 * Comportement :
 *  - Recherche texte sur le nom du connecteur.
 *  - Chips de fonctions (filtre multi-select, OU logique).
 *    "Toutes" = aucun filtre actif.
 *  - Click sur une carte = sélectionne et ferme la modal.
 *
 * Le composant attend que chaque connecteur expose son tableau `functionIds`
 * (relation many-to-many `CatalogConnectorTypeFunction`).
 */

import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import { cn } from "@/lib/utils";

export type ConnectorPickerConnectorRef = {
  id: string;
  name: string;
  color?: string | null;
  iconId?: string | null;
  /** Optionnel — n'est plus utilisé depuis la simplification monochrome
   *  (le modal ne filtre plus par fonction). Conservé pour rétro-compat
   *  avec les call sites qui en disposent. */
  functionIds?: string[];
};

export type ConnectorPickerFunctionRef = {
  id: string;
  label: string;
  color: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectors: ConnectorPickerConnectorRef[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ConnectorPickerModal({
  open,
  onOpenChange,
  connectors,
  selectedId,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? connectors.filter((c) => c.name.toLowerCase().includes(q))
      : connectors;
    // Mettre le connecteur sélectionné en premier (s'il est dans la liste filtrée)
    if (!selectedId) return matched;
    const idx = matched.findIndex((c) => c.id === selectedId);
    if (idx <= 0) return matched;
    const head = matched[idx];
    return [head, ...matched.slice(0, idx), ...matched.slice(idx + 1)];
  }, [connectors, query, selectedId]);

  const handleSelect = (id: string) => {
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
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)]/60 px-5 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold">
              Choisir un connecteur
            </DialogTitle>
            <DialogDescription className="text-xs">
              Sélectionnez le type de connecteur.
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

        {/* ── Toolbar : recherche ─────────────────────────────────────── */}
        <div className="shrink-0 border-b border-[var(--border)]/60 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par nom (BNC, XLR, RJ45…)"
              autoFocus
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </div>

        {/* ── Body : grille de cards ────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {filtered.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Aucun connecteur ne correspond
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Essayez d&apos;ajuster la recherche.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((c) => {
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelect(c.id)}
                    className={cn(
                      "group flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
                        : "border-[var(--border)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/40 text-[var(--foreground)]">
                      <ConnectorIcon
                        iconId={c.iconId ?? "bnc"}
                        color="currentColor"
                        size={32}
                      />
                    </div>
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {c.name}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--border)]/60 px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            Annuler
          </button>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {filtered.length} connecteur{filtered.length > 1 ? "s" : ""}
            {filtered.length !== connectors.length && (
              <span className="opacity-60"> / {connectors.length}</span>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ConnectorPickerTrigger — bouton standard qui ouvre la modal et affiche
 * l'état de sélection courant (icône + nom + chips fonctions).
 *
 * Fourni en complément pour homogénéiser l'invocation depuis tous les
 * éditeurs. Si l'appelant veut un design custom, il peut afficher le
 * bouton lui-même et utiliser directement <ConnectorPickerModal>.
 *
 * `readOnly` : rend une `<div role="presentation">` non focusable, sans
 *  hover ni ChevronRight, bordure neutre. Si pas de connecteur, on affiche
 *  un placeholder mono "—" (pas d'incitation au clic).
 */
export function ConnectorPickerTrigger({
  connector,
  placeholder = "Sélectionner un connecteur",
  onClick,
  error,
  readOnly,
}: {
  connector: ConnectorPickerConnectorRef | null;
  placeholder?: string;
  onClick: () => void;
  error?: string;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <div className="space-y-1">
        <div
          role="presentation"
          className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 text-left"
        >
          {connector ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)]/60 bg-[var(--secondary)]/40">
                <ConnectorIcon
                  iconId={connector.iconId ?? "bnc"}
                  color="currentColor"
                  size={20}
                />
              </span>
              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                {connector.name}
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
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-3 text-left transition-colors hover:bg-[var(--secondary)]",
          error
            ? "border-[var(--destructive)]"
            : "border-[var(--border)]",
        )}
      >
        {connector ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)]/60 bg-[var(--secondary)]/40">
              <ConnectorIcon
                iconId={connector.iconId ?? "bnc"}
                color="currentColor"
                size={20}
              />
            </span>
            <p className="truncate text-sm font-medium text-[var(--foreground)]">
              {connector.name}
            </p>
          </div>
        ) : (
          <span className="text-sm text-[var(--muted-foreground)]">
            {placeholder}
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      </button>
      {error && (
        // arkyo-server: habillage Strata
        <p className="text-[11px] text-[var(--danger-text)]">{error}</p>
      )}
    </div>
  );
}
