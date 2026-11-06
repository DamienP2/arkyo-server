"use client";

import {
  X,
  MapPin,
  Server,
  Boxes,
  Cable,
  LayoutPanelTop,
  Wrench,
  Download,
} from "@/components/ui/icons";

const SECTIONS: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
}[] = [
  {
    icon: MapPin,
    title: "Emplacements",
    body: (
      <>
        Un <b>emplacement</b> (régie, nodal, plateau, car…) regroupe des contenants et des
        équipements libres. L&apos;inventaire affiche un emplacement à la fois — le sélecteur de la
        sous-topbar change de fiche. Les équipements sans contenant vivent dans la section
        « Équipements libres » de la fiche.
      </>
    ),
  },
  {
    icon: Server,
    title: "Contenants",
    body: (
      <>
        Ajoutez des <b>contenants</b> (racks 19″, flight-cases, pelicases, casquettes…) dans un
        emplacement. Chaque contenant est une carte repliable : son en-tête ouvre ses
        caractéristiques, son corps liste son matériel.
      </>
    ),
  },
  {
    icon: Boxes,
    title: "Équipements",
    body: (
      <>
        {/* arkyo-server: mention « (catalogue Arkyo + items personnels) » retirée (catalogue unique) */}
        L'outil <b>Équipements</b> ouvre le catalogue.
        Glissez un équipement sur une card de contenant pour l'ajouter à son <b>BOM</b>. Le
        placement physique (slot U) se fait depuis l'onglet Rack.
      </>
    ),
  },
  {
    icon: Cable,
    title: "Adaptateurs",
    body: (
      <>
        Les <b>adaptateurs</b> (genres, BNC↔RJ45…) sont ajoutés au BOM du contenant comme les
        équipements. Ils apparaissent dans le synoptique pour assurer l'interface entre deux ports
        incompatibles.
      </>
    ),
  },
  {
    icon: LayoutPanelTop,
    title: "Panels",
    body: (
      <>
        Un <b>panel</b> est un module 1U/2U personnalisé (patch BNC, XLR, RJ45…). Créez-en depuis
        l'onglet dédié, puis glissez-le sur un contenant pour le rendre disponible dans son BOM.
      </>
    ),
  },
  {
    icon: Wrench,
    title: "Accessoires",
    body: (
      <>
        Les <b>accessoires</b> (étagères, plaques, tiroirs, etc.) sont des items rackables non
        connectés au câblage. Ajoutez-les via leur outil dédié, puis placez-les en slot U depuis
        l'onglet Rack.
      </>
    ),
  },
  {
    icon: Download,
    title: "Exports",
    body: (
      <>
        Le bouton <b>Exporter</b> du panneau droit produit le rendu PDF (avec un modèle défini en
        Administration › Impressions) ou une image PNG/JPEG de la vue — pratique pour partager un
        état du projet.
      </>
    ),
  },
];

export function InventaireHelpModal({
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
        className="border-border bg-card max-h-[85vh] w-[820px] max-w-[92vw] overflow-auto rounded-xl border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border bg-card/95 sticky top-0 z-10 flex items-center justify-between border-b px-5 py-3 backdrop-blur">
          <h2 className="text-foreground text-sm font-semibold">Aide — Inventaire</h2>
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
          Ouvrez la modale Raccourcis clavier pour voir tous les raccourcis disponibles.
        </div>
      </div>
    </div>
  );
}
