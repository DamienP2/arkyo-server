"use client";

/**
 * SignalFormDialog — modale create/edit partagée pour CatalogSignalType
 * (supervisor) et TenantSignalType (tenant).
 *
 * Layout (modale `2xl` = max-w-6xl, 2 colonnes responsive) :
 *   - Header eyebrow "SIGNAL" + titre dynamique (« Modifier "Nom" » /
 *     « Nouveau signal »).
 *   - Body : grid `lg:grid-cols-2 gap-x-8 gap-y-5`.
 *       Colonne gauche (identité / classification) :
 *         - Identité — Nom (input, vérif anti-doublon temps réel).
 *         - Fonction (picker single via FunctionPickerTrigger →
 *           FunctionPickerModal).
 *         - Connecteurs compatibles — trigger qui ouvre
 *           `ConnectorMultiPickerModal`. Toujours rendue ; trigger désactivé
 *           tant qu'aucune fonction n'est choisie (placeholder « Choisir
 *           d'abord une fonction »). La liste affichée est filtrée pour ne
 *           montrer que les connecteurs rattachés à la fonction sélectionnée.
 *         - Numérotation câble (2 sous-colonnes) : Préfixe / Suffixe.
 *           Placeholders affichent les valeurs héritées de la fonction si vide.
 *       Colonne droite (format physique & capacités) :
 *         - Format physique : 2 FormatCards radio exclusif Baseband / IP
 *           (pattern identique à `ConnectorFormDialog`).
 *         - Sous-section dépendante du format :
 *             baseband → Bande passante + Impédance + min MHz.
 *             IP       → ActionSwitch redondance (+ segmented style) et,
 *                        uniquement pour les signaux dont le nom contient
 *                        « 2110 », ActionSwitch multicast.
 *   - Footer Annuler / Enregistrer géré par FormDialog.
 *
 * Vérification anti-doublon temps réel :
 *   Le parent passe `existingNames` (case-insensitive). Dès la saisie, message
 *   d'erreur inline + bouton submit désactivé via `submitDisabled`.
 *
 * Champs requis (bouton submit bloqué tant que non remplis) :
 *   - `name` non vide et non en doublon.
 *   - `functionId` non vide.
 *   - `connectors` au moins 1 élément.
 */

import { useEffect, useMemo, useState } from "react";
import { Cable, Check, Network, Waves } from "@/components/ui/icons";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { ActionSwitch } from "@/components/synoptique/components/property-patterns";
import {
  FunctionPickerModal,
  FunctionPickerTrigger,
  type FunctionPickerFunction,
} from "@/components/catalogue/function-picker-modal";
import {
  ConnectorMultiPickerModal,
  ConnectorMultiPickerTrigger,
} from "@/components/catalogue/connector-multi-picker-modal";
import { cn } from "@/lib/utils";

// ── Schema ──────────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(100),
  functionId: z.string().min(1, "La fonction est obligatoire."),
  cablePrefix: z.string(),
  cableSuffix: z.string(),
  bandwidth: z.string(),
  /** Stockés en string dans le form (les inputs HTML sont des strings).
   *  Convertis en Float|null au submit. Vide = pas de contrainte. */
  requiredImpedance: z.string(),
  minBandwidthMHz: z.string(),
  color: z.string(),
  connectors: z
    .array(z.string())
    .min(1, "Au moins un connecteur compatible est obligatoire."),
  isIp: z.boolean().default(false),
  supportsRedundancy: z.boolean().default(false),
  redundancyStyle: z
    .enum(["AB", "PRIMARY_SECONDARY", "BLUE_RED"])
    .default("AB"),
  usesMulticast: z.boolean().default(false),
});

export type SignalFormValues = z.infer<typeof schema>;

export type SignalFormInitial = {
  id?: string;
  name?: string;
  functionId?: string | null;
  cablePrefix?: string | null;
  cableSuffix?: string | null;
  bandwidth?: string | null;
  requiredImpedance?: number | null;
  minBandwidthMHz?: number | null;
  color?: string | null;
  connectors?: string[];
  isIp?: boolean;
  supportsRedundancy?: boolean;
  redundancyStyle?: "AB" | "PRIMARY_SECONDARY" | "BLUE_RED" | null;
  usesMulticast?: boolean;
};

export type SignalFormFunctionOption = {
  id: string;
  label: string;
  color: string;
  key?: string;
  cablePrefix?: string | null;
  cableSuffix?: string | null;
};

