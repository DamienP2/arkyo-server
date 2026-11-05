// arkyo-server: `auth` / `mainDb` / `getTenantSlug` / `getTenantMembership`
// (serveur) remplacés par `ClientPage` et l'API ; la session est assurée par le
// layout (`/auth` sans session).
import { ClientPage } from "@/components/client-page";
import { User } from "@/components/ui/icons";
import { api } from "@/lib/api-client";

import { ProfileClient, type ProfileData } from "./profile-client";

// arkyo-server: `export const dynamic = "force-dynamic"` retiré (pas de SSR).

/**
 * arkyo-server: SPA sans SSR — le Server Component devient un composant client.
 * `GET /api/tenant/profile` renvoie le `ProfileData` qu'arkyo composait à
 * partir du user, de son profil, du membership et du tenant (ici le site).
 * `<LoadingState>` pendant le chargement, erreur avec « Réessayer » si la
 * lecture échoue ; `router.refresh()` (après enregistrement) relit le profil.
 */
export default function ProfilePage() {
  return (
    <ClientPage
      permission={null}
      icon={<User strokeWidth={1.5} />}
      fallbackError="Impossible de charger le profil."
      load={loadProfile}
    >
      {(data) => <ProfileClient data={data} />}
    </ClientPage>
  );
}

function loadProfile(): Promise<ProfileData> {
  return api.get<ProfileData>("/api/tenant/profile");
}
