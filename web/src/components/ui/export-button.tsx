"use client";

import { Download } from "@/components/ui/icons";
import { useCurrentPermissions } from "@/lib/permissions/permissions-context";
import { cn } from "@/lib/utils";

/**
 * Bouton d'export CSV — link `<a>` natif vers un endpoint qui retourne un
 * fichier avec `Content-Disposition: attachment`. Le navigateur déclenche le
 * téléchargement automatiquement.
 *
 * Usage :
 *   <ExportButton href="/api/supervisor/tenants/export" permission="spaces.view">
 *     Exporter CSV
 *   </ExportButton>
 *
 * Si la permission est manquante (et `mode="hide"` par défaut), le bouton n'est
 * pas rendu. Pendant le chargement initial des permissions, le bouton est masqué.
 */
export function ExportButton({
  href,
  permission,
  mode = "hide",
  className,
  children,
}: {
  href: string;
  permission: string | ReadonlyArray<string>;
  mode?: "hide" | "disable";
  className?: string;
  children?: React.ReactNode;
}) {
  const { has, hasAny } = useCurrentPermissions();
  const allowed = Array.isArray(permission) ? hasAny(permission) : has(permission as string);

  if (!allowed && mode === "hide") return null;

  return (
    <a
      href={allowed ? href : undefined}
      // download = laisser le browser décider le filename via Content-Disposition
      // (sinon download="" force le filename de l'URL — moins flexible).
      download={allowed ? "" : undefined}
      title={allowed ? "Télécharger en CSV" : "Action réservée — permission requise"}
      aria-disabled={!allowed}
      className={cn(
        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors",
        allowed
          ? "text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
          : "pointer-events-none cursor-not-allowed text-[var(--muted-foreground)]/40",
        className,
      )}
      onClick={(e) => {
        if (!allowed) e.preventDefault();
      }}
    >
      <Download className="h-3 w-3" />
      {children ?? "Exporter"}
    </a>
  );
}
