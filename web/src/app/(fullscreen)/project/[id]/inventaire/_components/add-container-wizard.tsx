"use client";

/**
 * AddContainerWizard — wizard d'ajout d'un contenant dans un projet.
 *
 * Calque le pattern du `NewProjectDialog` (intro design + stepper + steps
 * granulaires + backdrop décoratif). 2 paths conditionnels après le choix
 * du mode :
 *
 *   Path A — Template :
 *     0. INTRO          — accueil design + mini-mockups baie/flight/pelicase
 *     1. MODE           — template vs nouveau (2 cards GRANDES)
 *     2. LOCATION       — emplacement (requis) + création inline
 *     3. TEMPLATE       — sélection du template (auto-soumission au clic)
 *
 *   Path B — Nouveau (étapes dynamiques selon rackType / isRackable) :
 *     0. INTRO
 *     1. MODE
 *     2. TYPE           — STANDARD / FLIGHT_CASE_* / PELICAN / CAP (cards)
 *     3. NAME           — input
 *     4. LOCATION       — emplacement (requis) + création inline
 *     5. RACKABLE       — toggle (pré-coché selon RACK_TYPE_RACKABLE)
 *     6. DIMENSIONS     — U + profondeur OU L/l/P selon rackable
 *     7. WHEELS         — toggle (conditionnel : visible si flight)
 *     8. WEIGHT         — slider poids à vide
 *     9. RAILS          — toggle + slider gap + schéma (conditionnel : visible si rackable)
 *    10. SUMMARY        — récap groupé, lignes cliquables → édition
 *
 * Skipping conditionnel : la liste de steps est recalculée via `useMemo` en
 * fonction de `rackType` et `isRackable`. Les étapes non applicables (wheels
 * non-flight, rails non-rackable) sont exclues du tableau ; aucun saut
 * dynamique nécessaire dans goNext/goPrev.
 *
 * APIs réutilisées telles quelles :
 *   - POST /api/tenant/projects/{projectId}/racks
 *       body { racks: [{ name, locationId, rackType, isRackable, depthMm, totalU | widthMm+heightMm, hasWheels?, emptyWeightKg?, rearInteriorGapMm? }] }
 *   - POST /api/tenant/projects/{projectId}/racks/clone-from-template
 *       body { rackTemplateId, locationId }
 *   - POST /api/tenant/projects/{projectId}/locations (création inline d'un lieu)
 *
 * Décisions de design :
 *   - Étape "Mode" : auto-advance 200ms après click sur une card (cohérent
 *     avec le NewProjectDialog).
 *   - Étape "Template" : auto-advance immédiat sur click (soumission directe
 *     via clone-from-template, sans bouton "Continuer"). Step est masqué dans
 *     la progress bar — sa progression est traitée comme finale.
 *   - Étape "Rackable" : on l'affiche systématiquement pour permettre l'override
 *     (utile pour STANDARD/FLIGHT_CASE qu'on voudrait basculer en non-rackable,
 *     bien que ce soit rare — la valeur par défaut suit RACK_TYPE_RACKABLE).
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  LayoutTemplate,
  Loader2,
  MapPin,
  Package,
  Plus,
  Server,
  Sparkles,
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
import {
  ProgressBar,
  WizardBackdrop,
  WizardKeyframes,
  WizardStepHeader,
} from "@/components/wizard/wizard-backdrop";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { TemplateSelector } from "./template-selector";
import { useInventaireScope } from "./inventaire-scope";
import type { InventaireLocation, InventaireRack } from "../inventaire-client";

// ── Types ────────────────────────────────────────────────────────────────────

type RackType =
  | "STANDARD"
  | "FLIGHT_CASE_CLASSIC"
  | "FLIGHT_CASE_SKB"
  | "PELICAN"
  | "CAP";
type Mode = "template" | "new";

const RACK_TYPE_LABEL: Record<RackType, string> = {
  STANDARD: 'Baie standard 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

const RACK_TYPE_COLOR: Record<RackType, string> = {
  STANDARD: "#3b82f6",
  FLIGHT_CASE_CLASSIC: "#f59e0b",
  FLIGHT_CASE_SKB: "#f59e0b",
  PELICAN: "#06b6d4",
  CAP: "#a855f7",
};

const RACK_TYPE_IMAGE: Record<RackType, string> = {
  STANDARD: "/containers/baie.png",
  FLIGHT_CASE_CLASSIC: "/containers/flightcase_rack-roulettes.png",
  FLIGHT_CASE_SKB: "/containers/SKB.png",
  PELICAN: "/containers/pelicase.png",
  CAP: "/containers/casquette_meuble.png",
};

const RACK_TYPE_RACKABLE: Record<RackType, boolean> = {
  STANDARD: true,
  FLIGHT_CASE_CLASSIC: true,
  FLIGHT_CASE_SKB: true,
  PELICAN: false,
  CAP: false,
};

const RACK_TYPE_FLIGHT: Record<RackType, boolean> = {
  STANDARD: false,
  FLIGHT_CASE_CLASSIC: true,
  FLIGHT_CASE_SKB: true,
  PELICAN: true,
  CAP: false,
};

const RACK_TYPE_ORDER: RackType[] = [
  "STANDARD",
  "FLIGHT_CASE_CLASSIC",
  "FLIGHT_CASE_SKB",
  "PELICAN",
  "CAP",
];

const U_PRESETS = [6, 9, 12, 18, 24, 30, 36, 42, 45, 48];

// ── Step definitions ─────────────────────────────────────────────────────────

type StepId =
  | "intro"
  | "mode"
  | "template"
  | "location"
  | "type"
  | "name"
  | "rackable"
  | "totalU"
  | "width"
  | "height"
  | "depth"
  | "wheels"
  | "weight"
  | "rails"
  | "summary";

type StepDef = {
  id: StepId;
  /** Index affiché dans la progress bar. -1 = masquée. */
  progressIndex: number;
};

/**
 * Construit dynamiquement les étapes du path "Nouveau" en fonction du type et
 * du caractère rackable. Les étapes inapplicables (wheels si non-flight,
 * rails si non-rackable) sont simplement exclues du tableau — pas de saut
 * conditionnel à gérer dans goNext/goPrev.
 */
function buildNewSteps(flight: boolean, isRackable: boolean): StepDef[] {
  const steps: StepDef[] = [
    { id: "intro", progressIndex: -1 },
    { id: "mode", progressIndex: 0 },
    { id: "type", progressIndex: 0 },
    { id: "name", progressIndex: 0 },
    // Emplacement obligatoire — l'API refuse la création sans `locationId`.
    { id: "location", progressIndex: 0 },
    { id: "rackable", progressIndex: 0 },
  ];
  // Dimensions — une étape par valeur. Le pattern visuel par étape est
  // calqué sur WeightStep (carré centré avec valeur grosse + slider).
  if (isRackable) {
    steps.push({ id: "totalU", progressIndex: 0 });
    steps.push({ id: "depth", progressIndex: 0 });
  } else {
    steps.push({ id: "width", progressIndex: 0 });
    steps.push({ id: "height", progressIndex: 0 });
    steps.push({ id: "depth", progressIndex: 0 });
  }
  if (flight) steps.push({ id: "wheels", progressIndex: 0 });
  steps.push({ id: "weight", progressIndex: 0 });
  if (isRackable) steps.push({ id: "rails", progressIndex: 0 });
  steps.push({ id: "summary", progressIndex: 0 });

  // Renumérote les progressIndex : intro reste à -1, le reste démarre à 1.
  let counter = 1;
  for (const s of steps) {
    if (s.id === "intro") continue;
    s.progressIndex = counter++;
  }
  return steps;
}

