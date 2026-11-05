"use client";

/**
 * useDeletedItemRedirect — re-route l'éditeur catalogue quand l'item ouvert
 * est supprimé par un autre client (collaboration).
 *
 * Deux cas, distingués par le payload SSE (`tenant_catalogue` / `deleted`) :
 *  - « Récupérer la version Arkyo » : `data.restoredArkyoId` présent →
 *    bascule vers l'item Arkyo (même éditeur, id Arkyo dans l'URL) ;
 *  - suppression réelle → retour à la liste.
 *
 * Sans ce re-routage, le client garde un id de fork mort dans son URL et le
 * moindre enregistrement ou rechargement tombe en erreur.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { subscribeAppEvents } from "@/lib/app-events-client";
import { useToast } from "@/components/ui/toast";

export function useDeletedItemRedirect(
  itemId: string,
  basePath: string,
  listUrl: string,
) {
  const router = useRouter();
  const toast = useToast();
  // Référence stable : ne pas ré-abonner si l'identité du toast change.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    return subscribeAppEvents((evt) => {
      const e = evt as {
        entity?: string;
        action?: string;
        id?: string;
        data?: { restoredArkyoId?: string };
      };
      if (e?.entity !== "tenant_catalogue" || e.action !== "deleted" || e.id !== itemId)
        return;
      // arkyo-server: plus de « Récupérer la version Arkyo » (catalogue unique) :
      // pas de bascule vers un item Arkyo (`data.restoredArkyoId`), seule la
      // suppression réelle renvoie à la liste.
      toastRef.current.info("Élément supprimé par un collaborateur.");
      router.replace(listUrl);
    });
  }, [itemId, basePath, listUrl, router]);
}
