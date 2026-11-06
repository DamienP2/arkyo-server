"use client";

/**
 * CableEditor — page d'édition plein écran d'un cordon personnel (tenant).
 *
 * Refonte 2026-05-23 : aligne le squelette visuel sur
 * `app/(app)/admin/equipment/[id]/equipment-editor.tsx` pour que l'utilisateur
 * perçoive l'éditeur cordon comme une variante du même produit que l'éditeur
 * équipement.
 *
 * Squelette commun :
 *  - Header h-14 : icône colorée 7×7 + nom + ActivePill + boutons Fermer /
 *    Enregistrer (réutilise `components/admin/editor/*`)
 *  - TabBar pilule centrée (réutilise `components/admin/editor/tab-bar.tsx`)
 *  - Contenu scrollable padding 5 + sections aérées par onglet
 *
 * 4 onglets adaptés au métier cordon :
 *  - general    : Identité (nom + référence)
 *  - extremities: Extrémités gauche + droite (2 colonnes, connecteur + genre)
 *  - usage      : Fonction + Cas d'usage + Longueurs (regroupés métier)
 *  - media      : Image (16:9) + Notes + Détails complémentaires
 *
 * Conserve les 19 champs métier + validation Zod identique à l'ancien dialog.
 * Sauvegarde manuelle uniquement (pas d'auto-save côté tenant — pattern aligné
 * sur la création supervisor de l'éditeur équipement).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  Loader2,
  MessageSquareWarning,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "@/components/ui/icons";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";
import {
  ConnectorPickerModal,
  ConnectorPickerTrigger,
} from "@/components/catalogue/connector-picker-modal";
import { useEditorAutosave } from "@/components/catalogue/use-editor-autosave";
import { useEditorHistory } from "@/components/catalogue/use-editor-history";
import { useServerReconcile } from "@/components/catalogue/use-server-reconcile";
import { EditorStatusBadge } from "@/components/catalogue/editor-status-badge";
import { EditorUndoRedo } from "@/components/catalogue/editor-undo-redo";
// arkyo-server: CorrectionRequestDialog (« Signaler une erreur » au référentiel Arkyo) retiré.
import { RangeInput } from "@/components/wizard/range-input";
import { cn } from "@/lib/utils";

// ── Types publics ───────────────────────────────────────────────────────────

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
  isActive?: boolean | null;
};

type Props = {
  /**
   * Item à éditer. Quand `undefined`, l'éditeur démarre en mode CREATE :
   *  - form vierge, breadcrumb "Catalogue / Cordons / Nouveau",
   *  - pas d'auto-save (bouton « Créer » explicite),
   *  - POST `/api/tenant/catalogue/cables` au save, puis redirection vers
   *    `/admin/catalogue/cables/[newId]` (passage en mode édition).
   */
  initial?: CableEditorInitial & { id: string; name: string };
  connectors: CableEditorConnectorRef[];
  functions: CableEditorFunctionRef[];
  brands: CableEditorBrandRef[];
  backUrl?: string;
  /**
   * Base d'API pour la persistance. Default tenant : `/api/tenant/catalogue/cables`.
   * En mode CREATE : POST sur cette URL. En mode EDIT : PATCH sur `${saveApiBase}/${id}`.
   */
  saveApiBase?: string;
  /**
   * Lecture pure — désormais réservé au cas d'un cordon Arkyo hors plan
   * (non inclus dans l'abonnement courant) : consultation seule + bandeau
   * plan. Désactive auto-save, undo/redo, masque tous les contrôles
   * d'écriture (boutons Auto, X chips, slider, Ajouter, etc.), bascule les
   * inputs en `readOnly` et les pickers/cards en `<div role="presentation">`
   * non-focusable.
   *
   * Un cordon Arkyo accessible est éditable (fork-on-edit) — `isReadOnly`
   * reste alors false.
   */
  isReadOnly?: boolean;
  /** Bandeau "non inclus dans votre plan" — rendu à l'intérieur de l'éditeur,
   *  juste avant le contenu scrollable. Activé en mode tenant read-only quand
   *  l'item Arkyo n'est pas accessible avec le plan en cours. */
  notIncludedInPlan?: boolean;
  /**
   * Item Arkyo pur (pas encore forké). Quand true, le premier enregistrement
   * (autosave compris) crée un fork éclipsant côté API (PATCH → 201 + fork) et
   * l'éditeur bascule son id de travail sur le fork sans interrompre la saisie.
   * Expose aussi « Signaler une erreur » (correction au référentiel).
   */
  arkyoSource?: boolean;
  /** Fork éclipsant — expose « Récupérer la version Arkyo » dans le header. */
  shadowsArkyo?: boolean;
  /** La source Arkyo a évolué depuis le fork (mention drift discrète). */
  arkyoDrift?: boolean;
};

