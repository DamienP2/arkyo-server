"use client";

/**
 * ConnectorIconPickerModal — modal de sélection d'une icône pour un
 * CatalogConnectorType / TenantConnectorType.
 *
 * Aligné sur les patterns `*PickerModal` du catalogue (Connector, Brand,
 * Function) :
 *  - Dialog Radix avec header / toolbar recherche / body grille / footer.
 *  - Cards toggleables (border + bg accent quand actif, ring offset).
 *  - Onglet "Bibliothèque" (icônes built-in `BUILTIN_CONNECTOR_ICONS`) +
 *    onglet "SVG perso" (URL + upload).
 *  - Buffer interne : la sélection n'est commitée qu'au Confirmer.
 *
 * Le composant remplace l'ancien `IconTriggerPopover` inline (popover ancré
 * au bouton) au profit d'une vraie Dialog modale plus large et navigable.
 *
 * Trigger associé : `ConnectorIconPickerTrigger` — bouton style PickerTrigger
 * cohérent avec `BrandPickerTrigger` / `ConnectorPickerTrigger`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2, Search, Upload, X } from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BUILTIN_CONNECTOR_ICONS,
  ConnectorIcon,
  D_TYPE_KEYS,
} from "@/components/ui/connector-icon";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type ConnectorIconSource = "icon" | "svg";

export type ConnectorIconPickerValue = {
  source: ConnectorIconSource;
  iconId: string;
  svgUrl: string;
  /**
   * Disponibilité Neutrik D du symbole sélectionné (dérivée) : builtin ∈
   * D_TYPE_KEYS, ou custom avec version D uploadée. Renseignée par le picker à
   * la sélection ; consommée en lecture seule par le formulaire connecteur.
   */
  hasD?: boolean;
  /**
   * URL du visuel Neutrik D d'un symbole custom (null pour un builtin — sa
   * version D est rendue via `dType`). Propagée par le picker à la sélection.
   */
  svgUrlD?: string | null;
};

// ── Modèle de symbole (builtin + custom) ─────────────────────────────────────

/** Forme brute tolérée : superviseur (`CatalogSymbol`) ou tenant. */
export type ConnectorIconPickerSymbol = {
  id?: string;
  key?: string;
  label?: string;
  isBuiltin?: boolean;
  svgUrl?: string | null;
  /** Dérivé renvoyé par l'API liste des symboles (custom → svgUrlD != null). */
  hasD?: boolean;
  svgUrlD?: string | null;
};

/** Symbole normalisé pour l'affichage : builtin (rendu par `key`) ou custom (img). */
type PickerSymbol = {
  key: string;
  label: string;
  isBuiltin: boolean;
  svgUrl: string | null;
  svgUrlD: string | null;
  hasD: boolean;
};

/** Repli statique — le picker n'est jamais vide même si l'API échoue. */
const FALLBACK_SYMBOLS: PickerSymbol[] = BUILTIN_CONNECTOR_ICONS.map((i) => ({
  key: i.id,
  label: i.label,
  isBuiltin: true,
  svgUrl: null,
  svgUrlD: null,
  hasD: D_TYPE_KEYS.has(i.id),
}));

/** Tolère `T[]` ou `{ symbols: T[] }`. */
function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { symbols?: unknown }).symbols)) {
    return (raw as { symbols: unknown[] }).symbols;
  }
  return [];
}

/**
 * Normalise une réponse superviseur/tenant en `PickerSymbol[]`. Le picker
 * choisit le symbole générique (`svgUrl` pour un custom, `key` pour un builtin).
 * - superviseur : `{ id, key, label, isBuiltin, svgUrl }`.
 * - tenant      : `{ id: key, label, svgUrl: key|url, isBuiltin }`.
 */
