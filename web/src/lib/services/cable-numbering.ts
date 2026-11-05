/**
 * Cable numbering — logique pure de numérotation des câbles broadcast.
 *
 * Ce module est 100% TypeScript pur : aucune dépendance à Prisma, React,
 * Next.js ou `@/lib/db`. Les fonctions sont déterministes et sans effet
 * de bord. Elles reçoivent l'état nécessaire en paramètre et retournent
 * un résultat typé — aucun accès I/O n'est effectué ici.
 *
 * Convention (source : `PRODUCT.md` — section « Numérotation des câbles ») :
 *
 *   {zone}-{rack}-{type}{seq}
 *
 *   - zone : code court d'une zone du rig (ex. `REG`, `STUA`, `PLT`, `LOC`)
 *   - rack : identifiant du rack dans la zone (ex. `A1`, `RGA`, `B12`)
 *   - type : code du type de signal (ex. `S`, `SDI`, `AUD`, `ETH`, `PWR`)
 *   - seq  : séquence entière zero-padded (3 digits par défaut)
 *
 *   Exemples valides :
 *     `STUA-RGA-S001`    (forme courte, 1 lettre de type — PRODUCT.md)
 *     `REG-A1-SDI012`    (forme longue, 3 lettres de type)
 *     `PLT-B2-ETH004`
 *     `LOC-C3-PWR042`
 *
 * ─── Préfixes de signal connus ────────────────────────────────────────────
 *
 *   Forme courte (PRODUCT.md) :
 *     S = SDI · A = Audio · D = Data/Réseau · E = Alimentation · C = Contrôle/GPIO
 *
 *   Forme longue (usage courant dans le cahier des charges) :
 *     SDI, AUD, ETH, AES, MADI, PWR, CTRL, GPIO, TALLY, REF, TC, FBR, HDMI…
 *
 *   Les deux formes sont acceptées. `CableType` est volontairement laissé
 *   ouvert (`string`) pour autoriser une convention par projet / client.
 *   Un garde-fou régex (1 à 5 lettres majuscules) empêche toutefois les
 *   valeurs totalement libres.
 *
 * ─── Décisions prises face aux zones floues de PRODUCT.md ────────────────
 *
 *   @decision zone-rack-format
 *     PRODUCT.md ne fige pas les caractères autorisés. Choix retenu :
 *       - `zone` : 2 à 5 caractères alphanumériques majuscules (ex. `REG`,
 *         `STUA`, `PLT1`). Lettres + chiffres, pas de tiret ni d'espace.
 *       - `rack` : 1 à 5 caractères alphanumériques majuscules (ex. `A1`,
 *         `RGA`, `B12`). Même jeu de caractères.
 *     Raison : le tiret `-` est le séparateur du format, il est exclu de
 *     zone et rack. Limite haute volontairement lâche pour accommoder des
 *     conventions clients (`STUA`, `BACKUP`, etc.) tout en restant parsable.
 *
 *   @decision type-format
 *     Le code de type est 1 à 5 lettres majuscules. Couvre `S`, `SDI`,
 *     `TALLY` (5 lettres) sans laisser passer des identifiants arbitraires.
 *
 *   @decision seq-width
 *     Largeur par défaut : 3 digits (aligne sur `S001`, `SDI012`). La
 *     fonction `formatCableNumber` accepte une option `seqWidth` pour
 *     absorber d'éventuels besoins futurs (4 digits pour > 999 câbles).
 *     Le parseur accepte toute largeur ≥ 1 tant que la séquence est
 *     purement numérique.
 *
 *   @decision nextCableNumber-strategy
 *     **Stratégie par défaut : strict increment (max+1).** On ne ré-utilise
 *     pas les trous laissés par des câbles supprimés. Raison :
 *       1. Traçabilité : un numéro de câble est imprimé sur une étiquette
 *          physique, le recycler créerait de l'ambiguïté en recette / PV.
 *       2. Concurrence : plus simple à raisonner côté `Rack.cableNextNum`.
 *     Les numéros mal formés dans `existingNumbers` sont ignorés sans
 *     erreur (tolérance à la saisie libre historique). Si aucun numéro
 *     existant ne correspond au contexte (zone/rack/type), on repart de 1.
 *     Une option `fillGaps: true` reste exposée pour les consommateurs
 *     qui préféreraient le plus petit entier libre (utile lors d'imports
 *     ou de renumérotation).
 *
 *   @decision rack-cableId-field
 *     Le schéma Prisma expose `Rack.cableId` (0–9) et `Rack.cableNextNum`.
 *     Ce module ne touche pas à la DB mais fournit `nextCableNumber` qui
 *     peut être alimenté en lisant `cableNextNum` et en listant les
 *     étiquettes existantes — l'intégration reste à la charge de
 *     l'agent-db-api. `cableId` (1 chiffre) est indépendant du format
 *     `{zone}-{rack}-{type}{seq}` décrit ici et n'intervient pas dans
 *     la génération du numéro canonique. Voir le rapport pour détails.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Code du type de signal. Laissé ouvert (`string`) pour autoriser les
 * conventions par projet. Validé à l'exécution par `TYPE_REGEX` ci-dessous.
 *
 * Valeurs courantes (non exhaustives) :
 *   - Forme courte (PRODUCT.md) : `"S" | "A" | "D" | "E" | "C"`
 *   - Forme longue : `"SDI" | "AUD" | "ETH" | "AES" | "MADI" | "PWR" | "CTRL" | "GPIO" | "TALLY" | "REF" | "TC" | "HDMI"`
 */
