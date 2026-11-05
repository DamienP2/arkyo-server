"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  Loader2,
  IdCard,
  Plug,
  RotateCcw,
  Share2,
  MessageSquareWarning,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { broadcastCatalogUpdated } from "@/lib/catalog-broadcast";
import { useEditorAutosave } from "@/components/catalogue/use-editor-autosave";
import { useEditorHistory } from "@/components/catalogue/use-editor-history";
import { useServerReconcile } from "@/components/catalogue/use-server-reconcile";
import { EditorStatusBadge } from "@/components/catalogue/editor-status-badge";
import { EditorUndoRedo } from "@/components/catalogue/editor-undo-redo";
// arkyo-server: CorrectionRequestDialog (« Signaler une erreur » au référentiel Arkyo) retiré.
import {
  Brand,
  CatalogFunctionLite,
  CatalogPhaseLite,
  CatalogTypeLite,
  ConnectorEntry,
  ConnectorType,
  EquipmentData,
  FormData,
  Signal,
  SignalCategory,
  TabId,
  initialForm,
  totalErrorCount,
  uid,
  validateForm,
} from "./_editor/types";
import { TabBar, TabDescriptor } from "./_editor/tab-bar";
import { GeneralTab } from "./_editor/general-tab";
import {
  ConnectivityTab,
  ConnectivityFaceTabs,
} from "./_editor/connectivity-tab";
import { EquipmentIcon } from "@/components/ui/equipment-icon";
import { DistributionTab } from "./_editor/distribution-tab";

/**
 * Contexte tenant — quand fourni, l'éditeur passe en "mode tenant" :
 *  - Item Arkyo pur (`isArkyoSource = true`) : éditable comme un item perso.
 *    Le premier enregistrement (autosave compris) crée un fork éclipsant côté
 *    API (PATCH → 201 + fork) et l'éditeur bascule son id de travail sur le
 *    fork sans interrompre la saisie.
 *  - Fork éclipsant (`shadowsArkyo = true`) : action « Récupérer la version
 *    Arkyo » dans le header (+ mention drift si `arkyoDrift`).
 *  - Item personnel : édition normale (auto-save) via `saveApiBase`.
 */
export type TenantContext = {
  isTenantMode: boolean;
  isArkyoSource: boolean;
  /** Fork éclipsant — expose « Récupérer la version Arkyo ». */
  shadowsArkyo?: boolean;
  /** La source Arkyo a évolué depuis le fork. */
  arkyoDrift?: boolean;
  /** La source Arkyo a disparu — item autonome (ni restore, ni drift). */
  arkyoSourceGone?: boolean;
};

type Props = {
  equipment: EquipmentData | null;
  brands: Brand[];
  connectorTypes: ConnectorType[];
  signals: Signal[];
  signalCategories: SignalCategory[];
  uHeights: number[];
  /** Global « Sécurité câblage » (mm) du tenant — défaut affiché sur l'override
   *  réserve arrière. Absent (supervisor / Arkyo) → 150. */
  cableSafetyDefaultMm?: number;
  backUrl?: string;
  saveApiBase?: string;
  functions?: CatalogFunctionLite[];
  phases?: CatalogPhaseLite[];
  types?: CatalogTypeLite[];
  showDistribution?: boolean;
  /**
   * Données pré-remplies depuis une proposition catalogue.
   * Quand fourni (mode "new" uniquement), initialise le form avec ces données
   * au lieu des valeurs par défaut vides. Ignoré en mode édition.
   */
  prefillData?: Record<string, unknown>;
  /**
   * ID de la proposition en cours de révision.
   * Quand présent :
   * - Le bouton "Enregistrer" standard est masqué (le bandeau ProposalReviewBanner gère la soumission).
   * - Un callback `onFormReady` est appelé pour exposer `getCurrentFormData` au parent.
   */
  proposalId?: string;
  /**
   * Appelé dès que le form est initialisé, avec une fonction retournant
   * les données actuelles du formulaire (utilisée par ProposalReviewBanner).
   */
  onFormReady?: (getCurrentData: () => Record<string, unknown>) => void;
  /**
   * Contexte tenant — voir TenantContext. Quand non fourni, on est en mode
   * supervisor (comportement inchangé).
   */
  tenantContext?: TenantContext;
  /**
   * En mode création, après un POST réussi, si fourni, on redirige vers
   * `createRedirectPath(newId)` plutôt que vers `backUrl`. Utilisé côté
   * tenant pour passer en mode édition manuelle après création.
   */
  createRedirectPath?: (newId: string) => string;
};

