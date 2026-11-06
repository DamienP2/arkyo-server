"use client";

/**
 * ConnectorMultiPickerModal — modal de sélection multi-select de connecteurs
 * (CatalogConnectorType) avec filtrage optionnel par fonction.
 *
 * Design strictement aligné sur `ConnectorPickerModal` (single) :
 *  - Dialog Radix monochrome max-w-4xl, header / toolbar recherche /
 *    grille de cards (2/3/4 cols) / footer.
 *  - Card identique : 12×12 conteneur d'icône `ConnectorIcon` + nom truncate.
 *
 * Différences avec le single picker :
 *  - Multi-select via buffer interne (confirmé seulement au bouton Confirmer,
 *    Annuler restaure l'état initial — pattern aligné sur
 *    `FunctionMultiPickerModal`).
 *  - Coche bleue overlay top-right quand la card est sélectionnée
 *    (pattern aligné sur `FunctionMultiPickerModal`).
 *  - Footer 3 colonnes : Annuler · compteur · Confirmer (N).
 *  - Prop `filterByFunctionId` optionnelle : restreint la liste aux
 *    connecteurs dont `functionIds` inclut l'id passé.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import { cn } from "@/lib/utils";

export type ConnectorMultiPickerConnectorRef = {
  id: string;
  name: string;
  color?: string | null;
  iconId?: string | null;
  /** Fonctions auxquelles ce connecteur est rattaché. Utilisé par la prop
   *  `filterByFunctionId` pour filtrer la liste. */
  functionIds?: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectors: ConnectorMultiPickerConnectorRef[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /**
   * Si défini, ne montre que les connecteurs dont `functionIds` inclut cet id.
   * (Le filtre est appliqué côté modal — l'appelant peut passer toute la
   *  liste sans pré-filtrer.)
   */
  filterByFunctionId?: string | null;
};

export function ConnectorMultiPickerModal({
  open,
  onOpenChange,
  connectors,
  selectedIds,
  onChange,
  filterByFunctionId = null,
}: Props) {
  const [query, setQuery] = useState("");
  const [buffer, setBuffer] = useState<string[]>(selectedIds);

  // Resync au (re)open : on récupère l'état initial passé en props.
  useEffect(() => {
    if (open) {
      setBuffer(selectedIds);
      setQuery("");
    }
  }, [open, selectedIds]);

  // Liste effective : on filtre par fonction si demandé.
  const eligible = useMemo(
    () =>
      filterByFunctionId
        ? connectors.filter(
            (c) => c.functionIds?.includes(filterByFunctionId) ?? false,
          )
        : connectors,
    [connectors, filterByFunctionId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? eligible.filter((c) => c.name.toLowerCase().includes(q))
      : eligible;
    // Sélectionnés en tête (cohérence avec le single picker + multi function).
    const selSet = new Set(buffer);
    const head = matched.filter((c) => selSet.has(c.id));
    const tail = matched.filter((c) => !selSet.has(c.id));
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
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)]/60 px-5 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold">
              Choisir un ou plusieurs connecteurs
            </DialogTitle>
            <DialogDescription className="text-xs">
              Sélectionnez les types de connecteurs compatibles.
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
          {eligible.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Aucun connecteur compatible
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {filterByFunctionId
                  ? "Aucun connecteur n'est rattaché à cette fonction."
                  : "Le référentiel ne contient aucun connecteur."}
              </p>
            </div>
          ) : filtered.length === 0 && query ? (
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
                const active = buffer.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={cn(
                      "group relative flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all",
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

        {/* ── Footer : Annuler · compteur · Confirmer ─────────────────── */}
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
 * ConnectorMultiPickerTrigger — bouton standard qui ouvre la modal et
 * affiche un résumé des connecteurs sélectionnés (icône + nom dans des
 * chips compactes).
 *
 * Aligné sur `FunctionMultiPickerTrigger` pour la cohérence.
 */
export function ConnectorMultiPickerTrigger({
  connectors,
  selectedIds,
  placeholder = "Sélectionner un ou plusieurs connecteurs compatibles",
  onClick,
  error,
  disabled,
}: {
  connectors: ConnectorMultiPickerConnectorRef[];
  selectedIds: string[];
  placeholder?: string;
  onClick: () => void;
  error?: string;
  disabled?: boolean;
}) {
  // On n'affiche dans le trigger que les connecteurs encore visibles dans la
  // liste passée (si un filtre fonction est appliqué côté appelant, les ids
  // disparus ne s'affichent pas — mais restent stockés en form value
  // jusqu'au prochain choix utilisateur).
  const visible = connectors.filter((c) => selectedIds.includes(c.id));

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-3 py-1.5 text-left transition-colors",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:bg-[var(--secondary)]",
          error ? "border-[var(--destructive)]" : "border-[var(--border)]",
        )}
        role="button"
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
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
            {visible.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--secondary)]/40 px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)]"
              >
                <ConnectorIcon
                  iconId={c.iconId ?? "bnc"}
                  color="currentColor"
                  size={14}
                />
                {c.name}
              </span>
            ))}
          </div>
        ) : (
          <span
            className={cn(
              "text-sm text-[var(--muted-foreground)]",
              disabled && "italic",
            )}
          >
            {placeholder}
          </span>
        )}
        <span className="shrink-0 text-[11px] font-medium text-[var(--muted-foreground)]">
          {!disabled && visible.length > 0 ? "Modifier" : ""}
        </span>
      </div>
      {error && (
        // arkyo-server: habillage Strata
        <p className="text-[11px] text-[var(--danger-text)]">{error}</p>
      )}
    </div>
  );
}
