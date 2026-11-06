"use client";
import type { ReactNode } from "react";

// ── Shared primitives for topbar components ──────────────────────────────────

export const segmentedContainerCls =
  "flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shrink-0";

export function segBtn(active: boolean) {
  return active
    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
    ? "rounded-md px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-strong)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] transition-all duration-200 ease-out active:scale-95"
    : "rounded-md px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-all duration-200 ease-out hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] active:scale-95";
}

// Mono variant (for U-heights / depths)
export function segBtnMono(active: boolean) {
  return active
    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
    ? "rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-strong)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] transition-all duration-200 ease-out active:scale-95"
    : "rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-all duration-200 ease-out hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] active:scale-95";
}

export const standaloneBtnCls =
  // arkyo-server: habillage Strata (texte d'accent au survol sur l'accent à 10 % : --accent-strong)
  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] text-muted-foreground transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:text-[var(--accent-strong)] active:scale-95";

// ── Group helpers ─────────────────────────────────────────────────────────────

export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted-foreground text-[9px] font-medium tracking-[0.15em] uppercase">
      {children}
    </span>
  );
}

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <GroupLabel>{label}</GroupLabel>
      {children}
    </div>
  );
}

export function GroupDivider() {
  return <span className="bg-border/60 h-5 w-px" />;
}