export type SignalFormConnectorOption = {
  id: string;
  name: string;
  iconId: string | null;
  svgUrl: string | null;
  color: string | null;
  /** Fonctions auxquelles ce connecteur est rattaché — conservé sur l'API
   *  pour rétro-compat. Plus utilisé pour filtrer la grille (l'utilisateur
   *  voit tous les connecteurs disponibles). */
  functionIds: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: SignalFormInitial | null;
  /** Catégories (fonctions) disponibles pour le picker. */
  functionOptions?: SignalFormFunctionOption[];
  /** Connecteurs disponibles pour la grille de sélection. */
  connectorOptions?: SignalFormConnectorOption[];
  /** Noms déjà pris (case-insensitive). Affiche une erreur inline temps réel. */
  existingNames?: string[];
  /** Soumission appelée par FormDialog — peut throw pour afficher l'erreur. */
  onSubmit: (values: SignalFormValues) => Promise<void>;
};

export function SignalFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  functionOptions,
  connectorOptions,
  existingNames,
  onSubmit,
}: Props) {
  const defaultValues = useMemo<SignalFormValues>(
    () => ({
      name: initial?.name ?? "",
      functionId: initial?.functionId ?? "",
      cablePrefix: initial?.cablePrefix ?? "",
      cableSuffix: initial?.cableSuffix ?? "",
      bandwidth: initial?.bandwidth ?? "",
      requiredImpedance:
        initial?.requiredImpedance != null
          ? String(initial.requiredImpedance)
          : "",
      minBandwidthMHz:
        initial?.minBandwidthMHz != null ? String(initial.minBandwidthMHz) : "",
      color: initial?.color ?? "",
      connectors: Array.isArray(initial?.connectors) ? initial.connectors : [],
      isIp: initial?.isIp ?? false,
      supportsRedundancy: initial?.supportsRedundancy ?? false,
      redundancyStyle: (initial?.redundancyStyle ?? "AB") as
        | "AB"
        | "PRIMARY_SECONDARY"
        | "BLUE_RED",
      usesMulticast: initial?.usesMulticast ?? false,
    }),
    [initial],
  );

  const isEdit = mode === "edit";

  // État de conflit anti-doublon + état d'invalidité de la sélection
  // (fonction / connecteurs) — remontés depuis le body via callbacks.
  const [hasConflict, setHasConflict] = useState(false);
  const [selectionInvalid, setSelectionInvalid] = useState(true);

  useEffect(() => {
    if (!open) {
      setHasConflict(false);
      setSelectionInvalid(true);
    }
  }, [open]);

  const title = isEdit
    ? `Modifier « ${initial?.name?.trim() || "Signal"} »`
    : "Nouveau signal";

  return (
    <FormDialog<SignalFormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Waves />}
      eyebrow="SIGNAL"
      title={title}
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
      submitLabel={isEdit ? "Enregistrer" : "Créer le signal"}
      submitDisabled={hasConflict || selectionInvalid}
      size="2xl"
    >
      {(form) => (
        <SignalFormBody
          form={form}
          functionOptions={functionOptions ?? []}
          connectorOptions={connectorOptions ?? []}
          existingNames={existingNames}
          onConflictChange={setHasConflict}
          onSelectionInvalidChange={setSelectionInvalid}
        />
      )}
    </FormDialog>
  );
}

// ── Body extrait pour permettre l'utilisation propre de hooks ────────────────

type BodyProps = {
  form: UseFormReturn<SignalFormValues>;
  functionOptions: SignalFormFunctionOption[];
  connectorOptions: SignalFormConnectorOption[];
  existingNames: string[] | undefined;
  onConflictChange: (hasConflict: boolean) => void;
  onSelectionInvalidChange: (invalid: boolean) => void;
};

