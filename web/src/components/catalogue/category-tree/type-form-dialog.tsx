"use client";

/**
 * TypeFormDialog — modale create/edit partagée pour CatalogType (supervisor)
 * et TenantType (tenant).
 *
 * Le parent fournit la liste `functionOptions` :
 *  - supervisor : uniquement les CatalogFunction (Arkyo).
 *  - tenant : fusion CatalogFunction + TenantFunction. Côté UI on n'affiche
 *    plus de badge "arkyo/perso" — l'origine n'a pas d'intérêt fonctionnel
 *    pour le choix d'une fonction.
 *
 * Le tenant accepte `functionId` vide (rattachement optionnel) — option
 * « Aucune » rendue si `allowNone` est true.
 *
 * Vérification anti-doublon temps réel :
 *  - le parent passe `existingNames` (liste case-insensitive de noms déjà
 *    pris ailleurs — typiquement catalogue Arkyo côté tenant). Dès la
 *    saisie, un message d'erreur s'affiche sous le champ et le bouton
 *    de soumission est désactivé.
 */

import { useEffect, useMemo, useState } from "react";
import { CornerDownRight, Image as ImageIcon, Layers, Shapes, Trash2 } from "@/components/ui/icons";
import {
  FunctionPickerModal,
  FunctionPickerTrigger,
} from "@/components/catalogue/function-picker-modal";
import {
  TypePickerModal,
  TypePickerTrigger,
  type TypePickerType,
} from "@/components/catalogue/type-picker-modal";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { RequiredPill } from "@/components/ui/form-field";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";
import { cn } from "@/lib/utils";
import {
  TYPE_ICONS,
  TYPE_ICON_GROUPS,
  getTypeIcon,
  isIconUrl,
  type TypeIconEntry,
} from "@/lib/type-icons";

export type TypeFunctionOption = {
  id: string;
  label: string;
  color: string;
  /**
   * Origine de la fonction. Conservée pour compat avec les appelants mais
   * plus exploitée visuellement (pas de badge).
   */
  source?: "arkyo" | "personal";
};

const baseSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(100),
  functionId: z.string(),
  /** Type parent (racine) — null = type racine ; défini = sous-type
   *  (profondeur 1). La fonction est héritée du parent (l'API la re-fixe). */
  parentId: z.string().nullable().optional(),
  /** Identifiant d'icône (id curated OU URL). Null/undefined = pas d'icône par défaut. */
  iconId: z.string().nullable().optional(),
  /** URL d'image (schéma de principe par défaut, héritée). */
  schemaImageUrl: z.string().nullable().optional(),
});

export type TypeFormValues = z.infer<typeof baseSchema>;

/** Option « type parent » — un type racine candidat au rattachement. */
export type TypeParentOption = { id: string; name: string; functionId: string };

export type TypeFormInitial = {
  id?: string;
  name?: string;
  functionId?: string | null;
  parentId?: string | null;
  iconId?: string | null;
  schemaImageUrl?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: TypeFormInitial | null;
  functionOptions: TypeFunctionOption[];
  /** Types racines candidats au rattachement (sous-type). Vide = feature off. */
  parentOptions?: TypeParentOption[];
  /** Si false, la section « Type parent » est masquée — ex. un type qui a
   *  déjà des enfants ne peut pas devenir sous-type. Défaut: true. */
  allowParent?: boolean;
  /** Si true, ajoute une option « Aucune » (tenant). Défaut: false (supervisor). */
  allowNone?: boolean;
  /** Tooltip optionnel sur le label de la section Fonction. */
  functionTooltip?: string;
  /** Libellé de la section fonction. Défaut « Catégorie de rattachement »
   *  (tenant) ; le supervisor passe « Fonction de rattachement ». */
  functionSectionLabel?: string;
  /** Si true, fonction requise (zod custom error). Défaut: true. */
  requireFunction?: boolean;
  /** Noms déjà pris (case-insensitive). Affiche une erreur inline en temps réel. */
  existingNames?: string[];
  onSubmit: (values: TypeFormValues) => Promise<void>;
  onDelete?: () => void;
  deleteLabel?: string;
};