// Préfixe sessionStorage — clé complète : `${STORAGE_KEY}:${equipmentId}`.
// Sémantique voulue : l'onglet actif ne survit QU'À un rechargement (F5) de la
// même fiche. Changer de fiche ou quitter/revenir → retour sur Généralités.
// Mécanique : sessionStorage par fiche + suppression au démontage (la
// navigation SPA démonte le composant, un hard reload non).
const STORAGE_KEY = "equipment-editor-tab";

export function EquipmentEditor({
  equipment,
  brands,
  connectorTypes,
  signals,
  signalCategories,
  uHeights,
  cableSafetyDefaultMm = 150,
  backUrl = "/admin?s=equipment/active",
  saveApiBase = "/api/equipment",
  functions,
  phases,
  types,
  showDistribution = false,
  prefillData,
  proposalId,
  onFormReady,
  tenantContext,
  createRedirectPath,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isEdit = !!equipment;
  const isTenantMode = tenantContext?.isTenantMode === true;
  // Supervisor : un équipement importé du catalogue Arkyo reste en lecture
  // seule (comportement historique). En mode tenant, les items Arkyo sont
  // éditables — le fork se crée au premier enregistrement (fork-on-edit).
  const isSupervisorArkyo = equipment?.sourceType === "ARKYO" && !isTenantMode;

  // ── Id de travail + état de fork (catalogue unifié, tenant) ──────────────
  // Sur un item Arkyo pur, le premier PATCH renvoie le fork créé : on bascule
  // l'id de travail (autosave) et l'URL sans interrompre la saisie.
  const workingIdRef = useRef<string | null>(equipment?.id ?? null);
  const [isShadowFork, setIsShadowFork] = useState(
    tenantContext?.shadowsArkyo === true,
  );

  // En mode proposition sur un équipement "new", on fusionne prefillData
  // dans l'équipement fictif pour initialiser le form.
  // En mode modification (isEdit + proposalId + prefillData), on overlay les
  // champs modifiés par la proposition sur l'équipement existant.
  const initialEquipment = useMemo<EquipmentData | null>(() => {
    if (!prefillData) return equipment;
    if (isEdit && equipment) {
      // Modification proposal : merger les champs proposés sur l'existant.
      return { ...equipment, ...prefillData } as unknown as EquipmentData;
    }
    // Création proposal : utiliser prefillData comme source initiale.
    return prefillData as unknown as EquipmentData;
  }, [equipment, isEdit, prefillData]);

  const [form, setForm] = useState<FormData>(() => initialForm(initialEquipment));
  const [saving, setSaving] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);

  // Connectivity tab UI state (kept centralized so il persiste entre les tab switches
  // ET pour permettre de rendre les sous-onglets de faces juste sous la TabBar
  // principale plutôt qu'à l'intérieur du panneau).
  const [addingFace, setAddingFace] = useState<ConnectorEntry["face"] | null>(null);
  const [editingPortId, setEditingPortId] = useState<string | null>(null);
  const [activeFace, setActiveFace] = useState<ConnectorEntry["face"]>("REAR");

  // Position horizontale du L-leg sous le tab Connectique (sous-onglets faces).
  // Mesure dynamique du centre du tab pour aligner les sous-onglets en dessous.
  // Note : depuis la refonte 2026-05-23, Généralités n'a plus de sous-onglets.
  const tabBarContainerRef = useRef<HTMLDivElement | null>(null);
  const [connectorLeft, setConnectorLeft] = useState<number | null>(null);

  // Classification (Supervisor only). La Phase étant retirée de l'UI, le gate
  // ne dépend plus que de functions + types (phases devient vestigial).
  const showClassification = !!(functions && types);
  // Pour les champs classification (typeId, functionIds, phaseIds) :
  // en mode modification proposal, prefillData prime sur l'équipement existant.
  const [typeId, setTypeId] = useState<string | null>(
    prefillData?.typeId != null
      ? (prefillData.typeId as string | null)
      : (equipment?.typeId ?? null),
  );
  const [functionIds, setFunctionIds] = useState<string[]>(
    Array.isArray(prefillData?.functionIds)
      ? (prefillData!.functionIds as string[])
      : equipment?.functions
        ? equipment.functions.map((ef) => ef.functionId)
        : [],
  );
  const [phaseIds, setPhaseIds] = useState<string[]>(
    Array.isArray(prefillData?.phaseIds)
      ? (prefillData!.phaseIds as string[])
      : equipment?.phases
        ? equipment.phases.map((ep) => ep.phaseId)
        : [],
  );

  // Types de catalogue — état local partant de la prop `types` (figée côté
  // serveur) et enrichi par les types/sous-types perso créés à la volée (id
  // renvoyé par le POST). Resynchronisé si la prop change.
  const [typesState, setTypesState] = useState<CatalogTypeLite[] | undefined>(
    types,
  );
  useEffect(() => {
    setTypesState(types);
  }, [types]);

  // Création à la volée d'un type (parentId null) ou sous-type (parentId défini)
  // perso. POST → enrichit la liste locale avec le type renvoyé → sélectionne.
  // Rejette en cas d'échec (ex. 409 doublon Arkyo) pour affichage inline.
  const handleCreateType = useCallback(
    async (
      name: string,
      opts: { parentId: string | null; functionId: string },
    ): Promise<void> => {
      const body = opts.parentId
        ? { name, parentId: opts.parentId }
        : { name, functionId: opts.functionId, parentId: null };
      const created = await api.post<{
        id: string;
        name?: string;
        functionId?: string;
        parentId?: string | null;
      }>("/api/tenant/parametres/categories/type", body);
      if (!created?.id) return;
      const fnId = created.functionId ?? opts.functionId;
      const fn = functions?.find((f) => f.id === fnId);
      const newType: CatalogTypeLite = {
        id: created.id,
        name: created.name ?? name,
        functionId: fnId,
        parentId: created.parentId ?? opts.parentId ?? null,
        source: "PERSONAL",
        function: { label: fn?.label ?? "", color: fn?.color ?? "#6366f1" },
      };
      setTypesState((prev) => {
        const base = prev ?? [];
        if (base.some((t) => t.id === newType.id)) return base;
        return [...base, newType];
      });
      setTypeId(created.id);
    },
    [functions],
  );

  // Expose getCurrentFormData au parent (pour ProposalReviewBanner).
  // Toutes les valeurs sont stockées en refs pour que la closure du callback
  // soit toujours fraîche sans re-créer la fonction à chaque render.
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const classifRef = useRef({
    showClassification,
    showDistribution,
    typeId,
    functionIds,
    phaseIds,
  });
  useEffect(() => {
    classifRef.current = { showClassification, showDistribution, typeId, functionIds, phaseIds };
  }, [showClassification, showDistribution, typeId, functionIds, phaseIds]);

  useEffect(() => {
    if (!onFormReady) return;
    onFormReady(() => {
      const f = formRef.current;
      const cl = classifRef.current;
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        reference: f.reference || null,
        category: f.category || null,
        brandId: f.brandId || null,
        isRackable: f.isRackable,
        heightU: f.isRackable ? f.heightU : null,
        depthMm: f.isRackable ? f.depthMm : null,
        rearCableDepthMm: f.isRackable ? f.rearCableDepthMm : null,
        widthFraction: f.isRackable ? f.widthFraction : "FULL",
        dimLmm: !f.isRackable ? f.dimLmm : null,
        dimWmm: !f.isRackable ? f.dimWmm : null,
        dimHmm: !f.isRackable ? f.dimHmm : null,
        weight: f.weight,
        powerW: f.powerW,
        heatBtuH: f.heatBtuH,
        connectors: f.connectorEntries,
        signalCapacities: f.signalCapacities,
        is2110: f.is2110,
        ip2110Mode: f.is2110 ? f.ip2110Mode : null,
        imageUrl: f.imageUrl || null,
        iconUrl: f.iconUrl || null,
        rackSymbolUrl: f.rackSymbolUrl || null,
        rackSymbolRearUrl: f.rackSymbolRearUrl || null,
        rackPhotoFrontUrl: f.rackPhotoFrontUrl || null,
        rackPhotoRearUrl: f.rackPhotoRearUrl || null,
        notes: f.notes || null,
        documents: f.documents ?? [],
        isActive: f.isActive,
        isLightingFixture: f.isLightingFixture,
        dmxChannelsDefault: f.isLightingFixture ? f.dmxChannelsDefault : null,
        dmxModes: f.isLightingFixture ? f.dmxModes : [],
        isComponentHost: f.isComponentHost,
        hostSlotCount: f.isComponentHost ? f.hostSlotCount : null,
        isComponent: f.isComponent,
        componentSlotSpan: f.isComponent ? f.componentSlotSpan : 1,
      };
      if (cl.showClassification) {
        body.typeId = cl.typeId;
        body.functionIds = cl.functionIds;
        // phaseIds volontairement omis (cf. buildSavePayload).
      }
      if (cl.showDistribution) {
        body.visibleFromPlan = f.visibleFromPlan;
        body.propagation = f.propagation;
        body.pinned = f.pinned;
        body.schemaImageUrl = f.schemaImageUrl ?? null;
        body.frontImageUrl = f.frontImageUrl ?? null;
        body.rearImageUrl = f.rearImageUrl ?? null;
        body.customFields = f.customFields;
      }
      return body;
    });
    // onFormReady est stable (useCallback côté parent). On ne le ré-appelle
    // pas si onFormReady change car on veut enregistrer le callback une seule fois.
     
  }, [onFormReady]);

  // ── Tabs definition ─────────────────────────────────────────────────────
  //
  // Hiérarchie :
  //   - Généralités (Identité / Classification / Format + Options + Documents
  //     directement dans la col 1 du Hero)
  //   - Connectique
  //   - SMPTE 2110         → géré inline dans Généralités (form.is2110)
  //   - Lumière            → géré inline dans Généralités (form.isLightingFixture)
  //   - Distribution       → conditionnel showDistribution
  //
  // L'onglet Documents a été supprimé (refonte 2026-05-23) : son contenu
  // (notes + placeholder datasheet) est désormais rendu en bas de la col 1
  // du Hero Généralités.
  const tabs = useMemo<TabDescriptor[]>(() => {
    const t: TabDescriptor[] = [
      { id: "general", label: "Généralités", icon: IdCard },
      { id: "connectivity", label: "Connectique", icon: Plug },
    ];
    if (showDistribution) t.push({ id: "distribution", label: "Distribution", icon: Share2 });
    return t;
  }, [showDistribution]);

  // ── Active tab — persisted in localStorage ───────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>(() => tabs[0]?.id ?? "general");

  // Mesure dynamique du centre du tab Connectique pour aligner l'L-leg du
  // SubTabBar des faces (pattern conservé pour Connectique uniquement).
  useLayoutEffect(() => {
    if (activeTab !== "connectivity") {
      setConnectorLeft(null);
      return;
    }
    const el = tabBarContainerRef.current;
    if (!el) return;
    const measure = () => {
      const tab = el.querySelector<HTMLElement>(`[data-tab-key="connectivity"]`);
      if (!tab) return;
      const tabRect = tab.getBoundingClientRect();
      const rootRect = el.getBoundingClientRect();
      // Centre du tab actif, relatif au début du container.
      // -16 (= w-4) pour que le coin bas-droite de l'L-leg tombe pile sous
      // le centre du tab. -0.5 pour compenser la moitié du border-l (1px).
      const left = tabRect.left - rootRect.left + tabRect.width / 2 - 16 - 0.5;
      setConnectorLeft(left);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeTab]);

  // Clé par fiche — stable sur la durée de vie du mount (le fork-on-edit
  // bascule workingIdRef sans remonter le composant, on garde l'id initial).
  const tabStorageKey = `${STORAGE_KEY}:${equipment?.id ?? "new"}`;

  // Hydrate from sessionStorage on mount — ne restaure que si l'entrée de
  // CETTE fiche existe, c.-à-d. uniquement après un rechargement (l'entrée
  // est supprimée au démontage par l'effet cleanup ci-dessous).
  //
  // Note : suite à la réorganisation des onglets (identity/classification/
  // dimensions/characteristics fusionnés dans "general"), une valeur stockée
  // antérieure peut être obsolète — la garde tabs.some() bascule alors
  // proprement vers le fallback "general" via l'effet ci-dessous.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.sessionStorage.getItem(tabStorageKey) as TabId | null;
      if (stored && tabs.some((t) => t.id === stored)) {
        setActiveTab(stored);
      }
    } catch {}
    // We only want this to run once on mount.
    // tabs is stable across renders for a given equipment; using it as a dep
    // would re-run this on every memo change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suppression au DÉMONTAGE (navigation SPA : changement de fiche, retour
  // liste…) — jamais exécuté sur un hard reload, ce qui fait exactement la
  // distinction voulue : seul F5 restaure l'onglet.
  useEffect(() => {
    return () => {
      try {
        window.sessionStorage.removeItem(tabStorageKey);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-validate visible tab if the tab list changes (e.g. user désactive
  // SMPTE 2110 / Lumière depuis Généralités → Identité, ou ancien storage).
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) {
      setActiveTab(tabs[0]?.id ?? "general");
    }
  }, [tabs, activeTab]);

  // Persist active tab (sessionStorage, clé par fiche)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(tabStorageKey, activeTab);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Form helpers ────────────────────────────────────────────────────────
  const set = <K extends keyof FormData>(key: K, val: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const updateConnector = (id: string, patch: Partial<ConnectorEntry>) =>
    setForm((prev) => ({
      ...prev,
      connectorEntries: prev.connectorEntries.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  const removeConnector = (id: string) =>
    setForm((prev) => ({
      ...prev,
      connectorEntries: prev.connectorEntries.filter((c) => c.id !== id),
    }));

  const addConnector = (entry: ConnectorEntry) =>
    setForm((prev) => ({
      ...prev,
      connectorEntries: [...prev.connectorEntries, entry],
    }));

  // Remplace intégralement la liste — utilisé par le drag & drop de réordonnancement
  // dans `ConnectivityTab`. Le composant enfant gère lui-même la reconstruction
  // de la liste complète (faces inactives préservées + face active réordonnée),
  // on se contente ici de persister le nouveau tableau dans le form.
  const reorderConnectors = (newEntries: ConnectorEntry[]) =>
    setForm((prev) => ({ ...prev, connectorEntries: newEntries }));

  const duplicateConnector = (id: string) => {
    setForm((prev) => {
      const src = prev.connectorEntries.find((c) => c.id === id);
      if (!src) return prev;
      const copy: ConnectorEntry = { ...src, id: uid() };
      const idx = prev.connectorEntries.indexOf(src);
      const next = [...prev.connectorEntries];
      next.splice(idx + 1, 0, copy);
      return { ...prev, connectorEntries: next };
    });
  };

  // Upsert d'une capacité d'essence — partagé entre la section auto-détectée
  // (connectivity-tab.tsx) et l'onglet édition Capacité IP (capacity-ip-tab.tsx).
  const handleCapacityChange = (
    signalName: string,
    patch: { in?: number; out?: number },
  ) =>
    setForm((prev) => {
      const cur = prev.signalCapacities;
      const idx = cur.findIndex((c) => c.signalName === signalName);
      if (idx === -1) {
        return {
          ...prev,
          signalCapacities: [
            ...cur,
            { signalName, in: patch.in ?? 0, out: patch.out ?? 0 },
          ],
        };
      }
      const next = [...cur];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, signalCapacities: next };
    });

  // ── Accent color (used across tabs). La catégorie morte (CatalogEquipment-
  //    Category) ayant disparu de la surface superviseur, on retombe sur un
  //    accent neutre — la couleur métier vient désormais de la fonction,
  //    résolue au niveau du bloc Classification (general-tab). ──────────────
  const catColor = "#6366f1";

  // ── Validation (cross-tab) ──────────────────────────────────────────────
  const errors = useMemo(
    () =>
      validateForm(form, {
        showClassification,
        showDistribution,
        typeId,
      }),
    [form, showClassification, showDistribution, typeId],
  );
  const totalErrors = totalErrorCount(errors);

  // Display errors only after the user attempted to save.
  const visibleErrors = saveAttempted ? errors : {};

  // ── Save ─────────────────────────────────────────────────────────────────
  // Build payload depuis n'importe quel snapshot (form + classification).
  // Pur : pas de side-effect, reproductible pour l'autosave hook.
  const buildSavePayload = useCallback(
    (
      f: FormData,
      cl: { typeId: string | null; functionIds: string[]; phaseIds: string[] },
    ): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        reference: f.reference || null,
        category: f.category || null,
        brandId: f.brandId || null,
        isRackable: f.isRackable,
        heightU: f.isRackable ? f.heightU : null,
        depthMm: f.isRackable ? f.depthMm : null,
        rearCableDepthMm: f.isRackable ? f.rearCableDepthMm : null,
        widthFraction: f.isRackable ? f.widthFraction : "FULL",
        dimLmm: !f.isRackable ? f.dimLmm : null,
        dimWmm: !f.isRackable ? f.dimWmm : null,
        dimHmm: !f.isRackable ? f.dimHmm : null,
        weight: f.weight,
        powerW: f.powerW,
        heatBtuH: f.heatBtuH,
        connectors: f.connectorEntries,
        signalCapacities: f.signalCapacities,
        is2110: f.is2110,
        ip2110Mode: f.is2110 ? f.ip2110Mode : null,
        imageUrl: f.imageUrl || null,
        iconUrl: f.iconUrl || null,
        rackSymbolUrl: f.rackSymbolUrl || null,
        rackSymbolRearUrl: f.rackSymbolRearUrl || null,
        rackPhotoFrontUrl: f.rackPhotoFrontUrl || null,
        rackPhotoRearUrl: f.rackPhotoRearUrl || null,
        notes: f.notes || null,
        documents: f.documents ?? [],
        tags: null,
        isActive: f.isActive,
        isLightingFixture: f.isLightingFixture,
        dmxChannelsDefault: f.isLightingFixture ? f.dmxChannelsDefault : null,
        dmxModes: f.isLightingFixture ? f.dmxModes : [],
        isComponentHost: f.isComponentHost,
        hostSlotCount: f.isComponentHost ? f.hostSlotCount : null,
        isComponent: f.isComponent,
        componentSlotSpan: f.isComponent ? f.componentSlotSpan : 1,
      };
      if (showClassification) {
        body.typeId = cl.typeId;
        body.functionIds = cl.functionIds;
        // phaseIds volontairement omis : la Phase est retirée de l'UI. Ne pas
        // envoyer (ni []) préserve les valeurs existantes en base (les routes
        // PATCH n'écrivent que `if (d.phaseIds !== undefined)`).
      }
      if (showDistribution) {
        body.visibleFromPlan = f.visibleFromPlan;
        body.propagation = f.propagation;
        body.pinned = f.pinned;
        body.schemaImageUrl = f.schemaImageUrl ?? null;
        body.frontImageUrl = f.frontImageUrl ?? null;
        body.rearImageUrl = f.rearImageUrl ?? null;
        body.customFields = f.customFields;
      }
      return body;
    },
    [showClassification, showDistribution],
  );

  // Sauvegarde manuelle (bouton « Enregistrer ») — utilisée en mode création.
  // Valide, redirige vers la liste après succès.
  const handleSave = async () => {
    setSaveAttempted(true);
    const errs = validateForm(form, { showClassification, showDistribution, typeId });
    if (totalErrorCount(errs) > 0) {
      const firstErrorTab = tabs.find((t) => (errs[t.id] ?? 0) > 0);
      if (firstErrorTab) setActiveTab(firstErrorTab.id);
      return;
    }
    if (!form.name.trim()) return;

    setSaving(true);
    try {
      const body = buildSavePayload(form, { typeId, functionIds, phaseIds });
      if (isEdit) {
        await api.patch(`${saveApiBase}/${workingIdRef.current}`, body);
        if (!tenantContext?.isTenantMode) {
          router.push(backUrl);
          router.refresh();
        }
      } else {
        // POST — récupère l'id pour la redirection éventuelle vers l'édition.
        const created = await api.post<{ id?: string }>(saveApiBase, body);
        // Notifie les onglets inventaire ouverts pour qu'ils refetchent.
        broadcastCatalogUpdated();
        if (createRedirectPath && created?.id) {
          router.push(createRedirectPath(created.id));
        } else {
          router.push(backUrl);
          router.refresh();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-save unifié + Undo / Redo ──────────────────────────────────────
  //
  // Conditions auto-save :
  //   - mode édition (existe en DB)
  //   - pas de proposal
  //   - pas Arkyo
  //   - nom non vide
  //
  // Activé en mode supervisor ET tenant (refonte 2026-05-23).
  // Le hook gère le skip du premier render → pas de PATCH au mount.
  type EquipmentSnapshot = {
    form: FormData;
    typeId: string | null;
    functionIds: string[];
    phaseIds: string[];
  };

  const snapshot = useMemo<EquipmentSnapshot>(
    () => ({ form, typeId, functionIds, phaseIds }),
    [form, typeId, functionIds, phaseIds],
  );

  const applySnapshot = useCallback((s: EquipmentSnapshot) => {
    setForm(s.form);
    setTypeId(s.typeId);
    setFunctionIds(s.functionIds);
    setPhaseIds(s.phaseIds);
  }, []);

  // ── Réconciliation temps réel ────────────────────────────────────────────
  // Quand un autre collaborateur modifie la fiche, <AppSync> déclenche un
  // router.refresh() : le Server Component re-fetch et passe un nouveau prop
  // `equipment`. On réhydrate l'état éditable depuis ce prop — sauf saisie
  // locale en cours (garde anti-écrasement dans useServerReconcile).
  // Désactivé en création (rien à réconcilier) et en mode proposition (le
  // flux de révision pilote l'état via prefillData).
  const serverSnapshot = useMemo<EquipmentSnapshot>(
    () => ({
      form: initialForm(equipment),
      typeId: equipment?.typeId ?? null,
      functionIds: equipment?.functions
        ? equipment.functions.map((ef) => ef.functionId)
        : [],
      phaseIds: equipment?.phases
        ? equipment.phases.map((ep) => ep.phaseId)
        : [],
    }),
    [equipment],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useServerReconcile<EquipmentSnapshot>({
    serverValue: serverSnapshot,
    getLocalValue: () => snapshotRef.current,
    apply: applySnapshot,
    enabled: isEdit && !proposalId,
  });

  const canAutosave =
    isEdit && !isSupervisorArkyo && !proposalId && !!form.name.trim();

  const { status: saveStatus, lastSavedAt, forceSave } = useEditorAutosave<EquipmentSnapshot>({
    values: snapshot,
    enabled: canAutosave,
    save: async (s, signal) => {
      const body = buildSavePayload(s.form, {
        typeId: s.typeId,
        functionIds: s.functionIds,
        phaseIds: s.phaseIds,
      });
      try {
        const saved = await api.patch<{ id?: string }>(
          `${saveApiBase}/${workingIdRef.current}`,
          body,
          { signal },
        );
        // arkyo-server: pas de fork-on-edit (catalogue unique) : le PATCH
        // renvoie toujours l'équipement lui-même, l'id de travail et l'URL ne
        // changent pas.
        void saved;
      } catch (e) {
        // arkyo-server: refus de plan (PLAN_RESTRICTED) retiré (pas de plan).
        throw e;
      }
    },
  });

  const { canUndo, canRedo, undo, redo } = useEditorHistory<EquipmentSnapshot>({
    values: snapshot,
    setValues: applySnapshot,
    enabled: !isSupervisorArkyo && !proposalId,
  });

  // Cmd+S → force flush immédiat (mode édition).
  useEffect(() => {
    if (!canAutosave) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || (e.key !== "s" && e.key !== "S")) return;
      e.preventDefault();
      void forceSave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAutosave, forceSave]);

  // Fiche Arkyo pure côté tenant (pas encore forkée) : éditable, mais on
  // garde « Signaler une erreur » pour remonter une correction au référentiel.
  const isTenantArkyoPure =
    isTenantMode && tenantContext?.isArkyoSource === true && !isShadowFork;

  // arkyo-server: « Récupérer la version Arkyo » retiré (catalogue unique).

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ──
          Trois variantes :
          - Tenant Arkyo (lecture pure) : breadcrumb + bouton Fermer
            uniquement. Pas d'Undo/Redo, pas de badge, pas de bouton
            Enregistrer/Proposer.
          - Tenant édition personnelle : breadcrumb + Undo/Redo +
            badge auto-save + Fermer/Enregistrer.
          - Supervisor : icône colorée + nom + ActivePill + Undo/Redo +
            badge auto-save + Fermer/Annuler/Enregistrer. */}
      {isTenantMode ? (
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
              href="/admin/catalogue?tab=equipment"
              className="transition-colors hover:text-[var(--foreground)]"
            >
              Équipements
            </a>
          </nav>

          {!proposalId && (
            <div className="flex shrink-0 items-center gap-2">
              {/* arkyo-server: « Signaler une erreur » (fiche Arkyo pure) et
                  « Récupérer la version Arkyo » (fork éclipsant) retirés :
                  catalogue unique. */}
              {isEdit && (
                <EditorUndoRedo
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onUndo={undo}
                  onRedo={redo}
                />
              )}
              {isEdit && (
                <EditorStatusBadge status={saveStatus} lastSavedAt={lastSavedAt} />
              )}
              <button
                type="button"
                onClick={() => router.push(backUrl)}
                className="h-8 rounded-lg border border-[var(--border)]/60 px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
              >
                {isEdit ? "Fermer" : "Annuler"}
              </button>
              {/* Mode création tenant : bouton manuel (auto-save inactive
                  tant que l'item n'existe pas en DB). Mode édition : retiré. */}
              {!isEdit && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                  // arkyo-server: habillage Strata
                  className="flex h-8 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Enregistrer
                </button>
              )}
            </div>
          )}
        </header>
      ) : (
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--border)]/60 px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--foreground)]"
              style={{ background: `${catColor}20` }}
            >
              <EquipmentIcon iconUrl={form.iconUrl} size={16} />
            </div>
            <h1 className="truncate text-sm font-semibold">
              {isEdit ? equipment!.name : "Nouvel équipement"}
            </h1>
            {/* Switch « Actif » — directement à côté du nom, sans label
                redondant (vert = visible dans le catalogue, gris = masqué). */}
            {showDistribution && !isSupervisorArkyo && (
              <ActivePill
                checked={form.isActive}
                onChange={(v) => set("isActive", v)}
              />
            )}
          </div>

          {!isSupervisorArkyo && !proposalId && (
            <div className="flex shrink-0 items-center gap-2">
              {isEdit && (
                <EditorUndoRedo
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onUndo={undo}
                  onRedo={redo}
                />
              )}
              {isEdit && (
                <EditorStatusBadge status={saveStatus} lastSavedAt={lastSavedAt} />
              )}
              <button
                onClick={() => router.push(backUrl)}
                className="h-8 rounded-lg border border-[var(--border)]/60 px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
              >
                {isEdit ? "Fermer" : "Annuler"}
              </button>
              {/* Mode création supervisor : bouton manuel.
                  Mode édition supervisor : auto-save → pas de bouton. */}
              {!isEdit && (
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                  // arkyo-server: habillage Strata
                  className="flex h-8 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Enregistrer
                </button>
              )}
            </div>
          )}
        </header>
      )}

      {/* ── Arkyo catalog warning (supervisor uniquement — côté tenant, les
          items Arkyo sont éditables via fork-on-edit) ── */}
      {isSupervisorArkyo && (
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
              Cet équipement provient du catalogue arkyo. Consultation uniquement.
            </p>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div
        ref={tabBarContainerRef}
        className="relative shrink-0 border-b border-[var(--border)]/60 px-6 py-3"
      >
        <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} errors={visibleErrors} />
        {/* Sous-onglets faces — visibles uniquement pour Connectique,
            positionnés via paddingLeft mesuré pour s'aligner sous le tab parent.
            Note : Généralités n'a plus de sous-onglets depuis 2026-05-23 — toutes
            les sections (Identité, Classification, Physique, Images) sont rendues
            empilées dans GeneralTab. */}
        {activeTab === "connectivity" && (
          <div className="mt-1">
            <ConnectivityFaceTabs
              form={form}
              activeFace={activeFace}
              setActiveFace={setActiveFace}
              paddingLeft={connectorLeft}
            />
          </div>
        )}
      </div>

      {/* ── Tab content ──
          Le mode Arkyo supervisor (catalogue importé, pas tenant) conserve
          l'overlay d'opacité legacy (lecture seule). Côté tenant, tout est
          éditable — y compris les items Arkyo (fork-on-edit). */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto p-5",
          isSupervisorArkyo && "pointer-events-none opacity-80",
        )}
      >
        {/* Généralités — sous-onglets internes (Identité / Classification / Caractéristiques physiques / Images) */}
        {activeTab === "general" && (
          <div className="w-full">
            <GeneralTab
              form={form}
              set={set}
              brands={brands}
              // En mode Arkyo supervisor (catalogue importé), tout passe en
              // lecture seule via l'overlay opacity du conteneur ci-dessus.
              // Côté tenant, plus aucune lecture pure : les items Arkyo sont
              // éditables (fork-on-edit).
              isReadOnly={false}
              catColor={catColor}
              uHeights={uHeights}
              cableSafetyDefaultMm={cableSafetyDefaultMm}
              showClassification={showClassification}
              showDistribution={showDistribution}
              onCapacityChange={handleCapacityChange}
              functions={functions}
              types={typesState}
              typeId={typeId}
              setTypeId={setTypeId}
              functionIds={functionIds}
              setFunctionIds={setFunctionIds}
              // Création de type/sous-type perso : réservée au mode tenant
              // (la route POST cible /api/tenant/...). En superviseur, non exposé.
              onCreateType={isTenantMode ? handleCreateType : undefined}
            />
          </div>
        )}

        {/* Connectique — full height layout */}
        {activeTab === "connectivity" && (
          <div className="h-full w-full">
            <ConnectivityTab
              form={form}
              catColor={catColor}
              connectorTypes={connectorTypes}
              signals={signals}
              signalCategories={signalCategories}
              functions={functions}
              activeFace={activeFace}
              addingFace={addingFace}
              setAddingFace={setAddingFace}
              editingPortId={editingPortId}
              setEditingPortId={setEditingPortId}
              addConnector={addConnector}
              updateConnector={updateConnector}
              removeConnector={removeConnector}
              reorderConnectors={reorderConnectors}
              duplicateConnector={duplicateConnector}
              onCapacityChange={handleCapacityChange}
              isReadOnly={false}
            />
          </div>
        )}

        {/* SMPTE 2110 — visible uniquement si form.is2110 */}
        {/* SMPTE 2110 + Lumière : configurations rendues inline dans le
            sous-onglet Identité (Généralités), sous chaque toggle activé. */}

        {/* Distribution */}
        {activeTab === "distribution" && showDistribution && (
          <div className="w-full">
            <DistributionTab form={form} set={set} catColor={catColor} />
          </div>
        )}
      </div>

      {/* ── Footer with save (also when scrolled) ── */}
      {totalErrors > 0 && saveAttempted && !isSupervisorArkyo && (
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

// ── Pill « Actif » dans le header — toggle de visibilité catalogue ──────────
//
// Vert = visible / Gris = masqué. Placé directement à côté du nom (pas de
// label : la couleur + le texte du pill suffisent à l'identifier).

function ActivePill({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      title={checked ? "Visible dans le catalogue" : "Masqué du catalogue"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors",
        checked
          // arkyo-server: habillage Strata
          ? "bg-[var(--success)]/15 text-[var(--success-text)] hover:bg-[var(--success)]/20"
          : "bg-[var(--secondary)]/60 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          // arkyo-server: habillage Strata
          checked ? "bg-[var(--success)]" : "bg-[var(--muted-foreground)]",
        )}
      />
      {checked ? "Actif" : "Inactif"}
    </button>
  );
}

