"use client";

import { useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Check,
  Search,
  ChevronRight,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";

// ── UUID helper ────────────────────────────────────────────────────────────
function uid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      return crypto.randomUUID();
  } catch {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Types ──────────────────────────────────────────────────────────────────

type Brand = { id: string; name: string; logoUrl: string | null };
type EquipmentCategory = {
  id: string;
  name: string;
  color: string;
  parentId?: string | null;
  children?: EquipmentCategory[];
};
type ConnectorType = {
  id: string;
  name: string;
  version: string | null;
  category: string;
  iconId: string;
  color: string;
};
type Signal = { id: string; name: string; category: string; color: string; connectors: unknown };
type SignalCategory = { id: string; name: string; color: string; sortOrder: number };

export type ConnectorEntry = {
  id: string;
  face: "FRONT" | "REAR";
  connectorTypeId: string;
  signalName: string;
  quantity: number;
  label: string;
  direction: "IN" | "OUT" | "BOTH";
  networkRole?: "endpoint" | "switching" | "patch" | "management";
};

export type EquipmentFormData = {
  name: string;
  reference: string;
  category: string;
  brandId: string;
  isRackable: boolean;
  heightU: number | null;
  depthMm: number | null;
  widthFraction: "FULL" | "HALF" | "THIRD" | "QUARTER";
  dimLmm: number | null;
  dimWmm: number | null;
  dimHmm: number | null;
  weight: number | null;
  powerW: number | null;
  hasDualPsu: boolean;
  connectorEntries: ConnectorEntry[];
  imageUrl: string;
  rackSymbolUrl: string;
  rackSymbolRearUrl: string;
  notes: string;
  isActive: boolean;
};

export type EquipmentWithBrand = {
  id: string;
  name: string;
  reference: string | null;
  category: string | null;
  brandId: string | null;
  brand?: Brand | null;
  isRackable: boolean;
  heightU: number | null;
  depthMm: number | null;
  widthFraction: string;
  dimLmm: number | null;
  dimWmm: number | null;
  dimHmm: number | null;
  weight: number | null;
  powerW: number | null;
  hasDualPsu: boolean;
  connectors: unknown;
  imageUrl: string | null;
  rackSymbolUrl?: string | null;
  rackSymbolRearUrl?: string | null;
  notes: string | null;
  tags: unknown;
  isActive: boolean;
};

// ── Constants ──────────────────────────────────────────────────────────────

const WF_OPTIONS: { value: EquipmentFormData["widthFraction"]; label: string; desc: string }[] = [
  { value: "FULL", label: "1/1", desc: "Pleine largeur" },
  { value: "HALF", label: "1/2", desc: "Demi" },
  { value: "THIRD", label: "1/3", desc: "Tiers" },
  { value: "QUARTER", label: "1/4", desc: "Quart" },
];

const FACE_COLORS = { FRONT: "#3b82f6", REAR: "#8b5cf6" };
const FACE_LABELS = { FRONT: "Avant", REAR: "Arrière" };

const DIR_OPTIONS: {
  value: ConnectorEntry["direction"];
  label: string;
  short: string;
  color: string;
}[] = [
  { value: "IN", label: "Entrée", short: "IN", color: "#10b981" },
  { value: "OUT", label: "Sortie", short: "OUT", color: "#f59e0b" },
  { value: "BOTH", label: "Bidirectionnel", short: "I/O", color: "#6366f1" },
];

const NETWORK_ROLE_OPTIONS: {
  value: NonNullable<ConnectorEntry["networkRole"]> | "";
  label: string;
}[] = [
  { value: "", label: "Auto" },
  { value: "endpoint", label: "Endpoint" },
  { value: "switching", label: "Switching (L2)" },
  { value: "management", label: "Management" },
  { value: "patch", label: "Patch" },
];

const NETWORK_CONNECTOR_RE = /(RJ-?45|SFP\+?|QSFP\+?|Ethernet|Fiber|Optical)/i;
function isNetworkCapable(ct: ConnectorType | undefined): boolean {
  if (!ct) return false;
  return NETWORK_CONNECTOR_RE.test(ct.name);
}

const STEPS = [
  { id: 1, label: "Identité" },
  { id: 2, label: "Format" },
  { id: 3, label: "Connecteurs" },
  { id: 4, label: "Finition" },
] as const;

const inputCls =
  "flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

// ── Helpers ────────────────────────────────────────────────────────────────

function initialForm(eq?: Partial<EquipmentWithBrand>): EquipmentFormData {
  let connectorEntries: ConnectorEntry[] = [];
  if (Array.isArray(eq?.connectors)) {
    connectorEntries = (eq.connectors as ConnectorEntry[]).map((c) => ({
      ...c,
      id: c.id ?? uid(),
      signalName: c.signalName ?? "",
    }));
  }
  return {
    name: eq?.name ?? "",
    reference: eq?.reference ?? "",
    category: eq?.category ?? "",
    brandId: eq?.brandId ?? "",
    isRackable: eq?.isRackable ?? true,
    heightU: eq?.heightU ?? null,
    depthMm: eq?.depthMm ?? null,
    widthFraction: (eq?.widthFraction as EquipmentFormData["widthFraction"]) ?? "FULL",
    dimLmm: eq?.dimLmm ?? null,
    dimWmm: eq?.dimWmm ?? null,
    dimHmm: eq?.dimHmm ?? null,
    weight: eq?.weight ?? null,
    powerW: eq?.powerW ?? null,
    hasDualPsu: eq?.hasDualPsu ?? false,
    connectorEntries,
    imageUrl: eq?.imageUrl ?? "",
    rackSymbolUrl: eq?.rackSymbolUrl ?? "",
    rackSymbolRearUrl: eq?.rackSymbolRearUrl ?? "",
    notes: eq?.notes ?? "",
    isActive: eq?.isActive ?? true,
  };
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
        {label}
        {/* arkyo-server: habillage Strata */}
        {required && <span className="ml-0.5 text-[var(--danger-text)]">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

// ── SliderInput ────────────────────────────────────────────────────────────

function SliderInput({
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  value: number | null;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number | null) => void;
}) {
  const val = value ?? min;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={val}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer accent-[var(--accent)]"
        />
        <div className="flex shrink-0 items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
            className="h-8 w-20 rounded-lg border border-[var(--border)] bg-transparent px-2 text-center text-sm focus:ring-2 focus:ring-[var(--accent)] focus:outline-none"
          />
          <span className="w-6 text-xs text-[var(--muted-foreground)]">{unit}</span>
        </div>
      </div>
      <div className="flex justify-between px-0.5 text-[10px] text-[var(--muted-foreground)]">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}

// ── BrandPicker ────────────────────────────────────────────────────────────

function BrandPicker({
  brands,
  value,
  onChange,
}: {
  brands: Brand[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = brands.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une marque…"
          className="flex h-8 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 pl-8 text-sm focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
        />
      </div>
      <div className="max-h-52 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-2">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}
        >
          <button
            type="button"
            onClick={() => onChange("")}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-all",
              !value
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]",
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
              —
            </div>
            <span className="w-full truncate text-center">Aucune</span>
          </button>
          {filtered.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onChange(b.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-all",
                value === b.id
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]",
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-white dark:bg-white/10">
                {b.logoUrl ? (
                  <img
                    src={b.logoUrl}
                    alt=""
                    className="h-full w-full object-contain p-1"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span className="text-[9px] font-bold text-[var(--muted-foreground)]">
                    {b.name.slice(0, 3).toUpperCase()}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "w-full truncate text-center text-[10px] font-medium",
                  value === b.id ? "text-[var(--accent)]" : "",
                )}
              >
                {b.name}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-6 text-center text-xs text-[var(--muted-foreground)]">
              Aucune marque pour « {search} »
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CategoryPicker ─────────────────────────────────────────────────────────

function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: EquipmentCategory[];
  value: string;
  onChange: (v: string) => void;
}) {
  const rootCategories = categories.filter((c) => !c.parentId);
  const [parentId, setParentId] = useState<string | null>(() => {
    for (const p of rootCategories) {
      if (p.name === value) return null;
      for (const c of p.children ?? []) {
        if (c.name === value) return p.id;
      }
    }
    return null;
  });
  const selectedParent = parentId ? rootCategories.find((p) => p.id === parentId) : null;
  const children = selectedParent ? (selectedParent.children ?? []) : [];

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <p className="text-[10px] font-medium tracking-wide text-[var(--muted-foreground)] uppercase">
          Famille
        </p>
        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-1.5">
          {rootCategories.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setParentId(p.id);
                if (!p.children?.length) onChange(p.name);
                else onChange("");
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                parentId === p.id
                  ? "font-semibold"
                  : "text-[var(--foreground)] hover:bg-[var(--secondary)]",
              )}
              style={parentId === p.id ? { background: `${p.color}18`, color: p.color } : {}}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="flex-1 truncate">{p.name}</span>
              {parentId === p.id && !p.children?.length && <Check className="h-3 w-3 shrink-0" />}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-[10px] font-medium tracking-wide text-[var(--muted-foreground)] uppercase">
          Sous-catégorie
        </p>
        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-1.5">
          {!selectedParent ? (
            <p className="px-2.5 py-3 text-center text-[11px] text-[var(--muted-foreground)]">
              ← Choisir une famille
            </p>
          ) : children.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-[11px] text-[var(--muted-foreground)]">
              Pas de sous-catégorie
            </p>
          ) : (
            children.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange(c.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  value === c.name
                    ? "font-semibold"
                    : "text-[var(--foreground)] hover:bg-[var(--secondary)]",
                )}
                style={
                  value === c.name
                    ? { background: `${selectedParent.color}18`, color: selectedParent.color }
                    : {}
                }
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
                  style={{ background: selectedParent.color }}
                />
                <span className="flex-1 truncate">{c.name}</span>
                {value === c.name && <Check className="h-3 w-3 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Port Wizard (Step 3) ───────────────────────────────────────────────────

type WizardStep = "signal" | "connector" | "details";

function PortWizard({
  face,
  signals,
  signalCategories,
  connectorTypes,
  onAdd,
  onClose,
}: {
  face: "FRONT" | "REAR";
  signals: Signal[];
  signalCategories: SignalCategory[];
  connectorTypes: ConnectorType[];
  onAdd: (entry: ConnectorEntry) => void;
  onClose: () => void;
}) {
  const [wizStep, setWizStep] = useState<WizardStep>("signal");
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [selectedCT, setSelectedCT] = useState<ConnectorType | null>(null);
  const [direction, setDirection] = useState<ConnectorEntry["direction"]>("BOTH");
  const [quantity, setQuantity] = useState(1);
  const [label, setLabel] = useState("");
  const [sigSearch, setSigSearch] = useState("");
  const [sigCatFilter, setSigCatFilter] = useState<string | null>(null);
  const [ctSearch, setCtSearch] = useState("");
  const [creatingCT, setCreatingCT] = useState(false);
  const [newCtName, setNewCtName] = useState("");
  const [newCtSaving, setNewCtSaving] = useState(false);

  const faceColor = FACE_COLORS[face];

  // Couleur de catégorie d'un signal — source de vérité : signalCategories
  const sigCatColor = (sig: Signal) =>
    signalCategories.find((c) => c.name === sig.category)?.color ?? sig.color;

  // Connectors compatible with selected signal
  const compatibleCTs = selectedSignal
    ? (() => {
        const raw = selectedSignal.connectors;
        if (!Array.isArray(raw)) return connectorTypes;
        const ids = raw as string[];
        if (ids.length === 0) return connectorTypes;
        // Nouveau format : IDs — sinon fallback noms (ancien format)
        const byId = connectorTypes.filter((ct) => ids.includes(ct.id));
        if (byId.length > 0) return byId;
        return connectorTypes.filter((ct) => ids.includes(ct.name));
      })()
    : connectorTypes;

  // Catégories présentes dans la liste de signaux, triées par sortOrder
  const presentCats = signalCategories.filter((c) => signals.some((s) => s.category === c.name));

  const filteredSignals = signals.filter((s) => {
    if (sigCatFilter && s.category !== sigCatFilter) return false;
    if (sigSearch && !s.name.toLowerCase().includes(sigSearch.toLowerCase())) return false;
    return true;
  });
  const filteredCTs = compatibleCTs.filter(
    (ct) => !ctSearch || ct.name.toLowerCase().includes(ctSearch.toLowerCase()),
  );

  const dirOpt = DIR_OPTIONS.find((d) => d.value === direction)!;

  // Auto-label when direction changes
  const buildLabel = (sig: Signal | null, dir: ConnectorEntry["direction"]) => {
    if (!sig) return "";
    const dirLabel = dir === "IN" ? "IN" : dir === "OUT" ? "OUT" : "I/O";
    return `${sig.name} ${dirLabel}`;
  };

  const handlePickSignal = (sig: Signal) => {
    setSelectedSignal(sig);
    setSelectedCT(null);
    setLabel(buildLabel(sig, direction));
    setWizStep("connector");
  };

  const handlePickCT = (ct: ConnectorType) => {
    setSelectedCT(ct);
    setWizStep("details");
  };

  const handleDirectionChange = (dir: ConnectorEntry["direction"]) => {
    setDirection(dir);
    if (selectedSignal) setLabel(buildLabel(selectedSignal, dir));
  };

  const handleCreateCT = async () => {
    if (!newCtName.trim() || !selectedSignal) return;
    setNewCtSaving(true);
    try {
      const res = await fetch("/api/admin/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCtName.trim(),
          category: selectedSignal.category,
          iconId: "bnc",
          color: selectedSignal.color,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        handlePickCT(created);
        setCreatingCT(false);
        setNewCtName("");
      }
    } finally {
      setNewCtSaving(false);
    }
  };

  const handleAdd = () => {
    if (!selectedCT) return;
    onAdd({
      id: uid(),
      face,
      connectorTypeId: selectedCT.id,
      signalName: selectedSignal?.name ?? "",
      direction,
      quantity,
      label,
    });
    onClose();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Wizard header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ background: faceColor }} />
          <span className="text-xs font-semibold" style={{ color: faceColor }}>
            Ajouter — {FACE_LABELS[face]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 transition-colors hover:bg-[var(--border)]"
        >
          <X className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] px-4 py-2 text-[10px] text-[var(--muted-foreground)]">
        <button
          onClick={() => setWizStep("signal")}
          className={cn(
            "transition-colors",
            wizStep === "signal"
              ? "font-bold text-[var(--foreground)]"
              : "hover:text-[var(--foreground)]",
          )}
        >
          Signal
        </button>
        <ChevronRight className="h-3 w-3 opacity-40" />
        <button
          onClick={() => selectedSignal && setWizStep("connector")}
          className={cn(
            "transition-colors",
            wizStep === "connector"
              ? "font-bold text-[var(--foreground)]"
              : !selectedSignal
                ? "cursor-default opacity-30"
                : "hover:text-[var(--foreground)]",
          )}
        >
          {selectedSignal ? selectedSignal.name : "Connecteur"}
        </button>
        <ChevronRight className="h-3 w-3 opacity-40" />
        <span
          className={cn(
            wizStep === "details" ? "font-bold text-[var(--foreground)]" : "opacity-30",
          )}
        >
          {selectedCT ? selectedCT.name : "Détails"}
        </span>
      </div>

      {/* Step : Signal */}
      {wizStep === "signal" && (
        <div className="flex flex-1 flex-col overflow-y-auto">
          {/* Filtre catégories */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 pt-2.5 pb-1.5">
            <button
              onClick={() => setSigCatFilter(null)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-all",
                !sigCatFilter
                  ? "border-transparent bg-[var(--foreground)] text-[var(--background)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]/30",
              )}
            >
              Tous
            </button>
            {presentCats.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSigCatFilter(sigCatFilter === cat.name ? null : cat.name)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-all",
                )}
                style={
                  sigCatFilter === cat.name
                    ? { background: cat.color, color: "#fff", borderColor: "transparent" }
                    : {
                        borderColor: `${cat.color}50`,
                        color: cat.color,
                        background: `${cat.color}12`,
                      }
                }
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
                  style={{ background: sigCatFilter === cat.name ? "#fff" : cat.color }}
                />
                {cat.name}
              </button>
            ))}
          </div>

          {/* Recherche */}
          <div className="shrink-0 px-3 pb-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                value={sigSearch}
                onChange={(e) => setSigSearch(e.target.value)}
                placeholder="Chercher…"
                autoFocus
                className="flex h-7 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 pl-7 text-xs focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>

          {/* Grille signaux */}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <div className="grid grid-cols-2 gap-1.5">
              {filteredSignals.map((sig) => {
                const catColor = sigCatColor(sig);
                return (
                  <button
                    key={sig.id}
                    onClick={() => handlePickSignal(sig)}
                    className="group flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-left transition-all hover:bg-[var(--secondary)]"
                    style={{ borderLeftColor: catColor, borderLeftWidth: 3 }}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: catColor }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold transition-colors group-hover:text-[var(--accent)]">
                        {sig.name}
                      </p>
                      <p className="truncate text-[9px]" style={{ color: catColor, opacity: 0.8 }}>
                        {sig.category}
                      </p>
                    </div>
                  </button>
                );
              })}
              {filteredSignals.length === 0 && (
                <p className="col-span-2 py-6 text-center text-xs text-[var(--muted-foreground)]">
                  Aucun signal
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step : Connecteur */}
      {wizStep === "connector" && selectedSignal && (
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {/* Signal sélectionné + preview numérotation synoptique */}
          {(() => {
            const catColor = sigCatColor(selectedSignal);
            const dirLabel = direction === "IN" ? "IN" : direction === "OUT" ? "OUT" : "I/O";
            const previewLabel = `${selectedSignal.name} ${dirLabel}`;
            return (
              <div
                className="overflow-hidden rounded-xl border"
                style={{ borderColor: `${catColor}40` }}
              >
                <div
                  className="flex items-center gap-2 px-3 py-2"
                  style={{ background: `${catColor}15` }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: catColor }}
                  />
                  <span className="text-xs font-semibold" style={{ color: catColor }}>
                    {selectedSignal.name}
                  </span>
                  <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
                    choisir le connecteur
                  </span>
                </div>
                <div className="border-t px-3 py-2" style={{ borderColor: `${catColor}25` }}>
                  <p className="mb-1 text-[9px] font-medium tracking-wide text-[var(--muted-foreground)] uppercase">
                    Aperçu synoptique
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 3].map((n) => (
                      <span
                        key={n}
                        className="rounded-md px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                        style={{ background: `${catColor}15`, color: catColor }}
                      >
                        {previewLabel} {n}
                      </span>
                    ))}
                    <span className="self-center px-1 text-[9px] text-[var(--muted-foreground)]">
                      …
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              value={ctSearch}
              onChange={(e) => setCtSearch(e.target.value)}
              placeholder="Chercher un connecteur…"
              autoFocus
              className="flex h-7 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 pl-7 text-xs focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {filteredCTs.map((ct) => (
              <button
                key={ct.id}
                onClick={() => handlePickCT(ct)}
                className="group flex flex-col items-center gap-1.5 rounded-xl border border-[var(--border)] p-2.5 transition-all hover:border-[var(--accent)]/50 hover:bg-[var(--secondary)]"
              >
                <ConnectorIcon iconId={ct.iconId} color={ct.color} size={24} />
                <span className="text-center text-[10px] leading-tight font-medium transition-colors group-hover:text-[var(--accent)]">
                  {ct.name}
                </span>
              </button>
            ))}
            {filteredCTs.length === 0 && (
              <p className="col-span-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                Aucun connecteur compatible
              </p>
            )}
          </div>

          {/* Créer à la volée */}
          {!creatingCT ? (
            <button
              onClick={() => setCreatingCT(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Créer un nouveau connecteur…
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-2">
              <input
                value={newCtName}
                onChange={(e) => setNewCtName(e.target.value)}
                placeholder="Nom du connecteur…"
                autoFocus
                className="h-7 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 text-xs focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateCT();
                  if (e.key === "Escape") {
                    setCreatingCT(false);
                    setNewCtName("");
                  }
                }}
              />
              <button
                onClick={handleCreateCT}
                disabled={!newCtName.trim() || newCtSaving}
                // arkyo-server: habillage Strata
                className="flex h-7 items-center gap-1 rounded-lg bg-[var(--accent)] px-2.5 text-xs font-medium text-[var(--accent-foreground)] disabled:opacity-50"
              >
                {newCtSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Créer
              </button>
              <button
                onClick={() => {
                  setCreatingCT(false);
                  setNewCtName("");
                }}
                className="rounded-lg p-1 transition-colors hover:bg-[var(--border)]"
              >
                <X className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              </button>
            </div>
          )}
          <button
            onClick={() => setWizStep("signal")}
            className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <ArrowLeft className="h-3 w-3" />
            Changer de signal
          </button>
        </div>
      )}

      {/* Step : Détails */}
      {wizStep === "details" && selectedCT && selectedSignal && (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Résumé sélection */}
          <div className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: selectedSignal.color }}
            />
            <span className="font-semibold">{selectedSignal.name}</span>
            <ChevronRight className="h-3 w-3 opacity-40" />
            <ConnectorIcon iconId={selectedCT.iconId} color={selectedCT.color} size={14} />
            <span className="font-semibold">{selectedCT.name}</span>
            <button
              onClick={() => setWizStep("connector")}
              className="ml-auto text-[10px] text-[var(--accent)] hover:underline"
            >
              Changer
            </button>
          </div>

          {/* Direction */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
              Direction
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DIR_OPTIONS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => handleDirectionChange(d.value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border-2 py-2.5 transition-all",
                    direction === d.value
                      ? "border-transparent"
                      : "border-[var(--border)] hover:border-[var(--accent)]/40",
                  )}
                  style={
                    direction === d.value
                      ? { borderColor: d.color, background: `${d.color}12` }
                      : {}
                  }
                >
                  <span
                    className="text-lg font-black"
                    style={{ color: direction === d.value ? d.color : "var(--muted-foreground)" }}
                  >
                    {d.short}
                  </span>
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: direction === d.value ? d.color : "var(--muted-foreground)" }}
                  >
                    {d.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Quantité */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
              Quantité
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={64}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer accent-[var(--accent)]"
              />
              <input
                type="number"
                min={1}
                max={128}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                className="h-8 w-14 rounded-lg border border-[var(--border)] bg-transparent px-2 text-center text-sm focus:ring-2 focus:ring-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>

          {/* Label */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
              Label
            </p>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus:ring-2 focus:ring-[var(--accent)] focus:outline-none"
            />
            <div className="space-y-0.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 px-3 py-2">
              <p className="text-[10px] text-[var(--muted-foreground)]">
                Sur les synoptiques, chaque port sera numéroté automatiquement :
              </p>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {Array.from({ length: Math.min(quantity, 4) }).map((_, i) => (
                  <span
                    key={i}
                    className="rounded-md bg-[var(--accent)]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent)]"
                  >
                    {label || "LABEL"} {i + 1}
                  </span>
                ))}
                {quantity > 4 && (
                  <span className="px-1 text-[10px] text-[var(--muted-foreground)]">
                    …jusqu'à {label || "LABEL"} {quantity}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={handleAdd}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ background: faceColor }}
          >
            <Plus className="h-4 w-4" />
            Ajouter ce port
          </button>
        </div>
      )}
    </div>
  );
}