export type CableType = string;

/**
 * Composants bruts d'un numéro de câble, avant formatage.
 * `seq` est l'entier naturel (≥ 1), non zero-padded.
 */
export type CableNumberParts = {
  zone: string;
  rack: string;
  type: CableType;
  seq: number;
};

/**
 * Résultat d'un parsing réussi. Inclut à la fois la séquence numérique
 * et sa représentation textuelle originale (préserve le padding).
 */
export type ParsedCableNumber = {
  zone: string;
  rack: string;
  type: CableType;
  /** Entier naturel, ≥ 1. */
  seq: number;
  /** Représentation textuelle du `seq` telle que trouvée dans l'entrée (ex. `"012"`). */
  seqText: string;
  /** Nombre de digits de la séquence dans l'entrée (pour re-formater à l'identique). */
  seqWidth: number;
};

/** Options optionnelles du formateur. */
export type FormatCableNumberOptions = {
  /** Largeur de zero-padding pour la séquence. Défaut : 3. */
  seqWidth?: number;
};

/** Contexte pour `nextCableNumber`. */
export type NextCableNumberContext = {
  zone: string;
  rack: string;
  type: CableType;
  /**
   * Liste des numéros de câbles déjà attribués, toutes combinaisons confondues.
   * La fonction filtre en interne ceux qui correspondent au triplet
   * `(zone, rack, type)`. Les entrées non parsables sont ignorées.
   */
  existingNumbers: readonly string[];
  /**
   * Largeur de zero-padding à utiliser pour le résultat. Défaut : 3.
   */
  seqWidth?: number;
  /**
   * Si `true`, retourne le plus petit entier ≥ 1 libre (comble les trous).
   * Si `false` (défaut), retourne `max(seq) + 1`.
   */
  fillGaps?: boolean;
};

/** Résultat de `validateCableNumber`. */
export type CableNumberValidation = { ok: true } | { ok: false; reason: string };

// ─────────────────────────────────────────────────────────────────────────────
// Constantes / regex
// ─────────────────────────────────────────────────────────────────────────────

/** Zone : 2 à 5 caractères alphanumériques majuscules. */
const ZONE_REGEX = /^[A-Z0-9]{2,5}$/;

/** Rack : 1 à 5 caractères alphanumériques majuscules. */
const RACK_REGEX = /^[A-Z0-9]{1,5}$/;

/** Type de signal : 1 à 5 lettres majuscules. */
const TYPE_REGEX = /^[A-Z]{1,5}$/;

/** Séquence : 1 digit minimum (pas de limite haute stricte). */
const SEQ_REGEX = /^\d+$/;

