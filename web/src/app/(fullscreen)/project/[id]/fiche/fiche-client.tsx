"use client";

/**
 * Onglet Fiche projet — édition métadonnées projet.
 *
 * Layout : grille unique 3 colonnes (xl:grid-cols-3) :
 *  - Col 1 : Identité (Nom + Client + Lieu + Description). Pas de statut ici
 *    (déplacé dans le header interactif via `ProjectHeaderBlock`).
 *  - Col 2 : Type & Régie (intervention en lecture seule, fixée à la création
 *    + type de régie filtré selon l'intervention) + Dates (planification +
 *    tournage / mise en service) empilés.
 *  - Col 3 : Messages (placeholder, hauteur totale).
 *
 * Documents et Tâches sont retirés de la fiche : Documents migre vers son
 * propre onglet, Tâches est masqué (pas implémenté).
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Briefcase,
  Calendar,
  Car,
  Home,
  Layers,
  Loader2,
  MessageSquare,
} from "@/components/ui/icons";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-field";
import { EmptyState } from "@/components/ui/empty-state";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { mapApiErrorToForm } from "@/lib/form-errors";
import { cn } from "@/lib/utils";

import { Field, Section, inputCls } from "../_editor/ui";

// ── Types ────────────────────────────────────────────────────────────────────

export type ProjectStatus = "EN_PREPARATION" | "PRET" | "EN_COURS" | "TERMINE" | "ANNULE";
export type InterventionType = "PRESTATION" | "INTEGRATION";
/**
 * `MIXED` reste valide en DB (anciens projets) mais n'est plus sélectionnable
 * depuis l'UI — cohérent avec le modal NewProjectDialog.
 */
export type RigType = "FLIGHT_CASE" | "CAR" | "FIXED_INSTALL" | "MIXED" | null;
type SelectableRigType = "FLIGHT_CASE" | "CAR" | "FIXED_INSTALL";

export type ProjectDocument = {
  id: string;
  name: string;
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
};

export type ProjectFicheData = {
  id: string;
  name: string;
  status: ProjectStatus;
  interventionType: InterventionType;
  rigType: RigType;
  clientName: string | null;
  shootingDate: string | null;
  shootingEndDate: string | null;
  planningStart: string | null;
  planningEnd: string | null;
  commissioningDate: string | null;
  location: string | null;
  description: string | null;
  prestationType: string | null;
  documents: ProjectDocument[];
  counts: { tasks: number; messages: number; documents: number };
};

// ── Form schema ──────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, "Nom requis"),
  rigType: z.enum(["FLIGHT_CASE", "CAR", "FIXED_INSTALL"]),
  clientName: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  planningStart: z.string().optional(),
  planningEnd: z.string().optional(),
  shootingDate: z.string().optional(),
  shootingEndDate: z.string().optional(),
  commissioningDate: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

// ── Constantes ───────────────────────────────────────────────────────────────

const INTERVENTION_LABEL: Record<InterventionType, string> = {
  PRESTATION: "Prestation",
  INTEGRATION: "Intégration",
};

const ALL_RIG_OPTIONS: {
  value: SelectableRigType;
  label: string;
  icon: typeof Box;
}[] = [
  { value: "FLIGHT_CASE", label: "Flight case", icon: Box },
  { value: "CAR", label: "Car régie / véhicule mobile", icon: Car },
  { value: "FIXED_INSTALL", label: "Installation fixe", icon: Home },
];

function getSelectableRigTypes(intervention: InterventionType) {
  return intervention === "PRESTATION" ? ALL_RIG_OPTIONS.slice(0, 2) : ALL_RIG_OPTIONS;
}

const ACCENT = "var(--accent)";

