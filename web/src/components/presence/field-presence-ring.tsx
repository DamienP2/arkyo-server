"use client";

/**
 * FieldPresenceRing — primitive réutilisable « X édite ce champ ».
 *
 * Enveloppe UN champ (input, textarea, picker, slider…) et fait deux choses :
 *
 *  1. **Report** : sur `focusin` d'un descendant → `reportEditingField(field)` ;
 *     sur `focusout` qui quitte réellement le wrapper → `reportEditingField(null)`.
 *     On s'appuie sur le bubbling de `onFocus`/`onBlur` (focusin/focusout) : le
 *     wrapper capte le focus de n'importe quel enfant, sans toucher au champ.
 *
 *  2. **Indication** : si un AUTRE membre édite ce champ, on affiche un liseré
 *     à sa couleur (box-shadow 2 px) + un mini-avatar accolé au coin. JAMAIS de
 *     blocage — le champ reste éditable.
 *
 * Sans `PresenceProvider` monté (ex. supervisor), les hooks retombent sur les
 * valeurs par défaut du contexte : report = no-op, aucun liseré. Le wrapper est
 * donc sûr à utiliser dans des composants partagés.
 *
 * Extensible aux éditeurs adaptateur / câble sans duplication : il suffit de
 * wrapper leurs champs avec la même primitive.
 */

import { cn } from "@/lib/utils";
import {
  presenceInitials,
  useFieldPresence,
  useReportEditingField,
  type PresenceMember,
} from "./presence-provider";

function PresenceBadge({ members }: { members: PresenceMember[] }) {
  const first = members[0];
  if (!first) return null;
  const names = members.map((m) => m.name).join(", ");
  const label =
    members.length === 1
      ? `${first.name} édite ce champ`
      : `${names} éditent ce champ`;
  return (
    <span
      title={label}
      className="pointer-events-none absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--card)] text-[7px] font-bold text-white shadow-sm"
      style={{ backgroundColor: first.color }}
    >
      {presenceInitials(first.name)}
    </span>
  );
}

export function FieldPresenceRing({
  field,
  children,
  className,
}: {
  /** Clé stable du champ (unique dans la page/salle). Ex. "name", "weight". */
  field: string;
  children: React.ReactNode;
  className?: string;
}) {
  const report = useReportEditingField();
  const others = useFieldPresence(field);
  const active = others[0] ?? null;

  return (
    <div
      className={cn("relative rounded-lg", className)}
      // focusin/focusout bubblent → on capte le focus de n'importe quel
      // descendant (input, bouton picker, slider) sans instrumenter le champ.
      onFocus={() => report(field)}
      onBlur={(e) => {
        // Ne signale la sortie que si le focus quitte réellement le wrapper
        // (évite le flicker quand on passe d'un sous-élément à un autre).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          report(null);
        }
      }}
      style={active ? { boxShadow: `0 0 0 2px ${active.color}` } : undefined}
    >
      {children}
      {active && <PresenceBadge members={others} />}
    </div>
  );
}
