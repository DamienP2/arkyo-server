"use client";

/**
 * Pièces du catalogue Strata v2 (liste + détail, maquette `#catalogue`) :
 * disposition liste / fiche, barre d'outils (recherche, filtres à pickers
 * modaux, bascules), liste paginée, ligne, en-tête et sections de la fiche,
 * barre des ports par famille. Couleurs d'interface : variables de
 * `globals.css` seulement ; couleurs métier (fonctions) inchangées.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { Chip } from "@/app/(app)/admin/_components/list-toolbar-helpers";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, Copy, Pencil, Plus, Search, Trash2, X } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { portFamilies, type CatalogueLookup } from "../catalogue-model";
import { ADD_BTN, SECTION_LABEL, SMALL_BTN } from "../manage/manage-ui";

/** Lignes rendues d'emblée ; la suite s'affiche à la demande (grands catalogues). */
export const LIST_PAGE = 300;

/** Liste à gauche, fiche à droite (collante, défilement propre). */
export function ListDetail({ toolbar, list, detail }: { toolbar: ReactNode; list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_minmax(420px,500px)]">
      <div className="flex min-w-0 flex-col gap-2.5">
        {toolbar}
        {list}
      </div>
      <section
        aria-label="Fiche"
        className="min-w-0 rounded-[10px] border border-[var(--border)] bg-[var(--card)] xl:sticky xl:top-4 xl:max-h-[calc(100vh-var(--topbar-height)-32px)] xl:overflow-y-auto"
      >
        {detail}
      </section>
    </div>
  );
}

/** Bouton « Nouveau … » : en pointillés (règle d'arkyo). */
export function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={ADD_BTN}>
      <Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export function Toolbar({ children, count }: { children: ReactNode; count: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {children}
      <span className="flex-1" />
      <span className="text-[12px] whitespace-nowrap text-[var(--muted-foreground)] tabular-nums">{count}</span>
    </div>
  );
}

/** « 2 fiches » ou « 1 fiche sur 2 ». */
export function countLabel(shown: number, total: number): string {
  const n = `${shown} fiche${shown > 1 ? "s" : ""}`;
  return shown === total ? n : `${n} sur ${total}`;
}

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="relative w-[240px] max-w-full">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-[30px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pr-2.5 pl-8 text-[12.5px] text-[var(--foreground)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--ring)] focus:outline-none"
      />
    </div>
  );
}

const CHIP =
  "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const CHIP_OFF =
  "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]";
const CHIP_ON = "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground)]";

/**
 * Filtre ouvert par un picker modal d'arkyo : `Fabricant ▾`, puis
 * `Fabricant : Sony` et une croix qui retire le filtre.
 */
