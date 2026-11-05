// Shared types for the EquipmentEditor refactor.
// Centralised here so each tab module only depends on this file
// (avoids circular imports and keeps the orchestrator thin).

export type Brand = { id: string; name: string; logoUrl: string | null };

export type ConnectorType = {
  id: string;
  name: string;
  version: string | null;
  /** Variantes physiques (75Ω, Cat 6a, 1.4…) pour ce même type de connecteur.
   *  Provient de `CatalogConnectorType.versions` côté main DB. Si l'API legacy
   *  ne le fournit pas, traiter comme tableau vide. */
  versions?: string[];
  category: string;
  iconId: string;
  color: string;
};

export type Signal = {
  id: string;
  name: string;
  category: string;
  /** Soft-FK vers CatalogFunction — la « fonction » broadcast du signal
   *  (Vidéo, Audio, Données…), utilisée pour grouper les signaux. */
  functionId?: string | null;
  color: string;
  connectors: unknown;
  /** Signal IP : voyage uniquement sur IP (Dante, ST2110, NDI, MADI/IP…). */
  isIp?: boolean;
  /** Le protocole supporte-t-il la redondance Class A/B (ST 2022-7) ? */
  supportsRedundancy?: boolean;
};

export type SignalCategory = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
};

export type ConnectorEntry = {
  id: string;
  face: "FRONT" | "REAR" | "LEFT" | "RIGHT" | "TOP" | "BOTTOM";
  connectorTypeId: string;
  /** Variante physique du connecteur sélectionnée (ex. "75Ω", "Cat 6a", "1.4").
   *  Optionnel — `undefined` ou chaîne vide = aucune variante précisée. */
  version?: string;
  signalName: string;
  quantity: number;
  label: string;
  direction: "IN" | "OUT" | "BOTH";
  gender: "MALE" | "FEMALE";
  /** Rôle réseau du port. Si undefined, le port n'est pas considéré
   *  comme un port réseau (n'apparaît pas dans l'onglet Réseau du projet).
   *  - endpoint  : port IP (caméra, mixeur, serveur…)
   *  - switching : port L2 d'un switch managé (access ou trunk)
   *  - transit   : port L1 transparent (media converter, switch non managé) */
  networkRole?: "endpoint" | "switching" | "transit";
  /** Override exceptionnel : désactive la redondance sur ce port spécifique
   *  même si le signal la supporte (CatalogSignalType.supportsRedundancy).
   *  Le style d'étiquetage (A/B, P/S, Bleu/Rouge) est lui géré au niveau du
   *  signal, pas du port. */
  disableRedundancy?: boolean;
};

// ─── Custom fields (bloc Divers — Caractéristiques) ──────────────────────────
//
// L'utilisateur peut créer dynamiquement des champs supplémentaires sur un
// équipement, en choisissant un type parmi text/number/boolean. Pour les
// champs `number`, une configuration optionnelle `{ min, max, step, unit }`
// permet de personnaliser le slider.

export type CustomFieldType = "text" | "number" | "boolean";

export type CustomFieldConfig = {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
};

export type CustomField = {
  id: string;
  label: string;
  type: CustomFieldType;
  value: string | number | boolean;
  config?: CustomFieldConfig;
};

/**
 * Capacité en essences IP d'un équipement pour un signal donné.
 * Stockée sur `CatalogEquipment.signalCapacities` en Json[].
 *
 * - `in`  : nombre de canaux/streams que l'équipement peut recevoir.
 *           Informatif (vérification de capacité réception).
 * - `out` : nombre de canaux/streams que l'équipement émet.
 *           Pour ST 2110, drive le plan d'adressage multicast — chaque
 *           essence OUT = 1 multicast group. Les destinations sont gérées
 *           par le contrôleur NMOS et n'ont pas besoin d'adresse pré-allouée.
 */
export type SignalCapacity = {
  signalName: string;
  in: number;
  out: number;
};

/**
 * Document additionnel attaché à un équipement (datasheet, manuel, lien
 * externe…). Persisté côté DB sur `CatalogEquipment.documents` /
 * `TenantEquipment.documents` (Json @default("[]")).
 */
export type EquipmentDocument = {
  id: string;
  title: string;
  url: string;
};

