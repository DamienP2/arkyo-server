"use client";

import { useEffect, useMemo, useState } from "react";
import { Cable as CableIcon, Loader2, Search } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";

/**
 * Dialog de choix d'un MODÈLE DE CÂBLE (CableModel, câble brut) pour une
 * RackConnection. S'ouvre après la pose d'un câble dans le synoptique.
 *
 * Pattern modal aligné sur `AddMapDialog` (Cartographie > Nouveau plan) :
 * header icône+titre+description, body scrollable, footer 2 boutons grid.
 *
 * Layout d'une card : `[Icône+Nom Connecteur G hérité] ─── Modèle/Signal ─── [Icône+Nom Connecteur D hérité]`.
 * Les connecteurs sont **hérités** des ports du synoptique (passés en props),
 * identiques sur toutes les cards — on ne filtre pas le modèle dessus.
 */

type Compatibility = "match" | "warn" | "unknown" | "incompatible";

type CableModelOption = {
  id: string;
  name: string;
  reference: string | null;
  impedance: number | null;
  bandwidthMHz: number | null;
  diameterMm: number | null;
  conductor: string | null;
  shielding: string | null;
  jacketMaterial: string | null;
  fireRating: string | null;
  imageUrl: string | null;
  function: { id: string; label: string; color: string } | null;
  brand: { id: string; name: string; logoUrl: string | null } | null;
  compatibility: Compatibility;
};

type ConnectorMeta = {
  name: string;
  iconId: string;
  color: string;
};

type SignalMeta = {
  name: string | null;
  color: string | null;
  requiredImpedance: number | null;
  minBandwidthMHz: number | null;
  function: { id: string; label: string; color: string } | null;
} | null;

type ApiResponse = {
  models: CableModelOption[];
  leftConnector: ConnectorMeta | null;
  rightConnector: ConnectorMeta | null;
  signal: SignalMeta;
};

/** Connecteur affiché : icône + nom + genre (uppercase mono). */
function ConnectorBlock({
  connector,
  gender,
}: {
  connector: ConnectorMeta | null;
  gender?: string | null;
}) {
  if (!connector)
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-[var(--border)]">
          <span className="text-[var(--muted-foreground)]">—</span>
        </div>
        <span className="text-[10px] text-[var(--muted-foreground)] italic">
          —
        </span>
      </div>
    );
  const g = gender ? GENDER_SHORT[gender.toUpperCase()] ?? null : null;
  return (
    <div className="flex flex-col items-center gap-1">
      <ConnectorIcon
        iconId={connector.iconId}
        color={connector.color}
        size={36}
      />
      <span
        className="text-center text-[11px] leading-tight font-medium text-[var(--foreground)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {connector.name}
      </span>
      {g && (
        <span className="text-muted-foreground text-[9px] font-semibold tracking-wider uppercase">
          {g}
        </span>
      )}
    </div>
  );
}

type Props = {
  open: boolean;
  signalName: string | null;
  fromConnectorName?: string | null;
  toConnectorName?: string | null;
  fromGender?: string | null;
  toGender?: string | null;
  /** Couleur signal venant directement du synoptique (fiable). */
  signalColor?: string | null;
  /** Catégorie/fonction signal (badge), depuis le store synoptique. */
  signalCategory?: string | null;
  defaultModelId?: string | null;
  onConfirm: (cableModelId: string | null) => void;
  onSkip: () => void;
};

/** M / F / I/O — aligné sur cables-section.tsx (Préparation). */
const GENDER_SHORT: Record<string, string> = {
  MALE: "M",
  FEMALE: "F",
  NEUTRAL: "I/O",
};

const COMPAT_LABEL: Record<Compatibility, string> = {
  match: "Compatible",
  warn: "Bande passante limite",
  unknown: "Caractéristiques inconnues",
  incompatible: "Incompatible",
};
const COMPAT_ORDER: Compatibility[] = [
  "match",
  "warn",
  "unknown",
  "incompatible",
];
// arkyo-server: habillage Strata (statut de compatibilité : --success, --warning, --danger)
const COMPAT_DOT: Record<Compatibility, string> = {
  match: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
  unknown: "bg-muted-foreground/40",
  incompatible: "bg-[var(--danger)]",
};

