"use client";

/**
 * TenantPermButton — bouton wrappé d'un check de permission RBAC tenant.
 * Miroir de `components/ui/perm-button.tsx` (supervisor), version tenant.
 *
 * Usage :
 *   <TenantPermButton domain="members" level="admin" mode="hide" onClick={onDelete}>
 *     Supprimer
 *   </TenantPermButton>
 *
 * Modes :
 *  - `hide`    : sans la permission → rien (DOM absent). Actions destructives.
 *  - `disable` : sans la permission → bouton `disabled` + tooltip. Actions courantes.
 *
 * Pendant le chargement des permissions, l'utilisateur est traité comme s'il
 * n'avait PAS la permission (caché par défaut). OWNER ⇒ toujours autorisé.
 */

import * as React from "react";
import { useTenantPermissions } from "@/components/tenant-permissions-context";
import type { TenantDomain, TenantLevel } from "@/lib/tenant-permissions";

type Mode = "hide" | "disable";

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  domain: TenantDomain;
  level: TenantLevel;
  /** Comportement quand la permission manque. Défaut : "hide". */
  mode?: Mode;
  children: React.ReactNode;
};

export const TenantPermButton = React.forwardRef<HTMLButtonElement, Props>(
  function TenantPermButton({ domain, level, mode = "hide", disabled, title, children, ...rest }, ref) {
    const { has, loading } = useTenantPermissions();
    const allowed = has(domain, level);

    if (!allowed && mode === "hide") return null;

    const permTitle = !allowed
      ? loading
        ? "Chargement des permissions…"
        : "Action réservée par votre rôle."
      : title;

    return (
      <button ref={ref} disabled={disabled || !allowed} title={permTitle} {...rest}>
        {children}
      </button>
    );
  },
);

/**
 * IfTenantPerm — wrapper conditionnel pour un bloc d'UI (section, lien, badge…).
 *
 *   <IfTenantPerm domain="settings" level="admin">
 *     <DangerZone />
 *   </IfTenantPerm>
 */
export function IfTenantPerm({
  domain,
  level,
  fallback = null,
  children,
}: {
  domain: TenantDomain;
  level: TenantLevel;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { has } = useTenantPermissions();
  return has(domain, level) ? <>{children}</> : <>{fallback}</>;
}