export function FacetButton({
  label,
  value,
  onOpen,
  onClear,
}: {
  label: string;
  /** Valeur retenue (texte), `null` : pas de filtre. */
  value: string | null;
  onOpen: () => void;
  onClear: () => void;
}) {
  if (!value) {
    return (
      <button type="button" onClick={onOpen} className={cn(CHIP, CHIP_OFF)}>
        {label}
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md border", CHIP_ON)}>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex h-[28px] max-w-[220px] items-center gap-1 rounded-l-md pr-1 pl-2.5 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <span className="truncate">{`${label} : ${value}`}</span>
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Retirer le filtre ${label}`}
        className="inline-flex h-[28px] w-6 items-center justify-center rounded-r-md text-[var(--muted-foreground)] outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Bascule d'un filtre d'arkyo (ST 2110, Lumière, cas d'usage…). */
export function ToggleChip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={cn(CHIP, pressed ? CHIP_ON : CHIP_OFF)}>
      {label}
    </button>
  );
}

/** Choix exclusif (format), en boutons. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <span role="group" aria-label={label} className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded px-2 py-[3px] text-[12px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            o.id === value
              ? "bg-[var(--muted)] font-medium text-[var(--foreground)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * Liste des fiches : les `LIST_PAGE` premières, puis la suite à la demande
 * (un grand catalogue reste fluide). Le compte repart à zéro quand la liste
 * filtrée change (`resetKey`).
 */
export function PagedList<T>({
  label,
  items,
  resetKey,
  renderItem,
}: {
  label: string;
  items: readonly T[];
  resetKey: string;
  renderItem: (item: T) => ReactNode;
}) {
  const [paging, setPaging] = useState({ key: resetKey, limit: LIST_PAGE });
  const limit = paging.key === resetKey ? paging.limit : LIST_PAGE;
  const rest = items.length - limit;
  const next = Math.min(rest, LIST_PAGE);
  return (
    <div className="min-w-0 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card)]">
      <ul aria-label={label} className="m-0 list-none divide-y divide-[var(--border)] p-0">
        {items.slice(0, limit).map(renderItem)}
      </ul>
      {rest > 0 && (
        <div className="border-t border-[var(--border)] px-3.5 py-2">
          <button type="button" onClick={() => setPaging({ key: resetKey, limit: limit + LIST_PAGE })} className={SMALL_BTN}>
            {`Afficher les ${next} suivante${next > 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Coche d'une ligne (sélection multiple d'arkyo : Maj pour une plage). */
export type RowCheck = {
  checked: boolean;
  label: string;
  onClick: (id: string, ev: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
};

/**
 * Ligne de la liste : sélectionne la fiche ; à gauche, la coche de la
 * sélection multiple quand l'écriture est permise.
 */
export function ListRow({
  id,
  selected,
  onSelect,
  check,
  children,
}: {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  check?: RowCheck;
  children: ReactNode;
}) {
  return (
    <li className={cn("flex min-w-0 items-center", selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--muted)]")}>
      {check && (
        <input
          type="checkbox"
          checked={check.checked}
          readOnly
          aria-label={check.label}
          onClick={(e) => check.onClick(id, e)}
          className="ml-3.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
        />
      )}
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(id)}
        className="flex w-full min-w-0 items-center gap-3 px-3.5 py-2 text-left text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset"
      >
        {children}
      </button>
    </li>
  );
}

/** Barre de la sélection multiple : nombre, tout cocher, suppression en lot. */
export function SelectionBar({
  count,
  total,
  onSelectAll,
  onClear,
  onDelete,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Sélection"
      className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 text-[12.5px]"
    >
      <span className="font-medium text-[var(--foreground)]">{`${count} sélectionné${count > 1 ? "s" : ""}`}</span>
      {count < total && (
        <button type="button" onClick={onSelectAll} className={SMALL_BTN}>
          {`Tout sélectionner (${total})`}
        </button>
      )}
      <button type="button" onClick={onClear} className={SMALL_BTN}>
        Désélectionner
      </button>
      <span className="flex-1" />
      <button type="button" onClick={onDelete} className={cn(SMALL_BTN, "text-[var(--danger-text)]")}>
        <Trash2 className="h-3.5 w-3.5" />
        Supprimer la sélection
      </button>
    </div>
  );
}

/** Choix du tri : clé (menu) et sens (A→Z / Z→A). */
export function SortControl<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: K; label: string }[];
  value: { key: K; dir: "asc" | "desc" };
  onChange: (v: { key: K; dir: "asc" | "desc" }) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value.key) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <span className="relative inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(CHIP, CHIP_OFF)}
      >
        {`Tri : ${current.label}`}
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onChange({ key: value.key, dir: value.dir === "asc" ? "desc" : "asc" })}
        aria-label={value.dir === "asc" ? "Ordre croissant (A→Z)" : "Ordre décroissant (Z→A)"}
        className={cn(CHIP, CHIP_OFF, "px-2 font-mono text-[11.5px]")}
      >
        {value.dir === "asc" ? "A→Z" : "Z→A"}
      </button>
      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Trier par"
            className="absolute top-full left-0 z-50 mt-1 min-w-[170px] rounded-lg border border-[var(--border-strong)] bg-[var(--popover)] p-1 shadow-xl"
          >
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={o.id === value.key}
                onClick={() => {
                  onChange({ key: o.id, dir: value.dir });
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--muted)]",
                  o.id === value.key ? "bg-[var(--accent-soft)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/** « Réinitialiser les filtres » (barre d'outils et état « aucun résultat »). */
export function ResetFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(CHIP, CHIP_OFF)}>
      <X className="h-3.5 w-3.5" />
      Réinitialiser les filtres
    </button>
  );
}

/**
 * Fenêtre de filtre (modale) aux mots d'un filtre : les pickers de
 * l'éditeur d'arkyo portent les titres de l'éditeur (« Choisir une fonction
 * principale »…) sans moyen de les changer ; le contenu reprend les
 * composants du filtre d'arkyo (`BrandMultiSelect`, `Chip`).
 */
