"use client";

/**
 * Pièces communes des pages Gérer (interface Strata v2, maquette `.page-h`,
 * `.box`, `.sev`, `.seg-tabs`, `.kv`) : en-tête de page, boîte titrée,
 * pastille de gravité, onglets, liste terme / valeur. Couleurs d'interface :
 * variables de `globals.css` seulement.
 */

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SEG_TAB, SEG_TAB_OFF, SEG_TAB_ON } from "../shell/seg-tabs";

export const SECTION_LABEL = "text-[10.5px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase";

/** Bouton secondaire de taille réduite (maquette `.btn.small`). */
export const SMALL_BTN =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 text-[12px] font-medium text-[var(--foreground)] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--card)]";

/** Bouton principal de taille réduite (maquette `.btn.small.primary`) : l'action d'enregistrement. */
export const PRIMARY_SMALL_BTN =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-[12px] font-semibold text-[var(--accent-foreground)] transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";

/** Bouton « Ajouter » : toujours en pointillés (règle d'arkyo), jamais plein. */
export const ADD_BTN =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border-2 border-dashed border-[var(--border-strong)] px-3 text-[12.5px] font-medium text-[var(--foreground)] transition-colors outline-none hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export type Tone = "danger" | "warn" | "info" | "ok" | "neutral";

const TONE: Record<Tone, string> = {
  danger: "var(--danger)",
  warn: "var(--warning)",
  info: "var(--text-tertiary)",
  ok: "var(--success)",
  neutral: "var(--border-strong)",
};

const TONE_LABEL: Record<Tone, string> = {
  danger: "Erreur",
  warn: "À traiter",
  info: "À compléter",
  ok: "Conforme",
  neutral: "",
};

/** Pastille de gravité (8 px), nommée pour les lecteurs d'écran. */
export function Sev({ tone }: { tone: Tone }) {
  return (
    <span
      role={TONE_LABEL[tone] ? "img" : undefined}
      aria-label={TONE_LABEL[tone] || undefined}
      aria-hidden={TONE_LABEL[tone] ? undefined : true}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: TONE[tone] }}
    />
  );
}

/** Pastille de texte (maquette `.pill`). */
export function Pill({ tone, children }: { tone: "warn" | "danger" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap",
        tone === "warn" && "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning-text)]",
        tone === "danger" && "bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger-text)]",
        tone === "neutral" && "bg-[var(--muted)] text-[var(--muted-foreground)]",
      )}
    >
      {children}
    </span>
  );
}

export function PageHead({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Sous l'en-tête : onglets. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-none flex-col gap-3 px-6 pt-[18px]">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {eyebrow && <span className={SECTION_LABEL}>{eyebrow}</span>}
          <h1 className="m-0 truncate text-[20px] font-bold tracking-[-0.01em] text-[var(--foreground)]">{title}</h1>
          {subtitle && <p className="m-0 mt-0.5 text-[13px] text-[var(--muted-foreground)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Box({
  title,
  icon,
  aside,
  children,
  className,
  flush = false,
}: {
  title: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Contenu sans marge (listes de lignes). */
  flush?: boolean;
}) {
  return (
    <section className={cn("rounded-[10px] border border-[var(--border)] bg-[var(--card)]", className)}>
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-[11px]">
        {icon && <span className="text-[var(--muted-foreground)] [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        <h3 className="m-0 flex-1 text-[13px] font-bold text-[var(--foreground)]">{title}</h3>
        {aside}
      </header>
      <div className={flush ? "" : "flex flex-col gap-2.5 px-3.5 py-3"}>{children}</div>
    </section>
  );
}

/** Liste terme / valeur (maquette `.kv`). */
export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-[7px] text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--muted-foreground)]">{k}</dt>
          <dd className="m-0 min-w-0 break-words text-[var(--foreground)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export type TabDef<T extends string> = { id: T; label: string; count?: number };

/** Onglets segmentés soulignés ; le panneau est rendu par l'appelant (`TabPanel`). */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
}: {
  tabs: readonly TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  idBase: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="-mx-0.5 flex items-end gap-0.5 border-b border-[var(--border)]">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.id}`}
          aria-selected={t.id === value}
          aria-controls={`${idBase}-panel`}
          onClick={() => onChange(t.id)}
          className={cn(SEG_TAB, t.id === value ? SEG_TAB_ON : SEG_TAB_OFF)}
        >
          {t.label}
          {t.count != null && (
            <span className="font-mono text-[11px] text-[var(--text-tertiary)] tabular-nums">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function useTabIds() {
  return useId().replace(/:/g, "");
}

export function TabPanel({ idBase, value, children, className }: { idBase: string; value: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}
