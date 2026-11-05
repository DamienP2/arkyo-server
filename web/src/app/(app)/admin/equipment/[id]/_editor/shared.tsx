"use client";

// Shared building blocks for the EquipmentEditor refactor.
// Extracted from the original equipment-editor.tsx (preserving styles & behaviour).

import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Search,
  Check,
  X,
  ChevronRight,
  Copy,
  Plug,
} from "@/components/ui/icons";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import {
  Brand,
  ConnectorEntry,
  ConnectorType,
  DIR_OPTIONS,
  FACE_COLORS,
  FACE_LABELS,
  GENDER_OPTIONS,
  Signal,
  SignalCategory,
  uid,
} from "./types";

// ── SVG Illustrations ──────────────────────────────────────────────────────

export function SvgEquipment({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 48 32" className="h-8 w-12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="4"
        y="4"
        width="40"
        height="24"
        rx="3"
        fill={`${color}15`}
        stroke={color}
        strokeWidth="1.5"
      />
      <rect x="8" y="9" width="24" height="3" rx="1.5" fill={`${color}40`} />
      <rect x="8" y="15" width="18" height="3" rx="1.5" fill={`${color}25`} />
      <rect x="8" y="21" width="12" height="3" rx="1.5" fill={`${color}15`} />
      <circle cx="38" cy="10" r="2" fill={color} opacity="0.6" />
      <circle cx="38" cy="16" r="2" fill={color} opacity="0.4" />
      <circle cx="38" cy="22" r="2" fill={color} opacity="0.2" />
    </svg>
  );
}

export function SvgConnectors({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 40 24" className="h-5 w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2"
        y="4"
        width="12"
        height="16"
        rx="2"
        fill={`${color}15`}
        stroke={color}
        strokeWidth="1"
      />
      <circle cx="8" cy="10" r="1.5" fill={color} />
      <circle cx="8" cy="15" r="1.5" fill={color} />
      <rect
        x="26"
        y="4"
        width="12"
        height="16"
        rx="2"
        fill={`${color}15`}
        stroke={color}
        strokeWidth="1"
      />
      <circle cx="32" cy="10" r="1.5" fill={color} />
      <circle cx="32" cy="15" r="1.5" fill={color} />
      <path d="M14 10 h12" stroke={color} strokeWidth="1" strokeDasharray="2 2" />
      <path d="M14 15 h12" stroke={color} strokeWidth="1" strokeDasharray="2 2" />
    </svg>
  );
}

// ── Field wrapper ──────────────────────────────────────────────────────────