// ── ConnectorRow ───────────────────────────────────────────────────────────

function ConnectorRow({
  entry,
  connectorTypes,
  onUpdate,
  onRemove,
}: {
  entry: ConnectorEntry;
  connectorTypes: ConnectorType[];
  onUpdate: (patch: Partial<ConnectorEntry>) => void;
  onRemove: () => void;
}) {
  const ct = connectorTypes.find((c) => c.id === entry.connectorTypeId);
  const dirOpt = DIR_OPTIONS.find((d) => d.value === entry.direction)!;
  const faceColor = FACE_COLORS[entry.face];

  return (
    <div
      className="group flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 transition-colors hover:bg-[var(--secondary)]"
      style={{ borderLeftColor: faceColor, borderLeftWidth: 3 }}
    >
      {/* Icône connecteur */}
      <div className="shrink-0">
        {ct ? (
          <ConnectorIcon iconId={ct.iconId} color={ct.color} size={20} />
        ) : (
          <div className="h-5 w-5 rounded bg-[var(--border)]" />
        )}
      </div>

      {/* Nom + signal */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{ct?.name ?? "—"}</p>
        {entry.signalName && (
          <p className="truncate text-[9px] text-[var(--muted-foreground)]">{entry.signalName}</p>
        )}
      </div>

      {/* Direction badge */}
      <span
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold"
        style={{ background: `${dirOpt.color}18`, color: dirOpt.color }}
      >
        {dirOpt.short}
      </span>

      {/* Quantité */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => onUpdate({ quantity: Math.max(1, entry.quantity - 1) })}
          className="flex h-5 w-5 items-center justify-center rounded-md border border-[var(--border)] text-xs transition-colors hover:bg-[var(--border)]"
        >
          −
        </button>
        <span className="w-6 text-center font-mono text-xs font-semibold">{entry.quantity}</span>
        <button
          onClick={() => onUpdate({ quantity: Math.min(128, entry.quantity + 1) })}
          className="flex h-5 w-5 items-center justify-center rounded-md border border-[var(--border)] text-xs transition-colors hover:bg-[var(--border)]"
        >
          +
        </button>
      </div>

      {/* Label */}
      <input
        value={entry.label}
        onChange={(e) => onUpdate({ label: e.target.value })}
        placeholder="Label…"
        className="h-6 w-28 shrink-0 rounded-md border border-[var(--border)] bg-transparent px-2 text-[10px] focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
      />

      {/* Rôle réseau (uniquement pour les connecteurs réseau) */}
      {isNetworkCapable(ct) && (
        <select
          value={entry.networkRole ?? ""}
          onChange={(e) => {
            const v = e.target.value as NonNullable<ConnectorEntry["networkRole"]> | "";
            onUpdate({ networkRole: v === "" ? undefined : v });
          }}
          title="Rôle réseau"
          className="h-6 w-28 shrink-0 rounded-md border border-[var(--border)] bg-transparent px-1.5 text-[10px] focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
        >
          {NETWORK_ROLE_OPTIONS.map((o) => (
            <option key={o.value || "auto"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {/* Delete */}
      <button
        onClick={onRemove}
        // arkyo-server: habillage Strata
        className="shrink-0 rounded-lg p-1 text-[var(--muted-foreground)] opacity-0 transition-colors group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── StepIndicator ──────────────────────────────────────────────────────────

function StepIndicator({
  step,
  canNext,
  onGoto,
}: {
  step: number;
  canNext: boolean;
  onGoto: (s: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0 px-6 pt-4 pb-3">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex flex-1 items-center last:flex-none">
          <button
            onClick={() => {
              if (s.id < step || canNext) onGoto(s.id);
            }}
            className="flex shrink-0 items-center gap-2"
          >
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all",
                step === s.id
                  // arkyo-server: habillage Strata
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : s.id < step
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)]",
              )}
            >
              {s.id < step ? <Check className="h-3 w-3" /> : s.id}
            </div>
            <span
              className={cn(
                "hidden text-[11px] font-medium transition-colors sm:block",
                step === s.id ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
              )}
            >
              {s.label}
            </span>
          </button>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                "mx-2 h-px flex-1",
                s.id < step ? "bg-[var(--accent)]" : "bg-[var(--border)]",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────

export function EquipmentModal({
  equipment,
  brands,
  categories,
  connectorTypes,
  signals,
  signalCategories,
  uHeights,
  onClose,
  onSaved,
  initialStep,
}: {
  equipment?: EquipmentWithBrand;
  brands: Brand[];
  categories: EquipmentCategory[];
  connectorTypes: ConnectorType[];
  signals: Signal[];
  signalCategories: SignalCategory[];
  uHeights: number[];
  onClose: () => void;
  onSaved: (eq: EquipmentWithBrand) => void;
  /** Optional starting step (1-4). Useful to jump directly to connectors (3). */
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep ?? 1);
  const [form, setForm] = useState<EquipmentFormData>(() => initialForm(equipment));
  const [saving, setSaving] = useState(false);
  const [wizardFace, setWizardFace] = useState<"FRONT" | "REAR" | null>(null);

  const isEdit = !!equipment;

  const set = <K extends keyof EquipmentFormData>(key: K, val: EquipmentFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const updateConnector = (id: string, patch: Partial<ConnectorEntry>) =>
    setForm((prev) => ({
      ...prev,
      connectorEntries: prev.connectorEntries.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  const removeConnector = (id: string) =>
    setForm((prev) => ({
      ...prev,
      connectorEntries: prev.connectorEntries.filter((c) => c.id !== id),
    }));

  const addConnector = (entry: ConnectorEntry) =>
    setForm((prev) => ({ ...prev, connectorEntries: [...prev.connectorEntries, entry] }));

  const canNext = step === 1 ? form.name.trim().length > 0 : true;

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        reference: form.reference || null,
        category: form.category || null,
        brandId: form.brandId || null,
        isRackable: form.isRackable,
        heightU: form.isRackable ? form.heightU : null,
        depthMm: form.isRackable ? form.depthMm : null,
        widthFraction: form.isRackable ? form.widthFraction : "FULL",
        dimLmm: !form.isRackable ? form.dimLmm : null,
        dimWmm: !form.isRackable ? form.dimWmm : null,
        dimHmm: !form.isRackable ? form.dimHmm : null,
        weight: form.weight,
        powerW: form.powerW,
        hasDualPsu: false,
        connectors: form.connectorEntries,
        imageUrl: form.imageUrl || null,
        rackSymbolUrl: form.rackSymbolUrl || null,
        rackSymbolRearUrl: form.rackSymbolRearUrl || null,
        notes: form.notes || null,
        tags: null,
        isActive: form.isActive,
      };
      const saved = equipment
        ? await api.patch<EquipmentWithBrand>(`/api/equipment/${equipment.id}`, body)
        : await api.post<EquipmentWithBrand>("/api/equipment", body);
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  };

  const byFace = (face: "FRONT" | "REAR") => form.connectorEntries.filter((c) => c.face === face);

  const rootCategories = categories.filter((c) => !c.parentId);
  const catColor = (() => {
    for (const p of rootCategories) {
      if (p.name === form.category) return p.color;
      for (const c of p.children ?? []) {
        if (c.name === form.category) return p.color;
      }
    }
    return "#6366f1";
  })();
  const selectedBrand = brands.find((b) => b.id === form.brandId);
  const sortedU = [...uHeights].sort((a, b) => a - b);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        style={{ width: "min(1200px, 100%)", maxHeight: "94vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-6 pt-5 pb-4">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${catColor}25` }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" style={{ color: catColor }}>
              <rect x="2" y="7" width="20" height="10" rx="1.5" />
              <rect x="4" y="5" width="16" height="2" rx="1" opacity=".4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {equipment ? `Modifier — ${equipment.name}` : "Nouvel équipement"}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              {STEPS[step - 1].label}
            </p>
          </div>
          {step >= 2 && form.name && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5">
              {selectedBrand?.logoUrl && (
                <img
                  src={selectedBrand.logoUrl}
                  alt=""
                  className="h-4 w-auto max-w-[32px] object-contain"
                />
              )}
              <span className="max-w-[160px] truncate text-xs font-semibold">{form.name}</span>
              {form.category && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ background: `${catColor}20`, color: catColor }}
                >
                  {form.category}
                </span>
              )}
            </div>
          )}
          <button
            onClick={onClose}
            className="ml-1 rounded-lg p-1.5 transition-colors hover:bg-[var(--border)]"
          >
            <X className="h-4 w-4 text-[var(--muted-foreground)]" />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator step={step} canNext={canNext} onGoto={setStep} />

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Step 1 ── */}
          {step === 1 && (
            <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-6">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nom" required>
                  <input
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Sony BRC-X400"
                    autoFocus
                    className={inputCls}
                  />
                </Field>
                <Field label="Référence">
                  <input
                    value={form.reference}
                    onChange={(e) => set("reference", e.target.value)}
                    placeholder="BRC-X400"
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-5">
                <Field label="Catégorie">
                  <CategoryPicker
                    categories={categories}
                    value={form.category}
                    onChange={(v) => set("category", v)}
                  />
                </Field>
                <Field label="Marque">
                  <BrandPicker
                    brands={brands}
                    value={form.brandId}
                    onChange={(v) => set("brandId", v)}
                  />
                </Field>
              </div>
            </div>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
              <Field label="Type de montage">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      value: true,
                      label: 'Rack 19"',
                      desc: "Montage en baie",
                      svg: (
                        <svg viewBox="0 0 60 36" className="h-8 w-14">
                          <rect x={0} y={0} width={60} height={36} rx={4} fill="#1c1c1e" />
                          <rect x={0} y={0} width={7} height={36} rx={3} fill="#2a2a2e" />
                          <rect x={53} y={0} width={7} height={36} rx={3} fill="#2a2a2e" />
                          {[4, 13, 22, 31].map((y, i) => (
                            <rect
                              key={i}
                              x={9}
                              y={y}
                              width={42}
                              height={7}
                              rx={1.5}
                              fill="#2c2c30"
                            />
                          ))}
                        </svg>
                      ),
                    },
                    {
                      value: false,
                      label: "Pose libre",
                      desc: "Meuble, caméra, moniteur…",
                      svg: (
                        <svg viewBox="0 0 60 36" className="h-8 w-14">
                          <rect
                            x={4}
                            y={4}
                            width={52}
                            height={28}
                            rx={4}
                            fill="#1c1c1e"
                            stroke="#2a2a2e"
                            strokeWidth={2}
                          />
                          <rect x={10} y={10} width={40} height={16} rx={2} fill="#2c2c30" />
                          <circle
                            cx={30}
                            cy={18}
                            r={5}
                            fill="#1c1c1e"
                            stroke="#3a3a3e"
                            strokeWidth={1.5}
                          />
                        </svg>
                      ),
                    },
                  ].map(({ value, label, desc, svg }) => (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => set("isRackable", value)}
                      className={cn(
                        "flex flex-col items-center gap-2.5 rounded-xl border-2 p-4 transition-all",
                        form.isRackable === value
                          ? "border-[var(--accent)] bg-[var(--accent)]/8"
                          : "border-[var(--border)] hover:border-[var(--accent)]/40",
                      )}
                    >
                      {svg}
                      <div className="text-center">
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            form.isRackable === value && "text-[var(--accent)]",
                          )}
                        >
                          {label}
                        </p>
                        <p className="text-[10px] text-[var(--muted-foreground)]">{desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </Field>

              {form.isRackable ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-5">
                    <Field label="Format rack">
                      <div className="grid grid-cols-4 gap-2">
                        {WF_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => set("widthFraction", o.value)}
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-xl border-2 p-2.5 transition-all",
                              form.widthFraction === o.value
                                ? "border-[var(--accent)] bg-[var(--accent)]/8"
                                : "border-[var(--border)] hover:border-[var(--accent)]/40",
                            )}
                          >
                            <svg viewBox="0 0 60 20" className="h-5 w-full">
                              <rect x={0} y={0} width={60} height={20} rx={3} fill="#1c1c1e" />
                              <rect x={0} y={0} width={5} height={20} rx={2} fill="#2a2a2e" />
                              <rect x={55} y={0} width={5} height={20} rx={2} fill="#2a2a2e" />
                              {Array.from({
                                length:
                                  o.value === "FULL"
                                    ? 1
                                    : o.value === "HALF"
                                      ? 2
                                      : o.value === "THIRD"
                                        ? 3
                                        : 4,
                              }).map((_, i) => {
                                const total =
                                  o.value === "FULL"
                                    ? 1
                                    : o.value === "HALF"
                                      ? 2
                                      : o.value === "THIRD"
                                        ? 3
                                        : 4;
                                const sw = 50 / total;
                                return (
                                  <rect
                                    key={i}
                                    x={5 + i * sw + 0.5}
                                    y={3}
                                    width={sw - 1}
                                    height={14}
                                    rx={2}
                                    fill={i === 0 ? "#3b82f6" : "#2c2c30"}
                                    opacity={i === 0 ? 0.8 : 1}
                                  />
                                );
                              })}
                            </svg>
                            <span
                              className={cn(
                                "text-xs font-bold",
                                form.widthFraction === o.value ? "text-[var(--accent)]" : "",
                              )}
                            >
                              {o.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field label="Hauteur (U)" hint="Valeurs configurées dans Config → Dimensions">
                      {sortedU.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {sortedU.map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => set("heightU", u)}
                              className={cn(
                                "flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl border-2 font-bold transition-all",
                                form.heightU === u
                                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                                  : "border-[var(--border)] hover:border-[var(--accent)]/40",
                              )}
                            >
                              <span className="text-base leading-none">{u}</span>
                              <span className="text-[9px] font-normal text-[var(--muted-foreground)]">
                                U
                              </span>
                            </button>
                          ))}
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={form.heightU ?? ""}
                            onChange={(e) =>
                              set("heightU", e.target.value ? Number(e.target.value) : null)
                            }
                            placeholder="…"
                            className="h-12 w-12 rounded-xl border-2 border-[var(--border)] bg-transparent px-1 text-center text-sm focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)] focus:outline-none"
                          />
                        </div>
                      ) : (
                        <input
                          type="number"
                          min={1}
                          value={form.heightU ?? ""}
                          onChange={(e) =>
                            set("heightU", e.target.value ? Number(e.target.value) : null)
                          }
                          placeholder="1"
                          className={inputCls}
                        />
                      )}
                    </Field>
                  </div>
                  <Field label="Profondeur (mm)">
                    <SliderInput
                      value={form.depthMm}
                      min={100}
                      max={1000}
                      step={10}
                      unit="mm"
                      onChange={(v) => set("depthMm", v)}
                    />
                  </Field>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Longueur (mm)">
                    <input
                      type="number"
                      min={1}
                      value={form.dimLmm ?? ""}
                      onChange={(e) =>
                        set("dimLmm", e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="300"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Largeur (mm)">
                    <input
                      type="number"
                      min={1}
                      value={form.dimWmm ?? ""}
                      onChange={(e) =>
                        set("dimWmm", e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="200"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Hauteur (mm)">
                    <input
                      type="number"
                      min={1}
                      value={form.dimHmm ?? ""}
                      onChange={(e) =>
                        set("dimHmm", e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="150"
                      className={inputCls}
                    />
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                <Field label="Poids (kg)">
                  <SliderInput
                    value={form.weight}
                    min={0}
                    max={50}
                    step={0.1}
                    unit="kg"
                    onChange={(v) => set("weight", v)}
                  />
                </Field>
                <Field label="Consommation (W)">
                  <SliderInput
                    value={form.powerW}
                    min={0}
                    max={2000}
                    step={5}
                    unit="W"
                    onChange={(v) => set("powerW", v)}
                  />
                </Field>
              </div>
            </div>
          )}

          {/* ── Step 3 : Connecteurs ── */}
          {step === 3 && (
            <div className="flex flex-1 overflow-hidden">
              {/* Colonnes FRONT / REAR */}
              {(["FRONT", "REAR"] as const).map((face) => {
                const entries = byFace(face);
                const faceColor = FACE_COLORS[face];
                const isActive = wizardFace === face;
                return (
                  <div
                    key={face}
                    className="flex flex-1 flex-col overflow-hidden border-r border-[var(--border)] last:border-r-0"
                  >
                    {/* Face header */}
                    <div
                      className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3"
                      style={{ background: `${faceColor}10` }}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: faceColor }}
                        />
                        <span className="text-xs font-semibold" style={{ color: faceColor }}>
                          {FACE_LABELS[face]}
                        </span>
                        {entries.length > 0 && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                            style={{ background: `${faceColor}20`, color: faceColor }}
                          >
                            {entries.reduce((a, c) => a + c.quantity, 0)} ports
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setWizardFace(isActive ? null : face)}
                        className={cn(
                          "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all",
                          isActive ? "bg-[var(--border)] text-[var(--foreground)]" : "text-white",
                        )}
                        style={!isActive ? { background: faceColor } : {}}
                      >
                        {isActive ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        {isActive ? "Fermer" : "Ajouter"}
                      </button>
                    </div>

                    <div className="flex flex-1 overflow-hidden">
                      {/* Liste des connecteurs */}
                      <div
                        className={cn(
                          "flex flex-col gap-1.5 overflow-y-auto p-3 transition-all",
                          isActive ? "w-0 overflow-hidden p-0 opacity-0" : "flex-1",
                        )}
                      >
                        {entries.length === 0 ? (
                          <button
                            onClick={() => setWizardFace(face)}
                            className="flex min-h-[120px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] text-[var(--muted-foreground)] transition-all hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
                          >
                            <Plus className="h-5 w-5" />
                            <span className="text-xs">
                              Ajouter un port {FACE_LABELS[face].toLowerCase()}
                            </span>
                          </button>
                        ) : (
                          entries.map((entry) => (
                            <ConnectorRow
                              key={entry.id}
                              entry={entry}
                              connectorTypes={connectorTypes}
                              onUpdate={(patch) => updateConnector(entry.id, patch)}
                              onRemove={() => removeConnector(entry.id)}
                            />
                          ))
                        )}
                      </div>

                      {/* Wizard inline */}
                      {isActive && (
                        <div className="flex flex-1 flex-col overflow-hidden">
                          <PortWizard
                            face={face}
                            signals={signals}
                            signalCategories={signalCategories}
                            connectorTypes={connectorTypes}
                            onAdd={addConnector}
                            onClose={() => setWizardFace(null)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Step 4 ── */}
          {step === 4 && (
            <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
              <ImageCropUpload
                value={form.imageUrl}
                onChange={(url) => set("imageUrl", url)}
                folder="equipment/photos"
                label="Photo face avant"
              />
              {form.isRackable && form.heightU && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                    Symboles rack — {form.heightU}U · {form.widthFraction}
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <ImageCropUpload
                      value={form.rackSymbolUrl}
                      onChange={(url) => set("rackSymbolUrl", url)}
                      folder="equipment/symbols"
                      label="Face avant"
                      rackShape={{ heightU: form.heightU!, widthFraction: form.widthFraction }}
                    />
                    <ImageCropUpload
                      value={form.rackSymbolRearUrl}
                      onChange={(url) => set("rackSymbolRearUrl", url)}
                      folder="equipment/symbols"
                      label="Face arrière"
                      rackShape={{ heightU: form.heightU!, widthFraction: form.widthFraction }}
                    />
                  </div>
                </div>
              )}
              {!form.isRackable && (
                <ImageCropUpload
                  value={form.rackSymbolUrl}
                  onChange={(url) => set("rackSymbolUrl", url)}
                  folder="equipment/symbols"
                  label="Vue symbolique"
                />
              )}
              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={3}
                  placeholder="Remarques techniques, particularités…"
                  className="w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--ring)] focus:outline-none"
                />
              </Field>
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[var(--border)] p-3 select-none">
                <span className="text-sm">Équipement actif</span>
                <button
                  type="button"
                  onClick={() => set("isActive", !form.isActive)}
                  className={cn(
                    "relative h-6 w-10 shrink-0 overflow-hidden rounded-full transition-colors",
                    form.isActive ? "bg-[var(--accent)]" : "bg-[var(--border)]",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform",
                      form.isActive ? "translate-x-[19px]" : "translate-x-[3px]",
                    )}
                  />
                </button>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-6 py-4">
          <button
            onClick={step === 1 ? onClose : () => setStep(step - 1)}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)]"
          >
            {step > 1 && <ArrowLeft className="h-3.5 w-3.5" />}
            {step === 1 ? "Annuler" : "Retour"}
          </button>

          <div className="flex items-center gap-2">
            {/* Bouton Enregistrer disponible sur toutes les étapes en mode édition */}
            {isEdit && (
              <button
                onClick={handleSubmit}
                disabled={saving || !form.name.trim()}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-[var(--accent)] px-4 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enregistrer
              </button>
            )}

            {step < 4 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canNext}
                // arkyo-server: habillage Strata
                className="flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-5 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Suivant <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={saving || !form.name.trim()}
                // arkyo-server: habillage Strata
                className="flex h-9 items-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {equipment ? "Enregistrer" : "Créer l'équipement"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
