"use client";

/**
 * PermButton — bouton wrappé d'un check de permission.
 *
 * Usage :
 *   <PermButton permission="users.delete" mode="hide" onClick={handleDelete}>
 *     Supprimer
 *   </PermButton>
 *
 *   // Plusieurs permissions (au moins une suffit) :
 *   <PermButton permission={["spaces.suspend", "spaces.archive"]} mode="disable">
 *     Modifier
 *   </PermButton>
 *
 * Modes :
 *  - `hide`    : si pas la permission → ne rend rien (DOM absent). Recommandé
 *                pour les actions destructives (Supprimer, Suspendre…).
 *  - `disable` : si pas la permission → bouton rendu mais `disabled` + tooltip.
 *                Recommandé pour les actions courantes (Modifier, Notes…).
 *
 * Pendant le chargement initial des permissions (`loading=true`), le composant
 * traite l'utilisateur comme s'il n'avait PAS la permission → masquage par
 * défaut. Cohérent avec la décision "tout caché par défaut".
 */

import * as React from "react";
import { useCurrentPermissions } from "@/lib/permissions/permissions-context";

type Mode = "hide" | "disable";

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Clé(s) de permission requise(s). Tableau = au moins une suffit (any-of). */
  permission: string | ReadonlyArray<string>;
  /** Comportement quand la permission manque. Défaut : "hide". */
  mode?: Mode;
  children: React.ReactNode;
};

export const PermButton = React.forwardRef<HTMLButtonElement, Props>(function PermButton(
  { permission, mode = "hide", disabled, title, children, ...rest },
  ref,
) {
  const { has, hasAny, loading } = useCurrentPermissions();
  const allowed = Array.isArray(permission) ? hasAny(permission) : has(permission as string);

  if (!allowed && mode === "hide") return null;

  const requiredText = Array.isArray(permission) ? permission.join(" / ") : permission;
  const permTitle = !allowed
    ? loading
      ? "Chargement des permissions…"
      : `Action réservée — permission requise : ${requiredText}`
    : title;

  return (
    <button ref={ref} disabled={disabled || !allowed} title={permTitle} {...rest}>
      {children}
    </button>
  );
});

/**
 * IfPerm — wrapper conditionnel pour un bloc d'UI quelconque (section entière,
 * lien, badge, etc.).
 *
 *   <IfPerm permission="users.view_billing">
 *     <BillingPanel ... />
 *   </IfPerm>
 *
 * Pas de mode "disable" ici (n'a pas de sens pour un bloc générique). Si tu
 * veux désactiver un bouton spécifique, utilise <PermButton mode="disable">.
 */
export function IfPerm({
  permission,
  fallback = null,
  children,
}: {
  permission: string | ReadonlyArray<string>;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { has, hasAny } = useCurrentPermissions();
  const allowed = Array.isArray(permission) ? hasAny(permission) : has(permission as string);
  return allowed ? <>{children}</> : <>{fallback}</>;
}
