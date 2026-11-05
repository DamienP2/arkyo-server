"use client";

/**
 * NumberingTab — convention de numérotation des câbles.
 *
 * Layout 2 colonnes :
 *  - Gauche : card APERÇU (preview + switch Personnaliser + builder/légende
 *    + explication mode actif avec schéma)
 *  - Droite : cards de réglages (Contenant, Longueur, Séparateurs) —
 *    toujours visibles, mode perso ou pas (elles configurent les valeurs
 *    référencées par les chips {rack}, {sep1}, {sep2}, {seq}).
 *
 * Vocabulaire UI : "contenant" (au lieu de "rack"/"baie"). Variables backend
 * inchangées (`cable_include_rack`, template `{rack}`).
 */

import { useCallback, useState } from "react";
import { GripVertical, Info, Loader2, Plus, X } from "@/components/ui/icons";

import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { computeCableLabel, type CableDirDigit } from "@/lib/services/cable-numbering";
import { RangeInput } from "@/components/wizard/range-input";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  cablePad: number;
  setCablePad: React.Dispatch<React.SetStateAction<number>>;
  cableSep1: string;
  setCableSep1: React.Dispatch<React.SetStateAction<string>>;
  cableSep2: string;
  setCableSep2: React.Dispatch<React.SetStateAction<string>>;
  cableIncludeRack: boolean;
  setCableIncludeRack: React.Dispatch<React.SetStateAction<boolean>>;
  cableTemplate: string;
  setCableTemplate: React.Dispatch<React.SetStateAction<string>>;
  cableTemplateEnabled: boolean;
  setCableTemplateEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  apiBase?: string;
};

// ── Constantes ────────────────────────────────────────────────────────────────

const COLOR_CONTAINER = "var(--arkyo-blue, #6366f1)";
const COLOR_PREFIX = "var(--accent)";
const COLOR_SEQ = "var(--foreground)";
const COLOR_SUFFIX = "var(--arkyo-blue-light, #818cf8)";
const COLOR_SEP = "var(--muted-foreground)";
const COLOR_DIR = "var(--muted-foreground)";

const SEP_OPTIONS = [
  { val: "-", label: "Tiret", glyph: "-" },
  { val: ".", label: "Point", glyph: "." },
  { val: "_", label: "Underscore", glyph: "_" },
  { val: "/", label: "Slash", glyph: "/" },
  { val: "*", label: "Étoile", glyph: "*" },
  { val: "", label: "Aucun", glyph: "∅" },
] as const;

// ── Template drag & drop chips ──────────────────────────────────────────────

type ChipItem = { id: string; type: "var" | "text"; value: string };

const ALL_VARS = ["rack", "sep1", "prefix", "dir", "seq", "sep2", "suffix"] as const;

const CHIP_LABELS: Record<string, string> = {
  rack: "Contenant",
  sep1: "Séparateur 1",
  prefix: "Préfixe",
  dir: "Direction",
  seq: "Séquence",
  sep2: "Séparateur 2",
  suffix: "Suffixe",
};

const CHIP_COLORS: Record<string, string> = {
  rack: COLOR_CONTAINER,
  prefix: COLOR_PREFIX,
  dir: COLOR_DIR,
  seq: COLOR_SEQ,
  suffix: COLOR_SUFFIX,
  sep1: COLOR_SEP,
  sep2: COLOR_SEP,
};

const DEFAULT_CHIPS: ChipItem[] = [
  { id: "rack", type: "var", value: "rack" },
  { id: "sep1", type: "var", value: "sep1" },
  { id: "prefix", type: "var", value: "prefix" },
  { id: "dir", type: "var", value: "dir" },
  { id: "seq", type: "var", value: "seq" },
  { id: "sep2", type: "var", value: "sep2" },
  { id: "suffix", type: "var", value: "suffix" },
];

function parseTemplate(tpl: string): ChipItem[] {
  if (!tpl) return [...DEFAULT_CHIPS];
  const parts: ChipItem[] = [];
  const regex = /\{(rack|sep1|prefix|dir|seq|sep2|suffix)\}|([^{}]+)/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = regex.exec(tpl)) !== null) {
    if (m[1]) {
      parts.push({ id: `${m[1]}-${idx++}`, type: "var", value: m[1] });
    } else if (m[2]) {
      parts.push({ id: `text-${idx++}`, type: "text", value: m[2] });
    }
  }
  return parts.length > 0 ? parts : [...DEFAULT_CHIPS];
}

