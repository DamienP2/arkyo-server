"use client";

/**
 * CablingFormDialog (tenant) — wrapper de la modale partagée
 * `<CablingFormDialog>` (cf. components/catalogue/cabling/) qui branche les
 * appels API tenant + toasts.
 *
 * Validation anti-doublon catalogue Arkyo :
 *  - vérifie côté client (case-insensitive) que `name` ne correspond pas à un
 *    `CableModel` (main DB) existant — affichage inline temps réel ;
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
  CablingFormDialog as SharedCablingFormDialog,
  type CablingFormValues,
  type CablingFormBrandOption,
} from "@/components/catalogue/cabling";

import type {
  ArkyoCableModelItem,
  BrandLookupItem,
  FunctionItem,
  TenantCableModelItem,
} from "./cabling-panel";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantCableModelItem | null;
  /** Catalogue Arkyo des modèles — utilisé pour la validation anti-doublon. */
  arkyoCableModels: ArkyoCableModelItem[];
  functions: FunctionItem[];
  brands: BrandLookupItem[];
  onSaved: () => void;
};

// Lookup étendu pour les logos fabricants — récupère `logoUrl` qui n'est pas
// présent dans `BrandLookupItem` du panel.
type LookupBrand = {
  id: string;
  name: string;
  logoUrl?: string | null;
};

type LookupResponse = {
  brands?: LookupBrand[];
};

export function CablingFormDialog({
  open,
  onOpenChange,
  editing,
  arkyoCableModels,
  functions,
  brands,
  onSaved,
}: Props) {
  const toast = useToast();

  // Charge la liste enrichie des fabricants (avec logoUrl) à l'ouverture pour
  // alimenter le BrandPickerModal partagé.
  const [brandLookup, setBrandLookup] = useState<LookupBrand[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.get<LookupResponse>(
          "/api/tenant/catalogue/lookup",
        );
        if (cancelled) return;
        setBrandLookup(Array.isArray(data?.brands) ? data.brands : null);
      } catch {
        if (cancelled) return;
        setBrandLookup(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Noms / références déjà pris dans le catalogue Arkyo (case-insensitive
  // dans le shared dialog).
  const arkyoNames = arkyoCableModels.map((m) => m.name);
  const arkyoReferences = arkyoCableModels
    .map((m) => m.reference)
    .filter((r): r is string => Boolean(r));

  // Source d'options fabricants : lookup enrichi si dispo, sinon fallback
  // sur les marques propres (sans logoUrl).
  const brandOptions: CablingFormBrandOption[] = brandLookup
    ? brandLookup.map((b) => ({
        id: b.id,
        name: b.name,
        logoUrl: b.logoUrl ?? null,
      }))
    : brands.map((b) => ({ id: b.id, name: b.name, logoUrl: null }));

  const handleSubmit = async (values: CablingFormValues) => {
    const name = values.name.trim();

    // Backup serveur — la vérif client temps réel est faite par la modale.
    const nameLower = name.toLowerCase();
    const conflictName = arkyoCableModels.find(
      (m) => m.name.toLowerCase() === nameLower,
    );
    if (conflictName) {
      throw new Error(
        "Un modèle de câble avec ce nom existe déjà dans le catalogue Arkyo.",
      );
    }

    const numOrNull = (raw: string, allowZero = false): number | null => {
      const t = raw.trim();
      if (!t) return null;
      const n = Number(t);
      if (!Number.isFinite(n)) return null;
      if (!allowZero && n <= 0) return null;
      if (allowZero && n < 0) return null;
      return n;
    };

    const payload: Record<string, unknown> = {
      name,
      reference: values.reference.trim() || null,
      functionId: values.functionId.trim() || null,
      brandId: values.brandId.trim() || null,
      impedance: numOrNull(values.impedance, true),
      bandwidthMHz: numOrNull(values.bandwidthMHz, true),
      diameterMm: numOrNull(values.diameterMm),
      conductor: values.conductor.trim() || null,
      shielding: values.shielding.trim() || null,
      jacketMaterial: values.jacketMaterial.trim() || null,
      fireRating: values.fireRating.trim() || null,
      notes: values.notes.trim() || null,
      // customFields conservés tels quels (pas d'UI builder pour l'instant).
      customFields: editing?.customFields ?? [],
      isActive: true,
    };

    // Important : ne soumettre imageUrl/datasheetUrl que s'ils sont non vides.
    // L'API valide en .url() — une chaîne vide casserait la validation.
    const imageUrl = values.imageUrl.trim();
    const datasheetUrl = values.datasheetUrl.trim();
    if (imageUrl) payload.imageUrl = imageUrl;
    if (datasheetUrl) payload.datasheetUrl = datasheetUrl;

    if (editing) {
      // En PATCH, on envoie aussi explicitement null pour effacer une URL existante.
      if (!imageUrl) payload.imageUrl = null;
      if (!datasheetUrl) payload.datasheetUrl = null;
      await api.patch(`/api/tenant/parametres/cabling/${editing.id}`, payload);
      toast.success("Modèle de câble modifié.");
    } else {
      await api.post("/api/tenant/parametres/cabling", payload);
      toast.success("Modèle de câble créé.");
    }
    onSaved();
  };

  return (
    <SharedCablingFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? "edit" : "create"}
      initial={
        editing
          ? {
              id: editing.id,
              name: editing.name,
              reference: editing.reference,
              functionId: editing.functionId,
              brandId: editing.brandId,
              impedance: editing.impedance,
              bandwidthMHz: editing.bandwidthMHz,
              diameterMm: editing.diameterMm,
              conductor: editing.conductor,
              shielding: editing.shielding,
              jacketMaterial: editing.jacketMaterial,
              fireRating: editing.fireRating,
              imageUrl: editing.imageUrl,
              datasheetUrl: editing.datasheetUrl,
              notes: editing.notes,
            }
          : null
      }
      functionOptions={functions.map((f) => ({
        id: f.id,
        label: f.label,
        color: f.color,
      }))}
      brandOptions={brandOptions}
      existingNames={arkyoNames}
      existingReferences={arkyoReferences}
      onSubmit={handleSubmit}
    />
  );
}