/**
 * Regex de parsing globale. Les groupes nommés sont :
 *   - `zone` : [A-Z0-9]{2,5}
 *   - `rack` : [A-Z0-9]{1,5}
 *   - `type` : [A-Z]{1,5}
 *   - `seq`  : \d+
 *
 * Note : la distinction type vs rack repose sur le fait que `type` est
 * purement alphabétique alors que `rack` peut contenir des chiffres.
 * En pratique le dernier segment est scindé en deux par `TYPE_SEQ_REGEX`.
 */
const FULL_REGEX = /^([A-Z0-9]{2,5})-([A-Z0-9]{1,5})-([A-Z]{1,5})(\d+)$/;

/** Largeur de padding par défaut. */
const DEFAULT_SEQ_WIDTH = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers purs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zero-pad un entier positif à `width` digits. Si `value` a déjà plus de
 * `width` digits, la représentation complète est retournée sans troncature.
 */
function padSeq(value: number, width: number): string {
  const s = String(value);
  if (s.length >= width) return s;
  return "0".repeat(width - s.length) + s;
}

/**
 * Retourne `true` si deux contextes (zone, rack, type) sont strictement
 * égaux (comparaison casse-sensible, aligne sur le format canonique).
 */
function sameContext(
  a: { zone: string; rack: string; type: string },
  b: { zone: string; rack: string; type: string },
): boolean {
  return a.zone === b.zone && a.rack === b.rack && a.type === b.type;
}

// ─────────────────────────────────────────────────────────────────────────────
// API principale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formate un numéro de câble canonique à partir de ses composants.
 *
 * - `zone`, `rack`, `type` sont normalisés en majuscules et validés.
 * - `seq` doit être un entier ≥ 1.
 * - Le résultat est zero-padded à `options.seqWidth` (défaut : 3).
 *
 * En cas de composant invalide, la fonction **renvoie une chaîne vide**
 * plutôt que de lever une exception. Pour une validation stricte côté
 * appelant, utiliser `validateCableNumber` sur le résultat, ou construire
 * d'abord via `nextCableNumber`.
 *
 * @example
 *   formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 12 })
 *   // → "REG-A1-SDI012"
 */
export function formatCableNumber(
  parts: CableNumberParts,
  options: FormatCableNumberOptions = {},
): string {
  const zone = parts.zone.toUpperCase();
  const rack = parts.rack.toUpperCase();
  const type = parts.type.toUpperCase();
  const seqWidth = options.seqWidth ?? DEFAULT_SEQ_WIDTH;

  if (!ZONE_REGEX.test(zone)) return "";
  if (!RACK_REGEX.test(rack)) return "";
  if (!TYPE_REGEX.test(type)) return "";
  if (!Number.isInteger(parts.seq) || parts.seq < 1) return "";
  if (!Number.isInteger(seqWidth) || seqWidth < 1) return "";

  return `${zone}-${rack}-${type}${padSeq(parts.seq, seqWidth)}`;
}

/**
 * Parse un numéro de câble au format canonique `{zone}-{rack}-{type}{seq}`.
 *
 * Retourne `null` si la chaîne n'est pas conforme. La comparaison est
 * **strictement casse-sensible** : seuls les caractères majuscules sont
 * acceptés. Pour une entrée utilisateur potentiellement en minuscules,
 * normaliser côté appelant avec `.toUpperCase()` avant d'appeler cette
 * fonction.
 *
 * Note : `parseCableNumber` est volontairement plus **permissif** que
 * `validateCableNumber`. Il accepte `seq >= 0` (donc `SDI000` est parsé
 * avec `seq = 0`) afin de pouvoir relire des données historiques. Pour
 * rejeter strictement les séquences < 1, utiliser `validateCableNumber`
 * côté formulaire avant la persistance.
 *
 * @example
 *   parseCableNumber("REG-A1-SDI012")
 *   // → { zone: "REG", rack: "A1", type: "SDI", seq: 12, seqText: "012", seqWidth: 3 }
 *
 *   parseCableNumber("reg-a1-sdi012") // minuscules
 *   // → null
 *
 *   parseCableNumber("STUA-RGA-S001")
 *   // → { zone: "STUA", rack: "RGA", type: "S", seq: 1, seqText: "001", seqWidth: 3 }
 */
