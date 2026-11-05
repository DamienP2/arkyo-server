"use client";

/**
 * Helpers partagés pour les toolbars des onglets liste (Équipements, Cordons,
 * Adaptateurs côté supervisor — admin tenant via apiBase).
 *
 * Exporte :
 *   - `Chip` : bouton toggle (multi-select) avec teinte optionnelle si couleur fournie.
 *   - `BrandMultiSelect` : dropdown multi-select recherche + cases à cocher.
 *   - `ActiveFilterPills` : barre de pills (rendue entre Filtrer et Vue dans
 *     l'AdminListToolbar via le slot `children`). API générique : on lui passe
 *     directement le tableau de pills à afficher — chaque consommateur compose
 *     ses pills à partir de son état local.
 *   - `toggleInSet`, `PLAN_COLORS`, `PLAN_LABELS`, `PLAN_ORDER` : utilitaires.
 *
 * Aucun lien à un modèle métier précis ; tout est paramétré côté appelant.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

// ── Utilitaires ───────────────────────────────────────────────────────────

/** Toggle d'une valeur dans un Set immutable (renvoie un nouveau Set). */
export function toggleInSet<T>(set: Set<T>, val: T): Set<T> {
  const next = new Set(set);
  if (next.has(val)) next.delete(val);
  else next.add(val);
  return next;
}

// arkyo-server: PLAN_COLORS / PLAN_LABELS / PLAN_ORDER retirés (plans
// d'abonnement SaaS) : plus aucun consommateur dans le catalogue unique.

// ── Chip toggle ────────────────────────────────────────────────────────────

export function Chip({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  // Si une couleur est fournie ET que la chip est active, on teinte le bouton
  // dans cette couleur (background 15% alpha + border 60% alpha + texte plein).
  // Sinon on retombe sur la teinte accent.
  const tintedActive = active && color;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
        active && !color && "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] shadow-sm",
        !active &&
          "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]/20 hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
      )}
      style={
        tintedActive
          ? {
              backgroundColor: `${color}26`, // ~15% alpha
              borderColor: `${color}99`, // ~60% alpha
              color,
              boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
            }
          : undefined
      }
    >
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      {active && !color && <Check className="h-3 w-3" />}
      {label}
    </button>
  );
}

// ── Pills filtres actifs (API générique) ───────────────────────────────────

export type ActivePill = {
  key: string;
  label: string;
  color?: string;
  onRemove: () => void;
};

/**
 * Barre de pills filtres actifs. On lui passe un tableau de specs construites
 * côté appelant (pour rester agnostique du shape métier). Quand `pills` est
 * vide, ne rend rien (pas même le séparateur).
 */
export function ActiveFilterPills({ pills }: { pills: ActivePill[] }) {
  if (pills.length === 0) return null;

  return (
    <>
      <div className="h-5 w-px shrink-0 bg-[var(--border)]" />
      <div className="flex min-w-0 shrink items-center gap-1 overflow-x-auto">
        {pills.map((p) => {
          const tinted = !!p.color;
          return (
            <span
              key={p.key}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition-all",
                !tinted &&
                  "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]",
              )}
              style={
                tinted
                  ? {
                      borderColor: `${p.color}80`,
                      backgroundColor: `${p.color}1a`,
                      color: p.color,
                    }
                  : undefined
              }
            >
              {p.color && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.color }} />
              )}
              <span className="max-w-[140px] truncate">{p.label}</span>
              <button
                type="button"
                onClick={p.onRemove}
                aria-label={`Retirer le filtre ${p.label}`}
                className="ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--foreground)]/15"
              >
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              </button>
            </span>
          );
        })}
      </div>
    </>
  );
}

// ── Brand multi-select dropdown ─────────────────────────────────────────────

/**
 * Dropdown popover avec recherche + cases à cocher. Plus économe en place que
 * des chips quand on a >15-20 marques. Le composant est intentionnellement
 * générique : il accepte une liste `{ id, name }` et la sélection est un
 * `Set<string>` de **noms** (et pas d'ids — car certaines APIs ne renvoient
 * que `brandId` et on matche via une map locale).
 */
export function BrandMultiSelect({
  brands,
  selected,
  onToggle,
  onClear,
  placeholder = "Sélectionner des marques…",
}: {
  brands: Array<{ id: string; name: string }>;
  selected: Set<string>;
  onToggle: (name: string) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click outside / Escape ferment le popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const q = search.trim().toLowerCase();
  const filtered = q ? brands.filter((b) => b.name.toLowerCase().includes(q)) : brands;

  const triggerLabel =
    selected.size === 0
      ? placeholder
      : selected.size === 1
        ? Array.from(selected)[0]
        : `${selected.size} marques sélectionnées`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-lg border px-3 text-left text-xs transition-colors",
          selected.size > 0
            ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent)] font-semibold"
            : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40",
        )}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {/* Recherche */}
          <div className="border-b border-[var(--border)]/60 p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une marque…"
              autoFocus
              className="h-8 w-full rounded-md border border-[var(--border)]/60 bg-transparent px-2 text-[11px] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          {/* Liste */}
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] italic text-[var(--muted-foreground)]">
                Aucune marque trouvée
              </p>
            ) : (
              filtered.map((b) => {
                const checked = selected.has(b.name);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onToggle(b.name)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--secondary)]/60"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        checked
                          ? "border-[var(--accent)] bg-[var(--accent)]"
                          : "border-[var(--border)]",
                      )}
                    >
                      {/* arkyo-server: habillage Strata */}
                      {checked && <Check className="h-3 w-3 text-[var(--accent-foreground)]" strokeWidth={3} />}
                    </span>
                    <span
                      className={cn(
                        "flex-1 truncate",
                        checked ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
                      )}
                    >
                      {b.name}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer : compteur + reset */}
          {selected.size > 0 && (
            <div className="flex items-center justify-between border-t border-[var(--border)]/60 px-2 py-1.5">
              <span className="text-[10px] text-[var(--muted-foreground)]">
                {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}
              </span>
              <button
                type="button"
                onClick={onClear}
                className="text-[10px] font-semibold text-[var(--accent)] hover:underline"
              >
                Tout désélectionner
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