function SignalFormBody({
  form,
  functionOptions,
  connectorOptions,
  existingNames,
  onConflictChange,
  onSelectionInvalidChange,
}: BodyProps) {
  const nameConflictSet = useMemo(
    () => new Set((existingNames ?? []).map((n) => n.trim().toLowerCase())),
    [existingNames],
  );

  const nameValue = form.watch("name");
  const functionId = form.watch("functionId");
  const isIp = form.watch("isIp") ?? false;
  const supportsRedundancy = form.watch("supportsRedundancy") ?? false;
  const usesMulticast = form.watch("usesMulticast") ?? false;
  const selectedConnectors = form.watch("connectors") ?? [];
  const cablePrefixValue = form.watch("cablePrefix") ?? "";
  const cableSuffixValue = form.watch("cableSuffix") ?? "";

  // Affiche les messages d'erreur inline seulement après une 1ʳᵉ tentative
  // de submit (évite le bruit visuel à l'ouverture). Le bouton submit reste
  // désactivé tant que la sélection est invalide.
  const submitCount = form.formState.submitCount;
  const saveAttempted = submitCount > 0;

  // Reset auto du multicast si on quitte le mode IP.
  useEffect(() => {
    if (usesMulticast && !isIp) {
      form.setValue("usesMulticast", false, { shouldDirty: true });
    }
  }, [usesMulticast, isIp, form]);

  // Conflit anti-doublon (case-insensitive)
  const nameHasConflict = useMemo(() => {
    const t = (nameValue ?? "").trim().toLowerCase();
    return t.length > 0 && nameConflictSet.has(t);
  }, [nameValue, nameConflictSet]);

  useEffect(() => {
    onConflictChange(nameHasConflict);
  }, [nameHasConflict, onConflictChange]);

  // Selection validity (fonction + ≥1 connecteur) — synchronise le parent
  // pour qu'il puisse désactiver le bouton submit en plus du resolver Zod.
  const selectionInvalid =
    !functionId || (selectedConnectors?.length ?? 0) === 0;
  useEffect(() => {
    onSelectionInvalidChange(selectionInvalid);
  }, [selectionInvalid, onSelectionInvalidChange]);

  const [functionPickerOpen, setFunctionPickerOpen] = useState(false);
  const [connectorPickerOpen, setConnectorPickerOpen] = useState(false);

  const selectedFn = useMemo(
    () => functionOptions.find((f) => f.id === functionId) ?? null,
    [functionOptions, functionId],
  );

  // Connecteurs filtrés par fonction — seuls ceux rattachés à la fonction
  // choisie sont éligibles. Si aucune fonction, la section est cachée.
  const eligibleConnectors = useMemo(
    () =>
      functionId
        ? connectorOptions.filter((c) => c.functionIds.includes(functionId))
        : [],
    [connectorOptions, functionId],
  );

  // Élague la sélection de connecteurs quand la fonction change : on retire
  // ceux qui ne sont plus rattachés à la nouvelle fonction. Si aucun ne
  // reste, l'utilisateur devra recliquer dans le picker — ce qui est sain
  // (la validation min(1) bloque le submit).
  const eligibleIdsKey = useMemo(
    () => eligibleConnectors.map((c) => c.id).join("|"),
    [eligibleConnectors],
  );
  useEffect(() => {
    if (!functionId) return;
    const eligibleIds = new Set(eligibleConnectors.map((c) => c.id));
    const cur = form.getValues("connectors") ?? [];
    const next = cur.filter((id) => eligibleIds.has(id));
    if (next.length !== cur.length) {
      form.setValue("connectors", next, { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [functionId, eligibleIdsKey]);

  const nameErrorMessage =
    form.formState.errors.name?.message ??
    (nameHasConflict
      ? "Ce signal existe déjà dans le catalogue Arkyo."
      : null);

  return (
    <>
      {/* ── Grid 2 colonnes : gauche = identité/classification, droite = format physique ── */}
      <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
        {/* ── Colonne gauche ─────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* ── Identité ──────────────────────────────────────────── */}
          <FormSection title="Nom *">
            <input
              autoFocus
              {...form.register("name")}
              placeholder="12G-SDI, Dante, AES67, ST 2110-20…"
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

          {/* ── Fonction (picker single via modal) ─────────────────── */}
          <FormSection title="Fonction *">
            {functionOptions.length === 0 ? (
              <p className="text-xs italic text-[var(--muted-foreground)]">
                Aucune fonction disponible.
              </p>
            ) : (
              <FunctionPickerTrigger
                fn={
                  selectedFn
                    ? ({
                        id: selectedFn.id,
                        label: selectedFn.label,
                        color: selectedFn.color,
                        key: selectedFn.key,
                      } as FunctionPickerFunction)
                    : null
                }
                placeholder="Sélectionner une fonction"
                onClick={() => setFunctionPickerOpen(true)}
                error={
                  saveAttempted && !functionId
                    ? "La fonction est obligatoire."
                    : undefined
                }
              />
            )}
          </FormSection>

          {/* ── Connecteurs compatibles ────────────────────────────── */}
          <FormSection title="Connecteurs compatibles *">
            <ConnectorMultiPickerTrigger
              connectors={eligibleConnectors.map((c) => ({
                id: c.id,
                name: c.name,
                color: c.color,
                iconId: c.iconId,
                functionIds: c.functionIds,
              }))}
              selectedIds={selectedConnectors}
              placeholder={
                functionId
                  ? "Sélectionner un ou plusieurs connecteurs compatibles"
                  : "Choisir d'abord une fonction"
              }
              disabled={!functionId}
              onClick={() => setConnectorPickerOpen(true)}
              error={
                saveAttempted && functionId && selectedConnectors.length === 0
                  ? "Au moins un connecteur compatible est obligatoire."
                  : undefined
              }
            />
          </FormSection>

          {/* ── Numérotation câble ─────────────────────────────────── */}
          <FormSection
            title="Numérotation des câbles"
            tooltip="Hérités de la fonction si vides. Préfixe = devant le numéro, suffixe = derrière."
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-[var(--muted-foreground)]">
                  Préfixe
                </label>
                <input
                  {...form.register("cablePrefix", {
                    onChange: (e) =>
                      form.setValue(
                        "cablePrefix",
                        e.target.value.toUpperCase(),
                        { shouldDirty: true },
                      ),
                  })}
                  placeholder={
                    selectedFn?.cablePrefix && !cablePrefixValue
                      ? `Hérité : ${selectedFn.cablePrefix}`
                      : "V, A, NET…"
                  }
                  maxLength={5}
                  className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-[var(--muted-foreground)]">
                  Suffixe
                </label>
                <input
                  {...form.register("cableSuffix")}
                  placeholder={
                    selectedFn?.cableSuffix && !cableSuffixValue
                      ? `Hérité : ${selectedFn.cableSuffix}`
                      : "-RX, -TX…"
                  }
                  maxLength={5}
                  className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </div>
            </div>
          </FormSection>
        </div>

        {/* ── Colonne droite ─────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* ── Format physique — radio exclusif Baseband / IP ────── */}
          <FormSection title="Format physique">
            <div className="grid grid-cols-2 gap-2">
              <FormatCard
                icon={Cable}
                title="Baseband"
                description="Signal analogique ou numérique transporté sur câble dédié (HD-SDI, AES3, etc.)."
                active={!isIp}
                onClick={() => {
                  if (isIp) {
                    form.setValue("isIp", false, { shouldDirty: true });
                  }
                }}
              />
              <FormatCard
                icon={Network}
                title="IP / Réseau"
                description="Signal transporté sur IP via réseau (SMPTE 2110, AES67, Dante, etc.)."
                active={isIp}
                onClick={() => {
                  if (!isIp) {
                    form.setValue("isIp", true, { shouldDirty: true });
                  }
                }}
              />
            </div>
          </FormSection>

          {/* ── Détails du format physique sélectionné ─────────────── */}
          {!isIp ? (
            <FormSection
              title="Compatibilité câble"
              tooltip="Utilisés pour le matching automatique du câble compatible (HD-SDI 75Ω, AES3 110Ω…)."
            >
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-[var(--muted-foreground)]">
                    Bande passante
                  </label>
                  <input
                    {...form.register("bandwidth")}
                    placeholder="3G, 12G, 25G, 100M…"
                    className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--muted-foreground)]">
                      Impédance (Ω)
                    </label>
                    <input
                      {...form.register("requiredImpedance")}
                      type="number"
                      step="0.5"
                      placeholder="75, 110, 100…"
                      className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--muted-foreground)]">
                      Min. MHz
                    </label>
                    <input
                      {...form.register("minBandwidthMHz")}
                      type="number"
                      step="any"
                      placeholder="3000, 12000…"
                      className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    />
                  </div>
                </div>
              </div>
            </FormSection>
          ) : (
            <FormSection title="Capacités IP">
              <div className="space-y-3">
                <div title="Détermine si ce signal nécessite une allocation d'adresse multicast.">
                  <ActionSwitch
                    label="Utilise le multicast"
                    checked={usesMulticast}
                    onChange={(v) =>
                      form.setValue("usesMulticast", v, { shouldDirty: true })
                    }
                  />
                </div>
                <div title="Le protocole supporte la redondance réseau A/B (ST 2022-7). Active la sélection A·B sur les ports affectés.">
                  <ActionSwitch
                    label="Gère la redondance"
                    checked={supportsRedundancy}
                    onChange={(v) =>
                      form.setValue("supportsRedundancy", v, {
                        shouldDirty: true,
                      })
                    }
                  />
                </div>
                {supportsRedundancy && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
                      Style de redondance
                    </p>
                    <RedundancyStyleSegmented
                      value={form.watch("redundancyStyle") ?? "AB"}
                      onChange={(next) =>
                        form.setValue("redundancyStyle", next, {
                          shouldDirty: true,
                        })
                      }
                    />
                  </div>
                )}
              </div>
            </FormSection>
          )}
        </div>
      </div>

      {/* ── Picker fonction (modal) ─────────────────────────────────── */}
      <FunctionPickerModal
        open={functionPickerOpen}
        onOpenChange={setFunctionPickerOpen}
        functions={functionOptions.map((f) => ({
          id: f.id,
          label: f.label,
          color: f.color,
          key: f.key,
        }))}
        selectedId={functionId || null}
        onSelect={(id) => {
          form.setValue("functionId", id ?? "", { shouldDirty: true });
        }}
      />

      {/* ── Picker connecteurs (modal multi) ─────────────────────────── */}
      <ConnectorMultiPickerModal
        open={connectorPickerOpen}
        onOpenChange={setConnectorPickerOpen}
        connectors={connectorOptions.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          iconId: c.iconId,
          functionIds: c.functionIds,
        }))}
        filterByFunctionId={functionId || null}
        selectedIds={selectedConnectors}
        onChange={(ids) =>
          form.setValue("connectors", ids, { shouldDirty: true })
        }
      />
    </>
  );
}

