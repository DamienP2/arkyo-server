"use client";

/**
 * Listes du catalogue (Strata v2) : les routes que lisent les panneaux
 * d'arkyo (`GET /api/tenant/catalogue/{equipment,cables,adapters}?scope=all`,
 * réponse `{arkyo, personal}` fusionnée), relues à chaque évènement temps réel
 * du catalogue (`useCatalogueSync`, comme les panneaux). Comme eux : un 403 /
 * 404 vaut une liste vide, toute autre erreur est affichée.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CatalogueListResponse,
  TenantAdapterItem,
  TenantCableItem,
  TenantEquipmentItem,
} from "@/app/(app)/admin/catalogue/_components/tenant-catalogue-types";
import { mergeCatalogueResponse } from "@/app/(app)/admin/catalogue/_components/tenant-catalogue-types";
import { useCatalogueSync } from "@/app/(app)/admin/catalogue/_components/use-catalogue-sync";
import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";

/** Équipement de la liste : la ligne complète (`TenantEquipment`), enrichie. */
export type CatalogueEquipment = TenantEquipmentItem & {
  brandId?: string | null;
  type?: { id: string; name: string } | null;
  connectors?: unknown;
  depthMm?: number | null;
  rearCableDepthMm?: number | null;
  dimLmm?: number | null;
  dimWmm?: number | null;
  dimHmm?: number | null;
  heatBtuH?: number | null;
  hasDualPsu?: boolean | null;
  ip2110Mode?: string | null;
  signalCapacities?: unknown;
  dmxChannelsDefault?: number | null;
  dmxModes?: unknown;
  isComponentHost?: boolean | null;
  hostSlotCount?: number | null;
  isComponent?: boolean | null;
  componentSlotSpan?: number | null;
  phaseIds?: unknown;
  tags?: unknown;
  customFields?: unknown;
  documents?: unknown;
  notes?: string | null;
};

/** Cordon de la liste (ligne complète). */
export type CatalogueCable = TenantCableItem & { cableModelId?: string | null; notes?: string | null };

/** Adaptateur de la liste (ligne complète). */
export type CatalogueAdapter = TenantAdapterItem & { notes?: string | null };

export type CatalogueKind = "equipment" | "cables" | "adapters";

const FALLBACK: Record<CatalogueKind, string> = {
  equipment: "Impossible de charger le catalogue.",
  cables: "Impossible de charger les cordons.",
  adapters: "Impossible de charger les adaptateurs.",
};

export type CatalogueItems<T> = {
  items: T[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Relecture silencieuse (la liste affichée reste en place). */
  refresh: () => void;
  /** Retire des fiches de la liste affichée (après suppression). */
  removeLocal: (ids: string[]) => void;
};

export function useCatalogueItems<T>(kind: CatalogueKind): CatalogueItems<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Seule la réponse de la dernière lecture est appliquée.
  const seq = useRef(0);

  const load = useCallback(
    (silent: boolean) => {
      const n = ++seq.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      api
        .get<CatalogueListResponse<T>>(`/api/tenant/catalogue/${kind}?scope=all`)
        .then((data) => {
          if (n !== seq.current) return;
          setItems(mergeCatalogueResponse(data) as T[]);
          setError(null);
        })
        .catch((e: unknown) => {
          if (n !== seq.current) return;
          if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
            setItems([]);
          } else if (!silent) {
            setItems([]);
            setError(getApiErrorMessage(e, FALLBACK[kind]));
          }
        })
        .finally(() => {
          if (n === seq.current) setLoading(false);
        });
    },
    [kind],
  );

  useEffect(() => {
    load(false);
    return () => {
      seq.current++;
    };
  }, [load]);

  // Temps réel : relecture silencieuse (la liste affichée reste en place).
  useCatalogueSync(() => load(true));

  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);
  const removeLocal = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setItems((prev) => prev.filter((it) => !gone.has((it as { id: string }).id)));
  }, []);
  return { items, loading, error, reload, refresh, removeLocal };
}
