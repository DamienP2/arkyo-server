import { redirect } from "next/navigation";
// arkyo-server: `requireTenantPermissionPage` (serveur) remplacé par la garde
// client (contexte de permissions, refus → `/dashboard`).
import { useTenantPermissionPage } from "@/components/client-page";

// arkyo-server: composant client (plus d'`async`) ; `redirect()` lève une
// redirection que suit l'`errorElement` de la route.
export default function RacksPage() {
  // RBAC : liste des contenants → design:read (défense avant redirection).
  const guard = useTenantPermissionPage("design", "read"); // arkyo-server: garde client
  if (guard) return guard; // arkyo-server: attente des permissions, ou refus
  redirect("/templates?tab=racks");
}
