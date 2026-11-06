"use client";

import { X } from "@/components/ui/icons";

const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "Navigation",
    rows: [
      { keys: ["H"], label: "Outil main / pan" },
      { keys: ["S"], label: "Outil sélection (rubber-band)" },
      { keys: ["M"], label: "Outil déplacement" },
      { keys: ["Espace"], label: "Pan temporaire (maintenir)" },
      { keys: ["Molette"], label: "Zoom au curseur" },
    ],
  },
  {
    title: "Création",
    rows: [
      { keys: ["C"], label: "Outil câble" },
      { keys: ["A"], label: "Outil adaptateur" },
      { keys: ["T"], label: "Outil label / texte" },
      { keys: ["R"], label: "Outil zone" },
      { keys: ["E"], label: "Outil gomme / décâblage" },
    ],
  },
  {
    title: "Câblage (mode câble)",
    rows: [
      { keys: ["Cliquer un port", "Cliquer un port compatible"], label: "Tracer un câble" },
      { keys: ["Entrée"], label: "Valider une sélection multi-source" },
      { keys: ["Échap"], label: "Annuler le tracé en cours" },
    ],
  },
  {
    title: "Édition",
    rows: [
      { keys: ["Suppr", "Retour"], label: "Supprimer la sélection" },
      { keys: ["⌘/Ctrl", "Z"], label: "Annuler (undo)" },
      { keys: ["⌘/Ctrl", "⇧", "Z"], label: "Rétablir (redo)" },
      { keys: ["Échap"], label: "Désélectionner / fermer" },
      { keys: ["Double-clic"], label: "Renommer (zones, textes)" },
    ],
  },
  {
    title: "Calques",
    rows: [
      { keys: ["Clic"], label: "Sélection simple" },
      { keys: ["⌘/Ctrl", "Clic"], label: "Ajouter / retirer de la multi-sélection" },
      { keys: ["⇧", "Clic"], label: "Étendre la sélection (range)" },
    ],
  },
  {
    title: "Règles & repères",
    rows: [
      { keys: ["Glisser depuis règle"], label: "Poser un repère" },
      { keys: ["Clic droit sur repère"], label: "Supprimer le repère" },
      { keys: ["Glisser vers règle"], label: "Supprimer le repère" },
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

export function SynopticShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      // z-[100] pour passer au-dessus du chrome de l'éditeur (topbars,
      // toolbars, panneaux latéraux).
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="border-border bg-card max-h-[85vh] w-[760px] max-w-[92vw] overflow-auto rounded-xl border shadow-2xl"
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