export function TypeFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  functionOptions,
  parentOptions,
  allowParent = true,
  allowNone = false,
  functionTooltip,
  functionSectionLabel = "Catégorie de rattachement",
  requireFunction = true,
  existingNames,
  onSubmit,
  onDelete,
  deleteLabel = "Supprimer ce type",
}: Props) {
  const defaultValues = useMemo<TypeFormValues>(
    () => ({
      name: initial?.name ?? "",
      functionId: initial?.functionId ?? "",
      parentId: initial?.parentId ?? null,
      iconId: initial?.iconId ?? null,
      schemaImageUrl: initial?.schemaImageUrl ?? null,
    }),
    [initial],
  );

  const isEdit = mode === "edit";

  // Schéma dynamique : on raffine `functionId` selon `requireFunction`.
  // Supervisor → requis (Zod erreur inline) ; tenant → optionnel.
  const schema = useMemo(
    () =>
      requireFunction
        ? baseSchema.extend({
            functionId: z.string().min(1, "Catégorie requise."),
          })
        : baseSchema,
    [requireFunction],
  );

  const [hasConflict, setHasConflict] = useState(false);
  useEffect(() => {
    if (!open) setHasConflict(false);
  }, [open]);

  return (
    <FormDialog<TypeFormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Shapes />}
      eyebrow="TYPE"
      title={isEdit ? "Modifier le type" : "Nouveau type"}
      description={
        isEdit
          ? "Ajustez le nom du type et sa catégorie de rattachement."
          : "Donnez un nom au type et associez-le à une catégorie."
      }
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
      submitLabel={isEdit ? "Enregistrer" : "Créer le type"}
      submitDisabled={hasConflict}
      size="2xl"
      className="overflow-x-hidden"
    >
      {(form) => (
        <TypeFormBody
          form={form}
          functionOptions={functionOptions}
          parentOptions={parentOptions}
          allowParent={allowParent}
          initialId={initial?.id}
          allowNone={allowNone}
          functionTooltip={functionTooltip}
          functionSectionLabel={functionSectionLabel}
          requireFunction={requireFunction}
          existingNames={existingNames}
          onConflictChange={setHasConflict}
          isEdit={isEdit}
          onDelete={onDelete}
          deleteLabel={deleteLabel}
        />
      )}
    </FormDialog>
  );
}

// ── Body extrait pour permettre l'utilisation propre de hooks ────────────────

type BodyProps = {
  form: UseFormReturn<TypeFormValues>;
  functionOptions: TypeFunctionOption[];
  parentOptions: TypeParentOption[] | undefined;
  allowParent: boolean;
  initialId: string | undefined;
  allowNone: boolean;
  functionTooltip: string | undefined;
  functionSectionLabel: string;
  requireFunction: boolean;
  existingNames: string[] | undefined;
  onConflictChange: (hasConflict: boolean) => void;
  isEdit: boolean;
  onDelete: (() => void) | undefined;
  deleteLabel: string;
};

