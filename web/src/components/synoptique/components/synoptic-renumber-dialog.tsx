"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Layers,
  Loader2,
  GripVertical,
  Plus,
  X,
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
} from "@/components/ui/icons";
import {
  computeCableLabel,
  type CableDirDigit,
  type CableNumberingConfig,
} from "@/lib/services/cable-numbering";
import { cn } from "@/lib/utils";

export type EquipmentOrderEntry = { id: string; name: string };

export type CableExample = {
  signalLabel: string;
  signalPrefix: string;
  signalSuffix: string;
  dirDigit: CableDirDigit;
  zoneCode: string | null;
};

/** Direction de numérotation spatiale. */
export type NumberingDirection = {
  horizontal: "ltr" | "rtl";
  vertical: "ttb" | "btt";
};

export type RenumberScope = "all" | "selection";

export type SynopticRenumberDialogProps = {
  rackId: string;
  rackCableCode: string | null;
  rackOverride: Partial<CableNumberingConfig> | null;
  adminDefaults?: CableNumberingConfig | null;
  /** "all" = tous les câbles · "selection" = seulement les câbles sélectionnés. */
  scope?: RenumberScope;
  /** Nombre de câbles ciblés (affiché quand scope=selection). */
  selectedCount?: number;
  examples: CableExample[];
  equipOrder: EquipmentOrderEntry[];
  onEquipOrderChange: (updater: (prev: EquipmentOrderEntry[]) => EquipmentOrderEntry[]) => void;
  onlyUnlabelled: boolean;
  onOnlyUnlabelledChange: (updater: (prev: boolean) => boolean) => void;
  onConfirm: (override: CableNumberingConfig, direction?: NumberingDirection) => void;
  onSaveAndConfirm: (override: CableNumberingConfig) => void;
  onSaveOverride: (override: CableNumberingConfig) => void;
  onResetToAdmin: () => void;
  onCancel: () => void;
};

const FALLBACK_DEFAULTS: CableNumberingConfig = {
  pad: 5,
  sep1: "-",
  sep2: "",
  includeRack: true,
};

// Palette alignée sur le design `/admin/parametres > Numérotations`
// (cf. components/admin/_components/numbering-tab.tsx). Variables CSS pour
// rester cohérent avec le thème clair/sombre et la DA Arkyo plutôt que des
// couleurs hardcoded flashy.
const COLOR_RACK = "var(--arkyo-blue, #6366f1)";
const COLOR_PREFIX = "var(--accent)";
const COLOR_DIR = "var(--muted-foreground)";
const COLOR_SEQ = "var(--foreground)";
const COLOR_SUFFIX = "var(--arkyo-blue-light, #818cf8)";
const COLOR_SEP = "var(--muted-foreground)";

const SEP_OPTIONS = [
  { v: "-", l: "-" },
  { v: ".", l: "." },
  { v: "_", l: "_" },
  { v: "/", l: "/" },
  { v: "*", l: "*" },
  { v: "", l: "Aucun" },
];

// ── Template chip types ────────────────────────────────────────────────────
type ChipItem = { id: string; type: "var" | "text"; value: string };
const ALL_VARS = ["rack", "sep1", "prefix", "dir", "seq", "sep2", "suffix"] as const;
// Couleurs des chips builder — mêmes que les segments du preview ; sep1/sep2
// utilisent COLOR_SEP (muted-foreground) pour cohérence visuelle avec le
// design admin/parametres.
const CHIP_COLORS: Record<string, string> = {
  rack: COLOR_RACK,
  sep1: COLOR_SEP,
  prefix: COLOR_PREFIX,
  dir: COLOR_DIR,
  seq: COLOR_SEQ,
  sep2: COLOR_SEP,
  suffix: COLOR_SUFFIX,
};
const CHIP_LABELS: Record<string, string> = {
  rack: "Rack",
  sep1: "Sep 1",
  prefix: "Prefix",
  dir: "Direction",
  seq: "Séquence",
  sep2: "Sep 2",
  suffix: "Suffixe",
};
const DEFAULT_CHIPS: ChipItem[] = ALL_VARS.map((v) => ({ id: v, type: "var" as const, value: v }));

