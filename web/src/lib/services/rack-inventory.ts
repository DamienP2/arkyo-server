/**
 * Rack inventory — logique pure pour le BOM (Bill of Materials) d'un rack.
 *
 * Ce module est 100% TypeScript pur : aucune dépendance à Prisma, React,
 * Next.js ou `@/lib/db`. Les fonctions sont déterministes et sans effet
 * de bord. Elles reçoivent l'état nécessaire en paramètre et retournent
 * un résultat typé.
 *
 * Contexte : un `Rack` (contenant) possède :
 *   - des `RackSlot` qui placent physiquement Equipment/Panel à un (startU, column, view)
 *   - des `RackInventoryItem` (BOM) qui listent les références catalogue à
 *     équiper, indépendamment de la position physique
 *
 * Le BOM peut être auto-initialisé depuis les slots existants d'un Rack
 * template (cf `deriveBomFromSlots`). Une fois initialisé, le BOM et les
 * slots vivent indépendamment — pas de synchronisation automatique.
 *
 * Note : les `RackSlot` ne portent pas d'adaptateurs. Les adaptateurs ne
 * peuvent être ajoutés au BOM que via une saisie utilisateur directe (drag
 * & drop ou POST API). Le clone d'un Rack template ne produit donc aucun
 * `BomItem` de kind `adapter`.
 */

/**
 * Représentation minimale d'un slot pour la dérivation du BOM.
 * Reflète les colonnes `equipmentId` / `panelId` de `RackSlot` (Prisma).
 */
export type SlotInput = {
  equipmentId: string | null;
  panelId: string | null;
};

/**
 * Type d'accessoire rack non catalogué (saisi à la main par l'utilisateur).
 */
export type AccessoryType = "plaque" | "etagere" | "tiroir";

/**
 * Variantes possibles pour un accessoire de type `plaque`.
 */
export type PlaqueVariant = "plein" | "pass-cable" | "aere";

/**
 * Hauteur U valide pour un accessoire (1 à 8 unités).
 */
export type AccessoryHeightU = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Item de BOM agrégé. Exactement UN type de référence est défini :
 *   - equipmentId, OU
 *   - panelId, OU
 *   - adapterId, OU
 *   - accessoryType + accessoryHeightU (+ accessoryVariant si plaque,
 *     + accessoryDepthMm si étagère/tiroir)
 *
 * Pour les accessoires étagère/tiroir, deux entrées de mêmes
 * (accessoryType, accessoryHeightU) mais de `accessoryDepthMm` différents
 * sont **considérées comme distinctes** : une étagère 300mm n'est pas
 * substituable à une étagère 450mm.
 */
export type BomItem = {
  equipmentId?: string;
  panelId?: string;
  adapterId?: string;
  accessoryType?: AccessoryType;
  accessoryHeightU?: AccessoryHeightU;
  accessoryVariant?: PlaqueVariant;
  /** Profondeur en mm — uniquement étagère/tiroir. */
  accessoryDepthMm?: number;
  quantity: number;
};

/**
 * Convertit une liste de `RackSlot` (avec `equipmentId` / `panelId`) en BOM
 * agrégé. Les slots qui référencent la même entité catalogue sont groupés
 * dans un unique `BomItem` dont `quantity` reflète le nombre d'occurrences.
 *
 * Règles :
 *   - Slot sans `equipmentId` ni `panelId` (étagère vide, plaque, accessoire
 *     non catalogué) : ignoré.
 *   - Slot avec `equipmentId` ET `panelId` (cas illogique théoriquement
 *     impossible mais possible en données) : priorité à `equipmentId` —
 *     le slot est compté comme un équipement, le `panelId` est ignoré.
 *   - L'ordre des `BomItem` retournés suit l'ordre de première apparition
 *     des références dans `slots` (déterministe).
 *   - Les accessoires (plaque/étagère/tiroir) ne sont jamais générés ici :
 *     ils sont créés via saisie utilisateur uniquement.
 *
 * Pure : aucun side-effect, aucun accès I/O.
 */
