import { cn } from "@/lib/utils";

/**
 * Skeleton de base — bloc gris clair avec pulse animation.
 *
 * Usage :
 *   <Skeleton className="h-4 w-32" />
 *   <Skeleton className="h-10 w-10 rounded-full" />
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[var(--secondary)]/60", className)}
      aria-hidden="true"
    />
  );
}

// ── Patterns prêts à l'emploi ───────────────────────────────────────────────

/**
 * Skeleton pour une KPI card du dashboard (icône + label + chiffre).
 */
export function KpiSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <Skeleton className="h-9 w-9 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-12" />
      </div>
    </div>
  );
}

/**
 * Skeleton pour une ligne de liste (avatar + 2 lignes texte + meta droite).
 * Utilisée pour les listings tenants/users/activité.
 */
export function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      <Skeleton className="h-3 w-16 shrink-0" />
    </div>
  );
}

/**
 * Skeleton pour une carte (grid view) avec en-tête + meta + actions.
 */
export function CardSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </div>
      <div className="flex gap-2 border-t border-[var(--border)]/40 pt-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
    </div>
  );
}

/**
 * Skeleton pour un graph (barres pseudo-aléatoires).
 * Hauteurs déterministes pour éviter les warnings d'hydratation SSR.
 */
export function ChartSkeleton({ bars = 12, className }: { bars?: number; className?: string }) {
  return (
    <div className={cn("flex h-[180px] items-end gap-1", className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t-md bg-[var(--secondary)]/60"
          style={{ height: `${30 + ((i * 47) % 65)}%` }}
        />
      ))}
    </div>
  );
}
