/** Onglets segmentés soulignés (`.seg-tabs` de la maquette), partagés par les docks et la topbar projet. */
export const SEG_TAB =
  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[12.5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
export const SEG_TAB_ON = "border-[var(--accent)] text-[var(--foreground)]";
export const SEG_TAB_OFF = "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]";
export const SEG_BAR =
  "flex min-h-[38px] flex-none items-end gap-0.5 overflow-x-auto border-b border-[var(--border)] [scrollbar-width:none]";

/** Onglets en pastille et bouton d'icône des topbars Strata (générale et projet). */
export const TOPBAR_TAB =
  "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-[5px] text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
export const TOPBAR_TAB_ON = "bg-[var(--muted)] text-[var(--foreground)]";
export const TOPBAR_TAB_OFF = "text-[var(--muted-foreground)] hover:text-[var(--foreground)]";
export const TOPBAR_ICON_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]";
