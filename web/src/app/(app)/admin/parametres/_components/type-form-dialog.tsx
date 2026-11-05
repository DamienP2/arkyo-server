"use client";

/**
 * TypeFormDialog (tenant) — wrapper de la modale partagée `<TypeFormDialog>`
 * (cf. components/catalogue/category-tree/) qui branche les appels API
 * tenant + toasts + suppression.
 *
 * Côté tenant, la liste des fonctions est la fusion :
 *   - CatalogFunction (Arkyo) → badge "arkyo"
 *   - TenantFunction (perso)  → pas de badge
 *
 * Aligné sur le supervisor :
 *   - `requireFunction=true` (fonction obligatoire) ;
 *   - `allowNone=false` (pas d'option « Aucune »).
 *
 * Validation anti-doublon catalogue Arkyo :
 *   - vérifie côté client (case-insensitive) que `name` ne correspond pas
 *     à un `CatalogType` existant ;
 *   - le serveur fait également la vérification (source de vérité).
 */

import { useMemo } from "react";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  TypeFormDialog as SharedTypeFormDialog,
  type TypeFormValues,
  type TypeFunctionOption,
  type TypeParentOption,
} from "@/components/catalogue/category-tree";

import type {
  ArkyoFunctionItem,
  ArkyoTypeItem,
  TenantFunctionItem,
  TenantTypeItem,
} from "./categories-panel";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantTypeItem | null;
  arkyoFunctions: ArkyoFunctionItem[];
  personalFunctions: TenantFunctionItem[];
  arkyoTypes: ArkyoTypeItem[];
  personalTypes: TenantTypeItem[];
  onSaved: () => void;
  onDeleted?: () => void;
};

export function TypeFormDialog({
  open,
  onOpenChange,
  editing,
  arkyoFunctions,
  personalFunctions,
  arkyoTypes,
  personalTypes,
  onSaved,
  onDeleted,
}: Props) {
  const confirm = useConfirm();
  const toast = useToast();

  const functionOptions = useMemo<TypeFunctionOption[]>(() => {
    const arkyo: TypeFunctionOption[] = arkyoFunctions.map((f) => ({
      id: f.id,
      label: f.label,
      color: f.color,
      source: "arkyo",
    }));
    const personal: TypeFunctionOption[] = personalFunctions.map((f) => ({
      id: f.id,
      label: f.label,
      color: f.color ?? "#6b7280",
      source: "personal",
    }));
    return [...arkyo, ...personal];
  }, [arkyoFunctions, personalFunctions]);

  // Liste case-insensitive utilisée pour la vérification anti-doublon
  // en temps réel (cf. SharedTypeFormDialog `existingNames`).
  const arkyoNames = useMemo(() => arkyoTypes.map((t) => t.name), [arkyoTypes]);

  // Types racines candidats au rattachement (arkyo + perso). La modale
  // partagée filtre ensuite par la fonction sélectionnée.
  const parentOptions = useMemo<TypeParentOption[]>(() => {
    const roots: TypeParentOption[] = [];
    for (const t of arkyoTypes) {
      if (t.parentId == null) {
        roots.push({ id: t.id, name: t.name, functionId: t.functionId });
      }
    }
    for (const t of personalTypes) {
      if (t.parentId == null && t.functionId) {
        roots.push({ id: t.id, name: t.name, functionId: t.functionId });
      }
    }
    return roots;
  }, [arkyoTypes, personalTypes]);

  // Un type perso ayant déjà des enfants ne peut pas devenir sous-type.
  const editingHasChildren = useMemo(
    () =>
      editing ? personalTypes.some((t) => t.parentId === editing.id) : false,
    [editing, personalTypes],
  );

  const handleSubmit = async (values: TypeFormValues) => {
    const name = values.name.trim();

    // Backup serveur — la vérif client temps réel est faite par la modale.
    const nameLower = name.toLowerCase();
    const conflict = arkyoTypes.find(
      (t) => t.name.toLowerCase() === nameLower,
    );
    if (conflict) {
      throw new Error(
        "Ce type existe déjà dans le catalogue Arkyo (libellé).",
      );
    }

    const payload = {
      name,
      functionId: values.functionId || null,
      // Sous-type : l'API re-fixe la functionId depuis le parent.
      parentId: values.parentId ?? null,
    };
    if (editing) {
      await api.patch(`/api/tenant/parametres/categories/type/${editing.id}`, payload);
      toast.success("Type modifié.");
    } else {
      await api.post("/api/tenant/parametres/categories/type", payload);
      toast.success("Type créé.");
    }
    onSaved();
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: "Supprimer ce type ?",
      description: (
        <>
          <strong>{editing.name}</strong> sera supprimé définitivement. La
          suppression est bloquée si le type est référencé par des
          équipements personnels.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/categories/type/${editing.id}`);
      toast.success("Type supprimé.");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ??
            "Ce type est utilisé par des items du catalogue personnel.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  return (
    <SharedTypeFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? "edit" : "create"}
      initial={
        editing
          ? {
              id: editing.id,
              name: editing.name,
              functionId: editing.functionId,
              parentId: editing.parentId,
            }
          : null
      }
      functionOptions={functionOptions}
      parentOptions={parentOptions}
      allowParent={!editingHasChildren}
      requireFunction
      // arkyo-server: catalogue unique — plus de catégories Arkyo officielles
      functionTooltip="Vos catégories personnelles."
      existingNames={arkyoNames}
      onSubmit={handleSubmit}
      onDelete={editing ? handleDelete : undefined}
    />
  );
}
