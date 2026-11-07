/**
 * Données du catalogue pour les dessins Strata : référentiels de
 * `GET /api/tenant/catalogue/lookup`, signaux d'énergie, familles de signal
 * et lecture tolérante de la connectique d'un équipement de la liste.
 *
 * Famille d'un signal = sa fonction (`TenantSignalType.functionId` →
 * `TenantFunction`) : libellé et couleur de la fonction, couleurs métier
 * inchangées. Un signal d'énergie est un signal de la fonction de clé
 * `ENERGIE` (référentiel `seeds/functions.json`) ; le lookup ne fournit pas
 * d'`isPower`.
 */

import { useEffect, useState } from "react";
import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { api } from "@/lib/api-client";
import type { DrawingConnectorType, DrawingSignal } from "./drawings/face-layout";
import type { DrawingGender } from "./drawings/cable-drawing";
import { portCount } from "./drawings/face-layout";

/** Clé de la fonction Énergie (référentiel des fonctions). */
export const POWER_FUNCTION_KEY = "ENERGIE";

export type LookupConnectorType = { id: string; name: string; iconId?: string | null };
export type LookupSignal = { name: string; color: string; functionId?: string | null };
export type LookupFunction = { id: string; label: string; color: string | null; key?: string | null };
export type LookupBrand = { id: string; name: string };
export type LookupCableModel = {
  id: string;
  name: string;
  reference?: string | null;
  brandName?: string | null;
  impedance?: number | null;
  bandwidthMHz?: number | null;
  diameterMm?: number | null;
  conductor?: string | null;
  shielding?: string | null;
  jacketMaterial?: string | null;
  fireRating?: string | null;
};

/** Sous-ensemble de `GET /api/tenant/catalogue/lookup` lu par les dessins. */
export type CatalogueLookup = {
  brands?: readonly LookupBrand[];
  connectorTypes?: readonly LookupConnectorType[];
  signals?: readonly LookupSignal[];
  functions?: readonly LookupFunction[];
  cableModels?: readonly LookupCableModel[];
};

/** Référentiels du catalogue, chargés une fois (`null` pendant le chargement ou en cas d'échec). */
export function useCatalogueLookup(): CatalogueLookup | null {
  const [lookup, setLookup] = useState<CatalogueLookup | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<CatalogueLookup>("/api/tenant/catalogue/lookup")
      .then((l) => {
        if (!cancelled) setLookup(l ?? {});
      })
      .catch((e: unknown) => {
        // Les dessins restent lisibles sans référentiels (pictogrammes neutres).
        console.warn("Catalogue Strata : référentiels indisponibles (/api/tenant/catalogue/lookup)", e);
        if (!cancelled) setLookup({});
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return lookup;
}

/** Index des types de connecteur du lookup, par id (pictogramme et nom). */
export function connectorTypeIndex(lookup: CatalogueLookup | null | undefined): Map<string, LookupConnectorType> {
  return new Map((lookup?.connectorTypes ?? []).map((t) => [t.id, t]));
}

/** Genre d'une extrémité (cordon, adaptateur) : `MALE` / `FEMALE`, sinon `NEUTRAL`. */
export function drawingGender(g: string | null | undefined): DrawingGender {
  return g === "MALE" || g === "FEMALE" ? g : "NEUTRAL";
}

/** Types de connecteur au format des dessins. */
export function drawingConnectorTypes(lookup: CatalogueLookup | null | undefined): DrawingConnectorType[] {
  return (lookup?.connectorTypes ?? []).map((t) => ({ id: t.id, name: t.name, iconId: t.iconId ?? "" }));
}

function isPowerFunction(f: LookupFunction | undefined): boolean {
  return (f?.key ?? "").toUpperCase() === POWER_FUNCTION_KEY;
}

/** Signaux au format des dessins, `isPower` calculé depuis la fonction du signal. */
export function drawingSignals(lookup: CatalogueLookup | null | undefined): DrawingSignal[] {
  const fns = new Map((lookup?.functions ?? []).map((f) => [f.id, f]));
  return (lookup?.signals ?? []).map((s) => ({
    name: s.name,
    color: s.color,
    isPower: isPowerFunction(s.functionId ? fns.get(s.functionId) : undefined),
  }));
}

/** Famille de signal d'un ensemble de ports. */
export type PortFamily = { key: string; label: string; color: string; count: number };

const NO_FAMILY = "_none";

/**
 * Ports par famille de signal (fonction du signal), dans l'ordre des
 * fonctions du référentiel ; les ports sans famille connue en dernier.
 */
export function portFamilies(
  connectors: readonly ConnectorEntry[],
  lookup: CatalogueLookup | null | undefined,
): PortFamily[] {
  const fns = lookup?.functions ?? [];
  const fnById = new Map(fns.map((f) => [f.id, f]));
  const fnOfSignal = new Map((lookup?.signals ?? []).map((s) => [s.name, s.functionId ? fnById.get(s.functionId) : undefined]));
  const counts = new Map<string, number>();
  for (const c of connectors) {
    const n = portCount(c);
    if (n === 0) continue;
    const key = fnOfSignal.get(c.signalName)?.id ?? NO_FAMILY;
    counts.set(key, (counts.get(key) ?? 0) + n);
  }
  const order = [...fns.map((f) => f.id), NO_FAMILY];
  return order.flatMap((key) => {
    const count = counts.get(key);
    if (!count) return [];
    const f = fnById.get(key);
    return [
      {
        key,
        label: f?.label ?? "Sans signal",
        color: f?.color ?? "var(--border-strong)",
        count,
      },
    ];
  });
}

/** Nombre total de ports d'une connectique. */
export function totalPorts(connectors: readonly ConnectorEntry[]): number {
  return connectors.reduce((a, c) => a + portCount(c), 0);
}

const FACES: readonly ConnectorEntry["face"][] = ["FRONT", "REAR", "LEFT", "RIGHT", "TOP", "BOTTOM"];
const DIRECTIONS: readonly ConnectorEntry["direction"][] = ["IN", "OUT", "BOTH"];

/**
 * Connectique d'un équipement de la liste (colonne JSON `connectors`, sans
 * garantie de forme) : les entrées lisibles, avec les défauts de l'éditeur
 * (`initialForm` : genre `FEMALE`, signal vide).
 */
export function parseConnectors(raw: unknown): ConnectorEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c, i) => {
    if (!c || typeof c !== "object") return [];
    const o = c as Record<string, unknown>;
    const face = FACES.includes(o.face as ConnectorEntry["face"]) ? (o.face as ConnectorEntry["face"]) : "REAR";
    const direction = DIRECTIONS.includes(o.direction as ConnectorEntry["direction"])
      ? (o.direction as ConnectorEntry["direction"])
      : "BOTH";
    return [
      {
        id: typeof o.id === "string" ? o.id : String(i),
        face,
        connectorTypeId: typeof o.connectorTypeId === "string" ? o.connectorTypeId : "",
        signalName: typeof o.signalName === "string" ? o.signalName : "",
        quantity: Number(o.quantity) || 0,
        label: typeof o.label === "string" ? o.label : "",
        direction,
        gender: o.gender === "MALE" ? "MALE" : "FEMALE",
      },
    ];
  });
}

const NUMBER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Nombre à la française (`4,2`, `4 500`) ; `—` si absent. */
export function fmtNumber(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? NUMBER.format(n) : "—";
}
