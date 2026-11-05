"use client";

import { cn } from "@/lib/utils";
import { TabId, TabErrors } from "./types";

export type TabDescriptor = {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function TabBar({
  tabs,
  active,
  onChange,
  errors,
}: {
  tabs: TabDescriptor[];
  active: TabId;
  onChange: (id: TabId) => void;
  errors: TabErrors;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full bg-[var(--secondary)]/60 p-0.5">
      {tabs.map((t) => {
        const isActive = t.id === active;
        const errorCount = errors[t.id] ?? 0;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            data-tab-key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-all",
              isActive
                ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
            {errorCount > 0 && (
              // arkyo-server: habillage Strata
              <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[9px] font-bold text-[var(--destructive-foreground)]">
                {errorCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
