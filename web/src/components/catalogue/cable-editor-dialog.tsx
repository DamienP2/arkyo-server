"use client";

/**
 * CableEditorDialog — dialog d'édition / création d'un cordon (tenant).
 *
 * Variante allégée du FormDialog supervisor `cables-list-panel.tsx` :
 *  - Pas de proposals.
 *  - Pas de CableModel (le tenant ne voit pas les modèles de câble nus).
 *  - Pas de longueurs globales (le tenant saisit les longueurs presta à la main).
 *  - Pas de useState `imageUrl` séparé : on intègre dans le form.
 *
 * Le composant attend les référentiels en props (connecteurs / fonctions /
 * marques) et délègue la sauvegarde via callback (parent gère l'API et la
 * redirection).
 *
 * Sauvegarde manuelle uniquement — pas d'auto-save (cohérent avec la convention
 * tenant : un clic sur "Enregistrer" valide tout).
 *
 * Layout (refonte 2026-05-23) : sections clairement délimitées avec headers
 * iconisés et accent coloré (calqué sur les SummaryGroups du wizard
 * `new-cable-wizard.tsx`). Layout 2 colonnes pour les extrémités gauche/droite,
 * sliders éditables (RangeInput) pour les longueurs d'installation, image au
 * format 16:9 via ImageCropUpload. Brand/modèle/notes regroupés dans une
 * section "Détails complémentaires" démotée visuellement.
 */

import { useMemo, useState } from "react";
import { z } from "zod";
import {
  Cable as CableIcon,
  ChevronDown,
  Image as ImageIcon,
  Info,
  Plug,
  Plus,
  Ruler,
  Search,
  Tag,
  Trash2,
  Wand2,
  Wrench,
  X,
} from "@/components/ui/icons";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";
import { RangeInput } from "@/components/wizard/range-input";
import { cn } from "@/lib/utils";

// ── Types publics ──────────────────────────────────────────────────────────

export type CableEditorGender = "MALE" | "FEMALE" | "NEUTRAL";
export type CableEditorUseCase = "INSTALLATION" | "PRESTATION";

export type CableEditorConnectorRef = {
  id: string;
  name: string;
  color?: string | null;
};

export type CableEditorFunctionRef = {
  id: string;
  label: string;
  color: string;
};

export type CableEditorBrandRef = { id: string; name: string };

/**
 * Valeurs du cordon à l'ouverture (mode édition). Tous les champs sont
 * optionnels — les manquants tomberont aux defaults du form.
 */
export type CableEditorInitial = {
  id?: string;
  name?: string | null;
  reference?: string | null;
  leftConnectorId?: string | null;
  leftGender?: string | null;
  rightConnectorId?: string | null;
  rightGender?: string | null;
  functionId?: string | null;
  brandId?: string | null;
  model?: string | null;
  useCases?: string[] | null;
  availableLengths?: number[] | null;
  customMinLength?: number | null;
  customMaxLength?: number | null;
  notes?: string | null;
  imageUrl?: string | null;
};

/** Payload envoyé à l'API tenant (flat shape, cohérent avec `tenantCable`). */
export type CableEditorPayload = {
  name: string;
  reference: string | null;
  leftConnectorId: string | null;
  leftGender: CableEditorGender;
  rightConnectorId: string | null;
  rightGender: CableEditorGender;
  functionId: string | null;
  brandId: string | null;
  model: string | null;
  useCases: CableEditorUseCase[];
  availableLengths: number[];
  customMinLength: number | null;
  customMaxLength: number | null;
  notes: string | null;
  imageUrl: string | null;
  isActive: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: CableEditorInitial;
  connectors: CableEditorConnectorRef[];
  functions: CableEditorFunctionRef[];
  brands: CableEditorBrandRef[];
  /**
   * Handler de sauvegarde — reçoit le payload prêt à envoyer.
   * Doit throw pour afficher une erreur inline dans le dialog (cf. FormDialog).
   */
  onSubmit: (payload: CableEditorPayload) => Promise<void>;
  submitLabel?: string;
};

