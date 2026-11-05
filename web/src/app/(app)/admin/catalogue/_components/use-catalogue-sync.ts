"use client";

/**
 * useCatalogueSync — abonnement SSE temps réel au catalogue Arkyo.
 *
 * Écoute les événements `entity: "catalog"` publiés par les routes
 * supervisor (équipements, cordons, adaptateurs, configuration). À chaque
 * mutation supervisor (create / update / delete), déclenche `onChange()`
 * pour re-fetch côté tenant.
 *
 * Volontairement scoped au catalogue tenant : monté uniquement par les
 * panels `/admin/catalogue/*`, donc le listener SSE est créé/détruit avec
 * la page (pas de connexion permanente quand l'utilisateur navigue ailleurs).
 *
 * Debounce 150 ms pour bursts (ex. supervisor qui sauvegarde plusieurs
 * champs en cascade via auto-save) — un seul refetch par burst.
 */

import { useEffect, useRef } from "react";
import { subscribeAppEvents } from "@/lib/app-events-client";

export function useCatalogueSync(onChange: () => void) {
  // Garde une référence stable sur le callback : permet à l'effet
  // de ne pas se ré-attacher si le parent passe un callback inline.
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => cbRef.current(), 150);
    };

    const unsubscribe = subscribeAppEvents((data) => {
      const payload = data as {
        type?: string;
        entity?: string;
        action?: string;
        id?: string;
      } | null;
      if (!payload) return;
      if (payload.type === "ping" || payload.type === "connected") return;
      if (payload.entity !== "catalog") return;
      schedule();
    });

    return () => {
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, []);
}