function chipsToTemplate(chips: ChipItem[]): string {
  return chips.map((c) => (c.type === "var" ? `{${c.value}}` : c.value)).join("");
}

// ── Composant principal ──────────────────────────────────────────────────────

export function NumberingTab({
  cablePad,
  setCablePad,
  cableSep1,
  setCableSep1,
  cableSep2,
  setCableSep2,
  cableIncludeRack,
  setCableIncludeRack,
  cableTemplate,
  setCableTemplate,
  cableTemplateEnabled,
  setCableTemplateEnabled,
  apiBase,
}: Props) {
  const base = apiBase ?? "/api/admin";
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (updates: Record<string, string>) => {
      setSaving(true);
      try {
        await api.patch(`${base}/config`, updates);
      } finally {
        setSaving(false);
      }
    },
    [base],
  );

  // ── Template drag & drop state ──────────────────────────────────────────
  const [chips, setChips] = useState<ChipItem[]>(() => parseTemplate(cableTemplate));
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const syncTemplate = (newChips: ChipItem[]) => {
    setChips(newChips);
    const tpl = chipsToTemplate(newChips);
    setCableTemplate(tpl);
    void save({ cable_template: tpl });
  };

  const addTextChip = () =>
    syncTemplate([...chips, { id: `text-${Date.now()}`, type: "text" as const, value: "" }]);

  const removeChip = (idx: number) => syncTemplate(chips.filter((_, i) => i !== idx));

  const updateTextChip = (idx: number, text: string) =>
    syncTemplate(chips.map((c, i) => (i === idx ? { ...c, value: text } : c)));

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newChips = [...chips];
    const [moved] = newChips.splice(dragIdx, 1);
    newChips.splice(idx, 0, moved);
    setDragIdx(idx);
    syncTemplate(newChips);
  };
  const handleDragEnd = () => setDragIdx(null);

  const effectiveIncludeRack = cableTemplateEnabled ? true : cableIncludeRack;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleToggleRack = (checked: boolean) => {
    setCableIncludeRack(checked);
    void save({ cable_include_rack: String(checked) });
  };
  const handleSep1 = (val: string) => {
    setCableSep1(val);
    void save({ cable_sep1: val });
  };
  const handleSep2 = (val: string) => {
    setCableSep2(val);
    void save({ cable_sep2: val });
  };
  const handlePad = (val: number) => {
    setCablePad(val);
    void save({ cable_pad: String(val) });
  };
  const handleTemplateToggle = (checked: boolean) => {
    setCableTemplateEnabled(checked);
    void save({ cable_template_enabled: String(checked) });
  };

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ════ COLONNE GAUCHE : APERÇU + EXPLICATION ════════════════════════ */}
      <div className="flex flex-col gap-4">
        <Card>
          {/* Header avec switch Personnaliser */}
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
                Aperçu
              </h3>
              {saving && <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />}
            </div>
            <ToggleWithLabel
              checked={cableTemplateEnabled}
              onChange={handleTemplateToggle}
              label="Personnaliser"
            />
          </div>

          {/* Preview */}
          <div className="mb-5 flex justify-center select-all [&_code]:text-3xl">
            <ColorizedCableLabel
              rackCode="RGA"
              prefix="V"
              suffix="HD"
              dir="1"
              seq={1}
              pad={cablePad}
              sep1={cableSep1}
              sep2={cableSep2}
              includeRack={effectiveIncludeRack}
              template={cableTemplate}
              templateEnabled={cableTemplateEnabled}
            />
          </div>

          {/* Builder (mode perso) ou légende (mode standard) */}
          {cableTemplateEnabled ? (
            <TemplateBuilder
              chips={chips}
              dragIdx={dragIdx}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onAddText={addTextChip}
              onRemove={removeChip}
              onUpdateText={updateTextChip}
              onAddVar={(v) =>
                syncTemplate([...chips, { id: `${v}-${Date.now()}`, type: "var", value: v }])
              }
            />
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {cableIncludeRack && <LegendDot color={COLOR_CONTAINER} label="contenant" />}
              <LegendDot color={COLOR_PREFIX} label="préfixe" />
              <LegendDot color={COLOR_DIR} label="direction" />
              <LegendDot color={COLOR_SEQ} label="séquence" />
              <LegendDot color={COLOR_SUFFIX} label="suffixe" />
            </div>
          )}

          {/* Bandeau info direction */}
          <div className="bg-muted/40 mt-5 flex w-full items-start gap-2 rounded-lg px-3 py-2">
            <Info className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
            <p className="text-muted-foreground text-xs leading-relaxed">
              Le 1<sup>er</sup> chiffre du séquentiel indique la direction :{" "}
              <strong>1</strong> = IN, <strong>2</strong> = OUT, <strong>3</strong> = BIDI.
            </p>
          </div>
        </Card>

        {/* Card explication selon mode */}
        <Card>
          {cableTemplateEnabled ? <ExplanationCustom /> : <ExplanationStandard />}
        </Card>
      </div>

      {/* ════ COLONNE DROITE : RÉGLAGES ════════════════════════════════════ */}
      <div className="flex flex-col gap-4">
        {/* Contenant masqué en mode perso : géré par le chip {rack} du builder */}
        {!cableTemplateEnabled && (
          <Card>
            <ContainerToggle checked={cableIncludeRack} onChange={handleToggleRack} />
          </Card>
        )}

        <Card>
          <RangeInput
            label="Longueur séquence"
            unit="chiffres"
            showBounds
            min={3}
            max={10}
            step={1}
            value={cablePad}
            onChange={handlePad}
          />
          <div
            className="text-muted-foreground mt-3 flex items-center justify-between text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <span>
              1 →{" "}
              <span className="text-foreground font-bold">
                1{"0".repeat(Math.max(0, cablePad - 2))}1
              </span>
            </span>
            <span className="opacity-40">·</span>
            <span>
              42 →{" "}
              <span className="text-foreground font-bold">
                1{String(42).padStart(Math.max(1, cablePad - 1), "0")}
              </span>
            </span>
          </div>
        </Card>

        <SeparatorCard
          label="Séparateur 1"
          hint="contenant → préfixe"
          value={cableSep1}
          onChange={handleSep1}
        />
        <SeparatorCard
          label="Séparateur 2"
          hint="séquence → suffixe"
          value={cableSep2}
          onChange={handleSep2}
        />
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border/60 bg-card rounded-xl border px-5 py-5 shadow-sm">
      {children}
    </div>
  );
}

