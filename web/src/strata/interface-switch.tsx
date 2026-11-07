/**
 * Aiguillage d'une route selon l'interface (Classique / Strata) : rend
 * `classique` ou `strata` selon `useInterface()`. Seul l'élément choisi est
 * monté (une page chargée à la demande n'est importée que si elle s'affiche).
 */

import type { ReactNode } from "react";
import { useInterface } from "./interface-context";

export function InterfaceSwitch({ classique, strata }: { classique: ReactNode; strata: ReactNode }) {
  return <>{useInterface() === "strata" ? strata : classique}</>;
}
