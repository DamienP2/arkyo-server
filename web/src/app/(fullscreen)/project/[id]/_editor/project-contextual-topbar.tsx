"use client";

import { Check, Loader2, X } from "@/components/ui/icons";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Sous-topbar (contextualTopbar) du mode édition projet.
 *
 * Pattern aligné sur le rack-editor (`contextual-topbar.tsx`) :
 *  - Liseré accent fin en haut
 *  - Label tool actif + shortcut (kbd) à gauche, séparateur, puis le contenu
 *    rendu par le slot `leftSlot` (filtres, segments, etc.)
 *  - Badge de statut sauvegarde à droite (saving / saved / error) — coloré.
 *
 * Note : le bouton "Fermer édition" est en haut-droite de la topbar globale.
 */
export function ProjectContextualTopbar({
  saveStatus = "idle",
  toolLabel,
  toolShortcut,
  leftSlot,
  rightSlot,
}: {
  saveStatus?: SaveStatus;
  /** Label du tool actif (ex. "Contenants"). Si absent : message italique. */
  toolLabel?: string;
  /** Raccourci clavier du tool (ex. "C"). Affiché en kbd à côté du label. */
  toolShortcut?: string;
  leftSlot?: React.ReactNode;
  /**
   * Slot à droite (avant le badge de sauvegarde). Utilisé par exemple par le
   * tab Synoptique pour afficher un menu contextuel d'options par outil
   * (style/couleur câble, taille label, adaptateurs récents, etc.).
   */
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="relative flex h-full items-center gap-3 px-4 text-xs">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[color-mix(in_srgb,var(--accent)_28%,transparent)]"
      />

      {toolLabel ? (
        <div className="animate-fade-in flex min-w-0 flex-1 items-center gap-3">
          <div className="border-border flex shrink-0 items-center gap-2 border-r pr-3">
            {toolShortcut && (
              <kbd
                // arkyo-server: habillage Strata (touche inversée selon le thème : fond --foreground, texte --background)
                className="inline-flex items-center rounded-md bg-[var(--foreground)] px-2 py-0.5 text-[10px] font-semibold text-[var(--background)] shadow-[0_1px_2px_rgba(0,0,0,0.15),inset_0_-1px_0_rgba(255,255,255,0.1)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {toolShortcut}
              </kbd>
            )}
            <span className="text-foreground text-[13px] font-semibold">
              {toolLabel}
            </span>
          </div>
          <div className="min-w-0 flex-1">{leftSlot}</div>
        </div>
      ) : (
        <div className="min-w-0 flex-1" />
      )}

      {rightSlot ? (
        <div className="border-border flex shrink-0 items-center gap-2 border-l pl-3">
          {rightSlot}
        </div>
      ) : null}

      <SaveStatusBadge status={saveStatus} />
    </div>
  );
}

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--secondary)]/60 px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Sauvegarde…
      </span>
    );
  }
  if (status === "saved") {
    return (
      // arkyo-server: habillage Strata (succès : --success, texte en --success-text)
      <span className="animate-fade-in inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--success)]/15 px-2 py-1 text-[11px] font-medium text-[var(--success-text)]">
        <Check className="h-3 w-3" strokeWidth={2.5} />
        Enregistré
      </span>
    );
  }
  // error
  return (
    // arkyo-server: habillage Strata (échec : --danger, texte en --danger-text)
    <span className="animate-fade-in inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--danger)]/15 px-2 py-1 text-[11px] font-medium text-[var(--danger-text)]">
      <X className="h-3 w-3" strokeWidth={2.5} />
      Échec
    </span>
  );
}
