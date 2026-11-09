/**
 * Libellés et formats partagés des pages Gérer (interface Strata v2). Les
 * libellés de projet sont ceux d'arkyo (`fiche-client.tsx` :
 * `INTERVENTION_LABEL`, `ALL_RIG_OPTIONS`).
 */

import { format } from "date-fns";
import { fr } from "date-fns/locale";

export const INTERVENTION_LABEL: Record<string, string> = {
  PRESTATION: "Prestation",
  INTEGRATION: "Intégration",
};

/** Type de régie (`MIXED` : ancien type, encore valide en base). */
export const RIG_LABEL: Record<string, string> = {
  FLIGHT_CASE: "Flight case",
  CAR: "Car régie / véhicule mobile",
  FIXED_INSTALL: "Installation fixe",
  MIXED: "Mixte",
};

/** « 1 câble », « 3 câbles ». */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Date courte (« 20 nov. 2026 »), `null` sans date. */
export const fmtDay = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "d MMM yyyy", { locale: fr }) : null;
