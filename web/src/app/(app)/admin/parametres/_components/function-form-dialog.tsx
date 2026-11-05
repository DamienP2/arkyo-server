"use client";

/**
 * FunctionFormDialog (tenant) — wrapper de la modale partagée
 * `<FunctionFormDialog>` (cf. components/catalogue/category-tree/) qui
 * branche les appels API tenant + toasts + suppression.
 *
 * Note : les champs préfixe / suffixe câble sont **désactivés côté tenant**
 * (`showCableFields={false}`). Le schéma `TenantFunction` ne porte pas ces
 * champs aujourd'hui ; si on les exposait dans la modale, les valeurs saisies
 * seraient silencieusement perdues à la soumission. Cohérent avec la décision
 * d'alignement visuel : `FunctionCard` côté tenant n'affiche pas non plus le
 * bandeau « Câble » (cf. `categories-panel.tsx`).
 *
 * Validation anti-doublon catalogue Arkyo :
 *   - vérifie côté client (case-insensitive) que `key` et `label` ne
 *     correspondent pas à un `CatalogFunction` existant ;
 *   - le serveur fait également la vérification (source de vérité).
 */

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  FunctionFormDialog as SharedFunctionFormDialog,
  toScreamingSnake,
  type FunctionFormValues,
} from "@/components/catalogue/category-tree";

import type {
  ArkyoFunctionItem,
  TenantFunctionItem,
} from "./categories-panel";

// Réexport pour préserver la compat avec les imports historiques
// (`./function-form-dialog` → `toScreamingSnake`).
export { toScreamingSnake };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantFunctionItem | null;
  arkyoFunctions: ArkyoFunctionItem[];
  onSaved: () => void;
  onDeleted?: () => void;
};

export function FunctionFormDialog({
  open,
  onOpenChange,
  editing,
  arkyoFunctions,
  onSaved,
  onDeleted,
}: Props) {
  const confirm = useConfirm();
  const toast = useToast();

  // Listes case-insensitive utilisées pour la vérification anti-doublon
  // en temps réel (cf. SharedFunctionFormDialog `existingLabels` / `existingKeys`).
  const arkyoLabels = arkyoFunctions.map((f) => f.label);
  const arkyoKeys = arkyoFunctions.map((f) => f.key);

  const handleSubmit = async (values: FunctionFormValues) => {
    const label = values.label.trim();
    const key = values.key.trim();

    // Backup serveur — la vérif client temps réel est faite par la modale,
    // mais on conserve un garde-fou ici au cas où.
    const labelLower = label.toLowerCase();
    const keyLower = key.toLowerCase();
    const conflict = arkyoFunctions.find(
      (f) =>
        f.label.toLowerCase() === labelLower ||
        f.key.toLowerCase() === keyLower,
    );
    if (conflict) {
      throw new Error(
        "Cette catégorie existe déjà dans le catalogue Arkyo (clé ou libellé).",
      );
    }

    const payload = {
      label,
      key,
      color: values.color.trim() || null,
    };
    if (editing) {
      await api.patch(`/api/tenant/parametres/categories/function/${editing.id}`, payload);
      toast.success("Catégorie modifiée.");
    } else {
      await api.post("/api/tenant/parametres/categories/function", payload);
      toast.success("Catégorie créée.");
    }
    onSaved();
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: "Supprimer cette catégorie ?",
      description: (
        <>
          <strong>{editing.label}</strong> sera supprimée définitivement. La
          suppression est bloquée si la catégorie est référencée par des
          signaux, types ou câbles personnels.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/categories/function/${editing.id}`);
      toast.success("Catégorie supprimée.");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ??
            "Cette catégorie est utilisée par des items du catalogue personnel.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  return (
    <SharedFunctionFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? "edit" : "create"}
      initial={
        editing
          ? {
              id: editing.id,
              label: editing.label,
              key: editing.key,
              color: editing.color,
            }
          : null
      }
      existingLabels={arkyoLabels}
      existingKeys={arkyoKeys}
      onSubmit={handleSubmit}
      onDelete={editing ? handleDelete : undefined}
    />
  );
}
