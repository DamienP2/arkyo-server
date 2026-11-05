"use client";

/**
 * NewEquipmentWizard — wizard de création d'un équipement tenant depuis
 * `/admin/catalogue?tab=equipment`.
 *
 * Calqué sur `NewRackWizard` (components/racks/new-rack-wizard.tsx) :
 *  - Intro design + icône équipement (Package centré)
 *  - 3 mockups SVG flottants (face avant, connectique, symbole rack)
 *  - Bouton "Saisie rapide" pour utilisateurs avancés (skip wizard)
 *  - WizardBackdrop intense sur intro / discreet ailleurs
 *  - WizardStepHeader + ProgressBar partagés
 *  - Cards de sélection avec checkmark accent
 *  - Récap final groupé, lignes cliquables
 *
 * Steps :
 *   0.  INTRO          — accueil design + icône + CTA "Démarrer"
 *   1.  IDENTITY       — nom (requis), marque, référence (uppercase auto)
 *   2.  CLASSIFICATION — fonction (gros boutons) → type racine (petits boutons)
 *                        → sous-type (pills), en une seule étape
 *   3.  FUNCTIONS      — fonctions supplémentaires, phases, tags
 *   4.  FORMAT         — rackable Y/N (2 grosses cards)
 *   5.  DIMENSIONS     — dimensions physiques avec sliders (selon rackable)
 *   6.  WEIGHT         — poids avec slider
 *   7.  POWER          — puissance (slider 0-5000 W, éditable)
 *   8.  HEAT           — dissipation (slider 0-15000 BTU/h, éditable, calc auto depuis powerW)
 *   9.  OPTIONS        — toggles 2110 + lumière DMX (dual PSU retiré)
 *   10. IMAGE          — upload d'image 16:9, URL paste, recherche Google Images
 *   11. SUMMARY        — récap + 2 CTA : fermer / compléter la fiche
 *
 * API : POST /api/tenant/catalogue/equipment
 *   (route existante — schéma `equipmentWriteSchema` couvre tous nos champs).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  Cpu,
  Download,
  Flame,
  Layers,
  Lightbulb,
  Link as LinkIcon,
  Loader2,
  Network,
  Package,
  Server,
  Settings,
  Sparkles,
  Tag,
  Wand2,
  Weight,
  X,
  Zap,
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
import { RangeInput } from "@/components/wizard/range-input";
import {
  ProgressBar,
  WizardBackdrop,
  WizardKeyframes,
  WizardStepHeader,
} from "@/components/wizard/wizard-backdrop";
import { api, getApiErrorMessage } from "@/lib/api-client";
import {
  BrandPickerModal,
  BrandPickerTrigger,
} from "@/components/catalogue/brand-picker-modal";
import {
  InlineTypeCreator,
  PersonalTypeDot,
} from "@/components/catalogue/inline-type-creator";
import { KindChoice, WidthGlyph } from "@/components/equipment/format-block";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";
type Ip2110Mode = "OOB" | "IB";

type LookupBrand = { id: string; name: string };
type LookupFunction = {
  id: string;
  label: string;
  color: string;
  sortOrder?: number;
};
type LookupType = {
  id: string;
  name: string;
  functionId: string | null;
  /** null = type racine ; sinon id du type racine parent (Fonction › Type › Sous-type). */
  parentId: string | null;
  /** Origine du type : ARKYO (référentiel, lecture seule) ou PERSONAL (tenant). */
  source: "ARKYO" | "PERSONAL";
};

type LookupResponse = {
  brands?: LookupBrand[];
  functions?: LookupFunction[];
  types?: LookupType[];
};

/** Mode de fermeture du wizard une fois l'équipement créé. */
export type NewEquipmentCloseMode = "close" | "complete";

// ── Steps ───────────────────────────────────────────────────────────────────

type StepId =
  | "intro"
  | "identity"
  | "classification"
  | "functions"
  | "format"
  | "dimensions"
  | "weight"
  | "power"
  | "heat"
  | "options"
  | "image"
  | "summary";

type StepDef = { id: StepId; progressIndex: number };

const STEPS: StepDef[] = [
  { id: "intro", progressIndex: -1 },
  { id: "identity", progressIndex: 1 },
  // Classification unifiée : fonction (gros boutons) → type racine (petits
  // boutons) → sous-type (pills) en une seule étape.
  { id: "classification", progressIndex: 2 },
  { id: "functions", progressIndex: 3 },
  { id: "format", progressIndex: 4 },
  { id: "dimensions", progressIndex: 5 },
  { id: "weight", progressIndex: 6 },
  { id: "power", progressIndex: 7 },
  { id: "heat", progressIndex: 8 },
  { id: "options", progressIndex: 9 },
  { id: "image", progressIndex: 10 },
  { id: "summary", progressIndex: 11 },
];

const PROGRESS_TOTAL = 11;

// ── Widths ──────────────────────────────────────────────────────────────────

const WIDTH_FRACTIONS: { value: WidthFraction; label: string }[] = [
  { value: "FULL", label: '19"' },
  { value: "HALF", label: '½ · 19"' },
  { value: "THIRD", label: '⅓ · 19"' },
  { value: "QUARTER", label: '¼ · 19"' },
];

const IP_MODE_OPTIONS: { value: Ip2110Mode; label: string; description: string }[] = [
  {
    value: "OOB",
    label: "Out Of Band",
    description: "Management séparé du réseau media.",
  },
  {
    value: "IB",
    label: "In Band",
    description: "Management embarqué dans le réseau media.",
  },
];

// ── Component ───────────────────────────────────────────────────────────────