export function parseCableNumber(input: string): ParsedCableNumber | null {
  if (typeof input !== "string") return null;
  const match = FULL_REGEX.exec(input);
  if (!match) return null;

  const [, zone, rack, type, seqText] = match;
  if (!zone || !rack || !type || !seqText) return null;

  // Parse sécurisé : SEQ_REGEX garantit \d+, donc parseInt est fiable.
  const seq = Number.parseInt(seqText, 10);
  if (!Number.isFinite(seq) || seq < 0) return null;

  return {
    zone,
    rack,
    type,
    seq,
    seqText,
    seqWidth: seqText.length,
  };
}

/**
 * Valide strictement une chaîne au format `{zone}-{rack}-{type}{seq}` et
 * retourne un message d'erreur en français si la chaîne n'est pas conforme.
 *
 * Les messages sont pensés pour être affichés tels quels à l'utilisateur
 * (UI, toast, inline form error). Ils ne contiennent pas de codes techniques.
 *
 * @example
 *   validateCableNumber("REG-A1-SDI012") // → { ok: true }
 *   validateCableNumber("reg-a1-sdi012") // → { ok: false, reason: "... majuscules ..." }
 *   validateCableNumber("REG-A1-SDI000") // → { ok: false, reason: "... séquence doit être ≥ 1 ..." }
 *   validateCableNumber("REG--SDI012")   // → { ok: false, reason: "... rack invalide ..." }
 */
export function validateCableNumber(input: string): CableNumberValidation {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "Le numéro de câble est vide." };
  }

  if (input !== input.trim()) {
    return {
      ok: false,
      reason: "Le numéro de câble ne doit pas contenir d'espaces en début ou en fin.",
    };
  }

  if (input !== input.toUpperCase()) {
    return {
      ok: false,
      reason: "Le numéro de câble doit être en majuscules (ex. REG-A1-SDI012).",
    };
  }

  // Segments grossiers : doit contenir exactement 2 tirets.
  const segments = input.split("-");
  if (segments.length !== 3) {
    return {
      ok: false,
      reason: "Le format attendu est zone-rack-type+séquence, par exemple REG-A1-SDI012.",
    };
  }

  const [zone, rack, typeSeq] = segments;

  if (!ZONE_REGEX.test(zone)) {
    return {
      ok: false,
      reason: `Zone invalide ("${zone}") : 2 à 5 caractères alphanumériques majuscules attendus (ex. REG, STUA).`,
    };
  }

  if (!RACK_REGEX.test(rack)) {
    return {
      ok: false,
      reason: `Identifiant de rack invalide ("${rack}") : 1 à 5 caractères alphanumériques majuscules attendus (ex. A1, RGA).`,
    };
  }

  // Dernier segment : doit commencer par 1 à 5 lettres puis au moins 1 digit.
  const typeSeqMatch = /^([A-Z]{1,5})(\d+)$/.exec(typeSeq);
  if (!typeSeqMatch) {
    return {
      ok: false,
      reason: `Type et séquence invalides ("${typeSeq}") : un code lettres suivi d'un numéro est attendu (ex. SDI012, S001).`,
    };
  }

  const [, type, seqText] = typeSeqMatch;
  if (!TYPE_REGEX.test(type)) {
    return {
      ok: false,
      reason: `Type de signal invalide ("${type}") : 1 à 5 lettres majuscules attendues.`,
    };
  }

  if (!SEQ_REGEX.test(seqText)) {
    return {
      ok: false,
      reason: `Séquence invalide ("${seqText}") : uniquement des chiffres attendus.`,
    };
  }

  const seq = Number.parseInt(seqText, 10);
  if (!Number.isFinite(seq) || seq < 1) {
    return {
      ok: false,
      reason: `Séquence invalide ("${seqText}") : la séquence doit être ≥ 1.`,
    };
  }

  return { ok: true };
}

