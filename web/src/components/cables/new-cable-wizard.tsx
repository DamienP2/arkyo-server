"use client";

/**
 * NewCableWizard — wizard de création d'un cordon (TenantCable) depuis
 * `/admin/catalogue?tab=cables`.
 *
 * Calqué sur `NewEquipmentWizard` (components/equipment/new-equipment-wizard.tsx) :
 *  - Intro design + icône cordon (Cable centré) + 3 mockups SVG flottants
 *  - Bouton "Saisie rapide" pour utilisateurs avancés (skip wizard)
 *  - WizardBackdrop intense sur intro / discreet ailleurs
 *  - WizardStepHeader + ProgressBar partagés
 *  - Cards de sélection avec checkmark accent
 *  - Récap final 2 colonnes, lignes cliquables
 *
 * Particularités vs équipement :
 *  - PAS de marque ni modèle (champs `brandId` et `model` de TenantCable
 *    NON exposés — voir spec user).
 *  - Étape "Type de câblage" = choix d'un `CableModel` (Belden, Canare…)
 *    parmi ceux du lookup `cableModels`.
 *  - Connecteurs gauche/droite : type + radio genre (Mâle / Femelle / Neutre),
 *    pas de glyphes ♂♀ (cohérent avec mémoire utilisateur).
 *  - Use cases + longueurs : Prestation (longueurs catalogue chips) et/ou
 *    Installation (range mini-maxi via 2 sliders).
 *
 * Steps :
 *   0.  INTRO            — accueil design + icône + CTA "Démarrer"
 *   1.  IDENTITY         — nom (requis), référence (uppercase auto). Pas de marque.
 *   2.  FUNCTION         — fonction principale (Vidéo / Audio / Sync…)
 *   3.  CABLE-MODEL      — type de câblage (CableModel / TenantCableModel)
 *   4.  LEFT-CONNECTOR   — connecteur gauche + genre
 *   5.  RIGHT-CONNECTOR  — connecteur droit + genre (+ "Identique au gauche")
 *   6.  USE-CASES        — INSTALLATION et/ou PRESTATION
 *   7.  LENGTHS          — longueurs presta + range coupe installation
 *   8.  IMAGE            — upload 16:9 + URL paste
 *   9.  SUMMARY          — récap + 2 CTA : fermer / compléter la fiche
 *
 * API : POST /api/tenant/catalogue/cables
 *   (schéma `cableWriteSchema` étendu avec `cableModelId`).
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Cable,
  Check,
  Copy as CopyIcon,
  Download,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Plug,
  Plus,
  Ruler,
  Sparkles,
  Wand2,
  X,
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

type LookupCableModel = {
  id: string;
  name: string;
  reference: string | null;
  source: "ARKYO" | "PERSONAL";
  functionId: string | null;
  brandId: string | null;
  brandName: string | null;
  impedance: number | null;
  bandwidthMHz: number | null;
  diameterMm: number | null;
  conductor: string | null;
  shielding: string | null;
  jacketMaterial: string | null;
  fireRating: string | null;
  imageUrl: string | null;
};

type LookupResponse = {
  functions?: LookupFunction[];
  connectorTypes?: LookupConnectorType[];
  cableModels?: LookupCableModel[];
};

/** Mode de fermeture du wizard une fois le cordon créé. */
export type NewCableCloseMode = "close" | "complete";

// ── Steps ───────────────────────────────────────────────────────────────────

type StepId =
  | "intro"
  | "identity"
  | "function"
  | "cable-model"
  | "left-connector"
  | "right-connector"
  | "lengths"
  | "image"
  | "summary";

type StepDef = { id: StepId; progressIndex: number };

const STEPS: StepDef[] = [
  { id: "intro", progressIndex: -1 },
  { id: "identity", progressIndex: 1 },
  { id: "function", progressIndex: 2 },
  { id: "cable-model", progressIndex: 3 },
  { id: "left-connector", progressIndex: 4 },
  { id: "right-connector", progressIndex: 5 },
  { id: "lengths", progressIndex: 6 },
  { id: "image", progressIndex: 7 },
  { id: "summary", progressIndex: 8 },
];

const PROGRESS_TOTAL = 8;

const GENDER_OPTIONS: { value: Gender; label: string; short: string }[] = [
  { value: "MALE", label: "Mâle", short: "M" },
  { value: "FEMALE", label: "Femelle", short: "F" },
  { value: "NEUTRAL", label: "I/O", short: "I/O" },
];