export function NewEquipmentWizard({
  open,
  onOpenChange,
  onCreated,
  onSkipWizard,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Callback appelé après création réussie. `mode` détermine quoi faire ensuite. */
  onCreated: (id: string, mode: NewEquipmentCloseMode) => void;
  /**
   * Optionnel : callback "Saisie rapide" — ouvre directement la fiche vide
   * sans passer par le wizard. Si non fourni, le bouton n'apparaît pas.
   */
  onSkipWizard?: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookups (chargés au mount du wizard)
  const [lookups, setLookups] = useState<LookupResponse | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // ── Champs ──────────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState<string | null>(null);

  // Classification cascade : fonction principale → type d'équipement
  const [primaryFunctionId, setPrimaryFunctionId] = useState<string | null>(
    null,
  );
  const [typeId, setTypeId] = useState<string | null>(null);

  const [functionIds, setFunctionIds] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  const [isRackable, setIsRackable] = useState(true);
  const [heightU, setHeightU] = useState<number>(1);
  const [depthMm, setDepthMm] = useState<number>(400);
  const [widthFraction, setWidthFraction] = useState<WidthFraction>("FULL");
  const [dimLmm, setDimLmm] = useState<number>(300);
  const [dimWmm, setDimWmm] = useState<number>(200);
  const [dimHmm, setDimHmm] = useState<number>(100);
  const [weight, setWeight] = useState<number>(0);

  const [powerW, setPowerW] = useState<number>(0);
  const [heatBtuH, setHeatBtuH] = useState<number>(0);
  const [is2110, setIs2110] = useState(false);
  const [ip2110Mode, setIp2110Mode] = useState<Ip2110Mode>("OOB");
  // Capacités OUT par essence ST 2110 — converties en `signalCapacities` au submit
  const [videoChannels2110, setVideoChannels2110] = useState<number>(0);
  const [audioChannels2110, setAudioChannels2110] = useState<number>(0);
  const [ancChannels2110, setAncChannels2110] = useState<number>(0);
  const [isLightingFixture, setIsLightingFixture] = useState(false);
  const [dmxChannelsDefault, setDmxChannelsDefault] = useState<number>(0);
  // Châssis modulaire (type Ross openGear). Hôte / composant mutuellement exclusifs.
  const [isComponentHost, setIsComponentHost] = useState(false);
  const [hostSlotCount, setHostSlotCount] = useState<number>(10);
  const [isComponent, setIsComponent] = useState(false);
  const [componentSlotSpan, setComponentSlotSpan] = useState<number>(1);

  const [imageUrl, setImageUrl] = useState<string>("");

  // Rejoue le GET du référentiel et met à jour `lookups`. Utilisé après une
  // création de type/sous-type à la volée pour que la nouvelle entrée apparaisse
  // dans les listes root/sub avant de la sélectionner.
  const refetchLookups = useCallback(async () => {
    const data = await api.get<LookupResponse>("/api/tenant/catalogue/lookup");
    setLookups(data);
    return data;
  }, []);

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
    setBrandId(null);
    setPrimaryFunctionId(null);
    setTypeId(null);
    setFunctionIds([]);
    setTags([]);
    setTagDraft("");
    setIsRackable(true);
    setHeightU(1);
    setDepthMm(400);
    setWidthFraction("FULL");
    setDimLmm(300);
    setDimWmm(200);
    setDimHmm(100);
    setWeight(0);
    setPowerW(0);
    setHeatBtuH(0);
    setIs2110(false);
    setIp2110Mode("OOB");
    setVideoChannels2110(0);
    setAudioChannels2110(0);
    setAncChannels2110(0);
    setIsLightingFixture(false);
    setDmxChannelsDefault(0);
    setIsComponentHost(false);
    setHostSlotCount(10);
    setIsComponent(false);
    setComponentSlotSpan(1);
    setImageUrl("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setTimeout(reset, 150);
    onOpenChange(next);
  };

  // Un composant s'insère dans un hôte : il n'a pas de dimensions rack propres.
  // On saute donc entièrement l'étape « dimensions » dans les deux sens.
  const isStepSkipped = (id: StepId) => id === "dimensions" && isComponent;

  const goNext = () => {
    if (isSummary) return; // les CTA finaux du summary sont en dehors du footer
    setStepIndex((i) => {
      let next = i + 1;
      while (next < STEPS.length - 1 && isStepSkipped(STEPS[next].id)) next++;
      return Math.min(next, STEPS.length - 1);
    });
  };

  const goPrev = () => {
    if (isIntro) return;
    setStepIndex((i) => {
      let prev = i - 1;
      while (prev > 0 && isStepSkipped(STEPS[prev].id)) prev--;
      return Math.max(0, prev);
    });
  };

  const jumpToStep = (id: StepId) => {
    const idx = STEPS.findIndex((s) => s.id === id);
    if (idx >= 0) setStepIndex(idx);
  };

  // ── Validation par étape ────────────────────────────────────────────────────

  /** Renvoie un message si l'étape est invalide, sinon null. */
  const validateStep = (id: StepId): string | null => {
    if (id === "identity") {
      if (name.trim().length === 0) return "Le nom / la référence est requis.";
    }
    if (id === "classification") {
      if (!primaryFunctionId) return "La fonction principale est requise.";
      const roots = (lookups?.types ?? []).filter(
        (t) => t.functionId === primaryFunctionId && t.parentId === null,
      );
      if (roots.length > 0 && !typeId) return "Le type est requis.";
    }
    if (id === "image") {
      if (!imageUrl) return "La photo est requise.";
    }
    if (id === "dimensions") {
      // Un composant n'a pas de dimensions rack propres : pas de contrainte.
      if (isComponent) return null;
      if (isRackable) {
        if (!heightU || heightU <= 0) return "Hauteur U manquante.";
        if (!depthMm || depthMm <= 0) return "Profondeur manquante.";
      } else {
        if (!dimLmm && !dimWmm && !dimHmm)
          return "Au moins une dimension doit être renseignée.";
      }
    }
    return null;
  };

  // ── Submission ──────────────────────────────────────────────────────────────

  const handleCreate = async (mode: NewEquipmentCloseMode) => {
    // Re-vérifie les étapes critiques avant submit
    const idErr = validateStep("identity");
    if (idErr) {
      setError(idErr);
      jumpToStep("identity");
      return;
    }
    const classErr = validateStep("classification");
    if (classErr) {
      setError(classErr);
      jumpToStep("classification");
      return;
    }
    const imgErr = validateStep("image");
    if (imgErr) {
      setError(imgErr);
      jumpToStep("image");
      return;
    }
    const dimErr = validateStep("dimensions");
    if (dimErr) {
      setError(dimErr);
      jumpToStep("dimensions");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        isRackable,
      };
      if (brandId) payload.brandId = brandId;
      if (typeId) payload.typeId = typeId;
      // La fonction principale est placée en tête de la liste des fonctions.
      const finalFunctionIds = primaryFunctionId
        ? [
            primaryFunctionId,
            ...functionIds.filter((id) => id !== primaryFunctionId),
          ]
        : functionIds;
      if (finalFunctionIds.length > 0) payload.functionIds = finalFunctionIds;
      if (tags.length > 0) payload.tags = tags;

      if (isRackable) {
        payload.heightU = heightU;
        payload.depthMm = depthMm;
        payload.widthFraction = widthFraction;
      } else {
        if (dimLmm > 0) payload.dimLmm = dimLmm;
        if (dimWmm > 0) payload.dimWmm = dimWmm;
        if (dimHmm > 0) payload.dimHmm = dimHmm;
      }
      // Poids et puissance sont requis — 0 est une valeur acceptée, donc
      // toujours transmis (même à 0), pas conditionnés.
      payload.weight = weight;
      payload.powerW = powerW;
      if (heatBtuH > 0) payload.heatBtuH = heatBtuH;
      if (is2110) {
        payload.is2110 = true;
        payload.ip2110Mode = ip2110Mode;
        // Composition des capacités OUT par essence (signalCapacities) —
        // les entrées à 0 sont omises (l'équipement n'émet pas cette essence).
        const caps: Array<{ signalName: string; out: number }> = [];
        if (videoChannels2110 > 0)
          caps.push({ signalName: "SMPTE 2110-20 (Vidéo)", out: videoChannels2110 });
        if (audioChannels2110 > 0)
          caps.push({ signalName: "SMPTE 2110-30 (Audio)", out: audioChannels2110 });
        if (ancChannels2110 > 0)
          caps.push({ signalName: "SMPTE 2110-40 (ANC)", out: ancChannels2110 });
        if (caps.length > 0) payload.signalCapacities = caps;
      }
      if (isLightingFixture) {
        payload.isLightingFixture = true;
        if (dmxChannelsDefault > 0)
          payload.dmxChannelsDefault = dmxChannelsDefault;
      }
      payload.isComponentHost = isComponentHost;
      payload.hostSlotCount = isComponentHost ? hostSlotCount : null;
      payload.isComponent = isComponent;
      payload.componentSlotSpan = isComponent ? componentSlotSpan : 1;
      if (imageUrl) payload.imageUrl = imageUrl;

      const created = await api.post<{ id: string }>(
        "/api/tenant/catalogue/equipment",
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
    if (currentStep.id === "identity") return name.trim().length === 0;
    if (currentStep.id === "classification") {
      if (!primaryFunctionId) return true;
      const roots = (lookups?.types ?? []).filter(
        (t) => t.functionId === primaryFunctionId && t.parentId === null,
      );
      if (roots.length > 0 && !typeId) return true;
    }
    if (currentStep.id === "image" && !imageUrl) return true;
    if (currentStep.id === "dimensions") {
      if (isComponent) return false;
      if (isRackable) return heightU <= 0 || depthMm <= 0;
      return dimLmm <= 0 && dimWmm <= 0 && dimHmm <= 0;
    }
    return false;
  })();

  // ── Lookup helpers / dérivés ────────────────────────────────────────────────
  const allFunctions = lookups?.functions ?? [];
  const allBrands = lookups?.brands ?? [];

  const typesForPrimaryFunction = useMemo<LookupType[]>(() => {
    const types = lookups?.types ?? [];
    if (!primaryFunctionId) return [];
    return types.filter((t) => t.functionId === primaryFunctionId);
  }, [lookups, primaryFunctionId]);

  // Reset typeId si la fonction principale le rend incohérent
  useEffect(() => {
    if (!typeId) return;
    const t = (lookups?.types ?? []).find((x) => x.id === typeId);
    if (!t) return;
    if (!primaryFunctionId || t.functionId !== primaryFunctionId) {
      setTypeId(null);
    }
  }, [primaryFunctionId, typeId, lookups]);

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
            brandId={brandId}
            setBrandId={setBrandId}
            brands={allBrands}
            loading={lookupLoading}
          />
        );
      case "classification":
        return (
          <ClassificationStep
            functions={allFunctions}
            primaryFunctionId={primaryFunctionId}
            setPrimaryFunctionId={(id) => {
              setPrimaryFunctionId(id);
              // reset type quand la fonction principale change
              setTypeId(null);
            }}
            types={typesForPrimaryFunction}
            typeId={typeId}
            setTypeId={setTypeId}
            loading={lookupLoading}
            refetchLookups={refetchLookups}
            onSkip={goNext}
          />
        );
      case "functions":
        return (
          <FunctionsStep
            functions={allFunctions}
            primaryFunctionId={primaryFunctionId}
            functionIds={functionIds}
            setFunctionIds={setFunctionIds}
            tags={tags}
            setTags={setTags}
            tagDraft={tagDraft}
            setTagDraft={setTagDraft}
            loading={lookupLoading}
            onSkip={goNext}
          />
        );
      case "format":
        return (
          <FormatStep
            isRackable={isRackable}
            setIsRackable={setIsRackable}
            isComponentHost={isComponentHost}
            setIsComponentHost={setIsComponentHost}
            hostSlotCount={hostSlotCount}
            setHostSlotCount={setHostSlotCount}
            isComponent={isComponent}
            setIsComponent={setIsComponent}
            componentSlotSpan={componentSlotSpan}
            setComponentSlotSpan={setComponentSlotSpan}
          />
        );
      case "dimensions":
        return (
          <DimensionsStep
            isRackable={isRackable}
            heightU={heightU}
            setHeightU={setHeightU}
            depthMm={depthMm}
            setDepthMm={setDepthMm}
            widthFraction={widthFraction}
            setWidthFraction={setWidthFraction}
            dimLmm={dimLmm}
            setDimLmm={setDimLmm}
            dimWmm={dimWmm}
            setDimWmm={setDimWmm}
            dimHmm={dimHmm}
            setDimHmm={setDimHmm}
          />
        );
      case "weight":
        return (
          <WeightStep weight={weight} setWeight={setWeight} onSkip={goNext} />
        );
      case "power":
        return (
          <PowerStep
            powerW={powerW}
            setPowerW={setPowerW}
            onSkip={goNext}
          />
        );
      case "heat":
        return (
          <HeatStep
            heatBtuH={heatBtuH}
            setHeatBtuH={setHeatBtuH}
            powerW={powerW}
            onSkip={goNext}
          />
        );
      case "options":
        return (
          <OptionsStep
            is2110={is2110}
            setIs2110={setIs2110}
            ip2110Mode={ip2110Mode}
            setIp2110Mode={setIp2110Mode}
            videoChannels2110={videoChannels2110}
            setVideoChannels2110={setVideoChannels2110}
            audioChannels2110={audioChannels2110}
            setAudioChannels2110={setAudioChannels2110}
            ancChannels2110={ancChannels2110}
            setAncChannels2110={setAncChannels2110}
            isLightingFixture={isLightingFixture}
            setIsLightingFixture={setIsLightingFixture}
            dmxChannelsDefault={dmxChannelsDefault}
            setDmxChannelsDefault={setDmxChannelsDefault}
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
            brand={allBrands.find((b) => b.id === brandId) ?? null}
            primaryFunction={
              allFunctions.find((f) => f.id === primaryFunctionId) ?? null
            }
            type={
              (lookups?.types ?? []).find((t) => t.id === typeId) ?? null
            }
            functions={allFunctions.filter(
              (f) =>
                functionIds.includes(f.id) && f.id !== primaryFunctionId,
            )}
            tags={tags}
            isRackable={isRackable}
            heightU={heightU}
            depthMm={depthMm}
            widthFraction={widthFraction}
            dimLmm={dimLmm}
            dimWmm={dimWmm}
            dimHmm={dimHmm}
            weight={weight}
            powerW={powerW}
            heatBtuH={heatBtuH}
            is2110={is2110}
            ip2110Mode={ip2110Mode}
            isLightingFixture={isLightingFixture}
            dmxChannelsDefault={dmxChannelsDefault}
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
        <DialogTitle className="sr-only">Nouvel équipement</DialogTitle>
        <DialogDescription className="sr-only">
          Wizard de création d&apos;un équipement personnel en plusieurs étapes.
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
        <div className="relative z-10 flex flex-1 items-center justify-center overflow-hidden px-8 py-8">
          <div className="w-full">{renderStepBody()}</div>
        </div>

        {(error || lookupError) && (
          <div className="relative z-10 mx-8 mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
            {error ?? lookupError}
          </div>
        )}

        {/* Footer (masqué sur intro et summary — summary a ses propres CTA) */}
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

        {/* Footer summary : Précédent + 2 CTA finaux */}
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
                variant="outline"
                onClick={() => handleCreate("close")}
                disabled={submitting}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Créer &amp; fermer
              </Button>
              <Button
                type="button"
                variant="accent"
                onClick={() => handleCreate("complete")}
                disabled={submitting}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Créer &amp; compléter la fiche
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Intro ─────────────────────────────────────────────────────────────────

/**
 * Icône "équipement broadcast" : Package centré, sobre. Remplace la
 * composition multi-icônes Package + Cable + Zap jugée trop chargée.
 */
function EquipmentIconStack() {
  return (
    <div className="relative flex h-14 w-14 items-center justify-center">
      <Package
        // arkyo-server: habillage Strata
        className="h-12 w-12 text-[var(--foreground)]"
        strokeWidth={1.5}
      />
    </div>
  );
}

/** 3 mini-mockups SVG broadcast-équipement, flottants en background. */
function EquipmentMockups() {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden
    >
      {/* Mockup FACE AVANT — haut-droite, rotation 6° */}
      <div
        className="absolute -right-4 top-10 hidden h-24 w-44 rounded-xl border border-white/40 bg-white/40 p-2.5 backdrop-blur-md dark:border-white/10 dark:bg-white/5 sm:block"
        style={{
          transform: "rotate(6deg)",
          animation: "mockup-float 7s ease-in-out infinite",
        }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
            Face avant
          </span>
          <div className="flex gap-0.5">
            <span className="h-1 w-1 rounded-full bg-emerald-500" />
            <span className="h-1 w-1 rounded-full bg-amber-500" />
          </div>
        </div>
        <svg
          viewBox="0 0 160 50"
          className="h-12 w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Châssis 1U */}
          <rect
            x="2"
            y="4"
            width="156"
            height="42"
            rx="4"
            fill="rgb(139 92 246 / 0.08)"
            stroke="rgb(139 92 246 / 0.4)"
            strokeWidth="1"
          />
          {/* Écran central */}
          <rect
            x="30"
            y="14"
            width="46"
            height="22"
            rx="2"
            fill="rgb(16 185 129 / 0.2)"
            stroke="rgb(16 185 129 / 0.6)"
            strokeWidth="1"
          />
          <line x1="34" y1="20" x2="60" y2="20" stroke="rgb(16 185 129 / 0.7)" strokeWidth="1" />
          <line x1="34" y1="24" x2="55" y2="24" stroke="rgb(16 185 129 / 0.5)" strokeWidth="1" />
          <line x1="34" y1="28" x2="65" y2="28" stroke="rgb(16 185 129 / 0.5)" strokeWidth="1" />
          {/* Boutons rotatifs */}
          <circle cx="90" cy="25" r="6" fill="rgb(59 130 246 / 0.15)" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1" />
          <circle cx="90" cy="25" r="1.5" fill="rgb(59 130 246 / 0.8)" />
          <circle cx="108" cy="25" r="6" fill="rgb(59 130 246 / 0.15)" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1" />
          <circle cx="108" cy="25" r="1.5" fill="rgb(59 130 246 / 0.8)" />
          {/* LEDs */}
          <circle cx="128" cy="18" r="1.5" fill="rgb(16 185 129 / 0.8)" />
          <circle cx="138" cy="18" r="1.5" fill="rgb(245 158 11 / 0.8)" />
          <circle cx="148" cy="18" r="1.5" fill="rgb(239 68 68 / 0.6)" />
          {/* Bouton power */}
          <rect x="124" y="28" width="26" height="6" rx="1.5" fill="rgb(139 92 246 / 0.2)" stroke="rgb(139 92 246 / 0.5)" strokeWidth="0.8" />
          {/* Poignée gauche */}
          <rect x="8" y="14" width="14" height="22" rx="1.5" fill="rgb(139 92 246 / 0.15)" stroke="rgb(139 92 246 / 0.4)" strokeWidth="0.8" />
        </svg>
      </div>

      {/* Mockup CONNECTIQUE — haut-gauche, rotation -9° */}
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
            Connectique
          </span>
          <Sparkles className="h-2.5 w-2.5 text-[var(--muted-foreground)]/60" />
        </div>
        <svg
          viewBox="0 0 130 70"
          className="h-16 w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Ligne 1 : BNC + BNC + XLR */}
          <circle cx="16" cy="16" r="7" fill="rgb(59 130 246 / 0.15)" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1" />
          <circle cx="16" cy="16" r="2" fill="rgb(59 130 246 / 0.8)" />
          <circle cx="42" cy="16" r="7" fill="rgb(59 130 246 / 0.15)" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1" />
          <circle cx="42" cy="16" r="2" fill="rgb(59 130 246 / 0.8)" />
          {/* XLR (rond avec 3 pins) */}
          <circle cx="70" cy="16" r="8" fill="rgb(139 92 246 / 0.15)" stroke="rgb(139 92 246 / 0.6)" strokeWidth="1" />
          <circle cx="67" cy="14" r="1" fill="rgb(139 92 246 / 0.8)" />
          <circle cx="73" cy="14" r="1" fill="rgb(139 92 246 / 0.8)" />
          <circle cx="70" cy="19" r="1" fill="rgb(139 92 246 / 0.8)" />
          {/* RJ45 (carré) */}
          <rect x="92" y="8" width="18" height="16" rx="1.5" fill="rgb(16 185 129 / 0.15)" stroke="rgb(16 185 129 / 0.6)" strokeWidth="1" />
          <line x1="95" y1="11" x2="107" y2="11" stroke="rgb(16 185 129 / 0.7)" strokeWidth="0.8" />
          <line x1="95" y1="14" x2="107" y2="14" stroke="rgb(16 185 129 / 0.7)" strokeWidth="0.8" />
          {/* Ligne 2 : labels */}
          <text x="16" y="38" fontSize="5" fill="rgb(59 130 246 / 0.8)" textAnchor="middle" fontFamily="monospace">BNC</text>
          <text x="42" y="38" fontSize="5" fill="rgb(59 130 246 / 0.8)" textAnchor="middle" fontFamily="monospace">BNC</text>
          <text x="70" y="38" fontSize="5" fill="rgb(139 92 246 / 0.8)" textAnchor="middle" fontFamily="monospace">XLR</text>
          <text x="101" y="38" fontSize="5" fill="rgb(16 185 129 / 0.8)" textAnchor="middle" fontFamily="monospace">RJ45</text>
          {/* Ligne 3 : USB-C + Power */}
          <rect x="10" y="46" width="20" height="8" rx="3" fill="rgb(168 85 247 / 0.15)" stroke="rgb(168 85 247 / 0.6)" strokeWidth="1" />
          <rect x="40" y="46" width="14" height="14" rx="2" fill="rgb(245 158 11 / 0.15)" stroke="rgb(245 158 11 / 0.6)" strokeWidth="1" />
          <text x="47" y="56" fontSize="5" fill="rgb(245 158 11 / 0.9)" textAnchor="middle" fontFamily="monospace">PWR</text>
        </svg>
      </div>

      {/* Mockup SYMBOLE RACK — bas-gauche, rotation -6° */}
      <div
        className="absolute bottom-4 left-12 hidden h-32 w-28 rounded-xl border border-white/40 bg-white/40 p-2 backdrop-blur-md dark:border-white/10 dark:bg-white/5 sm:block"
        style={{
          transform: "rotate(-6deg)",
          animation: "mockup-float 9s ease-in-out infinite",
          animationDelay: "2.4s",
        }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
            Rack 8U
          </span>
        </div>
        <svg
          viewBox="0 0 110 100"
          className="h-24 w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Châssis rack */}
          <rect
            x="6"
            y="2"
            width="98"
            height="96"
            rx="2"
            fill="rgb(0 0 0 / 0.04)"
            stroke="rgb(99 102 241 / 0.5)"
            strokeWidth="1"
          />
          {/* U gradués (8U) */}
          {Array.from({ length: 8 }).map((_, i) => {
            const y = 6 + i * 11.5;
            return (
              <g key={i}>
                {/* Numéro U */}
                <text
                  x="10"
                  y={y + 7}
                  fontSize="4"
                  fill="rgb(99 102 241 / 0.6)"
                  fontFamily="monospace"
                >
                  {8 - i}
                </text>
                {/* Ligne séparatrice */}
                <line
                  x1="18"
                  y1={y + 10}
                  x2="100"
                  y2={y + 10}
                  stroke="rgb(99 102 241 / 0.15)"
                  strokeWidth="0.5"
                  strokeDasharray="1 1"
                />
              </g>
            );
          })}
          {/* Équipement 2U violet (U8-U7) */}
          <rect x="20" y="6" width="80" height="20" rx="1.5" fill="rgb(139 92 246 / 0.18)" stroke="rgb(139 92 246 / 0.55)" strokeWidth="0.8" />
          <circle cx="30" cy="16" r="1.5" fill="rgb(139 92 246 / 0.7)" />
          <line x1="36" y1="14" x2="60" y2="14" stroke="rgb(139 92 246 / 0.5)" strokeWidth="0.8" />
          <line x1="36" y1="18" x2="55" y2="18" stroke="rgb(139 92 246 / 0.4)" strokeWidth="0.8" />
          {/* Équipement 1U bleu (U6) */}
          <rect x="20" y="29" width="80" height="9" rx="1" fill="rgb(59 130 246 / 0.18)" stroke="rgb(59 130 246 / 0.55)" strokeWidth="0.8" />
          <line x1="24" y1="33.5" x2="50" y2="33.5" stroke="rgb(59 130 246 / 0.5)" strokeWidth="0.6" />
          {/* Équipement 3U emerald (U5-U3) */}
          <rect x="20" y="41" width="80" height="31" rx="1.5" fill="rgb(16 185 129 / 0.18)" stroke="rgb(16 185 129 / 0.55)" strokeWidth="0.8" />
          {Array.from({ length: 4 }).map((_, i) => (
            <circle
              key={i}
              cx={28 + i * 18}
              cy="56"
              r="2"
              fill="rgb(16 185 129 / 0.5)"
              stroke="rgb(16 185 129 / 0.7)"
              strokeWidth="0.5"
            />
          ))}
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
      <EquipmentMockups />

      <div className="relative z-10 mx-auto flex h-full max-w-lg flex-col items-center justify-center px-8 py-16 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/60 px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/10">
          <Sparkles
            className="h-3 w-3"
            style={{ animation: "sparkle-twinkle 2s ease-in-out infinite" }}
          />
          Nouvel équipement
        </span>

        <div
          className="mt-10 flex h-20 w-20 items-center justify-center rounded-2xl shadow-sm"
          style={{
            background:
              "linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(59, 130, 246, 0.06) 50%, rgba(16, 185, 129, 0.08))",
          }}
        >
          <EquipmentIconStack />
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
            équipement
          </span>{" "}
          à votre catalogue
        </h3>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
          Quelques étapes guidées pour créer l&apos;équipement. Vous pourrez
          ensuite enrichir la fiche détaillée (connecteurs, photos, symboles)
          ou revenir plus tard.
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

/**
 * Capitalise la première lettre du premier mot uniquement.
 * Ne touche pas le reste de la chaîne ; renvoie "" si entrée vide.
 */
function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function IdentityStep({
  name,
  setName,
  brandId,
  setBrandId,
  brands,
  loading,
}: {
  name: string;
  setName: (v: string) => void;
  brandId: string | null;
  setBrandId: (v: string | null) => void;
  brands: LookupBrand[];
  loading: boolean;
}) {
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [checking, setChecking] = useState(false);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);

  useEffect(() => {
    const trimmedName = name.trim();
    const hasName = trimmedName.length >= 2;
    if (!hasName) {
      setDuplicates([]);
      setChecking(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      const params = new URLSearchParams();
      params.set("name", trimmedName);
      api
        .get<{ matches: DuplicateMatch[] }>(
          `/api/tenant/catalogue/equipment/check-duplicate?${params.toString()}`,
          { signal: controller.signal },
        )
        .then((data) => {
          if (controller.signal.aborted) return;
          setDuplicates(data?.matches ?? []);
        })
        .catch((e) => {
          // Une AbortError ne doit pas reset les duplicates
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
  }, [name]);

  const hasDuplicates = duplicates.length > 0;

  return (
    <div>
      <WizardStepHeader
        title="Identifions l'équipement"
        subtitle="Comment voulez-vous le nommer ? La marque est facultative."
      />
      <div
        className={cn(
          // Sans doublons : 1 colonne centrée, comme avant.
          // Avec doublons : 2 colonnes, champs à gauche + panneau "similaires" à droite,
          // pour profiter de la largeur du modal et éviter la troncature verticale.
          "mx-auto",
          hasDuplicates
            ? "grid max-w-4xl gap-6 md:grid-cols-2"
            : "max-w-lg space-y-5",
        )}
      >
        <div className="space-y-5">
          <FormField label="Nom / Référence" required>
            <Input
              autoFocus
              className="h-11 text-sm"
              placeholder="Ex. AMC-300"
              value={name}
              onChange={(e) => setName(capitalizeFirst(e.target.value))}
            />
          </FormField>

          <FormField label="Marque">
            {loading ? (
              <div className="flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--muted-foreground)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Chargement…
              </div>
            ) : (
              <BrandPickerTrigger
                brand={brands.find((b) => b.id === brandId) ?? null}
                onClick={() => setBrandPickerOpen(true)}
              />
            )}
          </FormField>
          <BrandPickerModal
            open={brandPickerOpen}
            onOpenChange={setBrandPickerOpen}
            brands={brands}
            selectedId={brandId}
            onSelect={setBrandId}
          />
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
    // On n'affiche rien si pas de match (le "checking" silencieux suffit)
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
            {matches.length} équipement{matches.length > 1 ? "s" : ""}{" "}
            similaire{matches.length > 1 ? "s" : ""} trouvé
            {matches.length > 1 ? "s" : ""} :
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {matches.map((m) => (
              <li key={`${m.source}-${m.id}`}>
                <a
                  href={`/admin/catalogue/equipment/${m.id}`}
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

// ─── Step 2 : Classification (fonction + type + sous-type) ─────────────────

/**
 * Classification unifiée en une seule étape (fusion fonction + type) :
 *  - Fonction (« classification ») en GROS boutons cards.
 *  - Type RACINE de la fonction choisie en PETITS boutons.
 *  - Sous-types du type racine choisi en PILLS (optionnel).
 *
 * `typeId` porte le type sélectionné le plus précis : sous-type s'il y en a un,
 * sinon type racine. Le type racine courant est dérivé de `typeId` (via
 * `parentId`), pas d'état séparé.
 */
function ClassificationStep({
  functions,
  primaryFunctionId,
  setPrimaryFunctionId,
  types,
  typeId,
  setTypeId,
  loading,
  refetchLookups,
  onSkip,
}: {
  functions: LookupFunction[];
  primaryFunctionId: string | null;
  setPrimaryFunctionId: (v: string | null) => void;
  types: LookupType[];
  typeId: string | null;
  setTypeId: (v: string | null) => void;
  loading: boolean;
  refetchLookups: () => Promise<LookupResponse>;
  onSkip: () => void;
}) {
  const selectedType = typeId ? types.find((t) => t.id === typeId) ?? null : null;
  // Type racine courant = le type sélectionné s'il est racine, sinon son parent.
  const selectedRootTypeId = selectedType
    ? selectedType.parentId ?? selectedType.id
    : null;

  const rootTypes = types.filter((t) => t.parentId === null);
  const subTypes = selectedRootTypeId
    ? types.filter((t) => t.parentId === selectedRootTypeId)
    : [];

  const pickRootType = (rootId: string) => {
    // Type obligatoire → pas de désélection ; reclique = reste sur ce type
    // racine (et abandonne un éventuel sous-type précédemment choisi).
    setTypeId(rootId);
  };

  const pickSubType = (subId: string) => {
    // Toggle : reclique sur le sous-type courant → retombe sur sa racine.
    setTypeId(typeId === subId ? selectedRootTypeId : subId);
  };

  // Création à la volée d'un type racine perso : POST puis refetch + sélection.
  const createRootType = async (name: string) => {
    if (!primaryFunctionId) return;
    const created = await api.post<{ id: string }>(
      "/api/tenant/parametres/categories/type",
      { name, functionId: primaryFunctionId, parentId: null },
    );
    await refetchLookups();
    if (created?.id) setTypeId(created.id);
  };

  // Création à la volée d'un sous-type perso sous le type racine courant
  // (racine Arkyo ou perso). functionId hérité côté serveur depuis le parent.
  const createSubType = async (name: string) => {
    if (!selectedRootTypeId) return;
    const created = await api.post<{ id: string }>(
      "/api/tenant/parametres/categories/type",
      { name, parentId: selectedRootTypeId },
    );
    await refetchLookups();
    if (created?.id) setTypeId(created.id);
  };

  return (
    <div>
      <WizardStepHeader
        title="Classification"
        subtitle="Choisissez la fonction principale, puis affinez avec un type et un sous-type. Vous pourrez ajouter d'autres fonctions à l'étape suivante."
      />
      <div className="mx-auto max-w-3xl space-y-4">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Chargement des référentiels…
          </div>
        ) : functions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted-foreground)]">
            Aucune fonction disponible. Vous pourrez classer cet équipement
            ultérieurement depuis sa fiche détaillée.
          </div>
        ) : (
          <>
            {/* Fonction (classification) — gros boutons, grille compacte
                responsive : tient sans scroll même avec ~14 fonctions. */}
            <FormField label="Fonction principale" required>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {functions.map((f) => {
                  const active = primaryFunctionId === f.id;
                  return (
                    <FunctionCard
                      key={f.id}
                      fn={f}
                      active={active}
                      onClick={() => setPrimaryFunctionId(active ? null : f.id)}
                    />
                  );
                })}
              </div>
            </FormField>

            {/* Type racine — petits boutons, obligatoire (pas de "Aucun").
                Le bouton dashed « Nouveau type » crée un type perso à la volée. */}
            {primaryFunctionId && (
              <FormField label="Type" required>
                <div className="flex flex-wrap gap-1.5">
                  {rootTypes.map((t) => (
                    <TypeButton
                      key={t.id}
                      label={t.name}
                      active={selectedRootTypeId === t.id}
                      personal={t.source === "PERSONAL"}
                      onClick={() => pickRootType(t.id)}
                    />
                  ))}
                  <InlineTypeCreator
                    label="Nouveau type"
                    placeholder="Nom du type"
                    onCreate={createRootType}
                  />
                </div>
              </FormField>
            )}

            {/* Sous-type — pills. Visible dès qu'un type racine est retenu
                (Arkyo ou perso) pour permettre la création d'un sous-type
                sous une racine Arkyo. "Aucun" présélectionné s'il existe des
                sous-types. */}
            {selectedRootTypeId && (
              <FormField label="Sous-type">
                <div className="flex flex-wrap gap-1.5">
                  {subTypes.length > 0 && (
                    <SubTypePill
                      label="Aucun"
                      active={!selectedType?.parentId}
                      onClick={() => setTypeId(selectedRootTypeId)}
                    />
                  )}
                  {subTypes.map((t) => (
                    <SubTypePill
                      key={t.id}
                      label={t.name}
                      active={typeId === t.id}
                      personal={t.source === "PERSONAL"}
                      onClick={() => pickSubType(t.id)}
                    />
                  ))}
                  <InlineTypeCreator
                    label="Nouveau sous-type"
                    placeholder="Nom du sous-type"
                    onCreate={createSubType}
                  />
                </div>
              </FormField>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Card fonction « gros bouton » — version compacte horizontale (pastille +
 * label + check) pour tenir ~14 fonctions sans scroll. Reste visuellement plus
 * imposant que les petits boutons Type et les pills Sous-type.
 */
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
        "group flex items-center gap-2 rounded-xl border bg-[var(--card)] px-3 py-2.5 text-left shadow-sm transition-all duration-200",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
          : "border-[var(--border)]/60 hover:border-[var(--foreground)]/20 hover:bg-[var(--secondary)] hover:shadow-md",
      )}
    >
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: fn.color || "#6b7280" }}
      />
      <span className="min-w-0 flex-1 truncate text-xs font-medium leading-snug text-[var(--foreground)]">
        {fn.label}
      </span>
      {active && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />}
    </button>
  );
}

/** Petit bouton « Type racine » (rounded-lg). */
function TypeButton({
  label,
  active,
  personal,
  onClick,
}: {
  label: string;
  active: boolean;
  personal?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--foreground)] ring-1 ring-[var(--accent)]/30"
          : "border-[var(--border)]/60 bg-[var(--card)] text-[var(--foreground)]/80 hover:border-[var(--foreground)]/20 hover:bg-[var(--secondary)]",
      )}
    >
      {personal && <PersonalTypeDot />}
      {label}
      {active && <Check className="h-3 w-3 text-[var(--accent)]" />}
    </button>
  );
}

/** Pill « Sous-type » (rounded-full, accent plein à l'état actif). */
function SubTypePill({
  label,
  active,
  personal,
  onClick,
}: {
  label: string;
  active: boolean;
  personal?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
          : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
      )}
    >
      {personal && <PersonalTypeDot />}
      {label}
      {active && <Check className="h-3 w-3" />}
    </button>
  );
}

// ─── Step 3 : Functions ─────────────────────────────────────────────────────

function FunctionsStep({
  functions,
  primaryFunctionId,
  functionIds,
  setFunctionIds,
  tags,
  setTags,
  tagDraft,
  setTagDraft,
  loading,
  onSkip,
}: {
  functions: LookupFunction[];
  primaryFunctionId: string | null;
  functionIds: string[];
  setFunctionIds: (v: string[]) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  tagDraft: string;
  setTagDraft: (v: string) => void;
  loading: boolean;
  onSkip: () => void;
}) {
  // La fonction principale n'apparaît pas dans cette étape (filtrée plus bas).
  const additionalFunctions = useMemo(
    () => functions.filter((f) => f.id !== primaryFunctionId),
    [functions, primaryFunctionId],
  );
  const toggleFn = (id: string) => {
    setFunctionIds(
      functionIds.includes(id)
        ? functionIds.filter((x) => x !== id)
        : [...functionIds, id],
    );
  };
  const addTag = () => {
    const t = tagDraft.trim();
    if (!t || tags.includes(t)) {
      setTagDraft("");
      return;
    }
    setTags([...tags, t]);
    setTagDraft("");
  };
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  return (
    <div>
      <WizardStepHeader
        title="Fonctions supplémentaires"
        subtitle="Cet équipement assure-t-il d'autres fonctions ? Ajoutez-les et taguez-le librement. Tout est facultatif."
      />
      <div className="mx-auto max-w-2xl space-y-5">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Chargement…
          </div>
        ) : (
          <>
            {additionalFunctions.length > 0 && (
              <FormField label="Fonctions supplémentaires">
                <div className="flex flex-wrap gap-1.5">
                  {additionalFunctions.map((f) => {
                    const active = functionIds.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleFn(f.id)}
                        aria-pressed={active}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all",
                          active
                            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                            : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                        )}
                      >
                        {f.color && (
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: f.color }}
                          />
                        )}
                        {f.label}
                        {active && <Check className="h-3 w-3" />}
                      </button>
                    );
                  })}
                </div>
              </FormField>
            )}

            <FormField label="Tags">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    className="h-9 flex-1 text-xs"
                    placeholder="Ajouter un tag…"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addTag}
                    disabled={tagDraft.trim().length === 0}
                  >
                    Ajouter
                  </Button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--secondary)]/40 px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)]"
                      >
                        <Tag className="h-2.5 w-2.5 opacity-60" />
                        {t}
                        <button
                          type="button"
                          onClick={() => removeTag(t)}
                          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                          aria-label={`Retirer ${t}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </FormField>
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

// ─── Step 4 : Format ────────────────────────────────────────────────────────

function FormatStep({
  isRackable,
  setIsRackable,
  isComponentHost,
  setIsComponentHost,
  hostSlotCount,
  setHostSlotCount,
  isComponent,
  setIsComponent,
  componentSlotSpan,
  setComponentSlotSpan,
}: {
  isRackable: boolean;
  setIsRackable: (v: boolean) => void;
  isComponentHost: boolean;
  setIsComponentHost: (v: boolean) => void;
  hostSlotCount: number;
  setHostSlotCount: (v: number) => void;
  isComponent: boolean;
  setIsComponent: (v: boolean) => void;
  componentSlotSpan: number;
  setComponentSlotSpan: (v: number) => void;
}) {
  // État modulaire dérivé : châssis OU composant (jamais les deux — l'API
  // renvoie 400 sinon). Aucun champ supplémentaire n'est introduit.
  const isModular = isComponentHost || isComponent;

  const toggleModular = () => {
    if (isModular) {
      setIsComponentHost(false);
      setIsComponent(false);
      setIsRackable(true);
    } else {
      // Activation → châssis par défaut.
      setIsComponentHost(true);
      setIsComponent(false);
    }
  };

  const selectChassis = () => {
    setIsComponentHost(true);
    setIsComponent(false);
    // Quitter « Composant » restaure le format par défaut.
    setIsRackable(true);
  };

  const selectComponent = () => {
    setIsComponent(true);
    setIsComponentHost(false);
    // Un composant s'insère dans un hôte : pas de format de baie propre.
    setIsRackable(false);
  };

  return (
    <div>
      <WizardStepHeader
        title="Format de l'équipement"
        subtitle="Équipement modulaire, format de baie…"
      />
      <div className="mx-auto max-w-lg space-y-3">
        {/* Toggle « Équipement modulaire » */}
        <ModularToggleRow checked={isModular} onChange={toggleModular} />

        {/* Châssis / Composant + slots */}
        {isModular && (
          <div className="space-y-3">
            <KindChoice
              compact
              value={isComponent ? "component" : "chassis"}
              onChange={(v) =>
                v === "chassis" ? selectChassis() : selectComponent()
              }
              options={[
                {
                  value: "chassis",
                  icon: Server,
                  label: "Châssis",
                  description: "Accueille des composants.",
                },
                {
                  value: "component",
                  icon: Cpu,
                  label: "Composant",
                  description: "S'insère dans un hôte.",
                },
              ]}
            />

            {isComponentHost && (
              <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-3">
                <RangeInput
                  min={1}
                  max={40}
                  step={1}
                  value={hostSlotCount}
                  onChange={setHostSlotCount}
                  label="Nombre de slots"
                  unit="slots"
                  editable
                  showBounds
                />
              </div>
            )}

            {isComponent && (
              <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-3">
                <RangeInput
                  min={1}
                  max={8}
                  step={1}
                  value={componentSlotSpan}
                  onChange={setComponentSlotSpan}
                  label="Slots occupés"
                  unit="slots"
                  editable
                  showBounds
                />
              </div>
            )}
          </div>
        )}

        {/* Rackable / Pose libre — masqué pour un composant (pose libre forcée). */}
        {!isComponent && (
          <KindChoice
            compact
            value={isRackable ? "rack" : "free"}
            onChange={(v) => setIsRackable(v === "rack")}
            options={[
              {
                value: "rack",
                icon: Layers,
                label: 'Rackable 19"',
                description: "Se monte en U sur baie 19″.",
              },
              {
                value: "free",
                icon: Package,
                label: "Pose libre",
                description: "Caisson, périphérique posé.",
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ── ModularToggleRow — interrupteur « Équipement modulaire » (wizard) ─────

function ModularToggleRow({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors",
        checked
          ? "border-[var(--accent)]/50 bg-[var(--accent)]/5"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
      )}
    >
      <span className="text-sm font-semibold text-[var(--foreground)]">
        Équipement modulaire
      </span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-[var(--accent)]" : "bg-[var(--border)]",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

// ─── Step 5 : Dimensions ────────────────────────────────────────────────────

function DimensionsStep({
  isRackable,
  heightU,
  setHeightU,
  depthMm,
  setDepthMm,
  widthFraction,
  setWidthFraction,
  dimLmm,
  setDimLmm,
  dimWmm,
  setDimWmm,
  dimHmm,
  setDimHmm,
}: {
  isRackable: boolean;
  heightU: number;
  setHeightU: (v: number) => void;
  depthMm: number;
  setDepthMm: (v: number) => void;
  widthFraction: WidthFraction;
  setWidthFraction: (v: WidthFraction) => void;
  dimLmm: number;
  setDimLmm: (v: number) => void;
  dimWmm: number;
  setDimWmm: (v: number) => void;
  dimHmm: number;
  setDimHmm: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Dimensions physiques"
        subtitle={
          isRackable
            ? "Hauteur U, profondeur et largeur dans la baie."
            : "Renseignez les mesures de l'équipement."
        }
      />
      <div className="mx-auto max-w-2xl space-y-5">
        {isRackable ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <RangeInput
                min={1}
                max={48}
                step={1}
                value={heightU}
                onChange={setHeightU}
                label="Hauteur"
                unit="U"
                editable
                showBounds
              />
              <RangeInput
                min={100}
                max={1200}
                step={10}
                value={depthMm}
                onChange={setDepthMm}
                label="Profondeur"
                unit="mm"
                editable
                showBounds
              />
            </div>
            <FormField label="Largeur dans la baie">
              <div className="grid grid-cols-4 gap-1.5">
                {WIDTH_FRACTIONS.map((wf) => (
                  <button
                    key={wf.value}
                    type="button"
                    onClick={() => setWidthFraction(wf.value)}
                    className={cn(
                      "flex h-16 flex-col items-center justify-center gap-1 rounded-lg border-2 px-1 text-[11px] font-bold transition-all",
                      widthFraction === wf.value
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    <WidthGlyph fraction={wf.value} />
                    <span>{wf.label}</span>
                  </button>
                ))}
              </div>
            </FormField>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <RangeInput
              min={50}
              max={2000}
              step={10}
              value={dimLmm}
              onChange={setDimLmm}
              label="Longueur"
              unit="mm"
              editable
              showBounds
            />
            <RangeInput
              min={50}
              max={2000}
              step={10}
              value={dimWmm}
              onChange={setDimWmm}
              label="Largeur"
              unit="mm"
              editable
              showBounds
            />
            <RangeInput
              min={50}
              max={2000}
              step={10}
              value={dimHmm}
              onChange={setDimHmm}
              label="Hauteur"
              unit="mm"
              editable
              showBounds
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 6 : Weight ────────────────────────────────────────────────────────

function WeightStep({
  weight,
  setWeight,
  onSkip,
}: {
  weight: number;
  setWeight: (v: number) => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Poids de l'équipement"
        subtitle="Utile pour le poids total des baies et la mobilité. Facultatif."
      />
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ backgroundColor: "#f59e0b14", color: "#f59e0b" }}
          >
            <Weight className="h-6 w-6" />
          </span>
        </div>
        <RangeInput
          min={0}
          max={200}
          step={0.5}
          value={weight}
          onChange={setWeight}
          label="Poids"
          required
          unit="kg"
          editable
          showBounds
        />
      </div>
    </div>
  );
}

// ─── Step 7 : Power ─────────────────────────────────────────────────────────

function PowerStep({
  powerW,
  setPowerW,
  onSkip,
}: {
  powerW: number;
  setPowerW: (v: number) => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Puissance électrique"
        subtitle="Puissance consommée en charge. Utile pour dimensionner les onduleurs et estimer la conso totale. Facultatif."
      />
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ backgroundColor: "#f59e0b14", color: "#f59e0b" }}
          >
            <Zap className="h-6 w-6" />
          </span>
        </div>
        <RangeInput
          min={0}
          max={5000}
          step={10}
          value={powerW}
          onChange={setPowerW}
          label="Puissance"
          required
          unit="W"
          editable
          showBounds
        />
      </div>
    </div>
  );
}

// ─── Step 8 : Heat ──────────────────────────────────────────────────────────

function HeatStep({
  heatBtuH,
  setHeatBtuH,
  powerW,
  onSkip,
}: {
  heatBtuH: number;
  setHeatBtuH: (v: number) => void;
  powerW: number;
  onSkip: () => void;
}) {
  // Conversion W → BTU/h : 1 W ≈ 3.412 BTU/h (Joule constant)
  const computedFromPower = powerW > 0 ? Math.round(powerW * 3.412) : null;

  // Auto-fill / recalcul depuis la puissance : à chaque visite du step ET
  // à chaque changement de powerW, on aligne heatBtuH sur la valeur estimée.
  // Reste éditable manuellement, mais sera ré-écrasé si la puissance change.
  useEffect(() => {
    if (computedFromPower !== null) {
      setHeatBtuH(computedFromPower);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [powerW]);

  return (
    <div>
      <WizardStepHeader
        title="Dissipation thermique"
        subtitle="Chaleur dégagée — sert au dimensionnement de la climatisation du local technique. Facultatif."
      />
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ backgroundColor: "#ef444414", color: "#ef4444" }}
          >
            <Flame className="h-6 w-6" />
          </span>
        </div>
        <RangeInput
          min={0}
          max={15000}
          step={100}
          value={heatBtuH}
          onChange={setHeatBtuH}
          label="Dissipation"
          unit="BTU/h"
          editable
          showBounds
        />
        {computedFromPower !== null ? (
          <p className="text-center text-[11px] leading-snug text-[var(--muted-foreground)]/80">
            Estimée depuis la puissance ({powerW} W × 3,412). Modifiable.
          </p>
        ) : heatBtuH === 0 ? (
          <p className="text-center text-[11px] italic text-[var(--muted-foreground)]/70">
            non définie
          </p>
        ) : null}
        <div className="flex justify-center pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            Passer cette étape
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 9 : Options ───────────────────────────────────────────────────────

function OptionsStep({
  is2110,
  setIs2110,
  ip2110Mode,
  setIp2110Mode,
  videoChannels2110,
  setVideoChannels2110,
  audioChannels2110,
  setAudioChannels2110,
  ancChannels2110,
  setAncChannels2110,
  isLightingFixture,
  setIsLightingFixture,
  dmxChannelsDefault,
  setDmxChannelsDefault,
  onSkip,
}: {
  is2110: boolean;
  setIs2110: (v: boolean) => void;
  ip2110Mode: Ip2110Mode;
  setIp2110Mode: (v: Ip2110Mode) => void;
  videoChannels2110: number;
  setVideoChannels2110: (v: number) => void;
  audioChannels2110: number;
  setAudioChannels2110: (v: number) => void;
  ancChannels2110: number;
  setAncChannels2110: (v: number) => void;
  isLightingFixture: boolean;
  setIsLightingFixture: (v: boolean) => void;
  dmxChannelsDefault: number;
  setDmxChannelsDefault: (v: number) => void;
  onSkip: () => void;
}) {
  // Type d'option : choix EXCLUSIF — un équipement est soit SMPTE 2110, soit
  // un appareil lumière DMX, soit aucun des deux. Pas cumulable.
  const optionType: "none" | "2110" | "lighting" = is2110
    ? "2110"
    : isLightingFixture
      ? "lighting"
      : "none";

  const selectOption = (next: "none" | "2110" | "lighting") => {
    setIs2110(next === "2110");
    setIsLightingFixture(next === "lighting");
  };

  return (
    <div>
      <WizardStepHeader
        title="Options techniques"
        subtitle="Capacités réseau IP ou lumière DMX. Choix unique."
      />
      <div className="mx-auto max-w-2xl space-y-5">
        {/* 3 boutons empilés en choix exclusif — « Aucune » sélectionné par défaut. */}
        <div className="flex flex-col gap-2">
          <OptionCard
            icon={Box}
            title="Aucune"
            description="Équipement standard, sans option"
            active={optionType === "none"}
            onClick={() => selectOption("none")}
          />
          <OptionCard
            icon={Network}
            title="SMPTE ST 2110"
            description="Flux IP vidéo / audio / ANC"
            active={optionType === "2110"}
            onClick={() => selectOption("2110")}
          />
          <OptionCard
            icon={Lightbulb}
            title="Appareil lumière"
            description="Pilotage DMX"
            active={optionType === "lighting"}
            onClick={() => selectOption("lighting")}
          />
        </div>

        {optionType === "2110" && (
          <div className="space-y-3 rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-4">
            <div className="grid grid-cols-2 gap-2">
              {IP_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setIp2110Mode(opt.value)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-xs transition-all",
                    ip2110Mode === opt.value
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                  )}
                >
                  <span className="font-semibold">{opt.label}</span>
                  <span className="text-[10px] leading-tight opacity-80">
                    {opt.description}
                  </span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Stream2110Field
                title="Vidéo"
                subtitle="2110-20"
                value={videoChannels2110}
                onChange={setVideoChannels2110}
              />
              <Stream2110Field
                title="Audio"
                subtitle="2110-30"
                value={audioChannels2110}
                onChange={setAudioChannels2110}
              />
              <Stream2110Field
                title="ANC"
                subtitle="2110-40"
                value={ancChannels2110}
                onChange={setAncChannels2110}
              />
            </div>
          </div>
        )}

        {optionType === "lighting" && (
          <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-4">
            <RangeInput
              min={1}
              max={512}
              step={1}
              value={dmxChannelsDefault > 0 ? dmxChannelsDefault : 1}
              onChange={setDmxChannelsDefault}
              label="Canaux DMX par défaut"
              unit=""
              editable
              showBounds
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Stream2110Field({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-3 py-2.5">
      <div className="text-center">
        <div className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          {title}
        </div>
        <div className="text-[9px] text-[var(--muted-foreground)]/70">
          {subtitle}
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={64}
          step={1}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isNaN(n)) return;
            onChange(Math.max(0, Math.min(64, Math.round(n))));
          }}
          className={cn(
            "mt-1.5 w-full border-0 bg-transparent text-center font-mono text-2xl font-semibold tabular-nums text-[var(--foreground)] outline-none",
            "focus:bg-[var(--background)]/40 focus:ring-0",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          )}
        />
        <div className="text-[9px] text-[var(--muted-foreground)]/60">flux</div>
      </div>
      <input
        type="range"
        min={0}
        max={64}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--secondary)] accent-[var(--accent)]"
      />
    </div>
  );
}

function OptionCard({
  icon: Icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: typeof Network;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-sm"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
          active
            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
            : "bg-[var(--secondary)] text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-[var(--foreground)]">{title}</div>
        <div className="text-[11px] text-[var(--muted-foreground)]">{description}</div>
      </div>
      {active && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  active,
  onChange,
}: {
  icon: typeof Zap;
  label: string;
  active: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-[var(--card)] px-4 py-3 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-[var(--border)] hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          active
            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
            : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm font-medium text-[var(--foreground)]">
        {label}
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          active ? "bg-[var(--accent)]" : "bg-[var(--border)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            active ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

// ─── Step 10 : Image ────────────────────────────────────────────────────────

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
  // Image téléchargée depuis URL, en attente de crop par l'utilisateur.
  // Le composant `ImageCropUpload` ouvre alors automatiquement son modal de
  // crop avec cette source — résultat aligné sur l'upload local.
  const [pendingCropSrc, setPendingCropSrc] = useState<string | null>(null);

  const handleDownloadFromUrl = async () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const data = await api.post<{ url: string }>("/api/upload/from-url", {
        url: trimmed,
        folder: "equipment",
      });
      if (data?.url) {
        // On NE met PAS imageUrl directement : on déclenche le crop modal
        // via `externalImageSrc`. Le commit final sera fait par ImageCropUpload
        // après crop & re-upload (qui appellera `onChange` → `setImageUrl`).
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
        title="Photo de l'équipement"
        subtitle="Format 16:9 conseillé. Importez depuis votre disque ou collez l'URL d'une image."
      />
      <div className="mx-auto max-w-sm">
        <div className="space-y-4">
          {/* L'aperçu de l'image s'affiche directement dans la drop zone de
              ImageCropUpload une fois l'image importée — pas d'aperçu séparé. */}
          <FormField label="Photo" required>
            <ImageCropUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="equipment"
              externalImageSrc={pendingCropSrc}
              onExternalCropResolved={() => setPendingCropSrc(null)}
              forceAspectRatio={16 / 9}
            />
          </FormField>

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
        </div>
      </div>
  );
}

// ─── Step 9 : Summary ───────────────────────────────────────────────────────

function SummaryStep({
  name,
  brand,
  primaryFunction,
  type,
  functions,
  tags,
  isRackable,
  heightU,
  depthMm,
  widthFraction,
  dimLmm,
  dimWmm,
  dimHmm,
  weight,
  powerW,
  heatBtuH,
  is2110,
  ip2110Mode,
  isLightingFixture,
  dmxChannelsDefault,
  imageUrl,
  onEdit,
}: {
  name: string;
  brand: LookupBrand | null;
  primaryFunction: LookupFunction | null;
  type: LookupType | null;
  functions: LookupFunction[];
  tags: string[];
  isRackable: boolean;
  heightU: number;
  depthMm: number;
  widthFraction: WidthFraction;
  dimLmm: number;
  dimWmm: number;
  dimHmm: number;
  weight: number;
  powerW: number;
  heatBtuH: number;
  is2110: boolean;
  ip2110Mode: Ip2110Mode;
  isLightingFixture: boolean;
  dmxChannelsDefault: number;
  imageUrl: string;
  onEdit: (id: StepId) => void;
}) {
  const dimensionsLabel = isRackable
    ? `${heightU}U · ${depthMm} mm · ${
        WIDTH_FRACTIONS.find((w) => w.value === widthFraction)?.label ?? widthFraction
      }`
    : [dimLmm, dimWmm, dimHmm]
        .map((v) => (v > 0 ? `${v}` : "—"))
        .join(" × ") + " mm";

  const functionsLabel =
    functions.length > 0
      ? functions.map((f) => f.label).join(", ")
      : null;
  const tagsLabel = tags.length > 0 ? tags.join(", ") : null;

  const optionsLines: string[] = [];
  if (is2110) optionsLines.push(`ST 2110 (${ip2110Mode})`);
  if (isLightingFixture)
    optionsLines.push(
      dmxChannelsDefault > 0
        ? `Lumière DMX · ${dmxChannelsDefault} ch.`
        : "Lumière DMX",
    );
  const optionsLabel = optionsLines.length > 0 ? optionsLines.join(" · ") : null;

  return (
    <div className="mx-auto max-w-4xl">
      <WizardStepHeader
        title="Vérifiez et créez l'équipement"
        subtitle="Cliquez sur une ligne pour la modifier."
      />

      {/* 2 colonnes verticales équilibrées — l'ordre vertical suit le parcours
          du wizard pour faciliter la relecture. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <SummaryGroup
            icon={<Cpu className="h-3.5 w-3.5" />}
            title="Identité"
            color="#8b5cf6"
          >
            <SummaryRow
              label="Nom / Référence"
              value={name || null}
              onClick={() => onEdit("identity")}
            />
            <SummaryRow
              label="Marque"
              value={brand?.name ?? null}
              onClick={() => onEdit("identity")}
            />
          </SummaryGroup>

          <SummaryGroup
            icon={<Layers className="h-3.5 w-3.5" />}
            title="Classification"
            color="#3b82f6"
          >
            <SummaryRow
              label="Fonction principale"
              value={primaryFunction?.label ?? null}
              onClick={() => onEdit("classification")}
            />
            <SummaryRow
              label="Type"
              value={type?.name ?? null}
              onClick={() => onEdit("classification")}
            />
          </SummaryGroup>

          <SummaryGroup
            icon={<Wand2 className="h-3.5 w-3.5" />}
            title="Métier"
            color="#10b981"
          >
            <SummaryRow
              label="Fonctions sup."
              value={functionsLabel}
              onClick={() => onEdit("functions")}
            />
            <SummaryRow
              label="Tags"
              value={tagsLabel}
              onClick={() => onEdit("functions")}
            />
          </SummaryGroup>
        </div>

        <div className="space-y-3">
          <SummaryGroup
            icon={<Box className="h-3.5 w-3.5" />}
            title="Format"
            color="#f59e0b"
          >
            <SummaryRow
              label="Format"
              value={isRackable ? 'Rackable 19"' : "Pose libre"}
              onClick={() => onEdit("format")}
            />
            <SummaryRow
              label="Dimensions"
              value={dimensionsLabel}
              onClick={() => onEdit("dimensions")}
            />
            <SummaryRow
              label="Poids"
              value={weight > 0 ? `${weight} kg` : null}
              onClick={() => onEdit("weight")}
            />
          </SummaryGroup>

          <SummaryGroup
            icon={<Settings className="h-3.5 w-3.5" />}
            title="Spécifications"
            color="#06b6d4"
          >
            <SummaryRow
              label="Puissance"
              value={powerW > 0 ? `${powerW} W` : null}
              onClick={() => onEdit("power")}
            />
            <SummaryRow
              label="Dissipation"
              value={heatBtuH > 0 ? `${heatBtuH} BTU/h` : null}
              onClick={() => onEdit("heat")}
            />
            <SummaryRow
              label="Options"
              value={optionsLabel}
              onClick={() => onEdit("options")}
            />
            <SummaryRow
              label="Image"
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

