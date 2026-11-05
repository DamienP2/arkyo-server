"use client";

/**
 * BrandFormDialog (tenant) — wrapper de la modale partagée
 * `<BrandFormDialog>` (cf. components/catalogue/brand/) qui branche les
 * appels API tenant + toasts + suppression.
 *
 * Validation anti-doublon catalogue Arkyo :
 *  - vérifie côté client (case-insensitive) que `name` ne correspond pas à
 *    un `CatalogBrand` existant — affichage inline temps réel ;
 *  - le serveur fait également la vérification (source de vérité) :
 *    409 explicite si conflit.
 */

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  BrandFormDialog as SharedBrandFormDialog,
  type BrandFormValues,
} from "@/components/catalogue/brand";

import type { ArkyoBrandItem, TenantBrandItem } from "./brands-panel";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantBrandItem | null;
  arkyoBrands: ArkyoBrandItem[];
  onSaved: () => void;
  /** Callback appelé après une suppression réussie (édition seulement). */
  onDeleted?: () => void;
};

export function BrandFormDialog({
  open,
  onOpenChange,
  editing,
  arkyoBrands,
  onSaved,
  onDeleted,
}: Props) {
  const confirm = useConfirm();
  const toast = useToast();

  // Liste case-insensitive utilisée pour la vérification anti-doublon en
  // temps réel (cf. SharedBrandFormDialog `existingNames`).
  const arkyoNames = arkyoBrands.map((b) => b.name);

  const handleSubmit = async (values: BrandFormValues) => {
    const name = values.name.trim();

    // Backup serveur — la vérif client temps réel est faite par la modale,
    // mais on conserve un garde-fou ici au cas où.
    const nameLower = name.toLowerCase();
    const conflict = arkyoBrands.find(
      (b) => b.name.toLowerCase() === nameLower,
    );
    if (conflict) {
      throw new Error(
        "Ce fabricant existe déjà dans le catalogue Arkyo.",
      );
    }

    const payload = {
      name,
      website: values.website.trim() || null,
      logoUrl: values.logoUrl.trim() || null,
    };
    if (editing) {
      await api.patch(`/api/tenant/parametres/brands/${editing.id}`, payload);
      toast.success("Fabricant modifié.");
    } else {
      await api.post("/api/tenant/parametres/brands", payload);
      toast.success("Fabricant créé.");
    }
    onSaved();
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: "Supprimer ce fabricant ?",
      description: (
        <>
          <strong>{editing.name}</strong> sera supprimé définitivement. La
          suppression est bloquée si le fabricant est utilisé par un
          équipement ou un câble personnel.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/brands/${editing.id}`);
      toast.success("Fabricant supprimé.");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as
          | {
              error?: string;
              count?: number;
              breakdown?: { equipment?: number; cable?: number };
            }
          | null;
        toast.error(
          body?.error ??
            "Ce fabricant est utilisé par des items du catalogue personnel et ne peut pas être supprimé.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  return (
    <SharedBrandFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? "edit" : "create"}
      initial={
        editing
          ? {
              id: editing.id,
              name: editing.name,
              website: editing.website,
              logoUrl: editing.logoUrl,
            }
          : null
      }
      existingNames={arkyoNames}
      onSubmit={handleSubmit}
      onDelete={editing ? handleDelete : undefined}
    />
  );
}
