"use client";

/**
 * useParametresSync — abonnement SSE temps réel aux mutations d'un référentiel
 * tenant côté `/admin/parametres`.
 *
 * Calqué sur `useCatalogueSync` (catalogue) : un seul listener par panneau,
 * scoped à une entity name explicite (ex. `tenant_parametres_brands`,
 * `tenant_parametres_categories`…), avec debounce 150 ms pour absorber les
 * bursts (auto-save en cascade côté admin).
 *
 * Volontairement scoped au panneau qui le monte : pas de connexion permanente
 * quand l'utilisateur navigue ailleurs.
 *
 * ── Bridge supervisor → tenant ───────────────────────────────────────────────
 * Quand l'entity commence par `tenant_parametres_`, le hook écoute aussi
 * l'event supervisor correspondant selon le mapping ci-dessous.
 *
 * Convention events supervisor : `supervisor_catalog_<referentiel>`
 *   tenant_parametres_brands        → supervisor_catalog_brands
 *   tenant_parametres_connectors    → supervisor_catalog_connectors
 *   tenant_parametres_signals       → supervisor_catalog_signals
 *   tenant_parametres_categories    → supervisor_catalog_categories
 *   tenant_parametres_dimensions    → supervisor_catalog_dimensions
 *   tenant_parametres_cabling       → supervisor_catalog_cabling
 *   tenant_parametres_print_labels  → supervisor_catalog_print_labels
 *
 * Rappel : les routes catalog supervisor (`/api/supervisor/catalog/[entity]`)
 * publient `publishAppUpdate("supervisor_catalog_<entity>", action, id)` en
 * plus de l'event générique `"catalog"`. Les routes dimensions et cable-models
 * publient uniquement `supervisor_catalog_dimensions` / `supervisor_catalog_cabling`.
 */

import { useEffect, useRef } from "react";
import { subscribeAppEvents } from "@/lib/app-events-client";

/** Mapping tenant entity → entity supervisor SSE correspondante. */
// arkyo-server: pas de back-office supervisor (SaaS) — aucun évènement
// `supervisor_catalog_*` n'est publié, la passerelle est vide.
const SUPERVISOR_BRIDGE: Record<string, string> = {};

export function useParametresSync(entity: string, onChange: () => void) {
  // Garde une référence stable sur le callback : permet à l'effet de ne pas
  // se ré-attacher si le parent passe un callback inline.
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => cbRef.current(), 150);
    };

    // Entity supervisor bridgée (ou null si pas de mapping)
    const supervisorEntity = SUPERVISOR_BRIDGE[entity] ?? null;

    const unsubscribe = subscribeAppEvents((data) => {
      const payload = data as {
        type?: string;
        entity?: string;
        action?: string;
        id?: string;
      } | null;
      if (!payload) return;
      if (payload.type === "ping" || payload.type === "connected") return;
      if (payload.entity === entity) {
        schedule();
        return;
      }
      if (supervisorEntity !== null && payload.entity === supervisorEntity) {
        schedule();
      }
    });

    return () => {
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [entity]);
}