const FIELD_LABELS: Record<string, string> = {
  name: "Nom du projet",
  rigType: "Type de régie",
  clientName: "Client",
  location: "Lieu",
  description: "Description",
  planningStart: "Début de planification",
  planningEnd: "Fin de planification",
  shootingDate: "Début de tournage",
  shootingEndDate: "Fin de tournage",
  commissioningDate: "Date de mise en service",
  "root.serverError": "Erreur serveur",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

/**
 * Si la valeur DB est `MIXED`, on retombe sur `FLIGHT_CASE` côté formulaire
 * (le user sera obligé de re-confirmer son choix au prochain enregistrement).
 */
const normalizeRigType = (v: RigType): SelectableRigType => {
  if (v === "FLIGHT_CASE" || v === "CAR" || v === "FIXED_INSTALL") return v;
  return "FLIGHT_CASE";
};

// ── Component ────────────────────────────────────────────────────────────────

export function FicheClient({ initial }: { initial: ProjectFicheData }) {
  const [project, setProject] = useState<ProjectFicheData>(initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project.name,
      rigType: normalizeRigType(project.rigType),
      clientName: project.clientName ?? "",
      location: project.location ?? "",
      description: project.description ?? "",
      planningStart: toDateInput(project.planningStart),
      planningEnd: toDateInput(project.planningEnd),
      shootingDate: toDateInput(project.shootingDate),
      shootingEndDate: toDateInput(project.shootingEndDate),
      commissioningDate: toDateInput(project.commissioningDate),
    },
  });

  const interventionType = project.interventionType;
  const rigType = form.watch("rigType");
  const rigOptions = getSelectableRigTypes(interventionType);

  const onSubmit = async (values: FormValues) => {
    form.clearErrors("root.serverError");
    try {
      const body: Record<string, unknown> = {
        name: values.name,
        rigType: values.rigType,
        clientName: values.clientName ?? "",
        location: values.location ?? "",
        description: values.description ?? "",
        planningStart: values.planningStart || null,
        planningEnd: values.planningEnd || null,
      };

      if (interventionType === "PRESTATION") {
        body.shootingDate = values.shootingDate || null;
        body.shootingEndDate = values.shootingEndDate || null;
        body.commissioningDate = null;
      } else {
        body.commissioningDate = values.commissioningDate || null;
        body.shootingDate = null;
        body.shootingEndDate = null;
      }

      const updated = await api.patch<{
        id: string;
        name: string;
        rigType: RigType;
        clientName: string | null;
        location: string | null;
        description: string | null;
        shootingDate: string | null;
        shootingEndDate: string | null;
        planningStart: string | null;
        planningEnd: string | null;
        commissioningDate: string | null;
      }>(`/api/tenant/projects/${project.id}`, body);

      setProject((prev) => ({
        ...prev,
        name: updated.name,
        rigType: updated.rigType,
        clientName: updated.clientName,
        location: updated.location,
        description: updated.description,
        shootingDate: updated.shootingDate,
        shootingEndDate: updated.shootingEndDate,
        planningStart: updated.planningStart,
        planningEnd: updated.planningEnd,
        commissioningDate: updated.commissioningDate,
      }));
      setSavedAt(new Date());
    } catch (e) {
      const placed = mapApiErrorToForm(e, (path, err) =>
        form.setError(path as keyof FormValues | "root.serverError", err),
      );
      if (!placed) {
        form.setError("root.serverError", {
          type: "server",
          message: getApiErrorMessage(e),
        });
      }
    }
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      method="post"
      noValidate
      className="space-y-7"
    >
      <FormErrorSummary
        errors={form.formState.errors as Record<string, { message?: string } | undefined>}
        fieldLabels={FIELD_LABELS}
      />

      {/* ── Grille 3 colonnes ── */}
      <div className="grid grid-cols-1 gap-7 xl:grid-cols-3">
        {/* ── Colonne 1 : Identité du projet ── */}
        <Section
          title="Identité du projet"
          color={ACCENT}
          variant="plain"
          icon={<Briefcase className="h-3.5 w-3.5" style={{ color: ACCENT }} />}
        >
          <div className="space-y-4">
            <Field label="Nom" required>
              <input
                {...form.register("name")}
                placeholder="Nom du projet"
                className={cn(inputCls, "h-10 text-base")}
                aria-invalid={form.formState.errors.name ? true : undefined}
              />
            </Field>
            <Field label="Client">
              <input
                {...form.register("clientName")}
                placeholder="Nom du client ou de l'organisation"
                className={cn(inputCls, "h-10")}
              />
            </Field>
            <Field label="Lieu">
              <input
                {...form.register("location")}
                placeholder="Adresse, salle, site…"
                className={cn(inputCls, "h-10")}
              />
            </Field>
            <Field label="Description">
              <textarea
                {...form.register("description")}
                rows={4}
                placeholder="Notes libres, contexte, objectifs…"
                className={cn(inputCls, "h-auto resize-none py-2")}
              />
            </Field>
          </div>
        </Section>

        {/* ── Colonne 2 : Type & Régie + Dates (empilés) ── */}
        <div className="space-y-7">
          <Section
            title="Type & Régie"
            color={ACCENT}
            variant="plain"
            icon={<Layers className="h-3.5 w-3.5" style={{ color: ACCENT }} />}
          >
            <div className="space-y-4">
              <Field label="Type d'intervention">
                <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-2.5">
                  <Briefcase className="h-4 w-4 text-[var(--muted-foreground)]" />
                  <span className="text-sm font-medium">
                    {INTERVENTION_LABEL[interventionType]}
                  </span>
                  <span className="ml-auto text-[10px] tracking-wider text-[var(--muted-foreground)] uppercase">
                    Fixé à la création
                  </span>
                </div>
              </Field>

              <Field label="Type de régie">
                <div className="grid grid-cols-1 gap-2">
                  {rigOptions.map((opt) => {
                    const selected = rigType === opt.value;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => form.setValue("rigType", opt.value)}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all",
                          selected
                            ? "border-[var(--accent)] bg-[var(--accent)]/5"
                            : "border-[var(--border)] hover:bg-[var(--secondary)]/40",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            selected
                              ? "text-[var(--accent)]"
                              : "text-[var(--muted-foreground)]",
                          )}
                        />
                        <span
                          className={cn(
                            "text-sm font-medium",
                            selected
                              // arkyo-server: habillage Strata (texte d'accent sur l'accent à 5 % : --accent-strong)
                              ? "text-[var(--accent-strong)]"
                              : "text-[var(--foreground)]",
                          )}
                        >
                          {opt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {project.rigType === "MIXED" && (
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                    Ce projet est actuellement marqué <strong>Mixte</strong>{" "}
                    (legacy). Sélectionnez un type ci-dessus pour mettre à jour.
                  </p>
                )}
              </Field>
            </div>
          </Section>

          <Section
            title="Dates"
            color={ACCENT}
            variant="plain"
            icon={<Calendar className="h-3.5 w-3.5" style={{ color: ACCENT }} />}
          >
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                  Période de planification
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Début">
                    <input
                      type="date"
                      {...form.register("planningStart")}
                      className={cn(inputCls, "h-10")}
                    />
                  </Field>
                  <Field label="Fin">
                    <input
                      type="date"
                      {...form.register("planningEnd")}
                      className={cn(inputCls, "h-10")}
                    />
                  </Field>
                </div>
              </div>

              {interventionType === "PRESTATION" ? (
                <div className="space-y-3">
                  <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                    Période de tournage
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Début">
                      <input
                        type="date"
                        {...form.register("shootingDate")}
                        className={cn(inputCls, "h-10")}
                      />
                    </Field>
                    <Field label="Fin">
                      <input
                        type="date"
                        {...form.register("shootingEndDate")}
                        className={cn(inputCls, "h-10")}
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                    Mise en service
                  </p>
                  <Field label="Date">
                    <input
                      type="date"
                      {...form.register("commissioningDate")}
                      className={cn(inputCls, "h-10")}
                    />
                  </Field>
                </div>
              )}

              <div className="flex flex-col items-stretch gap-2 border-t border-[var(--border)]/60 pt-4">
                {savedAt && (
                  <span className="text-right text-[11px] text-[var(--muted-foreground)]">
                    Enregistré à {format(savedAt, "HH:mm", { locale: fr })}
                  </span>
                )}
                <Button
                  type="submit"
                  variant="accent"
                  size="sm"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enregistrement…
                    </>
                  ) : (
                    "Enregistrer"
                  )}
                </Button>
              </div>
            </div>
          </Section>
        </div>

        {/* ── Colonne 3 : Messages (seul, hauteur totale) ── */}
        <Card title="Messages" className="h-full">
          <MessagesPlaceholder count={project.counts.messages} />
        </Card>
      </div>
    </form>
  );
}

// ── Card wrapper ─────────────────────────────────────────────────────────────

function Card({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </header>
      <div className="flex-1 p-5">{children}</div>
    </section>
  );
}

// ── Messages placeholder ─────────────────────────────────────────────────────

function MessagesPlaceholder({ count }: { count: number }) {
  return (
    <EmptyState
      icon={<MessageSquare strokeWidth={1.5} />}
      title={count > 0 ? `${count} message${count > 1 ? "s" : ""}` : "Aucun message"}
      description="Le fil de discussion projet sera intégré dans une prochaine itération."
    />
  );
}