// ── Schéma de validation ────────────────────────────────────────────────────

const cableSchema = z.object({
  name: z.string().min(1, "Nom requis"),
  reference: z.string().optional(),
  leftConnectorId: z.string().min(1, "Connecteur gauche requis"),
  leftGender: z.enum(["MALE", "FEMALE", "NEUTRAL"]),
  rightConnectorId: z.string().min(1, "Connecteur droit requis"),
  rightGender: z.enum(["MALE", "FEMALE", "NEUTRAL"]),
  functionId: z.string().optional(),
  brandId: z.string().optional(),
  model: z.string().optional(),
  notes: z.string().optional(),
});
type CableFormValues = z.infer<typeof cableSchema>;

const GENDER_LABEL: Record<CableEditorGender, string> = {
  MALE: "M",
  FEMALE: "F",
  NEUTRAL: "I/O",
};

const GENDER_FULL_LABEL: Record<CableEditorGender, string> = {
  MALE: "Mâle",
  FEMALE: "Femelle",
  NEUTRAL: "I/O",
};

const GENDERS: CableEditorGender[] = ["MALE", "FEMALE", "NEUTRAL"];

function autoCableName(
  leftConn: CableEditorConnectorRef | null,
  leftGender: CableEditorGender,
  rightConn: CableEditorConnectorRef | null,
  rightGender: CableEditorGender,
): string {
  if (!leftConn || !rightConn) return "";
  return `${leftConn.name} ${GENDER_LABEL[leftGender]} ↔ ${rightConn.name} ${GENDER_LABEL[rightGender]}`;
}

function parseGender(v: string | null | undefined): CableEditorGender {
  return v === "MALE" || v === "FEMALE" || v === "NEUTRAL" ? v : "MALE";
}

// ── Composant ──────────────────────────────────────────────────────────────

