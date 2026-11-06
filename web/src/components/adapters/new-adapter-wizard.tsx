"use client";

/**
 * NewAdapterWizard — wizard de création d'un adaptateur (TenantAdapter) depuis
 * `/admin/catalogue?tab=adapters`.
 *
 * Calqué sur `NewCableWizard` (components/cables/new-cable-wizard.tsx) :
 *  - Intro design + icône adaptateur (Plug centré) + 3 mockups SVG flottants
 *  - Bouton "Saisie rapide" pour utilisateurs avancés (skip wizard)
 *  - WizardBackdrop intense sur intro / discreet ailleurs
 *  - WizardStepHeader + ProgressBar partagés
 *  - Cards de sélection avec checkmark accent
 *  - Récap final 2 colonnes, lignes cliquables
 *
 * Particularités vs cordon :
 *  - PAS de marque ni modèle (pas de notion `CableModel`).
 *  - PAS de cas d'usage / longueurs (concepts cordons).
 *  - Métier "câble pieuvre" : 1 connecteur d'entrée → N connecteurs de sortie.
 *  - Chaque port = { connectorTypeId, gender, quantity, label? }
 *
 * Steps :
 *   0. INTRO     — accueil design + icône + CTA "Démarrer"
 *   1. IDENTITY  — nom (requis), référence (uppercase auto).
 *   2. FUNCTION  — fonction principale (Vidéo / Audio / Sync…). Obligatoire.
 *   3. INPUT     — connecteur d'entrée (1 seul) + genre + quantité + label.
 *   4. OUTPUTS   — connecteurs de sortie (N) ; au moins 1 requis.
 *   5. IMAGE     — upload 16:9 + URL paste
 *   6. SUMMARY   — récap + CTA "Créer et fermer"
 *
 * API : POST /api/tenant/catalogue/adapters
 *   payload : { name, reference?, functionId?, inputs[1], outputs[1..N],
 *               imageUrl?, notes? }
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Plug,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";
import { Input } from "@/components/ui/input";
import {
  ConnectorPickerModal,
  ConnectorPickerTrigger,
} from "@/components/catalogue/connector-picker-modal";
import { RangeInput } from "@/components/wizard/range-input";
import {
  ProgressBar,
  WizardBackdrop,
  WizardKeyframes,
  WizardStepHeader,
} from "@/components/wizard/wizard-backdrop";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type Gender = "MALE" | "FEMALE" | "NEUTRAL";

type AdapterPort = {
  connectorTypeId: string;
  gender: Gender;
  quantity: number;
  label: string;
};

type LookupFunction = {
  id: string;
  label: string;
  color: string;
  sortOrder?: number;
};

type LookupConnectorType = {
  id: string;
  name: string;
  color?: string | null;
};

type LookupResponse = {
  functions?: LookupFunction[];
  connectorTypes?: LookupConnectorType[];
};

/** Mode de fermeture du wizard une fois l'adaptateur créé. */
export type NewAdapterCloseMode = "close" | "complete";

// ── Steps ───────────────────────────────────────────────────────────────────

type StepId =
  | "intro"
  | "identity"
  | "function"
  | "input"
  | "outputs"
  | "image"
  | "summary";

type StepDef = { id: StepId; progressIndex: number };

const STEPS: StepDef[] = [
  { id: "intro", progressIndex: -1 },
  { id: "identity", progressIndex: 1 },
  { id: "function", progressIndex: 2 },
  { id: "input", progressIndex: 3 },
  { id: "outputs", progressIndex: 4 },
  { id: "image", progressIndex: 5 },
  { id: "summary", progressIndex: 6 },
];

const PROGRESS_TOTAL = 6;

const GENDER_OPTIONS: { value: Gender; label: string; short: string }[] = [
  { value: "MALE", label: "Mâle", short: "M" },
  { value: "FEMALE", label: "Femelle", short: "F" },
  { value: "NEUTRAL", label: "I/O", short: "I/O" },
];

function emptyPort(): AdapterPort {
  return { connectorTypeId: "", gender: "FEMALE", quantity: 1, label: "" };
}

// ── Component ───────────────────────────────────────────────────────────────

