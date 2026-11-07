"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "@/components/ui/icons";

import { api } from "@/lib/api-client";

/**
 * Picker pour sélectionner un modèle de câble physique (`CableModel`) sur
 * une connexion. Fetch la liste depuis `/api/tenant/parametres/cable-models`
 * (catalogue main, soft-FK). UI alignée sur les autres dropdowns du synoptique
 * (sobriété DA arkyo) : combobox compacte avec recherche, regroupement par
 * marque, item « Aucun ».
 */

type Compatibility = "match" | "warn" | "unknown" | "incompatible";

type CableModelOption = {
  id: string;
  name: string;
  reference: string | null;
  impedance: number | null;
  bandwidthMHz: number | null;
  diameterMm: number | null;
  function: { id: string; label: string; color: string } | null;
  brand: { id: string; name: string; logoUrl: string | null } | null;
  compatibility: Compatibility;
};

export function SynopticCableModelPicker({
  value,
  onChange,
  signalName,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Nom du signal de la connexion (filtre auto via SignalType.name). */
  signalName?: string | null;
}) {
  const [models, setModels] = useState<CableModelOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Lazy-fetch — re-fetch quand le signal change pour rafraîchir le scoring.
  const ensureLoaded = useCallback(async () => {
    try {
      const url = signalName
        ? `/api/tenant/parametres/cable-models?signalName=${encodeURIComponent(signalName)}`
        : "/api/tenant/parametres/cable-models";
      // L'API retourne désormais { models, leftConnector, rightConnector }.
      const data = (await api.get(url)) as
        | CableModelOption[]
        | { models: CableModelOption[] };
      const list = Array.isArray(data) ? data : data?.models ?? [];
      setModels(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("[synoptic] fetch cable-models failed:", e);
      setModels([]);
    }
  }, [signalName]);

  // Reset cache quand le signal change pour que la prochaine ouverture
  // récupère les nouveaux scores.
  useEffect(() => {
    setModels(null);
  }, [signalName]);

  // Fetch immédiat dès qu'une valeur est définie — sinon le label du câble
  // sélectionné n'apparaît pas tant que l'utilisateur n'a pas ouvert le
  // dropdown. Le fetch a aussi lieu à l'ouverture si pas encore chargé.
  useEffect(() => {
    if (value && models === null) void ensureLoaded();
  }, [value, models, ensureLoaded]);

  useEffect(() => {
    if (open && models === null) void ensureLoaded();
  }, [open, models, ensureLoaded]);

  const selected = useMemo(
    () => (value && models ? models.find((m) => m.id === value) ?? null : null),
    [models, value],
  );

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => {
      const hay = [
        m.name,
        m.reference,
        m.brand?.name,
        m.function?.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [models, query]);

  // Regroupement :
  //  - Si un signal est défini → groupes par compatibilité (Compatible /
  //    Bande passante limite / Caractéristiques inconnues / Incompatible).
  //  - Sinon → groupes par marque (cas générique, pas de filtre signal).
  const grouped = useMemo(() => {
    const groups = new Map<string, CableModelOption[]>();
    if (signalName) {
      const COMPAT_LABEL: Record<Compatibility, string> = {
        match: "Compatible",
        warn: "Bande passante limite",
        unknown: "Caractéristiques inconnues",
        incompatible: "Incompatible",
      };
      const ORDER: Compatibility[] = [
        "match",
        "warn",
        "unknown",
        "incompatible",
      ];
      for (const m of filtered) {
        const key = COMPAT_LABEL[m.compatibility];
        const arr = groups.get(key) ?? [];
        arr.push(m);
        groups.set(key, arr);
      }
      return ORDER.map((c) => [COMPAT_LABEL[c], groups.get(COMPAT_LABEL[c]) ?? []] as const).filter(
        ([, arr]) => arr.length > 0,
      );
    }
    for (const m of filtered) {
      const key = m.brand?.name ?? "Sans marque";
      const arr = groups.get(key) ?? [];
      arr.push(m);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, signalName]);

  // arkyo-server: habillage Strata (compatibilité = statut : --success, --warning, --danger)
  const compatDot = (c: Compatibility) => {
    if (c === "match") return "bg-[var(--success)]";
    if (c === "warn") return "bg-[var(--warning)]";
    if (c === "incompatible") return "bg-[var(--danger)]";
    return "bg-muted-foreground/40";
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="border-border bg-card hover:border-border/80 flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors"
      >
        <div className="min-w-0 flex-1">
          {selected ? (
            <div className="truncate">
              {selected.brand?.name && (
                <span className="text-muted-foreground">
                  {selected.brand.name}
                  {" · "}
                </span>
              )}
              <span className="font-medium">{selected.name}</span>
              {selected.reference && (
                <span className="text-muted-foreground">
                  {" · "}
                  {selected.reference}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">Aucun câble assigné…</span>
          )}
        </div>
        <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <div className="border-border bg-popover absolute left-0 right-0 z-50 mt-1 max-h-[300px] overflow-hidden rounded-md border shadow-lg">
          {/* Recherche */}
          <div className="border-border/60 flex items-center gap-1.5 border-b px-2 py-1.5">
            <Search className="text-muted-foreground h-3 w-3" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              className="w-full bg-transparent text-[11px] outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {/* Aucun */}
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="hover:bg-muted/50 flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px]"
            >
              {value === null && <Check className="h-3 w-3 text-[var(--accent)]" />}
              <span
                className={`flex-1 italic ${value === null ? "text-[var(--accent)]" : "text-muted-foreground"}`}
              >
                Aucun câble
              </span>
            </button>
            {models === null && (
              <div className="text-muted-foreground px-2.5 py-3 text-center text-[10px]">
                Chargement…
              </div>
            )}
            {models !== null && filtered.length === 0 && (
              <div className="text-muted-foreground px-2.5 py-3 text-center text-[10px]">
                Aucun résultat
              </div>
            )}
            {grouped.map(([brandName, items]) => (
              <div key={brandName}>
                <div className="text-muted-foreground bg-muted/30 sticky top-0 px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] uppercase">
                  {brandName}
                </div>
                {items.map((m) => {
                  const isSel = m.id === value;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                      className={`hover:bg-muted/50 flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[11px] ${isSel ? "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : ""}`}
                    >
                      {isSel ? (
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-[var(--accent)]" />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {signalName && (
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${compatDot(m.compatibility)}`}
                              aria-hidden
                            />
                          )}
                          <span className="font-medium">{m.name}</span>
                          {m.function?.label && (
                            <span
                              className="rounded px-1 py-0.5 text-[9px] tracking-wider"
                              style={{
                                background: `${m.function.color}20`,
                                color: m.function.color,
                              }}
                            >
                              {m.function.label}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground mt-0.5 truncate text-[10px]">
                          {[
                            m.reference,
                            m.impedance ? `${m.impedance} Ω` : null,
                            m.bandwidthMHz ? `${m.bandwidthMHz} MHz` : null,
                            m.diameterMm ? `Ø${m.diameterMm} mm` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
