"use client";

// Navigation de sous-onglets de Généralités — design strictement aligné sur
// `ConnectivityFaceTabs` : L-leg de raccord + container pill rounded-full +
// pills actifs en bg-card avec shadow.

import { cn } from "@/lib/utils";

export type SubTabDescriptor<T extends string> = {
  id: T;
  label: string;
};

export function SubTabBar<T extends string>({
  tabs,
  active,
  onChange,
  paddingLeft,
}: {
  tabs: ReadonlyArray<SubTabDescriptor<T>>;
  active: T;
  onChange: (id: T) => void;
  /** Position horizontale de l'L-leg, pour le centrer sous le tab principal
   *  parent. Mesuré dynamiquement par equipment-editor. */
  paddingLeft?: number | null;
}) {
  return (
    <div
      className="flex items-stretch"
      style={{
        paddingLeft: paddingLeft != null ? `${paddingLeft}px` : undefined,
        visibility: paddingLeft != null ? "visible" : "hidden",
      }}
    >
      <div className="h-9 w-4 rounded-bl-lg border-b border-l border-[var(--border)]" />
      <div className="mb-[-2px] ml-1.5 inline-flex items-center gap-0.5 self-end rounded-full bg-[var(--secondary)]/60 p-0.5">
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              data-subtab-key={t.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-all",
                isActive
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
