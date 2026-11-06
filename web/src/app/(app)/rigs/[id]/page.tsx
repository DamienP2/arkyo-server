// arkyo-server: `requireTenantDb` / `mainDb` / `requireTenantPermissionPage`
// (serveur) remplacés par `ClientPage` (contexte de permissions) et l'API.
import { useParams } from "next/navigation";
import { RigDetailClient } from "./rig-detail-client";
import { ClientPage } from "@/components/client-page";
import { Server } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
// arkyo-server: `fetchCatalogEquipmentMap` (lib/services/catalog-enrich)
// retiré : l'API enrichit déjà les slots.

const DESIGN_READ = ["design", "read"] as const;

type AvailableRack = { id: string; name: string; totalU: number; depthMm: number };

async function load(id: string) {
  const rigId = encodeURIComponent(id);
  const [rig, equipment, racks] = await Promise.all([
    // arkyo-server: `GET /api/rigs/:id` reprend la requête de la page :
    // `rigRacks` par `position` asc, chaque `rack` avec ses `slots` par
    // `startU` asc ; `project { id, name }`. 404 → `notFound()`.
    api.get<Record<string, unknown>>(`/api/rigs/${rigId}`),
    // Catalogue equipment (active) from main DB
    // arkyo-server: catalogue local (phase 2), équipements actifs, par nom.
    api
      .get<{ personal: { name: string }[] }>("/api/tenant/catalogue/equipment")
      .then((r) => [...r.personal].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))),
    // Available racks: all racks not already linked to this rig
    // arkyo-server: `GET /api/racks?unassigned=true&rigConfigId=` (createdAt
    // desc) ; on garde les champs du `select` d'arkyo.
    api.get<AvailableRack[]>(`/api/racks?unassigned=true&rigConfigId=${rigId}`),
  ]);

  // Enrich slots with catalog equipment (cross-DB)
  // arkyo-server: fait par l'API (chaque slot porte déjà `equipment` ou `null`).
  const enrichedRig = rig;

  const availableRacks = racks.map(({ id, name, totalU, depthMm }) => ({ id, name, totalU, depthMm }));

  return { enrichedRig, equipment, availableRacks };
}

// arkyo-server: le Server Component devient une page client ; garde,
// chargement (`<LoadingState>`, erreur avec « Réessayer », 404) et
// rechargement (`router.refresh()`) par `ClientPage`.
export default function RigDetailPage() {
  const { id } = useParams<{ id: string }>();
  // RBAC : détail d'une régie (lecture) → design:read (OWNER bypass).
  return (
    <ClientPage
      permission={DESIGN_READ}
      icon={<Server strokeWidth={1.5} />}
      fallbackError="Impossible de charger la régie."
      load={() => load(id)}
      loadKey={id}
    >
      {({ enrichedRig, equipment, availableRacks }) => (
        <RigDetailClient
          rig={enrichedRig as any}
          allEquipment={equipment as any}
          availableRacks={availableRacks}
        />
      )}
    </ClientPage>
  );
}