export type FormData = {
  name: string;
  reference: string;
  category: string;
  brandId: string;
  isRackable: boolean;
  heightU: number | null;
  depthMm: number | null;
  /** Override réserve câblage arrière (mm). `null` = hérite du global `cable_safety_depth_mm`. */
  rearCableDepthMm: number | null;
  widthFraction: "FULL" | "HALF" | "THIRD" | "QUARTER";
  dimLmm: number | null;
  dimWmm: number | null;
  dimHmm: number | null;
  weight: number | null;
  powerW: number | null;
  heatBtuH: number | null;
  /** Prise en charge SMPTE ST 2110 par l'équipement. Quand `true`, les
   *  capacités d'essence (`signalCapacities`) et le mode de pilotage
   *  (`ip2110Mode`) sont éditables dans l'onglet Capacité IP. */
  is2110: boolean;
  /** Mode de pilotage ST 2110 :
   *  - `OOB` (Out Of Band)   : management plane séparé (NMOS sur LAN dédié)
   *  - `IB`  (In Band)       : management plane embarqué dans le réseau media
   *  - `null`                 : non applicable (équipement non ST 2110) */
  ip2110Mode: "OOB" | "IB" | null;
  connectorEntries: ConnectorEntry[];
  /** Capacité en essences IP par signal (Dante/2110/NDI…). Crucial pour
   *  ST 2110 : `out` détermine le plan d'adressage multicast des sources
   *  (les destinations sont gérées par le contrôleur NMOS et n'ont pas
   *  besoin d'adresse pré-allouée). */
  signalCapacities: SignalCapacity[];
  customFields: CustomField[];
  imageUrl: string;
  /** Override icône — nom lucide curated ou URL uploadée. Null/vide => hérite de la catégorie. */
  iconUrl: string | null;
  rackSymbolUrl: string;
  rackSymbolRearUrl: string;
  rackPhotoFrontUrl: string;
  rackPhotoRearUrl: string;
  notes: string;
  isActive: boolean;
  /** Mode lumière — l'équipement est-il un appareil DMX ? */
  isLightingFixture: boolean;
  /** Nombre de canaux DMX par défaut (mode "standard"). */
  dmxChannelsDefault: number | null;
  /** Modes DMX disponibles (palette de configurations). */
  dmxModes: Array<{ name: string; channels: number }>;
  /** Châssis modulaire — l'équipement peut-il accueillir des composants
   *  (cartes, alims, modules type Ross openGear) ? Exclusif avec `isComponent`. */
  isComponentHost: boolean;
  /** Nombre de slots internes de l'hôte. `null` si non applicable. */
  hostSlotCount: number | null;
  /** L'équipement est-il un composant (s'insère dans un hôte) ?
   *  Exclusif avec `isComponentHost`. */
  isComponent: boolean;
  /** Nombre de slots occupés par le composant dans son hôte. */
  componentSlotSpan: number;
  // Distribution (Supervisor only — persisted only when showDistribution is true)
  visibleFromPlan: string;
  propagation: string;
  pinned: boolean;
  // Line art illustrations (Supervisor only — ignorées côté tenant)
  schemaImageUrl: string | null;
  frontImageUrl: string | null;
  rearImageUrl: string | null;
  // Documents additionnels (datasheet, manuel, liens externes).
  documents: EquipmentDocument[];
};

export type EquipmentData = {
  id: string;
  name: string;
  reference: string | null;
  category: string | null;
  brandId: string | null;
  brand?: Brand | null;
  isRackable: boolean;
  heightU: number | null;
  depthMm: number | null;
  rearCableDepthMm: number | null;
  widthFraction: string;
  dimLmm: number | null;
  dimWmm: number | null;
  dimHmm: number | null;
  weight: number | null;
  powerW: number | null;
  heatBtuH: number | null;
  hasDualPsu: boolean;
  is2110: boolean;
  ip2110Mode: string | null;
  connectors: unknown;
  signalCapacities?: unknown;
  customFields?: unknown;
  imageUrl: string | null;
  iconUrl?: string | null;
  rackSymbolUrl?: string | null;
  rackSymbolRearUrl?: string | null;
  rackPhotoFrontUrl?: string | null;
  rackPhotoRearUrl?: string | null;
  notes: string | null;
  tags: unknown;
  isActive: boolean;
  isLightingFixture?: boolean | null;
  dmxChannelsDefault?: number | null;
  dmxModes?: unknown;
  isComponentHost?: boolean;
  hostSlotCount?: number | null;
  isComponent?: boolean;
  componentSlotSpan?: number;
  sourceType?: string | null;
  typeId?: string | null;
  functions?: { functionId: string }[];
  phases?: { phaseId: string }[];
  visibleFromPlan?: string | null;
  propagation?: string | null;
  pinned?: boolean | null;
  schemaImageUrl?: string | null;
  frontImageUrl?: string | null;
  rearImageUrl?: string | null;
  documents?: unknown;
};

export type CatalogFunctionLite = {
  id: string;
  label: string;
  color: string;
  key: string;
};

export type CatalogPhaseLite = {
  id: string;
  label: string;
  key: string;
};