function TypeFormBody({
  form,
  functionOptions,
  parentOptions,
  allowParent,
  initialId,
  allowNone,
  functionTooltip,
  functionSectionLabel,
  requireFunction,
  existingNames,
  onConflictChange,
  isEdit,
  onDelete,
  deleteLabel,
}: BodyProps) {
  const nameConflictSet = useMemo(
    () => new Set((existingNames ?? []).map((n) => n.trim().toLowerCase())),
    [existingNames],
  );

  const functionId = form.watch("functionId");
  const parentId = form.watch("parentId") ?? null;
  const nameValue = form.watch("name");

  // ── Type parent (sous-type, profondeur 1) ───────────────────────────────
  // Candidats = types racines, hors le type édité lui-même. On les filtre par
  // la fonction sélectionnée (un sous-type reste dans la même fonction).
  const rootCandidates = useMemo(
    () => (parentOptions ?? []).filter((p) => p.id !== initialId),
    [parentOptions, initialId],
  );
  const parentCandidates = useMemo(
    () =>
      functionId
        ? rootCandidates.filter((p) => p.functionId === functionId)
        : rootCandidates,
    [rootCandidates, functionId],
  );
  const selectedParent = parentId
    ? rootCandidates.find((p) => p.id === parentId) ?? null
    : null;
  const functionLocked = selectedParent != null;
  const showParentSection = allowParent && rootCandidates.length > 0;
  const selectedFunctionColor =
    functionOptions.find((f) => f.id === functionId)?.color ?? "var(--accent)";
  const selectedFunction = functionOptions.find((f) => f.id === functionId) ?? null;

  // Nature du type : racine (défaut) ou sous-type. En mode « sous-type » le
  // picker de parent apparaît. Resync uniquement au changement d'item édité.
  const [typeKind, setTypeKind] = useState<"root" | "sub">(
    parentId != null ? "sub" : "root",
  );
  useEffect(() => {
    setTypeKind(parentId != null ? "sub" : "root");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  // Pickers fonction + type parent — mêmes composants que « Nouveau connecteur ».
  const [functionPickerOpen, setFunctionPickerOpen] = useState(false);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const parentTypesForPicker = useMemo<TypePickerType[]>(
    () =>
      parentCandidates.map((p) => ({
        id: p.id,
        name: p.name,
        functionId: p.functionId,
        parentId: null,
      })),
    [parentCandidates],
  );
  const selectedParentType =
    parentTypesForPicker.find((p) => p.id === parentId) ?? null;

  const nameHasConflict = useMemo(() => {
    const t = (nameValue ?? "").trim().toLowerCase();
    return t.length > 0 && nameConflictSet.has(t);
  }, [nameValue, nameConflictSet]);

  useEffect(() => {
    onConflictChange(nameHasConflict);
  }, [nameHasConflict, onConflictChange]);

  const nameErrorMessage =
    form.formState.errors.name?.message ??
    (nameHasConflict ? "Ce libellé existe déjà dans le catalogue Arkyo." : null);

  return (
    <>
      {/* Layout 2 colonnes :
            - Gauche  : Nom + Catégorie de rattachement
            - Droite  : Icône par défaut (picker + upload, plus visuel) */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
      <FormSection
        title={
          <>
            Nom du type <RequiredPill />
          </>
        }
      >
        <input
          autoFocus
          {...form.register("name")}
          placeholder="Caméra, Mixeur, Switch…"
          className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
        {nameErrorMessage && (
          <p className="text-xs text-[var(--destructive)]">{nameErrorMessage}</p>
        )}
      </FormSection>

      {showParentSection && (
        <FormSection
          title="Nature du type"
          tooltip="Un sous-type se rattache à un type racine de la même catégorie (profondeur 1). Sa catégorie est héritée du parent."
        >
          {/* Choix Racine / Sous-type — boutons à icône */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setTypeKind("root");
                form.setValue("parentId", null, { shouldDirty: true });
              }}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors",
                typeKind === "root"
                  ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              )}
            >
              <Layers className="h-4 w-4 shrink-0" />
              Racine
            </button>
            <button
              type="button"
              onClick={() => setTypeKind("sub")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors",
                typeKind === "sub"
                  ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              )}
            >
              <CornerDownRight className="h-4 w-4 shrink-0" />
              Sous-type
            </button>
          </div>
        </FormSection>
      )}

      <FormSection
        title={
          functionLocked ? (
            `${functionSectionLabel} · héritée du parent`
          ) : requireFunction ? (
            <>
              {functionSectionLabel} <RequiredPill />
            </>
          ) : (
            functionSectionLabel
          )
        }
        tooltip={functionTooltip}
      >
        {functionOptions.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)] italic">
            {allowNone
              ? "Aucune catégorie disponible — créez-en une dans l'onglet Catégories."
              : "Aucune catégorie disponible — créez-en une d'abord."}
          </p>
        ) : (
          <>
            <FunctionPickerTrigger
              fn={selectedFunction}
              placeholder="Choisir une catégorie"
              onClick={() => setFunctionPickerOpen(true)}
              error={form.formState.errors.functionId?.message}
              disabled={functionLocked}
              readOnly={functionLocked}
            />
            <FunctionPickerModal
              open={functionPickerOpen}
              onOpenChange={setFunctionPickerOpen}
              functions={functionOptions}
              selectedId={functionId || null}
              onSelect={(id) => {
                form.setValue("functionId", id ?? "", {
                  shouldDirty: true,
                  shouldValidate: true,
                });
                form.setValue("parentId", null, { shouldDirty: true });
              }}
            />
          </>
        )}
        {form.formState.errors.functionId && (
          <p className="mt-1 text-xs text-[var(--destructive)]">
            {form.formState.errors.functionId.message}
          </p>
        )}
      </FormSection>

      {showParentSection && typeKind === "sub" && (
        <FormSection
          title="Type parent"
          tooltip="Type racine auquel rattacher ce sous-type (même catégorie, profondeur 1)."
        >
          {!functionId ? (
            <p className="text-xs text-[var(--muted-foreground)] italic">
              Choisissez d&apos;abord une catégorie.
            </p>
          ) : parentCandidates.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)] italic">
              Aucun type racine dans cette catégorie — impossible d&apos;en faire un
              sous-type.
            </p>
          ) : (
            <>
              <TypePickerTrigger
                type={selectedParentType}
                accentColor={selectedFunctionColor}
                placeholder="Choisir le type parent"
                onClick={() => setParentPickerOpen(true)}
              />
              <TypePickerModal
                open={parentPickerOpen}
                onOpenChange={setParentPickerOpen}
                types={parentTypesForPicker}
                functionFilterId={functionId}
                accentColor={selectedFunctionColor}
                selectedId={parentId}
                onSelect={(id) => {
                  if (!id) {
                    form.setValue("parentId", null, { shouldDirty: true });
                    return;
                  }
                  const p = parentCandidates.find((c) => c.id === id);
                  form.setValue("parentId", id, { shouldDirty: true });
                  if (p) {
                    form.setValue("functionId", p.functionId, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }
                }}
              />
            </>
          )}
        </FormSection>
      )}
      </div>{/* fin colonne gauche */}

      {/* Colonne droite : Icône + Schéma de principe côte à côte (2 colonnes). */}
      <div className="grid min-w-0 grid-cols-2 gap-4 [&>*]:min-w-0">
        <FormSection
          title="Icône par défaut"
          tooltip="Image affichée comme placeholder sur les équipements de ce type qui n'ont pas leur propre icône. Visible également dans la légende des plans."
        >
          <TypeIconSection form={form} />
        </FormSection>

        <FormSection
          title="Schéma de principe par défaut"
          tooltip="Schéma affiché comme placeholder sur les équipements de ce type qui n'ont pas leur propre schéma."
        >
          <TypeSchemaSection form={form} />
        </FormSection>
      </div>{/* fin colonne droite */}
      </div>{/* fin grid 2 colonnes */}

      {isEdit && onDelete && (
        <div className="border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={onDelete}
            // arkyo-server: habillage Strata
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleteLabel}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Champ "Icône par défaut" du TypeFormDialog.
 *
 * UI : preview de l'icône courante + barre de filtre par groupe + grille des
 * icônes curated. Bouton "URL personnalisée" pour saisir une image custom.
 * Bouton "Aucune" pour effacer.
 */
/**
 * Section "Icône par défaut" : switch Perso (défaut) / Bibliothèque.
 *  - Perso         → ImageCropUpload (URL uploadée)
 *  - Bibliothèque  → grille curated d'icônes lucide
 * Les deux modes écrivent dans `iconId` (URL si perso, id curated si biblio).
 */
function TypeIconSection({ form }: { form: UseFormReturn<TypeFormValues> }) {
  const iconId = form.watch("iconId") ?? null;
  // Par défaut "perso" (upload). Si la valeur courante est un id lucide curated,
  // on bascule en biblio à l'ouverture pour refléter l'état réel.
  const [mode, setMode] = useState<"perso" | "library">(
    iconId && !isIconUrl(iconId) ? "library" : "perso",
  );
  const [group, setGroup] = useState<TypeIconEntry["group"] | "all">("all");

  // Resync mode si la valeur change (ex. reset form / changement d'item).
  useEffect(() => {
    if (iconId && !isIconUrl(iconId)) setMode("library");
    else if (isIconUrl(iconId)) setMode("perso");
  }, [iconId]);

  const setIcon = (value: string | null) =>
    form.setValue("iconId", value, {
      shouldDirty: true,
      shouldValidate: true,
    });

  const filtered = useMemo(
    () =>
      group === "all"
        ? TYPE_ICONS
        : TYPE_ICONS.filter((it) => it.group === group),
    [group],
  );

  return (
    <div className="flex flex-col gap-3">
      <ModeSwitch mode={mode} onChange={setMode} />

      {mode === "perso" ? (
        <ImageCropUpload
          value={isIconUrl(iconId) ? (iconId ?? "") : ""}
          onChange={(url) => setIcon(url || null)}
          folder="catalog/types/icons"
          label="Icône"
          forceAspectRatio={1}
          className="max-w-[180px]"
        />
      ) : (
        <>
          {/* Filtre par groupe */}
          <div className="flex flex-wrap gap-1">
            <GroupChip
              label="Toutes"
              active={group === "all"}
              onClick={() => setGroup("all")}
            />
            {TYPE_ICON_GROUPS.map((g) => (
              <GroupChip
                key={g.id}
                label={g.label}
                active={group === g.id}
                onClick={() => setGroup(g.id)}
              />
            ))}
          </div>
          {/* Grille curated lucide — 5 colonnes pour s'adapter à la sous-
              colonne plus étroite (icône + schéma côte à côte). */}
          <div className="border-border max-h-48 min-w-0 overflow-y-auto rounded-md border p-2">
            <div
              className="grid justify-items-center gap-1"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2.25rem, 1fr))" }}
            >
              {filtered.map((it) => {
                const selected = iconId === it.id;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setIcon(it.id)}
                    title={it.label}
                    className={cn(
                      "border-border flex h-9 w-9 items-center justify-center rounded-md border transition-colors",
                      selected
                        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                        : "text-muted-foreground hover:border-[var(--accent)]/40 hover:text-foreground",
                    )}
                  >
                    <it.Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Section "Schéma de principe par défaut" : switch Perso (défaut) / Bibliothèque.
 *  - Perso         → ImageCropUpload
 *  - Bibliothèque  → liste prédéfinie (vide pour l'instant — extensible plus tard)
 */
function TypeSchemaSection({ form }: { form: UseFormReturn<TypeFormValues> }) {
  const schemaImageUrl = form.watch("schemaImageUrl") ?? null;
  const [mode, setMode] = useState<"perso" | "library">("perso");

  return (
    <div className="flex flex-col gap-3">
      <ModeSwitch mode={mode} onChange={setMode} />

      {mode === "perso" ? (
        <ImageCropUpload
          value={schemaImageUrl ?? ""}
          onChange={(url) =>
            form.setValue("schemaImageUrl", url || null, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          folder="catalog/types/schemas"
          label="Schéma de principe"
          forceAspectRatio={1}
          className="max-w-[180px]"
        />
      ) : (
        <div className="border-border rounded-md border bg-[var(--muted)]/20 px-3 py-6 text-center">
          <p className="text-muted-foreground text-[11px]">
            Aucun schéma en bibliothèque pour l'instant.
          </p>
          <p className="text-muted-foreground/70 mt-1 text-[10px]">
            Bascule sur « Image perso » pour uploader le schéma.
          </p>
        </div>
      )}
    </div>
  );
}

/** Switch Perso / Bibliothèque (style aligné sur les autres toggles du form). */
function ModeSwitch({
  mode,
  onChange,
}: {
  mode: "perso" | "library";
  onChange: (m: "perso" | "library") => void;
}) {
  return (
    <div className="border-border flex gap-1 rounded-md border p-0.5">
      <button
        type="button"
        onClick={() => onChange("perso")}
        className={cn(
          "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
          mode === "perso"
            ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Image perso
      </button>
      <button
        type="button"
        onClick={() => onChange("library")}
        className={cn(
          "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
          mode === "library"
            ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Bibliothèque
      </button>
    </div>
  );
}

function GroupChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
          : "border-border text-muted-foreground hover:border-[var(--accent)]/40",
      )}
    >
      {label}
    </button>
  );
}
