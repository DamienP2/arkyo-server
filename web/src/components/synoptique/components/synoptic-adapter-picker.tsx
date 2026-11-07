"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plug, Loader2, Search } from "@/components/ui/icons";

export type AdapterIO = {
  connectorTypeId?: string;
  gender?: string;
  quantity?: number;
  label?: string;
};

export type AdapterDTO = {
  id: string;
  name: string;
  reference: string | null;
  imageUrl: string | null;
  inputs: AdapterIO[] | null;
  outputs: AdapterIO[] | null;
  notes: string | null;
};

export type AdapterPickerContext = {
  /** Type de connecteur du port source — filtre les adaptateurs compatibles. null = pas de filtre. */
  sourceConnectorTypeId: string | null;
  sourceConnectorTypeName: string | null;
};

type Props = {
  open: boolean;
  context: AdapterPickerContext | null;
  onCancel: () => void;
  onPick: (adapter: AdapterDTO) => void;
};

export function SynopticAdapterPicker({ open, context, onCancel, onPick }: Props) {
  const [adapters, setAdapters] = useState<AdapterDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/tenant/catalogue/adapters")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        // L'API renvoie `{ arkyo: T[], personal: T[] }` — on fusionne (fallback
        // tableau simple par rétro-compat).
        const obj = data as { arkyo?: unknown; personal?: unknown };
        const list = Array.isArray(data)
          ? (data as AdapterDTO[])
          : [
              ...((Array.isArray(obj.arkyo) ? obj.arkyo : []) as AdapterDTO[]),
              ...((Array.isArray(obj.personal) ? obj.personal : []) as AdapterDTO[]),
            ];
        setAdapters(list);
      })
      .catch(() => setAdapters([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const srcType = context?.sourceConnectorTypeId ?? null;
    let list = adapters;
    if (srcType) {
      // Compatible = au moins un input du même connectorTypeId
      list = list.filter(
        (a) => Array.isArray(a.inputs) && a.inputs.some((i) => i.connectorTypeId === srcType),
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) || (a.reference?.toLowerCase().includes(q) ?? false),
      );
    }
    return list;
  }, [adapters, context, search]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)", zIndex: 9999 }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] shadow-2xl"
        style={{ background: "var(--surface)", width: 520, maxHeight: "82vh" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4"
          style={{ background: "var(--secondary)" }}
        >
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
              <Plug className="h-4 w-4" /> Choisir un adaptateur
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
              {context?.sourceConnectorTypeName
                ? `Filtré sur ${context.sourceConnectorTypeName}`
                : "Aucun port cible — tous les adaptateurs disponibles"}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--border)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-[var(--border)] px-5 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom ou référence…"
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pr-3 pl-8 text-sm focus:ring-1 focus:ring-[var(--accent)]/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading && (
            <div className="flex items-center justify-center py-6 text-xs text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Chargement…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="py-6 text-center text-[11px] text-[var(--muted-foreground)]">
              {context?.sourceConnectorTypeId
                ? "Aucun adaptateur compatible avec ce connecteur."
                : "Aucun adaptateur trouvé."}
            </p>
          )}
          <div className="flex flex-col gap-1">
            {filtered.map((a) => {
              const inCount = a.inputs?.reduce((s, i) => s + (i.quantity ?? 1), 0) ?? 0;
              const outCount = a.outputs?.reduce((s, o) => s + (o.quantity ?? 1), 0) ?? 0;
              return (
                <button
                  key={a.id}
                  onClick={() => onPick(a)}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5 text-left transition-all hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/5"
                  style={{ background: "var(--surface)" }}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "var(--secondary)" }}
                  >
                    <Plug className="h-4 w-4 text-[var(--muted-foreground)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-[var(--foreground)]">
                      {a.name}
                    </p>
                    {a.reference && (
                      <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                        Réf. {a.reference}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end text-[10px] text-[var(--muted-foreground)] tabular-nums">
                    <span>{inCount} in</span>
                    <span>{outCount} out</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
