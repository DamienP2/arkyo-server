"use client";

/**
 * Sélecteur d'espace du projet (interface Strata v2, spec v2 §4) :
 * `Concevoir` · `Gérer`. L'espace est porté par l'URL de l'éditeur projet :
 * `?space=gerer` pour Gérer, rien pour Concevoir (qui garde `?tab=`, même
 * stockage local qu'arkyo). Les autres paramètres de l'URL sont conservés.
 */

import type { MouseEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { LayoutList, Workflow } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export const SPACE_PARAM = "space";
export type ProjectSpace = "concevoir" | "gerer";

export function spaceOf(params: { get(name: string): string | null } | null | undefined): ProjectSpace {
  return params?.get(SPACE_PARAM) === "gerer" ? "gerer" : "concevoir";
}

/** Espace du projet ouvert (`?space=`). */
export function useProjectSpace(): ProjectSpace {
  return spaceOf(useSearchParams());
}

/** Requête de l'URL courante, dans l'espace `space`. */
export function spaceQuery(current: { toString(): string } | null | undefined, space: ProjectSpace): string {
  const query = new URLSearchParams(current?.toString() ?? "");
  if (space === "gerer") query.set(SPACE_PARAM, "gerer");
  else query.delete(SPACE_PARAM);
  return query.toString();
}

const SPACES: { id: ProjectSpace; label: string; icon: typeof Workflow }[] = [
  { id: "concevoir", label: "Concevoir", icon: Workflow },
  { id: "gerer", label: "Gérer", icon: LayoutList },
];

export function SpaceSwitch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const space = spaceOf(searchParams);

  const go = (e: MouseEvent<HTMLAnchorElement>, next: ProjectSpace) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (next === space) return;
    router.replace(`/project/${params?.id}?${spaceQuery(searchParams, next)}`, { scroll: false });
  };

  return (
    <nav
      aria-label="Espace du projet"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-[3px]"
    >
      {SPACES.map(({ id, label, icon: Icon }) => {
        const on = id === space;
        return (
          <a
            key={id}
            href={`?${spaceQuery(searchParams, id)}`}
            onClick={(e) => go(e, id)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-[5px] text-[13px] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              on
                ? "bg-[var(--card)] text-[var(--foreground)] shadow-[0_0_0_1px_var(--border-strong)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", on && "text-[var(--accent-strong)]")} />
            {label}
          </a>
        );
      })}
    </nav>
  );
}
