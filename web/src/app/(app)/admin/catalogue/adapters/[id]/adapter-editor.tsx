"use client";

/**
 * AdapterEditor — page d'édition plein écran d'un adaptateur personnel (tenant).
 *
 * Refonte 2026-05-23 : aligne le squelette visuel sur
 * `app/(app)/admin/catalogue/cables/[id]/cable-editor.tsx` pour que
 * l'utilisateur perçoive l'éditeur adaptateur comme une variante du même
 * produit que l'éditeur cordon.
 *
 * Squelette commun (cordon ↔ adaptateur) :
 *  - Header h-14 : breadcrumb (chemin uniquement) + boutons Annuler /
 *    Enregistrer. Pas d'ActivePill, pas de nom dans le breadcrumb.
 *  - Body scrollable plein largeur, `space-y-8` entre les sections.
 *  - Hero 3 colonnes :
 *      col 1 : `ImageCropUpload` 16:9 (label vide)
 *      col 2 : Identité (Nom + Référence + Fonction)
 *      col 3 : Entrée + Sorties (compact, empilés)
 *  - Section Notes seule sous le Hero.
 *
 * Pas de cas d'usage ni de longueurs (concepts cordons). Le métier
 * adaptateur = 1 connecteur d'entrée → N connecteurs de sortie.
 *
 * Sauvegarde manuelle uniquement.
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
} from "@/components/ui/icons";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { broadcastCatalogUpdated } from "@/lib/catalog-broadcast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";
import { RangeInput } from "@/components/wizard/range-input";
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
import { cn } from "@/lib/utils";

// ── Types publics ───────────────────────────────────────────────────────────

export type AdapterEditorGender = "MALE" | "FEMALE" | "NEUTRAL";

export type AdapterEditorPort = {
  connectorTypeId: string;
  gender: AdapterEditorGender;
  quantity: number;
  label: string;
};

export type AdapterEditorConnectorRef = {
  id: string;
  name: string;
  color?: string | null;
  iconId?: string | null;
  /**
   * IDs des `CatalogFunction` associées (relation many-to-many
   * `CatalogConnectorTypeFunction`). Permet le filtrage par fonction
   * broadcast dans la modal de sélection.
   */
  functionIds: string[];
};

export type AdapterEditorFunctionRef = {
  id: string;
  label: string;
  color: string;
};

export type AdapterEditorInitial = {
  id?: string;
  name?: string | null;
  reference?: string | null;
  inputs?: AdapterEditorPort[] | null;
  outputs?: AdapterEditorPort[] | null;
  functionId?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
};

type Props = {
  /**
   * Item à éditer. Quand `undefined`, l'éditeur démarre en mode CREATE :
   *  - form vierge, breadcrumb "Catalogue / Adaptateurs / Nouveau",
   *  - pas d'auto-save (bouton « Créer » explicite),
   *  - POST `/api/tenant/catalogue/adapters` au save, puis redirection vers
   *    `/admin/catalogue/adapters/[newId]` (passage en mode édition).
   */
  initial?: AdapterEditorInitial & { id: string; name: string };
  connectors: AdapterEditorConnectorRef[];
  functions: AdapterEditorFunctionRef[];
  backUrl?: string;
  /**
   * Base d'API pour la persistance. Default tenant : `/api/tenant/catalogue/adapters`.
   * En mode CREATE : POST sur cette URL. En mode EDIT : PATCH sur `${saveApiBase}/${id}`.
   */
  saveApiBase?: string;
  /**
   * Lecture pure — utilisé pour afficher un adaptateur Arkyo en consultation
   * depuis le catalogue tenant. Désactive auto-save, undo/redo, masque les
   * boutons d'action (Ajouter sortie, Supprimer, Créer/Enregistrer), bascule
   * les inputs en `readOnly` et les pickers/cards en `<div role="presentation">`.
   *
   * Pas d'opacity, pas de disabled : on cible le rendu visuel via des branches
   * dédiées dans chaque composant (pattern aligné sur `EquipmentEditor`).
   */
  isReadOnly?: boolean;
  /** Bandeau "non inclus dans votre plan" — rendu juste après le header en
   *  mode tenant read-only quand l'item Arkyo n'est pas accessible. */
  notIncludedInPlan?: boolean;
  /**
   * Catalogue unifié (tenant) — l'item est un item Arkyo pur (pas encore
   * forké). Éditable : le premier enregistrement crée un fork éclipsant côté
   * API et l'éditeur bascule son id de travail sur le fork sans interrompre la
   * saisie. Expose « Signaler une erreur » tant qu'aucun fork n'existe.
   */
  arkyoSource?: boolean;
  /** Fork éclipsant — expose « Récupérer la version Arkyo » dans le header. */
  shadowsArkyo?: boolean;
  /** La source Arkyo a évolué depuis le fork (mention discrète). */
  arkyoDrift?: boolean;
};

