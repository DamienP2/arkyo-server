"use client";

/**
 * SignalFormDialog (tenant) — wrapper de la modale partagée
 * `<SignalFormDialog>` (cf. components/catalogue/signal/) qui branche les
 * appels API tenant + toasts.
 *
 * Validation anti-doublon catalogue Arkyo :
 *  - vérifie côté client (case-insensitive) que `name` ne correspond pas à un
 *    `CatalogSignalType` existant — affichage inline temps réel ;
 *  - le serveur fait également la vérification (source de vérité) :
 *    409 explicite si conflit.
 *
 * La suppression se fait depuis la card parente via PersonalCardActions —
 * pas de bouton ici.
 */

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import {
  SignalFormDialog as SharedSignalFormDialog,
  type SignalFormValues,
  type SignalFormConnectorOption,
} from "@/components/catalogue/signal";

import type {
  ArkyoSignalItem,
  FunctionItem,
  TenantSignalItem,
} from "./signals-panel";

// ── Types externes utilisés en interne (lookup) ─────────────────────────────

type LookupConnector = {
  id: string;
  name: string;
  iconId: string | null;
  svgUrl: string | null;
  color: string | null;
  /** Junction multi-fonction (catalogConnectorFunction). */
  functions?: Array<{ functionId: string }>;
};

type LookupResponse = {
  connectorTypes?: LookupConnector[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantSignalItem | null;
  /** Catalogue Arkyo des signaux — utilisé pour la validation anti-doublon. */
  arkyoSignals: ArkyoSignalItem[];
  functions: FunctionItem[];
  onSaved: () => void;
};

export function SignalFormDialog({
  open,
  onOpenChange,
  editing,
  arkyoSignals,
  functions,
  onSaved,
}: Props) {
  const toast = useToast();

  // Référentiel connecteurs (Arkyo) — chargé à l'ouverture du modal.
  const [connectorsLookup, setConnectorsLookup] = useState<LookupConnector[]>(
    [],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.get<LookupResponse>(
          "/api/tenant/catalogue/lookup",
        );
        if (cancelled) return;
        setConnectorsLookup(
          Array.isArray(data?.connectorTypes) ? data.connectorTypes : [],
        );
      } catch {
        if (cancelled) return;
        setConnectorsLookup([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Noms existants Arkyo (case-insensitive sera fait dans le shared dialog).
  const arkyoNames = arkyoSignals.map((s) => s.name);

  const connectorOptions: SignalFormConnectorOption[] = connectorsLookup.map(
    (c) => ({
      id: c.id,
      name: c.name,
      iconId: c.iconId,
      svgUrl: c.svgUrl,
      color: c.color,
      functionIds: (c.functions ?? []).map((f) => f.functionId),
    }),
  );

  const handleSubmit = async (values: SignalFormValues) => {
    const name = values.name.trim();

    // Backup serveur — la vérif client temps réel est faite par la modale.
    const nameLower = name.toLowerCase();
    const conflict = arkyoSignals.find(
      (s) => s.name.toLowerCase() === nameLower,
    );
    if (conflict) {
      throw new Error("Ce signal existe déjà dans le catalogue Arkyo.");
    }

    const parseFloatOrNull = (s: string) => {
      const trimmed = s.trim();
      if (!trimmed) return null;
      const n = parseFloat(trimmed.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };

    // Le backend tenant attend `connectorIds` (TenantSignalType.connectorIds Json).
    const payload = {
      name,
      functionId: values.functionId || null,
      cablePrefix: values.cablePrefix.trim() || null,
      cableSuffix: values.cableSuffix.trim() || null,
      bandwidth: values.bandwidth.trim() || null,
      requiredImpedance: parseFloatOrNull(values.requiredImpedance),
      minBandwidthMHz: parseFloatOrNull(values.minBandwidthMHz),
      color: values.color.trim() || null,
      connectorIds: values.connectors,
      isIp: values.isIp,
      // Force false si !isIp pour éviter les états incohérents persistés.
      supportsRedundancy: values.isIp ? values.supportsRedundancy : false,
      redundancyStyle: values.supportsRedundancy ? values.redundancyStyle : "AB",
      usesMulticast: values.isIp ? values.usesMulticast : false,
    };

    if (editing) {
      await api.patch(`/api/tenant/parametres/signals/${editing.id}`, payload);
      toast.success("Signal modifié.");
    } else {
      await api.post("/api/tenant/parametres/signals", payload);
      toast.success("Signal créé.");
    }
    onSaved();
  };

  return (
    <SharedSignalFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? "edit" : "create"}
      initial={
        editing
          ? {
              id: editing.id,
              name: editing.name,
              functionId: editing.functionId,
              cablePrefix: editing.cablePrefix,
              cableSuffix: editing.cableSuffix,
              bandwidth: editing.bandwidth,
              requiredImpedance: editing.requiredImpedance,
              minBandwidthMHz: editing.minBandwidthMHz,
              color: editing.color,
              connectors: editing.connectorIds,
              isIp: editing.isIp,
              supportsRedundancy: editing.supportsRedundancy,
              redundancyStyle: (editing.redundancyStyle ?? "AB") as
                | "AB"
                | "PRIMARY_SECONDARY"
                | "BLUE_RED",
              usesMulticast: editing.usesMulticast,
            }
          : null
      }
      functionOptions={functions.map((f) => ({
        id: f.id,
        label: f.label,
        color: f.color,
        cablePrefix: f.cablePrefix,
        cableSuffix: f.cableSuffix,
      }))}
      connectorOptions={connectorOptions}
      existingNames={arkyoNames}
      onSubmit={handleSubmit}
    />
  );
}