// ── FormatCard ──────────────────────────────────────────────────────────────
//
// Card cliquable pour le choix du format physique. Pattern strictement aligné
// sur `FormatCard` de `components/catalogue/connector/connector-form-dialog.tsx`
// et `app/(app)/admin/equipment/[id]/_editor/general-tab.tsx` : coche bleue
// accent en overlay top-right quand active.

function FormatCard({
  icon: Icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: typeof Cable;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative flex h-auto w-full flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--border)] hover:bg-[var(--secondary)]",
      )}
    >
      {active && (
        <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm">
          <Check className="h-3 w-3" />
        </span>
      )}
      <div className="flex items-center gap-2 pr-7">
        <Icon
          className={cn(
            "h-4 w-4",
            active ? "text-[var(--accent)]" : "text-[var(--foreground)]",
          )}
        />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="pr-7 text-xs leading-snug text-[var(--muted-foreground)]">
        {description}
      </p>
    </button>
  );
}

// ── Style de redondance — segmented control 3 pills ────────────────────────

type RedundancyStyle = "AB" | "PRIMARY_SECONDARY" | "BLUE_RED";

const REDUNDANCY_STYLES: { value: RedundancyStyle; label: string }[] = [
  { value: "AB", label: "A / B" },
  { value: "PRIMARY_SECONDARY", label: "Primary / Secondary" },
  { value: "BLUE_RED", label: "Bleu / Rouge" },
];

function RedundancyStyleSegmented({
  value,
  onChange,
}: {
  value: RedundancyStyle;
  onChange: (next: RedundancyStyle) => void;
}) {
  const btnCls = (active: boolean) =>
    cn(
      "h-8 flex-1 px-3 text-[11px] font-semibold tracking-wide transition-colors",
      active && "bg-[var(--accent)]/15 text-[var(--accent)]",
      !active &&
        "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/60",
    );
  return (
    <div className="flex w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      {REDUNDANCY_STYLES.map((opt, i) => (
        <ItemFragment key={opt.value} showDivider={i > 0}>
          <button
            type="button"
            onClick={() => onChange(opt.value)}
            className={btnCls(value === opt.value)}
            aria-pressed={value === opt.value}
          >
            {opt.label}
          </button>
        </ItemFragment>
      ))}
    </div>
  );
}

function ItemFragment({
  children,
  showDivider,
}: {
  children: React.ReactNode;
  showDivider: boolean;
}) {
  return (
    <>
      {showDivider && <span className="w-px bg-[var(--border)]" />}
      {children}
    </>
  );
}
