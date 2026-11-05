"use client";

/**
 * ConnectorFormDialog (tenant) — wrapper de la modale partagée
 * `<ConnectorFormDialog>` (cf. components/catalogue/connector/) qui branche
 * les appels API tenant + toasts + suppression.
 *
 * Validation anti-doublon catalogue Arkyo :
 *  - vérifie côté client (case-insensitive) que `name` ne correspond pas à un
 *    `CatalogConnectorType` existant — affichage inline temps réel ;
 *  - le serveur fait également la vérification (source de vérité) :
 *    409 explicite si conflit.
 */

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  ConnectorFormDialog as SharedConnectorFormDialog,
  type ConnectorFormValues,
} from "@/components/catalogue/connector";

import type {
  ArkyoConnectorItem,
  FunctionItem,
  TenantConnectorItem,
} from "./connectors-panel";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantConnectorItem | null;
  arkyoConnectors: ArkyoConnectorItem[];
  functions: FunctionItem[];
  onSaved: () => void;
  /** Callback appelé après une suppression réussie (édition seulement). */
  onDeleted?: () => void;
};

export function ConnectorFormDialog({
  open,
  onOpenChange,
  editing,
  arkyoConnectors,
  functions,
  onSaved,
  onDeleted,
}: Props) {
  const confirm = useConfirm();
  const toast = useToast();

  const arkyoNames = arkyoConnectors.map((c) => c.name);

  const handleSubmit = async (values: ConnectorFormValues) => {
    const name = values.name.trim();

    // Backup serveur — la vérif client temps réel est faite par la modale.
    const nameLower = name.toLowerCase();
    const conflict = arkyoConnectors.find(
      (c) => c.name.toLowerCase() === nameLower,
    );
    if (conflict) {
      throw new Error("Ce connecteur existe déjà dans le catalogue Arkyo.");
    }

    const iconId = values.iconSource === "icon" ? values.iconId || null : null;
    const svgUrl = values.iconSource === "svg" ? values.svgUrl || null : null;

    const payload = {
      name,
      iconId,
      svgUrl,
      color: values.color.trim() || null,
      versions: values.versions.map((v) => v.trim()).filter(Boolean),
      functionIds: values.functionIds,
    };

    if (editing) {
      await api.patch(`/api/tenant/parametres/connectors/${editing.id}`, payload);
      toast.success("Connecteur modifié.");
    } else {
      await api.post("/api/tenant/parametres/connectors", payload);
      toast.success("Connecteur créé.");
    }
    onSaved();
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: "Supprimer ce connecteur ?",
      description: (
        <>
          <strong>{editing.name}</strong> sera supprimé définitivement. La
          suppression est bloquée si le connecteur est utilisé par un
          équipement ou panel personnel.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/connectors/${editing.id}`);
      toast.success("Connecteur supprimé.");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ??
            "Ce connecteur est utilisé par des items du catalogue personnel.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  return (
    <SharedConnectorFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? "edit" : "create"}
      initial={
        editing
          ? {
              id: editing.id,
              name: editing.name,
              iconId: editing.iconId,
              svgUrl: editing.svgUrl,
              color: editing.color,
              versions: editing.versions,
              functionIds: editing.functionIds,
            }
          : null
      }
      functionOptions={functions}
      existingNames={arkyoNames}
      onSubmit={handleSubmit}
      onDelete={editing ? handleDelete : undefined}
    />
  );
}