function parseTemplate(tpl: string): ChipItem[] {
  if (!tpl) return [...DEFAULT_CHIPS];
  const parts: ChipItem[] = [];
  const regex = /\{(rack|sep1|prefix|dir|seq|sep2|suffix)\}|([^{}]+)/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = regex.exec(tpl)) !== null) {
    if (m[1]) parts.push({ id: `${m[1]}-${idx++}`, type: "var", value: m[1] });
    else if (m[2]) parts.push({ id: `text-${idx++}`, type: "text", value: m[2] });
  }
  return parts.length > 0 ? parts : [...DEFAULT_CHIPS];
}

function chipsToTemplate(chips: ChipItem[]): string {
  return chips.map((c) => (c.type === "var" ? `{${c.value}}` : c.value)).join("");
}

// ── Main dialog ────────────────────────────────────────────────────────────
export function SynopticRenumberDialog(props: SynopticRenumberDialogProps) {
  const {
    rackId,
    rackCableCode,
    rackOverride,
    adminDefaults: adminDefaultsProp,
    onlyUnlabelled,
    onOnlyUnlabelledChange,
    onConfirm,
    onSaveAndConfirm,
    onSaveOverride,
    onResetToAdmin,
    onCancel,
  } = props;
  void onResetToAdmin;
  void props.equipOrder;
  void props.onEquipOrderChange;
  void props.examples;
  const scope = props.scope ?? "all";
  const selectedCount = props.selectedCount ?? 0;

  const [adminDefaults, setAdminDefaults] = useState<CableNumberingConfig | null>(
    adminDefaultsProp ?? null,
  );
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    if (adminDefaultsProp || adminDefaults) return;
    let cancelled = false;
    setAdminLoading(true);
    fetch("/api/admin/config")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows: { key: string; value: string }[]) => {
        if (cancelled) return;
        const cfg: Record<string, string> = {};
        for (const r of rows) cfg[r.key] = r.value;
        setAdminDefaults({
          pad: Math.max(3, Math.min(10, Number(cfg["cable_pad"] ?? 5))),
          sep1: cfg["cable_sep1"] ?? cfg["cable_separator"] ?? "-",
          sep2: cfg["cable_sep2"] ?? cfg["cable_suffix_separator"] ?? "",
          includeRack: cfg["cable_include_rack"] !== "false",
          template: cfg["cable_template"] ?? "",
          templateEnabled: cfg["cable_template_enabled"] === "true",
        });
      })
      .catch(() => {
        if (!cancelled) setAdminDefaults(FALLBACK_DEFAULTS);
      })
      .finally(() => {
        if (!cancelled) setAdminLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminDefaultsProp, adminDefaults]);

  const effectiveDefaults = adminDefaultsProp ?? adminDefaults ?? FALLBACK_DEFAULTS;

  // Config = admin + rack override (nettoyé des vieux champs legacy).
  const initialConfig = useMemo<CableNumberingConfig>(() => {
    const cleaned = rackOverride ? { ...rackOverride } : {};
    // Migre les anciens champs vers les nouveaux si présents dans l'override.
    if (cleaned.separator != null && cleaned.sep1 == null) {
      cleaned.sep1 = cleaned.separator;
    }
    if (cleaned.suffixSeparator != null && cleaned.sep2 == null) {
      cleaned.sep2 = cleaned.suffixSeparator;
    }
    delete cleaned.separator;
    delete cleaned.suffixSeparator;
    delete cleaned.includeZone;
    return { ...effectiveDefaults, ...cleaned };
  }, [effectiveDefaults, rackOverride]);

  const [config, setConfig] = useState<CableNumberingConfig>(initialConfig);
  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  // Le hero reflète TOUJOURS la convention admin (config hérité de effectiveDefaults).
  // Le toggle "Personnaliser" contrôle un état LOCAL séparé qui, quand activé,
  // affiche la section d'override et surcharge config.templateEnabled.
  // Restaure l'état perso local depuis le rackOverride (mémorise la dernière session).
  const [localPersoEnabled, setLocalPersoEnabledRaw] = useState(
    () => !!rackOverride?.templateEnabled,
  );
  const setLocalPersoEnabled = (v: boolean) => {
    setLocalPersoEnabledRaw(v);
    if (v) {
      setConfig((c) => ({ ...c, template: chipsToTemplate(chips), templateEnabled: true }));
    } else {
      setConfig((c) => ({ ...c, templateEnabled: false }));
    }
  };

  // Chips drag & drop
  const [chips, setChips] = useState<ChipItem[]>(() => parseTemplate(config.template ?? ""));
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const syncChips = (newChips: ChipItem[]) => {
    setChips(newChips);
    setConfig((c) => ({ ...c, template: chipsToTemplate(newChips) }));
  };
  const addTextChip = () =>
    syncChips([...chips, { id: `t-${Date.now()}`, type: "text", value: "" }]);
  const removeChip = (i: number) => syncChips(chips.filter((_, j) => j !== i));
  const updateText = (i: number, t: string) =>
    syncChips(chips.map((c, j) => (j === i ? { ...c, value: t } : c)));
  const handleDragStart = (i: number) => setDragIdx(i);
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    const next = [...chips];
    const [m] = next.splice(dragIdx, 1);
    next.splice(i, 0, m);
    setDragIdx(i);
    syncChips(next);
  };
  const handleDragEnd = () => setDragIdx(null);

  // Direction de numérotation spatiale
  const [direction, setDirectionRaw] = useState<NumberingDirection>(() => {
    if (typeof window === "undefined") return { horizontal: "ltr", vertical: "ttb" };
    try {
      const raw = localStorage.getItem(`numbering-dir-${rackId}`);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { horizontal: "ltr", vertical: "ttb" };
  });
  const setDirection = (fn: (d: NumberingDirection) => NumberingDirection) => {
    setDirectionRaw((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(`numbering-dir-${rackId}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Quand le perso local est activé, on surcharge templateEnabled dans config.
  // Le hero montre toujours la config effective (admin ou locale).
  const effectiveConfig = localPersoEnabled ? { ...config, templateEnabled: true } : config;
  const effectiveIncludeRack =
    localPersoEnabled || effectiveConfig.templateEnabled ? true : effectiveConfig.includeRack;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col">
          {/* ── Scope ───────────────────────────────────────────────────── */}
          {scope === "selection" && (
            <div className="border-b border-[var(--border)] bg-[var(--accent)]/5 px-4 pt-3 pb-2">
              {/* arkyo-server: habillage Strata (texte d'accent sur l'accent à 5 % : --accent-strong) */}
              <p className="text-[11px] font-semibold text-[var(--accent-strong)]">
                {selectedCount} câble{selectedCount > 1 ? "s" : ""} sélectionné
                {selectedCount > 1 ? "s" : ""}
              </p>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                Seuls les câbles de la sélection seront numérotés. Les labels existants hors
                sélection sont préservés.
              </p>
            </div>
          )}

          {/* ── Convention hero (lecture seule = reflet admin) ────────── */}
          <section className="border-b border-[var(--border)] px-4 pt-4 pb-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                Convention{" "}
                {adminLoading && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-[10px]">Personnaliser</span>
                <ToggleSwitch checked={localPersoEnabled} onChange={setLocalPersoEnabled} />
              </div>
            </div>
            {!localPersoEnabled && (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-4">
                <div className="[&_code]:text-lg">
                  <ColorizedLabel
                    rackCode={rackCableCode ?? "RACK"}
                    prefix="V"
                    suffix="HD"
                    dir="1"
                    seq={1}
                    config={effectiveDefaults}
                  />
                </div>
              </div>
            )}
          </section>

          {/* ── Personnalisation locale (visible uniquement si activée) ── */}
          {localPersoEnabled && (
            <section className="border-b border-[var(--border)] px-4 py-3">
              <p className="text-muted-foreground mb-3 text-[10px] font-bold tracking-wider uppercase">
                Convention locale
                {/* arkyo-server: habillage Strata (alerte : --warning, texte en --warning-text) */}
                <span className="ml-2 rounded-full bg-[var(--warning)]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--warning-text)] normal-case">
                  Ce synoptique uniquement
                </span>
              </p>

              {/* Builder chips */}
              <div
                className="mb-3 flex min-h-[36px] w-full flex-wrap items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--border)] p-2"
                onDragOver={(e) => e.preventDefault()}
              >
                {chips.map((chip, i) => (
                  <div
                    key={chip.id}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "flex cursor-grab items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all active:cursor-grabbing",
                      dragIdx === i && "opacity-40",
                      chip.type === "text" && "bg-muted border-border text-foreground border",
                    )}
                    style={
                      // Couleur résolue via color-mix → support des CSS vars
                      // (var(--accent), var(--arkyo-blue, …)) en plus des hex,
                      // pour rester aligné sur la palette admin/parametres.
                      chip.type === "var"
                        ? (() => {
                            const c = CHIP_COLORS[chip.value] ?? "var(--muted-foreground)";
                            return {
                              background: `color-mix(in srgb, ${c} 12%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
                              color: c,
                            };
                          })()
                        : undefined
                    }
                  >
                    <GripVertical className="h-3 w-3 opacity-40" />
                    {chip.type === "var" ? (
                      <span>{CHIP_LABELS[chip.value] ?? chip.value}</span>
                    ) : (
                      <input
                        type="text"
                        value={chip.value}
                        onChange={(e) => updateText(i, e.target.value)}
                        className="border-border w-12 border-b border-dashed bg-transparent text-[10px] outline-none"
                        placeholder="texte…"
                      />
                    )}
                    <button
                      onClick={() => removeChip(i)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addTextChip}
                  className="text-muted-foreground border-border hover:bg-muted flex items-center gap-0.5 rounded-md border border-dashed px-1.5 py-0.5 text-[9px]"
                >
                  <Plus className="h-3 w-3" /> Texte
                </button>
              </div>
              {(() => {
                const used = new Set(chips.filter((c) => c.type === "var").map((c) => c.value));
                const avail = ALL_VARS.filter((v) => !used.has(v));
                if (!avail.length) return null;
                return (
                  <div className="mb-3 flex w-full items-center gap-2">
                    <span className="text-muted-foreground shrink-0 text-[9px]">Ajouter :</span>
                    <div className="flex flex-wrap gap-1">
                      {avail.map((v) => {
                        const c = CHIP_COLORS[v] ?? "var(--muted-foreground)";
                        return (
                          <button
                            key={v}
                            onClick={() =>
                              syncChips([
                                ...chips,
                                { id: `${v}-${Date.now()}`, type: "var", value: v },
                              ])
                            }
                            className="hover:bg-muted rounded-md border border-dashed px-1.5 py-0.5 text-[9px] font-medium"
                            style={{
                              borderColor: `color-mix(in srgb, ${c} 40%, transparent)`,
                              color: c,
                            }}
                          >
                            + {CHIP_LABELS[v]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Aperçu local */}
              <div className="mt-3 flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                <div className="[&_code]:text-base">
                  <ColorizedLabel
                    rackCode={rackCableCode ?? "RACK"}
                    prefix="V"
                    suffix="HD"
                    dir="1"
                    seq={1}
                    config={{ ...effectiveConfig, includeRack: effectiveIncludeRack }}
                  />
                </div>
              </div>

              {/* Paramètres locaux — pas de toggle rack : c'est le chip {rack}
                dans le builder qui contrôle sa présence */}
              <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
                <div>
                  <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
                    Séparateur 1 <span className="normal-case opacity-60">(rack → prefix)</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {SEP_OPTIONS.map((opt) => (
                      <button
                        key={`s1-${opt.v}`}
                        onClick={() => setConfig((c) => ({ ...c, sep1: opt.v }))}
                        // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                        className={`h-7 rounded-md border px-2.5 text-[10px] font-semibold transition-all ${(config.sep1 ?? "-") === opt.v ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]" : "text-muted-foreground border-[var(--border)] hover:bg-[var(--secondary)]"}`}
                      >
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
                    Séparateur 2{" "}
                    <span className="normal-case opacity-60">(séquence → suffixe)</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {SEP_OPTIONS.map((opt) => (
                      <button
                        key={`s2-${opt.v}`}
                        onClick={() => setConfig((c) => ({ ...c, sep2: opt.v }))}
                        // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                        className={`h-7 rounded-md border px-2.5 text-[10px] font-semibold transition-all ${(config.sep2 ?? "") === opt.v ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]" : "text-muted-foreground border-[var(--border)] hover:bg-[var(--secondary)]"}`}
                      >
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
                    Longueur séquence
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={3}
                      max={10}
                      step={1}
                      value={config.pad}
                      onChange={(e) => setConfig((c) => ({ ...c, pad: Number(e.target.value) }))}
                      className="flex-1 accent-[var(--accent)]"
                    />
                    <span className="w-5 text-center font-mono text-xs font-bold">
                      {config.pad}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Direction de numérotation (masquée en mode sélection) ── */}
          {scope !== "selection" && (
            <section className="border-b border-[var(--border)] px-4 py-3">
              <p className="text-muted-foreground mb-3 text-[10px] font-bold tracking-wider uppercase">
                Ordre de numérotation
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground mb-1.5 text-[10px]">Horizontal</p>
                  <div className="flex gap-1">
                    <DirButton
                      active={direction.horizontal === "ltr"}
                      onClick={() => setDirection((d) => ({ ...d, horizontal: "ltr" }))}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </DirButton>
                    <DirButton
                      active={direction.horizontal === "rtl"}
                      onClick={() => setDirection((d) => ({ ...d, horizontal: "rtl" }))}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </DirButton>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1.5 text-[10px]">Vertical</p>
                  <div className="flex gap-1">
                    <DirButton
                      active={direction.vertical === "ttb"}
                      onClick={() => setDirection((d) => ({ ...d, vertical: "ttb" }))}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </DirButton>
                    <DirButton
                      active={direction.vertical === "btt"}
                      onClick={() => setDirection((d) => ({ ...d, vertical: "btt" }))}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </DirButton>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Option câbles non numérotés (masquée en mode sélection) ── */}
          {scope !== "selection" && (
            <section className="px-4 py-3">
              <button
                onClick={() => onOnlyUnlabelledChange((v) => !v)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--border)] px-3 py-2 text-left transition-colors hover:bg-[var(--secondary)]"
                style={{
                  background: onlyUnlabelled
                    ? "color-mix(in srgb, var(--accent) 10%, var(--surface) 90%)"
                    : "var(--surface)",
                }}
              >
                <div
                  className={`flex h-4 w-8 flex-shrink-0 items-center rounded-full px-0.5 transition-colors ${onlyUnlabelled ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
                >
                  <div
                    className={`h-3 w-3 rounded-full bg-white shadow transition-transform ${onlyUnlabelled ? "translate-x-4" : "translate-x-0"}`}
                  />
                </div>
                <p className="text-foreground flex-1 text-[11px] leading-tight font-semibold">
                  Seulement les câbles non numérotés
                </p>
              </button>
            </section>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-border flex flex-none items-center justify-end gap-2 border-t p-3">
        <button
          onClick={onCancel}
          className="border-border text-muted-foreground hover:bg-muted rounded-md border px-3 py-1.5 text-xs transition-colors"
        >
          Annuler
        </button>
        <button
          onClick={async () => {
            const finalConfig = localPersoEnabled
              ? { ...effectiveConfig, includeRack: effectiveIncludeRack }
              : { ...effectiveDefaults };
            // Persiste uniquement la convention perso locale (jamais la convention admin).
            // Quand perso est off, on garde l'override existant intact pour pouvoir
            // y revenir plus tard — on ne persiste que templateEnabled=false.
            if (localPersoEnabled) {
              await onSaveOverride({
                ...config,
                templateEnabled: true,
                includeRack: effectiveIncludeRack,
              });
            } else if (rackOverride?.templateEnabled) {
              // Était perso avant, repasse en standard : on garde l'override mais désactive.
              await onSaveOverride({
                ...rackOverride,
                templateEnabled: false,
              } as CableNumberingConfig);
            }
            onConfirm(finalConfig, direction);
          }}
          // arkyo-server: habillage Strata (blanc illisible sur l'accent sombre : --accent-foreground)
          className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
        >
          <Layers className="h-3 w-3" />{" "}
          {scope === "selection" ? `Numéroter (${selectedCount})` : "Numéroter"}
        </button>
      </div>
      <span style={{ display: "none" }}>{rackId}</span>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function DirButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-lg border px-2 py-1.5 text-center text-[10px] font-semibold transition-all",
        active
          ? // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
            "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
          : "text-muted-foreground border-[var(--border)] hover:bg-[var(--secondary)]",
      )}
    >
      {children}
    </button>
  );
}

function ColorizedLabel({
  rackCode,
  prefix,
  suffix,
  dir,
  seq,
  config,
}: {
  rackCode: string;
  prefix: string;
  suffix: string;
  dir: CableDirDigit;
  seq: number;
  config: CableNumberingConfig;
}) {
  const s1 = config.sep1 ?? config.separator ?? "";
  const s2 = config.sep2 ?? config.suffixSeparator ?? "";
  const safePad = Math.max(3, Math.min(10, config.pad));
  const numBlock = `${dir}${String(seq).padStart(Math.max(1, safePad - 1), "0")}`;
  const paddedSeqOnly = String(seq).padStart(safePad, "0");

  if (config.templateEnabled && config.template?.trim()) {
    const label = computeCableLabel({
      zoneCode: null,
      rackCode,
      signalPrefix: prefix,
      signalSuffix: suffix,
      dirDigit: dir,
      seq,
      config,
    });
    const rackVal = config.includeRack ? rackCode : "";
    const tokens: { text: string; color: string }[] = [];
    let rem = label;
    const tryM = (v: string, c: string) => {
      if (!v || !rem.startsWith(v)) return false;
      tokens.push({ text: v, color: c });
      rem = rem.slice(v.length);
      return true;
    };
    while (rem.length > 0) {
      if (tryM(rackVal, COLOR_RACK)) continue;
      if (tryM(prefix, COLOR_PREFIX)) continue;
      if (tryM(paddedSeqOnly, COLOR_SEQ)) continue;
      if (tryM(dir, COLOR_DIR)) continue;
      if (suffix && tryM(suffix, COLOR_SUFFIX)) continue;
      if (s1 && tryM(s1, COLOR_SEP)) continue;
      if (s2 && tryM(s2, COLOR_SEP)) continue;
      tokens.push({ text: rem[0], color: COLOR_SEP });
      rem = rem.slice(1);
    }
    return (
      <code className="font-mono text-sm font-bold tracking-wide">
        {tokens.map((p, i) => (
          <span key={i} style={{ color: p.color }}>
            {p.text}
          </span>
        ))}
      </code>
    );
  }

  const parts: { text: string; color: string }[] = [];
  if (config.includeRack && rackCode) {
    parts.push({ text: rackCode, color: COLOR_RACK });
    if (s1) parts.push({ text: s1, color: COLOR_SEP });
  }
  if (prefix) parts.push({ text: prefix, color: COLOR_PREFIX });
  parts.push({ text: numBlock, color: COLOR_SEQ });
  if (suffix) {
    if (s2) parts.push({ text: s2, color: COLOR_SEP });
    parts.push({ text: suffix, color: COLOR_SUFFIX });
  }
  return (
    <code className="font-mono text-sm font-bold tracking-wide">
      {parts.map((p, i) => (
        <span key={i} style={{ color: p.color }}>
          {p.text}
        </span>
      ))}
    </code>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-4 w-8 shrink-0 rounded-full transition-colors",
        checked ? "bg-[var(--accent)]" : "bg-[var(--border)]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

function ToggleRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--secondary)]"
    >
      <div
        className={`flex h-4 w-7 flex-shrink-0 items-center rounded-full px-0.5 transition-colors ${checked ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
      >
        <div
          className={`h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-3" : "translate-x-0"}`}
        />
      </div>
      <div className="min-w-0">
        <p className="text-foreground text-[11px] font-semibold">{label}</p>
        <p className="text-muted-foreground truncate text-[9px]">{hint}</p>
      </div>
    </button>
  );
}