export function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
        {label}
        {/* arkyo-server: habillage Strata */}
        {required && <span className="ml-0.5 text-[var(--danger-text)]">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────────
//
// Two visual modes:
//  - "card" (default): subtle border, transparent background, no header divider.
//  - "plain": no border, just a title with a hairline rule below.
// In both modes, the section is transparent — never bg-card / bg-secondary.

export function Section({
  title,
  icon,
  color,
  variant = "card",
  trailing,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  color?: string;
  variant?: "card" | "plain";
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const accent = color ?? "var(--muted-foreground)";

  if (variant === "plain") {
    return (
      <section className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2 border-b border-[var(--border)]/60 pb-1.5">
          {icon}
          <span
            className="text-[10px] font-bold tracking-widest uppercase"
            style={{ color: accent }}
          >
            {title}
          </span>
          {trailing && <div className="ml-auto">{trailing}</div>}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section
      className={cn(
        "space-y-3 rounded-lg border border-[var(--border)]/60 bg-transparent p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accent }}>
          {title}
        </span>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ── SliderField ────────────────────────────────────────────────────────────

export function SliderField({
  label,
  unit,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled,
  color,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  color?: string;
}) {
  const pct = value != null ? Math.min(100, ((value - min) / (max - min)) * 100) : 0;
  const accentColor = color ?? "var(--accent)";
  return (
    <div className={cn("space-y-1.5", disabled && "pointer-events-none opacity-50")}>
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value ?? ""}
            placeholder="—"
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
            className="h-6 w-16 rounded-md border border-[var(--border)]/60 bg-transparent px-2 text-right font-mono text-[11px] focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
          />
          <span className="w-8 text-[9px] text-[var(--muted-foreground)]">{unit}</span>
        </div>
      </div>
      <div className="group relative flex h-6 items-center">
        <div className="absolute inset-x-0 h-1 rounded-full border border-[var(--border)]/60">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: accentColor }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value ?? min}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        {value != null && (
          <div
            className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 bg-[var(--background)] shadow-sm transition-all"
            style={{ left: `calc(${pct}% - 7px)`, borderColor: accentColor }}
          />
        )}
      </div>
    </div>
  );
}

// ── BrandPicker ────────────────────────────────────────────────────────────

export function BrandPicker({
  brands,
  value,
  onChange,
  disabled,
  accentColor = "var(--accent)",
}: {
  brands: Brand[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  accentColor?: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = brands.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className={cn(disabled && "pointer-events-none opacity-50")}>
      <div className="relative mb-3">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une marque…"
          className="h-8 w-full rounded-lg border border-[var(--border)]/60 bg-transparent px-3 pl-8 text-xs focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
        />
      </div>
      <div
        className="grid max-h-96 gap-3 overflow-y-auto pr-1"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
      >
        {/* Card Aucune */}
        <button
          type="button"
          onClick={() => onChange("")}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg border px-3 py-3 text-left transition-all",
            !value
              ? "border-[var(--foreground)]/30 bg-[var(--secondary)]/40"
              : "border-[var(--border)] hover:bg-[var(--secondary)]/30",
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-[var(--border)]/60 bg-[var(--secondary)]/40">
            <span className="font-mono text-[11px] font-bold text-[var(--muted-foreground)]">
              —
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-semibold">Aucune</p>
            <p className="truncate text-[10px] text-[var(--muted-foreground)]">
              Marque non spécifiée
            </p>
          </div>
          {!value && <Check className="h-4 w-4 shrink-0 text-[var(--foreground)]/60" />}
        </button>

        {filtered.map((b) => {
          const isSelected = value === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onChange(b.id)}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg border px-3 py-3 text-left transition-all",
                isSelected ? "shadow-sm" : "hover:bg-[var(--secondary)]/40",
              )}
              style={{
                borderLeftColor: accentColor,
                borderLeftWidth: 3,
                borderTopColor: isSelected ? accentColor : "var(--border)",
                borderRightColor: isSelected ? accentColor : "var(--border)",
                borderBottomColor: isSelected ? accentColor : "var(--border)",
                backgroundColor: isSelected ? `${accentColor}08` : undefined,
              }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)]/60 bg-white dark:bg-white/5">
                {b.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logoUrl} alt="" className="h-full w-full object-contain p-1.5" />
                ) : (
                  <span className="text-[10px] font-bold text-[var(--muted-foreground)]">
                    {b.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-tight font-semibold">{b.name}</p>
              </div>
              {isSelected && <Check className="h-4 w-4 shrink-0" style={{ color: accentColor }} />}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full py-6 text-center text-[11px] text-[var(--muted-foreground)]">
            Aucune marque
          </p>
        )}
      </div>
    </div>
  );
}

// ── AddPortFlow (2-click: signal → connector → auto-add) ──────────────────

type AddStep = "signal" | "connector";

export function AddPortFlow({
  face,
  signals,
  signalCategories,
  connectorTypes,
  onAdd,
  onClose,
}: {
  face: ConnectorEntry["face"];
  signals: Signal[];
  signalCategories: SignalCategory[];
  connectorTypes: ConnectorType[];
  onAdd: (entry: ConnectorEntry) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<AddStep>("signal");
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [sigSearch, setSigSearch] = useState("");
  const [sigCatFilter, setSigCatFilter] = useState<string | null>(null);
  const [ctSearch, setCtSearch] = useState("");

  const faceColor = FACE_COLORS[face];
  const sigCatColor = (sig: Signal) =>
    signalCategories.find((c) => c.name === sig.category)?.color ?? sig.color;

  const compatibleCTs = selectedSignal
    ? (() => {
        const raw = selectedSignal.connectors;
        if (!Array.isArray(raw)) return connectorTypes;
        const ids = raw as string[];
        if (ids.length === 0) return connectorTypes;
        const byId = connectorTypes.filter((ct) => ids.includes(ct.id));
        return byId.length > 0 ? byId : connectorTypes.filter((ct) => ids.includes(ct.name));
      })()
    : connectorTypes;

  const presentCats = signalCategories.filter((c) => signals.some((s) => s.category === c.name));

  const filteredSignals = signals.filter((s) => {
    if (sigCatFilter && s.category !== sigCatFilter) return false;
    if (sigSearch && !s.name.toLowerCase().includes(sigSearch.toLowerCase())) return false;
    return true;
  });
  const filteredCTs = compatibleCTs.filter(
    (ct) => !ctSearch || ct.name.toLowerCase().includes(ctSearch.toLowerCase()),
  );

  const handlePickSignal = (sig: Signal) => {
    setSelectedSignal(sig);
    setCtSearch("");
    setStep("connector");
  };

  const handlePickCT = (ct: ConnectorType) => {
    const sig = selectedSignal;
    onAdd({
      id: uid(),
      face,
      connectorTypeId: ct.id,
      signalName: sig?.name ?? "",
      direction: "BOTH",
      quantity: 1,
      label: sig ? `${sig.name} I/O` : ct.name,
      gender: "FEMALE",
    });
    setSelectedSignal(null);
    setSigSearch("");
    setCtSearch("");
    setStep("signal");
  };

  return (
    <div className="border-t border-[var(--border)]/60">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)]/60 px-3 py-1.5 text-[10px]">
        <div className="h-1.5 w-1.5 rounded-full" style={{ background: faceColor }} />
        {step === "signal" ? (
          <span className="font-bold text-[var(--foreground)]">Choisir un signal</span>
        ) : (
          <>
            <button
              onClick={() => {
                setStep("signal");
                setSelectedSignal(null);
              }}
              className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Signal
            </button>
            <ChevronRight className="h-3 w-3 opacity-30" />
            <span className="font-bold" style={{ color: sigCatColor(selectedSignal!) }}>
              {selectedSignal!.name}
            </span>
            <span className="ml-0.5 text-[var(--muted-foreground)]">→ connecteur</span>
          </>
        )}
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 transition-colors hover:bg-[var(--secondary)]/40"
        >
          <X className="h-3 w-3 text-[var(--muted-foreground)]" />
        </button>
      </div>

      {step === "signal" && (
        <div className="space-y-1.5 p-2.5">
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setSigCatFilter(null)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-all",
                !sigCatFilter
                  ? "border-transparent bg-[var(--foreground)] text-[var(--background)]"
                  : "border-[var(--border)]/60 text-[var(--muted-foreground)]",
              )}
            >
              Tous
            </button>
            {presentCats.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSigCatFilter(sigCatFilter === cat.name ? null : cat.name)}
                className="rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-all"
                style={
                  sigCatFilter === cat.name
                    ? { background: cat.color, color: "#fff", borderColor: "transparent" }
                    : {
                        borderColor: `${cat.color}40`,
                        color: cat.color,
                        background: `${cat.color}10`,
                      }
                }
              >
                {cat.name}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              value={sigSearch}
              onChange={(e) => setSigSearch(e.target.value)}
              placeholder="Chercher…"
              autoFocus
              className="h-7 w-full rounded-lg border border-[var(--border)]/60 bg-transparent pl-7 text-xs focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid max-h-36 grid-cols-2 gap-1 overflow-y-auto">
            {filteredSignals.map((sig) => (
              <button
                key={sig.id}
                onClick={() => handlePickSignal(sig)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)]/60 px-2 py-1.5 text-left transition-all hover:bg-[var(--secondary)]/40"
                style={{ borderLeftColor: sigCatColor(sig), borderLeftWidth: 3 }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: sigCatColor(sig) }}
                />
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold">{sig.name}</p>
                  <p className="truncate text-[9px]" style={{ color: sigCatColor(sig) }}>
                    {sig.category}
                  </p>
                </div>
              </button>
            ))}
            {filteredSignals.length === 0 && (
              <p className="col-span-2 py-4 text-center text-[10px] text-[var(--muted-foreground)]">
                Aucun signal
              </p>
            )}
          </div>
        </div>
      )}

      {step === "connector" && selectedSignal && (
        <div className="space-y-1.5 p-2.5">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              value={ctSearch}
              onChange={(e) => setCtSearch(e.target.value)}
              placeholder="Chercher un connecteur…"
              autoFocus
              className="h-7 w-full rounded-lg border border-[var(--border)]/60 bg-transparent pl-7 text-xs focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid max-h-36 grid-cols-3 gap-1 overflow-y-auto">
            {filteredCTs.map((ct) => (
              <button
                key={ct.id}
                onClick={() => handlePickCT(ct)}
                className="flex flex-col items-center gap-1 rounded-lg border border-[var(--border)]/60 p-2 transition-all hover:border-[var(--accent)]/50 hover:bg-[var(--secondary)]/40"
              >
                <ConnectorIcon iconId={ct.iconId} color={ct.color} size={18} />
                <span className="text-center text-[9px] leading-tight font-medium">{ct.name}</span>
              </button>
            ))}
            {filteredCTs.length === 0 && (
              <p className="col-span-3 py-3 text-center text-[10px] text-[var(--muted-foreground)]">
                Aucun connecteur compatible
              </p>
            )}
          </div>
          <button
            onClick={() => {
              setStep("signal");
              setSelectedSignal(null);
            }}
            className="flex items-center gap-0.5 text-[9px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft className="h-3 w-3" />
            Changer de signal
          </button>
        </div>
      )}
    </div>
  );
}

