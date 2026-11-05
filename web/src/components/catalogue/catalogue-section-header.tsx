"use client";

/**
 * CatalogueSectionHeader — bande de section colorée (dot + label uppercase
 * + ligne diluée + count) utilisée par TOUS les panels du catalogue
 * (supervisor + tenant).
 *
 * Présentation pure — aucun état, aucun callback CRUD. Si le supervisor
 * change le rendu ici, les 4 panels tenant héritent automatiquement.
 */

type Props = {
  label: string;
  color: string;
  count: number;
};

export function CatalogueSectionHeader({ label, color, count }: Props) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <div
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <h3 className="text-xs font-bold tracking-widest uppercase" style={{ color }}>
        {label}
      </h3>
      <div className="h-px flex-1" style={{ backgroundColor: `${color}30` }} />
      <span className="text-xs text-[var(--muted-foreground)]">{count}</span>
    </div>
  );
}