export function CableEditorDialog({
  open,
  onOpenChange,
  mode,
  initial,
  connectors,
  functions,
  brands,
  onSubmit,
  submitLabel,
}: Props) {
  // États hors-RHF — listes & image. On les hydrate à l'ouverture via
  // `defaultValues` du form (qui se reset à chaque open), et on les remet à
  // zéro à la fermeture.
  const [useCases, setUseCases] = useState<CableEditorUseCase[]>(
    (initial?.useCases ?? []).filter(
      (u): u is CableEditorUseCase => u === "INSTALLATION" || u === "PRESTATION",
    ),
  );
  const [availableLengths, setAvailableLengths] = useState<number[]>(
    initial?.availableLengths ?? [],
  );
  const [customMinLength, setCustomMinLength] = useState<number>(
    initial?.customMinLength ?? 1,
  );
  const [customMaxLength, setCustomMaxLength] = useState<number>(
    initial?.customMaxLength ?? 50,
  );
  const [imageUrl, setImageUrl] = useState<string>(initial?.imageUrl ?? "");

  // "Plus de détails" repliable — fermé par défaut sauf si l'utilisateur a déjà
  // saisi une marque, un modèle ou des notes (mode édition d'un cordon enrichi).
  const hasSecondaryDetails =
    !!initial?.brandId || !!initial?.model || !!initial?.notes;
  const [secondaryOpen, setSecondaryOpen] = useState<boolean>(hasSecondaryDetails);

  const defaultValues = useMemo<CableFormValues>(
    () => ({
      name: initial?.name ?? "",
      reference: initial?.reference ?? "",
      leftConnectorId: initial?.leftConnectorId ?? "",
      leftGender: parseGender(initial?.leftGender),
      rightConnectorId: initial?.rightConnectorId ?? "",
      rightGender: parseGender(initial?.rightGender),
      functionId: initial?.functionId ?? "",
      brandId: initial?.brandId ?? "",
      model: initial?.model ?? "",
      notes: initial?.notes ?? "",
    }),
    [initial],
  );

  const connByName = useMemo(
    () => new Map(connectors.map((c) => [c.id, c])),
    [connectors],
  );

  return (
    <FormDialog<CableFormValues>
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          // Reset des états hors-RHF — alignement avec le pattern supervisor.
          setUseCases(
            (initial?.useCases ?? []).filter(
              (u): u is CableEditorUseCase => u === "INSTALLATION" || u === "PRESTATION",
            ),
          );
          setAvailableLengths(initial?.availableLengths ?? []);
          setCustomMinLength(initial?.customMinLength ?? 1);
          setCustomMaxLength(initial?.customMaxLength ?? 50);
          setImageUrl(initial?.imageUrl ?? "");
          setSecondaryOpen(hasSecondaryDetails);
        }
      }}
      icon={<CableIcon />}
      eyebrow="CORDON"
      title={mode === "edit" ? "Modifier le cordon" : "Nouveau cordon"}
      schema={cableSchema}
      defaultValues={defaultValues}
      size="2xl"
      submitLabel={submitLabel ?? (mode === "edit" ? "Enregistrer" : "Créer")}
      onSubmit={async (values) => {
        const payload: CableEditorPayload = {
          name: values.name.trim(),
          reference: values.reference?.trim() || null,
          leftConnectorId: values.leftConnectorId || null,
          leftGender: values.leftGender,
          rightConnectorId: values.rightConnectorId || null,
          rightGender: values.rightGender,
          functionId: values.functionId || null,
          brandId: values.brandId || null,
          model: values.model?.trim() || null,
          useCases,
          availableLengths,
          customMinLength: useCases.includes("INSTALLATION")
            ? customMinLength
            : null,
          customMaxLength: useCases.includes("INSTALLATION")
            ? customMaxLength
            : null,
          notes: values.notes?.trim() || null,
          imageUrl: imageUrl || null,
          isActive: true,
        };
        await onSubmit(payload);
      }}
    >
      {(form) => {
        const leftId = form.watch("leftConnectorId");
        const rightId = form.watch("rightConnectorId");
        const left = connByName.get(leftId) ?? null;
        const right = connByName.get(rightId) ?? null;
        const leftG = form.watch("leftGender") as CableEditorGender;
        const rightG = form.watch("rightGender") as CableEditorGender;
        const computedName = autoCableName(left, leftG, right, rightG);

        return (
          <div className="space-y-6">
            {/* ── Section : Identité ────────────────────────────────────── */}
            <Section
              icon={<CableIcon className="h-3.5 w-3.5" />}
              title="Identité"
              subtitle="Nom du cordon, référence catalogue"
              color="#8b5cf6"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
                <FormSection title="Nom *">
                  <div className="flex gap-2">
                    <input
                      {...form.register("name")}
                      placeholder={
                        computedName || "BNC M ↔ BNC M (75Ω 12G)"
                      }
                      className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                    {computedName && (
                      <button
                        type="button"
                        onClick={() =>
                          form.setValue("name", computedName, {
                            shouldValidate: true,
                          })
                        }
                        className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                        title="Utiliser le nom auto-généré"
                      >
                        Auto
                      </button>
                    )}
                  </div>
                  {form.formState.errors.name && (
                    // arkyo-server: habillage Strata
                    <p className="text-xs text-[var(--danger-text)]">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </FormSection>

                <FormSection title="Référence">
                  <input
                    {...form.register("reference")}
                    placeholder="BLD-1694A"
                    className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </FormSection>
              </div>
            </Section>

            {/* ── Section : Extrémités (2 colonnes) ─────────────────────── */}
            <Section
              icon={<Plug className="h-3.5 w-3.5" />}
              title="Extrémités"
              subtitle="Connecteurs et genres aux deux bouts du cordon"
              color="#10b981"
            >
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <ConnectorEnd
                  side="left"
                  connectors={connectors}
                  connectorId={leftId}
                  onSelectConnector={(id) =>
                    form.setValue("leftConnectorId", id, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  gender={leftG}
                  onSelectGender={(g) =>
                    form.setValue("leftGender", g, { shouldDirty: true })
                  }
                  error={form.formState.errors.leftConnectorId?.message}
                />
                <ConnectorEnd
                  side="right"
                  connectors={connectors}
                  connectorId={rightId}
                  onSelectConnector={(id) =>
                    form.setValue("rightConnectorId", id, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  gender={rightG}
                  onSelectGender={(g) =>
                    form.setValue("rightGender", g, { shouldDirty: true })
                  }
                  error={form.formState.errors.rightConnectorId?.message}
                  onCopyFrom={
                    leftId
                      ? () => {
                          form.setValue("rightConnectorId", leftId, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          form.setValue("rightGender", leftG, {
                            shouldDirty: true,
                          });
                        }
                      : undefined
                  }
                />
              </div>
            </Section>

            {/* ── Section : Fonction ────────────────────────────────────── */}
            {functions.length > 0 && (
              <Section
                icon={<Wand2 className="h-3.5 w-3.5" />}
                title="Fonction"
                subtitle="Chaîne de signal — vidéo, audio, contrôle, etc."
                color="#3b82f6"
              >
                <FunctionCardPicker
                  functions={functions}
                  selectedId={form.watch("functionId") ?? null}
                  onSelect={(id) =>
                    form.setValue("functionId", id ?? "", {
                      shouldDirty: true,
                    })
                  }
                />
              </Section>
            )}

            {/* ── Section : Cas d'usage (cards multi) ───────────────────── */}
            <Section
              icon={<Tag className="h-3.5 w-3.5" />}
              title="Cas d'usage"
              subtitle="Comment ce cordon est fabriqué et fourni"
              color="#f59e0b"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <UseCaseCard
                  icon={<Wrench className="h-5 w-5" />}
                  title="Installation"
                  description="Coupé à la demande, longueur ajustable lors du chantier."
                  color="#3b82f6"
                  active={useCases.includes("INSTALLATION")}
                  onClick={() =>
                    setUseCases((prev) =>
                      prev.includes("INSTALLATION")
                        ? prev.filter((u) => u !== "INSTALLATION")
                        : [...prev, "INSTALLATION"],
                    )
                  }
                />
                <UseCaseCard
                  icon={<Tag className="h-5 w-5" />}
                  title="Prestation"
                  description="Longueurs prédéfinies — stock prêt-à-l'emploi."
                  color="#10b981"
                  active={useCases.includes("PRESTATION")}
                  onClick={() =>
                    setUseCases((prev) =>
                      prev.includes("PRESTATION")
                        ? prev.filter((u) => u !== "PRESTATION")
                        : [...prev, "PRESTATION"],
                    )
                  }
                />
              </div>
            </Section>

            {/* ── Section : Longueurs (conditionnelle) ──────────────────── */}
            {(useCases.includes("INSTALLATION") ||
              useCases.includes("PRESTATION")) && (
              <Section
                icon={<Ruler className="h-3.5 w-3.5" />}
                title="Longueurs"
                subtitle={
                  useCases.includes("INSTALLATION") &&
                  useCases.includes("PRESTATION")
                    ? "Plage de coupe (installation) et longueurs catalogue (prestation)"
                    : useCases.includes("INSTALLATION")
                      ? "Plage de coupe pour les chantiers d'installation"
                      : "Longueurs catalogue prêtes à louer"
                }
                color="#06b6d4"
              >
                <div className="space-y-5">
                  {useCases.includes("INSTALLATION") && (
                    <div className="space-y-3">
                      <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
                        Installation — plage de coupe
                      </p>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <RangeInput
                          min={0.1}
                          max={500}
                          step={0.5}
                          value={customMinLength}
                          onChange={(v) => {
                            setCustomMinLength(v);
                            if (v > customMaxLength) setCustomMaxLength(v);
                          }}
                          label="Longueur min."
                          unit="m"
                          editable
                          showBounds
                        />
                        <RangeInput
                          min={0.1}
                          max={500}
                          step={0.5}
                          value={customMaxLength}
                          onChange={(v) => {
                            setCustomMaxLength(v);
                            if (v < customMinLength) setCustomMinLength(v);
                          }}
                          label="Longueur max."
                          unit="m"
                          editable
                          showBounds
                        />
                      </div>
                    </div>
                  )}

                  {useCases.includes("PRESTATION") && (
                    <div className="space-y-3">
                      <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
                        Prestation — longueurs catalogue (m)
                      </p>
                      <LengthsListEditor
                        values={availableLengths}
                        onChange={setAvailableLengths}
                      />
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* ── Section : Image (16:9) ────────────────────────────────── */}
            <Section
              icon={<ImageIcon className="h-3.5 w-3.5" />}
              title="Image"
              subtitle="Format 16:9 conseillé. Glissez un fichier ou collez une URL."
              color="#a855f7"
            >
              <ImageCropUpload
                value={imageUrl}
                onChange={setImageUrl}
                folder="cables"
                label="Image du cordon"
                forceAspectRatio={16 / 9}
              />
            </Section>

            {/* ── Section : Détails complémentaires (collapsible) ──────── */}
            <CollapsibleSection
              icon={<Info className="h-3.5 w-3.5" />}
              title="Détails complémentaires"
              subtitle="Marque, modèle et notes — facultatif"
              color="#71717a"
              open={secondaryOpen}
              onToggle={() => setSecondaryOpen((v) => !v)}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormSection title="Fabricant">
                    <select
                      {...form.register("brandId")}
                      className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <option value="">— Aucun —</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </FormSection>
                  <FormSection title="Modèle">
                    <input
                      {...form.register("model")}
                      placeholder="Ex: 1694A"
                      className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </FormSection>
                </div>

                <FormSection title="Notes">
                  <textarea
                    {...form.register("notes")}
                    rows={3}
                    placeholder="Spécificités techniques, recommandations…"
                    className="flex w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </FormSection>
              </div>
            </CollapsibleSection>
          </div>
        );
      }}
    </FormDialog>
  );
}

// ── Section header (icône + titre + sous-titre) ────────────────────────────

function Section({
  icon,
  title,
  subtitle,
  color,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-5 shadow-sm">
      <SectionHeader icon={icon} title={title} subtitle={subtitle} color={color} />
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  color: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${color}14`, color }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold leading-tight text-[var(--foreground)]">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted-foreground)]">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({
  icon,
  title,
  subtitle,
  color,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  color: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 rounded-xl px-5 py-4 text-left transition-colors hover:bg-[var(--secondary)]/40"
        aria-expanded={open}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `${color}14`, color }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight text-[var(--foreground)]">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted-foreground)]">
              {subtitle}
            </p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

// ── Connector end (extrémité) ──────────────────────────────────────────────

function ConnectorEnd({
  side,
  connectors,
  connectorId,
  onSelectConnector,
  gender,
  onSelectGender,
  error,
  onCopyFrom,
}: {
  side: "left" | "right";
  connectors: CableEditorConnectorRef[];
  connectorId: string;
  onSelectConnector: (id: string) => void;
  gender: CableEditorGender;
  onSelectGender: (g: CableEditorGender) => void;
  error?: string;
  onCopyFrom?: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter((c) => c.name.toLowerCase().includes(q));
  }, [connectors, query]);

  const selected = connectors.find((c) => c.id === connectorId) ?? null;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)]/40 bg-[var(--background)]/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
          Extrémité {side === "left" ? "gauche" : "droite"} *
        </p>
        {onCopyFrom && (
          <button
            type="button"
            onClick={onCopyFrom}
            className="text-[10px] font-medium tracking-wide text-[var(--accent)] hover:underline"
            title="Recopier la gauche"
          >
            ← Identique
          </button>
        )}
      </div>

      {/* Trigger / pastille du connecteur courant */}
      {selected && (
        <div
          className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2"
          style={
            selected.color
              ? {
                  borderColor: `${selected.color}55`,
                  backgroundColor: `${selected.color}0d`,
                }
              : undefined
          }
        >
          {selected.color && (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span
            className="flex-1 truncate text-sm font-medium"
            style={selected.color ? { color: selected.color } : undefined}
          >
            {selected.name}
          </span>
          <span className="font-mono text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)]">
            {GENDER_LABEL[gender]}
          </span>
        </div>
      )}

      {/* Recherche + liste scrollable */}
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (BNC, XLR, RJ45…)"
            className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent pl-8 pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>

        <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--border)]/60 bg-[var(--card)] p-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-center text-[11px] italic text-[var(--muted-foreground)]">
              Aucun connecteur ne correspond.
            </p>
          ) : (
            filtered.map((c) => {
              const active = c.id === connectorId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConnector(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    active
                      ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "text-[var(--foreground)] hover:bg-[var(--secondary)]/60",
                  )}
                >
                  {c.color && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                  )}
                  <span className="flex-1 truncate">{c.name}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {error && (
        // arkyo-server: habillage Strata
        <p className="text-[11px] text-[var(--danger-text)]">{error}</p>
      )}

      {/* Genre — chips Mâle / Femelle / I/O */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
          Genre
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {GENDERS.map((g) => {
            const active = gender === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => onSelectGender(g)}
                className={cn(
                  "flex h-10 flex-col items-center justify-center rounded-lg border text-xs font-semibold transition-all",
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                )}
              >
                <span>{GENDER_FULL_LABEL[g]}</span>
                <span className="font-mono text-[9px] opacity-70">
                  {GENDER_LABEL[g]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Function picker ────────────────────────────────────────────────────────

function FunctionCardPicker({
  functions,
  selectedId,
  onSelect,
}: {
  functions: CableEditorFunctionRef[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all",
          !selectedId
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--border)] hover:bg-[var(--secondary)]/40",
        )}
      >
        <span className="h-3 w-3 shrink-0 rounded-full bg-[var(--muted-foreground)]/40" />
        <span className="text-xs font-medium text-[var(--muted-foreground)]">
          Aucune
        </span>
      </button>
      {functions.map((fn) => {
        const active = selectedId === fn.id;
        return (
          <button
            key={fn.id}
            type="button"
            onClick={() => onSelect(fn.id)}
            className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all"
            style={
              active
                ? {
                    borderColor: fn.color,
                    backgroundColor: `${fn.color}12`,
                  }
                : {
                    borderColor: "var(--border)",
                    backgroundColor: "transparent",
                  }
            }
          >
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: fn.color }}
            />
            <span
              className="truncate text-xs font-medium"
              style={{ color: active ? fn.color : "var(--foreground)" }}
            >
              {fn.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Use-case card (multi) ──────────────────────────────────────────────────

function UseCaseCard({
  icon,
  title,
  description,
  color,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-start gap-3 rounded-xl border p-4 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-sm"
          : "border-[var(--border)]/60 hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
      )}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${color}14`, color }}
      >
        {icon}
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          {title}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          {description}
        </p>
      </div>
      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-[var(--accent-foreground)]">
          ✓
        </span>
      )}
    </button>
  );
}

// ── Éditeur de liste de longueurs (saisie libre — pas de presets globaux) ──

function LengthsListEditor({
  values,
  onChange,
}: {
  values: number[];
  onChange: (next: number[]) => void;
}) {
  const [draft, setDraft] = useState<string>("");

  const addDraft = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n <= 0) return;
    if (values.includes(n)) {
      setDraft("");
      return;
    }
    onChange([...values, n].sort((a, b) => a - b));
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 ? (
          <span className="text-[11px] italic text-[var(--muted-foreground)]">
            Aucune longueur définie. Ajoutez en mètres ci-dessous.
          </span>
        ) : (
          values.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              // arkyo-server: habillage Strata
              className="group inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 font-mono text-[11px] font-medium text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
              title="Retirer"
            >
              {v} m
              <X className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="number"
          step="0.1"
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="Longueur (m)"
          className="flex h-9 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        <button
          type="button"
          onClick={addDraft}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]/40"
        >
          <Plus className="h-3 w-3" />
          Ajouter
        </button>
      </div>
      {values.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
        >
          <Trash2 className="h-2.5 w-2.5" />
          Vider la liste
        </button>
      )}
    </div>
  );
}