export function deriveBomFromSlots(slots: SlotInput[]): BomItem[] {
  // Map keyed by "equipment:<id>" or "panel:<id>" pour préserver l'ordre
  // de première apparition (Map JS préserve l'ordre d'insertion).
  const byKey = new Map<string, BomItem>();

  for (const slot of slots) {
    let key: string | null = null;
    let item: BomItem | null = null;

    if (slot.equipmentId) {
      // Priorité à equipmentId si les deux sont renseignés.
      key = `equipment:${slot.equipmentId}`;
      item = { equipmentId: slot.equipmentId, quantity: 1 };
    } else if (slot.panelId) {
      key = `panel:${slot.panelId}`;
      item = { panelId: slot.panelId, quantity: 1 };
    }

    if (key === null || item === null) {
      // Slot sans référence catalogue — ignoré.
      continue;
    }

    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Discriminant du kind de référence catalogue d'un `RackInventoryItem`.
 */
export type InventoryRefKind = "equipment" | "panel" | "adapter" | "accessory";

/**
 * Résultat discriminé de `validateInventoryRef`.
 *
 * Pour les références catalogue (equipment/panel/adapter), seul le `refId`
 * est porté. Pour un accessoire, on porte la combinaison
 * (accessoryType, accessoryHeightU, accessoryVariant?) qui forme l'identité
 * de l'accessoire.
 */
export type InventoryRef =
  | { kind: "equipment"; refId: string }
  | { kind: "panel"; refId: string }
  | { kind: "adapter"; refId: string }
  | {
      kind: "accessory";
      accessoryType: AccessoryType;
      accessoryHeightU: AccessoryHeightU;
      accessoryVariant?: PlaqueVariant;
      /** Profondeur en mm — uniquement étagère/tiroir. */
      accessoryDepthMm?: number;
    };

const ACCESSORY_TYPES: ReadonlyArray<AccessoryType> = [
  "plaque",
  "etagere",
  "tiroir",
];

const PLAQUE_VARIANTS: ReadonlyArray<PlaqueVariant> = [
  "plein",
  "pass-cable",
  "aere",
];

const ACCESSORY_HEIGHTS_U: ReadonlyArray<AccessoryHeightU> = [1, 2, 3, 4, 5, 6, 7, 8];

function isAccessoryType(value: unknown): value is AccessoryType {
  return (
    typeof value === "string" &&
    (ACCESSORY_TYPES as ReadonlyArray<string>).includes(value)
  );
}

function isPlaqueVariant(value: unknown): value is PlaqueVariant {
  return (
    typeof value === "string" &&
    (PLAQUE_VARIANTS as ReadonlyArray<string>).includes(value)
  );
}

function isAccessoryHeightU(value: unknown): value is AccessoryHeightU {
  return (
    typeof value === "number" &&
    (ACCESSORY_HEIGHTS_U as ReadonlyArray<number>).includes(value)
  );
}

/**
 * Valide qu'un body d'API CRUD pour `RackInventoryItem` contient
 * EXACTEMENT une référence parmi :
 *   - `equipmentId` (chaîne non vide)
 *   - `panelId` (chaîne non vide)
 *   - `adapterId` (chaîne non vide)
 *   - accessoire complet : `accessoryType` + `accessoryHeightU` (et
 *     `accessoryVariant` si type=plaque)
 *
 * Lève une `Error` (avec message FR) si :
 *   - aucune référence n'est fournie ;
 *   - plusieurs références sont fournies ;
 *   - un accessoire est partiellement renseigné (un seul des deux champs
 *     `accessoryType` / `accessoryHeightU`) ;
 *   - `accessoryType` ou `accessoryHeightU` ou `accessoryVariant` ont des
 *     valeurs invalides ;
 *   - un accessoire de type plaque sans `accessoryVariant`.
 *
 * Les valeurs `null` et `undefined` sont équivalentes (champ absent).
 *
 * Pure : aucun side-effect, aucun accès I/O.
 */
export function validateInventoryRef(body: {
  equipmentId?: string | null | undefined;
  panelId?: string | null | undefined;
  adapterId?: string | null | undefined;
  accessoryType?: string | null | undefined;
  accessoryHeightU?: number | null | undefined;
  accessoryVariant?: string | null | undefined;
  accessoryDepthMm?: number | null | undefined;
}): InventoryRef {
  const candidates: InventoryRef[] = [];

  if (typeof body.equipmentId === "string" && body.equipmentId.length > 0) {
    candidates.push({ kind: "equipment", refId: body.equipmentId });
  }
  if (typeof body.panelId === "string" && body.panelId.length > 0) {
    candidates.push({ kind: "panel", refId: body.panelId });
  }
  if (typeof body.adapterId === "string" && body.adapterId.length > 0) {
    candidates.push({ kind: "adapter", refId: body.adapterId });
  }

  // Détection de la présence d'un accessoire : on considère qu'un champ est
  // "présent" s'il n'est ni null ni undefined. Une chaîne vide / valeur
  // invalide compte comme présente — elle déclenchera une erreur de
  // validation explicite plutôt que d'être ignorée silencieusement.
  const hasAccessoryType =
    body.accessoryType !== null && body.accessoryType !== undefined;
  const hasAccessoryHeightU =
    body.accessoryHeightU !== null && body.accessoryHeightU !== undefined;

  if (hasAccessoryType !== hasAccessoryHeightU) {
    throw new Error("Accessoire incomplet : type et hauteur U requis");
  }

  if (hasAccessoryType && hasAccessoryHeightU) {
    if (!isAccessoryType(body.accessoryType)) {
      throw new Error(
        "Type d'accessoire invalide : attendu plaque, etagere ou tiroir",
      );
    }
    if (!isAccessoryHeightU(body.accessoryHeightU)) {
      throw new Error("Hauteur U d'accessoire invalide : attendu 1, 2, 3 ou 4");
    }

    const accessoryType = body.accessoryType;
    const accessoryHeightU = body.accessoryHeightU;

    if (accessoryType === "plaque") {
      if (!isPlaqueVariant(body.accessoryVariant)) {
        throw new Error("Variant requis pour les plaques");
      }
      candidates.push({
        kind: "accessory",
        accessoryType,
        accessoryHeightU,
        accessoryVariant: body.accessoryVariant,
      });
    } else {
      // etagere / tiroir : variant ignoré ; depthMm requis et > 0 pour
      // dissocier les profondeurs distinctes au BOM.
      if (
        body.accessoryDepthMm === null ||
        body.accessoryDepthMm === undefined
      ) {
        throw new Error(
          "Profondeur requise pour les étagères et tiroirs",
        );
      }
      if (
        typeof body.accessoryDepthMm !== "number" ||
        !Number.isFinite(body.accessoryDepthMm) ||
        body.accessoryDepthMm <= 0
      ) {
        throw new Error("Profondeur invalide : valeur en mm > 0 attendue");
      }
      candidates.push({
        kind: "accessory",
        accessoryType,
        accessoryHeightU,
        accessoryDepthMm: body.accessoryDepthMm,
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error("Référence catalogue manquante");
  }

  if (candidates.length > 1) {
    throw new Error(
      "Plusieurs références catalogue fournies — exactement une attendue",
    );
  }

  return candidates[0]!;
}

/**
 * Slot d'un rack utilisé pour compter les placements vis-à-vis d'un BOM.
 *
 * Les champs `equipmentId` / `panelId` reflètent la table `RackSlot`. Les
 * champs accessoires sont optionnels : si l'appelant ne les fournit pas,
 * les `BomItem` accessoire ne seront jamais matchés par ce slot (count=0
 * pour cette ligne), ce qui revient à dire "le rack ne contient aucun
 * accessoire connu".
 */
export type SlotRefForCount = {
  equipmentId: string | null;
  panelId: string | null;
  adapterId?: string | null;
  accessoryType?: AccessoryType | null;
  accessoryHeightU?: AccessoryHeightU | null;
  accessoryVariant?: PlaqueVariant | null;
  /** Profondeur du slot accessoire — étagère/tiroir uniquement. */
  accessoryDepthMm?: number | null;
};

/**
 * Pour chaque `BomItem`, calcule la quantité restant à placer dans le rack :
 *   `remaining = max(0, quantity - count_des_slots_correspondants)`
 *
 * Le matching dépend du type de l'item :
 *   - `equipmentId` : slot.equipmentId === bom.equipmentId
 *   - `panelId` : slot.panelId === bom.panelId
 *   - `adapterId` : slot.adapterId === bom.adapterId (si présent)
 *   - accessoire : (accessoryType, accessoryHeightU) doivent correspondre,
 *     et pour une plaque, `accessoryVariant` doit aussi correspondre.
 *
 * Si un `BomItem` n'a aucun champ de référence valide (cas dégénéré), il
 * est retourné avec `remaining = quantity` (aucun match possible).
 *
 * Pure : aucun side-effect, aucun accès I/O.
 */
export function computeBomRemaining(
  bomItems: BomItem[],
  placedSlots: SlotRefForCount[],
): Array<BomItem & { remaining: number }> {
  return bomItems.map((item) => {
    let count = 0;

    if (item.equipmentId !== undefined) {
      for (const slot of placedSlots) {
        if (slot.equipmentId === item.equipmentId) count += 1;
      }
    } else if (item.panelId !== undefined) {
      for (const slot of placedSlots) {
        if (slot.panelId === item.panelId) count += 1;
      }
    } else if (item.adapterId !== undefined) {
      for (const slot of placedSlots) {
        if (slot.adapterId === item.adapterId) count += 1;
      }
    } else if (
      item.accessoryType !== undefined &&
      item.accessoryHeightU !== undefined
    ) {
      const isPlaque = item.accessoryType === "plaque";
      for (const slot of placedSlots) {
        if (slot.accessoryType !== item.accessoryType) continue;
        if (slot.accessoryHeightU !== item.accessoryHeightU) continue;
        if (isPlaque) {
          if (slot.accessoryVariant !== item.accessoryVariant) continue;
        } else {
          // etagere / tiroir : la profondeur dissocie les BOM lines.
          // Un slot sans profondeur enregistrée (legacy) ne match aucun
          // item explicitement profondeur-typé.
          const slotDepth = slot.accessoryDepthMm ?? null;
          const itemDepth = item.accessoryDepthMm ?? null;
          if (slotDepth !== itemDepth) continue;
        }
        count += 1;
      }
    }

    const remaining = Math.max(0, item.quantity - count);
    return { ...item, remaining };
  });
}
