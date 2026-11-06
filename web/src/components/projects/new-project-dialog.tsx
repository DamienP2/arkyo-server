"use client";

/**
 * NewProjectDialog — wizard de création d'un projet tenant.
 *
 * Étapes (1 information par étape), avec le bloc « premier contenant »
 * (obligatoire) inséré juste avant la description :
 *   0. INTRO        — panneau d'accueil (référence le type) + bouton "Commencer"
 *   1. RÉGIE        — choix du type de régie (cards adaptées)
 *   2. NOM          — input
 *   3. CLIENT       — input + suggestions
 *   4. PLANNING     — DateRangePicker (range)
 *   5. DATES CLÉS   — DateRangePicker (range si PRESTATION, single si INTEGRATION)
 *   6. LIEU         — input
 *   7. EMPLACEMENT  — nom du premier emplacement (lieu) — requis par l'API
 *      racks (`locationId`) ; créé juste avant le contenant
 *   8. CONTENANT    — étapes de config du premier contenant (type / nom /
 *      rackable / dimensions / [roulettes] / poids / [rails]), partagées avec
 *      le `NewRackWizard` via `rack-wizard-steps.tsx`, sans intro ni summary
 *   8. DESCRIPTION  — textarea
 *   9. RÉCAP        — liste label/valeur + bouton "Créer le projet"
 *
 * Le type d'intervention (Prestation/Intégration) est fixé par la sidebar
 * (prop `interventionType`) — il n'y a plus d'étape de choix du type.
 * Stepper : barre de progression linéaire (h-1) + "Étape X sur N" discret, N
 * étant recalculé dynamiquement (sous-étapes contenant conditionnelles selon
 * type flight / rackable). L'intro (étape 0) ne compte pas dans la progression.
 *
 * Le premier contenant est créé après le projet via la même API que le modal
 * d'ajout de contenant (POST /api/tenant/projects/{id}/racks).
 * Échec partiel toléré : projet créé, toast d'erreur si le contenant échoue.
 *
 * Tous les boutons utilisent la taille `default` standard de l'app (h-9).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  Antenna,
  Building2,
  Calendar,
  Container,
  HardHat,
  Loader2,
  MapPin,
  Sparkles,
  Truck,
  User,
} from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, RequiredPill } from "@/components/ui/form-field";
import {
  DateRangePicker,
  type DateRange,
} from "@/components/ui/date-range-picker";
import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { mapApiErrorToForm } from "@/lib/form-errors";
import { cn } from "@/lib/utils";
import {
  ProgressBar,
  WizardBackdrop,
  WizardKeyframes,
} from "@/components/wizard/wizard-backdrop";
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
  type RackType,
} from "@/components/racks/rack-wizard-steps";

// ── Types ────────────────────────────────────────────────────────────────────

export type InterventionType = "PRESTATION" | "INTEGRATION";
type RigType = "FLIGHT_CASE" | "CAR" | "FIXED_INSTALL";

function getRigOptions(
  intervention: InterventionType,
): { value: RigType; label: string; description: string; icon: typeof Container }[] {
  const all = [
    {
      value: "FLIGHT_CASE" as const,
      label: "Flight case",
      description: "Régie en flight cases déplaçables",
      icon: Container,
    },
    {
      value: "CAR" as const,
      label: "Car régie",
      description: "Véhicule mobile / car régie",
      icon: Truck,
    },
    {
      value: "FIXED_INSTALL" as const,
      label: "Installation fixe",
      description: "Régie permanente / studio",
      icon: Building2,
    },
  ];
  return intervention === "PRESTATION" ? all.slice(0, 2) : all;
}

// ── Schéma ──────────────────────────────────────────────────────────────────

const schema = z.object({
  interventionType: z.enum(["PRESTATION", "INTEGRATION"]),
  rigType: z.enum(["FLIGHT_CASE", "CAR", "FIXED_INSTALL"]),
  name: z.string().min(1, "Nom requis"),
  // Interne = projet sans client externe ; Externe = nom de client requis.
  clientKind: z.enum(["INTERNAL", "EXTERNAL"]),
  clientName: z.string().optional(),
  planningStart: z.string().optional(),
  planningEnd: z.string().optional(),
  shootingDate: z.string().optional(),
  shootingEndDate: z.string().optional(),
  commissioningDate: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

// ── Steps ───────────────────────────────────────────────────────────────────

type StepId =
  | "intro"
  | "rig"
  | "name"
  | "client"
  | "planning"
  | "keyDates"
  | "location"
  | "cLocation"
  | "cType"
  | "cName"
  | "cRackable"
  | "cDimensions"
  | "cWheels"
  | "cWeight"
  | "cRails"
  | "description"
  | "summary";

type StepDef = {
  id: StepId;
  /** Étape visible dans la barre de progression (intro = -1 = masquée). */
  progressIndex: number;
  optional?: boolean;
};

/** Étape contenant (partagée) → étape projet préfixée `c`. */
const CONTAINER_STEP_ID: Record<
  "type" | "name" | "rackable" | "dimensions" | "wheels" | "weight" | "rails",
  StepId
> = {
  type: "cType",
  name: "cName",
  rackable: "cRackable",
  dimensions: "cDimensions",
  wheels: "cWheels",
  weight: "cWeight",
  rails: "cRails",
};

/**
 * Construit la liste d'étapes du wizard. Les étapes « premier contenant »
 * (obligatoire) s'insèrent juste avant l'étape description : les étapes de
 * configuration du contenant (dynamiques selon type flight / rackable), sans
 * intro ni summary.
 */
function buildSteps(flight: boolean, isRackable: boolean): StepDef[] {
  const steps: StepDef[] = [
    { id: "intro", progressIndex: -1 },
    { id: "rig", progressIndex: 0 },
    { id: "name", progressIndex: 0 },
    { id: "client", progressIndex: 0 },
    { id: "planning", progressIndex: 0 },
    { id: "keyDates", progressIndex: 0 },
    { id: "location", progressIndex: 0 },
    // Emplacement (lieu) du premier contenant — requis par l'API racks.
    { id: "cLocation", progressIndex: 0 },
  ];
  for (const id of buildContainerStepIds(flight, isRackable)) {
    steps.push({ id: CONTAINER_STEP_ID[id], progressIndex: 0 });
  }
  steps.push({ id: "description", progressIndex: 0, optional: true });
  steps.push({ id: "summary", progressIndex: 0 });

  // Renumérote : intro reste à -1, le reste démarre à 1.
  let counter = 1;
  for (const s of steps) {
    if (s.id === "intro") continue;
    s.progressIndex = counter++;
  }
  return steps;
}

