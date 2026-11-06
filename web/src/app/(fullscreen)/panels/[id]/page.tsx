// arkyo-server: `requireTenantDb` / `getTenantSlug` / `mainDb` /
// `requireTenantPermissionPage` (serveur) remplacés par `ClientPage`
// (contexte de permissions) et l'API.
import { useParams } from "next/navigation";
import { ClientPage } from "@/components/client-page";
import { LayoutPanelTop } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
// arkyo-server: `fetchCatalogConnectorTypeMap` (lib/services/catalog-enrich)
// et `withDerivedHasNeutrikD` (app/api/_lib/connector-dtype) retirés : l'API
// enrichit les slots et dérive `hasNeutrikD` / `dTypeSvgUrl`.
import { PanelEditor } from "./panel-editor";

const DESIGN_WRITE = ["design", "write"] as const;

type CatalogFunction = { key: string; label: string; color: string; sortOrder: number };
type ConnectorType = {
  iconId?: string | null;
  svgUrl?: string | null;
  hasNeutrikD: boolean;
  dTypeSvgUrl: string | null;
  functions: { functionId: string; function: CatalogFunction }[];
};

async function load(id: string) {
  // Nom du tenant pour le lockup de la topbar (pattern aligné sur rack page.tsx).
  // arkyo-server: nom du site (`AppConfig site.name`, `GET /api/site`) à la
  // place du nom du tenant ; vide → `null`, comme un tenant introuvable.
  const [tenantName, panelRaw, availableConnectorsRaw, allFunctions] = await Promise.all([
    api.get<{ name?: string | null }>("/api/site").then((s) => s.name || null),
    // arkyo-server: `GET /api/panels/:id` reprend la requête de la page :
    // `slots` par `position` asc. 404 → `notFound()`.
    api.get<Record<string, unknown>>(`/api/panels/${encodeURIComponent(id)}`),
    // Inclut les fonctions associées (CatalogConnectorTypeFunction → CatalogFunction)
    // — c'est là que vivent les "catégories" du connecteur (HF, Vidéo, Audio…).
    // arkyo-server: catalogue local (phase 2), `GET /api/tenant/catalogue/connectors` :
    // connecteurs actifs par nom, `functions: [{ functionId, function }]`,
    // `hasNeutrikD` et `dTypeSvgUrl` déjà dérivés.
    api.get<ConnectorType[]>("/api/tenant/catalogue/connectors"),
    // Liste complète des fonctions pour le filtre par catégorie. Tri par sortOrder.
    // arkyo-server: fonctions actives du catalogue local, par `sortOrder` puis
    // `label` (`GET /api/tenant/parametres/categories`).
    api
      .get<{ functions: { personal: CatalogFunction[] } }>("/api/tenant/parametres/categories")
      .then((r) => r.functions.personal),
  ]);

  // Enrich panel slots with connectorType cross-DB
  // arkyo-server: fait par l'API (chaque slot porte déjà `connectorTypeId` et
  // `connectorType` ou `null`).
  const panel = panelRaw;

  // Catégories compatibles = TOUTES les fonctions associées (un connecteur
  // peut appartenir à plusieurs catégories : ex. XLR → Audio + Intercom).
  // `category` (legacy, première fonction) conservé pour les références
  // existantes mais `categories` est la source de vérité pour le filtre
  // et le regroupement dans le side panel.
  //
  // `hasNeutrikD`/`dTypeSvgUrl` : dérivés du symbole référencé (jamais stockés
  // sur le connecteur, cf. app/api/_lib/connector-dtype.ts) — la palette du
  // panel editor en a besoin pour n'autoriser la pose en coque D que sur les
  // connecteurs qui existent effectivement en version D.
  // arkyo-server: dérivés par l'API (`withDerivedHasNeutrikD` porté côté serveur).
  const availableConnectorsWithD = availableConnectorsRaw;
  const availableConnectors = availableConnectorsWithD.map((c) => {
    const fns = c.functions
      .map((f) => f.function)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      ...c,
      category: fns[0]?.label ?? "OTHER",
      categories: fns.length > 0 ? fns.map((f) => f.label) : ["OTHER"],
    };
  });

  // Liste des catégories disponibles (= fonctions catalogue) — utilisée
  // par le filtre multi-sélection du panel-editor.
  const connectorCategories = allFunctions.map((f) => ({
    name: f.label,
    color: f.color,
    sortOrder: f.sortOrder,
  }));

  return { panel, availableConnectors, connectorCategories, tenantName };
}

// arkyo-server: le Server Component devient une page client ; garde,
// chargement (`<LoadingState>`, erreur avec « Réessayer », 404) et
// rechargement (`router.refresh()`) par `ClientPage`.
export default function PanelEditorPage() {
  const { id } = useParams<{ id: string }>();
  // RBAC : ouverture de l'éditeur de panel → design:write (OWNER bypass).
  return (
    <ClientPage
      permission={DESIGN_WRITE}
      icon={<LayoutPanelTop strokeWidth={1.5} />}
      fallbackError="Impossible de charger le panel."
      load={() => load(id)}
      loadKey={id}
    >
      {({ panel, availableConnectors, connectorCategories, tenantName }) => (
        <PanelEditor
          panel={panel as any}
          availableConnectors={availableConnectors as any}
          connectorCategories={connectorCategories as any}
          tenantName={tenantName}
        />
      )}
    </ClientPage>
  );
}
