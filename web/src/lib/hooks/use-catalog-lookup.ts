"use client";

/**
 * use-catalog-lookup.ts — Hook client de résolution batchée des soft-FK
 * catalogue (main DB) depuis le tenant.
 *
 * Stratégie :
 *  - Cache module-level keyed par `kind:id` (partagé entre tous les composants
 *    qui montent le hook au cours de la vie de la page).
 *  - Requête batchée via `POST /api/tenant/catalogue/lookup` (Agent B).
 *  - Dedup automatique : si plusieurs callers demandent les mêmes IDs en même
 *    temps, une seule requête est lancée (Promise partagée dans `inflight`).
 *
 * Le payload de réponse attendu :
 *   { equipment?: CatalogEquipmentLite[], adapter?: CatalogAdapterLite[],
 *     connectorType?: CatalogConnectorTypeLite[] }
 *
 * Le cache N'EST PAS invalidé en cours de session — l'idée est qu'un item
 * catalogue ne change pas (en lecture seule côté tenant). En cas de besoin,
 * exporter une `clearCatalogCache()`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type {
  CatalogAdapterLite,
  CatalogConnectorTypeLite,
  CatalogEquipmentLite,
  CatalogLookupKind,
  CatalogLookupResult,
} from "@/lib/types/catalog";

// ── Cache module-level ────────────────────────────────────────────────────

const cache = new Map<string, CatalogEquipmentLite | CatalogAdapterLite | CatalogConnectorTypeLite>();
const inflight = new Map<string, Promise<unknown>>();

function cacheKey(kind: CatalogLookupKind, id: string): string {
  return `${kind}:${id}`;
}

/** Vide le cache module — usage avancé (tests, debug). */
export function clearCatalogCache(): void {
  cache.clear();
  inflight.clear();
}

/** Retourne un item déjà résolu dans le cache (sync). */
export function readCachedCatalog<K extends CatalogLookupKind>(
  kind: K,
  id: string,
): CatalogLookupResult<K> | null {
  const hit = cache.get(cacheKey(kind, id));
  return (hit as CatalogLookupResult<K> | undefined) ?? null;
}

// ── Fetch batché ──────────────────────────────────────────────────────────

type LookupResponse = {
  equipment?: CatalogEquipmentLite[];
  adapter?: CatalogAdapterLite[];
  connectorType?: CatalogConnectorTypeLite[];
};

async function fetchMissing(
  kind: CatalogLookupKind,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  // Dedup inflight : si déjà en cours pour le même kind+id, attendre la promise.
  const pendingKey = `${kind}:${[...ids].sort().join(",")}`;
  const existing = inflight.get(pendingKey);
  if (existing) {
    await existing;
    return;
  }

  const promise = (async () => {
    const res = await api.post<LookupResponse>("/api/tenant/catalogue/lookup", {
      kind,
      ids,
    });
    const list =
      kind === "equipment"
        ? (res.equipment ?? [])
        : kind === "adapter"
          ? (res.adapter ?? [])
          : (res.connectorType ?? []);
    for (const item of list) {
      cache.set(cacheKey(kind, item.id), item);
    }
  })();

  inflight.set(pendingKey, promise);
  try {
    await promise;
  } finally {
    inflight.delete(pendingKey);
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────

export type CatalogLookupMap<K extends CatalogLookupKind> = Map<
  string,
  CatalogLookupResult<K>
>;

export type UseCatalogLookupResult<K extends CatalogLookupKind> = {
  /** Map id → item (uniquement les IDs résolus pour l'instant). */
  items: CatalogLookupMap<K>;
  /** true tant qu'une requête est en cours pour des IDs manquants. */
  loading: boolean;
  /** Force un re-fetch d'IDs précis (ignore le cache). */
  refresh: (ids: string[]) => Promise<void>;
};

/**
 * Résout un ensemble de soft-FK catalogue en batched fetch côté client.
 *
 * Exemple :
 *   const ids = slots.map((s) => s.catalogEquipmentId).filter(Boolean) as string[];
 *   const { items, loading } = useCatalogLookup("equipment", ids);
 *   const name = items.get(slot.catalogEquipmentId!)?.name ?? "Équipement inconnu";
 */
export function useCatalogLookup<K extends CatalogLookupKind>(
  kind: K,
  ids: string[],
): UseCatalogLookupResult<K> {
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const idsRef = useRef<string>("");

  const sig = [...new Set(ids)].sort().join("|");

  useEffect(() => {
    if (idsRef.current === sig) return;
    idsRef.current = sig;

    const uniqueIds = [...new Set(ids)].filter(Boolean);
    const missing = uniqueIds.filter((id) => !cache.has(cacheKey(kind, id)));

    if (missing.length === 0) {
      setTick((t) => t + 1);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchMissing(kind, missing)
      .catch((err) => {
        // On log mais on n'explose pas le canvas : items absents → fallback "inconnu".
        console.warn("[useCatalogLookup] failed to fetch", kind, missing, err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setTick((t) => t + 1);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, kind]);

  const items = new Map<string, CatalogLookupResult<K>>();
  for (const id of ids) {
    if (!id) continue;
    const hit = cache.get(cacheKey(kind, id));
    if (hit) items.set(id, hit as CatalogLookupResult<K>);
  }

  const refresh = useCallback(
    async (toRefresh: string[]) => {
      for (const id of toRefresh) cache.delete(cacheKey(kind, id));
      setLoading(true);
      try {
        await fetchMissing(kind, toRefresh);
      } finally {
        setLoading(false);
        setTick((t) => t + 1);
      }
    },
    [kind],
  );

  // tick référencé pour forcer une re-render après le set de cache.
  void tick;

  return { items, loading, refresh };
}
