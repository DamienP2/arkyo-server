import { Suspense } from "react";
// arkyo-server: `requireTenantDb` / `requireTenantPermissionPage` (serveur)
// remplacés par `ClientPage` (contexte de permissions) et l'API.
import { ClientPage } from "@/components/client-page";
import { FolderOpen } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import { ProjectsClient, type ProjectListItem } from "./projects-client";

// arkyo-server: `export const dynamic = "force-dynamic"` retiré (Next seul).

// arkyo-server: données de la page serveur d'arkyo. `GET /api/tenant/projects`
// renvoie le `select` de la page, `description`, `documentsCount` et
// `rigConfigsCount` compris (`_count.documents` / `_count.rigConfigs`), dates
// déjà en ISO : même forme que `ProjectListItem`.

const PROJECTS_READ = ["projects", "read"] as const;

async function load(): Promise<ProjectListItem[]> {
  // Liste serveur (le client refetch via SSE/SWR-like refresh).
  const { projects } = await api.get<{ projects: ProjectListItem[] }>("/api/tenant/projects");

  // Sérialise les dates en ISO pour passer le contrat client.
  // arkyo-server: même projection que la page d'arkyo ; l'API sérialise déjà
  // les dates (`toISOString()` inutile).
  const initialProjects: ProjectListItem[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    interventionType: p.interventionType,
    rigType: p.rigType,
    clientName: p.clientName,
    shootingDate: p.shootingDate,
    shootingEndDate: p.shootingEndDate,
    planningStart: p.planningStart,
    planningEnd: p.planningEnd,
    commissioningDate: p.commissioningDate,
    location: p.location,
    prestationType: p.prestationType,
    description: p.description,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    documentsCount: p.documentsCount,
    rigConfigsCount: p.rigConfigsCount,
  }));
  return initialProjects;
}

// arkyo-server: le Server Component devient une page client ; garde,
// chargement (`<LoadingState>`, erreur avec « Réessayer ») et rechargement
// (`router.refresh()`) par `ClientPage`.
export default function ProjectsPage() {
  // RBAC : consultation de la liste projets → projects:read (OWNER bypass).
  return (
    <ClientPage
      permission={PROJECTS_READ}
      icon={<FolderOpen strokeWidth={1.5} />}
      fallbackError="Impossible de charger les projets."
      load={load}
    >
      {(initialProjects) => (
        <Suspense>
          <ProjectsClient initialProjects={initialProjects} />
        </Suspense>
      )}
    </ClientPage>
  );
}
