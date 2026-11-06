import { redirect, useParams } from "next/navigation"; // arkyo-server: `params` lus par `useParams` (pas de props de page)
// arkyo-server: `requireTenantPermissionPage` (serveur) remplacé par la garde
// client (contexte de permissions, refus → `/dashboard`).
import { useTenantPermissionPage } from "@/components/client-page";

/**
 * Legacy redirect — `/projects/[id]` redirige vers le mode éditeur projet
 * `/project/[id]?tab=fiche`. Conserve les anciens liens (favoris, emails…).
 */
// arkyo-server: composant client (plus d'`async`) ; `redirect()` lève une
// redirection que suit l'`errorElement` de la route.
export default function LegacyProjectRedirect() {
  // RBAC : défense en profondeur avant de rediriger vers l'éditeur projet.
  const guard = useTenantPermissionPage("projects", "read"); // arkyo-server: garde client
  const { id } = useParams<{ id: string }>();
  if (guard) return guard; // arkyo-server: attente des permissions, ou refus
  redirect(`/project/${id}?tab=fiche`);
}
