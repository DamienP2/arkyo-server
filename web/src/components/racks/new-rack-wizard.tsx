"use client";

/**
 * NewRackWizard — wizard d'ajout d'un contenant template depuis /templates.
 *
 * Calqué sur `AddContainerWizard` (wizard projet), **sans** l'étape MODE
 * (template vs nouveau) ni l'étape TEMPLATE — on crée toujours « depuis zéro »
 * dans le contexte des templates partagés.
 *
 * Steps dynamiques :
 *   0. INTRO        — accueil design + mini-mockups baie/flight/pelicase
 *   1. TYPE         — STANDARD / FLIGHT_CASE_* / PELICAN / CAP (cards)
 *   2. NAME         — input
 *   3. RACKABLE     — toggle (pré-coché selon RACK_TYPE_RACKABLE)
 *   4. DIMENSIONS   — U + profondeur OU L/l/P selon rackable
 *   5. WHEELS       — toggle (conditionnel : visible si flight)
 *   6. WEIGHT       — slider poids à vide
 *   7. RAILS        — toggle + slider gap (conditionnel : visible si rackable)
 *   8. SUMMARY      — récap groupé, lignes cliquables → édition
 *
 * Les bodies d'étape (Type/Name/Rackable/Dimensions/Wheels/Weight/Rails) et
 * l'état sont partagés avec `NewProjectDialog` via `rack-wizard-steps.tsx`.
 *
 * API :
 *   - POST /api/racks { name, rackType, isRackable, depthMm, totalU?, widthMm?, heightMm?, hasWheels?, emptyWeightKg?, rearInteriorGapMm? }
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Disc,
  Loader2,
  Server,
  Sparkles,
  Weight,
} from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ProgressBar,
  WizardBackdrop,
  WizardKeyframes,
  WizardStepHeader,
} from "@/components/wizard/wizard-backdrop";
import { getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  buildContainerStepIds,
  buildRackPayload,
  RACK_TYPE_LABEL,
  RackDimensionsStep,
  RackNameStep,
  RackRackableStep,
  RackRailsStep,
  RackTypeStep,
  RackWeightStep,
  RackWheelsStep,
  U_PRESETS_FALLBACK,
  useRackConfig,
  type RackPayload,
  type RackType,
} from "@/components/racks/rack-wizard-steps";

// ── Types ────────────────────────────────────────────────────────────────────

/** Payload de soumission du wizard (compat callers existants). */
export type NewRackSubmitData = RackPayload;

// ── Steps ───────────────────────────────────────────────────────────────────

type StepId =
  | "intro"
  | "type"
  | "name"
  | "rackable"
  | "dimensions"
  | "wheels"
  | "weight"
  | "rails"
  | "summary";

type StepDef = { id: StepId; progressIndex: number };

function buildSteps(flight: boolean, isRackable: boolean): StepDef[] {
  const steps: StepDef[] = [{ id: "intro", progressIndex: -1 }];
  for (const id of buildContainerStepIds(flight, isRackable)) {
    steps.push({ id, progressIndex: 0 });
  }
  steps.push({ id: "summary", progressIndex: 0 });

  // Renumérote : intro reste à -1, le reste démarre à 1.
  let counter = 1;
  for (const s of steps) {
    if (s.id === "intro") continue;
    s.progressIndex = counter++;
  }
  return steps;
}

// ── Component ───────────────────────────────────────────────────────────────