export type CatalogTypeLite = {
  id: string;
  name: string;
  functionId: string;
  /** Type parent (racine). null = type racine ; défini = sous-type
   *  (profondeur 1). Hérite de la `functionId` du parent côté API. */
  parentId: string | null;
  /** Origine : ARKYO (référentiel, lecture seule) ou PERSONAL (tenant, créé
   *  à la volée). Optionnel — absent = traité comme Arkyo (pas de repère). */
  source?: "ARKYO" | "PERSONAL";
  function: { label: string; color: string };
  /** Icône par défaut du type — id curated dans lucide OU URL uploadée.
   *  Utilisée comme placeholder pour les équipements sans iconUrl propre. */
  iconId?: string | null;
  /** Schéma de principe par défaut du type (URL uploadée). Placeholder
   *  pour les équipements sans schemaImageUrl propre. */
  schemaImageUrl?: string | null;
};

// ─── Tab IDs ───────────────────────────────────────────────────────────────

export type TabId =
  | "general"
  | "connectivity"
  | "distribution";

/** Sous-onglets internes au tab "Généralités". */
export type GeneralSubTabId = "identity" | "classification" | "physical" | "images";

// ─── UI constants ──────────────────────────────────────────────────────────

export const WF_OPTIONS: { value: FormData["widthFraction"]; label: string }[] = [
  { value: "FULL", label: "1/1" },
  { value: "HALF", label: "1/2" },
  { value: "THIRD", label: "1/3" },
  { value: "QUARTER", label: "1/4" },
];

export const FACE_COLORS: Record<ConnectorEntry["face"], string> = {
  FRONT: "#3b82f6",
  REAR: "#8b5cf6",
  LEFT: "#10b981",
  RIGHT: "#f59e0b",
  TOP: "#06b6d4",
  BOTTOM: "#ef4444",
};

export const FACE_LABELS: Record<ConnectorEntry["face"], string> = {
  FRONT: "Devant",
  REAR: "Arrière",
  LEFT: "Gauche",
  RIGHT: "Droite",
  TOP: "Dessus",
  BOTTOM: "Dessous",
};

export const FACE_ORDER: ConnectorEntry["face"][] = [
  "REAR",
  "FRONT",
  "LEFT",
  "RIGHT",
  "TOP",
  "BOTTOM",
];

export const DIR_OPTIONS: {
  value: ConnectorEntry["direction"];
  label: string;
  short: string;
  color: string;
}[] = [
  { value: "IN", label: "Entrée", short: "IN", color: "#10b981" },
  { value: "OUT", label: "Sortie", short: "OUT", color: "#f59e0b" },
  { value: "BOTH", label: "Bidirectionnel", short: "I/O", color: "#6366f1" },
];

export const GENDER_OPTIONS: {
  value: ConnectorEntry["gender"];
  label: string;
  short: string;
}[] = [
  { value: "MALE", label: "Mâle", short: "M" },
  { value: "FEMALE", label: "Femelle", short: "F" },
];

export const inputCls =
  "flex h-8 w-full rounded-lg border border-[var(--border)]/60 bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

// ─── Helpers ───────────────────────────────────────────────────────────────

export function uid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Defensive parse of `customFields` coming from DB / API. Always returns an
// array, drops any malformed entries silently — the UI is the source of truth
// once mounted.
function parseCustomFields(raw: unknown): CustomField[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const type = r.type;
    if (type !== "text" && type !== "number" && type !== "boolean") continue;
    const label = typeof r.label === "string" ? r.label : "";
    const id = typeof r.id === "string" && r.id ? r.id : uid();
    let value: string | number | boolean;
    if (type === "text") {
      value = typeof r.value === "string" ? r.value : "";
    } else if (type === "number") {
      value = typeof r.value === "number" ? r.value : 0;
    } else {
      value = typeof r.value === "boolean" ? r.value : false;
    }
    const config =
      r.config && typeof r.config === "object" ? (r.config as CustomFieldConfig) : undefined;
    out.push({ id, label, type, value, ...(config ? { config } : {}) });
  }
  return out;
}

function parseDmxModes(raw: unknown): Array<{ name: string; channels: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; channels: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    const channels =
      typeof r.channels === "number" && Number.isFinite(r.channels)
        ? Math.max(1, Math.floor(r.channels))
        : 1;
    if (!name) continue;
    out.push({ name, channels });
  }
  return out;
}

function parseDocuments(raw: unknown): EquipmentDocument[] {
  if (!Array.isArray(raw)) return [];
  const out: EquipmentDocument[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" && r.id ? r.id : uid();
    const title = typeof r.title === "string" ? r.title : "";
    const url = typeof r.url === "string" ? r.url : "";
    out.push({ id, title, url });
  }
  return out;
}

