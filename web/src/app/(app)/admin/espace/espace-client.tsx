"use client";

/**
 * /admin/espace — orchestrateur client à 3 sub-tabs dans la topbar :
 *
 *   Informations    (identité + paramètres + zone dangereuse)
 *   Abonnements     (plan actuel + demande de changement)
 *   Factures        (liste paiements)
 *
 * arkyo-server: seul l'onglet Informations est repris (Abonnements et Factures,
 * SaaS, sont retirés ; la pastille de navigation reste dans la topbar).
 *
 * Pattern identique à `parametres-client.tsx` / `catalogue-client.tsx` :
 *  - pill nav rendu dans la topbar via `useTopbarTabs`
 *  - section active persistée en localStorage (`tenant.admin.espace.subtab`)
 *  - chaque sub-tab est un composant isolé sous `_components/`
 */

import { useEffect } from "react";
import { UserCog } from "@/components/ui/icons"; // arkyo-server: CreditCard, FileText retirés (onglets SaaS)

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { useTopbarTabs } from "@/lib/topbar-tabs-context";
import { cn } from "@/lib/utils";

// arkyo-server: AbonnementsTab et FacturesTab (abonnement, factures) retirés : SaaS.
import { InformationsTab } from "./_components/informations-tab";

// arkyo-server: forme de `GET /api/tenant/espace/informations` ; slug, plan,
// statut, offres de courtoisie, essai et date de création (SaaS) retirés.
export type EspaceTenant = {
  id: string;
  name: string;
  logoUrl: string | null;
};

type SubTab = "informations"; // arkyo-server: "abonnements" | "factures" retirés (SaaS)

const STORAGE_KEY = "tenant.admin.espace.subtab";

function isSubTab(v: unknown): v is SubTab {
  return v === "informations"; // arkyo-server: onglets SaaS retirés
}

const TABS: {
  key: SubTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "informations", label: "Informations", icon: UserCog },
  // arkyo-server: onglets Abonnements et Factures retirés (SaaS)
];

type Props = {
  tenant: EspaceTenant;
  isOwner: boolean;
};

export function EspaceClient({ tenant, isOwner }: Props) {
  const [subTab, setSubTab] = useLocalStorageState<SubTab>(STORAGE_KEY, "informations", {
    isValid: isSubTab,
  });
  const { setTabs } = useTopbarTabs();

  useEffect(() => {
    setTabs(
      <div className="flex items-center gap-0.5 rounded-full bg-[var(--background)] p-0.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === subTab;
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-all",
                active
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>,
    );
    return () => setTabs(null);
  }, [subTab, setSubTab, setTabs]);

  return (
    <>
      {subTab === "informations" && <InformationsTab tenant={tenant} isOwner={isOwner} />}
      {/* arkyo-server: onglets Abonnements et Factures retirés (SaaS) */}
    </>
  );
}