// ── Component ───────────────────────────────────────────────────────────────

export function NewCableWizard({
  open,
  onOpenChange,
  onCreated,
  onSkipWizard,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Callback appelé après création réussie. `mode` détermine quoi faire ensuite. */
  onCreated: (id: string, mode: NewCableCloseMode) => void;
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
  const [cableModelId, setCableModelId] = useState<string | null>(null);

  const [leftConnectorId, setLeftConnectorId] = useState<string | null>(null);
  const [leftGender, setLeftGender] = useState<Gender>("NEUTRAL");
  const [rightConnectorId, setRightConnectorId] = useState<string | null>(null);
  const [rightGender, setRightGender] = useState<Gender>("NEUTRAL");

  const [availableLengths, setAvailableLengths] = useState<number[]>([]);
  const [customLengthDraft, setCustomLengthDraft] = useState<number>(5);
  const [lengthPresets, setLengthPresets] = useState<number[]>([]);

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

  // Fetch des longueurs prédéfinies (référentiel admin Longueurs câbles)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .get<{
        arkyo: Array<{ category: string; value: number }>;
        personal: Array<{ category: string; value: number }>;
      }>("/api/tenant/parametres/dimensions")
      .then((data) => {
        if (cancelled) return;
        const all = [...(data.arkyo ?? []), ...(data.personal ?? [])]
          .filter((p) => p.category === "CABLE_LENGTH" && p.value > 0)
          .map((p) => p.value);
        setLengthPresets(Array.from(new Set(all)).sort((a, b) => a - b));
      })
      .catch(() => {
        if (!cancelled) setLengthPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
    setCableModelId(null);
    setLeftConnectorId(null);
    setLeftGender("NEUTRAL");
    setRightConnectorId(null);
    setRightGender("NEUTRAL");
    setAvailableLengths([]);
    setCustomLengthDraft(5);
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
    if (id === "left-connector") {
      if (!leftConnectorId)
        return "Sélectionnez un connecteur pour l'extrémité gauche.";
    }
    if (id === "right-connector") {
      if (!rightConnectorId)
        return "Sélectionnez un connecteur pour l'extrémité droite.";
    }
    return null;
  };

  // ── Submission ──────────────────────────────────────────────────────────────
  const handleCreate = async (mode: NewCableCloseMode) => {
    const idErr = validateStep("identity");
    if (idErr) {
      setError(idErr);
      jumpToStep("identity");
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
      if (cableModelId) payload.cableModelId = cableModelId;
      if (leftConnectorId) {
        payload.leftConnectorId = leftConnectorId;
        payload.leftGender = leftGender;
      }
      if (rightConnectorId) {
        payload.rightConnectorId = rightConnectorId;
        payload.rightGender = rightGender;
      }
      if (availableLengths.length > 0) {
        payload.availableLengths = [...availableLengths].sort((a, b) => a - b);
      }
      if (imageUrl) payload.imageUrl = imageUrl;

      const created = await api.post<{ id: string }>(
        "/api/tenant/catalogue/cables",
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
    if (currentStep.id === "left-connector" && !leftConnectorId) return true;
    if (currentStep.id === "right-connector" && !rightConnectorId) return true;
    return false;
  })();

  // ── Lookup helpers / dérivés ────────────────────────────────────────────────
  const allFunctions = lookups?.functions ?? [];
  const allConnectors = lookups?.connectorTypes ?? [];
  const allCableModels = lookups?.cableModels ?? [];

  // Copie L → R
  const copyLeftToRight = () => {
    setRightConnectorId(leftConnectorId);
    setRightGender(leftGender);
  };

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
      case "cable-model":
        return (
          <CableModelStep
            cableModels={allCableModels}
            cableModelId={cableModelId}
            setCableModelId={setCableModelId}
            functionId={functionId}
            loading={lookupLoading}
            onSkip={goNext}
            onAdvance={() =>
              setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
            }
          />
        );
      case "left-connector":
        return (
          <ConnectorStep
            side="left"
            connectors={allConnectors}
            connectorId={leftConnectorId}
            setConnectorId={setLeftConnectorId}
            gender={leftGender}
            setGender={setLeftGender}
            loading={lookupLoading}
            required
          />
        );
      case "right-connector":
        return (
          <ConnectorStep
            side="right"
            connectors={allConnectors}
            connectorId={rightConnectorId}
            setConnectorId={setRightConnectorId}
            gender={rightGender}
            setGender={setRightGender}
            loading={lookupLoading}
            onCopyLeft={leftConnectorId ? copyLeftToRight : undefined}
            required
          />
        );
      case "lengths":
        return (
          <LengthsStep
            availableLengths={availableLengths}
            setAvailableLengths={setAvailableLengths}
            lengthPresets={lengthPresets}
            customLengthDraft={customLengthDraft}
            setCustomLengthDraft={setCustomLengthDraft}
            onSkip={goNext}
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
            cableModel={
              allCableModels.find((m) => m.id === cableModelId) ?? null
            }
            leftConnector={
              allConnectors.find((c) => c.id === leftConnectorId) ?? null
            }
            leftGender={leftGender}
            rightConnector={
              allConnectors.find((c) => c.id === rightConnectorId) ?? null
            }
            rightGender={rightGender}
            availableLengths={availableLengths}
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
        <DialogTitle className="sr-only">Nouveau cordon</DialogTitle>
        <DialogDescription className="sr-only">
          Wizard de création d&apos;un cordon personnel en plusieurs étapes.
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
          <div className="relative z-10 mx-8 mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
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

/** Icône cordon centrée — sobre, sans monogramme. */
function CableIconStack() {
  return (
    <div className="relative flex h-14 w-14 items-center justify-center">
      <Cable
        // arkyo-server: habillage Strata
        className="h-12 w-12 text-[var(--foreground)]"
        strokeWidth={1.5}
      />
    </div>
  );
}

/** 3 mini-mockups SVG broadcast-cordon, flottants en background. */
function CableMockups() {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden
    >
      {/* Mockup CÂBLE COURBÉ — haut-droite, rotation 6° */}
      <div
        className="absolute -right-4 top-10 hidden h-24 w-44 rounded-xl border border-white/40 bg-white/40 p-2.5 backdrop-blur-md dark:border-white/10 dark:bg-white/5 sm:block"
        style={{
          transform: "rotate(6deg)",
          animation: "mockup-float 7s ease-in-out infinite",
        }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
            Cordon SDI
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
          {/* Connecteur gauche (BNC) */}
          <circle cx="14" cy="25" r="9" fill="rgb(59 130 246 / 0.18)" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1.2" />
          <circle cx="14" cy="25" r="3" fill="rgb(59 130 246 / 0.85)" />
          <rect x="22" y="22" width="6" height="6" fill="rgb(59 130 246 / 0.45)" />
          {/* Câble courbé */}
          <path
            d="M28 25 C 60 8, 100 42, 132 25"
            fill="none"
            stroke="rgb(99 102 241 / 0.7)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* Connecteur droit (BNC) */}
          <rect x="132" y="22" width="6" height="6" fill="rgb(59 130 246 / 0.45)" />
          <circle cx="146" cy="25" r="9" fill="rgb(59 130 246 / 0.18)" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1.2" />
          <circle cx="146" cy="25" r="3" fill="rgb(59 130 246 / 0.85)" />
        </svg>
      </div>

      {/* Mockup CONNECTEURS XLR/RJ45 — haut-gauche, rotation -9° */}
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
            Extrémités
          </span>
          <Sparkles className="h-2.5 w-2.5 text-[var(--muted-foreground)]/60" />
        </div>
        <svg
          viewBox="0 0 130 70"
          className="h-16 w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* XLR (rond avec 3 pins) */}
          <circle cx="22" cy="18" r="10" fill="rgb(139 92 246 / 0.18)" stroke="rgb(139 92 246 / 0.65)" strokeWidth="1.2" />
          <circle cx="18" cy="15" r="1.3" fill="rgb(139 92 246 / 0.85)" />
          <circle cx="26" cy="15" r="1.3" fill="rgb(139 92 246 / 0.85)" />
          <circle cx="22" cy="22" r="1.3" fill="rgb(139 92 246 / 0.85)" />
          {/* Câble entre XLR et RJ45 */}
          <path
            d="M32 18 L 60 18 L 60 50 L 88 50"
            fill="none"
            stroke="rgb(99 102 241 / 0.6)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* RJ45 (carré) */}
          <rect x="88" y="42" width="22" height="18" rx="2" fill="rgb(16 185 129 / 0.18)" stroke="rgb(16 185 129 / 0.65)" strokeWidth="1.2" />
          <line x1="92" y1="46" x2="106" y2="46" stroke="rgb(16 185 129 / 0.7)" strokeWidth="0.8" />
          <line x1="92" y1="50" x2="106" y2="50" stroke="rgb(16 185 129 / 0.7)" strokeWidth="0.8" />
          <line x1="92" y1="54" x2="106" y2="54" stroke="rgb(16 185 129 / 0.7)" strokeWidth="0.8" />
          {/* Labels */}
          <text x="22" y="36" fontSize="5" fill="rgb(139 92 246 / 0.85)" textAnchor="middle" fontFamily="monospace">XLR M</text>
          <text x="99" y="36" fontSize="5" fill="rgb(16 185 129 / 0.85)" textAnchor="middle" fontFamily="monospace">RJ45</text>
        </svg>
      </div>

      {/* Mockup ÉTIQUETTE / LONGUEUR — bas-gauche, rotation -6° */}
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
            Étiquette
          </span>
        </div>
        <svg
          viewBox="0 0 110 100"
          className="h-24 w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Câble vertical */}
          <line x1="55" y1="0" x2="55" y2="100" stroke="rgb(99 102 241 / 0.5)" strokeWidth="3" strokeLinecap="round" />
          {/* Étiquette rectangulaire */}
          <rect x="14" y="32" width="82" height="36" rx="3" fill="rgb(245 158 11 / 0.18)" stroke="rgb(245 158 11 / 0.6)" strokeWidth="1.2" />
          {/* Lignes texte étiquette */}
          <text x="55" y="46" fontSize="7" fill="rgb(245 158 11 / 0.9)" textAnchor="middle" fontFamily="monospace" fontWeight="bold">CAM01-OUT1</text>
          <text x="55" y="56" fontSize="5" fill="rgb(245 158 11 / 0.7)" textAnchor="middle" fontFamily="monospace">VIDEO · 5 m</text>
          <text x="55" y="64" fontSize="5" fill="rgb(245 158 11 / 0.7)" textAnchor="middle" fontFamily="monospace">Belden 1694A</text>
          {/* Petits cercles décor (pinces) */}
          <circle cx="14" cy="50" r="2" fill="rgb(245 158 11 / 0.7)" />
          <circle cx="96" cy="50" r="2" fill="rgb(245 158 11 / 0.7)" />
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
      <CableMockups />

      <div className="relative z-10 mx-auto flex h-full max-w-lg flex-col items-center justify-center px-8 py-16 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/60 px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/10">
          <Sparkles
            className="h-3 w-3"
            style={{ animation: "sparkle-twinkle 2s ease-in-out infinite" }}
          />
          Nouveau cordon
        </span>

        <div
          className="mt-10 flex h-20 w-20 items-center justify-center rounded-2xl shadow-sm"
          style={{
            background:
              "linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(59, 130, 246, 0.06) 50%, rgba(16, 185, 129, 0.08))",
          }}
        >
          <CableIconStack />
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
            cordon
          </span>{" "}
          à votre catalogue
        </h3>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
          Quelques étapes guidées pour créer un cordon assemblé (extrémités,
          type de câblage, longueurs). Vous pourrez ensuite enrichir la fiche
          détaillée ou revenir plus tard.
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
          `/api/tenant/catalogue/cables/check-duplicate?${params.toString()}`,
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
        title="Identifions le cordon"
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
          <FormField label="Nom du cordon" required>
            <Input
              autoFocus
              className="h-11 text-sm"
              placeholder="Ex. Cordon SDI BNC ↔ BNC"
              value={name}
              onChange={(e) => setName(capitalizeFirst(e.target.value))}
            />
          </FormField>

          <FormField label="Référence">
            <Input
              className="h-11 text-sm uppercase"
              placeholder="Ex. SDI-BNC-5M"
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
            {matches.length} cordon{matches.length > 1 ? "s" : ""} similaire
            {matches.length > 1 ? "s" : ""} trouvé
            {matches.length > 1 ? "s" : ""} :
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {matches.map((m) => (
              <li key={`${m.source}-${m.id}`}>
                <a
                  href={`/admin/catalogue/cables/${m.id}`}
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
        title="Fonction du cordon"
        subtitle="À quelle chaîne signal ce cordon est-il destiné ? Cela aide à le retrouver et à proposer les bons types de câblage."
      />
      <div className="mx-auto max-w-2xl space-y-5">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Chargement des référentiels…
          </div>
        ) : functions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted-foreground)]">
            Aucune fonction disponible. Vous pourrez classer ce cordon plus
            tard depuis sa fiche détaillée.
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

// ─── Step 3 : Cable Model ───────────────────────────────────────────────────

function CableModelStep({
  cableModels,
  cableModelId,
  setCableModelId,
  functionId,
  loading,
  onSkip,
  onAdvance,
}: {
  cableModels: LookupCableModel[];
  cableModelId: string | null;
  setCableModelId: (v: string | null) => void;
  functionId: string | null;
  loading: boolean;
  onSkip: () => void;
  /** Auto-advance après sélection (laisse 200ms de feedback visuel). */
  onAdvance: () => void;
}) {
  const [query, setQuery] = useState("");

  // Filtre par fonction (compatible si même functionId ou si modèle sans fonction)
  // — on garde une logique permissive pour éviter de masquer trop d'items.
  const filteredByFunction = useMemo(() => {
    if (!functionId) return cableModels;
    const matching = cableModels.filter(
      (m) => m.functionId === null || m.functionId === functionId,
    );
    // Si aucun match strict, on retombe sur la liste complète
    return matching.length > 0 ? matching : cableModels;
  }, [cableModels, functionId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredByFunction;
    return filteredByFunction.filter((m) => {
      const hay = [
        m.name,
        m.reference ?? "",
        m.brandName ?? "",
        m.conductor ?? "",
        m.shielding ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filteredByFunction, query]);

  return (
    <div>
      <WizardStepHeader
        title="Type de câblage"
        subtitle="Sur quel câble physique est assemblé ce cordon ? (Belden 1694A, Canare L-4E6S…). Facultatif."
      />
      <div className="mx-auto max-w-3xl space-y-4">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Chargement…
          </div>
        ) : cableModels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted-foreground)]">
            Aucun modèle de câble disponible. Vous pouvez configurer votre
            catalogue de câblage depuis « Paramètres › Câblage ».
          </div>
        ) : (
          <>
            <Input
              className="h-9 text-xs"
              placeholder="Rechercher un modèle de câble…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="grid max-h-[340px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {filtered.map((m) => {
                const active = cableModelId === m.id;
                return (
                  <CableModelCard
                    key={m.id}
                    model={m}
                    active={active}
                    onClick={() => {
                      // Auto-advance au clic même si déjà sélectionné ;
                      // pour désélectionner, l'utilisateur revient et clic
                      // "Passer cette étape".
                      setCableModelId(m.id);
                      setTimeout(onAdvance, 200);
                    }}
                  />
                );
              })}
            </div>

            {filtered.length === 0 && (
              <p className="text-center text-[11px] italic text-[var(--muted-foreground)]/70">
                Aucun modèle ne correspond à votre recherche.
              </p>
            )}
          </>
        )}

        <div className="flex justify-center pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            Passer cette étape
          </Button>
        </div>
      </div>
    </div>
  );
}

function CableModelCard({
  model,
  active,
  onClick,
}: {
  model: LookupCableModel;
  active: boolean;
  onClick: () => void;
}) {
  // Specs courts à afficher (3 max pour rester compact)
  const specs: string[] = [];
  if (model.impedance != null) specs.push(`${model.impedance} Ω`);
  if (model.bandwidthMHz != null) specs.push(`${model.bandwidthMHz} MHz`);
  if (model.conductor) specs.push(model.conductor);
  if (specs.length === 0 && model.shielding) specs.push(model.shielding);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-start gap-1.5 rounded-xl border bg-[var(--card)] p-3 text-left shadow-sm transition-all duration-200",
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

      <div className="flex items-center gap-2">
        {/* arkyo-server: catalogue unique (tout est personnel) — badge de source « arkyo / personnel » retiré */}
        {model.brandName && (
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {model.brandName}
          </span>
        )}
      </div>

      <span className="pr-6 text-sm font-semibold leading-snug text-[var(--foreground)]">
        {model.name}
      </span>

      {model.reference && (
        <span className="font-mono text-[10px] text-[var(--muted-foreground)]/80">
          {model.reference}
        </span>
      )}

      {specs.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {specs.slice(0, 3).map((s, i) => (
            <span
              key={`${s}-${i}`}
              className="inline-flex items-center rounded-md bg-[var(--secondary)]/60 px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// ─── Step 4/5 : Connector (left / right) ───────────────────────────────────

function ConnectorStep({
  side,
  connectors,
  connectorId,
  setConnectorId,
  gender,
  setGender,
  loading,
  onCopyLeft,
  required,
}: {
  side: "left" | "right";
  connectors: LookupConnectorType[];
  connectorId: string | null;
  setConnectorId: (v: string | null) => void;
  gender: Gender;
  setGender: (v: Gender) => void;
  loading: boolean;
  onCopyLeft?: () => void;
  required?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedConnector = connectors.find((c) => c.id === connectorId) ?? null;

  const title =
    side === "left" ? "Connecteur gauche" : "Connecteur droit";
  const subtitle =
    side === "left"
      ? "Quelle est l'extrémité gauche de votre cordon ? Choisissez le type puis le genre."
      : "Quelle est l'extrémité droite ? Vous pouvez aussi recopier la gauche.";

  return (
    <div>
      <WizardStepHeader title={title} subtitle={subtitle} />
      <div className="mx-auto max-w-2xl space-y-4">
        {onCopyLeft && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCopyLeft}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              <CopyIcon className="h-3 w-3" />
              Identique au gauche
            </button>
          </div>
        )}

        <FormField
          label={required ? "Type de connecteur (obligatoire)" : "Type de connecteur"}
          hint={
            required && !connectorId
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
                connector={selectedConnector}
                placeholder="Sélectionner un connecteur"
                onClick={() => setPickerOpen(true)}
              />
              <ConnectorPickerModal
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                connectors={connectors}
                selectedId={connectorId}
                onSelect={(id) => setConnectorId(id)}
              />
            </>
          )}
        </FormField>

        <FormField label="Genre">
          <div className="grid grid-cols-3 gap-2">
            {GENDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setGender(opt.value)}
                className={cn(
                  "flex h-12 flex-col items-center justify-center rounded-lg border-2 px-3 text-xs font-semibold transition-all",
                  gender === opt.value
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                )}
              >
                <span>{opt.label}</span>
                <span className="font-mono text-[10px] opacity-70">
                  {opt.short}
                </span>
              </button>
            ))}
          </div>
        </FormField>
      </div>
    </div>
  );
}

// ─── Step : Lengths (longueurs disponibles) ──────────────────────────────

function LengthsStep({
  availableLengths,
  setAvailableLengths,
  lengthPresets,
  customLengthDraft,
  setCustomLengthDraft,
  onSkip,
}: {
  availableLengths: number[];
  setAvailableLengths: (v: number[]) => void;
  lengthPresets: number[];
  customLengthDraft: number;
  setCustomLengthDraft: (v: number) => void;
  onSkip: () => void;
}) {
  const togglePreset = (l: number) => {
    if (availableLengths.includes(l)) {
      setAvailableLengths(availableLengths.filter((x) => x !== l));
    } else {
      setAvailableLengths([...availableLengths, l].sort((a, b) => a - b));
    }
  };

  const customSelected = availableLengths
    .filter((v) => !lengthPresets.includes(v))
    .sort((a, b) => a - b);

  return (
    <div>
      <WizardStepHeader
        title="Longueurs disponibles"
        subtitle="Sélectionnez les longueurs proposées pour ce cordon. Vous pouvez aussi en ajouter une personnalisée."
      />
      <div className="mx-auto max-w-2xl space-y-5">
        {/* Chips presets du référentiel admin */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
            Prédéfinies — référentiel
          </p>
          {lengthPresets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {lengthPresets.map((l) => {
                const active = availableLengths.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => togglePreset(l)}
                    className={cn(
                      "inline-flex h-9 min-w-[3rem] items-center justify-center rounded-full border px-3 font-mono text-xs font-semibold tabular-nums transition-all",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    {l} m
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5 text-[11px] text-[var(--muted-foreground)]">
              Aucune longueur prédéfinie dans le référentiel admin (Paramètres › Longueurs câbles).
            </p>
          )}
        </div>

        {/* Custom : slider + bouton Ajouter */}
        <div className="space-y-3 rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-4">
          <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
            Ajouter une longueur personnalisée
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <RangeInput
                min={0.5}
                max={500}
                step={0.5}
                value={customLengthDraft}
                onChange={setCustomLengthDraft}
                unit="m"
                editable
                showBounds
              />
            </div>
            <Button
              type="button"
              variant="accent"
              onClick={() => {
                if (customLengthDraft <= 0) return;
                if (availableLengths.includes(customLengthDraft)) return;
                setAvailableLengths(
                  [...availableLengths, customLengthDraft].sort((a, b) => a - b),
                );
              }}
              disabled={
                customLengthDraft <= 0 ||
                availableLengths.includes(customLengthDraft)
              }
            >
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          </div>
        </div>

        {/* Longueurs custom déjà ajoutées */}
        {customSelected.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
              Personnalisées sélectionnées
            </p>
            <div className="flex flex-wrap gap-1.5">
              {customSelected.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1 font-mono text-xs font-semibold tabular-nums text-[var(--accent)]"
                >
                  {v} m
                  <button
                    type="button"
                    onClick={() =>
                      setAvailableLengths(
                        availableLengths.filter((x) => x !== v),
                      )
                    }
                    className="text-[var(--accent)]/70 transition-colors hover:text-[var(--accent)]"
                    aria-label={`Retirer ${v} m`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-center pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            Passer cette étape
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 8 : Image ─────────────────────────────────────────────────────────

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
        folder: "cables",
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
        title="Photo du cordon"
        subtitle="Format 16:9 conseillé. Importez depuis votre disque ou collez l'URL d'une image. Facultatif."
      />
      <div className="mx-auto max-w-3xl">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <ImageCropUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="cables"
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

// ─── Step 9 : Summary ───────────────────────────────────────────────────────

function genderLabel(g: Gender): string {
  return GENDER_OPTIONS.find((o) => o.value === g)?.label ?? g;
}

function SummaryStep({
  name,
  reference,
  fn,
  cableModel,
  leftConnector,
  leftGender,
  rightConnector,
  rightGender,
  availableLengths,
  imageUrl,
  onEdit,
}: {
  name: string;
  reference: string;
  fn: LookupFunction | null;
  cableModel: LookupCableModel | null;
  leftConnector: LookupConnectorType | null;
  leftGender: Gender;
  rightConnector: LookupConnectorType | null;
  rightGender: Gender;
  availableLengths: number[];
  imageUrl: string;
  onEdit: (id: StepId) => void;
}) {
  const leftLabel = leftConnector
    ? `${leftConnector.name} · ${genderLabel(leftGender)}`
    : null;
  const rightLabel = rightConnector
    ? `${rightConnector.name} · ${genderLabel(rightGender)}`
    : null;
  const extremitiesLabel =
    leftLabel || rightLabel
      ? `${leftLabel ?? "—"}   ↔   ${rightLabel ?? "—"}`
      : null;

  const lengthsLabel =
    availableLengths.length > 0
      ? [...availableLengths]
          .sort((a, b) => a - b)
          .map((l) => `${l} m`)
          .join(" · ")
      : null;

  return (
    <div className="mx-auto max-w-4xl">
      <WizardStepHeader
        title="Vérifiez et créez le cordon"
        subtitle="Cliquez sur une ligne pour la modifier."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <SummaryGroup
            icon={<Cable className="h-3.5 w-3.5" />}
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
            <SummaryRow
              label="Type de câblage"
              value={
                cableModel
                  ? cableModel.brandName
                    ? `${cableModel.brandName} · ${cableModel.name}`
                    : cableModel.name
                  : null
              }
              onClick={() => onEdit("cable-model")}
            />
          </SummaryGroup>

          <SummaryGroup
            icon={<Plug className="h-3.5 w-3.5" />}
            title="Extrémités"
            color="#10b981"
          >
            <SummaryRow
              label="Gauche"
              value={leftLabel}
              onClick={() => onEdit("left-connector")}
            />
            <SummaryRow
              label="Droite"
              value={rightLabel}
              onClick={() => onEdit("right-connector")}
            />
            <SummaryRow
              label="Cordon"
              value={extremitiesLabel}
              onClick={() => onEdit("left-connector")}
            />
          </SummaryGroup>
        </div>

        <div className="space-y-3">
          <SummaryGroup
            icon={<Ruler className="h-3.5 w-3.5" />}
            title="Longueurs disponibles"
            color="#06b6d4"
          >
            <SummaryRow
              label={
                availableLengths.length > 0
                  ? `${availableLengths.length} longueur${availableLengths.length > 1 ? "s" : ""}`
                  : "Longueurs"
              }
              value={lengthsLabel}
              onClick={() => onEdit("lengths")}
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
