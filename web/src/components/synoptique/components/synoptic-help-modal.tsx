"use client";

import {
  X,
  Cable,
  Plug,
  Square,
  Type,
  Layers,
  Lock,
  Eye,
  Ruler,
  BookmarkCheck,
  Grid3x3,
  Magnet,
} from "@/components/ui/icons";

const SECTIONS: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
}[] = [
  {
    icon: Cable,
    title: "Câblage",
    body: (
      <>
        Sélectionnez l'outil <b>Câble</b> puis cliquez sur un premier port compatible et un second
        pour tracer un câble. Le <b>mode multi</b> permet de poser un range de câbles parallèles
        entre deux équipements. Le <b>mode multipoint</b>
        ajoute des waypoints orthogonaux ou arrondis.
      </>
    ),
  },
  {
    icon: Plug,
    title: "Adaptateurs",
    body: (
      <>
        Un adaptateur sert d'intermédiaire entre deux ports incompatibles. Sélectionnez{" "}
        <b>Adaptateur</b>, choisissez un modèle dans la topbar, puis cliquez sur un port ou sur le
        canvas. Les adaptateurs attachés suivent leur équipement.
      </>
    ),
  },
  {
    icon: Square,
    title: "Zones & textes",
    body: (
      <>
        Tracez une <b>Zone</b> pour regrouper visuellement des équipements (régie vidéo, rack
        audio…). Le <b>Texte</b>
        libre vous permet d'annoter le schéma. Double-cliquez sur un item dans le panneau Calques
        pour le renommer.
      </>
    ),
  },
  {
    icon: Grid3x3,
    title: "Grille & snap",
    body: (
      <>
        La <b>grille</b> suit le pas des connecteurs d'équipement (PORT_H). Activez le <b>snap</b>{" "}
        pour aligner automatiquement nodes, câbles et annotations.
      </>
    ),
  },
  {
    icon: Ruler,
    title: "Règles & repères",
    body: (
      <>
        Les règles sont toujours affichées. Glissez depuis une règle pour <b>poser un repère</b>.
        Cliquez sur un repère pour le sélectionner, glissez pour le déplacer, clic droit pour le
        supprimer.
      </>
    ),
  },
  {
    icon: BookmarkCheck,
    title: "Guides (repères)",
    body: (
      <>
        Changez leur <b>couleur avant la pose</b> dans le panneau général. Une fois posé,
        sélectionnez-le et changez sa couleur ou sa position via le panneau de propriétés.
      </>
    ),
  },
  {
    icon: Layers,
    title: "Calques",
    body: (
      <>
        Trois modes : <b>Type</b> (équipements, panels, câbles…), <b>Catégorie</b> (vidéo, audio…),{" "}
        <b>Signal</b>
        (uniquement les câbles groupés par signal). Filtrez rapidement en tapant dans la barre de
        recherche.
      </>
    ),
  },
  {
    icon: Eye,
    title: "Visibilité & verrouillage",
    body: (
      <>
        L'<b>œil</b> masque un élément sur le canvas sans le supprimer. Le <b>cadenas</b> empêche
        déplacement, suppression et modification — la sélection reste possible pour consulter les
        propriétés. État persisté par rack.
      </>
    ),
  },
  {
    icon: Magnet,
    title: "Numérotation câbles",
    body: (
      <>
        Utilisez la <b>Renumérotation auto</b> depuis la barre de droite pour générer des labels de
        type
        <code className="bg-muted mx-1 rounded px-1 text-[10px]">ZONE-RACK-TYPE01</code>. La
        numérotation manuelle permet de préfixer/suffixer à votre convenance.
      </>
    ),
  },
];

export function SynopticHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      // z-[100] : même raison que SynopticShortcutsModal — passer au-dessus
      // du chrome de l'éditeur.
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="border-border bg-card max-h-[85vh] w-[840px] max-w-[92vw] overflow-auto rounded-xl border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border bg-card/95 sticky top-0 z-10 flex items-center justify-between border-b px-5 py-3 backdrop-blur">
          <h2 className="text-foreground text-sm font-semibold">Aide — éditeur Synoptique</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'aide"
            title="Fermer"
            className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <section
                key={s.title}
                className="border-border bg-background/60 rounded-lg border p-3"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--accent)]" />
                  <h3 className="text-foreground text-[12px] font-semibold">{s.title}</h3>
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">{s.body}</p>
              </section>
            );
          })}
        </div>
        <div className="border-border text-muted-foreground bg-background/40 border-t px-5 py-3 text-[10px] italic">
          Ouvrez les raccourcis clavier depuis le panneau général pour voir tous les raccourcis
          disponibles.
        </div>
      </div>
    </div>
  );
}