export function NewAdapterWizard({
  open,
  onOpenChange,
  onCreated,
  onSkipWizard,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Callback appelé après création réussie. `mode` détermine quoi faire ensuite. */
  onCreated: (id: string, mode: NewAdapterCloseMode) => void;
  /**
   * Optionnel : callback "Saisie rapide" — ouvre directement la fiche vide
   * sans passer par le wizard.
   */
  onSkipWizard?: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookups
  const [lookups, setLookups] = useState<LookupResponse | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // ── Champs ──────────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");

  const [functionId, setFunctionId] = useState<string | null>(null);

  const [input, setInput] = useState<AdapterPort>(emptyPort);
  const [outputs, setOutputs] = useState<AdapterPort[]>([emptyPort()]);

  const [imageUrl, setImageUrl] = useState<string>("");

  // Fetch lookups quand le wizard s'ouvre
  useEffect(() => {
    if (!open || lookups) return;
    let cancelled = false;
    const load = async () => {
      setLookupLoading(true);
      setLookupError(null);
      try {
        const data = await api.get<LookupResponse>(
          "/api/tenant/catalogue/lookup",
        );
        if (cancelled) return;
        setLookups(data);
      } catch (e) {
        if (cancelled) return;
        setLookupError(
          getApiErrorMessage(e, "Impossible de charger les référentiels."),
        );
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, lookups]);

  // ── Step nav ────────────────────────────────────────────────────────────────
  const currentStep = STEPS[Math.min(stepIndex, STEPS.length - 1)] ?? STEPS[0];
  const isIntro = currentStep.id === "intro";
  const isSummary = currentStep.id === "summary";

  const reset = () => {
    setStepIndex(0);
    setSubmitting(false);
    setError(null);
    setName("");
    setReference("");
    setFunctionId(null);
    setInput(emptyPort());
    setOutputs([emptyPort()]);
    setImageUrl("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setTimeout(reset, 150);
    onOpenChange(next);
  };

  const goNext = () => {
    if (isSummary) return;
    // Vérifie la validation du step courant avant d'avancer.
    const err = validateStep(currentStep.id);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
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

  // ── Validation par étape ────────────────────────────────────────────────────
  const validateStep = (id: StepId): string | null => {
    if (id === "identity") {
      if (name.trim().length === 0) return "Le nom est requis.";
    }
    if (id === "function") {
      if (!functionId) return "Sélectionnez une fonction pour continuer.";
    }
    if (id === "input") {
      if (!input.connectorTypeId)
        return "Sélectionnez un connecteur d'entrée.";
    }
    if (id === "outputs") {
      const validOutputs = outputs.filter((p) => p.connectorTypeId);
      if (validOutputs.length === 0)
        return "Ajoutez au moins un connecteur de sortie.";
    }
    return null;
  };

  // ── Submission ──────────────────────────────────────────────────────────────
  const handleCreate = async (mode: NewAdapterCloseMode) => {
    const idErr = validateStep("identity");
    if (idErr) {
      setError(idErr);
      jumpToStep("identity");
      return;
    }
    const fnErr = validateStep("function");
    if (fnErr) {
      setError(fnErr);
      jumpToStep("function");
      return;
    }
    const inputErr = validateStep("input");
    if (inputErr) {
      setError(inputErr);
      jumpToStep("input");
      return;
    }
    const outputsErr = validateStep("outputs");
    if (outputsErr) {
      setError(outputsErr);
      jumpToStep("outputs");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
      };
      if (reference.trim()) payload.reference = reference.trim();
      if (functionId) payload.functionId = functionId;
      // Adaptateur = 1 seul connecteur d'entrée → quantity forcée à 1
      payload.inputs = [
        {
          connectorTypeId: input.connectorTypeId,
          gender: input.gender,
          quantity: 1,
          label: input.label.trim(),
        },
      ];
      payload.outputs = outputs
        .filter((p) => p.connectorTypeId)
        .map((p) => ({
          connectorTypeId: p.connectorTypeId,
          gender: p.gender,
          quantity: p.quantity,
          label: p.label.trim(),
        }));
      if (imageUrl) payload.imageUrl = imageUrl;

      const created = await api.post<{ id: string }>(
        "/api/tenant/catalogue/adapters",
        payload,
      );
      if (!created?.id) {
        throw new Error("Création réussie mais ID manquant.");
      }
      onCreated(created.id, mode);
      handleOpenChange(false);
    } catch (e) {
      setError(getApiErrorMessage(e, "Échec de la création."));
      setSubmitting(false);
    }
  };

  // ── Disabled state du bouton "Continuer" ────────────────────────────────────
  const continueDisabled = (() => {
    if (submitting) return true;
    if (currentStep.id === "identity" && name.trim().length === 0) return true;
    if (currentStep.id === "function" && !functionId) return true;
    if (currentStep.id === "input" && !input.connectorTypeId) return true;
    if (
      currentStep.id === "outputs" &&
      outputs.filter((p) => p.connectorTypeId).length === 0
    )
      return true;
    return false;
  })();

  // ── Lookup helpers / dérivés ────────────────────────────────────────────────
  const allFunctions = lookups?.functions ?? [];
  const allConnectors = lookups?.connectorTypes ?? [];

  // ── Body renderer ───────────────────────────────────────────────────────────
  const renderStepBody = () => {
    switch (currentStep.id) {
      case "intro":
        return (
          <IntroStep
            onStart={() => setStepIndex(1)}
            onSkipWizard={onSkipWizard}
          />
        );
      case "identity":
        return (
          <IdentityStep
            name={name}
            setName={setName}
            reference={reference}
            setReference={setReference}
          />
        );
      case "function":
        return (
          <FunctionStep
            functions={allFunctions}
            functionId={functionId}
            setFunctionId={setFunctionId}
            loading={lookupLoading}
            onAdvance={() =>
              setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
            }
          />
        );
      case "input":
        return (
          <InputStep
            connectors={allConnectors}
            port={input}
            setPort={setInput}
            loading={lookupLoading}
          />
        );
      case "outputs":
        return (
          <OutputsStep
            connectors={allConnectors}
            outputs={outputs}
            setOutputs={setOutputs}
            loading={lookupLoading}
          />
        );
      case "image":
        return (
          <ImageStep
            imageUrl={imageUrl}
            setImageUrl={setImageUrl}
            onSkip={goNext}
          />
        );
      case "summary":
        return (
          <SummaryStep
            name={name}
            reference={reference}
            fn={allFunctions.find((f) => f.id === functionId) ?? null}
            input={input}
            outputs={outputs}
            connectors={allConnectors}
            imageUrl={imageUrl}
            onEdit={jumpToStep}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[680px] max-w-5xl flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">Nouvel adaptateur</DialogTitle>
        <DialogDescription className="sr-only">
          Wizard de création d&apos;un adaptateur personnel en plusieurs étapes.
        </DialogDescription>

        <WizardBackdrop variant={isIntro ? "intense" : "discreet"} />
        <WizardKeyframes />

        {!isIntro && currentStep.progressIndex > 0 && (
          <div className="relative z-10 px-8 pt-6">
            <ProgressBar
              progressIndex={currentStep.progressIndex}
              total={PROGRESS_TOTAL}
            />
          </div>
        )}

        <div className="relative z-10 flex flex-1 items-center justify-center overflow-hidden px-8 py-8">
          <div className="w-full">{renderStepBody()}</div>
        </div>

        {(error || lookupError) && (
          // arkyo-server: habillage Strata
          <div className="relative z-10 mx-8 mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-[var(--danger-text)]">
            {error ?? lookupError}
          </div>
        )}

        {!isIntro && !isSummary && (
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
                Continuer
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {isSummary && (
          <div className="relative z-10 flex items-center justify-between gap-3 border-t border-[var(--border)]/60 bg-[var(--card)]/70 px-8 py-4 backdrop-blur-sm">
            <div>
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
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="accent"
                onClick={() => handleCreate("close")}
                disabled={submitting}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Créer et fermer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Intro ─────────────────────────────────────────────────────────────────

/** Icône adaptateur centrée — sobre, sans monogramme. */
function AdapterIconStack() {
  return (
    <div className="relative flex h-14 w-14 items-center justify-center">
      <Plug
        // arkyo-server: habillage Strata
        className="h-12 w-12 text-[var(--foreground)]"
        strokeWidth={1.5}
      />
    </div>
  );
}

/** 3 mini-mockups SVG broadcast-adaptateur, flottants en background. */
function AdapterMockups() {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden
    >
      {/* Mockup 1×IN → 2×OUT — haut-droite, rotation 6° */}
      <div
        className="absolute -right-4 top-10 hidden h-24 w-44 rounded-xl border border-white/40 bg-white/40 p-2.5 backdrop-blur-md dark:border-white/10 dark:bg-white/5 sm:block"
        style={{
          transform: "rotate(6deg)",
          animation: "mockup-float 7s ease-in-out infinite",
        }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
            1 → 2
          </span>
          <div className="flex gap-0.5">
            <span className="h-1 w-1 rounded-full bg-emerald-500" />
          </div>
        </div>
        <svg
          viewBox="0 0 160 50"
          className="h-12 w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Connecteur source */}
          <circle cx="14" cy="25" r="9" fill="rgb(139 92 246 / 0.18)" stroke="rgb(139 92 246 / 0.6)" strokeWidth="1.2" />
          <circle cx="14" cy="25" r="3" fill="rgb(139 92 246 / 0.85)" />
          {/* Câble vers split */}
          <path
            d="M23 25 L 80 25"
            fill="none"
            stroke="rgb(99 102 241 / 0.6)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {/* Nœud de split */}
          <circle cx="80" cy="25" r="3" fill="rgb(99 102 241 / 0.85)" />
          {/* Branches */}
          <path
            d="M80 25 C 100 25, 110 12, 132 12"
            fill="none"
            stroke="rgb(99 102 241 / 0.6)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M80 25 C 100 25, 110 38, 132 38"
            fill="none"
            stroke="rgb(99 102 241 / 0.6)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Connecteurs cibles */}
          <circle cx="142" cy="12" r="7" fill="rgb(16 185 129 / 0.18)" stroke="rgb(16 185 129 / 0.6)" strokeWidth="1.2" />
          <circle cx="142" cy="12" r="2.2" fill="rgb(16 185 129 / 0.85)" />
          <circle cx="142" cy="38" r="7" fill="rgb(16 185 129 / 0.18)" stroke="rgb(16 185 129 / 0.6)" strokeWidth="1.2" />
          <circle cx="142" cy="38" r="2.2" fill="rgb(16 185 129 / 0.85)" />
        </svg>
      </div>

      {/* Mockup conversion type — haut-gauche, rotation -9° */}
      <div
        className="absolute -left-6 top-6 hidden h-28 w-36 rounded-xl border border-white/40 bg-white/40 p-2.5 backdrop-blur-md dark:border-white/10 dark:bg-white/5 sm:block"
        style={{
          transform: "rotate(-9deg)",
          animation: "mockup-float 8s ease-in-out infinite",
          animationDelay: "1.2s",
        }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
            Conversion
          </span>
          <Sparkles className="h-2.5 w-2.5 text-[var(--muted-foreground)]/60" />
        </div>
        <svg
          viewBox="0 0 130 70"
          className="h-16 w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Source : XLR */}
          <circle cx="22" cy="35" r="10" fill="rgb(139 92 246 / 0.18)" stroke="rgb(139 92 246 / 0.65)" strokeWidth="1.2" />
          <circle cx="18" cy="32" r="1.3" fill="rgb(139 92 246 / 0.85)" />
          <circle cx="26" cy="32" r="1.3" fill="rgb(139 92 246 / 0.85)" />
          <circle cx="22" cy="39" r="1.3" fill="rgb(139 92 246 / 0.85)" />
          {/* Câble */}
          <path
            d="M32 35 L 80 35"
            fill="none"
            stroke="rgb(99 102 241 / 0.6)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {/* Cible : Jack (rectangle) */}
          <rect x="82" y="27" width="22" height="16" rx="2" fill="rgb(16 185 129 / 0.18)" stroke="rgb(16 185 129 / 0.65)" strokeWidth="1.2" />
          <circle cx="100" cy="35" r="2.4" fill="rgb(16 185 129 / 0.7)" />
          {/* Labels */}
          <text x="22" y="55" fontSize="5" fill="rgb(139 92 246 / 0.85)" textAnchor="middle" fontFamily="monospace">XLR F</text>
          <text x="93" y="55" fontSize="5" fill="rgb(16 185 129 / 0.85)" textAnchor="middle" fontFamily="monospace">JACK</text>
        </svg>
      </div>

      {/* Mockup ports multi — bas-gauche, rotation -6° */}
      <div
        className="absolute bottom-4 left-12 hidden h-32 w-32 rounded-xl border border-white/40 bg-white/40 p-2 backdrop-blur-md dark:border-white/10 dark:bg-white/5 sm:block"
        style={{
          transform: "rotate(-6deg)",
          animation: "mockup-float 9s ease-in-out infinite",
          animationDelay: "2.4s",
        }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
            Ports
          </span>
        </div>
        <svg
          viewBox="0 0 110 100"
          className="h-24 w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Châssis */}
          <rect x="10" y="22" width="90" height="56" rx="4" fill="rgb(245 158 11 / 0.10)" stroke="rgb(245 158 11 / 0.55)" strokeWidth="1.2" />
          {/* 4 ports */}
          <circle cx="28" cy="40" r="6" fill="rgb(245 158 11 / 0.25)" stroke="rgb(245 158 11 / 0.7)" strokeWidth="1" />
          <circle cx="55" cy="40" r="6" fill="rgb(245 158 11 / 0.25)" stroke="rgb(245 158 11 / 0.7)" strokeWidth="1" />
          <circle cx="82" cy="40" r="6" fill="rgb(245 158 11 / 0.25)" stroke="rgb(245 158 11 / 0.7)" strokeWidth="1" />
          <circle cx="28" cy="62" r="6" fill="rgb(245 158 11 / 0.25)" stroke="rgb(245 158 11 / 0.7)" strokeWidth="1" />
          <circle cx="55" cy="62" r="6" fill="rgb(245 158 11 / 0.25)" stroke="rgb(245 158 11 / 0.7)" strokeWidth="1" />
          <circle cx="82" cy="62" r="6" fill="rgb(245 158 11 / 0.25)" stroke="rgb(245 158 11 / 0.7)" strokeWidth="1" />
          <text x="55" y="92" fontSize="6" fill="rgb(245 158 11 / 0.85)" textAnchor="middle" fontFamily="monospace" fontWeight="bold">SPLIT 1→6</text>
        </svg>
      </div>
    </div>
  );
}

function IntroStep({
  onStart,
  onSkipWizard,
}: {
  onStart: () => void;
  onSkipWizard?: () => void;
}) {
  return (
    <div className="relative -mx-8 -my-8 overflow-hidden rounded-2xl">
      <AdapterMockups />

      <div className="relative z-10 mx-auto flex h-full max-w-lg flex-col items-center justify-center px-8 py-16 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/60 px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/10">
          <Sparkles
            className="h-3 w-3"
            style={{ animation: "sparkle-twinkle 2s ease-in-out infinite" }}
          />
          Nouvel adaptateur
        </span>

        <div
          className="mt-10 flex h-20 w-20 items-center justify-center rounded-2xl shadow-sm"
          style={{
            background:
              "linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(59, 130, 246, 0.06) 50%, rgba(16, 185, 129, 0.08))",
          }}
        >
          <AdapterIconStack />
        </div>

        <h3 className="mt-8 text-3xl leading-tight font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
          Ajoutons un{" "}
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
            adaptateur
          </span>{" "}
          à votre catalogue
        </h3>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
          Quelques étapes guidées pour créer un adaptateur (entrée unique vers
          une ou plusieurs sorties). Vous pourrez ensuite enrichir la fiche ou
          revenir plus tard.
        </p>

        <Button
          type="button"
          variant="accent"
          onClick={onStart}
          className="mt-12 shadow-lg shadow-[var(--accent)]/30"
        >
          Démarrer
          <ArrowRight className="h-4 w-4" />
        </Button>

        {onSkipWizard && (
          <button
            type="button"
            onClick={onSkipWizard}
            className="mt-4 text-[11px] font-medium text-[var(--muted-foreground)] underline-offset-4 transition-colors hover:text-[var(--foreground)] hover:underline"
          >
            Saisie rapide (sans assistant)
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Step 1 : Identity ──────────────────────────────────────────────────────

type DuplicateMatch = {
  id: string;
  name: string;
  reference: string | null;
  source: "PERSONAL" | "ARKYO";
  matchField: "name" | "reference" | "both";
};

/** Capitalise la première lettre uniquement. */
function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function IdentityStep({
  name,
  setName,
  reference,
  setReference,
}: {
  name: string;
  setName: (v: string) => void;
  reference: string;
  setReference: (v: string) => void;
}) {
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const trimmedName = name.trim();
    const trimmedRef = reference.trim();
    const hasName = trimmedName.length >= 2;
    const hasRef = trimmedRef.length >= 1;
    if (!hasName && !hasRef) {
      setDuplicates([]);
      setChecking(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      const params = new URLSearchParams();
      if (hasName) params.set("name", trimmedName);
      if (hasRef) params.set("reference", trimmedRef);
      api
        .get<{ matches: DuplicateMatch[] }>(
          `/api/tenant/catalogue/adapters/check-duplicate?${params.toString()}`,
          { signal: controller.signal },
        )
        .then((data) => {
          if (controller.signal.aborted) return;
          setDuplicates(data?.matches ?? []);
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          if (e instanceof Error && e.name === "AbortError") return;
          setDuplicates([]);
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          setChecking(false);
        });
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [name, reference]);

  const hasDuplicates = duplicates.length > 0;

  return (
    <div>
      <WizardStepHeader
        title="Identifions l'adaptateur"
        subtitle="Comment voulez-vous le nommer ? La référence est facultative."
      />
      <div
        className={cn(
          "mx-auto",
          hasDuplicates
            ? "grid max-w-4xl gap-6 md:grid-cols-2"
            : "max-w-lg space-y-5",
        )}
      >
        <div className="space-y-5">
          <FormField label="Nom de l'adaptateur" required>
            <Input
              autoFocus
              className="h-11 text-sm"
              placeholder="Ex. XLR5 → 2× XLR3"
              value={name}
              onChange={(e) => setName(capitalizeFirst(e.target.value))}
            />
          </FormField>

          <FormField label="Référence">
            <Input
              className="h-11 text-sm uppercase"
              placeholder="Ex. ADP-XLR5-XLR3"
              value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
            />
          </FormField>
        </div>

        {hasDuplicates && (
          <div className="md:pt-7">
            <DuplicateWarning matches={duplicates} checking={checking} />
          </div>
        )}
      </div>
    </div>
  );
}

function DuplicateWarning({
  matches,
  checking,
}: {
  matches: DuplicateMatch[];
  checking: boolean;
}) {
  if (matches.length === 0) {
    if (!checking) return null;
    return null;
  }

  // arkyo-server: habillage Strata
  return (
    <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2.5 text-[var(--warning-text)]">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <p className="text-[11px] font-semibold">
            {matches.length} adaptateur{matches.length > 1 ? "s" : ""} similaire
            {matches.length > 1 ? "s" : ""} trouvé
            {matches.length > 1 ? "s" : ""} :
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {matches.map((m) => (
              <li key={`${m.source}-${m.id}`}>
                <a
                  href={`/admin/catalogue/adapters/${m.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  // arkyo-server: habillage Strata
                  className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-[var(--warning)]/10"
                >
                  {/* arkyo-server: catalogue unique (tout est personnel) — badge de source « arkyo / personnel » retiré */}
                  {/* arkyo-server: habillage Strata */}
                  <span className="font-medium text-[var(--warning-text)]">
                    {m.name}
                  </span>
                  {m.reference && (
                    <span className="font-mono text-[10px] opacity-70">
                      {m.reference}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-[10px] opacity-80">
            Voulez-vous plutôt dupliquer un existant ou continuer ?
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2 : Function ──────────────────────────────────────────────────────

function FunctionStep({
  functions,
  functionId,
  setFunctionId,
  loading,
  onAdvance,
}: {
  functions: LookupFunction[];
  functionId: string | null;
  setFunctionId: (v: string | null) => void;
  loading: boolean;
  /** Auto-advance après sélection (laisse 200ms de feedback visuel). */
  onAdvance: () => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Fonction de l'adaptateur"
        subtitle="À quelle chaîne signal cet adaptateur est-il destiné ? Cela aide à le retrouver et à le regrouper avec ses pairs."
      />
      <div className="mx-auto max-w-2xl space-y-5">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Chargement des référentiels…
          </div>
        ) : functions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted-foreground)]">
            Aucune fonction disponible. Vous pourrez classer cet adaptateur
            plus tard depuis sa fiche détaillée.
          </div>
        ) : (
          <FormField label="Fonction (obligatoire)">
            <div
              className={cn(
                "grid gap-2",
                functions.length <= 4 ? "grid-cols-2" : "grid-cols-3",
              )}
            >
              {functions.map((f) => {
                const active = functionId === f.id;
                return (
                  <FunctionCard
                    key={f.id}
                    fn={f}
                    active={active}
                    onClick={() => {
                      setFunctionId(f.id);
                      // Auto-advance après court délai pour laisser
                      // voir le checkmark accent.
                      setTimeout(onAdvance, 200);
                    }}
                  />
                );
              })}
            </div>
          </FormField>
        )}
      </div>
    </div>
  );
}

function FunctionCard({
  fn,
  active,
  onClick,
}: {
  fn: LookupFunction;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[80px] flex-col items-start justify-between rounded-xl border bg-[var(--card)] p-3 text-left shadow-sm transition-all duration-200",
        active
          ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
          : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--foreground)]/20 hover:bg-[var(--secondary)] hover:shadow-md",
      )}
    >
      <span
        className={cn(
          "absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
          active
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-50 opacity-0",
        )}
      >
        <Check className="h-3 w-3" />
      </span>
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: fn.color || "#6b7280" }}
      />
      <span className="mt-2 pr-6 text-sm font-medium leading-snug text-[var(--foreground)]">
        {fn.label}
      </span>
    </button>
  );
}

// ─── Step 3 : Input (1 connecteur d'entrée) ────────────────────────────────

function InputStep({
  connectors,
  port,
  setPort,
  loading,
}: {
  connectors: LookupConnectorType[];
  port: AdapterPort;
  setPort: (p: AdapterPort) => void;
  loading: boolean;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Connecteur d'entrée"
        subtitle="Un adaptateur a un seul connecteur d'entrée. Choisissez le type et le genre."
      />
      <div className="mx-auto max-w-2xl space-y-4">
        <PortEditor
          connectors={connectors}
          port={port}
          onChange={setPort}
          loading={loading}
          labelPrefix="Entrée"
          required
          hideQuantity
        />
      </div>
    </div>
  );
}

// ─── Step 4 : Outputs (N connecteurs de sortie) ────────────────────────────

function OutputsStep({
  connectors,
  outputs,
  setOutputs,
  loading,
}: {
  connectors: LookupConnectorType[];
  outputs: AdapterPort[];
  setOutputs: (next: AdapterPort[]) => void;
  loading: boolean;
}) {
  const validCount = outputs.filter((p) => p.connectorTypeId).length;

  return (
    <div>
      <WizardStepHeader
        title="Connecteurs de sortie"
        subtitle={
          validCount === 0
            ? "Ajoutez au moins un groupe de connecteurs en sortie. Chaque carte = un type de connecteur avec sa quantité."
            : `${validCount} groupe${validCount > 1 ? "s" : ""} de connecteurs défini${validCount > 1 ? "s" : ""}. Vous pouvez en ajouter ou en retirer.`
        }
      />
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {outputs.map((p, i) => (
            <OutputPortEditor
              key={i}
              index={i}
              port={p}
              connectors={connectors}
              loading={loading}
              onChange={(v) =>
                setOutputs(outputs.map((x, j) => (j === i ? v : x)))
              }
              onRemove={
                outputs.length > 1
                  ? () => setOutputs(outputs.filter((_, j) => j !== i))
                  : undefined
              }
            />
          ))}
          <button
            type="button"
            onClick={() => setOutputs([...outputs, emptyPort()])}
            className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-4 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <Plus className="h-5 w-5" />
            Ajouter un groupe
          </button>
        </div>
      </div>
    </div>
  );
}

function OutputPortEditor({
  index,
  port,
  connectors,
  loading,
  onChange,
  onRemove,
}: {
  index: number;
  port: AdapterPort;
  connectors: LookupConnectorType[];
  loading: boolean;
  onChange: (p: AdapterPort) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase text-[var(--foreground)]">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--accent)]/15 font-mono text-[10px] text-[var(--accent)]">
            {index + 1}
          </span>
          Groupe
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
            title="Retirer ce groupe"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PortEditor
        connectors={connectors}
        port={port}
        onChange={onChange}
        loading={loading}
        labelPrefix={`Groupe ${index + 1}`}
        compact
      />
    </div>
  );
}

// ── PortEditor : sélection connecteur + genre + quantité + label ───────────

function PortEditor({
  connectors,
  port,
  onChange,
  loading,
  labelPrefix,
  required,
  compact = false,
  hideQuantity = false,
}: {
  connectors: LookupConnectorType[];
  port: AdapterPort;
  onChange: (p: AdapterPort) => void;
  loading: boolean;
  labelPrefix: string;
  required?: boolean;
  compact?: boolean;
  hideQuantity?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = connectors.find((c) => c.id === port.connectorTypeId) ?? null;

  return (
    <div className="space-y-3">
      <FormField
        label={
          required
            ? `${labelPrefix} — connecteur (obligatoire)`
            : `${labelPrefix} — connecteur`
        }
        hint={
          required && !port.connectorTypeId
            ? "Sélection obligatoire pour continuer."
            : undefined
        }
      >
        {loading ? (
          <div className="flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--muted-foreground)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Chargement…
          </div>
        ) : connectors.length === 0 ? (
          <div className="flex h-11 items-center rounded-lg border border-dashed border-[var(--border)] px-3 text-xs text-[var(--muted-foreground)]">
            Aucun type de connecteur disponible.
          </div>
        ) : (
          <>
            <ConnectorPickerTrigger
              connector={selected}
              placeholder="Sélectionner un connecteur"
              onClick={() => setPickerOpen(true)}
            />
            <ConnectorPickerModal
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              connectors={connectors}
              selectedId={port.connectorTypeId || null}
              onSelect={(id) => onChange({ ...port, connectorTypeId: id })}
            />
          </>
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Genre">
          <div className="grid grid-cols-3 gap-1.5">
            {GENDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...port, gender: opt.value })}
                className={cn(
                  "flex h-10 flex-col items-center justify-center rounded-lg border text-xs font-semibold transition-all",
                  port.gender === opt.value
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                )}
              >
                <span>{opt.label}</span>
                <span className="font-mono text-[9px] opacity-70">
                  {opt.short}
                </span>
              </button>
            ))}
          </div>
        </FormField>

        {!hideQuantity && (
          <FormField label={`Quantité (${port.quantity})`}>
            <RangeInput
              min={1}
              max={32}
              step={1}
              value={port.quantity}
              onChange={(v) => onChange({ ...port, quantity: v })}
              unit=""
              editable
            />
          </FormField>
        )}
      </div>

      <FormField label="Libellé (facultatif)">
        <Input
          className="h-9 text-xs"
          placeholder="Ex. IN, OUT1, RETURN…"
          value={port.label}
          onChange={(e) => onChange({ ...port, label: e.target.value })}
        />
      </FormField>
    </div>
  );
}

// ─── Step 5 : Image ─────────────────────────────────────────────────────────

function ImageStep({
  imageUrl,
  setImageUrl,
  onSkip,
}: {
  imageUrl: string;
  setImageUrl: (v: string) => void;
  onSkip: () => void;
}) {
  const [urlDraft, setUrlDraft] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [pendingCropSrc, setPendingCropSrc] = useState<string | null>(null);

  const handleDownloadFromUrl = async () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const data = await api.post<{ url: string }>("/api/upload/from-url", {
        url: trimmed,
        folder: "adapters",
      });
      if (data?.url) {
        setPendingCropSrc(data.url);
        setUrlDraft("");
      } else {
        setDownloadError("Réponse invalide du serveur.");
      }
    } catch (e) {
      setDownloadError(
        getApiErrorMessage(e, "Téléchargement impossible depuis cette URL."),
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <WizardStepHeader
        title="Photo de l'adaptateur"
        subtitle="Format 16:9 conseillé. Importez depuis votre disque ou collez l'URL d'une image. Facultatif."
      />
      <div className="mx-auto max-w-3xl">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <ImageCropUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="adapters"
              label="Fichier local"
              externalImageSrc={pendingCropSrc}
              onExternalCropResolved={() => setPendingCropSrc(null)}
              forceAspectRatio={16 / 9}
            />

            <div className="space-y-2 rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-3 shadow-sm">
              <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                Depuis une URL
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                  <Input
                    className="h-9 pl-8 text-xs"
                    placeholder="https://exemple.com/image.jpg"
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !downloading) {
                        e.preventDefault();
                        void handleDownloadFromUrl();
                      }
                    }}
                    disabled={downloading}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadFromUrl}
                  disabled={downloading || urlDraft.trim().length === 0}
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Télécharger
                </Button>
              </div>
              {downloadError && ( // arkyo-server: habillage Strata
                <p className="text-[11px] text-[var(--danger-text)]">{downloadError}</p>
              )}
            </div>
          </div>

          <div>
            <div className="overflow-hidden rounded-xl border border-[var(--border)]/60 bg-[var(--card)] shadow-sm">
              <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
                {imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={imageUrl}
                    alt="Aperçu"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--muted-foreground)]/50">
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-[10px] font-medium tracking-wider uppercase">
                      Aperçu 16:9
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-center pt-4">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            Passer cette étape
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 6 : Summary ───────────────────────────────────────────────────────

function genderLabel(g: Gender): string {
  return GENDER_OPTIONS.find((o) => o.value === g)?.label ?? g;
}

function portDescription(
  p: AdapterPort,
  connectors: LookupConnectorType[],
): string | null {
  if (!p.connectorTypeId) return null;
  const ct = connectors.find((c) => c.id === p.connectorTypeId);
  if (!ct) return null;
  const qty = p.quantity > 1 ? `${p.quantity}×` : "";
  const label = p.label.trim() ? ` (${p.label.trim()})` : "";
  return `${qty ? qty + " " : ""}${ct.name} · ${genderLabel(p.gender)}${label}`;
}

function SummaryStep({
  name,
  reference,
  fn,
  input,
  outputs,
  connectors,
  imageUrl,
  onEdit,
}: {
  name: string;
  reference: string;
  fn: LookupFunction | null;
  input: AdapterPort;
  outputs: AdapterPort[];
  connectors: LookupConnectorType[];
  imageUrl: string;
  onEdit: (id: StepId) => void;
}) {
  const inputDesc = portDescription(input, connectors);
  const validOutputs = outputs.filter((p) => p.connectorTypeId);

  return (
    <div className="mx-auto max-w-4xl">
      <WizardStepHeader
        title="Vérifiez et créez l'adaptateur"
        subtitle="Cliquez sur une ligne pour la modifier."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <SummaryGroup
            icon={<Plug className="h-3.5 w-3.5" />}
            title="Identité"
            color="#8b5cf6"
          >
            <SummaryRow
              label="Nom"
              value={name || null}
              onClick={() => onEdit("identity")}
            />
            <SummaryRow
              label="Référence"
              value={reference || null}
              onClick={() => onEdit("identity")}
            />
          </SummaryGroup>

          <SummaryGroup
            icon={<Wand2 className="h-3.5 w-3.5" />}
            title="Fonction"
            color="#3b82f6"
          >
            <SummaryRow
              label="Fonction"
              value={fn?.label ?? null}
              onClick={() => onEdit("function")}
            />
          </SummaryGroup>

          <SummaryGroup
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            title="Image"
            color="#a855f7"
          >
            <SummaryRow
              label="Photo"
              value={imageUrl ? "Définie" : null}
              onClick={() => onEdit("image")}
            />
          </SummaryGroup>
        </div>

        <div className="space-y-3">
          <SummaryGroup
            icon={<Plug className="h-3.5 w-3.5" />}
            title="Entrée"
            color="#10b981"
          >
            <SummaryRow
              label="Connecteur"
              value={inputDesc}
              onClick={() => onEdit("input")}
            />
          </SummaryGroup>

          <SummaryGroup
            icon={<Plug className="h-3.5 w-3.5" />}
            title={
              validOutputs.length > 0
                ? `Sorties (${validOutputs.length})`
                : "Sorties"
            }
            color="#06b6d4"
          >
            {validOutputs.length === 0 ? (
              <SummaryRow
                label="Aucune"
                value={null}
                onClick={() => onEdit("outputs")}
              />
            ) : (
              validOutputs.map((p, i) => (
                <SummaryRow
                  key={i}
                  label={`Sortie #${i + 1}`}
                  value={portDescription(p, connectors)}
                  onClick={() => onEdit("outputs")}
                />
              ))
            )}
          </SummaryGroup>
        </div>
      </div>
    </div>
  );
}

function SummaryGroup({
  icon,
  title,
  color,
  className,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  color: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-3 shadow-sm",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{ backgroundColor: `${color}14`, color }}
        >
          {icon}
        </span>
        <h4 className="text-[10px] font-semibold tracking-[0.12em] text-[var(--muted-foreground)] uppercase">
          {title}
        </h4>
      </div>
      <ul className="divide-y divide-[var(--border)]/40">{children}</ul>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | null;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 py-1.5 text-left transition-colors hover:bg-[var(--secondary)]/40"
      >
        <span className="w-28 shrink-0 text-[10px] font-medium tracking-wide text-[var(--muted-foreground)] uppercase">
          {label}
        </span>
        <span
          className={cn(
            "flex-1 truncate text-xs leading-snug",
            value
              ? "text-[var(--foreground)]"
              : "italic text-[var(--muted-foreground)]/60",
          )}
        >
          {value ?? "—"}
        </span>
      </button>
    </li>
  );
}