export function SynopticCableModelDialog({
  open,
  signalName,
  fromConnectorName = null,
  toConnectorName = null,
  fromGender = null,
  toGender = null,
  signalColor = null,
  signalCategory = null,
  defaultModelId = null,
  onConfirm,
  onSkip,
}: Props) {
  const [models, setModels] = useState<CableModelOption[]>([]);
  const [leftConnector, setLeftConnector] = useState<ConnectorMeta | null>(null);
  const [rightConnector, setRightConnector] = useState<ConnectorMeta | null>(
    null,
  );
  const [signalMeta, setSignalMeta] = useState<SignalMeta>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  /** Sélection en cours — la validation passe par le bouton du footer, pas
   *  par le simple clic sur une card. */
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch("");
    // Pré-sélectionne le dernier choix au mount (ergonomie : Enter ou click
    // immédiat sur "Valider" reprend le dernier câblage utilisé).
    setSelectedModelId(defaultModelId);
    const params = new URLSearchParams();
    if (signalName) params.set("signalName", signalName);
    if (fromConnectorName) params.set("leftConnector", fromConnectorName);
    if (toConnectorName) params.set("rightConnector", toConnectorName);
    const qs = params.toString();
    const url = qs
      ? `/api/tenant/parametres/cable-models?${qs}`
      : "/api/tenant/parametres/cable-models";
    api
      .get<ApiResponse>(url)
      .then((data) => {
        if (data && Array.isArray(data.models)) {
          setModels(data.models);
          setLeftConnector(data.leftConnector ?? null);
          setRightConnector(data.rightConnector ?? null);
          setSignalMeta(data.signal ?? null);
        } else {
          setModels([]);
          setLeftConnector(null);
          setRightConnector(null);
          setSignalMeta(null);
        }
      })
      .catch(() => {
        setModels([]);
        setLeftConnector(null);
        setRightConnector(null);
        setSignalMeta(null);
      })
      .finally(() => setLoading(false));
  }, [open, signalName, fromConnectorName, toConnectorName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && selectedModelId) onConfirm(selectedModelId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm, selectedModelId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase().trim();
    return models.filter((m) => {
      const hay = [m.name, m.reference, m.brand?.name, m.function?.label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [models, search]);

  const groups = useMemo(() => {
    if (signalName) {
      const map = new Map<Compatibility, CableModelOption[]>();
      for (const m of filtered) {
        const arr = map.get(m.compatibility) ?? [];
        arr.push(m);
        map.set(m.compatibility, arr);
      }
      return COMPAT_ORDER.map((cc) => ({
        key: cc,
        title: COMPAT_LABEL[cc],
        dot: COMPAT_DOT[cc],
        items: map.get(cc) ?? [],
      })).filter((g) => g.items.length > 0);
    }
    const map = new Map<string, CableModelOption[]>();
    for (const m of filtered) {
      const k = m.brand?.name ?? "Sans marque";
      const arr = map.get(k) ?? [];
      arr.push(m);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, items]) => ({
        key: title,
        title,
        dot: null as string | null,
        items,
      }));
  }, [filtered, signalName]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onSkip();
      }}
    >
      <DialogContent className="max-w-3xl p-0">
        {/* Header pattern AddMapDialog */}
        <div className="border-b border-[var(--border)] px-6 py-5 pr-14">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <CableIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-tight font-semibold">
                Choisir un câblage
              </DialogTitle>
              <DialogDescription className="sr-only">
                {signalName
                  ? `Signal ${signalName}`
                  : "Modèle de câble pour cette liaison"}
              </DialogDescription>
            </div>
          </div>

          {/* Bloc visuel câble : [Connecteur G + genre] ──•── (badge cat + signal) ──•── [Connecteur D + genre] */}
          {(() => {
            // Priorité aux props synoptique (toujours fiables) > fallback API.
            const color =
              signalColor ??
              signalMeta?.function?.color ??
              signalMeta?.color ??
              "var(--muted-foreground)";
            const categoryLabel =
              signalCategory ?? signalMeta?.function?.label ?? null;
            const reqImpedance = signalMeta?.requiredImpedance ?? null;
            const minBw = signalMeta?.minBandwidthMHz ?? null;
            return (
              <div className="mt-5 flex items-stretch justify-center gap-4">
                <ConnectorBlock
                  connector={leftConnector}
                  gender={fromGender}
                />

                <div className="flex flex-1 flex-col items-center justify-center">
                  {/* Badge catégorie/fonction + nom signal */}
                  <div className="mb-1.5 flex items-center gap-2">
                    {categoryLabel && (
                      <span
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                        style={{
                          background: `${color}20`,
                          color,
                        }}
                      >
                        {categoryLabel}
                      </span>
                    )}
                    {signalName && (
                      <span
                        className="font-mono text-[12px] font-semibold"
                        style={{ color }}
                      >
                        {signalName}
                      </span>
                    )}
                  </div>

                  {/* Trait coloré avec 2 points aux extrémités */}
                  <div className="flex w-full items-center">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color }}
                    />
                    <span
                      className="h-0.5 flex-1"
                      style={{ background: color }}
                    />
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color }}
                    />
                  </div>

                  {/* Caractéristiques signal attendu */}
                  {(reqImpedance != null || minBw != null) && (
                    <p className="mt-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">
                      {[
                        reqImpedance != null ? `${reqImpedance} Ω` : null,
                        minBw != null ? `≥ ${minBw} MHz` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>

                <ConnectorBlock
                  connector={rightConnector}
                  gender={toGender}
                />
              </div>
            );
          })()}
        </div>

        {/* Search */}
        <div className="border-b border-[var(--border)] px-6 py-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, référence ou marque…"
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pr-3 pl-8 text-sm focus:ring-1 focus:ring-[var(--accent)]/50 focus:outline-none"
            />
          </div>
        </div>

        {/* Body */}
        <div
          className="overflow-y-auto px-6 py-4"
          style={{ maxHeight: "55vh" }}
        >
          {loading && (
            <div className="flex items-center justify-center py-8 text-xs text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Chargement…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="py-8 text-center text-[11px] text-[var(--muted-foreground)]">
              {signalName
                ? "Aucun modèle de câble compatible."
                : "Aucun modèle de câble configuré."}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-4">
              <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.12em] uppercase">
                {g.dot && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${g.dot}`}
                    aria-hidden
                  />
                )}
                {g.title}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((m) => {
                  const isSelected = m.id === selectedModelId;
                  const isLastChoice = m.id === defaultModelId;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModelId(m.id)}
                      onDoubleClick={() => onConfirm(m.id)}
                      className={`flex min-w-0 flex-col items-start rounded-xl border-2 px-3 py-2.5 text-left transition-all hover:border-[var(--accent)]/50 ${isSelected ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-sm" : "border-[var(--border)] hover:bg-[var(--accent)]/5"}`}
                      style={{
                        background: isSelected
                          ? "var(--accent-10, color-mix(in srgb, var(--accent) 10%, var(--surface)))"
                          : "var(--surface)",
                      }}
                    >
                      <div className="flex w-full items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] font-semibold text-[var(--foreground)]">
                          {m.brand?.name
                            ? `${m.brand.name} / ${m.name}`
                            : m.name}
                        </span>
                        {isLastChoice && (
                          <span className="text-muted-foreground shrink-0 text-[9px] tracking-wider uppercase">
                            Dernier
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">
                        {[
                          m.diameterMm ? `Ø${m.diameterMm} mm` : null,
                          m.impedance ? `${m.impedance} Ω` : null,
                          m.bandwidthMHz ? `${m.bandwidthMHz} MHz` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer pattern AddMapDialog */}
        <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)] px-6 py-4">
          <Button variant="outline" onClick={onSkip}>
            Plus tard
          </Button>
          <Button
            variant="accent"
            onClick={() => selectedModelId && onConfirm(selectedModelId)}
            disabled={!selectedModelId}
          >
            {selectedModelId ? "Valider" : "Sélectionnez un câblage"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