// ── Schéma de validation ────────────────────────────────────────────────────

const adapterSchema = z.object({
  name: z.string().min(1, "Nom requis"),
  reference: z.string().optional(),
  functionId: z.string().optional(),
  notes: z.string().optional(),
});
type AdapterFormValues = z.infer<typeof adapterSchema>;

const GENDER_LABEL: Record<AdapterEditorGender, string> = {
  MALE: "M",
  FEMALE: "F",
  NEUTRAL: "I/O",
};

const GENDER_FULL_LABEL: Record<AdapterEditorGender, string> = {
  MALE: "Mâle",
  FEMALE: "Femelle",
  NEUTRAL: "I/O",
};

const GENDERS: AdapterEditorGender[] = ["MALE", "FEMALE", "NEUTRAL"];

function parseGender(v: unknown): AdapterEditorGender {
  return v === "MALE" || v === "FEMALE" || v === "NEUTRAL" ? v : "FEMALE";
}

function emptyPort(): AdapterEditorPort {
  return { connectorTypeId: "", gender: "FEMALE", quantity: 1, label: "" };
}

function normalizePort(raw: unknown): AdapterEditorPort {
  if (!raw || typeof raw !== "object") return emptyPort();
  const r = raw as Record<string, unknown>;
  return {
    connectorTypeId:
      typeof r.connectorTypeId === "string" ? r.connectorTypeId : "",
    gender: parseGender(r.gender),
    quantity:
      typeof r.quantity === "number" && r.quantity > 0
        ? Math.min(Math.max(Math.floor(r.quantity), 1), 99)
        : 1,
    label: typeof r.label === "string" ? r.label : "",
  };
}

function normalizePorts(raw: unknown): AdapterEditorPort[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizePort);
}

// ── Composant principal ────────────────────────────────────────────────────

