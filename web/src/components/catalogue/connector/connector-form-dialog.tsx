"use client";

/**
 * ConnectorFormDialog — modale create/edit partagée pour CatalogConnectorType
 * (supervisor) et TenantConnectorType (tenant).
 *
 * Layout (refonte alignée sur le catalogue) :
 *   - Header eyebrow "CONNECTEUR" + titre dynamique (« Modifier "Nom" » /
 *     « Nouveau connecteur »), modale `lg` (max-w-2xl).
 *   - Corps mono-colonne : Icône (PickerTrigger + aperçu du symbole choisi),
 *     Nom, Fonctions (FunctionMultiPickerTrigger → modal), Versions (chips).
 *   - L'aperçu du symbole affiche ses deux versions côte à côte quand elles
 *     existent (générique + Neutrik D, comme l'onglet Symboles superviseur) :
 *     builtin via ConnectorIcon (`dType`), custom via <img> (svgUrl / svgUrlD).
 *     La dispo D est ainsi portée visuellement — aucun libellé texte.
 *   - Footer Annuler / Enregistrer géré par FormDialog.
 *
 * Pickers réutilisés :
 *   - ConnectorIconPickerModal + ConnectorIconPickerTrigger
 *     (components/catalogue/connector-icon-picker-modal.tsx)
 *   - FunctionMultiPickerModal + FunctionMultiPickerTrigger
 *     (components/catalogue/function-multi-picker-modal.tsx) — même pattern
 *     que la fonction principale du wizard équipement (trigger → modal).
 *
 * Catégories :
 *   - Sélection multi via trigger bouton → modal multi-select (coche bleue
 *     overlay sur les items sélectionnés). Pattern identique au picker
 *     « Fonction principale » de l'éditeur équipement.
 *
 * Vérification anti-doublon temps réel :
 *   Le parent passe `existingNames` (case-insensitive). Dès la saisie, message
 *   d'erreur inline + bouton submit désactivé via `submitDisabled`.
 *
 * Le champ `color` est conservé pour compat ascendante du payload (le
 * supervisor le persiste en DB) — valeur constante côté UI.
 */

import { useEffect, useMemo, useState } from "react";
import { Plug, Plus, X } from "@/components/ui/icons";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { ConnectorIcon, D_TYPE_KEYS } from "@/components/ui/connector-icon";
import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import {
  ConnectorIconPickerModal,
  ConnectorIconPickerTrigger,
  type ConnectorIconPickerValue,
} from "@/components/catalogue/connector-icon-picker-modal";
import {
  FunctionMultiPickerModal,
  FunctionMultiPickerTrigger,
} from "@/components/catalogue/function-multi-picker-modal";
import { cn } from "@/lib/utils";

// ── Schema ──────────────────────────────────────────────────────────────────

const baseSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis.").max(100),
    /** Source visuelle au choix : "icon" → iconId, "svg" → svgUrl. */
    iconSource: z.enum(["icon", "svg"]).default("icon"),
    iconId: z.string(),
    svgUrl: z.string(),
    /**
     * Conservé pour compat ascendante côté payload API (le supervisor persiste
     * encore `color` en DB). Plus aucun color picker côté UI : sortie constante.
     */
    color: z.string(),
    versions: z.array(z.string()),
    functionIds: z.array(z.string()),
  })
  .superRefine((val, ctx) => {
    if (val.iconSource === "icon" && !val.iconId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["iconId"],
        message: "Sélectionnez une icône.",
      });
    }
    if (val.iconSource === "svg" && !val.svgUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["svgUrl"],
        message: "Fournissez un SVG personnalisé.",
      });
    }
  });

/**
 * Valeur par défaut transmise dans le payload `color` pour préserver la
 * compatibilité ascendante avec le backend. Aucun rendu visuel ne dépend
 * de cette valeur (cf. ConnectorCard — passé en monochrome).
 */
const DEFAULT_CONNECTOR_COLOR = "#a3a3a3";

