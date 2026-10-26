"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { subscribeAppEvents } from "@/lib/app-events-client";

type AppSyncProps = {
  /**
   * Si fourni, seuls les events dont `entity` est inclus déclencheront un refresh.
   * Permet au layout supervisor d'ignorer les events platform (panel, project…).
   * Si omis, tous les events non-ping déclenchent un refresh (compat ascendante).
   */
  entities?: string[];
};

export function AppSync({ entities }: AppSyncProps = {}) {
  const router = useRouter();
  const knownIds = useRef(new Set<string>());
  const filterRef = useRef<Set<string> | null>(null);

  // Snapshot stable de la liste de filtre (évite la re-souscription SSE à chaque render)
  filterRef.current = entities && entities.length > 0 ? new Set(entities) : null;

  useEffect(() => {
    return subscribeAppEvents((data) => {
      const payload = data as {
        type?: string;
        entity?: string;
        action?: string;
        id?: string;
      } | null;
      if (!payload) return;
      if (payload.type === "ping" || payload.type === "connected") return;

      // Filtre par entité si la liste est fournie
      const filter = filterRef.current;
      if (filter && payload.entity && !filter.has(payload.entity)) return;

      // Déduplication StrictMode (même event reçu 2x dans le même tick)
      const key = `${payload.entity}-${payload.action}-${payload.id}`;
      if (knownIds.current.has(key)) return;
      knownIds.current.add(key);
      setTimeout(() => knownIds.current.delete(key), 2000);

      router.refresh();
    });
  }, [router]);

  return null;
}