/**
 * Retourne le prochain numéro de câble libre pour un contexte donné
 * `(zone, rack, type)`, en analysant les numéros déjà attribués.
 *
 * Stratégie par défaut : **strict increment**. On prend `max(seq) + 1`
 * parmi les numéros existants qui correspondent au triplet. Les trous
 * laissés par d'éventuelles suppressions ne sont **pas** ré-utilisés
 * (voir `@decision nextCableNumber-strategy` en tête de fichier).
 *
 * Avec `context.fillGaps = true`, la fonction retourne le plus petit
 * entier ≥ 1 qui n'est pas déjà pris — utile pour un import massif ou
 * une renumérotation propre.
 *
 * Les entrées non parsables de `existingNumbers` sont ignorées
 * silencieusement (tolérance à la saisie libre historique).
 *
 * @throws Ne lève jamais. Retourne directement une chaîne formatée.
 *         Si le contexte fourni est invalide (zone / rack / type malformés),
 *         la chaîne retournée sera celle de `formatCableNumber` (possiblement
 *         vide) — il appartient à l'appelant de valider le contexte avant
 *         si nécessaire.
 *
 * @example
 *   nextCableNumber({
 *     zone: "REG",
 *     rack: "A1",
 *     type: "SDI",
 *     existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003", "REG-A1-AUD001"],
 *   })
 *   // → "REG-A1-SDI004"   (strict increment : 3 + 1)
 *
 *   nextCableNumber({
 *     zone: "REG",
 *     rack: "A1",
 *     type: "SDI",
 *     existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003"],
 *     fillGaps: true,
 *   })
 *   // → "REG-A1-SDI002"   (comble le trou)
 */
export function nextCableNumber(context: NextCableNumberContext): string {
  const zone = context.zone.toUpperCase();
  const rack = context.rack.toUpperCase();
  const type = context.type.toUpperCase();
  const seqWidth = context.seqWidth ?? DEFAULT_SEQ_WIDTH;
  const fillGaps = context.fillGaps ?? false;

  // Extrait les séquences déjà utilisées pour ce triplet.
  const usedSeqs = new Set<number>();
  for (const raw of context.existingNumbers) {
    const parsed = parseCableNumber(raw);
    if (!parsed) continue;
    if (!sameContext(parsed, { zone, rack, type })) continue;
    if (parsed.seq >= 1) usedSeqs.add(parsed.seq);
  }

  let nextSeq: number;

  if (fillGaps) {
    // Plus petit entier ≥ 1 libre.
    nextSeq = 1;
    while (usedSeqs.has(nextSeq)) {
      nextSeq += 1;
    }
  } else {
    // max(seq) + 1, ou 1 si aucun existant.
    let max = 0;
    for (const s of usedSeqs) {
      if (s > max) max = s;
    }
    nextSeq = max + 1;
  }

  return formatCableNumber({ zone, rack, type, seq: nextSeq }, { seqWidth });
}

// ─────────────────────────────────────────────────────────────────────────────
// computeCableLabel — runtime aligné sur les toggles AppConfig
// ─────────────────────────────────────────────────────────────────────────────
//
// Format produit : `{zone}-{rack}-{prefix}{sep}{dirDigit}{paddedSeq}{suffixSep}{suffix}`
//
// - Les segments zone/rack sont toujours joints par `-` (séparateur fixe).
// - `separator` (admin `cable_separator`) insère entre prefix et dirDigit+seq.
// - Si `signalPrefix` vide : `paddedSeq` seul (pad complet, pas de dirDigit).
// - Si `signalSuffix` vide : suffix omis (pas de suffixSeparator non plus).
//
// Exemples :
//   { zone:"ALPH", rack:"RGA", prefix:"S", dirDigit:"1", seq:1, pad:5, sep:"" } → "ALPH-RGA-S10001"
//   { zone:null, rack:"RGA", …, includeZone:false } → "RGA-S10001"
//   { zone:"ALPH", rack:"RGA", prefix:"S", …, separator:"-" } → "ALPH-RGA-S-10001"

export type CableDirDigit = "1" | "2" | "3"; // IN=1, OUT=2, BIDI=3

