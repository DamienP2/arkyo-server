"use client";

import { useRef, useState, useLayoutEffect } from "react";

type Props = {
  toolbar?: React.ReactNode;
  addButton?: React.ReactNode;
  children: React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: boolean;
};

/** Hauteur de l'overhang des onglets pill de la topbar (`translate-y-1/2`
 *  dans topbar.tsx) — on compense pour que la toolbar ne passe pas dessous.
 *  Calibré au-dessus de la hauteur réelle (~16-20px) pour laisser un
 *  espace visuel net entre les onglets pill et la toolbar de la page. */
const TOPBAR_TABS_OVERHANG = 40;

/**
 * Layout standard pour les pages d'admin/supervisor avec un header de page
 * (toolbar + bouton inline) qui reste **fixe au scroll**, et un contenu
 * en dessous qui scrolle naturellement.
 *
 * Caractéristiques :
 *  - Le header est `position: fixed` sous la topbar, à droite du rail.
 *  - Sa hauteur est mesurée via `useLayoutEffect` + `ResizeObserver` pour
 *    rester cohérente même si toolbar/bouton changent de taille.
 *  - La marge entre le bas du header et le contenu (40px) est égale à
 *    la marge entre le bas de la topbar et le haut de la toolbar (40px =
 *    `paddingTop: 2.5rem` du header) — visuellement symétrique.
 *  - Initialisation `headerH=0` + measure SYNCHRONE avant paint via
 *    `useLayoutEffect` → pas de saut visuel au mount.
 */
export function AdminTabLayout({ toolbar, addButton, children, empty, isEmpty }: Props) {
  const headerRef = useRef<HTMLDivElement>(null);
  const hasHeader = !!(toolbar || addButton);
  // Valeur initiale :
  //  - avec header (toolbar/addButton)  : ≈ hauteur typique pour éviter le flash
  //    « contenu remonte puis redescend » avant que useLayoutEffect mesure la
  //    vraie hauteur via ResizeObserver
  //  - sans header                       : 0, le wrapper applique directement
  //    `pt-10 + overhang` (cf. style paddingTop ci-dessous)
  const [headerH, setHeaderH] = useState(hasHeader ? 172 : 0);
  // Overhang appliqué SYSTÉMATIQUEMENT pour absorber les onglets pill de la
  // topbar (`translate-y-1/2` dans topbar.tsx). On n'utilise plus
  // `useTopbarTabs` ici car le state est async (setTabs appelé après mount)
  // → premier render avec overhang=0 puis re-render = flash visuel /
  // collision possible avec les cards. Coût sur les pages sans onglets pill
  // = 40px de marge supplémentaire en haut, acceptable.
  const overhang = TOPBAR_TABS_OVERHANG;

  // useLayoutEffect : mesure synchrone avant paint → pas de flash.
  useLayoutEffect(() => {
    if (!headerRef.current) {
      // Pas de header rendu (ni toolbar ni addButton) → forcer headerH = 0
      // pour éviter la valeur initiale fantôme de 172px qui creusait une
      // marge inutile en haut des pages comme `/admin/users` ou `/admin/espace`.
      setHeaderH(0);
      return;
    }
    setHeaderH(headerRef.current.offsetHeight);
    const obs = new ResizeObserver(() => {
      if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
    });
    obs.observe(headerRef.current);
    return () => obs.disconnect();
  }, [hasHeader]);

  if (isEmpty && empty) {
    // Centrer verticalement l'EmptyState dans la zone disponible sous la topbar.
    return (
      <div
        className="flex items-center justify-center px-8 py-8"
        style={{ minHeight: "calc(100vh - var(--topbar-bottom) - 4rem)" }}
      >
        {empty}
      </div>
    );
  }

  return (
    <>
      {(toolbar || addButton) && (
        <div
          ref={headerRef}
          className="fixed z-20 space-y-3"
          style={{
            // Header collé directement sous la topbar — sinon le scroll fait
            // apparaitre le contenu dans la bande entre topbar et toolbar.
            top: "var(--topbar-bottom)",
            left: "var(--rail-width)",
            right: 0,
            paddingLeft: "2rem",
            paddingRight: "2rem",
            // Overhang (zone occupée par les onglets pill débordants) inclus
            // dans le padding-top → le background opaque couvre toute la zone
            // jusqu'aux onglets, plus de scroll qui transperce.
            paddingTop: `calc(2.5rem + ${overhang}px)`,
            paddingBottom: "0.5rem",
            background: "var(--background)",
          }}
        >
          {toolbar}
          {addButton}
          {/* Dégradé qui adoucit la transition header → contenu au scroll.
              Positionné en absolute pour ne pas affecter offsetHeight. */}
          <div
            className="pointer-events-none absolute inset-x-0 h-6 bg-gradient-to-b from-[var(--background)] to-transparent"
            style={{ top: "100%" }}
            aria-hidden
          />
        </div>
      )}
      <div
        style={{
          // Avec header : `headerH` inclut déjà l'overhang topbar (via le
          // paddingTop interne du header fixed). On ajoute juste la marge
          // bottom standard (40px).
          // Sans header : il faut appliquer manuellement la marge sous la
          // topbar (`2.5rem`) + l'overhang des pill nav projetées dans la
          // topbar (`overhang`), équivalent visuel d'un `pt-10` + overhang.
          paddingTop: hasHeader
            ? headerH + 40
            : `calc(2.5rem + ${overhang}px)`,
          paddingLeft: "2rem",
          paddingRight: "2rem",
          paddingBottom: "2rem",
        }}
      >
        {children}
      </div>
    </>
  );
}
