"use client";

import { cn } from "@/lib/utils";
import type { TabId } from "./types";

// Helpers UI partagés — calqués sur le pattern de `equipment/[id]/_editor/shared.tsx`.

export const inputCls =
  "flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50 disabled:cursor-not-allowed";

// ── Field wrapper ─────────────────────────────────────────────────────────

export function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
        {label}
        {/* arkyo-server: habillage Strata */}
        {required && <span className="ml-0.5 text-[var(--danger-text)]">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────

export function Section({
  title,
  icon,
  color,
  variant = "card",
  trailing,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  color?: string;
  variant?: "card" | "plain";
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const accent = color ?? "var(--muted-foreground)";

  if (variant === "plain") {
    return (
      <section className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2 border-b border-[var(--border)]/60 pb-1.5">
          {icon}
          <span
            className="text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: accent }}
          >
            {title}
          </span>
          {trailing && <div className="ml-auto">{trailing}</div>}
        </div>
        <div>{children}</div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "space-y-3 rounded-xl border border-[var(--border)]/60 bg-transparent p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span
          className="text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: accent }}
        >
          {title}
        </span>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>
      <div>{children}</div>
    </section>
  );
}

// ── TabBar (style pill identique à equipment-editor) ─────────────────────

export type TabDescriptor = {
  id: TabId;
  label: string;
};

export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDescriptor[];
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border)]/60 p-0.5">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-all",
              isActive
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