export type CableNumberingConfig = {
  /** Largeur du bloc numérique (dirDigit inclus). Ex. pad=5 → "10001". Clampé 3-10. */
  pad: number;
  /** Séparateur 1 : entre rack et prefix. Choix : "-" "." "_" "/" "*" "". */
  sep1: string;
  /** Séparateur 2 : entre seq et suffix. Choix : "-" "." "_" "/" "*" "". */
  sep2: string;
  /** Toggle : inclure le nom de la baie en tête. */
  includeRack: boolean;
  /**
   * Template personnalisé (drag & drop). Si `templateEnabled` est true et
   * `template` non-vide, il remplace la convention globale.
   * Placeholders : {rack} {sep1} {prefix} {dir} {seq} {sep2} {suffix}
   * + texte libre entre les blocs.
   */
  template?: string;
  templateEnabled?: boolean;

  // ── Compat aliases (anciens champs, lus par le code legacy) ────────────
  /** @deprecated — utiliser sep1. */
  separator?: string;
  /** @deprecated — utiliser sep2. */
  suffixSeparator?: string;
  /** @deprecated — toujours false, zone retirée. */
  includeZone?: boolean;
};

export type CableLabelInput = {
  /** Code zone (ex. "ALPH"). null = hors zone ou non applicable. */
  zoneCode: string | null;
  /** Code rack (ex. "RGA"). null = non défini. */
  rackCode: string | null;
  /** Prefix du SignalType. Chaîne vide acceptée (signal sans prefix). */
  signalPrefix: string;
  /** Suffix du SignalType. Chaîne vide acceptée. */
  signalSuffix: string;
  /** Direction : IN=1, OUT=2, BIDI=3. */
  dirDigit: CableDirDigit;
  /** Séquence ≥ 1. */
  seq: number;
  config: CableNumberingConfig;
};

/**
 * Compose un label de câble aligné sur la convention
 * `{zone}-{rack}-{prefix}{sep}{dirDigit}{paddedSeq}{suffixSep}{suffix}`.
 *
 * Les segments zone/rack sont inclus uniquement si leur code est non-null ET
 * le toggle correspondant (`config.includeZone` / `config.includeRack`) est
 * `true`. Sinon ils sont silencieusement omis.
 *
 * Hypothèses :
 *   - `zoneCode` et `rackCode` sont déjà normalisés en amont (uppercase,
 *     ≤4 caractères pour zone, ≤5 pour rack) — cette fonction ne valide pas.
 *   - `seq` est un entier naturel ≥ 1 ; `Math.max(1, Math.trunc(seq))` appliqué
 *     en interne pour tolérer les flottants / valeurs < 1.
 *   - `pad` est clampé à `[1, 10]` pour éviter les dérives.
 */
export function computeCableLabel(input: CableLabelInput): string {
  const { rackCode, signalPrefix, signalSuffix, dirDigit, seq, config } = input;
  const { pad, includeRack } = config;
  // Résolution des séparateurs (compat anciens champs).
  const s1 = config.sep1 ?? config.separator ?? "";
  const s2 = config.sep2 ?? config.suffixSeparator ?? "";

  const safePad = Math.max(3, Math.min(10, Math.trunc(pad)));
  const safeSeq = Math.max(1, Math.trunc(seq));
  const numBlock = `${dirDigit}${String(safeSeq).padStart(Math.max(1, safePad - 1), "0")}`;

  // ── Template personnalisé (drag & drop) ─────────────────────────────────
  if (config.templateEnabled && config.template && config.template.trim().length > 0) {
    const paddedSeqOnly = String(safeSeq).padStart(safePad, "0");
    const vars: Record<string, string> = {
      rack: includeRack && rackCode ? rackCode : "",
      sep1: s1,
      prefix: signalPrefix || "",
      dir: dirDigit,
      seq: paddedSeqOnly,
      sep2: s2,
      suffix: signalSuffix || "",
      // Compat legacy
      zone: "",
    };
    return config.template.replace(
      /\{(rack|sep1|prefix|dir|seq|sep2|suffix|zone)\}/g,
      (_, k) => vars[k] ?? "",
    );
  }

  // ── Convention globale fixe ──────────────────────────────────────────────
  // [rack][sep1][prefix][dirDigit+seq][sep2][suffix]
  let label = "";
  if (includeRack && rackCode) label += rackCode + s1;
  if (signalPrefix) label += signalPrefix;
  label += numBlock;
  if (signalSuffix) label += s2 + signalSuffix;
  return label;
}
