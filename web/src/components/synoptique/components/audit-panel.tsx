"use client";

import { useState, useEffect } from "react";
import {
  Cable,
  SquareStack,
  Layers,
  Square,
  Tag,
  Plug,
  Box,
  History,
  RotateCw,
} from "@/components/ui/icons";
import { formatAuditAction, groupByDay, type AuditCategory } from "@/lib/services/audit-format";
// AuditCategory utilisé via iconForCategory(f.category)
import { cn } from "@/lib/utils";

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string | null } | null;
};

type Props =
  | { rackId: string; projectId?: never }
  | { rackId?: never; projectId: string };

/**
 * Contenu de l'historique — rendu dans l'overlayPanel du RightPanel.
 *
 * Deux modes mutuellement exclusifs :
 *   - rackId  → historique rack-scoped (focus rack)
 *   - projectId → historique projet (vue Générale, agrégation multi-rack)
 */
export function AuditPanelContent(props: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  // Discriminant entre les 2 endpoints. On le calcule en amont pour pouvoir
  // l'utiliser comme dep stable du useEffect.
  const endpoint = props.rackId
    ? `/api/racks/${props.rackId}/audit?limit=150`
    : `/api/tenant/projects/${props.projectId}/audit?limit=150`;

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      if (res.ok) setEntries(await res.json());
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  const byDay = groupByDay(entries);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2">
        <span className="text-muted-foreground text-[11px]">
          {entries.length} entrée{entries.length > 1 ? "s" : ""}
        </span>
        <button
          onClick={() => void load()}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-1 hover:bg-[var(--muted)]/40"
          title="Rafraîchir"
        >
          <RotateCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && entries.length === 0 && (
          <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
            Chargement…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
            Aucune entrée.
          </div>
        )}
        {Array.from(byDay.entries()).map(([day, items]) => (
          <div key={day}>
            <div className="text-muted-foreground sticky top-0 z-10 bg-[var(--muted)]/60 px-3 py-1 text-[10px] font-semibold tracking-wider uppercase backdrop-blur">
              {formatDay(day)}
            </div>
            <div className="divide-y divide-[var(--border)]">
              {items.map((e) => (
                <AuditRow key={e.id} entry={e} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const f = formatAuditAction(entry.action);
  const Icon = iconForCategory(f.category);
  const userName = entry.user?.name || entry.user?.email || "Utilisateur inconnu";
  const time = new Date(entry.createdAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-[var(--muted)]/40">
      <Icon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-sm">{f.label}</div>
        <div className="text-muted-foreground text-[11px]">
          {userName} · {time}
        </div>
      </div>
    </div>
  );
}

function iconForCategory(c: AuditCategory) {
  switch (c) {
    case "cable":
      return Cable;
    case "slot":
      return SquareStack;
    case "panel":
      return Layers;
    case "zone":
      return Square;
    case "label":
      return Tag;
    case "adapter":
      return Plug;
    case "bundle":
      return Box;
    case "rack":
      return SquareStack;
    default:
      return History;
  }
}

function formatDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Aujourd'hui";
  if (sameDay(date, yesterday)) return "Hier";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}
