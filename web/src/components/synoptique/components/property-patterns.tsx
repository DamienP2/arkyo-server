"use client";

import { cn } from "@/lib/utils";

/**
 * 3 patterns de design pour les panneaux de propriétés :
 *
 * 1. InfoCard — bordure border/60, fond transparent, icône + label uppercase + valeur mono bold
 * 2. ActionSwitch — label uppercase + toggle à droite, fond card avec bordure
 * 3. ActionButton — icône + texte, pas de bordure, hover muted
 */

// ── Pattern 1 : InfoCard ────────────────────────────────────────────────────

export function InfoCard({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border/60 flex items-center gap-2 rounded-md border bg-transparent p-2.5",
        className,
      )}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <div>
        <div className="text-muted-foreground text-[9px] tracking-[0.1em] uppercase">{label}</div>
        <div className="text-sm font-semibold" style={{ fontFamily: "var(--font-mono)" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

// ── Pattern 2 : ActionSwitch ────────────────────────────────────────────────

export function ActionSwitch({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "border-border bg-card hover:bg-muted/40 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
        className,
      )}
    >
      <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
        {label}
      </span>
      <div
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-[var(--accent)]" : "bg-[var(--border)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0",
          )}
        />
      </div>
    </button>
  );
}

// ── Pattern 3 : ActionButton ────────────────────────────────────────────────

export function ActionButton({
  icon,
  label,
  onClick,
  danger = false,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
        danger
          ? "text-destructive hover:bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)]"
          : "text-foreground hover:bg-muted",
        className,
      )}
    >
      <span className={cn("shrink-0", danger ? "text-destructive" : "text-muted-foreground")}>
        {icon}
      </span>
      {label}
    </button>
  );
}

// ── Section title ───────────────────────────────────────────────────────────

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
      {children}
    </div>
  );
}
