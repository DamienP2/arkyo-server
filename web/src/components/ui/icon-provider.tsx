"use client";

/**
 * Pose le poids par défaut des icônes Phosphor pour toute l'app ("regular",
 * trait standard). Chaque icône peut surcharger via sa prop `weight`. Monté
 * une seule fois dans le root layout.
 */

import { IconContext } from "@phosphor-icons/react";

export function IconProvider({ children }: { children: React.ReactNode }) {
  return (
    <IconContext.Provider value={{ weight: "regular" }}>
      {children}
    </IconContext.Provider>
  );
}