function ToggleWithLabel({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2"
    >
      <span className="text-muted-foreground text-[10px] tracking-wider uppercase">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-[var(--accent)]" : "bg-[var(--muted-foreground)]/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// ── Explications selon mode ──────────────────────────────────────────────────

function ExplanationStandard() {
  return (
    <div className="space-y-3">
      <h4 className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
        Comment ça marche
      </h4>
      <p className="text-muted-foreground text-xs leading-relaxed">
        La convention <strong className="text-foreground">arkyo</strong> assemble chaque label
        câble à partir de 5 segments distincts. Configurez chaque pièce dans les réglages, et le
        nom du câble est généré automatiquement à chaque création.
      </p>
      {/* Schéma visuel */}
      <div className="border-border/60 bg-muted/20 flex items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-3">
        <SchemaBlock color={COLOR_CONTAINER} label="CONT" />
        <SchemaSep />
        <SchemaBlock color={COLOR_PREFIX} label="PFX" />
        <SchemaBlock color={COLOR_DIR} label="D" small />
        <SchemaBlock color={COLOR_SEQ} label="SEQ" />
        <SchemaSep />
        <SchemaBlock color={COLOR_SUFFIX} label="SFX" />
      </div>
      <ul className="text-muted-foreground space-y-1 text-[10px] leading-relaxed">
        <li>
          <strong className="text-foreground">CONT</strong> : identifiant du contenant (optionnel)
        </li>
        <li>
          <strong className="text-foreground">PFX</strong> : préfixe du signal (V, A, M, …)
        </li>
        <li>
          <strong className="text-foreground">D + SEQ</strong> : direction (1/2/3) + numéro
          séquentiel padded
        </li>
        <li>
          <strong className="text-foreground">SFX</strong> : suffixe optionnel (HD, L, R, …)
        </li>
      </ul>
    </div>
  );
}

function ExplanationCustom() {
  return (
    <div className="space-y-3">
      <h4 className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
        Mode personnalisé
      </h4>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Composez votre propre format en glissant les pilules dans l'ordre voulu. Vous pouvez
        ajouter du texte libre entre les segments via le bouton{" "}
        <strong className="text-foreground">+ Texte</strong>, et retirer ce dont vous n'avez pas
        besoin.
      </p>
      <div className="border-border/60 bg-muted/20 rounded-lg border border-dashed px-3 py-3">
        <p className="text-muted-foreground mb-2 text-[10px] tracking-wider uppercase">Exemple</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <MiniChip color={COLOR_PREFIX} label="Préfixe" />
          <span className="text-foreground/40 font-mono text-xs">·</span>
          <MiniChip color={COLOR_CONTAINER} label="Contenant" />
          <span className="text-foreground/40 font-mono text-xs">-</span>
          <MiniChip color={COLOR_SEQ} label="Séquence" />
        </div>
        <p
          className="text-muted-foreground mt-2 text-[10px]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Donne : <strong className="text-foreground">V·RGA-00001</strong>
        </p>
      </div>
      <ul className="text-muted-foreground space-y-1 text-[10px] leading-relaxed">
        <li>↔ Glisser-déposer pour réordonner</li>
        <li>+ Texte pour insérer du texte libre</li>
        <li>× pour retirer une pilule</li>
        <li>+ &lt;nom&gt; pour réinsérer une pilule retirée</li>
      </ul>
    </div>
  );
}

function SchemaBlock({
  color,
  label,
  small,
}: {
  color: string;
  label: string;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border-2 px-2 py-1 font-mono font-bold tracking-wider uppercase",
        small ? "min-w-[20px] text-[10px]" : "min-w-[36px] text-[10px]",
      )}
      style={{
        borderColor: `${color}40`,
        background: `${color}10`,
        color,
      }}
    >
      {label}
    </span>
  );
}

