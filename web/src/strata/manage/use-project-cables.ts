"use client";

/**
 * Câbles du projet pour tout l'espace Gérer (interface Strata v2) : une seule
 * lecture (`loadProjectCables`), tenue par `ManageShell`, qui nourrit la
 * pastille de la navigation, la ligne Câblage de la Vue d'ensemble et la page
 * Câbles. Relue quand la liste des contenants change et, une seule fois par
 * salve, sur les évènements qui touchent les câbles (anti-rebond de 300 ms),
 * l'ancienne liste restant affichée.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import { getApiErrorMessage } from "@/lib/api-client";
import { subscribeAppEvents } from "@/lib/app-events-client";
import { isCableEvent, loadProjectCables, type CableDraft, type CableRackRef, type CableRow } from "./cables-model";

/** Anti-rebond des relectures sur évènement. */
export const RELOAD_DEBOUNCE_MS = 300;

export type ProjectCables = {
  /** `null` jusqu'à la première lecture réussie. */
  rows: CableRow[] | null;
  /** Message de la dernière lecture en échec. */
  error: string | null;
  reload: () => void;
  /** Relecture groupée (anti-rebond). */
  schedule: () => void;
  /** Valeurs enregistrées, appliquées sans attendre la relecture. */
  applyLocal: (applied: Map<string, CableDraft>) => void;
};

/** Contenants au format de `loadProjectCables`. */
export function racksOf(racks: readonly InventaireRack[]): CableRackRef[] {
  return racks.map((r) => ({ id: r.id, name: r.name, locationId: r.locationId ?? null, isVirtual: !!r.isVirtual }));
}

export function useProjectCables(projectId: string, inventory: readonly InventaireRack[]): ProjectCables {
  const racks = useMemo(() => racksOf(inventory), [inventory]);
  const [state, setState] = useState<{ rows: CableRow[] | null; error: string | null }>({ rows: null, error: null });
  const racksRef = useRef(racks);
  racksRef.current = racks;
  const key = racks.map((r) => `${r.id}:${r.locationId ?? ""}:${r.isVirtual ? 1 : 0}`).join(",");
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    const t = ++token.current;
    loadProjectCables(projectId, racksRef.current)
      .then((rows) => {
        if (t === token.current) setState({ rows, error: null });
      })
      .catch((e: unknown) => {
        if (t === token.current)
          setState((s) => ({ rows: s.rows, error: getApiErrorMessage(e, "Lecture des câbles impossible.") }));
      });
  }, [projectId]);

  // Première lecture, et relecture quand la liste des contenants change.
  useEffect(() => {
    load();
  }, [load, key]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      load();
    }, RELOAD_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeAppEvents((data) => {
      if (isCableEvent(data, projectId, racksRef.current.map((r) => r.id))) schedule();
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // Une lecture en vol n'écrit plus rien.
      token.current += 1;
    };
  }, [projectId, schedule]);

  const applyLocal = useCallback((applied: Map<string, CableDraft>) => {
    setState((s) => ({
      ...s,
      rows:
        s.rows?.map((r) => {
          const d = applied.get(r.id);
          if (!d) return r;
          const next = { ...r };
          for (const f of ["label", "color", "notes"] as const) {
            const raw = d[f];
            if (raw === undefined) continue;
            const v = f === "notes" ? raw : raw.trim();
            next[f] = v === "" ? null : v;
          }
          return next;
        }) ?? null,
    }));
  }, []);

  return { ...state, reload: load, schedule, applyLocal };
}
