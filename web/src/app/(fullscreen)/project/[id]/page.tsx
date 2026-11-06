// arkyo-server: `auth` / `requireTenantDb` / `getTenantSlug` / `mainDb` /
// `fetchCatalogEquipmentMap` / `fetchCatalogAdapterMap` (serveur) remplacés
// par `ClientPage` et l'API. La requête Prisma de la page, l'enrichissement du
// catalogue, la couleur de catégorie du BOM, `ficheData` et les `racks`
// (`InventaireRack[]`) sont construits par
// `GET /api/tenant/projects/:id/editor`, qui renvoie exactement
// `ProjectEditorData` (`cartographie.maps = []` jusqu'à la phase 5).
import { useParams } from "next/navigation";
import { ClientPage } from "@/components/client-page";
import { FolderOpen } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import { ProjectEditor, type ProjectEditorData } from "./_components/project-editor";

async function load(id: string) {
  // Le layout `(fullscreen)` ne wrappe pas avec `TenantMembershipProvider` :
  // on récupère ici le nom du tenant pour l'afficher en breadcrumb dans la
  // topbar globale.
  // arkyo-server: nom du site (`AppConfig site.name`, `GET /api/site`) à la
  // place du nom du tenant ; vide → `null`, comme l'éditeur de panel.
  const [tenantName, data] = await Promise.all([
    api.get<{ name?: string | null }>("/api/site").then((s) => s.name || null),
    // 404 → `notFound()`.
    api.get<ProjectEditorData>(`/api/tenant/projects/${encodeURIComponent(id)}/editor`),
  ]);
  return { data, tenantName };
}

/**
 * Page éditeur projet (mode plein écran) — `EditorShell` partagé avec le
 * rack-editor. Tous les onglets (Fiche / Inventaire / Schéma / Synoptique /
 * Cartographie / Câblage / Réseau / Recette / Documents) sont rendus dans le
 * shell via le slot `canvas`, le switch d'onglet est local à
 * `ProjectEditor` (pill à cheval dans la topbar globale).
 *
 * Les sous-routes éditeur lourdes (`inventaire/rack/[rackId]`,
 * `inventaire/synoptique`) restent montées dans le route group `(fullscreen)`
 * et conservent leur propre RackEditor plein écran.
 */
// arkyo-server: le Server Component devient une page client ; chargement
// (`<LoadingState>`, erreur avec « Réessayer », 404) et rechargement
// (`router.refresh()`) par `ClientPage`. La page n'exige qu'une session
// (`permission={null}`) : la garde `projects:read` est celle du layout.
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ClientPage
      permission={null}
      icon={<FolderOpen strokeWidth={1.5} />}
      fallbackError="Impossible de charger le projet."
      load={() => load(id)}
      loadKey={id}
    >
      {({ data, tenantName }) => <ProjectEditor project={data} tenantName={tenantName} />}
    </ClientPage>
  );
}
