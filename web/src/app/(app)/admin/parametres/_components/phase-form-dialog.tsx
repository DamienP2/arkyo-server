"use client";

/**
 * PhaseFormDialog (tenant) — wrapper de la modale partagée
 * `<PhaseFormDialog>` (cf. components/catalogue/category-tree/) qui branche
 * les appels API tenant + toasts + suppression.
 *
 * La modale partagée affiche les mêmes champs côté tenant et supervisor.
 *
 * Validation anti-doublon catalogue Arkyo :
 *   - vérifie côté client (case-insensitive) que `key` et `label` ne
 *     correspondent pas à une `CatalogPhase` existante ;
 *   - le serveur fait également la vérification (source de vérité).
 */

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  PhaseFormDialog as SharedPhaseFormDialog,
  type PhaseFormValues,
} from "@/components/catalogue/category-tree";

import type { ArkyoPhaseItem, TenantPhaseItem } from "./categories-panel";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantPhaseItem | null;
  arkyoPhases: ArkyoPhaseItem[];
  onSaved: () => void;
  onDeleted?: () => void;
};

export function PhaseFormDialog({
  open,
  onOpenChange,
  editing,
  arkyoPhases,
  onSaved,
  onDeleted,
}: Props) {
  const confirm = useConfirm();
  const toast = useToast();

  // Listes case-insensitive utilisées pour la vérification anti-doublon
  // en temps réel (cf. SharedPhaseFormDialog `existingLabels` / `existingKeys`).
  const arkyoLabels = arkyoPhases.map((p) => p.label);
  const arkyoKeys = arkyoPhases.map((p) => p.key);

  const handleSubmit = async (values: PhaseFormValues) => {
    const label = values.label.trim();
    const key = values.key.trim();

    // Backup serveur — la vérif client temps réel est faite par la modale.
    const labelLower = label.toLowerCase();
    const keyLower = key.toLowerCase();
    const conflict = arkyoPhases.find(
      (p) =>
        p.label.toLowerCase() === labelLower ||
        p.key.toLowerCase() === keyLower,
    );
    if (conflict) {
      throw new Error(
        "Cette phase existe déjà dans le catalogue Arkyo (clé ou libellé).",
      );
    }

    const payload = { label, key };
    if (editing) {
      await api.patch(`/api/tenant/parametres/categories/phase/${editing.id}`, payload);
      toast.success("Phase modifiée.");
    } else {
      await api.post("/api/tenant/parametres/categories/phase", payload);
      toast.success("Phase créée.");
    }
    onSaved();
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: "Supprimer cette phase ?",
      description: (
        <>
          <strong>{editing.label}</strong> sera supprimée définitivement. La
          suppression est bloquée si la phase est référencée par des
          équipements personnels.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/categories/phase/${editing.id}`);
      toast.success("Phase supprimée.");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ??
            "Cette phase est utilisée par des items du catalogue personnel.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  return (
    <SharedPhaseFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? "edit" : "create"}
      initial={
        editing
          ? { id: editing.id, label: editing.label, key: editing.key }
          : null
      }
      existingLabels={arkyoLabels}
      existingKeys={arkyoKeys}
      onSubmit={handleSubmit}
      onDelete={editing ? handleDelete : undefined}
    />
  );
}
