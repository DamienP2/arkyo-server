import { Suspense } from "react";
// arkyo-server: `requireTenantDb` / `requireTenantPermissionPage` (serveur)
// remplacés par `ClientPage` (contexte de permissions) et l'API.
import { ClientPage } from "@/components/client-page";
import { Container } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import { TemplatesClient } from "./templates-client";
// arkyo-server: `fetchCatalogEquipmentMap` / `fetchCatalogConnectorTypeMap`
// (lib/services/catalog-enrich) retirés : l'API enrichit déjà les slots.

// arkyo-server: `export const dynamic = "force-dynamic"` retiré (Next seul).

const DESIGN_READ = ["design", "read"] as const;

async function load() {
  // Règle métier : la page /templates ne doit montrer QUE les objets
  // réutilisables (= templates), jamais ceux liés à un projet. Pour Rack
  // et Panel, on dérive le statut via les liens : un Rack/Panel rattaché à
  // un RigConfig de projet (projectId != null) est considéré comme étant
  // dans un projet, donc PAS un template.
  const [racksRaw, panelsRaw] = await Promise.all([
    // arkyo-server: données de la page serveur d'arkyo. `GET /api/racks?templates=true`
    // applique le filtre de la page (aucun RigRack vers un RigConfig avec
    // projectId), `include: { slots, rigs.rigConfig{id,name} }`, tri par
    // `updatedAt` desc.
    api.get<unknown[]>("/api/racks?templates=true"),
    // La galerie liste les panels PUBLICS (modèles réutilisables). Un panel
    // reste un modèle même une fois placé dans un projet — c'est la même
    // entité, partagée. On distingue « modèle » vs « instance privée » par
    // le champ `private` (cf. modèle Panel), et NON par le fait d'être
    // rattaché à un projet — sinon un modèle disparaît de la galerie dès
    // qu'on l'utilise. Cohérent avec `GET /api/panels`.
    // arkyo-server: `GET /api/panels` (sans `scope`) : `private: false`,
    // `include: { slots }`, tri par `createdAt` desc, comme la page.
    api.get<unknown[]>("/api/panels"),
  ]);

  // ── Cross-DB enrichment ──────────────────────────────────────────────────
  // arkyo-server: fait par l'API : chaque slot de rack porte déjà `equipment`
  // (ou `null`), chaque slot de panel `connectorType` (ou `null`).
  const racks = racksRaw;
  const panels = panelsRaw;

  return { racks, panels };
}

/**
 * Page `/templates` — regroupe Contenants (Racks) et Panels sous un même écran
 * avec un sélecteur de tabs. Les régies sont gérées depuis les projets.
 */
// arkyo-server: le Server Component devient une page client ; garde,
// chargement (`<LoadingState>`, erreur avec « Réessayer ») et rechargement
// (`router.refresh()`) par `ClientPage`.
export default function TemplatesPage() {
  // RBAC : liste des modèles (Contenants / Panels) → design:read (OWNER bypass).
  return (
    <ClientPage
      permission={DESIGN_READ}
      icon={<Container strokeWidth={1.5} />}
      fallbackError="Impossible de charger les modèles."
      load={load}
    >
      {({ racks, panels }) => (
        <Suspense>
          { }
          <TemplatesClient racks={racks as any} panels={panels as any} />
        </Suspense>
      )}
    </ClientPage>
  );
}