function normalizeSymbols(raw: unknown): PickerSymbol[] {
  const out: PickerSymbol[] = [];
  for (const item of toArray(raw)) {
    if (!item || typeof item !== "object") continue;
    const o = item as ConnectorIconPickerSymbol;
    const isBuiltin = o.isBuiltin === true;
    const label = typeof o.label === "string" ? o.label : "";
    const key =
      typeof o.key === "string" && o.key.length > 0
        ? o.key
        : typeof o.id === "string"
          ? o.id
          : "";
    const svgUrl = !isBuiltin && typeof o.svgUrl === "string" ? o.svgUrl : null;
    if (!label) continue;
    if (isBuiltin && !key) continue;
    if (!isBuiltin && !svgUrl) continue;
    const svgUrlD =
      !isBuiltin && typeof o.svgUrlD === "string" && o.svgUrlD.length > 0
        ? o.svgUrlD
        : null;
    // Custom : une version D existe ssi son URL est fournie (seule info
    // exploitable pour l'aperçu). Builtin : dérivée de D_TYPE_KEYS.
    const hasD = isBuiltin ? D_TYPE_KEYS.has(key) : svgUrlD != null;
    out.push({ key, label, isBuiltin, svgUrl, svgUrlD, hasD });
  }
  return out;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ConnectorIconPickerValue;
  onChange: (next: ConnectorIconPickerValue) => void;
  /**
   * Symboles fournis par l'appelant (superviseur ou tenant). Optionnel :
   * si absent, le picker les récupère lui-même selon le contexte
   * (`/supervisor/*` → API superviseur, sinon API tenant), avec repli sur la
   * bibliothèque intégrée statique.
   */
  symbols?: ConnectorIconPickerSymbol[];
};

