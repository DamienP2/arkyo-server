"use client";

/**
 * ProjectCharacteristicsDialog — modal d'édition rapide des caractéristiques
 * du projet, ouvert depuis l'icône ⚙ de la topbar globale (entre nom et
 * statut).
 *
 * Aligné sur le pattern canonique des modals admin (CablingFormDialog,
 * BrandFormDialog, etc.) : `<FormDialog>` avec eyebrow/icône/title + body
 * en `FormSection`. Submit unique (tous les champs en un PATCH) plutôt
 * qu'auto-save par champ — comportement standard d'un modal d'édition.
 *
 * Le statut n'est pas dans ce dialog : il s'édite via le dropdown coloré
 * de la topbar (à droite de cette icône).
 */

import { Settings2 } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { z } from "zod";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import type { ProjectFicheData } from "../fiche/fiche-client";
import type { SaveStatus } from "./project-contextual-topbar";

// ── Schéma : tous les champs optionnels sauf le nom ──────────────────────────

const schema = z.object({
  name: z.string().trim().min(1, "Le nom est requis."),
  prestationType: z.string(),
  location: z.string(),
  clientName: z.string(),
  shootingDate: z.string(),
  shootingEndDate: z.string(),
  commissioningDate: z.string(),
  planningStart: z.string(),
  planningEnd: z.string(),
  description: z.string(),
});

type FormValues = z.infer<typeof schema>;

// ── Helpers date ─────────────────────────────────────────────────────────────

const toDateInput = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10) : "";
const fromDateInput = (v: string): string | null =>
  v ? new Date(v).toISOString() : null;

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectCharacteristicsDialog({
  open,
  onOpenChange,
  fiche,
  onSaveStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiche: ProjectFicheData;
  /** Notifie l'état save vers la topbar contextuelle (badge vert). */
  onSaveStatus?: (status: SaveStatus) => void;
}) {
  const router = useRouter();

  const defaultValues = useMemo<FormValues>(
    () => ({
      name: fiche.name,
      prestationType: fiche.prestationType ?? "",
      location: fiche.location ?? "",
      clientName: fiche.clientName ?? "",
      shootingDate: toDateInput(fiche.shootingDate),
      shootingEndDate: toDateInput(fiche.shootingEndDate),
      commissioningDate: toDateInput(fiche.commissioningDate),
      planningStart: toDateInput(fiche.planningStart),
      planningEnd: toDateInput(fiche.planningEnd),
      description: fiche.description ?? "",
    }),
    [fiche],
  );

  const isPrestation = fiche.interventionType === "PRESTATION";

  const handleSubmit = async (values: FormValues) => {
    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      prestationType: values.prestationType.trim() || null,
      location: values.location.trim() || null,
      clientName: values.clientName.trim() || null,
      planningStart: fromDateInput(values.planningStart),
      planningEnd: fromDateInput(values.planningEnd),
      description: values.description.trim() || null,
    };
    if (isPrestation) {
      payload.shootingDate = fromDateInput(values.shootingDate);
      payload.shootingEndDate = fromDateInput(values.shootingEndDate);
    } else {
      payload.commissioningDate = fromDateInput(values.commissioningDate);
    }

    onSaveStatus?.("saving");
    try {
      await api.patch(`/api/tenant/projects/${fiche.id}`, payload);
      onSaveStatus?.("saved");
      router.refresh();
    } catch (e) {
      onSaveStatus?.("error");
      // Laisse FormDialog rendre l'erreur via `root.serverError`.
      if (e instanceof ApiError || e instanceof Error) throw e;
      throw new Error("Erreur inconnue.");
    }
  };

  return (
    <FormDialog<FormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Settings2 />}
      eyebrow="PROJET"
      title={`Modifier « ${fiche.name} »`}
      description="Mise à jour des informations principales du projet. Le statut s'édite via le badge coloré de la topbar."
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={handleSubmit}
      submitLabel="Enregistrer"
      size="lg"
    >
      {(form) => {
        const nameError = form.formState.errors.name?.message ?? null;
        return (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            {/* ── Identité ── */}
            <FormSection title="Nom *" className="md:col-span-2">
              <input
                autoFocus
                {...form.register("name")}
                placeholder="Nom du projet"
                className={cn(
                  "flex h-10 w-full rounded-lg border bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  nameError
                    ? "border-[var(--destructive)]"
                    : "border-[var(--border)]",
                )}
              />
              {nameError && (
                <p className="mt-1 text-[11px] text-[var(--destructive)]">
                  {nameError}
                </p>
              )}
            </FormSection>

            <FormSection title="Type de prestation">
              <input
                {...form.register("prestationType")}
                placeholder="ex. sport, concert, TV…"
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>

            <FormSection title="Client">
              <input
                {...form.register("clientName")}
                placeholder="Nom du client"
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>

            <FormSection title="Lieu" className="md:col-span-2">
              <input
                {...form.register("location")}
                placeholder="Adresse, ville, salle…"
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>

            {/* ── Dates spécifiques au type d'intervention ── */}
            {isPrestation ? (
              <>
                <FormSection title="Début de tournage">
                  <input
                    type="date"
                    {...form.register("shootingDate")}
                    className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </FormSection>
                <FormSection title="Fin de tournage">
                  <input
                    type="date"
                    {...form.register("shootingEndDate")}
                    className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </FormSection>
              </>
            ) : (
              <FormSection title="Mise en service" className="md:col-span-2">
                <input
                  type="date"
                  {...form.register("commissioningDate")}
                  className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </FormSection>
            )}

            {/* ── Planification (commune) ── */}
            <FormSection title="Début de planification">
              <input
                type="date"
                {...form.register("planningStart")}
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>

            <FormSection title="Fin de planification">
              <input
                type="date"
                {...form.register("planningEnd")}
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>

            <FormSection title="Description" className="md:col-span-2">
              <textarea
                {...form.register("description")}
                rows={4}
                placeholder="Notes, contexte, contraintes…"
                className="flex w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>
          </div>
        );
      }}
    </FormDialog>
  );
}