export type ConnectorFormValues = z.infer<typeof baseSchema>;

export type ConnectorFormInitial = {
  id?: string;
  name?: string;
  iconId?: string | null;
  svgUrl?: string | null;
  color?: string | null;
  versions?: string[];
  functionIds?: string[];
};

export type ConnectorFormFunctionOption = {
  id: string;
  label: string;
  color: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: ConnectorFormInitial | null;
  /** Catégories disponibles (multi-select sous forme de chips). */
  functionOptions?: ConnectorFormFunctionOption[];
  /** Noms déjà pris (case-insensitive). Affiche une erreur inline temps réel. */
  existingNames?: string[];
  /** Soumission appelée par FormDialog — peut throw pour afficher l'erreur. */
  onSubmit: (values: ConnectorFormValues) => Promise<void>;
  /**
   * Conservés sur l'API publique pour rétro-compat des callers existants
   * (supervisor + tenant). Ignorés ici : la suppression se fait désormais
   * depuis la card parente via PersonalCardActions.
   * @deprecated — n'utilisez plus ces props depuis l'extérieur.
   */
  onDelete?: () => void;
  /** @deprecated — voir `onDelete`. */
  deleteLabel?: string;
};

export function ConnectorFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  functionOptions,
  existingNames,
  onSubmit,
  onDelete: _onDelete,
  deleteLabel: _deleteLabel,
}: Props) {
  // Props dépréciées — voir Props.onDelete / Props.deleteLabel.
  void _onDelete;
  void _deleteLabel;
  const defaultValues = useMemo<ConnectorFormValues>(
    () => ({
      name: initial?.name ?? "",
      iconSource: initial?.svgUrl ? "svg" : "icon",
      iconId: initial?.iconId ?? "",
      svgUrl: initial?.svgUrl ?? "",
      color: initial?.color ?? DEFAULT_CONNECTOR_COLOR,
      versions: Array.isArray(initial?.versions) ? initial.versions : [],
      functionIds: Array.isArray(initial?.functionIds)
        ? initial.functionIds
        : [],
    }),
    [initial],
  );

  const isEdit = mode === "edit";

  // État de conflit anti-doublon remonté depuis le body via callback.
  const [hasConflict, setHasConflict] = useState(false);

  useEffect(() => {
    if (!open) {
      setHasConflict(false);
    }
  }, [open]);

  const title = isEdit
    ? `Modifier « ${initial?.name?.trim() || "Connecteur"} »`
    : "Nouveau connecteur";

  return (
    <FormDialog<ConnectorFormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Plug />}
      eyebrow="CONNECTEUR"
      title={title}
      schema={baseSchema}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
      submitLabel={isEdit ? "Enregistrer" : "Créer le connecteur"}
      submitDisabled={hasConflict}
      size="lg"
    >
      {(form) => (
        <ConnectorFormBody
          form={form}
          functionOptions={functionOptions ?? []}
          existingNames={existingNames}
          onConflictChange={setHasConflict}
        />
      )}
    </FormDialog>
  );
}

// ── Body extrait pour permettre l'utilisation propre de hooks ────────────────

type BodyProps = {
  form: UseFormReturn<ConnectorFormValues>;
  functionOptions: ConnectorFormFunctionOption[];
  existingNames: string[] | undefined;
  onConflictChange: (hasConflict: boolean) => void;
};