// ── Tabs ────────────────────────────────────────────────────────────────────

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

function parseGender(v: string | null | undefined): CableEditorGender {
  return v === "MALE" || v === "FEMALE" || v === "NEUTRAL" ? v : "MALE";
}

function autoCableName(
  leftConn: CableEditorConnectorRef | null,
  leftGender: CableEditorGender,
  rightConn: CableEditorConnectorRef | null,
  rightGender: CableEditorGender,
): string {
  if (!leftConn || !rightConn) return "";
  return `${leftConn.name} ${GENDER_LABEL[leftGender]} ↔ ${rightConn.name} ${GENDER_LABEL[rightGender]}`;
}

// ── Composant principal ────────────────────────────────────────────────────

export function CableEditor({
  initial,
  connectors,
  functions,
  brands,
  backUrl = "/admin/catalogue?tab=cables",
  saveApiBase = "/api/tenant/catalogue/cables",
  isReadOnly = false,
  notIncludedInPlan = false,
  arkyoSource = false,
  shadowsArkyo = false,
  arkyoDrift = false,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isEdit = !!initial;

  // ── Id de travail + état de fork (catalogue unifié) ──────────────────────
  // Sur un item Arkyo pur, le premier PATCH renvoie le fork créé : on bascule
  // l'id de travail (autosave) et l'URL sans interrompre la saisie.
  const workingIdRef = useRef<string | null>(initial?.id ?? null);
  const [isShadowFork, setIsShadowFork] = useState(shadowsArkyo === true);

  // Fiche Arkyo pure (pas encore forkée) : éditable, mais on garde « Signaler
  // une erreur » pour remonter une correction au référentiel.
  const isArkyoPure = arkyoSource === true && !isShadowFork;

  // États hors-RHF
  const [availableLengths, setAvailableLengths] = useState<number[]>(
    initial?.availableLengths ?? [],
  );
  const [customLengthDraft, setCustomLengthDraft] = useState<number>(5);
  const [lengthPresets, setLengthPresets] = useState<number[]>([]);
  const [imageUrl, setImageUrl] = useState<string>(initial?.imageUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);

  // Fetch des longueurs de câble prédéfinies (référentiel
  // /admin/parametres > Longueurs câbles). Fusion arkyo + personal,
  // dédupliquées et triées.
  useEffect(() => {
    let cancelled = false;
    void api
      .get<
        | {
            arkyo: Array<{ category: string; value: number; unit: string }>;
            personal: Array<{ category: string; value: number; unit: string }>;
          }
        // arkyo-server: correction (préréglages de longueur jamais affichés, la route renvoie un tableau)
        | Array<{ category: string; value: number; unit: string }>
      >("/api/tenant/parametres/dimensions")
      .then((data) => {
        if (cancelled) return;
        // arkyo-server: correction (préréglages de longueur jamais affichés, la route renvoie un tableau)
        const all = (Array.isArray(data) ? data : [...(data.arkyo ?? []), ...(data.personal ?? [])])
          .filter((p) => p.category === "CABLE_LENGTH" && p.value > 0)
          .map((p) => p.value);
        const dedup = Array.from(new Set(all)).sort((a, b) => a - b);
        setLengthPresets(dedup);
      })
      .catch(() => {
        if (!cancelled) setLengthPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [saveAttempted, setSaveAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const form = useForm<CableFormValues>({
    resolver: zodResolver(cableSchema),
    defaultValues,
  });

  const connById = useMemo(
    () => new Map(connectors.map((c) => [c.id, c])),
    [connectors],
  );

  const watchedFormValues = form.watch();
  const leftId = watchedFormValues.leftConnectorId;
  const rightId = watchedFormValues.rightConnectorId;
  const left = connById.get(leftId) ?? null;
  const right = connById.get(rightId) ?? null;
  const leftG = watchedFormValues.leftGender as CableEditorGender;
  const rightG = watchedFormValues.rightGender as CableEditorGender;
  const functionId = watchedFormValues.functionId;
  const computedName = autoCableName(left, leftG, right, rightG);

  // ── Validation (compteurs erreurs) ─────────────────────────────────────
  const totalErrors = useMemo<number>(() => {
    let n = 0;
    if (!(watchedFormValues.name ?? "").trim()) n++;
    if (!leftId) n++;
    if (!rightId) n++;
    return n;
  }, [watchedFormValues.name, leftId, rightId]);

  // ── Construction payload (pure) ────────────────────────────────────────
  const buildPayload = useCallback(
    (values: CableFormValues, lengths: number[], img: string) => ({
      name: values.name.trim(),
      reference: values.reference?.trim() || null,
      leftConnectorId: values.leftConnectorId || null,
      leftGender: values.leftGender,
      rightConnectorId: values.rightConnectorId || null,
      rightGender: values.rightGender,
      functionId: values.functionId || null,
      brandId: values.brandId || null,
      model: values.model?.trim() || null,
      useCases: [] as string[],
      availableLengths: [...lengths].sort((a, b) => a - b),
      customMinLength: null,
      customMaxLength: null,
      notes: values.notes?.trim() || null,
      imageUrl: img || null,
    }),
    [],
  );

  // ── Snapshot global (autosave + history) ───────────────────────────────
  type CableSnapshot = {
    form: CableFormValues;
    availableLengths: number[];
    imageUrl: string;
  };

  const snapshot = useMemo<CableSnapshot>(
    () => ({
      form: watchedFormValues,
      availableLengths,
      imageUrl,
    }),
    [watchedFormValues, availableLengths, imageUrl],
  );

  const applySnapshot = useCallback(
    (s: CableSnapshot) => {
      form.reset(s.form);
      setAvailableLengths(s.availableLengths);
      setImageUrl(s.imageUrl);
    },
    [form],
  );

  // ── Réconciliation temps réel ────────────────────────────────────────────
  // <AppSync> → router.refresh() → nouveau prop `initial`. On réhydrate via
  // form.reset(...) + setState (applySnapshot) sauf saisie locale en cours.
  const serverSnapshot = useMemo<CableSnapshot>(
    () => ({
      form: defaultValues,
      availableLengths: initial?.availableLengths ?? [],
      imageUrl: initial?.imageUrl ?? "",
    }),
    [defaultValues, initial?.availableLengths, initial?.imageUrl],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useServerReconcile<CableSnapshot>({
    serverValue: serverSnapshot,
    getLocalValue: () => snapshotRef.current,
    apply: applySnapshot,
    enabled: isEdit,
  });

  // Auto-save activé uniquement en mode édition (item existant en DB).
  // En mode création : bouton « Créer » explicite (pattern aligné sur
  // l'éditeur équipement). Une fois créé, on redirige vers `/[newId]`
  // qui re-monte l'éditeur en mode édition normal avec auto-save actif.
  // En lecture pure : auto-save désactivé.
  const canAutosave =
    isEdit &&
    !isReadOnly &&
    !!(watchedFormValues.name ?? "").trim() &&
    !!leftId &&
    !!rightId;

  const { status, lastSavedAt, forceSave } = useEditorAutosave<CableSnapshot>({
    values: snapshot,
    enabled: canAutosave,
    save: async (s, signal) => {
      if (!workingIdRef.current) return;
      const payload = buildPayload(s.form, s.availableLengths, s.imageUrl);
      try {
        const saved = await api.patch<{ id?: string }>(
          `${saveApiBase}/${workingIdRef.current}`,
          payload,
          { signal },
        );
        // arkyo-server: pas de fork-on-edit (catalogue unique) : le PATCH
        // renvoie toujours l'item lui-même, l'id de travail et l'URL ne
        // changent pas.
        void saved;
        setSubmitError(null);
      } catch (e) {
        if (signal.aborted) return;
        // arkyo-server: refus de plan (PLAN_RESTRICTED) retiré (pas de plan).
        setSubmitError(getApiErrorMessage(e, "Échec de l'enregistrement."));
        throw e;
      }
    },
  });

  // arkyo-server: « Récupérer la version Arkyo » retiré (catalogue unique).

  const { canUndo, canRedo, undo, redo } = useEditorHistory<CableSnapshot>({
    values: snapshot,
    setValues: applySnapshot,
    enabled: isEdit && !isReadOnly,
  });

  // ── Sauvegarde manuelle (mode CREATE) ───────────────────────────────────
  // En mode création, l'auto-save est désactivé : on POST explicitement puis
  // on redirige vers le détail du nouvel item (passage en mode édition).
  const handleCreate = useCallback(async () => {
    setSaveAttempted(true);
    if (totalErrors > 0) return;
    const values = form.getValues();
    setSaving(true);
    try {
      const payload = buildPayload(values, availableLengths, imageUrl);
      const created = await api.post<{ id?: string }>(saveApiBase, payload);
      toast.success("Cordon créé.");
      if (created?.id) {
        router.push(`/admin/catalogue/cables/${created.id}`);
      } else {
        router.push(backUrl);
      }
    } catch (e) {
      setSubmitError(getApiErrorMessage(e, "Échec de la création."));
    } finally {
      setSaving(false);
    }
  }, [
    availableLengths,
    backUrl,
    buildPayload,
    form,
    imageUrl,
    router,
    saveApiBase,
    toast,
    totalErrors,
  ]);

  // Cmd+S → flush immédiat (mode édition) ou bouton « Créer » (mode création).
  // Désactivé en lecture pure.
  useEffect(() => {
    if (isReadOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || (e.key !== "s" && e.key !== "S")) return;
      e.preventDefault();
      setSaveAttempted(true);
      if (totalErrors > 0) return;
      if (isEdit) {
        void forceSave();
      } else {
        void handleCreate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forceSave, handleCreate, isEdit, totalErrors, isReadOnly]);

  return (
    <div className="flex h-full flex-col">
      {/* ── Header h-14 : breadcrumb + boutons (pas d'ActivePill, pas de nom) ──
          Mode édition : breadcrumb « Catalogue / Cordons » + Undo/Redo + badge
          auto-save + bouton « Fermer ».
          Mode création : breadcrumb « Catalogue / Cordons / Nouveau » +
          bouton « Annuler » + bouton « Créer » (auto-save off — voir comment
          plus haut). */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)]/60 px-6">
        <nav
          aria-label="Fil d'Ariane"
          className="flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)]"
        >
          <a
            href="/admin/catalogue"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Catalogue
          </a>
          <span className="text-[var(--muted-foreground)]/40">/</span>
          <a
            href="/admin/catalogue?tab=cables"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Cordons
          </a>
          {!isEdit && (
            <>
              <span className="text-[var(--muted-foreground)]/40">/</span>
              <span className="text-[var(--foreground)]">Nouveau</span>
            </>
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {isReadOnly ? (
            <>
              {/* arkyo-server: « Signaler une erreur » au référentiel Arkyo retiré */}
              <button
                type="button"
                onClick={() => router.push(backUrl)}
                className="h-8 rounded-lg border border-[var(--border)]/60 px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
              >
                Fermer
              </button>
            </>
          ) : isEdit ? (
            <>
              {/* arkyo-server: « Signaler une erreur » (fiche Arkyo pure) et
                  « Récupérer la version Arkyo » (fork éclipsant) retirés :
                  catalogue unique. */}
              <EditorUndoRedo
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
              />
              <EditorStatusBadge status={status} lastSavedAt={lastSavedAt} />
              <button
                type="button"
                onClick={() => router.push(backUrl)}
                className="h-8 rounded-lg border border-[var(--border)]/60 px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
              >
                Fermer
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => router.push(backUrl)}
                className="h-8 rounded-lg border border-[var(--border)]/60 px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving}
                // arkyo-server: habillage Strata
                className="flex h-8 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Créer
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Arkyo catalog ribbon (lecture seule) ── */}
      {isReadOnly && (
        <div className="shrink-0 border-b border-[var(--border)]/60 px-6 py-2">
          <div className="flex items-center gap-3">
            <svg
              width={14}
              height={14}
              viewBox="0 0 100 100"
              className="shrink-0 text-[var(--arkyo-ink)] dark:text-[var(--arkyo-cloud)]"
            >
              <path
                d="M26 84 L26 28 C26 6 74 6 74 28 L74 84"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line
                x1="26"
                y1="58"
                x2="74"
                y2="58"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                opacity="0.5"
              />
            </svg>
            <p className="flex-1 text-[11px] text-[var(--muted-foreground)]">
              Ce cordon est géré par arkyo. Consultation seule.
            </p>
          </div>
        </div>
      )}

      {/* arkyo-server: bandeau « non inclus dans votre plan » retiré (pas de plan) */}

      {/* ── Contenu scrollable plein largeur ───────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {submitError && (
          // arkyo-server: habillage Strata
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-[var(--danger-text)]">
            {submitError}
          </div>
        )}

        <div className="space-y-8">
          {/* ── Hero : Image | Identité | Cas d'usage + Longueurs (3 colonnes) ── */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]">
            {/* Col 1 : Image 16:9 */}
            <ImageCropUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="cables"
              label=""
              forceAspectRatio={16 / 9}
              readOnly={isReadOnly}
            />

            {/* Col 2 : Identité (Nom + Référence + Fonction) */}
            <div className="flex flex-col gap-5">
              <FieldBlock label="Nom" required={!isReadOnly}>
                <div className="flex gap-2">
                  <input
                    {...form.register("name")}
                    readOnly={isReadOnly}
                    placeholder={computedName || "BNC M ↔ BNC M (75Ω 12G)"}
                    className="flex h-11 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                  {!isReadOnly && computedName && (
                    <button
                      type="button"
                      onClick={() =>
                        form.setValue("name", computedName, {
                          shouldValidate: true,
                        })
                      }
                      className="shrink-0 rounded-lg border border-[var(--border)] px-3 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                      title="Utiliser le nom auto-généré"
                    >
                      Auto
                    </button>
                  )}
                </div>
                {!isReadOnly && form.formState.errors.name && (
                  // arkyo-server: habillage Strata
                  <p className="text-xs text-[var(--danger-text)]">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </FieldBlock>

              <FieldBlock label="Référence constructeur">
                <input
                  {...form.register("reference")}
                  readOnly={isReadOnly}
                  placeholder="BLD-1694A"
                  className="flex h-11 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </FieldBlock>

              {functions.length > 0 && (
                <FieldBlock label="Catégorie">
                  <FunctionCardPicker
                    functions={functions}
                    selectedId={functionId ?? null}
                    onSelect={(id) =>
                      form.setValue("functionId", id ?? "", {
                        shouldDirty: true,
                      })
                    }
                    readOnly={isReadOnly}
                  />
                </FieldBlock>
              )}
            </div>

            {/* Col 3 : Longueurs disponibles (presets + custom) */}
            <div className="flex flex-col gap-5">
              <FieldBlock label="Longueurs disponibles (m)">
                {isReadOnly ? (
                  // Lecture pure : affiche uniquement les longueurs actives,
                  // sans bouton X, sans champ d'ajout. Pas d'incitation au clic.
                  availableLengths.length === 0 ? (
                    <p className="font-mono text-sm text-[var(--muted-foreground)]">
                      —
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {[...availableLengths]
                        .sort((a, b) => a - b)
                        .map((v) => (
                          <span
                            key={v}
                            role="presentation"
                            className="rounded-full border border-[var(--border)]/40 bg-transparent px-3 py-1 font-mono text-[11px] tabular-nums text-[var(--foreground)]"
                          >
                            {v} m
                          </span>
                        ))}
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    {/* Chips presets du référentiel admin */}
                    {lengthPresets.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {lengthPresets.map((v) => {
                          const active = availableLengths.includes(v);
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => {
                                setAvailableLengths((prev) =>
                                  prev.includes(v)
                                    ? prev.filter((x) => x !== v)
                                    : [...prev, v].sort((a, b) => a - b),
                                );
                              }}
                              className={cn(
                                "rounded-full border px-3 py-1 font-mono text-[11px] tabular-nums transition-all",
                                active
                                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]",
                              )}
                            >
                              {v} m
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-[var(--muted-foreground)]">
                        Aucune longueur prédéfinie. Configurez-les dans{" "}
                        <a
                          href="/admin/parametres?tab=dimensions"
                          className="underline hover:text-[var(--foreground)]"
                        >
                          Paramètres › Longueurs câbles
                        </a>
                        .
                      </p>
                    )}

                    {/* Custom : slider + bouton Ajouter */}
                    <div className="space-y-2 rounded-lg border border-[var(--border)]/60 bg-[var(--card)]/40 p-3">
                      <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
                        Ajouter une longueur personnalisée
                      </p>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <RangeInput
                            min={0.5}
                            max={500}
                            step={0.5}
                            value={customLengthDraft}
                            onChange={setCustomLengthDraft}
                            unit="m"
                            editable
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (customLengthDraft <= 0) return;
                            if (availableLengths.includes(customLengthDraft))
                              return;
                            setAvailableLengths((prev) =>
                              [...prev, customLengthDraft].sort(
                                (a, b) => a - b,
                              ),
                            );
                          }}
                          disabled={
                            customLengthDraft <= 0 ||
                            availableLengths.includes(customLengthDraft)
                          }
                          // arkyo-server: habillage Strata
                          className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                          Ajouter
                        </button>
                      </div>
                    </div>

                    {/* Longueurs custom déjà ajoutées (qui ne sont PAS dans les presets) */}
                    {availableLengths.filter((v) => !lengthPresets.includes(v))
                      .length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
                          Personnalisées sélectionnées
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {availableLengths
                            .filter((v) => !lengthPresets.includes(v))
                            .sort((a, b) => a - b)
                            .map((v) => (
                              <span
                                key={v}
                                className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--accent)]"
                              >
                                {v} m
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAvailableLengths((prev) =>
                                      prev.filter((x) => x !== v),
                                    )
                                  }
                                  className="ml-0.5 text-[var(--accent)]/70 transition-colors hover:text-[var(--accent)]"
                                  aria-label={`Retirer ${v} m`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </FieldBlock>
            </div>
          </section>

          {/* ── Extrémités (G | D) ────────────────────────────────────────── */}
          <SubSection
            title="Extrémités"
            subtitle={
              isReadOnly
                ? "Connecteur et genre pour chaque côté du cordon"
                : "Connecteur et genre pour chaque côté du cordon"
            }
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
                readOnly={isReadOnly}
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
                  !isReadOnly && leftId
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
                readOnly={isReadOnly}
              />
            </div>
          </SubSection>

          {/* ── Notes ────────────────────────────────────────────────────── */}
          <SubSection
            title="Notes"
            subtitle="Spécificités techniques, remarques — facultatif"
          >
            <textarea
              {...form.register("notes")}
              readOnly={isReadOnly}
              rows={3}
              placeholder="Spécificités techniques, recommandations…"
              className="flex w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </SubSection>
        </div>
      </div>

      {/* ── Footer (erreurs visibles après tentative de save) ── */}
      {!isReadOnly && totalErrors > 0 && saveAttempted && (
        <div className="shrink-0 border-t border-[var(--border)]/60 px-6 py-2">
          {/* arkyo-server: habillage Strata */}
          <span className="text-[11px] font-medium text-[var(--danger-text)]">
            {totalErrors} erreur{totalErrors > 1 ? "s" : ""} à corriger
          </span>
        </div>
      )}

      {/* arkyo-server: dialog de signalement d'erreur Arkyo retiré (catalogue unique) */}
    </div>
  );
}

// ── SubSection — titre + sous-titre + body, sans bordure (les onglets
// remplacent les sections enveloppées de l'ancien éditeur).

function SubSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold leading-tight text-[var(--foreground)]">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted-foreground)]">
            {subtitle}
          </p>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}

// ── FieldBlock — label + slot input + error/hint ──────────────────────────

function FieldBlock({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
        {label}
        {/* arkyo-server: habillage Strata */}
        {required && <span className="ml-1 text-[var(--danger-text)]">*</span>}
      </p>
      {children}
    </div>
  );
}

// ── Connector end ──────────────────────────────────────────────────────────

function ConnectorEnd({
  side,
  connectors,
  connectorId,
  onSelectConnector,
  gender,
  onSelectGender,
  error,
  onCopyFrom,
  readOnly = false,
}: {
  side: "left" | "right";
  connectors: CableEditorConnectorRef[];
  connectorId: string;
  onSelectConnector: (id: string) => void;
  gender: CableEditorGender;
  onSelectGender: (g: CableEditorGender) => void;
  error?: string;
  onCopyFrom?: () => void;
  readOnly?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = connectors.find((c) => c.id === connectorId) ?? null;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)]/40 bg-[var(--background)]/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
          Extrémité {side === "left" ? "gauche" : "droite"}
          {!readOnly && (
            <>
              {" "}
              {/* arkyo-server: habillage Strata */}
              <span className="text-[var(--danger-text)]">*</span>
            </>
          )}
        </p>
        {!readOnly && onCopyFrom && (
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

      {/* Trigger qui ouvre le modal de sélection (read-only : div role=presentation) */}
      <ConnectorPickerTrigger
        connector={selected}
        placeholder="Sélectionner un connecteur"
        onClick={() => setPickerOpen(true)}
        error={readOnly ? undefined : error}
        readOnly={readOnly}
      />

      {!readOnly && (
        <ConnectorPickerModal
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          connectors={connectors}
          selectedId={connectorId || null}
          onSelect={onSelectConnector}
        />
      )}

      {/* Genre — chips Mâle / Femelle / I/O */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
          Genre
        </p>
        {readOnly ? (
          // Lecture pure : n'affiche que la card sélectionnée, style neutre,
          // non-focusable, pas de cursor pointer, pas d'accent color.
          <div className="grid grid-cols-3 gap-1.5">
            <div
              role="presentation"
              className="col-span-3 flex h-10 flex-col items-center justify-center rounded-lg border border-[var(--border)]/40 bg-transparent text-xs font-semibold text-[var(--foreground)]"
            >
              <span>{GENDER_FULL_LABEL[gender]}</span>
              <span className="font-mono text-[9px] text-[var(--muted-foreground)]">
                {GENDER_LABEL[gender]}
              </span>
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}

// ── Function picker ────────────────────────────────────────────────────────

function FunctionCardPicker({
  functions,
  selectedId,
  onSelect,
  readOnly = false,
}: {
  functions: CableEditorFunctionRef[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  readOnly?: boolean;
}) {
  if (readOnly) {
    // Lecture pure : on n'affiche QUE la fonction active. Si aucune, on
    // rend un placeholder neutre "—". Style neutre, pas de cursor pointer,
    // pas d'accent color, non-focusable.
    const active = functions.find((fn) => fn.id === selectedId) ?? null;
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {active ? (
          <div
            role="presentation"
            className="flex items-center gap-2 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 py-2.5 text-left"
          >
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: active.color }}
            />
            <span className="truncate text-xs font-medium text-[var(--foreground)]">
              {active.label}
            </span>
          </div>
        ) : (
          <div
            role="presentation"
            className="flex items-center gap-2 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 py-2.5 text-left"
          >
            <span className="h-3 w-3 shrink-0 rounded-full bg-[var(--muted-foreground)]/40" />
            <span className="font-mono text-xs text-[var(--muted-foreground)]">
              —
            </span>
          </div>
        )}
      </div>
    );
  }

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

// ── Use-case card ──────────────────────────────────────────────────────────

function UseCaseCard({
  title,
  description,
  color,
  active,
  onClick,
}: {
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
      role="checkbox"
      aria-checked={active}
      className={cn(
        "group relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all",
        active
          ? "shadow-sm"
          : "border-[var(--border)]/60 hover:border-[var(--foreground)]/20 hover:bg-[var(--secondary)]/40",
      )}
      style={
        active
          ? { borderColor: color, backgroundColor: `${color}0d` }
          : undefined
      }
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all",
          active
            ? "border-transparent text-white"
            : "border-[var(--border)] bg-[var(--background)]",
        )}
        style={
          active ? { backgroundColor: color, borderColor: color } : undefined
        }
      >
        {active && (
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <div className="flex-1">
        <p
          className="text-sm font-semibold"
          style={{ color: active ? color : "var(--foreground)" }}
        >
          {title}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          {description}
        </p>
      </div>
    </button>
  );
}

// ── Lengths list editor (presta) ──────────────────────────────────────────

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