// ── Helpers date ─────────────────────────────────────────────────────────────

function fromIso(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toIso(d: Date | null): string {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function fmtDate(iso?: string | null): string | null {
  const d = fromIso(iso);
  if (!d) return null;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtRange(a?: string, b?: string): string | null {
  const sa = fmtDate(a);
  const sb = fmtDate(b);
  if (sa && sb && sa !== sb) return `${sa} → ${sb}`;
  return sa ?? sb ?? null;
}

// ── Component ───────────────────────────────────────────────────────────────

export function NewProjectDialog({
  open,
  onOpenChange,
  interventionType,
  knownClients,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  interventionType: InterventionType;
  knownClients?: string[];
  /**
   * Liste des noms de projets déjà utilisés dans le tenant (toutes interventions
   * confondues). Sert à la validation d'unicité à l'étape 3, insensible à la
   * casse et aux espaces de bord.
   */
  existingNames?: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Emplacement (lieu) du premier contenant — créé juste avant le contenant.
  const [containerLocationName, setContainerLocationName] = useState("");

  // Premier contenant (obligatoire) — configuré via les étapes cType…cRails.
  const {
    config: containerConfig,
    update: updateContainer,
    reset: resetContainer,
    pickType: pickContainerType,
    flight: containerFlight,
  } = useRackConfig();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      interventionType,
      rigType: "FLIGHT_CASE",
      clientKind: "INTERNAL",
      name: "",
      clientName: "",
      planningStart: "",
      planningEnd: "",
      shootingDate: "",
      shootingEndDate: "",
      commissioningDate: "",
      location: "",
      description: "",
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTimeout(() => {
        form.reset({
          interventionType,
          rigType: "FLIGHT_CASE",
          clientKind: "INTERNAL",
          name: "",
          clientName: "",
          planningStart: "",
          planningEnd: "",
          shootingDate: "",
          shootingEndDate: "",
          commissioningDate: "",
          location: "",
          description: "",
        });
        setStepIndex(0);
        resetContainer();
        setContainerLocationName("");
      }, 150);
    }
    onOpenChange(next);
  };

  // Re-init du form à chaque ouverture du dialog avec l'interventionType courant.
  // Sans ça, `useForm` capture la valeur initiale au premier mount et un
  // changement d'onglet (Prestations ↔ Intégrations) ne modifie pas le type
  // pré-sélectionné à l'étape 1.
  useEffect(() => {
    if (!open) return;
    form.reset({
      interventionType,
      rigType: "FLIGHT_CASE",
      clientKind: "INTERNAL",
      name: "",
      clientName: "",
      planningStart: "",
      planningEnd: "",
      shootingDate: "",
      shootingEndDate: "",
      commissioningDate: "",
      location: "",
      description: "",
    });
    setStepIndex(0);
    resetContainer();
    setContainerLocationName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, interventionType]);

  const steps = useMemo(
    () => buildSteps(containerFlight, containerConfig.isRackable),
    [containerFlight, containerConfig.isRackable],
  );
  const progressTotal = steps.length - 1; // intro masqué
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)] ?? steps[0];
  const isIntro = currentStep.id === "intro";
  const isLast = currentStep.id === "summary";

  // Set normalisé (lowercase + trim) des noms déjà utilisés — pour vérif
  // d'unicité côté wizard. Le serveur revalide en garde-fou (cf. POST route).
  const takenNames = useMemo(() => {
    const out = new Set<string>();
    for (const n of existingNames ?? []) {
      const k = n.trim().toLowerCase();
      if (k) out.add(k);
    }
    return out;
  }, [existingNames]);

  const isNameTaken = (raw: string) =>
    takenNames.has(raw.trim().toLowerCase());

  const validateStep = async (id: StepId): Promise<boolean> => {
    switch (id) {
      case "intro":
        return true;
      case "rig":
        return await form.trigger("rigType");
      case "name": {
        const ok = await form.trigger("name");
        if (!ok) return false;
        const name = form.getValues("name");
        if (isNameTaken(name)) {
          form.setError("name", {
            type: "duplicate",
            message: "Un projet porte déjà ce nom dans cet espace.",
          });
          return false;
        }
        return true;
      }
      case "client": {
        if (form.getValues("clientKind") !== "EXTERNAL") return true;
        if (!form.getValues("clientName")?.trim()) {
          form.setError("clientName", {
            type: "required",
            message: "Nom du client requis.",
          });
          return false;
        }
        return true;
      }
      case "planning":
        return !!form.getValues("planningStart") && !!form.getValues("planningEnd");
      case "keyDates": {
        if (form.getValues("interventionType") === "PRESTATION") {
          return (
            !!form.getValues("shootingDate") && !!form.getValues("shootingEndDate")
          );
        }
        // Mise en service strictement après la fin de planification (ISO
        // "yyyy-mm-dd" → comparaison lexicographique = chronologique).
        const c = form.getValues("commissioningDate");
        const pe = form.getValues("planningEnd");
        return !!c && (!pe || c > pe);
      }
      case "location":
        return !!form.getValues("location")?.trim();
      case "cLocation":
        return containerLocationName.trim().length > 0;
      case "cName":
        return containerConfig.name.trim().length > 0;
      default:
        return true;
    }
  };

  const goNext = async () => {
    const ok = await validateStep(currentStep.id);
    if (!ok) return;
    if (isLast) {
      await form.handleSubmit(onSubmit)();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const goPrev = () => {
    if (isIntro) return;
    setStepIndex((i) => i - 1);
  };

  const jumpToStep = (id: StepId) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx >= 0) setStepIndex(idx);
  };

  const handlePickContainerType = (t: RackType) => {
    pickContainerType(t);
    setTimeout(() => goNext(), 200);
  };

  const handlePickContainerRackable = (next: boolean) => {
    updateContainer("isRackable", next);
    setTimeout(() => goNext(), 200);
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    form.clearErrors("root.serverError");
    try {
      const body: Record<string, string> = {
        name: values.name,
        interventionType: values.interventionType,
        rigType: values.rigType,
      };
      if (values.clientKind === "EXTERNAL" && values.clientName)
        body.clientName = values.clientName;
      if (values.location) body.location = values.location;
      if (values.description) body.description = values.description;
      if (values.planningStart) body.planningStart = values.planningStart;
      if (values.planningEnd) body.planningEnd = values.planningEnd;

      if (values.interventionType === "PRESTATION") {
        if (values.shootingDate) body.shootingDate = values.shootingDate;
        if (values.shootingEndDate) body.shootingEndDate = values.shootingEndDate;
      } else {
        if (values.commissioningDate) body.commissioningDate = values.commissioningDate;
      }

      const project = await api.post<{ id: string }>("/api/tenant/projects", body);

      // Premier emplacement + premier contenant (obligatoires) : créés via les
      // mêmes API que l'inventaire, rattachés au projet fraîchement créé. Le
      // contenant exige un `locationId` — on crée donc le lieu d'abord. Échec
      // partiel toléré : le projet reste créé, on signale par un toast.
      try {
        const location = await api.post<{ id: string }>(
          `/api/tenant/projects/${project.id}/locations`,
          { name: containerLocationName.trim() },
        );
        await api.post(`/api/tenant/projects/${project.id}/racks`, {
          racks: [
            { ...buildRackPayload(containerConfig), locationId: location.id },
          ],
        });
      } catch (e) {
        toast.error(
          `Projet créé, mais le contenant « ${containerConfig.name.trim()} » n'a pas pu être ajouté : ${getApiErrorMessage(e)}`,
        );
      }

      handleOpenChange(false);
      router.push(`/project/${project.id}?tab=inventaire`);
    } catch (e) {
      const placed = mapApiErrorToForm(e, (path, err) => {
        form.setError(path as keyof FormValues | "root.serverError", err);
        const stepFor = stepForField(path);
        const idx = stepFor != null ? steps.findIndex((s) => s.id === stepFor) : -1;
        if (idx >= 0) setStepIndex(idx);
      });
      if (!placed) {
        form.setError("root.serverError", {
          type: "server",
          message: getApiErrorMessage(e),
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const rigPicked = !!form.watch("rigType");
  const nameValue = form.watch("name");
  const namePicked = !!nameValue;
  const nameDuplicate = namePicked && isNameTaken(nameValue);

  // Watches pour gater le bouton "Continuer" sur les étapes désormais requises.
  const clientKindW = form.watch("clientKind");
  const clientNameW = form.watch("clientName");
  const planningStartW = form.watch("planningStart");
  const planningEndW = form.watch("planningEnd");
  const shootingDateW = form.watch("shootingDate");
  const shootingEndW = form.watch("shootingEndDate");
  const commissioningW = form.watch("commissioningDate");
  const locationW = form.watch("location");
  const interventionW = form.watch("interventionType");

  const continueDisabled =
    submitting ||
    (currentStep.id === "rig" && !rigPicked) ||
    (currentStep.id === "name" && (!namePicked || nameDuplicate)) ||
    (currentStep.id === "client" &&
      clientKindW === "EXTERNAL" &&
      !clientNameW?.trim()) ||
    (currentStep.id === "planning" && (!planningStartW || !planningEndW)) ||
    (currentStep.id === "keyDates" &&
      (interventionW === "PRESTATION"
        ? !shootingDateW || !shootingEndW
        : !commissioningW || (!!planningEndW && commissioningW <= planningEndW))) ||
    (currentStep.id === "location" && !locationW?.trim()) ||
    (currentStep.id === "cLocation" &&
      containerLocationName.trim().length === 0) ||
    (currentStep.id === "cName" && containerConfig.name.trim().length === 0);

  const serverError = form.formState.errors.root?.serverError?.message;

  // ── Rendu d'étape ──────────────────────────────────────────────────────────

  const renderStepBody = () => {
    switch (currentStep.id) {
      case "intro":
        return <IntroStep onStart={goNext} interventionType={interventionType} />;
      case "rig":
        return (
          <RigStep
            form={form}
            onSelect={(v) => {
              form.setValue("rigType", v);
              setTimeout(() => goNext(), 200);
            }}
          />
        );
      case "name":
        return <NameStep form={form} isNameTaken={isNameTaken} />;
      case "client":
        return <ClientStep form={form} knownClients={knownClients ?? []} />;
      case "planning":
        return <PlanningStep form={form} />;
      case "keyDates":
        return <KeyDatesStep form={form} />;
      case "location":
        return <LocationStep form={form} />;
      case "cLocation":
        return (
          <ContainerLocationStep
            value={containerLocationName}
            onChange={setContainerLocationName}
          />
        );
      case "cType":
        return (
          <RackTypeStep
            current={containerConfig.rackType}
            onSelect={handlePickContainerType}
          />
        );
      case "cName":
        return (
          <RackNameStep
            rackType={containerConfig.rackType}
            value={containerConfig.name}
            onChange={(v) => updateContainer("name", v)}
          />
        );
      case "cRackable":
        return (
          <RackRackableStep
            current={containerConfig.isRackable}
            onSelect={handlePickContainerRackable}
          />
        );
      case "cDimensions":
        return (
          <RackDimensionsStep
            isRackable={containerConfig.isRackable}
            totalU={containerConfig.totalU}
            setTotalU={(v) => updateContainer("totalU", v)}
            depthMm={containerConfig.depthMm}
            setDepthMm={(v) => updateContainer("depthMm", v)}
            widthMm={containerConfig.widthMm}
            setWidthMm={(v) => updateContainer("widthMm", v)}
            heightMm={containerConfig.heightMm}
            setHeightMm={(v) => updateContainer("heightMm", v)}
            uPresets={U_PRESETS_FALLBACK}
          />
        );
      case "cWheels":
        return (
          <RackWheelsStep
            hasWheels={containerConfig.hasWheels}
            setHasWheels={(v) => updateContainer("hasWheels", v)}
          />
        );
      case "cWeight":
        return (
          <RackWeightStep
            emptyWeightKg={containerConfig.emptyWeightKg}
            setEmptyWeightKg={(v) => updateContainer("emptyWeightKg", v)}
          />
        );
      case "cRails":
        return (
          <RackRailsStep
            hasRearInterior={containerConfig.hasRearInterior}
            setHasRearInterior={(v) => updateContainer("hasRearInterior", v)}
            rearGap={containerConfig.rearGap}
            setRearGap={(v) => updateContainer("rearGap", v)}
          />
        );
      case "description":
        return <DescriptionStep form={form} />;
      case "summary":
        return (
          <SummaryStep
            form={form}
            onEdit={jumpToStep}
            containerName={containerConfig.name}
            containerTypeLabel={RACK_TYPE_LABEL[containerConfig.rackType]}
            containerLocationName={containerLocationName}
          />
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[580px] max-w-3xl flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">
          Créer un nouveau projet
        </DialogTitle>
        <DialogDescription className="sr-only">
          Wizard de création d&apos;un projet en plusieurs étapes.
        </DialogDescription>

        {/* Backdrop décoratif : intense sur l'intro, discret ailleurs */}
        <WizardBackdrop variant={isIntro ? "intense" : "discreet"} />

        {/* Animation keyframes globales pour blobs / mockups / sparkle */}
        <WizardKeyframes />

        {/* Barre de progression (masquée sur intro) */}
        {!isIntro && (
          <div className="relative z-10 px-8 pt-6">
            <ProgressBar
              progressIndex={currentStep.progressIndex}
              total={progressTotal}
            />
          </div>
        )}

        {/* Body de l'étape — occupe tout l'espace restant pour homogénéiser
            la hauteur entre étapes (intro sans progress/footer vs autres). */}
        <div className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-8 py-8">
          <div className="w-full">{renderStepBody()}</div>
        </div>

        {serverError && (
          <div className="relative z-10 mx-8 mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
            {serverError}
          </div>
        )}

        {/* Footer (masqué sur intro — bouton "Commencer" inline dans IntroStep) */}
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
                {isLast
                  ? "Créer le projet"
                  : currentStep.optional && isOptionalEmpty(currentStep.id, form)
                    ? "Passer"
                    : "Continuer"}
                {!isLast && !submitting && <ArrowRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Vrai si l'étape optionnelle courante n'a aucune valeur saisie. */
function isOptionalEmpty(id: StepId, form: ReturnType<typeof useForm<FormValues>>): boolean {
  const v = form.getValues();
  switch (id) {
    case "description":
      return !v.description?.trim();
    default:
      return false;
  }
}

/** Mapping champ → id de step, pour replacer l'utilisateur après erreur. */
function stepForField(path: string): StepId | null {
  const map: Record<string, StepId> = {
    rigType: "rig",
    name: "name",
    clientName: "client",
    planningStart: "planning",
    planningEnd: "planning",
    shootingDate: "keyDates",
    shootingEndDate: "keyDates",
    commissioningDate: "keyDates",
    location: "location",
    description: "description",
  };
  return map[path] ?? null;
}

// ─── Step bodies ────────────────────────────────────────────────────────────

type FormBag = ReturnType<typeof useForm<FormValues>>;

// ── 0. Intro ──────────────────────────────────────────────────────────────

/**
 * IntroStep — volet d'accueil très design.
 *
 * Composition :
 *  - 3 blobs colorés floutés en arrière-plan (purple / blue / emerald),
 *    chacun animé en pulse doux pour donner du mouvement subtil.
 *  - Grille subtile (radial dots) en sur-impression pour la texture.
 *  - 3 mini-cards mockup décalées et inclinées en arrière (équipement,
 *    cordon, projet) qui suggèrent l'univers Arkyo sans dominer.
 *  - Titre éditorial en 2 lignes avec un mot souligné en accent.
 *  - Sous-texte explicatif court.
 *  - Bouton "Commencer" avec micro-décoration (étoile qui scintille).
 *
 * Tout est self-contained dans le composant — pas de dépendance externe ni
 * de classes globales custom.
 */

function IntroStep({
  onStart,
  interventionType,
}: {
  onStart: () => void;
  interventionType: InterventionType;
}) {
  const typeLabel = interventionType === "PRESTATION" ? "Prestation" : "Intégration";
  return (
    <div className="relative -mx-8 -my-8 overflow-hidden rounded-2xl">
      {/* Le backdrop (blobs + dots) est fourni par <WizardBackdrop variant="intense" />
          au niveau du DialogContent — pas dupliqué ici. Cette section n'ajoute
          que les mockups Arkyo et le contenu central. */}

      {/* ── Mini-mockups Arkyo (rack / synoptique / réseau) ──────────────── */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden
      >
        {/* Mockup RACK — haut-gauche, rotation -12° */}
        <div
          // arkyo-server: habillage Strata
          className="absolute -left-8 top-8 hidden h-40 w-36 rounded-xl border border-[var(--surface)]/40 bg-[var(--surface)]/40 p-2 backdrop-blur-md dark:border-[var(--foreground)]/10 dark:bg-[var(--foreground)]/5 sm:block"
          style={{
            ["--rot" as string]: "-12deg",
            transform: "rotate(-12deg)",
            animation: "mockup-float 6s ease-in-out infinite",
          }}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
              Rack
            </span>
            <div className="flex gap-0.5">
              <span className="h-1 w-1 rounded-full bg-emerald-500" />
              <span className="h-1 w-1 rounded-full bg-amber-500" />
            </div>
          </div>
          {/* Slots U empilés */}
          <div className="space-y-0.5">
            {/* 2U équipement violet */}
            <div className="flex h-5 items-center justify-between rounded-sm border border-violet-500/40 bg-violet-500/15 px-1.5">
              <div className="h-0.5 w-8 rounded-full bg-violet-700/40" />
              <div className="flex gap-0.5">
                <span className="h-1 w-1 rounded-full bg-violet-700/60" />
                <span className="h-1 w-1 rounded-full bg-violet-700/60" />
              </div>
            </div>
            {/* 1U noir */}
            <div className="h-2 rounded-sm bg-zinc-700/40" />
            {/* 1U bleu */}
            <div className="flex h-2.5 items-center rounded-sm border border-blue-500/40 bg-blue-500/15 px-1.5">
              <div className="h-0.5 w-6 rounded-full bg-blue-700/40" />
            </div>
            {/* 3U emerald */}
            <div className="flex h-7 flex-col justify-between rounded-sm border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-1">
              <div className="h-0.5 w-10 rounded-full bg-emerald-700/40" />
              <div className="grid grid-cols-6 gap-0.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <span key={i} className="h-0.5 rounded-full bg-emerald-700/40" />
                ))}
              </div>
            </div>
            {/* 1U vide */}
            <div className="h-2 rounded-sm border border-dashed border-zinc-400/30" />
            {/* 2U amber */}
            <div className="flex h-5 items-center justify-between rounded-sm border border-amber-500/40 bg-amber-500/15 px-1.5">
              <div className="h-0.5 w-7 rounded-full bg-amber-700/40" />
              <span className="h-1 w-1 rounded-full bg-amber-700/60" />
            </div>
          </div>
        </div>

        {/* Mockup SYNOPTIQUE — droite, rotation +9° */}
        <div
          // arkyo-server: habillage Strata
          className="absolute -right-4 top-16 hidden h-36 w-48 rounded-xl border border-[var(--surface)]/40 bg-[var(--surface)]/40 p-3 backdrop-blur-md dark:border-[var(--foreground)]/10 dark:bg-[var(--foreground)]/5 sm:block"
          style={{
            ["--rot" as string]: "9deg",
            transform: "rotate(9deg)",
            animation: "mockup-float 7s ease-in-out infinite",
            animationDelay: "1s",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
              Synoptique
            </span>
            <Sparkles className="h-2.5 w-2.5 text-[var(--muted-foreground)]/60" />
          </div>
          {/* SVG schéma de câblage : 3 nodes reliés */}
          <svg
            viewBox="0 0 160 90"
            className="h-24 w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Câbles (paths) */}
            <path
              d="M 32 25 L 80 25 L 80 65 L 128 65"
              fill="none"
              stroke="rgb(139 92 246 / 0.7)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M 32 25 Q 60 25 60 45 T 100 45 L 128 25"
              fill="none"
              stroke="rgb(59 130 246 / 0.7)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M 32 65 L 128 65"
              fill="none"
              stroke="rgb(16 185 129 / 0.7)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            {/* Node gauche (caméra) */}
            <rect x="6" y="12" width="28" height="60" rx="3" fill="rgb(139 92 246 / 0.15)" stroke="rgb(139 92 246 / 0.5)" strokeWidth="1" />
            <circle cx="20" cy="25" r="2" fill="rgb(139 92 246 / 0.8)" />
            <circle cx="20" cy="65" r="2" fill="rgb(16 185 129 / 0.8)" />
            {/* Node centre (rack) */}
            <rect x="68" y="20" width="24" height="50" rx="3" fill="rgb(59 130 246 / 0.15)" stroke="rgb(59 130 246 / 0.5)" strokeWidth="1" />
            <line x1="73" y1="28" x2="87" y2="28" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1" />
            <line x1="73" y1="34" x2="87" y2="34" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1" />
            <line x1="73" y1="40" x2="87" y2="40" stroke="rgb(59 130 246 / 0.6)" strokeWidth="1" />
            {/* Node droite (sortie) */}
            <rect x="126" y="12" width="28" height="60" rx="3" fill="rgb(16 185 129 / 0.15)" stroke="rgb(16 185 129 / 0.5)" strokeWidth="1" />
            <circle cx="140" cy="25" r="2" fill="rgb(59 130 246 / 0.8)" />
            <circle cx="140" cy="65" r="2" fill="rgb(16 185 129 / 0.8)" />
          </svg>
        </div>

        {/* Mockup RÉSEAU — bas-gauche, rotation -6° */}
        <div
          // arkyo-server: habillage Strata
          className="absolute bottom-4 left-10 hidden h-28 w-40 rounded-xl border border-[var(--surface)]/40 bg-[var(--surface)]/40 p-2.5 backdrop-blur-md dark:border-[var(--foreground)]/10 dark:bg-[var(--foreground)]/5 sm:block"
          style={{
            ["--rot" as string]: "-6deg",
            transform: "rotate(-6deg)",
            animation: "mockup-float 8s ease-in-out infinite",
            animationDelay: "2s",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[8px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
              Réseau
            </span>
            <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[7px] font-bold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
              2110
            </span>
          </div>
          {/* SVG topologie : switch central + 4 branches */}
          <svg
            viewBox="0 0 160 80"
            className="h-20 w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Liens */}
            <line x1="80" y1="40" x2="20" y2="15" stroke="rgb(59 130 246 / 0.55)" strokeWidth="1.2" />
            <line x1="80" y1="40" x2="20" y2="65" stroke="rgb(59 130 246 / 0.55)" strokeWidth="1.2" />
            <line x1="80" y1="40" x2="140" y2="15" stroke="rgb(59 130 246 / 0.55)" strokeWidth="1.2" />
            <line x1="80" y1="40" x2="140" y2="65" stroke="rgb(59 130 246 / 0.55)" strokeWidth="1.2" />
            {/* Switch central */}
            <rect x="65" y="30" width="30" height="20" rx="3" fill="rgb(59 130 246 / 0.25)" stroke="rgb(59 130 246 / 0.7)" strokeWidth="1" />
            <line x1="71" y1="36" x2="78" y2="36" stroke="rgb(59 130 246 / 0.9)" strokeWidth="1" />
            <line x1="71" y1="40" x2="78" y2="40" stroke="rgb(59 130 246 / 0.9)" strokeWidth="1" />
            <line x1="71" y1="44" x2="78" y2="44" stroke="rgb(59 130 246 / 0.9)" strokeWidth="1" />
            <line x1="82" y1="36" x2="89" y2="36" stroke="rgb(59 130 246 / 0.9)" strokeWidth="1" />
            <line x1="82" y1="40" x2="89" y2="40" stroke="rgb(59 130 246 / 0.9)" strokeWidth="1" />
            <line x1="82" y1="44" x2="89" y2="44" stroke="rgb(59 130 246 / 0.9)" strokeWidth="1" />
            {/* Endpoints */}
            <circle cx="20" cy="15" r="4" fill="rgb(139 92 246 / 0.8)" />
            <circle cx="20" cy="65" r="4" fill="rgb(16 185 129 / 0.8)" />
            <circle cx="140" cy="15" r="4" fill="rgb(245 158 11 / 0.8)" />
            <circle cx="140" cy="65" r="4" fill="rgb(59 130 246 / 0.8)" />
          </svg>
        </div>
      </div>

      {/* ── Contenu central — espacements aérés pour remplir la hauteur ──── */}
      <div className="relative z-10 mx-auto flex h-full max-w-lg flex-col items-center justify-center px-8 py-16 text-center">
        {/* Badge "Nouveau" */}
        {/* arkyo-server: habillage Strata (texte d'accent sur fond teinté : --accent-strong) */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--surface)]/40 bg-[var(--surface)]/60 px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent-strong)] uppercase shadow-sm backdrop-blur-md dark:border-[var(--foreground)]/10 dark:bg-[var(--foreground)]/10">
          <Sparkles
            className="h-3 w-3"
            style={{ animation: "sparkle-twinkle 2s ease-in-out infinite" }}
          />
          Nouveau projet · {typeLabel}
        </span>

        {/* Titre éditorial */}
        <h3 className="mt-10 text-3xl leading-tight font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
          Donnons vie à votre{" "}
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
            prochain projet
          </span>
        </h3>

        {/* Sous-texte */}
        <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
          Quelques étapes simples pour configurer votre projet broadcast.
          Tout reste modifiable plus tard depuis la fiche projet.
        </p>

        {/* Bouton CTA */}
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

// ── Header standard d'étape ──────────────────────────────────────────────

function StepHeader({
  title,
  subtitle,
  required,
}: {
  title: string;
  subtitle?: string;
  /** Affiche une pill REQUIS sous le titre (étapes sans FormField). */
  required?: boolean;
}) {
  return (
    <div className="mb-6 text-center">
      <h3 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
        {title}
      </h3>
      {required && (
        <div className="mt-2 flex justify-center">
          <RequiredPill />
        </div>
      )}
      {subtitle && (
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-snug text-[var(--muted-foreground)]">
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ── 1. Type de régie ─────────────────────────────────────────────────────

function RigStep({
  form,
  onSelect,
}: {
  form: FormBag;
  onSelect: (v: RigType) => void;
}) {
  const intervention = form.watch("interventionType");
  const rigOptions = getRigOptions(intervention);
  const currentRig = form.watch("rigType");
  const rigValues = rigOptions.map((o) => o.value);
  if (!rigValues.includes(currentRig)) {
    form.setValue("rigType", rigValues[0]);
  }

  return (
    <div>
      <StepHeader
        title="Quel type de régie ?"
        subtitle="Comment votre régie est-elle organisée pour ce projet ?"
      />
      <div
        className={cn(
          "mx-auto grid max-w-2xl gap-3",
          rigOptions.length === 3 ? "grid-cols-3" : "grid-cols-2",
        )}
      >
        {rigOptions.map((opt) => {
          const selected = currentRig === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={cn(
                "flex h-36 flex-col items-center justify-center gap-2.5 rounded-xl border bg-[var(--card)] p-3 text-center shadow-sm transition-all duration-200",
                selected
                  ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                  : "border-[var(--border)]/60 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
              )}
            >
              <Icon
                className={cn(
                  "h-8 w-8 shrink-0",
                  selected ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]",
                )}
              />
              <div>
                <p
                  className={cn(
                    "text-xs font-semibold leading-tight",
                    selected ? "text-[var(--accent)]" : "text-[var(--foreground)]",
                  )}
                >
                  {opt.label}
                </p>
                <p className="mt-1 text-[10px] leading-snug text-[var(--muted-foreground)]">
                  {opt.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── 3. Nom ──────────────────────────────────────────────────────────────

function NameStep({
  form,
  isNameTaken,
}: {
  form: FormBag;
  isNameTaken: (raw: string) => boolean;
}) {
  const intervention = form.watch("interventionType");
  const placeholder =
    intervention === "PRESTATION"
      ? "Ex. Match PSG-OM — Parc des Princes"
      : "Ex. Studio TV Plateau A";

  // Validation live de l'unicité : déclenchée à chaque frappe via watch.
  // On affiche l'erreur dès que la saisie est non vide ET déjà prise.
  const nameValue = form.watch("name") ?? "";
  const trimmed = nameValue.trim();
  const duplicate = trimmed.length > 0 && isNameTaken(trimmed);
  const liveError = duplicate
    ? "Un projet porte déjà ce nom dans cet espace."
    : form.formState.errors.name?.message;

  return (
    <div>
      <StepHeader
        title="Comment s'appelle votre projet ?"
        subtitle="Choisissez un nom clair pour le retrouver facilement."
      />
      <div className="mx-auto max-w-lg">
        <FormField
          label="Nom du projet"
          required
          error={liveError}
          fieldName="name"
        >
          <Input
            autoFocus
            className="h-11 text-sm"
            placeholder={placeholder}
            {...form.register("name")}
          />
        </FormField>
      </div>
    </div>
  );
}

// ── 4. Client ───────────────────────────────────────────────────────────

function ClientStep({
  form,
  knownClients,
}: {
  form: FormBag;
  knownClients: string[];
}) {
  const kind = form.watch("clientKind");
  const clientValue = form.watch("clientName") ?? "";
  const q = clientValue.trim().toLowerCase();
  const clientSuggestions = useMemo(() => {
    if (!q) return [];
    return knownClients
      .filter((c) => c.toLowerCase().includes(q) && c.toLowerCase() !== q)
      .slice(0, 6);
  }, [knownClients, q]);

  const kindOptions: {
    value: "INTERNAL" | "EXTERNAL";
    title: string;
    description: string;
  }[] = [
    {
      value: "INTERNAL",
      title: "Interne",
      description: "Projet pour votre structure",
    },
    {
      value: "EXTERNAL",
      title: "Client externe",
      description: "Prestation pour un client",
    },
  ];

  return (
    <div>
      <StepHeader
        title="Pour quel client ?"
        subtitle="Projet interne ou prestation pour un client externe ?"
      />
      <div className="mx-auto max-w-lg space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {kindOptions.map((opt) => {
            const selected = kind === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  form.setValue("clientKind", opt.value);
                  if (opt.value === "INTERNAL") {
                    form.setValue("clientName", "");
                    form.clearErrors("clientName");
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-xl border bg-[var(--card)] px-3 py-4 text-center shadow-sm transition-all duration-200",
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                    : "border-[var(--border)]/60 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5",
                )}
              >
                <span
                  className={cn(
                    "text-sm font-semibold",
                    selected ? "text-[var(--accent)]" : "text-[var(--foreground)]",
                  )}
                >
                  {opt.title}
                </span>
                <span className="text-[11px] leading-snug text-[var(--muted-foreground)]">
                  {opt.description}
                </span>
              </button>
            );
          })}
        </div>

        {kind === "EXTERNAL" && (
          <div>
            <FormField
              label="Nom du client"
              required
              error={form.formState.errors.clientName?.message}
              fieldName="clientName"
            >
              <Input
                autoFocus
                className="h-11 text-sm"
                placeholder="Nom du client ou de l'organisation"
                list="known-clients"
                {...form.register("clientName")}
              />
            </FormField>
            {knownClients.length > 0 && (
              <datalist id="known-clients">
                {knownClients.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            )}
            {clientSuggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {clientSuggestions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => form.setValue("clientName", c)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 5. Planification ─────────────────────────────────────────────────────

function PlanningStep({ form }: { form: FormBag }) {
  const range: DateRange = {
    from: fromIso(form.watch("planningStart")),
    to: fromIso(form.watch("planningEnd")),
  };

  return (
    <div>
      <StepHeader
        title="Quelle est la période de planification ?"
        subtitle="Sélectionnez une date de début puis une date de fin."
        required
      />
      <div className="mx-auto max-w-md">
        <RangeSummary range={range} />
        <DateRangePicker
          className="mt-4"
          value={range}
          onChange={(r) => {
            form.setValue("planningStart", toIso(r.from));
            form.setValue("planningEnd", toIso(r.to));
          }}
          mode="range"
          minDate={new Date()}
        />
        <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
          Les dates antérieures à aujourd'hui sont indisponibles.
        </p>
      </div>
    </div>
  );
}

// ── 6. Dates clés ────────────────────────────────────────────────────────

function KeyDatesStep({ form }: { form: FormBag }) {
  const intervention = form.watch("interventionType");

  if (intervention === "PRESTATION") {
    const range: DateRange = {
      from: fromIso(form.watch("shootingDate")),
      to: fromIso(form.watch("shootingEndDate")),
    };
    return (
      <div>
        <StepHeader
          title="Période de tournage"
          subtitle="Quand le projet se déroule."
          required
        />
        <div className="mx-auto max-w-md">
          <RangeSummary range={range} />
          <DateRangePicker
            className="mt-4"
            value={range}
            onChange={(r) => {
              form.setValue("shootingDate", toIso(r.from));
              form.setValue("shootingEndDate", toIso(r.to));
            }}
            mode="range"
            minDate={new Date()}
          />
          <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
            Cliquez sur une date de début, puis sur la date de fin.
          </p>
        </div>
      </div>
    );
  }

  // Intégration : la mise en service doit être strictement postérieure à la
  // dernière date de planification.
  const planEnd = fromIso(form.watch("planningEnd"));
  const minCommission = planEnd ? addDays(planEnd, 1) : new Date();
  const single = fromIso(form.watch("commissioningDate"));
  const range: DateRange = { from: single, to: single };
  return (
    <div>
      <StepHeader
        title="Date de mise en service"
        subtitle="Quand l'installation sera opérationnelle."
        required
      />
      <div className="mx-auto max-w-md">
        <SingleSummary date={single} />
        <DateRangePicker
          className="mt-4"
          value={range}
          onChange={(r) => {
            form.setValue("commissioningDate", toIso(r.from));
          }}
          mode="single"
          minDate={minCommission}
        />
        <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
          {planEnd
            ? `Doit être postérieure à la planification (après le ${planEnd.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}).`
            : "Renseignez d'abord la période de planification."}
        </p>
      </div>
    </div>
  );
}

function RangeSummary({ range }: { range: DateRange }) {
  const fromLabel = range.from
    ? range.from.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
  const toLabel = range.to
    ? range.to.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-3 py-1.5 text-center shadow-sm">
        <p className="text-[9px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Début
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs font-semibold tabular-nums",
            range.from ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]/60",
          )}
        >
          {fromLabel}
        </p>
      </div>
      <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-3 py-1.5 text-center shadow-sm">
        <p className="text-[9px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Fin
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs font-semibold tabular-nums",
            range.to ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]/60",
          )}
        >
          {toLabel}
        </p>
      </div>
    </div>
  );
}

function SingleSummary({ date }: { date: Date | null }) {
  const label = date
    ? date.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
  return (
    <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-3 py-1.5 text-center shadow-sm">
      <p className="text-[9px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
        Date
      </p>
      <p
        className={cn(
          "mt-0.5 text-xs font-semibold tabular-nums",
          date ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]/60",
        )}
      >
        {label}
      </p>
    </div>
  );
}

// ── 7. Lieu ──────────────────────────────────────────────────────────────

function LocationStep({ form }: { form: FormBag }) {
  return (
    <div>
      <StepHeader
        title="Où se déroule le projet ?"
        subtitle="Adresse, salle, site."
      />
      <div className="mx-auto max-w-lg">
        <FormField
          label="Lieu"
          required
          error={form.formState.errors.location?.message}
          fieldName="location"
        >
          <Input
            className="h-11 text-sm"
            placeholder="Adresse, salle, site…"
            {...form.register("location")}
          />
        </FormField>
      </div>
    </div>
  );
}

// ── 7-bis. Emplacement du premier contenant ──────────────────────────────

/**
 * ContainerLocationStep — nom du premier emplacement (lieu) du projet. Le
 * lieu est créé juste avant le contenant, qui l'exige (`locationId`).
 */
function ContainerLocationStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Où sera installé ce contenant ?"
        subtitle="Régie, nodal, plateau, car… Vous pourrez en ajouter d'autres ensuite."
      />
      <div className="mx-auto max-w-lg">
        <FormField label="Emplacement" required>
          <Input
            autoFocus
            className="h-11 text-sm"
            placeholder="Ex. Régie principale"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </FormField>
      </div>
    </div>
  );
}

// ── 8. Description ───────────────────────────────────────────────────────

function DescriptionStep({ form }: { form: FormBag }) {
  return (
    <div>
      <StepHeader
        title="Une description à ajouter ?"
        subtitle="Optionnel — notes libres, contexte, contraintes particulières."
      />
      <div className="mx-auto max-w-lg">
        <FormField
          label="Description"
          error={form.formState.errors.description?.message}
          fieldName="description"
        >
          <textarea
            rows={4}
            placeholder="Notes libres, contexte, contraintes…"
            className="flex w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
            {...form.register("description")}
          />
        </FormField>
      </div>
    </div>
  );
}

// ── 9. Récapitulatif ─────────────────────────────────────────────────────

const INTERVENTION_LABEL: Record<InterventionType, string> = {
  PRESTATION: "Prestation",
  INTEGRATION: "Intégration",
};
const RIG_LABEL: Record<RigType, string> = {
  FLIGHT_CASE: "Flight case",
  CAR: "Car régie",
  FIXED_INSTALL: "Installation fixe",
};

const RIG_ICON: Record<RigType, typeof Container> = {
  FLIGHT_CASE: Container,
  CAR: Truck,
  FIXED_INSTALL: Building2,
};

/**
 * SummaryStep — récapitulatif graphique : carte héro (nom + type + régie),
 * tuiles Client / Lieu, timeline des dates, bloc description. Chaque élément
 * est cliquable et ramène à son étape source.
 */
function SummaryStep({
  form,
  onEdit,
  containerName,
  containerTypeLabel,
  containerLocationName,
}: {
  form: FormBag;
  onEdit: (id: StepId) => void;
  containerName: string;
  containerTypeLabel: string;
  containerLocationName: string;
}) {
  const v = form.watch();
  const containerValue = `${containerName.trim() || "Sans nom"} · ${containerTypeLabel}`;
  const isPresta = v.interventionType === "PRESTATION";
  const TypeIcon = isPresta ? Antenna : HardHat;
  const RigIcon = RIG_ICON[v.rigType];
  const clientLabel = v.clientKind === "INTERNAL" ? "Interne" : v.clientName || "—";
  const planning = fmtRange(v.planningStart, v.planningEnd);
  const keyLabel = isPresta ? "Tournage" : "Mise en service";
  const keyValue = isPresta
    ? fmtRange(v.shootingDate, v.shootingEndDate)
    : fmtDate(v.commissioningDate);

  return (
    <div className="mx-auto max-w-lg">
      <StepHeader
        title="Vérifiez et créez votre projet"
        subtitle="Cliquez sur un élément pour le modifier."
      />
      <div className="space-y-3 rounded-2xl border border-[var(--border)]/60 bg-gradient-to-br from-[var(--card)] to-[var(--secondary)]/30 p-4 shadow-sm">
        {/* Ligne titre : type + nom + régie */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {/* arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong) */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[9px] font-bold tracking-wider text-[var(--accent-strong)] uppercase">
              <TypeIcon className="h-2.5 w-2.5" />
              {INTERVENTION_LABEL[v.interventionType]}
            </span>
            <button
              type="button"
              onClick={() => onEdit("name")}
              className="group mt-1.5 block w-full text-left"
            >
              <p className="truncate text-lg font-semibold tracking-tight text-[var(--foreground)] transition-colors group-hover:text-[var(--accent)]">
                {v.name || "Projet sans nom"}
              </p>
            </button>
          </div>
          <button
            type="button"
            onClick={() => onEdit("rig")}
            className="group inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-2.5 py-1.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
          >
            <RigIcon className="h-3.5 w-3.5" />
            {RIG_LABEL[v.rigType]}
          </button>
        </div>

        <div className="h-px bg-[var(--border)]/50" />

        {/* Grille compacte — 4 infos clés */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <SummaryItem
            icon={User}
            label="Client"
            value={clientLabel}
            onClick={() => onEdit("client")}
          />
          <SummaryItem
            icon={MapPin}
            label="Lieu"
            value={v.location || "—"}
            onClick={() => onEdit("location")}
          />
          <SummaryItem
            icon={Calendar}
            label="Planification"
            value={planning ?? "—"}
            onClick={() => onEdit("planning")}
          />
          <SummaryItem
            icon={Calendar}
            label={keyLabel}
            value={keyValue ?? "—"}
            onClick={() => onEdit("keyDates")}
          />
          <SummaryItem
            icon={MapPin}
            label="Emplacement"
            value={containerLocationName.trim() || "—"}
            onClick={() => onEdit("cLocation")}
          />
          <SummaryItem
            icon={Container}
            label="Contenant"
            value={containerValue}
            onClick={() => onEdit("cType")}
          />
        </div>

        {v.description?.trim() && (
          <>
            <div className="h-px bg-[var(--border)]/50" />
            <button
              type="button"
              onClick={() => onEdit("description")}
              className="group -mx-1 block w-full rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[var(--secondary)]/40"
            >
              <p className="text-[9px] font-bold tracking-wider text-[var(--muted-foreground)]/70 uppercase">
                Description
              </p>
              <p className="line-clamp-2 text-xs leading-snug text-[var(--muted-foreground)]">
                {v.description}
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
  icon: typeof User;
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