// ── ConnectorRow (clickable, opens edit modal) ────────────────────────────
//
// Refactor : la row n'est plus expandable. Un clic ouvre la modale
// `ConnectorPortDialog` en mode édition (handled par le parent). Les actions
// `Dupliquer` / `Supprimer` restent disponibles via boutons inline sur la row.

export function ConnectorRow({
  entry,
  connectorTypes,
  signals,
  signalCategories,
  onEdit,
  onRemove,
  onDuplicate,
}: {
  entry: ConnectorEntry;
  connectorTypes: ConnectorType[];
  signals: Signal[];
  signalCategories: SignalCategory[];
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const ct = connectorTypes.find((c) => c.id === entry.connectorTypeId);
  const dirOpt = DIR_OPTIONS.find((d) => d.value === entry.direction)!;
  const faceColor = FACE_COLORS[entry.face];
  const linkedSignal = signals.find((s) => s.name === entry.signalName) ?? null;
  void signalCategories;
  const isIpSignal = linkedSignal?.isIp === true;

  return (
    <div
      className="group flex items-center gap-2 rounded-lg border border-[var(--border)]/60 px-2.5 py-1.5 transition-all hover:border-[var(--border)] hover:bg-[var(--secondary)]/30"
      style={{ borderLeftColor: faceColor, borderLeftWidth: 3 }}
    >
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <div className="shrink-0">
          {ct ? (
            <ConnectorIcon iconId={ct.iconId} color={ct.color} size={16} />
          ) : (
            <div className="h-4 w-4 rounded border border-[var(--border)]/60" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-[11px] font-semibold">
            <span className="truncate">{ct?.name ?? "—"}</span>
            {entry.version && (
              <span className="shrink-0 rounded border border-[var(--border)]/60 px-1 font-mono text-[8px] text-[var(--muted-foreground)]">
                {entry.version}
              </span>
            )}
          </p>
          {entry.signalName && (
            <p className="flex items-center gap-1 truncate text-[9px] text-[var(--muted-foreground)]">
              <span className="truncate">{entry.signalName}</span>
              {isIpSignal && (
                <span
                  className="shrink-0 rounded px-1 font-mono text-[8px] font-bold uppercase tracking-wider"
                  style={{
                    color: "var(--accent)",
                    backgroundColor:
                      "color-mix(in srgb, var(--accent) 14%, transparent)",
                  }}
                  title="Signal IP"
                >
                  IP
                </span>
              )}
            </p>
          )}
        </div>
        <span
          className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold"
          style={{ background: `${dirOpt.color}15`, color: dirOpt.color }}
        >
          {dirOpt.short}
        </span>
        {entry.gender && (
          <span className="shrink-0 rounded border border-[var(--border)]/60 px-1 py-0.5 text-[8px] font-bold text-[var(--muted-foreground)]">
            {entry.gender === "MALE" ? "M" : "F"}
          </span>
        )}
        <span className="w-4 shrink-0 text-center font-mono text-[10px] font-semibold text-[var(--muted-foreground)]">
          {entry.quantity}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onDuplicate}
          title="Dupliquer"
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/60 hover:text-[var(--foreground)]"
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Supprimer"
          // arkyo-server: habillage Strata
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// (Old expanded-row inline form removed — édition se fait désormais via la
//  modale `ConnectorPortDialog`, ouverte au clic sur la `ConnectorRow`.)

// ── ConnectorPortDialog (FormDialog — create + edit) ──────────────────────
//
// Modale unifiée d'ajout / édition d'un port (connecteur) d'équipement.
// - Si `entry` est null/undefined → mode CRÉATION (defaults + submit "Ajouter").
// - Si `entry` est défini → mode ÉDITION (pré-rempli + submit "Enregistrer",
//   préserve l'id existant).
//
// Layout en 2 colonnes équilibrées (size="2xl") :
//   - Col gauche  (« le port ») : Connecteur* (grille compacte) → Version
//                                 (pills, si applicable) → Signal (optionnel
//                                 avec badges IP/MC)
//   - Col droite  (« l'usage ») : Direction · Genre · Quantité · Label
//                                 → Rôle réseau (si signal IP)
//                                 → Redondance (si supportsRedundancy)
//
// Signal optionnel : un port de switch / media converter ne porte pas de
// signal propre — il transporte celui du pair. Filtrage bidirectionnel :
// sélectionner un signal restreint les connecteurs compatibles et
// inversement. Si l'admin change l'un et que l'autre devient incompatible,
// on reset l'autre et on affiche une notice inline.

const portSchema = z.object({
  connectorTypeId: z.string().min(1, "Sélectionner un connecteur."),
  version: z.string().optional(),
  direction: z.enum(["IN", "OUT", "BOTH"]),
  gender: z.enum(["MALE", "FEMALE"]),
  quantity: z.number().int().min(1).max(128),
  label: z.string(),
  // Signal optionnel — un port switching/transit (switch IT, media converter)
  // ne porte pas de signal propre. Le signal effectif est celui du pair.
  signalName: z.string().optional().default(""),
  networkRole: z.enum(["endpoint", "switching", "transit"]).optional(),
  disableRedundancy: z.boolean().optional(),
});
type PortValues = z.infer<typeof portSchema>;

const ADD_CONNECTOR_DEFAULTS: PortValues = {
  connectorTypeId: "",
  version: undefined,
  direction: "BOTH",
  gender: "FEMALE",
  quantity: 1,
  label: "",
  signalName: "",
  networkRole: undefined,
  disableRedundancy: undefined,
};

/**
 * Renvoie la liste des signaux compatibles avec un connecteur donné. Si le
 * signal n'a aucune contrainte `connectors[]` (raw non-array ou vide), il est
 * considéré compatible avec tous les connecteurs.
 */
function filterSignalsForConnector(
  signals: Signal[],
  ct: ConnectorType | null,
): Signal[] {
  if (!ct) return signals;
  return signals.filter((s) => {
    const raw = s.connectors;
    if (!Array.isArray(raw)) return true;
    const ids = raw as string[];
    if (ids.length === 0) return true;
    return ids.includes(ct.id) || ids.includes(ct.name);
  });
}

/**
 * Renvoie la liste des connecteurs compatibles avec un signal donné. Si le
 * signal n'a aucune contrainte `connectors[]`, tous les connecteurs sont
 * considérés compatibles.
 */
function filterConnectorsForSignal(
  connectorTypes: ConnectorType[],
  signal: Signal | null,
): ConnectorType[] {
  if (!signal) return connectorTypes;
  const raw = signal.connectors;
  if (!Array.isArray(raw)) return connectorTypes;
  const ids = raw as string[];
  if (ids.length === 0) return connectorTypes;
  const byId = connectorTypes.filter((ct) => ids.includes(ct.id));
  return byId.length > 0
    ? byId
    : connectorTypes.filter((ct) => ids.includes(ct.name));
}

export function ConnectorPortDialog({
  open,
  face,
  entry,
  signals,
  signalCategories,
  connectorTypes,
  onSave,
  onClose,
}: {
  open: boolean;
  face: ConnectorEntry["face"];
  /** null/undefined = création. Défini = édition (préserve l'id). */
  entry?: ConnectorEntry | null;
  signals: Signal[];
  signalCategories: SignalCategory[];
  connectorTypes: ConnectorType[];
  onSave: (entry: ConnectorEntry) => void;
  onClose: () => void;
}) {
  const isEdit = !!entry;
  const sigCatColor = (sig: Signal) =>
    signalCategories.find((c) => c.name === sig.category)?.color ?? sig.color;

  // ── Defaults : create => ADD_CONNECTOR_DEFAULTS ; edit => mappés depuis entry
  // useMemo + identité stable pour que le reset interne du FormDialog se
  // déclenche uniquement quand on ouvre/change la cible d'édition.
  const defaultValues = React.useMemo<PortValues>(() => {
    if (entry) {
      return {
        connectorTypeId: entry.connectorTypeId,
        version: entry.version ?? undefined,
        direction: entry.direction,
        gender: entry.gender,
        quantity: entry.quantity,
        label: entry.label ?? "",
        signalName: entry.signalName ?? "",
        networkRole: entry.networkRole,
        disableRedundancy: entry.disableRedundancy,
      };
    }
    return ADD_CONNECTOR_DEFAULTS;
    // entry?.id sert d'identité stable : tant qu'on édite le même port,
    // l'objet defaultValues reste le même et le form n'est pas reseté en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const handleSubmit = (values: PortValues) => {
    const ct = connectorTypes.find((c) => c.id === values.connectorTypeId);
    if (!ct) return;
    const dirShort =
      values.direction === "IN" ? "IN" : values.direction === "OUT" ? "OUT" : "I/O";
    const finalLabel =
      values.label.trim() ||
      (values.signalName ? `${values.signalName} ${dirShort}` : ct.name);
    onSave({
      id: entry?.id ?? uid(),
      face,
      connectorTypeId: ct.id,
      version: values.version && values.version.length > 0 ? values.version : undefined,
      signalName: values.signalName,
      direction: values.direction,
      quantity: values.quantity,
      label: finalLabel,
      gender: values.gender,
      networkRole: values.networkRole,
      disableRedundancy: values.disableRedundancy === true ? true : undefined,
    });
  };

  return (
    <FormDialog<PortValues>
      open={open}
      onOpenChange={handleOpenChange}
      icon={<Plug />}
      eyebrow={isEdit ? "PORT" : "CONNECTEUR"}
      title={
        isEdit
          ? "Modifier le connecteur"
          : `Nouveau connecteur · face ${FACE_LABELS[face].toLowerCase()}`
      }
      schema={portSchema}
      defaultValues={defaultValues}
      onSubmit={handleSubmit}
      submitLabel={isEdit ? "Enregistrer" : "Ajouter"}
      size="2xl"
    >
      {(form) => (
        <ConnectorPortFormBody
          form={form}
          signals={signals}
          signalCategories={signalCategories}
          connectorTypes={connectorTypes}
          sigCatColor={sigCatColor}
        />
      )}
    </FormDialog>
  );
}

/**
 * Corps du formulaire — extrait pour pouvoir utiliser `useEffect`
 * (réconciliation bidirectionnelle signal ↔ connecteur) sans casser le
 * render-prop du FormDialog.
 */
function ConnectorPortFormBody({
  form,
  signals,
  signalCategories,
  connectorTypes,
  sigCatColor,
}: {
  form: ReturnType<typeof useForm<PortValues>>;
  signals: Signal[];
  signalCategories: SignalCategory[];
  connectorTypes: ConnectorType[];
  sigCatColor: (sig: Signal) => string;
}) {
  const connectorTypeId = form.watch("connectorTypeId");
  const version = form.watch("version");
  const direction = form.watch("direction");
  const gender = form.watch("gender");
  const quantity = form.watch("quantity");
  const signalName = form.watch("signalName");
  const networkRole = form.watch("networkRole");
  const disableRedundancy = form.watch("disableRedundancy");

  const selectedCT = connectorTypes.find((c) => c.id === connectorTypeId) ?? null;
  const selectedSignal = signalName
    ? (signals.find((s) => s.name === signalName) ?? null)
    : null;

  const ctVersions = selectedCT?.versions ?? [];

  // Listes filtrées (réciproques).
  const filteredConnectors = filterConnectorsForSignal(connectorTypes, selectedSignal);
  const filteredSignals = filterSignalsForConnector(signals, selectedCT);

  // Notice inline quand on doit reset une sélection devenue incompatible.
  const [resetNotice, setResetNotice] = React.useState<string | null>(null);

  // Réconciliation : si la sélection courante n'est plus dans la liste filtrée
  // après une modification de l'autre côté, on la reset. Affiche une notice.
  React.useEffect(() => {
    if (!selectedCT || !selectedSignal) return;
    const ctStillOk = filteredConnectors.some((c) => c.id === selectedCT.id);
    const sigStillOk = filteredSignals.some((s) => s.name === selectedSignal.name);
    if (!ctStillOk) {
      form.setValue("connectorTypeId", "", { shouldDirty: true });
      form.setValue("version", undefined, { shouldDirty: true });
      setResetNotice("Connecteur incompatible avec ce signal — choisis-en un autre.");
      return;
    }
    if (!sigStillOk) {
      form.setValue("signalName", "", { shouldDirty: true });
      setResetNotice("Signal incompatible avec ce connecteur — choisis-en un autre.");
    }
    // On dépend uniquement des deux ids — pas des listes elles-mêmes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCT?.id, selectedSignal?.name]);

  // Si la version courante ne fait plus partie des versions du connecteur
  // sélectionné, on la reset silencieusement.
  React.useEffect(() => {
    if (!version) return;
    if (!ctVersions.includes(version)) {
      form.setValue("version", undefined, { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectorTypeId]);

  const isIpSignal = selectedSignal?.isIp === true;
  const supportsRedundancy = selectedSignal?.supportsRedundancy === true;

  return (
    <>
      {/* ── 2 colonnes équilibrées ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* ── Col gauche : « Le port » ─ Connecteur → Version → Signal ── */}
        <div className="space-y-5">
          <FormSection title="Connecteur *">
            {filteredConnectors.length === 0 ? (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Aucun connecteur compatible avec ce signal —{" "}
                <a
                  href="/supervisor/settings"
                  className="text-[var(--accent)] underline"
                >
                  paramétrer la compatibilité
                </a>
                .
              </p>
            ) : (
              <div
                className="grid max-h-[260px] gap-2 overflow-y-auto pr-1"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))" }}
              >
                {filteredConnectors.map((c) => {
                  const selected = c.id === connectorTypeId;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => {
                        form.setValue("connectorTypeId", c.id, { shouldDirty: true });
                        form.setValue("version", undefined, { shouldDirty: true });
                        setResetNotice(null);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 transition-all",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)]/10"
                          : "border-[var(--border)]/60 hover:border-[var(--border)] hover:bg-[var(--secondary)]/40",
                      )}
                    >
                      <ConnectorIcon iconId={c.iconId} color={c.color} size={24} />
                      <span className="w-full truncate text-center text-[10px] font-medium">
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {form.formState.errors.connectorTypeId && (
              <p className="text-xs text-[var(--destructive)]">
                {form.formState.errors.connectorTypeId.message}
              </p>
            )}
          </FormSection>

          {/* Version — visible UNIQUEMENT si le connecteur sélectionné en a */}
          {selectedCT && ctVersions.length > 0 && (
            <FormSection
              title="Version"
              tooltip="Décline du même connecteur (75Ω, Cat 6a…). Sélectionner si applicable."
            >
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    form.setValue("version", undefined, { shouldDirty: true })
                  }
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                    !version
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  Aucune
                </button>
                {ctVersions.map((v) => {
                  const isSel = version === v;
                  return (
                    <button
                      type="button"
                      key={v}
                      onClick={() =>
                        form.setValue("version", v, { shouldDirty: true })
                      }
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                        isSel
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                      )}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </FormSection>
          )}

          <FormSection
            title="Signal"
            tooltip="Optionnel. Laisser vide pour un port de switch ou media converter — il transporte alors le signal du pair."
          >
            <select
              {...form.register("signalName", {
                onChange: () => setResetNotice(null),
              })}
              className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <option value="">— Aucun (passe-tout) —</option>
              {filteredSignals.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name} · {s.category}
                </option>
              ))}
            </select>
            {form.formState.errors.signalName && (
              <p className="text-xs text-[var(--destructive)]">
                {form.formState.errors.signalName.message}
              </p>
            )}
            {selectedCT && filteredSignals.length === 0 && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Aucun signal déclaré pour ce connecteur — laisse vide ou
                paramètre la compatibilité dans Supervisor → Settings → Signaux.
              </p>
            )}
            {selectedSignal && (
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
                  style={{
                    borderColor: `${sigCatColor(selectedSignal)}40`,
                    color: sigCatColor(selectedSignal),
                    background: `${sigCatColor(selectedSignal)}10`,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: sigCatColor(selectedSignal) }}
                  />
                  <span className="font-semibold">{selectedSignal.category}</span>
                </span>
                {isIpSignal && (
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider"
                    style={{
                      color: "var(--accent)",
                      backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)",
                    }}
                    title="Signal IP"
                  >
                    IP
                  </span>
                )}
                {supportsRedundancy && (
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider"
                    style={{
                      color: "#8b5cf6",
                      backgroundColor: "color-mix(in srgb, #8b5cf6 14%, transparent)",
                    }}
                    title="Supporte la redondance Class A/B (ST 2022-7)"
                  >
                    MC
                  </span>
                )}
              </div>
            )}
            {resetNotice && (
              // arkyo-server: habillage Strata
              <p className="rounded-md border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2.5 py-1.5 text-[11px] text-[var(--warning-text)]">
                {resetNotice}
              </p>
            )}
          </FormSection>
        </div>

        {/* ── Col droite : « L'usage » ─ Direction → Genre → Qty → Label
            → Rôle réseau → Redondance ─────────────────────────────────── */}
        <div className="space-y-5">
          <FormSection title="Direction">
            <div className="flex flex-wrap gap-2">
              {DIR_OPTIONS.map((d) => {
                const isSelected = direction === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() =>
                      form.setValue("direction", d.value, { shouldDirty: true })
                    }
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                      !isSelected &&
                        "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                    style={
                      isSelected
                        ? {
                            borderColor: d.color,
                            backgroundColor: `${d.color}15`,
                            color: d.color,
                          }
                        : { borderColor: "var(--border)" }
                    }
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: d.color }}
                    />
                    {d.short}
                  </button>
                );
              })}
            </div>
          </FormSection>

          <FormSection title="Genre">
            <div className="flex flex-wrap gap-2">
              {GENDER_OPTIONS.map((g) => {
                const isSelected = gender === g.value;
                return (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() =>
                      form.setValue("gender", g.value, { shouldDirty: true })
                    }
                    className={cn(
                      "flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                      isSelected
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </FormSection>

          <FormSection title="Quantité">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  form.setValue("quantity", Math.max(1, (quantity ?? 1) - 1), {
                    shouldDirty: true,
                  })
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-sm transition-colors hover:bg-[var(--secondary)]/40"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={128}
                {...form.register("quantity", { valueAsNumber: true })}
                className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 text-center font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  form.setValue("quantity", Math.min(128, (quantity ?? 1) + 1), {
                    shouldDirty: true,
                  })
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-sm transition-colors hover:bg-[var(--secondary)]/40"
              >
                +
              </button>
            </div>
          </FormSection>

          <FormSection title="Label (optionnel)">
            <input
              {...form.register("label")}
              placeholder="Auto si vide…"
              className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
          </FormSection>

          {/* Rôle réseau — visible uniquement si signal IP */}
          {isIpSignal && (
            <FormSection
              title="Rôle réseau"
              tooltip="Endpoint = port IP avec adresse. Switching = port L2 d'un switch. Transit = passe-réseau L1 (media converter)."
            >
              <div className="flex flex-wrap gap-1.5">
                {([
                  { value: undefined, label: "Aucun" },
                  { value: "endpoint", label: "Endpoint" },
                  { value: "switching", label: "Switching" },
                  { value: "transit", label: "Transit" },
                ] as const).map((opt) => {
                  const isSel = networkRole === opt.value;
                  return (
                    <button
                      type="button"
                      key={opt.label}
                      onClick={() =>
                        form.setValue("networkRole", opt.value, {
                          shouldDirty: true,
                        })
                      }
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                        isSel
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </FormSection>
          )}

          {/* Redondance — visible uniquement si signal supporte la redondance */}
          {supportsRedundancy && (
            <FormSection
              title="Redondance"
              tooltip="Cochez si ce port spécifique n'implémente pas la redondance Class A/B même si le protocole la supporte."
            >
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={disableRedundancy === true}
                  onChange={(e) =>
                    form.setValue(
                      "disableRedundancy",
                      e.target.checked ? true : undefined,
                      { shouldDirty: true },
                    )
                  }
                  className="accent-[var(--accent)]"
                />
                <span className="text-xs text-[var(--foreground)]">
                  Pas de redondance sur ce port
                </span>
              </label>
            </FormSection>
          )}
        </div>
      </div>
    </>
  );
}

// ── Plus icon re-export so tabs can use it without re-importing lucide ────

export { Plus };