export function AdapterEditor({
  initial,
  connectors,
  functions,
  backUrl = "/admin/catalogue?tab=adapters",
  saveApiBase = "/api/tenant/catalogue/adapters",
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

  // ── Id de travail + état de fork (catalogue unifié, tenant) ──────────────
  // Sur un item Arkyo pur, le premier PATCH renvoie le fork créé : on bascule
  // l'id de travail (autosave) et l'URL sans interrompre la saisie.
  const workingIdRef = useRef<string | null>(initial?.id ?? null);
  const [isShadowFork, setIsShadowFork] = useState(shadowsArkyo === true);

  // Fiche Arkyo pure (pas encore forkée) : éditable, mais on garde « Signaler
  // une erreur » pour remonter une correction au référentiel Arkyo.
  const isArkyoPure = arkyoSource === true && !isShadowFork;

  // États hors-RHF
  const initialInput = useMemo<AdapterEditorPort>(() => {
    const arr = normalizePorts(initial?.inputs);
    return arr[0] ?? emptyPort();
  }, [initial?.inputs]);

  const initialOutputs = useMemo<AdapterEditorPort[]>(() => {
    const arr = normalizePorts(initial?.outputs);
    return arr.length > 0 ? arr : [emptyPort()];
  }, [initial?.outputs]);

  const [input, setInput] = useState<AdapterEditorPort>(initialInput);
  const [outputs, setOutputs] = useState<AdapterEditorPort[]>(initialOutputs);
  const [imageUrl, setImageUrl] = useState<string>(initial?.imageUrl ?? "");

  const [saveAttempted, setSaveAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);

  const defaultValues = useMemo<AdapterFormValues>(
    () => ({
      name: initial?.name ?? "",
      reference: initial?.reference ?? "",
      functionId: initial?.functionId ?? "",
      notes: initial?.notes ?? "",
    }),
    [initial],
  );

  const form = useForm<AdapterFormValues>({
    resolver: zodResolver(adapterSchema),
    defaultValues,
  });

  const watchedFormValues = form.watch();
  const functionId = watchedFormValues.functionId;

  // ── Validation (compteurs erreurs) ─────────────────────────────────────
  const validOutputCount = outputs.filter((p) => p.connectorTypeId).length;
  const totalErrors = useMemo<number>(() => {
    let n = 0;
    if (!(watchedFormValues.name ?? "").trim()) n++;
    if (!functionId) n++;
    if (!input.connectorTypeId) n++;
    if (validOutputCount === 0) n++;
    return n;
  }, [
    watchedFormValues.name,
    functionId,
    input.connectorTypeId,
    validOutputCount,
  ]);

  // ── Construction du payload (pure) ─────────────────────────────────────
  const buildPayload = useCallback(
    (values: AdapterFormValues) => ({
      name: values.name.trim(),
      reference: values.reference?.trim() || null,
      functionId: values.functionId || null,
      // Adaptateur = 1 seul connecteur d'entrée → quantity forcée à 1
      inputs: [
        {
          connectorTypeId: input.connectorTypeId,
          gender: input.gender,
          quantity: 1,
          label: input.label.trim(),
        },
      ],
      outputs: outputs
        .filter((p) => p.connectorTypeId)
        .map((p) => ({
          connectorTypeId: p.connectorTypeId,
          gender: p.gender,
          quantity: p.quantity,
          label: p.label.trim(),
        })),
      notes: values.notes?.trim() || null,
      imageUrl: imageUrl || null,
    }),
    [input, outputs, imageUrl],
  );

  // ── Snapshot global (utilisé par history + autosave) ──────────────────
  type AdapterSnapshot = {
    form: AdapterFormValues;
    input: AdapterEditorPort;
    outputs: AdapterEditorPort[];
    imageUrl: string;
  };

  const snapshot = useMemo<AdapterSnapshot>(
    () => ({
      form: watchedFormValues,
      input,
      outputs,
      imageUrl,
    }),
    [watchedFormValues, input, outputs, imageUrl],
  );

  const applySnapshot = useCallback(
    (s: AdapterSnapshot) => {
      form.reset(s.form);
      setInput(s.input);
      setOutputs(s.outputs);
      setImageUrl(s.imageUrl);
    },
    [form],
  );

  // ── Réconciliation temps réel ────────────────────────────────────────────
  // <AppSync> → router.refresh() → nouveau prop `initial`. On réhydrate via
  // form.reset(...) + setState (applySnapshot) sauf saisie locale en cours.
  const serverSnapshot = useMemo<AdapterSnapshot>(
    () => ({
      form: defaultValues,
      input: initialInput,
      outputs: initialOutputs,
      imageUrl: initial?.imageUrl ?? "",
    }),
    [defaultValues, initialInput, initialOutputs, initial?.imageUrl],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useServerReconcile<AdapterSnapshot>({
    serverValue: serverSnapshot,
    getLocalValue: () => snapshotRef.current,
    apply: applySnapshot,
    enabled: isEdit,
  });

  // ── Auto-save ────────────────────────────────────────────────────────────
  // Activé uniquement en mode édition (item existant en DB). En mode création :
  // bouton « Créer » explicite (pattern aligné sur l'éditeur équipement). Une
  // fois créé, on redirige vers `/[newId]` qui re-monte l'éditeur en mode
  // édition normal avec auto-save actif. Désactivé en lecture pure.
  const canAutosave =
    isEdit &&
    !isReadOnly &&
    !!(watchedFormValues.name ?? "").trim() &&
    !!input.connectorTypeId &&
    validOutputCount > 0 &&
    !!functionId;

  const { status, lastSavedAt, forceSave } = useEditorAutosave<AdapterSnapshot>({
    values: snapshot,
    enabled: canAutosave,
    save: async (s, signal) => {
      if (!workingIdRef.current) return;
      const payload = buildPayload(s.form);
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

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  const { canUndo, canRedo, undo, redo } = useEditorHistory<AdapterSnapshot>({
    values: snapshot,
    setValues: applySnapshot,
    enabled: isEdit && !isReadOnly,
  });

  // ── Sauvegarde manuelle (mode CREATE) ───────────────────────────────────
  // POST explicite puis redirection vers le détail du nouvel item (passage en
  // mode édition avec auto-save).
  const handleCreate = useCallback(async () => {
    setSaveAttempted(true);
    if (totalErrors > 0) {
      // Feedback explicite quand la validation bloque l'envoi — sinon
      // le clic sur Enregistrer paraît silencieux côté utilisateur.
      toast.error(
        `${totalErrors} champ${totalErrors > 1 ? "s" : ""} obligatoire${totalErrors > 1 ? "s" : ""} à compléter (nom, fonction, connecteur d'entrée et au moins une sortie).`,
      );
      return;
    }
    const values = form.getValues();
    setSaving(true);
    try {
      const payload = buildPayload(values);
      const created = await api.post<{ id?: string }>(saveApiBase, payload);
      toast.success("Adaptateur créé.");
      // Notifie les onglets inventaire ouverts pour qu'ils refetchent.
      broadcastCatalogUpdated();
      if (created?.id) {
        router.push(`/admin/catalogue/adapters/${created.id}`);
      } else {
        router.push(backUrl);
      }
    } catch (e) {
      const msg = getApiErrorMessage(e, "Échec de la création.");
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [
    backUrl,
    buildPayload,
    form,
    router,
    saveApiBase,
    toast,
    totalErrors,
  ]);

  // ── Cmd+S → flush immédiat (édition) ou « Créer » (création) ──────────
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

  // arkyo-server: « Récupérer la version Arkyo » retiré (catalogue unique).

  return (
    <div className="flex h-full flex-col">
      {/* ── Header h-14 : breadcrumb + boutons (pas d'ActivePill, pas de nom) ──
          Mode édition : breadcrumb « Catalogue / Adaptateurs » + Undo/Redo +
          badge auto-save + bouton « Fermer ».
          Mode création : breadcrumb « Catalogue / Adaptateurs / Nouveau » +
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
            href="/admin/catalogue?tab=adapters"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Adaptateurs
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
              Cet adaptateur est géré par arkyo. Consultation seule.
            </p>
          </div>
        </div>
      )}

      {/* arkyo-server: bandeau « non inclus dans votre plan » retiré (pas de plan) */}

      {/* ── Contenu scrollable plein largeur ───────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {submitError && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
            {submitError}
          </div>
        )}

        <div className="space-y-8">
          {/* ── Hero : Image | Identité | Connecteur d'entrée (3 colonnes) ── */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.1fr)]">
            {/* Col 1 : Image 16:9 */}
            <ImageCropUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="adapters"
              label=""
              forceAspectRatio={16 / 9}
              readOnly={isReadOnly}
            />

            {/* Col 2 : Identité + Fonction */}
            <div className="flex flex-col gap-5">
              <FieldBlock label="Nom" required={!isReadOnly}>
                <input
                  {...form.register("name")}
                  readOnly={isReadOnly}
                  placeholder="XLR5 → 2× XLR3"
                  className="flex h-11 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
                {!isReadOnly && form.formState.errors.name && (
                  <p className="text-xs text-[var(--destructive)]">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </FieldBlock>

              <FieldBlock label="Référence constructeur">
                <input
                  {...form.register("reference")}
                  readOnly={isReadOnly}
                  placeholder="ADP-XLR5-XLR3"
                  className="flex h-11 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </FieldBlock>

              {functions.length > 0 && (
                <FieldBlock label="Catégorie" required={!isReadOnly}>
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
                  {!isReadOnly && saveAttempted && !functionId && (
                    <p className="text-[11px] text-[var(--destructive)]">
                      Sélectionnez une catégorie.
                    </p>
                  )}
                </FieldBlock>
              )}
            </div>

            {/* Col 3 : Connecteur d'entrée (mono) */}
            <div className="flex flex-col gap-5">
              <FieldBlock label="Connecteur d'entrée" required={!isReadOnly}>
                <ConnectorEnd
                  connectors={connectors}
                  functions={functions}
                  port={input}
                  onChange={setInput}
                  error={
                    !isReadOnly && saveAttempted && !input.connectorTypeId
                      ? "Connecteur d'entrée requis"
                      : undefined
                  }
                  showQuantity={false}
                  readOnly={isReadOnly}
                />
              </FieldBlock>
            </div>
          </section>

          {/* ── Sorties : section pleine largeur en dessous du Hero ───────── */}
          <SubSection
            title="Groupes de connecteurs en sortie"
            subtitle={
              isReadOnly
                ? `${validOutputCount} groupe${validOutputCount > 1 ? "s" : ""} — chaque carte = un type de connecteur avec sa quantité.`
                : validOutputCount > 0
                  ? `${validOutputCount} groupe${validOutputCount > 1 ? "s" : ""} défini${validOutputCount > 1 ? "s" : ""} — chaque carte = un type de connecteur avec sa quantité.`
                  : "Au moins un groupe est requis. Chaque carte = un type de connecteur avec sa quantité."
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {outputs.map((p, i) => (
                <OutputPortRow
                  key={i}
                  index={i}
                  port={p}
                  connectors={connectors}
                  functions={functions}
                  onChange={(v) =>
                    setOutputs((prev) =>
                      prev.map((x, j) => (j === i ? v : x)),
                    )
                  }
                  onRemove={
                    !isReadOnly && outputs.length > 1
                      ? () =>
                          setOutputs((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                      : undefined
                  }
                  readOnly={isReadOnly}
                />
              ))}
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => setOutputs((prev) => [...prev, emptyPort()])}
                  className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-4 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                >
                  <Plus className="h-5 w-5" />
                  Ajouter un groupe
                </button>
              )}
            </div>
            {!isReadOnly && saveAttempted && validOutputCount === 0 && (
              <p className="mt-2 text-[11px] text-[var(--destructive)]">
                Au moins un groupe de sortie est requis.
              </p>
            )}
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

// ── SubSection — titre + sous-titre + body, sans bordure

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
        {required && <span className="ml-1 text-[var(--destructive)]">*</span>}
      </p>
      {children}
    </div>
  );
}

// ── Port editor : entrée (compact, sans titre interne) ────────────────────

function ConnectorEnd({
  connectors,
  functions,
  port,
  onChange,
  error,
  showQuantity = true,
  readOnly = false,
}: {
  connectors: AdapterEditorConnectorRef[];
  functions: AdapterEditorFunctionRef[];
  port: AdapterEditorPort;
  onChange: (p: AdapterEditorPort) => void;
  error?: string;
  showQuantity?: boolean;
  readOnly?: boolean;
}) {
  void functions;
  const [pickerOpen, setPickerOpen] = useState(false);

  const selected =
    connectors.find((c) => c.id === port.connectorTypeId) ?? null;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)]/40 bg-[var(--background)]/40 p-3">
      {/* Bouton qui ouvre la modal de sélection (remplace l'ancien dropdown) */}
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
          selectedId={port.connectorTypeId || null}
          onSelect={(id) => onChange({ ...port, connectorTypeId: id })}
        />
      )}

      {/* Genre — chips Mâle / Femelle / I/O */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
          Genre
        </p>
        {readOnly ? (
          // Lecture pure : on n'affiche QUE la card active, neutre,
          // non-focusable, pas d'accent color.
          <div className="grid grid-cols-3 gap-1.5">
            <div
              role="presentation"
              className="col-span-3 flex h-9 flex-col items-center justify-center rounded-lg border border-[var(--border)]/40 bg-transparent text-[11px] font-semibold text-[var(--foreground)]"
            >
              <span>{GENDER_FULL_LABEL[port.gender]}</span>
              <span className="font-mono text-[9px] text-[var(--muted-foreground)]">
                {GENDER_LABEL[port.gender]}
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {GENDERS.map((g) => {
              const active = port.gender === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => onChange({ ...port, gender: g })}
                  className={cn(
                    "flex h-9 flex-col items-center justify-center rounded-lg border text-[11px] font-semibold transition-all",
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

      {showQuantity && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
            Quantité ({port.quantity})
          </p>
          <RangeInput
            min={1}
            max={128}
            step={1}
            value={port.quantity}
            onChange={(v) => onChange({ ...port, quantity: v })}
            unit=""
            editable
            readOnly={readOnly}
          />
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
          Libellé (facultatif)
        </p>
        <input
          type="text"
          value={port.label}
          onChange={(e) => onChange({ ...port, label: e.target.value })}
          readOnly={readOnly}
          placeholder="Ex. IN, OUT1, RETURN…"
          className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
    </div>
  );
}

// ── OutputPortRow : sortie individuelle avec titre + bouton retirer ───────

function OutputPortRow({
  index,
  port,
  connectors,
  functions,
  onChange,
  onRemove,
  readOnly = false,
}: {
  index: number;
  port: AdapterEditorPort;
  connectors: AdapterEditorConnectorRef[];
  functions: AdapterEditorFunctionRef[];
  onChange: (p: AdapterEditorPort) => void;
  onRemove?: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase text-[var(--foreground)]">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--accent)]/15 font-mono text-[10px] text-[var(--accent)]">
            {index + 1}
          </span>
          Groupe
        </span>
        {!readOnly && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
            title="Retirer ce groupe"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <ConnectorEnd
        connectors={connectors}
        functions={functions}
        port={port}
        onChange={onChange}
        showQuantity
        readOnly={readOnly}
      />
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
  functions: AdapterEditorFunctionRef[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  readOnly?: boolean;
}) {
  if (readOnly) {
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
