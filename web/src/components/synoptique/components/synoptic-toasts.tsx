"use client";

import { cn } from "@/lib/utils";

type Toast = { id: number; lines: string[]; type: "warn" | "error" | "info" | "success" };

type SynopticToastsProps = {
  toasts: Toast[];
};

export function SynopticToasts({ toasts }: SynopticToastsProps) {
  return (
    <div
      className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 flex-col gap-2"
      style={{ zIndex: 30 }}
    >
      {toasts.map((t) => {
        // arkyo-server: habillage Strata (erreur, succès, info, alerte : --danger, --success, --accent, --warning)
        const colorClass =
          t.type === "error"
            ? "border-[var(--danger)]/40 text-[var(--danger-text)]"
            : t.type === "success"
              ? "border-[var(--success)]/40 text-[var(--success-text)]"
              : t.type === "info"
                ? "border-[var(--accent)]/40 text-[var(--accent)]"
                : "border-[var(--warning)]/40 text-[var(--warning-text)]";
        return (
          <div
            key={t.id}
            className={cn("flex flex-col gap-0.5 rounded-lg border px-3 py-2 shadow", colorClass)}
            style={{ background: "var(--surface)" }}
          >
            {t.lines.map((line, i) => (
              <span
                key={i}
                className={cn("text-[11px]", i === 0 ? "font-semibold" : "font-normal opacity-80")}
              >
                {line}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