export function ConnectorIconPickerModal({
  open,
  onOpenChange,
  value,
  onChange,
  symbols: providedSymbols,
}: Props) {
  const [tab, setTab] = useState<ConnectorIconSource>(value.source);
  const [query, setQuery] = useState("");
  const [buffer, setBuffer] = useState<ConnectorIconPickerValue>(value);
  const [symbols, setSymbols] = useState<PickerSymbol[]>(FALLBACK_SYMBOLS);

  // Resync au (re)open
  useEffect(() => {
    if (open) {
      setBuffer(value);
      setTab(value.source);
      setQuery("");
    }
  }, [open, value]);

  // Chargement des symboles à l'ouverture (repli statique garanti).
  useEffect(() => {
    if (!open) return;
    // Escape hatch : symboles fournis explicitement par l'appelant.
    if (providedSymbols) {
      const norm = normalizeSymbols(providedSymbols);
      setSymbols(norm.length > 0 ? norm : FALLBACK_SYMBOLS);
      return;
    }
    let cancelled = false;
    // arkyo-server: pas de back-office supervisor (catalogue central SaaS) —
    // seul l'endpoint tenant des symboles est interrogé.
    const endpoints = ["/api/tenant/parametres/symbols"];
    (async () => {
      let resolved: PickerSymbol[] | null = null;
      for (const ep of endpoints) {
        try {
          const raw = await api.get<unknown>(ep);
          const norm = normalizeSymbols(raw);
          if (norm.length > 0) {
            resolved = norm;
            break;
          }
        } catch {
          /* endpoint indisponible → essai suivant */
        }
      }
      if (!cancelled) setSymbols(resolved ?? FALLBACK_SYMBOLS);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, providedSymbols]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter(
      (s) =>
        s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q),
    );
  }, [query, symbols]);

  const handleCancel = () => {
    setBuffer(value);
    onOpenChange(false);
  };

  const handleConfirm = () => {
    onChange(buffer);
    onOpenChange(false);
  };

  const handlePickSymbol = (sym: PickerSymbol) => {
    if (sym.isBuiltin) {
      setBuffer({
        source: "icon",
        iconId: sym.key,
        svgUrl: buffer.svgUrl,
        hasD: sym.hasD,
        svgUrlD: null,
      });
    } else {
      setBuffer({
        source: "svg",
        iconId: buffer.iconId,
        svgUrl: sym.svgUrl ?? "",
        hasD: sym.hasD,
        svgUrlD: sym.svgUrlD,
      });
    }
  };

  const handlePickSvg = (url: string) => {
    // URL saisie/téléversée à la main : hors liste des symboles → pas de version D.
    setBuffer({
      source: "svg",
      iconId: buffer.iconId,
      svgUrl: url,
      hasD: false,
      svgUrlD: null,
    });
  };

  const canConfirm =
    (buffer.source === "icon" && buffer.iconId.length > 0) ||
    (buffer.source === "svg" && buffer.svgUrl.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel();
        else onOpenChange(v);
      }}
    >
      <DialogContent
        className="max-w-4xl p-0 flex flex-col max-h-[80vh]"
        showClose={false}
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)]/60 px-5 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold">
              Choisir une icône
            </DialogTitle>
            <DialogDescription className="text-xs">
              Sélectionnez une icône intégrée ou fournissez votre propre SVG.
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={handleCancel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Onglets ───────────────────────────────────────────────────── */}
        <div className="flex shrink-0 gap-1 border-b border-[var(--border)]/60 px-5 py-2">
          <TabBtn
            label="Bibliothèque"
            active={tab === "icon"}
            onClick={() => setTab("icon")}
          />
          <TabBtn
            label="SVG perso"
            active={tab === "svg"}
            onClick={() => setTab("svg")}
          />
        </div>

        {/* ── Toolbar recherche (uniquement biblio) ─────────────────────── */}
        {tab === "icon" && (
          <div className="shrink-0 border-b border-[var(--border)]/60 px-5 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher (BNC, XLR, RJ45…)"
                autoFocus
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
          </div>
        )}

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === "icon" ? (
            filtered.length === 0 ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Aucune icône ne correspond
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Essayez d&apos;ajuster la recherche.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
                {filtered.map((sym) => {
                  const active = sym.isBuiltin
                    ? buffer.source === "icon" && buffer.iconId === sym.key
                    : buffer.source === "svg" && buffer.svgUrl === sym.svgUrl;
                  return (
                    <button
                      key={`${sym.isBuiltin ? "b" : "c"}:${sym.key}`}
                      type="button"
                      onClick={() => handlePickSymbol(sym)}
                      title={sym.label}
                      className={cn(
                        "group relative flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all",
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
                          : "border-[var(--border)] hover:bg-[var(--secondary)]",
                      )}
                    >
                      {!sym.isBuiltin && (
                        <span className="absolute top-1 right-1 rounded bg-[var(--secondary)] px-1 py-px text-[8px] font-bold tracking-wide text-[var(--muted-foreground)] uppercase">
                          perso
                        </span>
                      )}
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/40 text-[var(--foreground)]">
                        {sym.isBuiltin ? (
                          <ConnectorIcon
                            iconId={sym.key}
                            color="currentColor"
                            size={32}
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sym.svgUrl ?? ""}
                            alt=""
                            className="h-8 w-8 object-contain"
                          />
                        )}
                      </div>
                      <p className="truncate text-[11px] font-medium text-[var(--foreground)]">
                        {sym.label}
                      </p>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <SvgPickerPane
              value={buffer.source === "svg" ? buffer.svgUrl : ""}
              onPick={handlePickSvg}
            />
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--border)]/60 px-5 py-3">
          <button
            type="button"
            onClick={handleCancel}
            className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            // arkyo-server: habillage Strata
            className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Confirmer
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-colors",
        active
          ? "bg-[var(--accent)]/15 text-[var(--accent)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
      )}
    >
      {label}
    </button>
  );
}

// ── SvgPickerPane ───────────────────────────────────────────────────────────