function parseSignalCapacities(raw: unknown): SignalCapacity[] {
  if (!Array.isArray(raw)) return [];
  const out: SignalCapacity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.signalName !== "string" || !r.signalName) continue;
    const inN = typeof r.in === "number" ? Math.max(0, Math.floor(r.in)) : 0;
    const outN = typeof r.out === "number" ? Math.max(0, Math.floor(r.out)) : 0;
    out.push({ signalName: r.signalName, in: inN, out: outN });
  }
  return out;
}

export function initialForm(eq: EquipmentData | null): FormData {
  let connectorEntries: ConnectorEntry[] = [];
  if (eq && Array.isArray(eq.connectors)) {
    connectorEntries = (eq.connectors as ConnectorEntry[]).map((c) => ({
      ...c,
      id: c.id ?? uid(),
      signalName: c.signalName ?? "",
      gender: c.gender ?? "FEMALE",
    }));
  }
  return {
    name: eq?.name ?? "",
    reference: eq?.reference ?? "",
    category: eq?.category ?? "",
    brandId: eq?.brandId ?? "",
    isRackable: eq?.isRackable ?? true,
    heightU: eq?.heightU ?? 1,
    depthMm: eq?.depthMm ?? 0,
    rearCableDepthMm: eq?.rearCableDepthMm ?? null,
    widthFraction: (eq?.widthFraction as FormData["widthFraction"]) ?? "FULL",
    dimLmm: eq?.dimLmm ?? 0,
    dimWmm: eq?.dimWmm ?? 0,
    dimHmm: eq?.dimHmm ?? 0,
    weight: eq?.weight ?? 0,
    powerW: eq?.powerW ?? 0,
    heatBtuH: eq?.heatBtuH ?? 0,
    is2110: eq?.is2110 ?? false,
    ip2110Mode:
      eq?.ip2110Mode === "OOB" || eq?.ip2110Mode === "IB"
        ? eq.ip2110Mode
        : null,
    connectorEntries,
    signalCapacities: parseSignalCapacities(eq?.signalCapacities),
    customFields: parseCustomFields(eq?.customFields),
    imageUrl: eq?.imageUrl ?? "",
    iconUrl: eq?.iconUrl ?? null,
    rackSymbolUrl: eq?.rackSymbolUrl ?? "",
    rackSymbolRearUrl: eq?.rackSymbolRearUrl ?? "",
    rackPhotoFrontUrl: eq?.rackPhotoFrontUrl ?? "",
    rackPhotoRearUrl: eq?.rackPhotoRearUrl ?? "",
    notes: eq?.notes ?? "",
    isActive: eq?.isActive ?? true,
    isLightingFixture: !!eq?.isLightingFixture,
    dmxChannelsDefault: eq?.dmxChannelsDefault ?? null,
    dmxModes: parseDmxModes(eq?.dmxModes),
    isComponentHost: eq?.isComponentHost ?? false,
    hostSlotCount: eq?.hostSlotCount ?? null,
    isComponent: eq?.isComponent ?? false,
    componentSlotSpan: eq?.componentSlotSpan ?? 1,
    visibleFromPlan: eq?.visibleFromPlan ?? "FREE",
    propagation: eq?.propagation ?? "AUTO",
    pinned: eq?.pinned ?? false,
    schemaImageUrl: eq?.schemaImageUrl ?? null,
    frontImageUrl: eq?.frontImageUrl ?? null,
    rearImageUrl: eq?.rearImageUrl ?? null,
    documents: parseDocuments(eq?.documents),
  };
}

// ─── Validation (cross-tab) ────────────────────────────────────────────────
//
// We don't pull in Zod for this very simple contract — a pure function
// returning a per-tab error count keeps the orchestrator small and avoids
// adding a runtime dep just to count errors.

export type TabErrors = Partial<Record<TabId, number>>;

export function validateForm(
  form: FormData,
  opts: { showClassification: boolean; showDistribution: boolean; typeId: string | null },
): TabErrors {
  const errors: TabErrors = {};

  // Tout ce qui était "identity / classification / dimensions / characteristics"
  // est désormais sous l'onglet parent "Généralités" (sous-onglets internes).
  let general = 0;

  // Identité : nom obligatoire.
  if (!form.name.trim()) general += 1;

  // Caractéristiques physiques : heightU requis si rackable (flag, ne bloque pas).
  if (form.isRackable) {
    if (form.heightU == null || form.heightU < 1) general += 1;
  }

  if (general) errors.general = general;

  // Other tabs currently have no required fields; their counts stay at 0.
  void opts;

  return errors;
}

export function totalErrorCount(e: TabErrors): number {
  return Object.values(e).reduce<number>((a, n) => a + (n ?? 0), 0);
}
