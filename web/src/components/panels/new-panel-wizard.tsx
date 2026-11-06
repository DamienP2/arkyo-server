"use client";

/**
 * NewPanelWizard — wizard d'ajout d'un panel template depuis /templates.
 *
 * Calqué sur `NewRackWizard` (qui est lui-même calqué sur le wizard projet) :
 *  - Intro design avec mockups animés
 *  - WizardBackdrop intense sur intro / discreet ailleurs
 *  - WizardStepHeader + ProgressBar partagés
 *  - Cards avec checkmark accent
 *  - Récap groupé en sections, lignes cliquables
 *
 * Steps :
 *   0. INTRO        — accueil design + mockups patch / audio / vidéo / fibre
 *   1. NAME         — input texte
 *   2. HEIGHT       — pills U (1U / 2U / 3U / 4U)
 *   3. SLOTS        — cards densité de slots (8 / 12 / 16 / 24)
 *   4. CABLING      — slider profondeur câblage arrière
 *   5. NOTES        — textarea (facultatif)
 *   6. SUMMARY      — récap groupé, lignes cliquables → édition
 *
 * API : POST /api/panels { name, heightU, slotsPerU, rearCableDepthMm, notes? }
 */

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  LayoutGrid,
  LayoutPanelTop,
  Loader2,
  Sparkles,
  Square,
} from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RangeInput } from "@/components/wizard/range-input";
import {
  ProgressBar,
  WizardBackdrop,
  WizardKeyframes,
  WizardStepHeader,
} from "@/components/wizard/wizard-backdrop";
import { getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

export type NewPanelData = {
  name: string;
  heightU: number;
  slotsPerU: number;
  rearCableDepthMm: number;
  notes?: string;
};

// ── Steps ───────────────────────────────────────────────────────────────────

type StepId =
  | "intro"
  | "name"
  | "height"
  | "slots"
  | "cabling"
  | "notes"
  | "summary";

type StepDef = { id: StepId; progressIndex: number };

const STEPS: StepDef[] = [
  { id: "intro", progressIndex: -1 },
  { id: "name", progressIndex: 1 },
  { id: "height", progressIndex: 2 },
  { id: "slots", progressIndex: 3 },
  { id: "cabling", progressIndex: 4 },
  { id: "notes", progressIndex: 5 },
  { id: "summary", progressIndex: 6 },
];

const PROGRESS_TOTAL = 6;

// ── Component ───────────────────────────────────────────────────────────────

export function NewPanelWizard({
  open,
  onOpenChange,
  onSubmit,
  uHeights = [1, 2, 3, 4],
  slotPresets = [8, 12, 16, 24],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: NewPanelData) => Promise<void>;
  uHeights?: number[];
  slotPresets?: number[];
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [heightU, setHeightU] = useState(1);
  const [slotsPerU, setSlotsPerU] = useState(8);
  const [rearCableDepthMm, setRearCableDepthMm] = useState(80);
  const [notes, setNotes] = useState("");

  const currentStep = STEPS[Math.min(stepIndex, STEPS.length - 1)] ?? STEPS[0];
  const isIntro = currentStep.id === "intro";
  const isSummary = currentStep.id === "summary";

  const reset = () => {
    setStepIndex(0);
    setName("");
    setHeightU(1);
    setSlotsPerU(8);
    setRearCableDepthMm(80);
    setNotes("");
    setError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setTimeout(reset, 150);
    onOpenChange(next);
  };

  const handlePickHeight = (u: number) => {
    setHeightU(u);
    setTimeout(() => goNext(), 200);
  };

  const handlePickSlots = (n: number) => {
    setSlotsPerU(n);
    setTimeout(() => goNext(), 200);
  };

  const goNext = () => {
    if (isSummary) {
      void handleSubmit();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  const goPrev = () => {
    if (isIntro) return;
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const jumpToStep = (id: StepId) => {
    const idx = STEPS.findIndex((s) => s.id === id);
    if (idx >= 0) setStepIndex(idx);
  };

  const handleSubmit = async () => {
    if (name.trim().length === 0) {
      setError("Nom requis");
      jumpToStep("name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        heightU,
        slotsPerU,
        rearCableDepthMm,
        notes: notes.trim() || undefined,
      });
      handleOpenChange(false);
    } catch (e) {
      setError(getApiErrorMessage(e));
      setSubmitting(false);
    }
  };

  const continueDisabled =
    submitting || (currentStep.id === "name" && name.trim().length === 0);

  const renderStepBody = () => {
    switch (currentStep.id) {
      case "intro":
        return <IntroStep onStart={() => setStepIndex(1)} />;
      case "name":
        return <NameStep value={name} onChange={setName} />;
      case "height":
        return (
          <HeightStep
            current={heightU}
            onSelect={handlePickHeight}
            uHeights={uHeights}
          />
        );
      case "slots":
        return (
          <SlotsStep
            current={slotsPerU}
            onSelect={handlePickSlots}
            slotPresets={slotPresets}
          />
        );
      case "cabling":
        return (
          <CablingStep
            rearCableDepthMm={rearCableDepthMm}
            setRearCableDepthMm={setRearCableDepthMm}
          />
        );
      case "notes":
        return <NotesStep value={notes} onChange={setNotes} />;
      case "summary":
        return (
          <SummaryStep
            name={name}
            heightU={heightU}
            slotsPerU={slotsPerU}
            rearCableDepthMm={rearCableDepthMm}
            notes={notes}
            onEdit={jumpToStep}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[580px] max-w-3xl flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">Nouveau panel</DialogTitle>
        <DialogDescription className="sr-only">
          Wizard de création d&apos;un modèle de panel en plusieurs étapes.
        </DialogDescription>

        <WizardBackdrop variant={isIntro ? "intense" : "discreet"} />
        <WizardKeyframes />

        {/* Progress bar (masquée sur intro) */}
        {!isIntro && currentStep.progressIndex > 0 && (
          <div className="relative z-10 px-8 pt-6">
            <ProgressBar
              progressIndex={currentStep.progressIndex}
              total={PROGRESS_TOTAL}
            />
          </div>
        )}

        {/* Body */}
        <div className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-8 py-8">
          <div className="w-full">{renderStepBody()}</div>
        </div>

        {error && (
          // arkyo-server: habillage Strata
          <div className="relative z-10 mx-8 mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-[var(--danger-text)]">
            {error}
          </div>
        )}

        {/* Footer (masqué sur intro) */}
        {!isIntro && (
          <div className="relative z-10 flex items-center justify-between gap-3 border-t border-[var(--border)]/60 bg-[var(--card)]/70 px-8 py-4 backdrop-blur-sm">
            <div className="flex-1">
              <Button
                type="button"
                variant="ghost"
                onClick={goPrev}
                disabled={submitting}
              >
                <ArrowLeft className="h-4 w-4" />
                Précédent
              </Button>
            </div>
            <div className="flex flex-1 justify-end">
              <Button
                type="button"
                variant="accent"
                onClick={goNext}
                disabled={continueDisabled}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSummary ? "Créer le panel" : "Continuer"}
                {!isSummary && !submitting && <ArrowRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Intro ─────────────────────────────────────────────────────────────────

function IntroStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative -mx-8 -my-8 overflow-hidden rounded-2xl">
      <style>{`
        @keyframes mockup-float-subtle {
          0%, 100% { transform: translateY(0) rotate(var(--rot, 0deg)); }
          50% { transform: translateY(-6px) rotate(var(--rot, 0deg)); }
        }
      `}</style>
      <div
        className="pointer-events-none absolute inset-0 opacity-70 dark:opacity-60"
        aria-hidden
      >
        <IntroMockup
          className="absolute top-4 -left-4"
          rotate="-12deg"
          delay="0s"
          duration="6s"
          accent="blue"
          label="Patch XLR"
        >
          <PatchXlrMockup />
        </IntroMockup>
        <IntroMockup
          className="absolute top-6 -right-4"
          rotate="9deg"
          delay="1s"
          duration="7s"
          accent="pink"
          label="Patch BNC"
        >
          <PatchBncMockup />
        </IntroMockup>
        <IntroMockup
          className="absolute -left-2 bottom-6"
          rotate="-6deg"
          delay="2s"
          duration="8s"
          accent="emerald"
          label="Patch RJ45"
        >
          <PatchRj45Mockup />
        </IntroMockup>
        <IntroMockup
          className="absolute -right-2 bottom-4"
          rotate="12deg"
          delay="1.5s"
          duration="7.5s"
          accent="cyan"
          label="Fibre"
        >
          <PatchFibreMockup />
        </IntroMockup>
      </div>

      <div className="relative z-10 mx-auto flex h-full max-w-lg flex-col items-center justify-center px-8 py-16 text-center">
        {/* arkyo-server: habillage Strata (texte d'accent sur fond teinté : --accent-strong) */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--surface)]/40 bg-[var(--surface)]/60 px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent-strong)] uppercase shadow-sm backdrop-blur-md dark:border-[var(--foreground)]/10 dark:bg-[var(--foreground)]/10">
          <Sparkles
            className="h-3 w-3"
            style={{ animation: "sparkle-twinkle 2s ease-in-out infinite" }}
          />
          Nouveau panel
        </span>

        <h3 className="mt-10 text-3xl leading-tight font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
          Créons un{" "}
          <span
            className="relative inline-block"
            style={{
              background:
                "linear-gradient(135deg, #8b5cf6 0%, #3b82f6 50%, #10b981 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            modèle de panel
          </span>
        </h3>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
          Définissez la hauteur, la densité de slots et la profondeur de
          câblage — réutilisable dans tous vos projets.
        </p>

        <Button
          type="button"
          variant="accent"
          onClick={onStart}
          className="mt-14 shadow-lg shadow-[var(--accent)]/30"
        >
          Commencer
          <ArrowRight className="h-4 w-4" />
        </Button>

        <p className="mt-5 text-[11px] text-[var(--muted-foreground)]/70">
          Moins d&apos;une minute
        </p>
      </div>
    </div>
  );
}

// ─── Mockups intro ─────────────────────────────────────────────────────────

type IntroAccent = "blue" | "pink" | "emerald" | "cyan";

const ACCENT_CLASSES: Record<
  IntroAccent,
  { border: string; bg: string; text: string; dot: string }
> = {
  blue: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    text: "text-blue-600/80 dark:text-blue-400/70",
    dot: "bg-blue-500/70",
  },
  pink: {
    border: "border-pink-500/30",
    bg: "bg-pink-500/5",
    text: "text-pink-600/80 dark:text-pink-400/70",
    dot: "bg-pink-500/70",
  },
  emerald: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    text: "text-emerald-600/80 dark:text-emerald-400/70",
    dot: "bg-emerald-500/70",
  },
  cyan: {
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/5",
    text: "text-cyan-600/80 dark:text-cyan-400/70",
    dot: "bg-cyan-500/70",
  },
};

function IntroMockup({
  className,
  rotate,
  delay,
  duration,
  accent,
  label,
  children,
}: {
  className: string;
  rotate: string;
  delay: string;
  duration: string;
  accent: IntroAccent;
  label: string;
  children: React.ReactNode;
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <div
      className={cn(
        "hidden h-[140px] w-[120px] flex-col gap-1.5 rounded-xl border p-2 shadow-sm backdrop-blur-md sm:flex",
        a.border,
        a.bg,
        className,
      )}
      style={{
        ["--rot" as string]: rotate,
        transform: `rotate(${rotate})`,
        animation: `mockup-float-subtle ${duration} ease-in-out infinite`,
        animationDelay: delay,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-[7px] font-bold tracking-widest uppercase",
            a.text,
          )}
        >
          {label}
        </span>
        <span className={cn("h-1 w-1 rounded-full", a.dot)} />
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

/** Mini schéma panel XLR (1U avec 8 connecteurs XLR ronds). */
function PatchXlrMockup() {
  return (
    <svg viewBox="0 0 100 80" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="4" y="20" width="92" height="40" rx="2" fill="rgb(59 130 246 / 0.08)" stroke="rgb(59 130 246 / 0.45)" strokeWidth="1" />
      {Array.from({ length: 8 }).map((_, i) => {
        const cx = 12 + i * 10.5;
        return (
          <g key={i}>
            <circle cx={cx} cy={40} r="3.6" fill="rgb(59 130 246 / 0.15)" stroke="rgb(59 130 246 / 0.6)" strokeWidth="0.8" />
            <circle cx={cx} cy={40} r="1.2" fill="rgb(59 130 246 / 0.7)" />
          </g>
        );
      })}
    </svg>
  );
}

/** Mini schéma panel BNC (1U avec 12 BNC compacts). */
function PatchBncMockup() {
  return (
    <svg viewBox="0 0 100 80" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="4" y="22" width="92" height="36" rx="2" fill="rgb(236 72 153 / 0.08)" stroke="rgb(236 72 153 / 0.45)" strokeWidth="1" />
      {Array.from({ length: 12 }).map((_, i) => {
        const cx = 10 + i * 7;
        return (
          <g key={i}>
            <circle cx={cx} cy={40} r="2.4" fill="rgb(236 72 153 / 0.15)" stroke="rgb(236 72 153 / 0.6)" strokeWidth="0.7" />
            <circle cx={cx} cy={40} r="0.8" fill="rgb(236 72 153 / 0.7)" />
          </g>
        );
      })}
    </svg>
  );
}

/** Mini schéma panel RJ45 (2 rangées de 6 ports rectangulaires). */
function PatchRj45Mockup() {
  return (
    <svg viewBox="0 0 100 80" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="4" y="14" width="92" height="52" rx="2" fill="rgb(16 185 129 / 0.08)" stroke="rgb(16 185 129 / 0.45)" strokeWidth="1" />
      {Array.from({ length: 2 }).map((_, row) =>
        Array.from({ length: 6 }).map((_, col) => {
          const x = 10 + col * 14;
          const y = 22 + row * 22;
          return (
            <g key={`${row}-${col}`}>
              <rect x={x} y={y} width="10" height="14" rx="0.8" fill="rgb(16 185 129 / 0.18)" stroke="rgb(16 185 129 / 0.55)" strokeWidth="0.7" />
              <line x1={x + 2} y1={y + 2} x2={x + 8} y2={y + 2} stroke="rgb(16 185 129 / 0.5)" strokeWidth="0.5" />
            </g>
          );
        }),
      )}
    </svg>
  );
}

/** Mini schéma panel fibre (4 SC duplex). */
function PatchFibreMockup() {
  return (
    <svg viewBox="0 0 100 80" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="4" y="22" width="92" height="36" rx="2" fill="rgb(6 182 212 / 0.08)" stroke="rgb(6 182 212 / 0.45)" strokeWidth="1" />
      {Array.from({ length: 4 }).map((_, i) => {
        const x = 8 + i * 22;
        return (
          <g key={i}>
            <rect x={x} y={32} width="18" height="16" rx="1" fill="rgb(6 182 212 / 0.15)" stroke="rgb(6 182 212 / 0.6)" strokeWidth="0.8" />
            <rect x={x + 2} y={35} width="6" height="10" rx="0.6" fill="rgb(6 182 212 / 0.35)" />
            <rect x={x + 10} y={35} width="6" height="10" rx="0.6" fill="rgb(6 182 212 / 0.35)" />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Name ───────────────────────────────────────────────────────────────────

function NameStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Comment s'appelle ce panel ?"
        subtitle="Un nom clair pour le retrouver facilement (ex : Panneau XLR A)."
      />
      <div className="mx-auto max-w-lg">
        <FormField label="Nom du panel" required>
          <Input
            autoFocus
            className="h-11 text-sm"
            placeholder="Ex. Panneau XLR — Audio"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </FormField>
      </div>
    </div>
  );
}

// ─── Height ─────────────────────────────────────────────────────────────────

function HeightStep({
  current,
  onSelect,
  uHeights,
}: {
  current: number;
  onSelect: (u: number) => void;
  uHeights: number[];
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quelle hauteur ?"
        subtitle={`Le panel occupera ${current}U dans le rack.`}
      />
      <div className="mx-auto grid max-w-md grid-cols-4 gap-3">
        {uHeights.map((u) => {
          const selected = current === u;
          return (
            <button
              key={u}
              type="button"
              onClick={() => onSelect(u)}
              className={cn(
                "flex h-24 flex-col items-center justify-center gap-2 rounded-2xl border bg-[var(--card)] p-3 text-center shadow-sm transition-all duration-200",
                selected
                  ? "-translate-y-0.5 border-[var(--accent)] bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                  : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
              )}
            >
              {/* Visuel : empilement de U */}
              <span className="flex flex-col items-center gap-[3px]">
                {Array.from({ length: u }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 w-7 rounded-full transition-colors",
                      selected
                        ? "bg-[var(--accent)]"
                        : "bg-[var(--muted-foreground)]/35",
                    )}
                  />
                ))}
              </span>
              <span
                className={cn(
                  "text-sm font-bold tabular-nums",
                  selected ? "text-[var(--accent)]" : "text-[var(--foreground)]",
                )}
              >
                {u}U
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Slots / U ───────────────────────────────────────────────────────────────

function SlotsStep({
  current,
  onSelect,
  slotPresets,
}: {
  current: number;
  onSelect: (n: number) => void;
  slotPresets: number[];
}) {
  return (
    <div>
      <WizardStepHeader
        title="Combien de slots par U ?"
        subtitle="Densité de connecteurs sur chaque rangée U."
      />
      <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
        {slotPresets.map((n) => {
          const selected = current === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onSelect(n)}
              className={cn(
                "flex h-32 flex-col items-center justify-center gap-2.5 rounded-2xl border bg-[var(--card)] p-3 text-center shadow-sm transition-all duration-200",
                selected
                  ? "-translate-y-0.5 border-[var(--accent)] bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                  : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
              )}
            >
              {/* Cadre rangée de panel avec les slots */}
              <span
                className={cn(
                  "flex w-full items-center justify-center rounded-md border px-2 py-2 transition-colors",
                  selected
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/5"
                    : "border-[var(--border)]/60",
                )}
              >
                <SlotsPreview count={n} selected={selected} />
              </span>
              <span>
                <span
                  className={cn(
                    "text-xl leading-none font-black tabular-nums",
                    selected ? "text-[var(--accent)]" : "text-[var(--foreground)]",
                  )}
                >
                  {n}
                </span>
                <span className="mt-0.5 block text-[10px] tracking-wider text-[var(--muted-foreground)] uppercase">
                  slots / U
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotsPreview({
  count,
  selected,
}: {
  count: number;
  selected: boolean;
}) {
  const fillColor = selected ? "var(--accent)" : "var(--muted-foreground)";
  return (
    <svg
      viewBox={`0 0 ${count * 6} 10`}
      className="h-3.5 w-full max-w-[80px]"
      preserveAspectRatio="xMidYMid meet"
    >
      {Array.from({ length: count }).map((_, i) => (
        <circle
          key={i}
          cx={3 + i * 6}
          cy={5}
          r="1.8"
          fill={fillColor}
          fillOpacity={selected ? 0.85 : 0.55}
        />
      ))}
    </svg>
  );
}

// ─── Cabling ─────────────────────────────────────────────────────────────────

function CablingStep({
  rearCableDepthMm,
  setRearCableDepthMm,
}: {
  rearCableDepthMm: number;
  setRearCableDepthMm: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Profondeur de câblage arrière"
        subtitle="Espace réservé derrière le panel pour le câblage."
      />
      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-5 rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-4 shadow-sm sm:grid-cols-2">
        {/* Colonne gauche : valeur + slider */}
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
              Câblage arrière
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--foreground)]">
              {rearCableDepthMm}
              <span className="ml-1 text-base font-medium text-[var(--muted-foreground)]">
                mm
              </span>
            </p>
          </div>
          <div>
            <RangeInput
              min={30}
              max={300}
              step={5}
              value={rearCableDepthMm}
              onChange={setRearCableDepthMm}
            />
            <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]/70">
              <span>30 mm</span>
              <span>300 mm</span>
            </div>
          </div>
        </div>

        {/* Colonne droite : schéma visuel */}
        <div className="flex items-center justify-center">
          <CablingDepthIllustration depthMm={rearCableDepthMm} />
        </div>
      </div>
    </div>
  );
}

/**
 * CablingDepthIllustration — vue de côté du panel : connecteurs à gauche +
 * zone de câblage arrière dont la largeur évolue avec la profondeur.
 */
function CablingDepthIllustration({ depthMm }: { depthMm: number }) {
  const minMm = 30;
  const maxMm = 300;
  const minPx = 30;
  const maxPx = 130;
  const ratio =
    (Math.max(minMm, Math.min(maxMm, depthMm)) - minMm) / (maxMm - minMm);
  const cablingPx = minPx + ratio * (maxPx - minPx);

  const W = 220;
  const H = 110;
  const panelW = 14;
  const padY = 22;
  const innerH = H - 2 * padY;
  const panelX = 18;
  const cablingX = panelX + panelW;

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-2">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="text-[var(--muted-foreground)]"
        aria-hidden
      >
        {/* Panel (face avant) */}
        <rect
          x={panelX}
          y={padY}
          width={panelW}
          height={innerH}
          rx={2}
          fill="currentColor"
          fillOpacity={0.15}
          stroke="currentColor"
          strokeWidth={1.5}
          opacity={0.85}
        />
        {/* Connecteurs sur la face */}
        {Array.from({ length: 5 }).map((_, i) => (
          <circle
            key={i}
            cx={panelX + panelW / 2}
            cy={padY + 8 + i * 14}
            r={2}
            fill="currentColor"
            fillOpacity={0.55}
          />
        ))}
        {/* Zone de câblage arrière (dashed) */}
        <rect
          x={cablingX}
          y={padY}
          width={cablingPx}
          height={innerH}
          rx={2}
          fill="var(--accent)"
          fillOpacity={0.08}
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        {/* Câbles stylisés */}
        {Array.from({ length: 5 }).map((_, i) => {
          const y = padY + 8 + i * 14;
          return (
            <path
              key={i}
              d={`M ${cablingX} ${y} Q ${cablingX + cablingPx * 0.5} ${y + (i % 2 === 0 ? -4 : 4)} ${cablingX + cablingPx} ${y}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1}
              opacity={0.65}
            />
          );
        })}
        {/* Labels */}
        <text
          x={panelX - 2}
          y={padY - 6}
          fontSize={8}
          fill="currentColor"
          opacity={0.7}
          fontFamily="ui-monospace, monospace"
        >
          PANEL
        </text>
        <text
          x={cablingX + 4}
          y={padY - 6}
          fontSize={8}
          fill="var(--accent)"
          opacity={0.9}
          fontFamily="ui-monospace, monospace"
        >
          CÂBLAGE
        </text>
        {/* Cote */}
        <line
          x1={cablingX}
          y1={padY + innerH + 8}
          x2={cablingX + cablingPx}
          y2={padY + innerH + 8}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <line
          x1={cablingX}
          y1={padY + innerH + 4}
          x2={cablingX}
          y2={padY + innerH + 12}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <line
          x1={cablingX + cablingPx}
          y1={padY + innerH + 4}
          x2={cablingX + cablingPx}
          y2={padY + innerH + 12}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <text
          x={cablingX + cablingPx / 2}
          y={padY + innerH + 22}
          fontSize={9}
          fill="var(--accent)"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontWeight="bold"
        >
          {depthMm} mm
        </text>
      </svg>
      <p className="text-center text-[10px] leading-tight text-[var(--muted-foreground)]">
        <span className="font-mono font-bold text-[var(--accent)]">━ ━</span> zone
        de câblage arrière
      </p>
    </div>
  );
}

// ─── Notes ──────────────────────────────────────────────────────────────────

function NotesStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Notes techniques"
        subtitle="Informations complémentaires (facultatif)."
      />
      <div className="mx-auto max-w-lg">
        <FormField label="Notes">
          <textarea
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            placeholder="Notes techniques, contexte d'usage, etc."
            className="block w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </FormField>
      </div>
    </div>
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────

function SummaryStep({
  name,
  heightU,
  slotsPerU,
  rearCableDepthMm,
  notes,
  onEdit,
}: {
  name: string;
  heightU: number;
  slotsPerU: number;
  rearCableDepthMm: number;
  notes: string;
  onEdit: (id: StepId) => void;
}) {
  const notesText = notes.trim();
  return (
    <div className="mx-auto max-w-lg">
      <WizardStepHeader
        title="Vérifiez et créez votre panel"
        subtitle="Cliquez sur un élément pour le modifier."
      />
      <div className="space-y-3 rounded-2xl border border-[var(--border)]/60 bg-gradient-to-br from-[var(--card)] to-[var(--secondary)]/30 p-4 shadow-sm">
        {/* Ligne titre : badge + nom + chip hauteur */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {/* arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong) */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[9px] font-bold tracking-wider text-[var(--accent-strong)] uppercase">
              <LayoutPanelTop className="h-2.5 w-2.5" />
              Panel de patch
            </span>
            <button
              type="button"
              onClick={() => onEdit("name")}
              className="group mt-1.5 block w-full text-left"
            >
              <p className="truncate text-lg font-semibold tracking-tight text-[var(--foreground)] transition-colors group-hover:text-[var(--accent)]">
                {name || "Panel sans nom"}
              </p>
            </button>
          </div>
          <button
            type="button"
            onClick={() => onEdit("height")}
            className="group inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-2.5 py-1.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
          >
            <Square className="h-3.5 w-3.5" />
            {heightU}U
          </button>
        </div>

        <div className="h-px bg-[var(--border)]/50" />

        {/* Grille compacte */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <SummaryItem
            icon={LayoutGrid}
            label="Slots / U"
            value={String(slotsPerU)}
            onClick={() => onEdit("slots")}
          />
          <SummaryItem
            icon={Cable}
            label="Câblage arrière"
            value={`${rearCableDepthMm} mm`}
            onClick={() => onEdit("cabling")}
          />
        </div>

        {notesText && (
          <>
            <div className="h-px bg-[var(--border)]/50" />
            <button
              type="button"
              onClick={() => onEdit("notes")}
              className="group -mx-1 block w-full rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[var(--secondary)]/40"
            >
              <p className="text-[9px] font-bold tracking-wider text-[var(--muted-foreground)]/70 uppercase">
                Notes
              </p>
              <p className="line-clamp-2 text-xs leading-snug text-[var(--muted-foreground)]">
                {notesText}
              </p>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryItem({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof Square;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group -mx-1 flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-[var(--secondary)]/40"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--secondary)] text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--accent)]">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[9px] font-bold leading-none tracking-wider text-[var(--muted-foreground)]/70 uppercase">
          {label}
        </p>
        <p className="mt-0.5 truncate text-[13px] font-medium leading-tight text-[var(--foreground)]">
          {value}
        </p>
      </div>
    </button>
  );
}

// ─── Form sub-components ─────────────────────────────────────────────────────

// RangeInput est désormais importé depuis `@/components/wizard/range-input`.