function SvgPickerPane({
  value,
  onPick,
}: {
  value: string;
  onPick: (url: string) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setUrlDraft(value);
    setError(null);
  }, [value]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "connectors");
        const res = await fetch("/api/upload", {
          method: "POST",
          body: fd,
        });
        const data = (await res.json().catch(() => null)) as
          | { url?: string; error?: string }
          | null;
        if (!res.ok) {
          setError(
            typeof data?.error === "string"
              ? data.error
              : "Échec de l'envoi du fichier.",
          );
          return;
        }
        const url = typeof data?.url === "string" ? data.url : null;
        if (!url) {
          setError("Réponse serveur invalide.");
          return;
        }
        setUrlDraft(url);
        onPick(url);
      } catch {
        setError("Erreur réseau pendant l'envoi.");
      } finally {
        setUploading(false);
      }
    },
    [onPick],
  );

  const handleApplyUrl = () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) {
      setError("Saisissez une URL ou téléversez un fichier.");
      return;
    }
    onPick(trimmed);
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      {/* Aperçu */}
      <div className="flex items-center gap-4 rounded-xl border border-[var(--border)]/60 bg-[var(--secondary)]/30 p-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)]/60 bg-[var(--card)]">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="h-12 w-12 object-contain"
            />
          ) : (
            <span className="font-mono text-xs text-[var(--muted-foreground)]">
              —
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
            SVG actif
          </div>
          <div className="mt-0.5 truncate font-mono text-xs">
            {value || (
              <span className="italic text-[var(--muted-foreground)]">
                Aucun
              </span>
            )}
          </div>
        </div>
      </div>

      {/* URL */}
      <div>
        <label className="mb-1.5 block text-[10px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
          URL personnalisée
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://… ou /uploads/…"
            className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={handleApplyUrl}
            className="shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            Appliquer
          </button>
        </div>
      </div>

      <div className="text-center text-[10px] tracking-widest text-[var(--muted-foreground)] uppercase">
        ou
      </div>

      {/* Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/svg+xml,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUpload(f);
          e.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)]/60 bg-transparent px-4 py-6 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/5 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {uploading ? "Envoi…" : "Téléverser un fichier"}
      </button>

      {error && (
        <p className="text-xs text-[var(--destructive)]">{error}</p>
      )}
    </div>
  );
}

// ── Trigger ─────────────────────────────────────────────────────────────────

/**
 * ConnectorIconPickerTrigger — bouton standard alignée sur `BrandPickerTrigger`
 * / `ConnectorPickerTrigger`. Affiche l'icône actuelle + label + chevron.
 */
export function ConnectorIconPickerTrigger({
  value,
  onClick,
  error,
}: {
  value: ConnectorIconPickerValue;
  onClick: () => void;
  error?: string;
}) {
  const label = useMemo(() => {
    if (value.source === "svg" && value.svgUrl) return "SVG personnalisé";
    const found = BUILTIN_CONNECTOR_ICONS.find((i) => i.id === value.iconId);
    if (found) return found.label;
    return "Choisir une icône";
  }, [value]);

  const hasValue =
    (value.source === "icon" && value.iconId.length > 0) ||
    (value.source === "svg" && value.svgUrl.length > 0);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-3 text-left transition-colors hover:bg-[var(--secondary)]",
          error
            ? "border-[var(--destructive)]"
            : "border-[var(--border)]",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)]/60 bg-[var(--secondary)]/40 text-[var(--foreground)]">
            {value.source === "svg" && value.svgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value.svgUrl}
                alt=""
                className="h-5 w-5 object-contain"
              />
            ) : (
              <ConnectorIcon
                iconId={value.iconId || "bnc"}
                color="currentColor"
                size={20}
              />
            )}
          </span>
          {hasValue ? (
            <p className="truncate text-sm font-medium text-[var(--foreground)]">
              {label}
            </p>
          ) : (
            <span className="text-sm text-[var(--muted-foreground)]">
              Choisir une icône
            </span>
          )}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      </button>
      {error && (
        <p className="text-[11px] text-[var(--destructive)]">{error}</p>
      )}
    </div>
  );
}