export function FilterDialog({
  open,
  onOpenChange,
  title,
  description,
  count,
  onClear,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-xl flex-col p-0" showClose={false}>
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-[var(--border)] px-5 py-4">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {description ?? "Plusieurs choix possibles : une fiche est gardée si elle correspond à l'un d'eux."}
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <button type="button" onClick={onClear} disabled={count === 0} className={SMALL_BTN}>
            Effacer
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className={SMALL_BTN}>
            {count > 0 ? `Appliquer (${count})` : "Fermer"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Choix multiples en pastilles (le `Chip` du filtre d'arkyo). */
export function ChipChoices({
  options,
  selected,
  onToggle,
  empty = "Aucun choix pour cette liste.",
}: {
  options: readonly { id: string; label: string; color?: string | null }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  empty?: string;
}) {
  if (options.length === 0) return <p className="m-0 text-[12.5px] text-[var(--muted-foreground)]">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip
          key={o.id}
          label={o.label}
          active={selected.includes(o.id)}
          onClick={() => onToggle(o.id)}
          color={o.color ?? undefined}
        />
      ))}
    </div>
  );
}

/** Nom et ligne secondaire d'une ligne de liste. */
export function RowTitle({ name, meta }: { name: string; meta?: string | null }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <strong className="truncate font-semibold text-[var(--foreground)]">{name}</strong>
      {meta ? <span className="truncate text-[11.5px] text-[var(--muted-foreground)]">{meta}</span> : null}
    </span>
  );
}

/** Valeur courte alignée à droite d'une ligne (U, W, stock…). */
export function RowFigure({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("shrink-0 font-mono text-[11.5px] whitespace-nowrap text-[var(--muted-foreground)] tabular-nums", className)}>
      {children}
    </span>
  );
}

export function DetailHead({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string | null;
  title: string;
  subtitle?: string | null;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1 border-b border-[var(--border)] px-[18px] pt-4 pb-3">
      {eyebrow ? <span className={SECTION_LABEL}>{eyebrow}</span> : null}
      <h2 className="m-0 text-[17px] leading-snug font-bold text-[var(--foreground)]">{title}</h2>
      {subtitle ? <span className="text-[12.5px] text-[var(--muted-foreground)]">{subtitle}</span> : null}
      {actions ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function DetailBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 px-[18px] pt-3.5 pb-[18px]">{children}</div>;
}

export function DetailSection({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={SECTION_LABEL}>{label}</span>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </div>
  );
}

/** « Modifier » : l'éditeur existant de la fiche. */
export function EditLink({ href }: { href: string }) {
  return (
    <Link href={href} className={SMALL_BTN}>
      <Pencil className="h-3.5 w-3.5" />
      Modifier
    </Link>
  );
}

/** Actions de la fiche : Modifier, Dupliquer, Supprimer (écriture seulement). */
export function DetailActions({
  href,
  onDuplicate,
  onDelete,
}: {
  href: string;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <EditLink href={href} />
      <button type="button" onClick={onDuplicate} className={SMALL_BTN}>
        <Copy className="h-3.5 w-3.5" />
        Dupliquer
      </button>
      <button type="button" onClick={onDelete} className={cn(SMALL_BTN, "text-[var(--danger-text)]")}>
        <Trash2 className="h-3.5 w-3.5" />
        Supprimer
      </button>
    </>
  );
}

/** Puits sombre des dessins de face (comme le bandeau des faces de l'éditeur). */
export function FaceWell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded border border-[var(--border)] bg-[var(--strata-face-well)] p-2.5", className)}>{children}</div>
  );
}

/** Puits clair des dessins (câble, adaptateur, schéma). */
export function DrawingWell({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--canvas-bg)] p-2.5">{children}</div>;
}

/** Barre fine des ports par famille de signal (couleurs métier des fonctions). */
export function FamilyBar({
  connectors,
  lookup,
  className,
}: {
  connectors: readonly ConnectorEntry[];
  lookup: CatalogueLookup | null;
  className?: string;
}) {
  const families = portFamilies(connectors, lookup);
  const total = families.reduce((a, f) => a + f.count, 0);
  if (total === 0) return null;
  return (
    <div aria-hidden className={cn("flex h-1.5 overflow-hidden rounded-[2px] bg-[var(--muted)]", className)}>
      {families.map((f) => (
        <i
          key={f.key}
          data-family={f.key}
          title={`${f.label} · ${f.count} port${f.count > 1 ? "s" : ""}`}
          className="block h-full"
          style={{ width: `${Number(((f.count / total) * 100).toFixed(2))}%`, background: f.color }}
        />
      ))}
    </div>
  );
}

/** Repère carré de la couleur métier d'un signal ou d'une fonction. */
export function ColorMark({ color }: { color: string | null | undefined }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 align-middle"
      style={{ background: color ?? "var(--text-tertiary)" }}
    />
  );
}

/** Texte « Oui » / « Non ». */
export const yesNo = (b: boolean | null | undefined) => (b ? "Oui" : "Non");

/** Liste « a, b, c » ou `—`. */
export const listOrDash = (xs: readonly (string | null | undefined)[]) => {
  const s = xs.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return s.length ? s.join(", ") : "—";
};