function SchemaSep() {
  return <span className="text-muted-foreground font-mono text-sm">-</span>;
}

function MiniChip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        borderColor: `${color}40`,
        background: `${color}10`,
        color,
      }}
    >
      {label}
    </span>
  );
}

// ── Toggle contenant : grand switch centré dans card ───────────────────────

function ContainerToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
        Contenant
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="border-border/60 bg-card hover:bg-muted/30 flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-semibold">
            {checked ? "Inclus dans le label" : "Non inclus"}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[10px] leading-tight">
            Préfixe l'identifiant du contenant en tête du nom de câble.
          </p>
        </div>
        <div
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            checked ? "bg-[var(--accent)]" : "bg-[var(--muted-foreground)]/25",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
              checked && "translate-x-5",
            )}
          />
        </div>
      </button>
    </div>
  );
}

// ── Separator card : 6 PillButton glyphes ──────────────────────────────────

function SeparatorCard({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="border-border/60 bg-card rounded-xl border px-5 py-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {label}
        </p>
        <p className="text-muted-foreground/60 text-[10px]">{hint}</p>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {SEP_OPTIONS.map((opt) => {
          const active = opt.val === value;
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange(opt.val)}
              title={opt.label}
              className={cn(
                "flex h-12 items-center justify-center rounded-lg border-2 transition-all",
                active
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]",
              )}
            >
              <span
                className="text-sm font-bold tabular-nums"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {opt.glyph}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── ColorizedCableLabel : preview colorisé ─────────────────────────────────

function ColorizedCableLabel({
  rackCode,
  prefix,
  suffix,
  dir,
  seq,
  pad,
  sep1,
  sep2,
  includeRack,
  template,
  templateEnabled,
}: {
  rackCode: string;
  prefix: string;
  suffix: string;
  dir: CableDirDigit;
  seq: number;
  pad: number;
  sep1: string;
  sep2: string;
  includeRack: boolean;
  template: string;
  templateEnabled: boolean;
}) {
  const safePad = Math.max(3, Math.min(10, pad));
  const numBlock = `${dir}${String(seq).padStart(Math.max(1, safePad - 1), "0")}`;

  if (templateEnabled && template.trim()) {
    const label = computeCableLabel({
      zoneCode: null,
      rackCode,
      signalPrefix: prefix,
      signalSuffix: suffix,
      dirDigit: dir,
      seq,
      config: { pad, sep1, sep2, includeRack, template, templateEnabled },
    });
    const rackVal = includeRack ? rackCode : "";
    const paddedSeqOnly = String(seq).padStart(safePad, "0");
    const tokens: { text: string; color: string }[] = [];
    let remaining = label;
    const tryMatch = (val: string, color: string): boolean => {
      if (!val || !remaining.startsWith(val)) return false;
      tokens.push({ text: val, color });
      remaining = remaining.slice(val.length);
      return true;
    };
    while (remaining.length > 0) {
      if (tryMatch(rackVal, COLOR_CONTAINER)) continue;
      if (tryMatch(prefix, COLOR_PREFIX)) continue;
      if (tryMatch(paddedSeqOnly, COLOR_SEQ)) continue;
      if (tryMatch(dir, COLOR_DIR)) continue;
      if (suffix && tryMatch(suffix, COLOR_SUFFIX)) continue;
      if (sep1 && tryMatch(sep1, COLOR_SEP)) continue;
      if (sep2 && tryMatch(sep2, COLOR_SEP)) continue;
      tokens.push({ text: remaining[0], color: COLOR_SEP });
      remaining = remaining.slice(1);
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
  if (includeRack && rackCode) {
    parts.push({ text: rackCode, color: COLOR_CONTAINER });
    if (sep1) parts.push({ text: sep1, color: COLOR_SEP });
  }
  if (prefix) parts.push({ text: prefix, color: COLOR_PREFIX });
  parts.push({ text: numBlock, color: COLOR_SEQ });
  if (suffix) {
    if (sep2) parts.push({ text: sep2, color: COLOR_SEP });
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

// ── TemplateBuilder : chips drag & drop colorisés ──────────────────────────

function TemplateBuilder({
  chips,
  dragIdx,
  onDragStart,
  onDragOver,
  onDragEnd,
  onAddText,
  onRemove,
  onUpdateText,
  onAddVar,
}: {
  chips: ChipItem[];
  dragIdx: number | null;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDragEnd: () => void;
  onAddText: () => void;
  onRemove: (idx: number) => void;
  onUpdateText: (idx: number, text: string) => void;
  onAddVar: (v: string) => void;
}) {
  const used = new Set(chips.filter((c) => c.type === "var").map((c) => c.value));
  const available = ALL_VARS.filter((v) => !used.has(v));

  return (
    <div className="w-full space-y-3">
      {/* Zone de drop : chips colorisés selon le type */}
      <div
        className="border-border bg-muted/20 flex min-h-[52px] w-full flex-wrap items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-3"
        onDragOver={(e) => e.preventDefault()}
      >
        {chips.map((chip, i) => {
          const color =
            chip.type === "var" ? CHIP_COLORS[chip.value] ?? "var(--muted-foreground)" : undefined;
          return (
            <div
              key={chip.id}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDragEnd={onDragEnd}
              className={cn(
                "group/chip flex cursor-grab items-center gap-1 rounded-md border-2 px-2 py-1 text-xs font-semibold shadow-sm transition-all active:cursor-grabbing",
                dragIdx === i && "scale-95 opacity-40",
              )}
              style={
                chip.type === "var" && color
                  ? {
                      borderColor: `${color}50`,
                      background: `${color}12`,
                      color,
                    }
                  : {
                      borderColor: "var(--border)",
                      background: "var(--card)",
                      color: "var(--foreground)",
                    }
              }
            >
              <GripVertical className="h-3 w-3 opacity-40" />
              {chip.type === "var" ? (
                <span>{CHIP_LABELS[chip.value] ?? chip.value}</span>
              ) : (
                <input
                  type="text"
                  value={chip.value}
                  onChange={(e) => onUpdateText(i, e.target.value)}
                  className="w-20 border-b border-dashed border-current bg-transparent text-xs outline-none"
                  placeholder="texte…"
                />
              )}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="ml-0.5 opacity-50 transition-opacity hover:opacity-100"
                aria-label="Retirer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAddText}
          className="text-muted-foreground border-border hover:border-[var(--accent)] hover:text-[var(--accent)] flex items-center gap-1 rounded-md border-2 border-dashed px-2 py-1 text-xs font-medium transition-colors"
        >
          <Plus className="h-3 w-3" /> Texte
        </button>
      </div>

      {/* Palette des chips disponibles à réinsérer */}
      {available.length > 0 && (
        <div className="flex w-full items-start gap-2">
          <span className="text-muted-foreground mt-1 shrink-0 text-[10px] tracking-wider uppercase">
            Ajouter
          </span>
          <div className="flex flex-wrap gap-1">
            {available.map((v) => {
              const color = CHIP_COLORS[v] ?? "var(--muted-foreground)";
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => onAddVar(v)}
                  className="flex items-center gap-1 rounded-md border-2 border-dashed px-2 py-0.5 text-[10px] font-medium transition-all hover:scale-105"
                  style={{
                    borderColor: `${color}50`,
                    color,
                  }}
                >
                  <Plus className="h-2.5 w-2.5" />
                  {CHIP_LABELS[v] ?? v}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
