"use client";

/**
 * TypePickerModal — modal de sélection d'un type d'équipement (CatalogType),
 * sur 2 niveaux : on choisit d'abord un type RACINE (parentId null) filtré par
 * fonction, puis optionnellement un SOUS-TYPE parmi ses enfants.
 *
 * Aligné sur ConnectorPickerModal :
 *  - Dialog Radix
 *  - Recherche par nom (à plat : racines + sous-types)
 *  - Grille monochrome de cards
 *
 * Navigation :
 *  - vue racines : les racines sans enfant se sélectionnent directement ;
 *    celles qui ont des sous-types ouvrent la vue enfants (chevron).
 *  - vue enfants : card « type générique » (= la racine seule) + les sous-types.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, Shapes, X } from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PersonalTypeDot } from "@/components/catalogue/inline-type-creator";

export type TypePickerType = {
  id: string;
  name: string;
  functionId: string;
  /** Type parent (racine). null = type racine ; défini = sous-type. */
  parentId: string | null;
  /** Origine : ARKYO (lecture seule) ou PERSONAL (tenant). Optionnel — absent
   *  = traité comme Arkyo (aucun repère « perso » affiché). */
  source?: "ARKYO" | "PERSONAL";
  function?: { label: string; color: string };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: TypePickerType[];
  /** Si fourni, ne montre que les types de cette fonction. */
  functionFilterId?: string | null;
  /** Couleur d'accent pour les pastilles (souvent la couleur de la fonction parente). */
  accentColor?: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function TypePickerModal({
  open,
  onOpenChange,
  types,
  functionFilterId,
  accentColor,
  selectedId,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  // Racine en cours d'exploration (vue sous-types). null = vue racines.
  const [browsingRootId, setBrowsingRootId] = useState<string | null>(null);

  const scoped = useMemo(
    () =>
      functionFilterId
        ? types.filter((t) => t.functionId === functionFilterId)
        : types,
    [types, functionFilterId],
  );

  const roots = useMemo(() => scoped.filter((t) => t.parentId == null), [scoped]);

  const childrenByRoot = useMemo(() => {
    const map = new Map<string, TypePickerType[]>();
    for (const t of scoped) {
      if (t.parentId != null) {
        const arr = map.get(t.parentId) ?? [];
        arr.push(t);
        map.set(t.parentId, arr);
      }
    }
    return map;
  }, [scoped]);

  // À l'ouverture : si la sélection courante est un sous-type, on entre
  // directement dans la vue de ses frères ; sinon vue racines.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const sel = selectedId ? scoped.find((t) => t.id === selectedId) ?? null : null;
    setBrowsingRootId(sel?.parentId ?? null);
    // On ne veut ré-initialiser qu'à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSelect = (id: string | null) => {
    onSelect(id);
    onOpenChange(false);
  };

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return scoped.filter((t) => t.name.toLowerCase().includes(q));
  }, [scoped, query]);

  const browsingRoot = browsingRootId
    ? roots.find((r) => r.id === browsingRootId) ?? null
    : null;
  const browsingChildren = browsingRootId
    ? childrenByRoot.get(browsingRootId) ?? []
    : [];

  const rootColor = (root: TypePickerType) =>
    accentColor ?? root.function?.color ?? "var(--accent)";

  // Compteur affiché en pied (dépend de la vue courante).
  const visibleCount = query
    ? searchResults.length
    : browsingRoot
      ? browsingChildren.length + 1
      : roots.length;

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
              Choisir un type d&apos;équipement
            </DialogTitle>
            <DialogDescription className="text-xs">
              Type précis, puis sous-type optionnel.
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
              placeholder="Rechercher par nom (Caméra, PTZ, Switch L2…)"
              autoFocus
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {scoped.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Aucun type disponible
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {functionFilterId
                  ? "Aucun type rattaché à cette fonction."
                  : "Sélectionnez d'abord une fonction."}
              </p>
            </div>
          ) : query ? (
            /* ── Recherche à plat (racines + sous-types) ─────────────────── */
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {searchResults.length === 0 ? (
                <div className="col-span-full flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    Aucun type ne correspond
                  </p>
                </div>
              ) : (
                searchResults.map((t) => {
                  const parent =
                    t.parentId != null
                      ? scoped.find((r) => r.id === t.parentId) ?? null
                      : null;
                  const color = accentColor ?? t.function?.color ?? "var(--accent)";
                  return (
                    <TypeOptionCard
                      key={t.id}
                      title={t.name}
                      subtitle={
                        parent
                          ? `${parent.name} · sous-type`
                          : t.function?.label ?? null
                      }
                      color={color}
                      active={selectedId === t.id}
                      personal={t.source === "PERSONAL"}
                      onClick={() => handleSelect(t.id)}
                    />
                  );
                })
              )}
            </div>
          ) : browsingRoot ? (
            /* ── Vue sous-types d'une racine ─────────────────────────────── */
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setBrowsingRootId(null)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Tous les types
              </button>
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: rootColor(browsingRoot) }}
                />
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  {browsingRoot.name}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                <TypeOptionCard
                  title={browsingRoot.name}
                  subtitle="Type générique · aucun sous-type"
                  color={rootColor(browsingRoot)}
                  active={selectedId === browsingRoot.id}
                  personal={browsingRoot.source === "PERSONAL"}
                  onClick={() => handleSelect(browsingRoot.id)}
                />
                {browsingChildren.map((sub) => (
                  <TypeOptionCard
                    key={sub.id}
                    title={sub.name}
                    subtitle={browsingRoot.name}
                    color={rootColor(browsingRoot)}
                    active={selectedId === sub.id}
                    personal={sub.source === "PERSONAL"}
                    onClick={() => handleSelect(sub.id)}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* ── Vue racines ─────────────────────────────────────────────── */
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <TypeOptionCard
                variant="none"
                title="Aucun type"
                subtitle="Non spécifié"
                active={!selectedId}
                onClick={() => handleSelect(null)}
              />
              {roots.map((root) => {
                const kids = childrenByRoot.get(root.id) ?? [];
                const color = rootColor(root);
                if (kids.length > 0) {
                  // Actif si la sélection est cette racine OU un de ses sous-types.
                  const selectedType = selectedId
                    ? scoped.find((t) => t.id === selectedId) ?? null
                    : null;
                  const active =
                    selectedId === root.id || selectedType?.parentId === root.id;
                  return (
                    <TypeOptionCard
                      key={root.id}
                      title={root.name}
                      subtitle={`${kids.length} sous-type${kids.length > 1 ? "s" : ""}`}
                      color={color}
                      active={active}
                      personal={root.source === "PERSONAL"}
                      trailing={
                        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                      }
                      onClick={() => setBrowsingRootId(root.id)}
                    />
                  );
                }
                return (
                  <TypeOptionCard
                    key={root.id}
                    title={root.name}
                    subtitle={root.function?.label ?? null}
                    color={color}
                    active={selectedId === root.id}
                    personal={root.source === "PERSONAL"}
                    onClick={() => handleSelect(root.id)}
                  />
                );
              })}
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
            {visibleCount} type{visibleCount > 1 ? "s" : ""}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Card d'option (racine, sous-type, générique ou « Aucun ») ───────────────

function TypeOptionCard({
  title,
  subtitle,
  color,
  active,
  personal,
  trailing,
  onClick,
  variant = "type",
}: {
  title: string;
  subtitle?: string | null;
  color?: string;
  active?: boolean;
  personal?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
  variant?: "type" | "none";
}) {
  const c = color ?? "var(--accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
          : "border-[var(--border)] hover:bg-[var(--secondary)]",
      )}
    >
      {variant === "none" ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border)]/60 bg-[var(--secondary)]/40">
          <span className="font-mono text-[11px] font-bold text-[var(--muted-foreground)]">
            —
          </span>
        </span>
      ) : (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${c}20` }}
        >
          <Shapes className="h-4 w-4" style={{ color: c }} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--foreground)]">
          {personal && <PersonalTypeDot />}
          <span className="truncate">{title}</span>
        </p>
        {subtitle && (
          <p className="truncate text-[10px] text-[var(--muted-foreground)]">
            {subtitle}
          </p>
        )}
      </div>
      {trailing}
    </button>
  );
}

/**
 * TypePickerTrigger — bouton standard qui ouvre la modal et affiche
 * l'état de sélection courant (icône Shapes + nom). Si `parentType` est
 * fourni (sélection = sous-type), affiche « Type › Sous-type ».
 */
export function TypePickerTrigger({
  type,
  parentType,
  accentColor,
  placeholder = "Sélectionner un type",
  onClick,
  error,
  disabled,
  readOnly,
}: {
  type: TypePickerType | null;
  /** Type parent quand `type` est un sous-type — affiche le chemin complet. */
  parentType?: TypePickerType | null;
  accentColor?: string;
  placeholder?: string;
  onClick: () => void;
  error?: string;
  disabled?: boolean;
  /** Lecture pure : pas de hover, pas de ChevronRight, pas d'event onClick. */
  readOnly?: boolean;
}) {
  const color = accentColor ?? type?.function?.color ?? "var(--muted-foreground)";
  const primaryName = type
    ? parentType
      ? `${parentType.name} › ${type.name}`
      : type.name
    : null;
  if (readOnly) {
    return (
      <div className="space-y-1">
        <div
          role="presentation"
          className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 text-left"
        >
          {type ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: `${color}20` }}
              >
                <Shapes className="h-3.5 w-3.5" style={{ color }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {primaryName}
                </p>
                {type.function?.label && (
                  <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                    {type.function.label}
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
        {type ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: `${color}20` }}
            >
              <Shapes className="h-3.5 w-3.5" style={{ color }} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                {primaryName}
              </p>
              {type.function?.label && (
                <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                  {type.function.label}
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
        <p className="text-[11px] text-[var(--destructive)]">{error}</p>
      )}
    </div>
  );
}
