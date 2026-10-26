"use client";

/**
 * PresenceAvatars — pile d'avatars sobre des autres membres présents sur la
 * page. Rien n'est rendu si la salle est vide (pas de placeholder).
 *
 * DA : cercles initiales (2 lettres) sur fond `member.color`, texte blanc,
 * chevauchement léger, tooltip = nom. Max 4 visibles + pastille « +N ».
 */

import { cn } from "@/lib/utils";
import {
  presenceInitials,
  useRoomPresence,
  type PresenceMember,
} from "./presence-provider";

const MAX_VISIBLE = 4;

function Avatar({
  member,
  overlap,
}: {
  member: PresenceMember;
  overlap: boolean;
}) {
  return (
    <div
      title={member.name}
      // arkyo-server: habillage Strata
      className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--surface)] text-[9px] font-semibold text-white"
      style={{
        backgroundColor: member.color,
        marginLeft: overlap ? -6 : 0,
      }}
    >
      {presenceInitials(member.name)}
    </div>
  );
}

export function PresenceAvatars({ className }: { className?: string }) {
  const members = useRoomPresence();
  if (members.length === 0) return null;

  const visible = members.slice(0, MAX_VISIBLE);
  const extra = members.length - visible.length;

  return (
    <div className={cn("flex items-center", className)}>
      {visible.map((m, i) => (
        <Avatar key={m.userId} member={m} overlap={i > 0} />
      ))}
      {extra > 0 && (
        <div
          title={`${extra} autre${extra > 1 ? "s" : ""}`}
          // arkyo-server: habillage Strata
          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--muted)] text-[9px] font-semibold text-[var(--muted-foreground)]"
          style={{ marginLeft: -6 }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}