/** Steps pour le path "Template" — l'emplacement précède le choix du modèle
 *  (la sélection d'un template soumet immédiatement le clonage). */
const TEMPLATE_STEPS: StepDef[] = [
  { id: "intro", progressIndex: -1 },
  { id: "mode", progressIndex: 1 },
  { id: "location", progressIndex: 2 },
  { id: "template", progressIndex: 3 },
];

const TEMPLATE_PROGRESS_TOTAL = 3;

// ── Component ────────────────────────────────────────────────────────────────

export function AddContainerWizard({
  open,
  onOpenChange,
  projectId,
  onCreated,
  existingNames,
  defaultLocationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  onCreated: (rack: InventaireRack) => void;
  /** Emplacement pré-sélectionné (celui de la fiche courante). */
  defaultLocationId?: string | null;
  /**
   * Noms de contenants déjà utilisés dans le projet — pour validation
   * d'unicité à l'étape 3 (insensible à la casse / espaces de bord).
   */
  existingNames?: string[];
}) {
  const { locations, createLocation } = useInventaireScope();
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<Mode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Emplacement cible du contenant (requis par l'API).
  const [locationId, setLocationId] = useState<string | null>(null);
  // Charge la liste des templates au mount du dialog (ouvert seulement) pour
  // savoir si le mode "template" doit être désactivé et indiquer "aucun
  // template" sur la card. `null` = loading, `number` = compte connu.
  const [templatesCount, setTemplatesCount] = useState<number | null>(null);

  // ── Form "Nouveau" — state local. ────────────────────────────────────────
  const [rackType, setRackType] = useState<RackType>("STANDARD");
  const [name, setName] = useState("");
  const [isRackable, setIsRackable] = useState(true);
  const [totalU, setTotalU] = useState(9);
  const [depthMm, setDepthMm] = useState(800);
  const [widthMm, setWidthMm] = useState(600);
  const [heightMm, setHeightMm] = useState(400);
  const [hasWheels, setHasWheels] = useState(false);
  const [emptyWeightKg, setEmptyWeightKg] = useState(0);
  const [hasRearInterior, setHasRearInterior] = useState(false);
  const [rearGap, setRearGap] = useState(50);

  const flight = RACK_TYPE_FLIGHT[rackType];

  // Set normalisé (lowercase + trim) des noms de contenants déjà utilisés
  // dans le projet — pour validation d'unicité à l'étape 3. L'API garde son
  // helper `ensureUniqueRackName` côté serveur en garde-fou.
  const takenNames = useMemo(() => {
    const out = new Set<string>();
    for (const n of existingNames ?? []) {
      const k = n.trim().toLowerCase();
      if (k) out.add(k);
    }
    return out;
  }, [existingNames]);
  const isNameTaken = (raw: string) => takenNames.has(raw.trim().toLowerCase());
  const nameDuplicate =
    name.trim().length > 0 && isNameTaken(name);

  // Steps actifs : recalculés dynamiquement selon rackType / isRackable pour
  // le path "Nouveau" (skipping via exclusion).
  const newSteps = useMemo(
    () => buildNewSteps(flight, isRackable),
    [flight, isRackable],
  );
  const steps: StepDef[] =
    mode === "template"
      ? TEMPLATE_STEPS
      : mode === "new"
        ? newSteps
        : [
            { id: "intro", progressIndex: -1 },
            { id: "mode", progressIndex: 1 },
          ];
  const progressTotal =
    mode === "template"
      ? TEMPLATE_PROGRESS_TOTAL
      : // Total = nombre d'étapes - 1 (intro masqué).
        newSteps.length - 1;
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)] ?? steps[0];
  const isIntro = currentStep.id === "intro";
  const isSummary = currentStep.id === "summary";

  // ── Reset ────────────────────────────────────────────────────────────────
  const reset = () => {
    setStepIndex(0);
    setMode(null);
    setLocationId(null);
    setRackType("STANDARD");
    setName("");
    setIsRackable(true);
    setTotalU(9);
    setDepthMm(800);
    setWidthMm(600);
    setHeightMm(400);
    setHasWheels(false);
    setEmptyWeightKg(0);
    setHasRearInterior(false);
    setRearGap(50);
    setError(null);
    setSubmitting(false);
    setTemplatesCount(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTimeout(reset, 150);
    }
    onOpenChange(next);
  };

  // Pré-charge le nombre de templates dispo dès l'ouverture du wizard. Sans
  // ça, l'utilisateur voit le bouton "Choisir un template" actif puis tombe
  // sur un message vide à l'étape suivante. Le fetch n'est lancé qu'une fois
  // par session ouverte (reset sur close).
  useEffect(() => {
    if (!open) return;
    if (templatesCount !== null) return;
    let cancelled = false;
    (async () => {
      try {
        type Resp =
          | { racks: Array<{ id: string }> }
          | Array<{ id: string }>;
        const res = await api.get<Resp>("/api/tenant/racks?templates=true");
        if (cancelled) return;
        const list = Array.isArray(res) ? res : res.racks;
        setTemplatesCount(list.length);
      } catch {
        if (cancelled) return;
        // En cas d'échec on traite comme "aucun" — l'utilisateur reste sur la
        // voie "Nouveau" plutôt que d'arriver à une étape Template cassée.
        setTemplatesCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, templatesCount]);

  // Pré-sélection : l'emplacement de la fiche courante, sinon l'unique
  // emplacement du projet. L'étape reste visible (on peut en choisir un autre
  // ou en créer un).
  useEffect(() => {
    if (!open) return;
    if (locationId !== null) return;
    if (defaultLocationId && locations.some((l) => l.id === defaultLocationId)) {
      setLocationId(defaultLocationId);
      return;
    }
    if (locations.length === 1) setLocationId(locations[0].id);
  }, [open, locations, locationId, defaultLocationId]);

  // Auto-sélection du mode "new" quand aucun template n'existe : la card est
  // pré-mise en évidence visuellement, le state doit suivre pour que le bouton
  // "Continuer" en bas ne reste pas désactivé.
  useEffect(() => {
    if (templatesCount === 0 && mode === null) {
      setMode("new");
    }
  }, [templatesCount, mode]);

  // ── Navigation ───────────────────────────────────────────────────────────

  const goNext = () => {
    if (isSummary) {
      void handleSubmitNew();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const goPrev = () => {
    if (isIntro) return;
    // Cas spécial : depuis "mode" → retour à intro et reset du mode
    if (currentStep.id === "mode") {
      setStepIndex(0);
      return;
    }
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const jumpToStep = (id: StepId) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx >= 0) setStepIndex(idx);
  };

  const handlePickMode = (m: Mode) => {
    setMode(m);
    setError(null);
    // L'index 1 reste "mode" dans les 2 paths — on avance d'un cran.
    setTimeout(() => setStepIndex(2), 200);
  };

  const handlePickType = (t: RackType) => {
    setRackType(t);
    // Met à jour le rackable par défaut selon le type choisi.
    setIsRackable(RACK_TYPE_RACKABLE[t]);
    if (!RACK_TYPE_FLIGHT[t]) setHasWheels(false);
    setTimeout(() => goNext(), 200);
  };

  const handlePickRackable = (next: boolean) => {
    setIsRackable(next);
    setTimeout(() => goNext(), 200);
  };

  // ── Soumissions ──────────────────────────────────────────────────────────

  const handleSubmitNew = async () => {
    if (name.trim().length === 0) {
      setError("Nom requis");
      jumpToStep("name");
      return;
    }
    if (!locationId) {
      setError("Emplacement requis");
      jumpToStep("location");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      type CreatedResp = {
        rigConfigId: string;
        racks: Array<{ id: string; name: string; rackType: RackType }>;
      };
      const payload = {
        name: name.trim(),
        locationId,
        rackType,
        isRackable,
        depthMm,
        ...(isRackable ? { totalU } : { totalU: 1, widthMm, heightMm }),
        ...(flight ? { hasWheels } : {}),
        ...(emptyWeightKg > 0 ? { emptyWeightKg } : {}),
        ...(isRackable && hasRearInterior
          ? { rearInteriorGapMm: rearGap }
          : {}),
      };
      const res = await api.post<CreatedResp>(
        `/api/tenant/projects/${projectId}/racks`,
        { racks: [payload] },
      );
      const created = res.racks[0];
      if (created) {
        onCreated({
          id: created.id,
          rigConfigId: res.rigConfigId,
          name: created.name,
          rackType: created.rackType,
          totalU: isRackable ? totalU : 1,
          depthMm,
          widthMm: isRackable ? null : widthMm,
          heightMm: isRackable ? null : heightMm,
          hasWheels: flight ? hasWheels : false,
          emptyWeightKg: emptyWeightKg > 0 ? emptyWeightKg : null,
          slotsCount: 0,
          constructionChecks: 0,
          isRackable,
          hasConnectors: false,
          canvasX: null,
          canvasY: null,
          locationId,
          isVirtual: false,
          slots: [],
          bom: [],
        });
      }
      reset();
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectTemplate = async (rackTemplateId: string) => {
    if (!locationId) {
      setError("Emplacement requis");
      jumpToStep("location");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<{ rack: InventaireRack }>(
        `/api/tenant/projects/${projectId}/racks/clone-from-template`,
        { rackTemplateId, locationId },
      );
      onCreated({
        ...res.rack,
        slots: res.rack.slots ?? [],
        bom: res.rack.bom ?? [],
        emptyWeightKg: res.rack.emptyWeightKg ?? null,
        hasConnectors: res.rack.hasConnectors ?? false,
        locationId: res.rack.locationId ?? locationId,
        isVirtual: false,
      });
      reset();
    } catch (e) {
      setError(getApiErrorMessage(e));
      setSubmitting(false);
    }
  };

  // ── Continue disabled ────────────────────────────────────────────────────

  const continueDisabled =
    submitting ||
    (currentStep.id === "name" &&
      (name.trim().length === 0 || nameDuplicate)) ||
    (currentStep.id === "location" && locationId === null) ||
    (currentStep.id === "mode" && mode === null);

  // ── Rendu d'étape ────────────────────────────────────────────────────────

  const renderStepBody = () => {
    switch (currentStep.id) {
      case "intro":
        return <IntroStep onStart={() => setStepIndex(1)} />;
      case "mode":
        return (
          <ModeStep
            current={mode}
            onSelect={handlePickMode}
            templatesCount={templatesCount}
          />
        );
      case "template":
        return (
          <TemplateStep
            onSelect={handleSelectTemplate}
            disabled={submitting}
          />
        );
      case "location":
        return (
          <LocationStep
            locations={locations}
            current={locationId}
            onSelect={(id) => {
              setLocationId(id);
              setTimeout(() => goNext(), 200);
            }}
            onCreate={createLocation}
          />
        );
      case "type":
        return <TypeStep current={rackType} onSelect={handlePickType} />;
      case "name":
        return (
          <NameStep
            rackType={rackType}
            value={name}
            onChange={setName}
            duplicate={nameDuplicate}
          />
        );
      case "rackable":
        return (
          <RackableStep
            current={isRackable}
            onSelect={handlePickRackable}
          />
        );
      case "totalU":
        return <TotalUStep value={totalU} onChange={setTotalU} />;
      case "depth":
        return (
          <DepthStep value={depthMm} onChange={setDepthMm} isRackable={isRackable} />
        );
      case "width":
        return <WidthStep value={widthMm} onChange={setWidthMm} />;
      case "height":
        return <HeightStep value={heightMm} onChange={setHeightMm} />;
      case "wheels":
        return (
          <WheelsStep
            hasWheels={hasWheels}
            setHasWheels={setHasWheels}
          />
        );
      case "weight":
        return (
          <WeightStep
            emptyWeightKg={emptyWeightKg}
            setEmptyWeightKg={setEmptyWeightKg}
          />
        );
      case "rails":
        return (
          <RailsStep
            hasRearInterior={hasRearInterior}
            setHasRearInterior={setHasRearInterior}
            rearGap={rearGap}
            setRearGap={setRearGap}
          />
        );
      case "summary":
        return (
          <SummaryStep
            rackType={rackType}
            name={name}
            locationName={
              locations.find((l) => l.id === locationId)?.name ?? null
            }
            isRackable={isRackable}
            totalU={totalU}
            depthMm={depthMm}
            widthMm={widthMm}
            heightMm={heightMm}
            hasWheels={hasWheels}
            flight={flight}
            emptyWeightKg={emptyWeightKg}
            hasRearInterior={hasRearInterior}
            rearGap={rearGap}
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
        <DialogTitle className="sr-only">Ajouter un contenant</DialogTitle>
        <DialogDescription className="sr-only">
          Wizard d&apos;ajout d&apos;un contenant en plusieurs étapes.
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
          <div className="relative z-10 mx-8 mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Footer (masqué sur intro et sur template — soumission auto au clic) */}
        {!isIntro && currentStep.id !== "template" && (
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
                {isSummary ? "Ajouter le contenant" : "Continuer"}
                {!isSummary && !submitting && (
                  <ArrowRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Footer minimal pour l'étape template (juste un retour) */}
        {currentStep.id === "template" && (
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
            <p className="flex flex-1 justify-end text-xs text-[var(--muted-foreground)]">
              {submitting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Clonage…
                </span>
              ) : (
                "Sélectionnez un template ci-dessus"
              )}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── 0. Intro ───────────────────────────────────────────────────────────────

/**
 * IntroStep — volet d'accueil avec 4 mini-mockups (baie / flight / pelicase /
 * rack-front) répartis dans les coins, inclinés et désaturés pour rester en
 * arrière-plan. Le contenu central (badge + titre + sous-texte + bouton +
 * mention) reste centré et libre de toute collision (zone max-w-lg).
 */
function IntroStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative -mx-8 -my-8 overflow-hidden rounded-2xl">
      {/* Keyframe locale plus subtile (translateY 6px au lieu de 8). On
          conserve la rotation via `--rot`. */}
      <style>{`
        @keyframes mockup-float-subtle {
          0%, 100% { transform: translateY(0) rotate(var(--rot, 0deg)); }
          50% { transform: translateY(-6px) rotate(var(--rot, 0deg)); }
        }
      `}</style>
      {/* Mockups dans les 4 coins — opacity réduite pour rester en arrière-plan */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70 dark:opacity-60"
        aria-hidden
      >
        {/* Mockup BAIE 19" — haut-gauche, rotation -12° */}
        <IntroMockup
          className="absolute -left-4 top-4"
          rotate="-12deg"
          delay="0s"
          duration="6s"
          accent="blue"
          label='Baie 19"'
        >
          <BaieMockup />
        </IntroMockup>

        {/* Mockup FLIGHT CASE — haut-droite, rotation +9° */}
        <IntroMockup
          className="absolute -right-4 top-6"
          rotate="9deg"
          delay="1s"
          duration="7s"
          accent="amber"
          label="Flight case"
        >
          <FlightCaseMockup />
        </IntroMockup>

        {/* Mockup PELICASE — bas-gauche, rotation -6° */}
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

        {/* Mockup RACK FRONT — bas-droite, rotation +12° */}
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

      {/* Contenu central */}
      <div className="relative z-10 mx-auto flex h-full max-w-lg flex-col items-center justify-center px-8 py-16 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/60 px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/10">
          <Sparkles
            className="h-3 w-3"
            style={{ animation: "sparkle-twinkle 2s ease-in-out infinite" }}
          />
          Nouveau contenant
        </span>

        <h3 className="mt-10 text-3xl leading-tight font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
          Ajoutons un contenant à{" "}
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
            votre projet
          </span>
        </h3>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
          Choisissez un template existant ou créez un rack adapté à votre
          intervention.
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
      </div>
    </div>
  );
}

// ─── Mini-mockups intro ─────────────────────────────────────────────────────

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

/**
 * IntroMockup — wrapper carte 120×140 avec rotation, animation float et label
 * monogramme. Couleur subtile selon l'accent. Caché en dessous de sm pour ne
 * pas écraser le contenu central sur mobile.
 */
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
        // `--rot` est consommé par la keyframe `mockup-float-subtle` pour
        // conserver la rotation pendant l'animation translateY (6px).
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

/** Mini schéma baie 19" verticale (slots U colorés empilés). */
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

/** Mini schéma flight case (rectangle horizontal + poignée + 4 roulettes). */
function FlightCaseMockup() {
  return (
    <svg
      viewBox="0 0 100 110"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Poignée du haut */}
      <rect
        x="38"
        y="6"
        width="24"
        height="5"
        rx="1.5"
        fill="rgb(120 53 15 / 0.4)"
      />
      <rect
        x="42"
        y="8"
        width="16"
        height="2"
        rx="1"
        fill="rgb(120 53 15 / 0.6)"
      />
      {/* Corps principal */}
      <rect
        x="10"
        y="16"
        width="80"
        height="70"
        rx="3"
        fill="rgb(245 158 11 / 0.12)"
        stroke="rgb(245 158 11 / 0.45)"
        strokeWidth="1.2"
      />
      {/* Séparation couvercle */}
      <line
        x1="10"
        y1="34"
        x2="90"
        y2="34"
        stroke="rgb(245 158 11 / 0.35)"
        strokeWidth="0.8"
      />
      {/* Coins renforcés */}
      <circle cx="16" cy="22" r="1.8" fill="rgb(120 53 15 / 0.5)" />
      <circle cx="84" cy="22" r="1.8" fill="rgb(120 53 15 / 0.5)" />
      <circle cx="16" cy="80" r="1.8" fill="rgb(120 53 15 / 0.5)" />
      <circle cx="84" cy="80" r="1.8" fill="rgb(120 53 15 / 0.5)" />
      {/* Verrous (2) */}
      <rect
        x="38"
        y="31"
        width="10"
        height="5"
        rx="1"
        fill="rgb(120 53 15 / 0.45)"
      />
      <rect
        x="52"
        y="31"
        width="10"
        height="5"
        rx="1"
        fill="rgb(120 53 15 / 0.45)"
      />
      {/* Aération / label */}
      <line
        x1="30"
        y1="55"
        x2="70"
        y2="55"
        stroke="rgb(120 53 15 / 0.35)"
        strokeWidth="0.6"
      />
      <line
        x1="30"
        y1="60"
        x2="70"
        y2="60"
        stroke="rgb(120 53 15 / 0.35)"
        strokeWidth="0.6"
      />
      <line
        x1="30"
        y1="65"
        x2="70"
        y2="65"
        stroke="rgb(120 53 15 / 0.35)"
        strokeWidth="0.6"
      />
      {/* 4 roulettes (en bas) */}
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

/** Mini schéma pelicase (rectangle + charnière + 2 verrous + poignée). */
function PelicaseMockup() {
  return (
    <svg
      viewBox="0 0 100 110"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Poignée du haut */}
      <rect
        x="38"
        y="10"
        width="24"
        height="6"
        rx="2.5"
        fill="rgb(8 145 178 / 0.4)"
      />
      <rect
        x="42"
        y="13"
        width="16"
        height="2"
        rx="1"
        fill="rgb(8 145 178 / 0.7)"
      />
      {/* Corps */}
      <rect
        x="10"
        y="20"
        width="80"
        height="78"
        rx="6"
        fill="rgb(6 182 212 / 0.12)"
        stroke="rgb(6 182 212 / 0.45)"
        strokeWidth="1.2"
      />
      {/* Charnière centrale (dashed) */}
      <line
        x1="10"
        y1="58"
        x2="90"
        y2="58"
        stroke="rgb(6 182 212 / 0.4)"
        strokeWidth="0.8"
        strokeDasharray="2 2"
      />
      {/* 2 verrous latéraux */}
      <rect
        x="28"
        y="55"
        width="12"
        height="6"
        rx="1.5"
        fill="rgb(8 145 178 / 0.6)"
      />
      <rect
        x="60"
        y="55"
        width="12"
        height="6"
        rx="1.5"
        fill="rgb(8 145 178 / 0.6)"
      />
      {/* Coins renforcés */}
      <rect
        x="14"
        y="88"
        width="6"
        height="6"
        rx="1.5"
        fill="rgb(8 145 178 / 0.45)"
      />
      <rect
        x="80"
        y="88"
        width="6"
        height="6"
        rx="1.5"
        fill="rgb(8 145 178 / 0.45)"
      />
      {/* Texture / grille intérieure */}
      <line
        x1="22"
        y1="30"
        x2="78"
        y2="30"
        stroke="rgb(6 182 212 / 0.3)"
        strokeWidth="0.5"
      />
      <line
        x1="22"
        y1="40"
        x2="78"
        y2="40"
        stroke="rgb(6 182 212 / 0.3)"
        strokeWidth="0.5"
      />
      <line
        x1="22"
        y1="75"
        x2="78"
        y2="75"
        stroke="rgb(6 182 212 / 0.3)"
        strokeWidth="0.5"
      />
      <line
        x1="22"
        y1="85"
        x2="78"
        y2="85"
        stroke="rgb(6 182 212 / 0.3)"
        strokeWidth="0.5"
      />
    </svg>
  );
}

/** Mini schéma rack vu de face (montants + face d'équipements stylisés). */
function RackFrontMockup() {
  return (
    <svg
      viewBox="0 0 100 110"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Cadre extérieur */}
      <rect
        x="8"
        y="6"
        width="84"
        height="98"
        rx="2"
        fill="none"
        stroke="rgb(139 92 246 / 0.45)"
        strokeWidth="1.2"
      />
      {/* Montants gauche/droite */}
      <line
        x1="14"
        y1="10"
        x2="14"
        y2="100"
        stroke="rgb(139 92 246 / 0.35)"
        strokeWidth="0.8"
      />
      <line
        x1="86"
        y1="10"
        x2="86"
        y2="100"
        stroke="rgb(139 92 246 / 0.35)"
        strokeWidth="0.8"
      />
      {/* Faces d'équipement (façades stylisées) */}
      {/* 2U switch */}
      <rect
        x="18"
        y="12"
        width="64"
        height="14"
        rx="1.5"
        fill="rgb(59 130 246 / 0.12)"
        stroke="rgb(59 130 246 / 0.5)"
        strokeWidth="0.8"
      />
      <circle cx="74" cy="19" r="1" fill="rgb(16 185 129 / 0.8)" />
      <circle cx="78" cy="19" r="1" fill="rgb(245 158 11 / 0.8)" />
      <line
        x1="22"
        y1="16"
        x2="36"
        y2="16"
        stroke="rgb(59 130 246 / 0.6)"
        strokeWidth="0.5"
      />
      <line
        x1="22"
        y1="22"
        x2="36"
        y2="22"
        stroke="rgb(59 130 246 / 0.6)"
        strokeWidth="0.5"
      />
      {/* 1U séparateur */}
      <rect
        x="18"
        y="28"
        width="64"
        height="6"
        rx="1"
        fill="rgb(100 100 100 / 0.15)"
      />
      {/* 3U écran/transcoder */}
      <rect
        x="18"
        y="36"
        width="64"
        height="22"
        rx="1.5"
        fill="rgb(16 185 129 / 0.1)"
        stroke="rgb(16 185 129 / 0.45)"
        strokeWidth="0.8"
      />
      <rect
        x="24"
        y="40"
        width="36"
        height="14"
        rx="1"
        fill="rgb(16 185 129 / 0.25)"
      />
      <circle cx="68" cy="44" r="1.5" fill="rgb(16 185 129 / 0.6)" />
      <circle cx="74" cy="44" r="1.5" fill="rgb(16 185 129 / 0.6)" />
      {/* 1U vide */}
      <rect
        x="18"
        y="60"
        width="64"
        height="6"
        rx="1"
        fill="none"
        stroke="rgb(150 150 150 / 0.3)"
        strokeWidth="0.6"
        strokeDasharray="2 2"
      />
      {/* 2U audio */}
      <rect
        x="18"
        y="68"
        width="64"
        height="14"
        rx="1.5"
        fill="rgb(245 158 11 / 0.1)"
        stroke="rgb(245 158 11 / 0.45)"
        strokeWidth="0.8"
      />
      <circle cx="26" cy="75" r="1.5" fill="rgb(245 158 11 / 0.5)" />
      <circle cx="34" cy="75" r="1.5" fill="rgb(245 158 11 / 0.5)" />
      <circle cx="42" cy="75" r="1.5" fill="rgb(245 158 11 / 0.5)" />
      <circle cx="50" cy="75" r="1.5" fill="rgb(245 158 11 / 0.5)" />
      {/* 2U patch */}
      <rect
        x="18"
        y="84"
        width="64"
        height="14"
        rx="1.5"
        fill="rgb(139 92 246 / 0.1)"
        stroke="rgb(139 92 246 / 0.45)"
        strokeWidth="0.8"
      />
      <line
        x1="22"
        y1="91"
        x2="78"
        y2="91"
        stroke="rgb(139 92 246 / 0.4)"
        strokeWidth="0.5"
      />
    </svg>
  );
}

// ─── 1. Mode ─────────────────────────────────────────────────────────────────

function ModeStep({
  current,
  onSelect,
  templatesCount,
}: {
  current: Mode | null;
  onSelect: (m: Mode) => void;
  /** null = chargement en cours, number = nombre de templates dispo. */
  templatesCount: number | null;
}) {
  const noTemplates = templatesCount === 0;
  const loading = templatesCount === null;
  const options: {
    value: Mode;
    title: string;
    description: string;
    icon: typeof LayoutTemplate;
    color: string;
  }[] = [
    {
      value: "template",
      title: "Choisir un template",
      description:
        "Partez d'un modèle de contenant déjà configuré et adaptez-le à votre projet.",
      icon: LayoutTemplate,
      color: "#10b981",
    },
    {
      value: "new",
      title: "Créer un nouveau",
      description:
        "Configurez un contenant sur mesure adapté à vos besoins spécifiques.",
      icon: Sparkles,
      color: "#8b5cf6",
    },
  ];

  return (
    <div>
      <WizardStepHeader
        title="Comment souhaitez-vous procéder ?"
        subtitle="Démarrez d'un template existant ou partez d'une feuille blanche."
      />
      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {options.map((opt) => {
          // Card "template" désactivée s'il n'y a aucun template ; "new"
          // est alors pré-sélectionnée visuellement pour orienter l'action.
          const disabled = opt.value === "template" && noTemplates;
          const selected =
            current === opt.value ||
            (current === null && noTemplates && opt.value === "new");
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(opt.value)}
              title={
                disabled
                  ? "Aucun template — créez-en un depuis la page Templates"
                  : undefined
              }
              className={cn(
                "group relative flex h-52 flex-col items-center justify-center rounded-2xl border bg-[var(--card)] p-5 text-center shadow-sm transition-all duration-200",
                selected
                  ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                  : disabled
                    ? "cursor-not-allowed border-[var(--border)]/40 opacity-60"
                    : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
              )}
            >
              <span
                className={cn(
                  "absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
                  selected
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-50 opacity-0",
                )}
              >
                <Check className="h-3.5 w-3.5" />
              </span>
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105"
                style={{
                  backgroundColor: `${opt.color}14`,
                  color: opt.color,
                }}
              >
                <Icon className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                {opt.title}
              </p>
              {disabled ? (
                <p className="mx-auto mt-1.5 max-w-[220px] text-[11px] leading-snug italic text-[var(--muted-foreground)]/80">
                  Aucun template
                </p>
              ) : opt.value === "template" && loading ? (
                <p className="mx-auto mt-1.5 max-w-[220px] text-[11px] leading-snug text-[var(--muted-foreground)]/60">
                  Recherche des templates…
                </p>
              ) : (
                <p className="mx-auto mt-1.5 max-w-[220px] text-[11px] leading-snug text-[var(--muted-foreground)]">
                  {opt.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── 2-Template. Sélection template ──────────────────────────────────────────

function TemplateStep({
  onSelect,
  disabled,
}: {
  onSelect: (rackTemplateId: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <WizardStepHeader
        title="Choisissez un template"
        subtitle="Le contenant sélectionné sera cloné dans votre projet."
      />
      <TemplateSelector onSelect={onSelect} disabled={disabled} />
    </div>
  );
}

// ─── Emplacement (les 2 paths) ──────────────────────────────────────────────

/**
 * LocationStep — choix de l'emplacement du contenant (obligatoire côté API).
 * Liste les lieux existants + création inline si aucun ne convient.
 */
function LocationStep({
  locations,
  current,
  onSelect,
  onCreate,
}: {
  locations: InventaireLocation[];
  current: string | null;
  onSelect: (locationId: string) => void;
  onCreate: (name: string) => Promise<InventaireLocation | null>;
}) {
  const [adding, setAdding] = useState(locations.length === 0);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);

  const submitNew = async () => {
    const name = draft.trim();
    if (!name || creating) return;
    setCreating(true);
    const created = await onCreate(name);
    setCreating(false);
    if (created) {
      setDraft("");
      setAdding(false);
      onSelect(created.id);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <WizardStepHeader
        title="Dans quel emplacement ?"
        subtitle="Régie, nodal, plateau, car… le contenant y sera rattaché."
      />

      {locations.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {locations.map((loc) => {
            const selected = current === loc.id;
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => onSelect(loc.id)}
                className={cn(
                  "group relative flex h-28 flex-col items-center justify-center gap-2 rounded-xl border bg-[var(--card)] p-3 text-center shadow-sm transition-all duration-200",
                  selected
                    ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                    : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
                )}
              >
                <span
                  className={cn(
                    "absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
                    selected
                      ? "scale-100 opacity-100"
                      : "pointer-events-none scale-50 opacity-0",
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
                <MapPin className="h-5 w-5 text-[var(--muted-foreground)]" />
                <p className="w-full truncate text-[12px] font-medium text-[var(--foreground)]">
                  {loc.name}
                </p>
                {loc.cableCode && (
                  <span className="rounded border border-[var(--border)] px-1 font-mono text-[10px] font-semibold text-[var(--muted-foreground)]">
                    {loc.cableCode}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        {adding ? (
          <div className="mx-auto flex max-w-lg items-center gap-2">
            <Input
              autoFocus
              className="h-11 text-sm"
              placeholder="Ex. Régie principale"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitNew();
                }
              }}
            />
            <Button
              type="button"
              variant="accent"
              onClick={() => void submitNew()}
              disabled={draft.trim().length === 0 || creating}
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Créer
            </Button>
            {locations.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft("");
                  setAdding(false);
                }}
                disabled={creating}
              >
                Annuler
              </Button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mx-auto flex w-full max-w-lg items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <Plus className="h-4 w-4" />
            Nouvel emplacement
          </button>
        )}
      </div>
    </div>
  );
}

// ─── 2-New. Type de contenant ───────────────────────────────────────────────

function TypeStep({
  current,
  onSelect,
}: {
  current: RackType;
  onSelect: (t: RackType) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quel type de contenant ?"
        subtitle="Sélectionnez la forme physique du contenant."
      />
      <div className="mx-auto grid max-w-2xl grid-cols-3 gap-3 sm:grid-cols-5">
        {RACK_TYPE_ORDER.map((t) => {
          const selected = current === t;
          const color = RACK_TYPE_COLOR[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              className={cn(
                "group relative flex h-36 flex-col items-center justify-center gap-2 rounded-xl border bg-[var(--card)] p-3 text-center shadow-sm transition-all duration-200",
                selected
                  ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                  : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
              )}
            >
              <span
                className={cn(
                  "absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
                  selected
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-50 opacity-0",
                )}
              >
                <Check className="h-3 w-3" />
              </span>
              <div
                className="flex h-14 w-14 items-center justify-center rounded-lg bg-white p-1 dark:bg-white/95"
                style={{
                  boxShadow: selected ? `inset 0 0 0 1px ${color}40` : undefined,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={RACK_TYPE_IMAGE[t]}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </div>
              <p className="text-center text-[11px] font-medium leading-tight text-[var(--foreground)]">
                {RACK_TYPE_LABEL[t]}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── 3-New. Nom ──────────────────────────────────────────────────────────────

function NameStep({
  rackType,
  value,
  onChange,
  duplicate,
}: {
  rackType: RackType;
  value: string;
  onChange: (v: string) => void;
  duplicate: boolean;
}) {
  const placeholder = (() => {
    switch (rackType) {
      case "STANDARD":
        return "Ex. Baie A — Vidéo";
      case "FLIGHT_CASE_CLASSIC":
      case "FLIGHT_CASE_SKB":
        return "Ex. Flight case audio";
      case "PELICAN":
        return "Ex. Pelicase HF";
      case "CAP":
        return "Ex. Meuble régie";
    }
  })();
  const error = duplicate
    ? "Un contenant porte déjà ce nom dans ce projet."
    : undefined;
  return (
    <div>
      <WizardStepHeader
        title="Comment s'appelle ce contenant ?"
        subtitle="Choisissez un nom clair pour le retrouver facilement."
      />
      <div className="mx-auto max-w-lg">
        <FormField label="Nom du contenant" required error={error}>
          <Input
            autoFocus
            className="h-11 text-sm"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </FormField>
      </div>
    </div>
  );
}

// ─── 4-New. Rackable ─────────────────────────────────────────────────────────

function RackableStep({
  current,
  onSelect,
}: {
  current: boolean;
  onSelect: (v: boolean) => void;
}) {
  const options: {
    value: boolean;
    title: string;
    description: string;
    icon: typeof Server;
    color: string;
  }[] = [
    {
      value: true,
      title: "Rackable (19\")",
      description:
        "Le contenant accueille des équipements 19\" sur des rails standards.",
      icon: Server,
      color: "#3b82f6",
    },
    {
      value: false,
      title: "Non rackable",
      description:
        "Caisson de transport simple — pas de placement physique en U.",
      icon: Package,
      color: "#06b6d4",
    },
  ];

  return (
    <div>
      <WizardStepHeader
        title="Le contenant est-il rackable ?"
        subtitle="Détermine si vous pourrez placer des équipements 19'' à l'intérieur."
      />
      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {options.map((opt) => {
          const selected = current === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value ? "rackable" : "non-rackable"}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={cn(
                "group relative flex h-52 flex-col items-center justify-center rounded-2xl border bg-[var(--card)] p-5 text-center shadow-sm transition-all duration-200",
                selected
                  ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                  : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
              )}
            >
              <span
                className={cn(
                  "absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
                  selected
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-50 opacity-0",
                )}
              >
                <Check className="h-3.5 w-3.5" />
              </span>
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105"
                style={{
                  backgroundColor: `${opt.color}14`,
                  color: opt.color,
                }}
              >
                <Icon className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                {opt.title}
              </p>
              <p className="mx-auto mt-1.5 max-w-[220px] text-[11px] leading-snug text-[var(--muted-foreground)]">
                {opt.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── 5-New. Dimensions — une étape par valeur (pattern WeightStep) ──────────

const DEPTH_PRESETS_MM = [400, 600, 800, 1000];

/**
 * ValueStepCard — pattern visuel identique à `WeightStep` : un carré centré
 * avec un label uppercase + la valeur en grand, puis un slider en dessous
 * avec les bornes min/max, et optionnellement une rangée de presets.
 *
 * Sert de base à toutes les étapes "1 valeur" du wizard (totalU, depth,
 * width, height) pour homogénéiser le look et n'avoir qu'une donnée par
 * écran (cohérent avec le rythme du wizard).
 */
function ValueStepCard({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
  presets,
  presetLabel,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  presets?: number[];
  presetLabel?: (v: number) => string;
}) {
  return (
    <div className="mx-auto max-w-md space-y-3">
      <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)] px-4 py-5 text-center shadow-sm">
        <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          {label}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-[var(--foreground)]">
          {value}
          <span className="ml-1 text-lg font-medium text-[var(--muted-foreground)]">
            {unit}
          </span>
        </p>
      </div>
      <div>
        <RangeInput
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
        />
        <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]/70">
          <span>
            {min} {unit}
          </span>
          <span>
            {max} {unit}
          </span>
        </div>
      </div>
      {presets && presets.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5">
          {presets.map((p) => (
            <PillButton
              key={p}
              active={value === p}
              onClick={() => onChange(p)}
            >
              {presetLabel ? presetLabel(p) : `${p}`}
            </PillButton>
          ))}
        </div>
      )}
    </div>
  );
}

function TotalUStep({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quelle hauteur ?"
        subtitle="Nombre d'unités rack (1U = 44,45 mm)."
      />
      <ValueStepCard
        label="Hauteur"
        value={value}
        unit="U"
        min={1}
        max={48}
        step={1}
        onChange={onChange}
        presets={U_PRESETS}
        presetLabel={(u) => `${u}U`}
      />
    </div>
  );
}

function DepthStep({
  value,
  onChange,
  isRackable,
}: {
  value: number;
  onChange: (v: number) => void;
  isRackable: boolean;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quelle profondeur ?"
        subtitle={
          isRackable
            ? "Profondeur intérieure utile (fond → avant)."
            : "Profondeur externe du caisson."
        }
      />
      <ValueStepCard
        label="Profondeur"
        value={value}
        unit="mm"
        min={isRackable ? 200 : 100}
        max={isRackable ? 1200 : 1500}
        step={10}
        onChange={onChange}
        presets={isRackable ? DEPTH_PRESETS_MM : undefined}
      />
    </div>
  );
}

function WidthStep({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quelle longueur ?"
        subtitle="Longueur externe du caisson."
      />
      <ValueStepCard
        label="Longueur"
        value={value}
        unit="mm"
        min={100}
        max={1500}
        step={10}
        onChange={onChange}
      />
    </div>
  );
}

function HeightStep({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quelle largeur ?"
        subtitle="Largeur externe du caisson."
      />
      <ValueStepCard
        label="Largeur"
        value={value}
        unit="mm"
        min={100}
        max={1500}
        step={10}
        onChange={onChange}
      />
    </div>
  );
}

// ─── 6-New. Roulettes (conditionnel : flight) ───────────────────────────────

function WheelsStep({
  hasWheels,
  setHasWheels,
}: {
  hasWheels: boolean;
  setHasWheels: (v: boolean) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Le contenant est-il sur roulettes ?"
        subtitle="Indispensable pour estimer la mobilité et le poids roulant."
      />
      <div className="mx-auto max-w-md">
        <div className="grid grid-cols-2 gap-3">
          <BigToggleCard
            active={!hasWheels}
            onClick={() => setHasWheels(false)}
            label="Non"
            description="Posé au sol — pas de mobilité."
          />
          <BigToggleCard
            active={hasWheels}
            onClick={() => setHasWheels(true)}
            label="Oui"
            description="Sur roulettes — déplaçable à plein."
          />
        </div>
      </div>
    </div>
  );
}

// ─── 7-New. Poids à vide ─────────────────────────────────────────────────────

function WeightStep({
  emptyWeightKg,
  setEmptyWeightKg,
}: {
  emptyWeightKg: number;
  setEmptyWeightKg: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quel est le poids à vide ?"
        subtitle="Optionnel — permet d'estimer le poids total une fois équipé."
      />
      <div className="mx-auto max-w-md space-y-3">
        <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)] px-4 py-5 text-center shadow-sm">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Poids à vide
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-[var(--foreground)]">
            {emptyWeightKg}
            <span className="ml-1 text-lg font-medium text-[var(--muted-foreground)]">
              kg
            </span>
          </p>
        </div>
        <div>
          <RangeInput
            min={0}
            max={100}
            step={1}
            value={emptyWeightKg}
            onChange={setEmptyWeightKg}
          />
          <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]/70">
            <span>0 kg</span>
            <span>100 kg</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 8-New. Rails arrière internes (conditionnel : rackable) ────────────────

function RailsStep({
  hasRearInterior,
  setHasRearInterior,
  rearGap,
  setRearGap,
}: {
  hasRearInterior: boolean;
  setHasRearInterior: (v: boolean) => void;
  rearGap: number;
  setRearGap: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Y a-t-il des rails arrière internes ?"
        subtitle="Rails additionnels en retrait du fond — utiles pour racker des éléments peu profonds en gardant de l'espace de câblage derrière."
      />
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <BigToggleCard
            active={!hasRearInterior}
            onClick={() => setHasRearInterior(false)}
            label="Non"
            description="Pas de rails internes additionnels."
          />
          <BigToggleCard
            active={hasRearInterior}
            onClick={() => setHasRearInterior(true)}
            label="Oui"
            description="Rails additionnels en retrait du fond."
          />
        </div>

        {hasRearInterior && (
          <div className="grid grid-cols-1 gap-5 rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-4 shadow-sm sm:grid-cols-2">
            {/* Colonne gauche : slider */}
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                  Distance fond → rails
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--foreground)]">
                  {rearGap}
                  <span className="ml-1 text-base font-medium text-[var(--muted-foreground)]">
                    mm
                  </span>
                </p>
              </div>
              <div>
                <RangeInput
                  min={20}
                  max={300}
                  step={5}
                  value={rearGap}
                  onChange={setRearGap}
                />
                <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]/70">
                  <span>20 mm</span>
                  <span>300 mm</span>
                </div>
              </div>
            </div>

            {/* Colonne droite : schéma visuel */}
            <div className="flex items-center justify-center">
              <RearInteriorIllustration rearGapMm={rearGap} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * BigToggleCard — bouton card Oui/Non utilisé dans Wheels / Rails. Taille
 * généreuse pour cohérence avec les autres cards du wizard (RackableStep,
 * ModeStep).
 */
function BigToggleCard({
  active,
  onClick,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-32 flex-col items-center justify-center rounded-2xl border bg-[var(--card)] p-4 text-center shadow-sm transition-all duration-200",
        active
          ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
          : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
      )}
    >
      <span
        className={cn(
          "absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
          active
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-50 opacity-0",
        )}
      >
        <Check className="h-3 w-3" />
      </span>
      <p className="text-base font-semibold text-[var(--foreground)]">{label}</p>
      <p className="mt-1.5 max-w-[220px] text-[11px] leading-snug text-[var(--muted-foreground)]">
        {description}
      </p>
    </button>
  );
}

/**
 * RearInteriorIllustration — schéma simplifié d'un rack vu de dessus, montrant
 * la distance entre le fond et les rails arrière internes. La cote affichée se
 * met à jour en temps réel selon `rearGapMm` (20-300mm → 14-72px à l'écran).
 */
function RearInteriorIllustration({ rearGapMm }: { rearGapMm: number }) {
  const minMm = 20;
  const maxMm = 300;
  const minPx = 14;
  const maxPx = 72;
  const ratio =
    (Math.max(minMm, Math.min(maxMm, rearGapMm)) - minMm) / (maxMm - minMm);
  const gapPx = minPx + ratio * (maxPx - minPx);

  const W = 220;
  const H = 110;
  const padX = 14;
  const padY = 18;
  const innerW = W - 2 * padX;
  const innerH = H - 2 * padY;
  const frontX = padX + 6;
  const rearX = padX + innerW - 6;
  const internalX = rearX - gapPx;
  const railTop = padY + 8;
  const railBot = padY + innerH - 8;

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-2">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="text-[var(--muted-foreground)]"
        aria-hidden
      >
        <rect
          x={padX}
          y={padY}
          width={innerW}
          height={innerH}
          rx={3}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          opacity={0.6}
        />
        <text
          x={padX + 2}
          y={padY - 4}
          fontSize={8}
          fill="currentColor"
          opacity={0.7}
          fontFamily="ui-monospace, monospace"
        >
          AVANT
        </text>
        <text
          x={rearX - 22}
          y={padY - 4}
          fontSize={8}
          fill="currentColor"
          opacity={0.7}
          fontFamily="ui-monospace, monospace"
        >
          ARRIÈRE
        </text>
        <line
          x1={frontX}
          y1={railTop}
          x2={frontX}
          y2={railBot}
          stroke="currentColor"
          strokeWidth={2.5}
          opacity={0.85}
        />
        <line
          x1={rearX}
          y1={railTop}
          x2={rearX}
          y2={railBot}
          stroke="currentColor"
          strokeWidth={2.5}
          opacity={0.85}
        />
        <line
          x1={internalX}
          y1={railTop}
          x2={internalX}
          y2={railBot}
          stroke="var(--accent)"
          strokeWidth={2.5}
        />
        <line
          x1={internalX}
          y1={railBot + 8}
          x2={rearX}
          y2={railBot + 8}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <line
          x1={internalX}
          y1={railBot + 4}
          x2={internalX}
          y2={railBot + 12}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <line
          x1={rearX}
          y1={railBot + 4}
          x2={rearX}
          y2={railBot + 12}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <text
          x={(internalX + rearX) / 2}
          y={railBot + 22}
          fontSize={9}
          fill="var(--accent)"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontWeight="bold"
        >
          {rearGapMm} mm
        </text>
      </svg>
      <p className="text-center text-[10px] leading-tight text-[var(--muted-foreground)]">
        <span className="font-mono font-bold text-[var(--accent)]">━━━</span> rails
        internes ·{" "}
        <span className="font-mono font-bold opacity-70">━━━</span> rails avant/fond
      </p>
    </div>
  );
}

// ─── 7-New. Récapitulatif ────────────────────────────────────────────────────

function SummaryStep({
  rackType,
  name,
  locationName,
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
  locationName: string | null;
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
  const optionsParts: string[] = [];
  if (flight) optionsParts.push(hasWheels ? "Roulettes : oui" : "Roulettes : non");
  if (emptyWeightKg > 0) optionsParts.push(`Poids : ${emptyWeightKg} kg`);
  if (isRackable && hasRearInterior)
    optionsParts.push(`Rails arrière : ${rearGap} mm`);
  const optionsLabel = optionsParts.length > 0 ? optionsParts.join(" · ") : null;

  return (
    <div className="mx-auto max-w-2xl">
      <WizardStepHeader
        title="Vérifiez et ajoutez votre contenant"
        subtitle="Cliquez sur une ligne pour la modifier."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryGroup
          icon={<Server className="h-3.5 w-3.5" />}
          title="Identification"
          color="#8b5cf6"
        >
          <SummaryRow
            label="Type"
            value={RACK_TYPE_LABEL[rackType]}
            onClick={() => onEdit("type")}
          />
          <SummaryRow
            label="Nom"
            value={name || null}
            onClick={() => onEdit("name")}
          />
          <SummaryRow
            label="Emplacement"
            value={locationName}
            onClick={() => onEdit("location")}
          />
          <SummaryRow
            label="Rackable"
            value={isRackable ? "Oui (19\")" : "Non"}
            onClick={() => onEdit("rackable")}
          />
        </SummaryGroup>

        <SummaryGroup
          icon={<Box className="h-3.5 w-3.5" />}
          title="Dimensions"
          color="#3b82f6"
        >
          {isRackable ? (
            <>
              <SummaryRow
                label="Hauteur"
                value={`${totalU}U`}
                onClick={() => onEdit("totalU")}
              />
              <SummaryRow
                label="Profondeur"
                value={`${depthMm} mm`}
                onClick={() => onEdit("depth")}
              />
            </>
          ) : (
            <>
              <SummaryRow
                label="Longueur"
                value={`${widthMm} mm`}
                onClick={() => onEdit("width")}
              />
              <SummaryRow
                label="Largeur"
                value={`${heightMm} mm`}
                onClick={() => onEdit("height")}
              />
              <SummaryRow
                label="Profondeur"
                value={`${depthMm} mm`}
                onClick={() => onEdit("depth")}
              />
            </>
          )}
        </SummaryGroup>

        <SummaryGroup
          icon={<Sparkles className="h-3.5 w-3.5" />}
          title="Options"
          color="#10b981"
          className="sm:col-span-2"
        >
          {flight && (
            <SummaryRow
              label="Roulettes"
              value={hasWheels ? "Oui" : "Non"}
              onClick={() => onEdit("wheels")}
            />
          )}
          <SummaryRow
            label="Poids à vide"
            value={emptyWeightKg > 0 ? `${emptyWeightKg} kg` : null}
            onClick={() => onEdit("weight")}
          />
          {isRackable && (
            <SummaryRow
              label="Rails arrière"
              value={
                hasRearInterior
                  ? `Oui — ${rearGap} mm`
                  : "Non"
              }
              onClick={() => onEdit("rails")}
            />
          )}
          {!flight && !isRackable && (
            <SummaryRow
              label="Détails"
              value={optionsLabel}
              onClick={() => onEdit("weight")}
              multiline
            />
          )}
        </SummaryGroup>
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
  multiline,
}: {
  label: string;
  value: string | null;
  onClick: () => void;
  multiline?: boolean;
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
            "flex-1 text-xs leading-snug break-words",
            multiline ? "" : "truncate",
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

// ─── Form sub-components ─────────────────────────────────────────────────────

function PillButton({
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
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-lg border-2 px-2 text-[11px] font-bold transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
      )}
    >
      {children}
    </button>
  );
}

function RangeInput({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--secondary)] accent-[var(--accent)]"
    />
  );
}

