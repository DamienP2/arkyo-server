"use client";

import { X } from "@/components/ui/icons";

const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "Outils",
    rows: [
      { keys: ["E"], label: "Équipements" },
      { keys: ["A"], label: "Adaptateurs" },
      { keys: ["P"], label: "Panels" },
      { keys: ["X"], label: "Accessoires" },
      { keys: ["Échap"], label: "Fermer le side panel" },
    ],
  },
  {
    title: "Navigation",
    rows: [
      { keys: ["Molette"], label: "Défilement de la fiche" },
      { keys: ["Chevron"], label: "Replier / déplier un contenant" },
      { keys: ["Sélecteur"], label: "Changer d'emplacement" },
    ],
  },
  {
    title: "Sélection",
    rows: [
      { keys: ["Clic sur l'en-tête"], label: "Propriétés du contenant" },
      { keys: ["Clic sur un slot vide"], label: "Installer un composant" },
    ],
  },
  {
    title: "BOM (catalogue → contenant)",
    rows: [
      { keys: ["Glisser un item"], label: "Ajouter au BOM du contenant cible" },
      { keys: ["Glisser sur card"], label: "Ouvre la modale quantité" },
      {
        keys: ["Glisser sur « Équipements libres »"],
        label: "Ajouter en équipement libre du lieu",
      },
      { keys: ["Glisser sur un slot"], label: "Installer un composant" },
    ],
  },
];

function KeyBadge({ k }: { k: string }) {
  const isPhrase = k.length > 4 && k.toLowerCase() !== "espace";
  return (
    <kbd
      className={`border-border bg-muted inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] ${
        isPhrase ? "text-muted-foreground font-normal italic" : "font-semibold"
      }`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {k}
    </kbd>
  );
}

export function InventaireShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="border-border bg-card max-h-[85vh] w-[680px] max-w-[92vw] overflow-auto rounded-xl border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border bg-card/95 sticky top-0 z-10 flex items-center justify-between border-b px-5 py-3 backdrop-blur">
          <h2 className="text-foreground text-sm font-semibold">Raccourcis clavier</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer les raccourcis"
            title="Fermer"
            className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 p-5 md:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="text-muted-foreground mb-2 text-[10px] tracking-[0.12em] uppercase">
                {g.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {g.rows.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-foreground">{r.label}</span>
                    <span className="flex flex-shrink-0 items-center gap-1">
                      {r.keys.map((k, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && <span className="text-muted-foreground text-[10px]">+</span>}
                          <KeyBadge k={k} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