export function NewRackWizard({
  open,
  onOpenChange,
  onSubmit,
  uPresets,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: NewRackSubmitData) => Promise<void>;
  /** Presets U (override admin). Défaut : 6/9/12/18/24/30/36/42/45/48. */
  uPresets?: number[];
  /** Compat — non utilisé (defaults gérés en interne). */
  defaultTotalU?: number;
  depthPresets?: number[];
  defaultDepthMm?: number;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { config, update, reset: resetConfig, pickType, flight } = useRackConfig();

  const steps = useMemo(
    () => buildSteps(flight, config.isRackable),
    [flight, config.isRackable],
  );
  const progressTotal = steps.length - 1; // intro masqué

  const currentStep = steps[Math.min(stepIndex, steps.length - 1)] ?? steps[0];
  const isIntro = currentStep.id === "intro";
  const isSummary = currentStep.id === "summary";

  const usableUPresets =
    uPresets && uPresets.length > 0 ? uPresets : U_PRESETS_FALLBACK;

  const reset = () => {
    setStepIndex(0);
    resetConfig();
    setError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setTimeout(reset, 150);
    onOpenChange(next);
  };

  const goNext = () => {
    if (isSummary) {
      void handleSubmit();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const goPrev = () => {
    if (isIntro) return;
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const jumpToStep = (id: StepId) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx >= 0) setStepIndex(idx);
  };

  const handlePickType = (t: RackType) => {
    pickType(t);
    setTimeout(() => goNext(), 200);
  };

  const handlePickRackable = (next: boolean) => {
    update("isRackable", next);
    setTimeout(() => goNext(), 200);
  };

  const handleSubmit = async () => {
    if (config.name.trim().length === 0) {
      setError("Nom requis");
      jumpToStep("name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(buildRackPayload(config));
      handleOpenChange(false);
    } catch (e) {
      setError(getApiErrorMessage(e));
      setSubmitting(false);
    }
  };

  const continueDisabled =
    submitting ||
    (currentStep.id === "name" && config.name.trim().length === 0);

  const renderStepBody = () => {
    switch (currentStep.id) {
      case "intro":
        return <IntroStep onStart={() => setStepIndex(1)} />;
      case "type":
        return <RackTypeStep current={config.rackType} onSelect={handlePickType} />;
      case "name":
        return (
          <RackNameStep
            rackType={config.rackType}
            value={config.name}
            onChange={(v) => update("name", v)}
          />
        );
      case "rackable":
        return (
          <RackRackableStep
            current={config.isRackable}
            onSelect={handlePickRackable}
          />
        );
      case "dimensions":
        return (
          <RackDimensionsStep
            isRackable={config.isRackable}
            totalU={config.totalU}
            setTotalU={(v) => update("totalU", v)}
            depthMm={config.depthMm}
            setDepthMm={(v) => update("depthMm", v)}
            widthMm={config.widthMm}
            setWidthMm={(v) => update("widthMm", v)}
            heightMm={config.heightMm}
            setHeightMm={(v) => update("heightMm", v)}
            uPresets={usableUPresets}
          />
        );
      case "wheels":
        return (
          <RackWheelsStep
            hasWheels={config.hasWheels}
            setHasWheels={(v) => update("hasWheels", v)}
          />
        );
      case "weight":
        return (
          <RackWeightStep
            emptyWeightKg={config.emptyWeightKg}
            setEmptyWeightKg={(v) => update("emptyWeightKg", v)}
          />
        );
      case "rails":
        return (
          <RackRailsStep
            hasRearInterior={config.hasRearInterior}
            setHasRearInterior={(v) => update("hasRearInterior", v)}
            rearGap={config.rearGap}
            setRearGap={(v) => update("rearGap", v)}
          />
        );
      case "summary":
        return (
          <SummaryStep
            rackType={config.rackType}
            name={config.name}
            isRackable={config.isRackable}
            totalU={config.totalU}
            depthMm={config.depthMm}
            widthMm={config.widthMm}
            heightMm={config.heightMm}
            hasWheels={config.hasWheels}
            flight={flight}
            emptyWeightKg={config.emptyWeightKg}
            hasRearInterior={config.hasRearInterior}
            rearGap={config.rearGap}
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
        <DialogTitle className="sr-only">Nouveau contenant</DialogTitle>
        <DialogDescription className="sr-only">
          Wizard de création d&apos;un modèle de contenant en plusieurs étapes.
        </DialogDescription>

        <WizardBackdrop variant={isIntro ? "intense" : "discreet"} />
        <WizardKeyframes />

        {/* Progress bar (masquée sur intro) */}
        {!isIntro && currentStep.progressIndex > 0 && (
          <div className="relative z-10 px-8 pt-6">
            <ProgressBar
              progressIndex={currentStep.progressIndex}
              total={progressTotal}
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
                {isSummary ? "Créer le contenant" : "Continuer"}
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
          label='Baie 19"'
        >
          <BaieMockup />
        </IntroMockup>
        <IntroMockup
          className="absolute top-6 -right-4"
          rotate="9deg"
          delay="1s"
          duration="7s"
          accent="amber"
          label="Flight case"
        >
          <FlightCaseMockup />
        </IntroMockup>
        <IntroMockup
          className="absolute -left-2 bottom-6"
          rotate="-6deg"
          delay="2s"
          duration="8s"
          accent="cyan"
          label="Pelicase"
        >
          <PelicaseMockup />
        </IntroMockup>
        <IntroMockup
          className="absolute -right-2 bottom-4"
          rotate="12deg"
          delay="1.5s"
          duration="7.5s"
          accent="violet"
          label="Rack front"
        >
          <RackFrontMockup />
        </IntroMockup>
      </div>

      <div className="relative z-10 mx-auto flex h-full max-w-lg flex-col items-center justify-center px-8 py-16 text-center">
        {/* arkyo-server: habillage Strata (texte d'accent sur fond teinté : --accent-strong) */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--surface)]/40 bg-[var(--surface)]/60 px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent-strong)] uppercase shadow-sm backdrop-blur-md dark:border-[var(--foreground)]/10 dark:bg-[var(--foreground)]/10">
          <Sparkles
            className="h-3 w-3"
            style={{ animation: "sparkle-twinkle 2s ease-in-out infinite" }}
          />
          Nouveau contenant
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
            modèle de contenant
          </span>
        </h3>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
          Configurez un contenant réutilisable pour vos projets — baie, flight
          case, pelicase ou mobilier.
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

type IntroAccent = "blue" | "amber" | "cyan" | "violet";

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
  amber: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    text: "text-amber-600/80 dark:text-amber-400/70",
    dot: "bg-amber-500/70",
  },
  cyan: {
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/5",
    text: "text-cyan-600/80 dark:text-cyan-400/70",
    dot: "bg-cyan-500/70",
  },
  violet: {
    border: "border-violet-500/30",
    bg: "bg-violet-500/5",
    text: "text-violet-600/80 dark:text-violet-400/70",
    dot: "bg-violet-500/70",
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

function BaieMockup() {
  return (
    <div className="absolute inset-0 flex flex-col gap-0.5">
      <div className="h-2 rounded-sm border border-blue-500/30 bg-blue-500/10" />
      <div className="flex h-3 items-center rounded-sm border border-violet-500/30 bg-violet-500/10 px-1">
        <div className="h-0.5 w-3 rounded-full bg-violet-500/40" />
      </div>
      <div className="h-1.5 rounded-sm bg-zinc-500/15" />
      <div className="flex h-2.5 items-center rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1">
        <div className="h-0.5 w-2 rounded-full bg-emerald-500/40" />
      </div>
      <div className="flex h-4 flex-col justify-between rounded-sm border border-amber-500/30 bg-amber-500/10 px-1 py-0.5">
        <div className="h-0.5 w-4 rounded-full bg-amber-500/40" />
        <div className="grid grid-cols-5 gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="h-0.5 rounded-full bg-amber-500/40" />
          ))}
        </div>
      </div>
      <div className="h-1.5 rounded-sm border border-dashed border-zinc-400/30" />
      <div className="flex h-3 items-center rounded-sm border border-blue-500/30 bg-blue-500/10 px-1">
        <div className="h-0.5 w-2 rounded-full bg-blue-500/40" />
      </div>
      <div className="h-2 rounded-sm border border-blue-500/30 bg-blue-500/10" />
    </div>
  );
}

function FlightCaseMockup() {
  return (
    <svg
      viewBox="0 0 100 110"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x="38" y="6" width="24" height="5" rx="1.5" fill="rgb(120 53 15 / 0.4)" />
      <rect x="42" y="8" width="16" height="2" rx="1" fill="rgb(120 53 15 / 0.6)" />
      <rect x="10" y="16" width="80" height="70" rx="3" fill="rgb(245 158 11 / 0.12)" stroke="rgb(245 158 11 / 0.45)" strokeWidth="1.2" />
      <line x1="10" y1="34" x2="90" y2="34" stroke="rgb(245 158 11 / 0.35)" strokeWidth="0.8" />
      <circle cx="16" cy="22" r="1.8" fill="rgb(120 53 15 / 0.5)" />
      <circle cx="84" cy="22" r="1.8" fill="rgb(120 53 15 / 0.5)" />
      <circle cx="16" cy="80" r="1.8" fill="rgb(120 53 15 / 0.5)" />
      <circle cx="84" cy="80" r="1.8" fill="rgb(120 53 15 / 0.5)" />
      <rect x="38" y="31" width="10" height="5" rx="1" fill="rgb(120 53 15 / 0.45)" />
      <rect x="52" y="31" width="10" height="5" rx="1" fill="rgb(120 53 15 / 0.45)" />
      <line x1="30" y1="55" x2="70" y2="55" stroke="rgb(120 53 15 / 0.35)" strokeWidth="0.6" />
      <line x1="30" y1="60" x2="70" y2="60" stroke="rgb(120 53 15 / 0.35)" strokeWidth="0.6" />
      <line x1="30" y1="65" x2="70" y2="65" stroke="rgb(120 53 15 / 0.35)" strokeWidth="0.6" />
      <circle cx="20" cy="96" r="5" fill="rgb(50 50 50 / 0.45)" />
      <circle cx="20" cy="96" r="2" fill="rgb(90 90 90 / 0.7)" />
      <circle cx="40" cy="96" r="5" fill="rgb(50 50 50 / 0.45)" />
      <circle cx="40" cy="96" r="2" fill="rgb(90 90 90 / 0.7)" />
      <circle cx="60" cy="96" r="5" fill="rgb(50 50 50 / 0.45)" />
      <circle cx="60" cy="96" r="2" fill="rgb(90 90 90 / 0.7)" />
      <circle cx="80" cy="96" r="5" fill="rgb(50 50 50 / 0.45)" />
      <circle cx="80" cy="96" r="2" fill="rgb(90 90 90 / 0.7)" />
    </svg>
  );
}

function PelicaseMockup() {
  return (
    <svg
      viewBox="0 0 100 110"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x="38" y="10" width="24" height="6" rx="2.5" fill="rgb(8 145 178 / 0.4)" />
      <rect x="42" y="13" width="16" height="2" rx="1" fill="rgb(8 145 178 / 0.7)" />
      <rect x="10" y="20" width="80" height="78" rx="6" fill="rgb(6 182 212 / 0.12)" stroke="rgb(6 182 212 / 0.45)" strokeWidth="1.2" />
      <line x1="10" y1="58" x2="90" y2="58" stroke="rgb(6 182 212 / 0.4)" strokeWidth="0.8" strokeDasharray="2 2" />
      <rect x="28" y="55" width="12" height="6" rx="1.5" fill="rgb(8 145 178 / 0.6)" />
      <rect x="60" y="55" width="12" height="6" rx="1.5" fill="rgb(8 145 178 / 0.6)" />
      <rect x="14" y="88" width="6" height="6" rx="1.5" fill="rgb(8 145 178 / 0.45)" />
      <rect x="80" y="88" width="6" height="6" rx="1.5" fill="rgb(8 145 178 / 0.45)" />
      <line x1="22" y1="30" x2="78" y2="30" stroke="rgb(6 182 212 / 0.3)" strokeWidth="0.5" />
      <line x1="22" y1="40" x2="78" y2="40" stroke="rgb(6 182 212 / 0.3)" strokeWidth="0.5" />
      <line x1="22" y1="75" x2="78" y2="75" stroke="rgb(6 182 212 / 0.3)" strokeWidth="0.5" />
      <line x1="22" y1="85" x2="78" y2="85" stroke="rgb(6 182 212 / 0.3)" strokeWidth="0.5" />
    </svg>
  );
}

function RackFrontMockup() {
  return (
    <svg
      viewBox="0 0 100 110"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x="8" y="6" width="84" height="98" rx="2" fill="none" stroke="rgb(139 92 246 / 0.45)" strokeWidth="1.2" />
      <line x1="14" y1="10" x2="14" y2="100" stroke="rgb(139 92 246 / 0.35)" strokeWidth="0.6" strokeDasharray="2 2" />
      <line x1="86" y1="10" x2="86" y2="100" stroke="rgb(139 92 246 / 0.35)" strokeWidth="0.6" strokeDasharray="2 2" />
      <rect x="18" y="14" width="64" height="20" rx="1.5" fill="rgb(59 130 246 / 0.1)" stroke="rgb(59 130 246 / 0.45)" strokeWidth="0.8" />
      <rect x="22" y="20" width="32" height="8" rx="1" fill="rgb(59 130 246 / 0.2)" />
      <line x1="18" y1="38" x2="82" y2="38" stroke="rgb(139 92 246 / 0.3)" strokeWidth="0.4" strokeDasharray="2 2" />
      <rect x="18" y="40" width="64" height="22" rx="1.5" fill="rgb(16 185 129 / 0.1)" stroke="rgb(16 185 129 / 0.45)" strokeWidth="0.8" />
      <circle cx="26" cy="51" r="2" fill="rgb(16 185 129 / 0.5)" />
      <circle cx="34" cy="51" r="2" fill="rgb(16 185 129 / 0.5)" />
      <circle cx="42" cy="51" r="2" fill="rgb(16 185 129 / 0.5)" />
      <line x1="18" y1="66" x2="82" y2="66" stroke="rgb(139 92 246 / 0.3)" strokeWidth="0.4" strokeDasharray="2 2" />
      <rect x="18" y="68" width="64" height="14" rx="1.5" fill="rgb(245 158 11 / 0.1)" stroke="rgb(245 158 11 / 0.45)" strokeWidth="0.8" />
      <circle cx="26" cy="75" r="1.5" fill="rgb(245 158 11 / 0.5)" />
      <circle cx="34" cy="75" r="1.5" fill="rgb(245 158 11 / 0.5)" />
      <circle cx="42" cy="75" r="1.5" fill="rgb(245 158 11 / 0.5)" />
      <circle cx="50" cy="75" r="1.5" fill="rgb(245 158 11 / 0.5)" />
      <rect x="18" y="84" width="64" height="14" rx="1.5" fill="rgb(139 92 246 / 0.1)" stroke="rgb(139 92 246 / 0.45)" strokeWidth="0.8" />
      <line x1="22" y1="91" x2="78" y2="91" stroke="rgb(139 92 246 / 0.4)" strokeWidth="0.5" />
    </svg>
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────

function SummaryStep({
  rackType,
  name,
  isRackable,
  totalU,
  depthMm,
  widthMm,
  heightMm,
  hasWheels,
  flight,
  emptyWeightKg,
  hasRearInterior,
  rearGap,
  onEdit,
}: {
  rackType: RackType;
  name: string;
  isRackable: boolean;
  totalU: number;
  depthMm: number;
  widthMm: number;
  heightMm: number;
  hasWheels: boolean;
  flight: boolean;
  emptyWeightKg: number;
  hasRearInterior: boolean;
  rearGap: number;
  onEdit: (id: StepId) => void;
}) {
  const dimensionsLabel = isRackable
    ? `${totalU}U · ${depthMm} mm`
    : `${widthMm} × ${heightMm} × ${depthMm} mm`;

  return (
    <div className="mx-auto max-w-lg">
      <WizardStepHeader
        title="Vérifiez et créez votre contenant"
        subtitle="Cliquez sur un élément pour le modifier."
      />
      <div className="space-y-3 rounded-2xl border border-[var(--border)]/60 bg-gradient-to-br from-[var(--card)] to-[var(--secondary)]/30 p-4 shadow-sm">
        {/* Ligne titre : badge type + nom + chip rackable */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onEdit("type")}
              // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[9px] font-bold tracking-wider text-[var(--accent-strong)] uppercase transition-colors hover:bg-[var(--accent)]/20"
            >
              <Server className="h-2.5 w-2.5" />
              {RACK_TYPE_LABEL[rackType]}
            </button>
            <button
              type="button"
              onClick={() => onEdit("name")}
              className="group mt-1.5 block w-full text-left"
            >
              <p className="truncate text-lg font-semibold tracking-tight text-[var(--foreground)] transition-colors group-hover:text-[var(--accent)]">
                {name || "Contenant sans nom"}
              </p>
            </button>
          </div>
          <button
            type="button"
            onClick={() => onEdit("rackable")}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-2.5 py-1.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
          >
            {isRackable ? '19" rackable' : "Sur-mesure"}
          </button>
        </div>

        <div className="h-px bg-[var(--border)]/50" />

        {/* Grille compacte */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <SummaryItem
            icon={Box}
            label={isRackable ? "Hauteur / prof." : "L × l × P"}
            value={dimensionsLabel}
            onClick={() => onEdit("dimensions")}
          />
          <SummaryItem
            icon={Weight}
            label="Poids à vide"
            value={emptyWeightKg > 0 ? `${emptyWeightKg} kg` : "—"}
            onClick={() => onEdit("weight")}
          />
          {flight && (
            <SummaryItem
              icon={Disc}
              label="Roulettes"
              value={hasWheels ? "Oui" : "Non"}
              onClick={() => onEdit("wheels")}
            />
          )}
          {isRackable && (
            <SummaryItem
              icon={Server}
              label="Rails arrière"
              value={hasRearInterior ? `Oui — ${rearGap} mm` : "Non"}
              onClick={() => onEdit("rails")}
            />
          )}
        </div>
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
  icon: typeof Box;
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
