"use client";

/**
 * useProjectSync — hook SSE filtré par projet pour les onglets projet.
 *
 * Branche un EventSource sur `/api/events`, filtre les events par :
 *   - `projectId` (obligatoire — seuls les events du projet courant matchent)
 *   - `entities` (optionnel — liste blanche d'entités à observer)
 *   - `rackId` (optionnel — restreint encore plus si l'onglet se focalise
 *     sur un rack précis, ex. synoptique)
 *
 * Les events qui matchent déclenchent `onUpdate(event)` après un debounce
 * intégré (~150ms) pour éviter de spammer le handler quand plusieurs events
 * arrivent en burst (ex. drag&drop d'inventaire = N publishs successifs).
 *
 * ## Compatibilité ascendante
 *
 * La plupart des routes publient `publishAppUpdate(entity, action, id)` sans
 * `projectId`. Pour rester rétrocompatible, le hook accepte un mode
 * `acceptUnscoped: true` qui matche aussi les events sans `projectId` (ex.
 * routes pas encore enrichies). À utiliser quand on veut absolument capter
 * toutes les mutations d'une entité, au prix de fausses-positives entre
 * projets.
 *
 * Par défaut, `acceptUnscoped = false` : seul un match strict par projectId
 * passe. C'est ce qu'il faut faire dès que les routes pertinentes publient
 * `projectId` dans `meta`.
 *
 * ## Cleanup
 *
 * - EventSource fermé au unmount
 * - Debounce timer clearé au unmount
 */

import { useEffect, useRef } from "react";
import { getClientId } from "@/lib/client-id";
import { subscribeAppEvents } from "@/lib/app-events-client";

export type ProjectSyncEvent = {
  entity: string;
  action: string;
  id?: string;
  projectId?: string;
  rackId?: string;
  itemId?: string;
  clientId?: string;
};

export type UseProjectSyncOptions = {
  projectId: string;
  /** Filtre les entités auxquelles ce tab veut réagir. Si omis, toutes. */
  entities?: string[];
  /** Filtre par rackId si pertinent (ex. synoptique focus). Si omis, tous racks. */
  rackId?: string;
  /**
   * Si true, accepte aussi les events sans `projectId` (compat ascendante avec
   * les routes pas encore enrichies). Default false.
   */
  acceptUnscoped?: boolean;
  /**
   * Si true, n'ignore PAS les events publiés par notre propre tab (par défaut
   * filtrés pour ne pas double-fetcher quand un état optimiste local existe).
   * À activer quand le consommateur N'a PAS d'optimisme local et doit
   * impérativement re-fetch sur ses propres mutations — typique de
   * `RackTabClient` qui fetche `canvasData` au complet et n'a aucun moyen
   * de patcher ce payload localement (profondeur effective, sécurité câbles,
   * compteurs slots, etc.).
   */
  includeOwn?: boolean;
  /** Délai de debounce en ms (default 150). */
  debounceMs?: number;
  /** Handler appelé quand un event matché passe le filtre + debounce. */
  onUpdate: (event: ProjectSyncEvent) => void;
};

export function useProjectSync(opts: UseProjectSyncOptions): void {
  // Garde un ref vers les options courantes pour éviter de re-créer
  // l'EventSource à chaque render (le handler peut changer entre rendus,
  // mais on ne veut pas réouvrir la connexion SSE).
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: ProjectSyncEvent | null = null;

    const flush = () => {
      timer = null;
      if (!pending) return;
      const evt = pending;
      pending = null;
      try {
        optsRef.current.onUpdate(evt);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[useProjectSync] onUpdate threw:", e);
      }
    };

    const ownClientId = getClientId();
    const unsubscribe = subscribeAppEvents((data) => {
      const payload = data as
        | (Partial<ProjectSyncEvent> & { type?: string })
        | null;
      if (!payload) return;
      if (payload.type === "ping" || payload.type === "connected") return;
      if (!payload.entity || !payload.action) return;

      const current = optsRef.current;

      // Filtre originateur : si l'event vient de NOTRE propre tab, on
      // l'ignore par défaut (l'état local est déjà optimisé en optimiste).
      // `includeOwn` lève ce filtre pour les consommateurs qui n'ont pas
      // d'optimisme local (cf. RackTabClient + canvas-data).
      if (
        !current.includeOwn &&
        payload.clientId &&
        ownClientId &&
        payload.clientId === ownClientId
      ) {
        return;
      }

      if (payload.projectId) {
        if (payload.projectId !== current.projectId) return;
      } else if (!current.acceptUnscoped) {
        return;
      }

      if (current.entities && current.entities.length > 0) {
        if (!current.entities.includes(payload.entity)) return;
      }

      if (current.rackId && payload.rackId) {
        if (payload.rackId !== current.rackId) return;
      }

      const event: ProjectSyncEvent = {
        entity: payload.entity,
        action: payload.action,
        id: payload.id,
        projectId: payload.projectId,
        rackId: payload.rackId,
        itemId: payload.itemId,
      };

      pending = event;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, current.debounceMs ?? 150);
    });

    return () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      unsubscribe();
    };
    // L'effect ne dépend que de projectId : changer de projet (navigation
    // entre projets) force une nouvelle souscription. Tout le reste passe par
    // optsRef (lecture en live, pas de re-souscription).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.projectId]);
}