function ConnectorFormBody({
  form,
  functionOptions,
  existingNames,
  onConflictChange,
}: BodyProps) {
  const nameConflictSet = useMemo(
    () => new Set((existingNames ?? []).map((n) => n.trim().toLowerCase())),
    [existingNames],
  );

  const nameValue = form.watch("name");
  const iconSource = form.watch("iconSource");
  const iconId = form.watch("iconId");
  const svgUrl = form.watch("svgUrl");
  const versions = form.watch("versions") ?? [];
  const selectedFunctionIds = form.watch("functionIds") ?? [];

  // Aperçu du symbole choisi = générique + (si dispo) version Neutrik D :
  //  - builtin → générique par `iconId`, D par `dType` si iconId ∈ D_TYPE_KEYS ;
  //  - custom  → générique par `svgUrl`, D par `svgUrlD` propagé par le picker.
  // À l'édition d'un connecteur à symbole custom, l'URL D n'est connue qu'après
  // ré-ouverture du picker ; le générique seul est affiché d'ici là.
  const [customSvgUrlD, setCustomSvgUrlD] = useState<string | null>(null);

  const hasChosenSymbol = iconSource === "icon" ? !!iconId : !!svgUrl;
  const showDVersion =
    iconSource === "icon" ? D_TYPE_KEYS.has(iconId) : customSvgUrlD != null;

  // Conflit anti-doublon (case-insensitive)
  const nameHasConflict = useMemo(() => {
    const t = (nameValue ?? "").trim().toLowerCase();
    return t.length > 0 && nameConflictSet.has(t);
  }, [nameValue, nameConflictSet]);

  useEffect(() => {
    onConflictChange(nameHasConflict);
  }, [nameHasConflict, onConflictChange]);

  // État ouverture des modales pickers
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [functionPickerOpen, setFunctionPickerOpen] = useState(false);

  const nameErrorMessage =
    form.formState.errors.name?.message ??
    (nameHasConflict
      ? "Ce connecteur existe déjà dans le catalogue Arkyo."
      : null);

  const iconErrorMessage =
    iconSource === "icon"
      ? form.formState.errors.iconId?.message
      : form.formState.errors.svgUrl?.message;

  // Valeur courante du picker d'icône. `svgUrlD` embarque l'URL D d'un symbole
  // custom pour la préserver au round-trip (confirmer sans changer d'icône).
  const iconValue: ConnectorIconPickerValue = useMemo(
    () => ({
      source: iconSource,
      iconId,
      svgUrl,
      svgUrlD: iconSource === "svg" ? customSvgUrlD : null,
    }),
    [iconSource, iconId, svgUrl, customSvgUrlD],
  );

  const handleIconChange = (next: ConnectorIconPickerValue) => {
    form.setValue("iconSource", next.source, { shouldDirty: true });
    form.setValue("iconId", next.iconId, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("svgUrl", next.svgUrl, {
      shouldDirty: true,
      shouldValidate: true,
    });
    // Builtin → version D via D_TYPE_KEYS ; custom → on retient l'URL D renvoyée
    // par le picker (URL saisie à la main → pas de version D).
    setCustomSvgUrlD(next.source === "svg" ? (next.svgUrlD ?? null) : null);
  };

  return (
    <>
      {/* ── Formulaire mono-colonne ───────────────────────────────────── */}
      <div className="space-y-5">
        <FormSection title="Icône">
          <ConnectorIconPickerTrigger
            value={iconValue}
            onClick={() => setIconPickerOpen(true)}
            error={iconErrorMessage}
          />
          {hasChosenSymbol && (
            <div className="mt-3 flex items-center justify-center rounded-xl border border-[var(--border)]/60 bg-[var(--secondary)]/30 p-4">
              {showDVersion ? (
                <div className="flex items-center justify-center gap-3">
                  <SymbolFacePreview
                    source={iconSource}
                    iconId={iconId}
                    svgUrl={svgUrl}
                    variant="generic"
                    size={44}
                  />
                  <span className="h-9 w-px shrink-0 bg-[var(--border)]" />
                  <SymbolFacePreview
                    source={iconSource}
                    iconId={iconId}
                    svgUrl={svgUrl}
                    svgUrlD={customSvgUrlD}
                    variant="d"
                    size={44}
                  />
                </div>
              ) : (
                <SymbolFacePreview
                  source={iconSource}
                  iconId={iconId}
                  svgUrl={svgUrl}
                  variant="generic"
                  size={52}
                />
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="Nom *">
          <input
            id="connector-name"
            autoFocus
            {...form.register("name")}
            placeholder="XLR 3, BNC, RJ45…"
            className={cn(
              "flex h-11 w-full rounded-lg border bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
              nameErrorMessage
                ? "border-[var(--destructive)]"
                : "border-[var(--border)]",
            )}
          />
          {nameErrorMessage && (
            <p className="text-[11px] text-[var(--destructive)]">
              {nameErrorMessage}
            </p>
          )}
        </FormSection>

        <FormSection title="Fonctions">
          {functionOptions.length === 0 ? (
            <p className="text-xs italic text-[var(--muted-foreground)]">
              Aucune fonction disponible.
            </p>
          ) : (
            <FunctionMultiPickerTrigger
              functions={functionOptions}
              selectedIds={selectedFunctionIds}
              placeholder="Sélectionner une fonction"
              onClick={() => setFunctionPickerOpen(true)}
            />
          )}
        </FormSection>

        <FormSection title="Versions">
          <VersionsEditor
            values={versions}
            onChange={(next) =>
              form.setValue("versions", next, { shouldDirty: true })
            }
          />
        </FormSection>
      </div>

      {/* ── Modales pickers ────────────────────────────────────────────── */}
      <ConnectorIconPickerModal
        open={iconPickerOpen}
        onOpenChange={setIconPickerOpen}
        value={iconValue}
        onChange={handleIconChange}
      />
      <FunctionMultiPickerModal
        open={functionPickerOpen}
        onOpenChange={setFunctionPickerOpen}
        functions={functionOptions}
        selectedIds={selectedFunctionIds}
        onChange={(ids) =>
          form.setValue("functionIds", ids, { shouldDirty: true })
        }
      />
    </>
  );
}

// ── SymbolFacePreview ─────────────────────────────────────────────────────────
//
// Aperçu d'une face du symbole courant (générique ou Neutrik D), aligné sur le
// rendu des cartes de l'onglet Symboles superviseur. Builtin → ConnectorIcon
// (version D via `dType`) ; custom → <img> (générique `svgUrl` / D `svgUrlD`).

function SymbolFacePreview({
  source,
  iconId,
  svgUrl,
  svgUrlD,
  variant,
  size,
}: {
  source: "icon" | "svg";
  iconId: string;
  svgUrl: string;
  svgUrlD?: string | null;
  variant: "generic" | "d";
  size: number;
}) {
  if (source === "icon") {
    return (
      <ConnectorIcon
        iconId={iconId}
        dType={variant === "d"}
        color="var(--foreground)"
        size={size}
      />
    );
  }
  const src = variant === "d" ? svgUrlD : svgUrl;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src ?? ""}
      alt=""
      style={{ width: size, height: size }}
      className="object-contain"
    />
  );
}

// ── VersionsEditor ──────────────────────────────────────────────────────────
//
// Chips éditables. Click sur la chip → suppression. Bouton "+ Ajouter"
// révèle un input inline pour saisir une nouvelle version.

function VersionsEditor({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      setDraft("");
      return;
    }
    if (values.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  };

  const remove = (v: string) => onChange(values.filter((x) => x !== v));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => remove(v)}
          className="group/chip inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 px-2 py-1 text-[11px] font-medium transition-colors hover:border-[var(--destructive)]/40 hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
          title={`Supprimer « ${v} »`}
        >
          <span>{v}</span>
          <X className="h-3 w-3 opacity-50 group-hover/chip:opacity-100" />
        </button>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            commit();
            setAdding(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              setAdding(false);
            } else if (e.key === "Escape") {
              setAdding(false);
              setDraft("");
            }
          }}
          placeholder="75Ω, Cat 6a…"
          className="h-7 w-28 rounded-lg border border-[var(--accent)] bg-transparent px-2 text-[11px] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
        >
          <Plus className="h-3 w-3" />
          ajouter
        </button>
      )}
    </div>
  );
}
