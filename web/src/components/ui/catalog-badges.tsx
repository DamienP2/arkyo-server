import type { CatalogItemFlags } from "@/lib/services/catalog-display";
import { cn } from "@/lib/utils";

interface CatalogBadgesProps {
  flags: CatalogItemFlags;
  className?: string;
}

export function CatalogBadges({ flags, className }: CatalogBadgesProps) {
  if (!flags.isGhost && !flags.isNew && !flags.isModified) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {flags.isNew && (
        <span className="inline-flex items-center rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
          Nouveau
        </span>
      )}
      {flags.isGhost && flags.ghostPlanLabel && (
        <span className="inline-flex items-center rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
          {flags.ghostPlanLabel}
        </span>
      )}
      {flags.isModified && (
        <span
          className="inline-flex size-1.5 items-center rounded-full bg-amber-400"
          title="Personnalise"
        />
      )}
    </div>
  );
}

export function catalogItemClassName(flags: CatalogItemFlags): string {
  if (flags.isGhost) return "opacity-40 pointer-events-none select-none";
  return "";
}
