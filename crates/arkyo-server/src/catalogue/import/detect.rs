//! Column detection of an imported spreadsheet → equipment target fields
//! (arkyo:lib/services/import/detect-columns.ts). Pure and deterministic.
//!
//! Each header is scored against each target field from a FR/EN synonym
//! dictionary (exact normalized match, whole-word inclusion, raw inclusion,
//! Levenshtein fallback) plus a bonus/malus from a sample of the column's
//! values; fields are then assigned greedily by decreasing score so a field
//! is never suggested twice.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::{js_trim, round4, strip_accents_lower};

/// `TargetField`, in `ALL_TARGET_FIELDS` order (the order of the
/// tie-breaks and of the export columns).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetField {
    Name,
    Reference,
    Brand,
    Category,
    Type,
    HeightU,
    WidthFraction,
    DepthMm,
    DimLmm,
    DimWmm,
    DimHmm,
    Weight,
    PowerW,
    HeatBtuH,
    HasDualPsu,
    Is2110,
    IsLightingFixture,
    DmxChannelsDefault,
    Notes,
    Tags,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldKind {
    Text,
    Number,
    Int,
    Bool,
    Enum,
}

use TargetField as F;

pub const ALL_TARGET_FIELDS: [TargetField; 20] = [
    F::Name,
    F::Reference,
    F::Brand,
    F::Category,
    F::Type,
    F::HeightU,
    F::WidthFraction,
    F::DepthMm,
    F::DimLmm,
    F::DimWmm,
    F::DimHmm,
    F::Weight,
    F::PowerW,
    F::HeatBtuH,
    F::HasDualPsu,
    F::Is2110,
    F::IsLightingFixture,
    F::DmxChannelsDefault,
    F::Notes,
    F::Tags,
];

impl TargetField {
    /// The JSON name (`heightU`).
    pub fn as_str(self) -> &'static str {
        match self {
            F::Name => "name",
            F::Reference => "reference",
            F::Brand => "brand",
            F::Category => "category",
            F::Type => "type",
            F::HeightU => "heightU",
            F::WidthFraction => "widthFraction",
            F::DepthMm => "depthMm",
            F::DimLmm => "dimLmm",
            F::DimWmm => "dimWmm",
            F::DimHmm => "dimHmm",
            F::Weight => "weight",
            F::PowerW => "powerW",
            F::HeatBtuH => "heatBtuH",
            F::HasDualPsu => "hasDualPsu",
            F::Is2110 => "is2110",
            F::IsLightingFixture => "isLightingFixture",
            F::DmxChannelsDefault => "dmxChannelsDefault",
            F::Notes => "notes",
            F::Tags => "tags",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        ALL_TARGET_FIELDS.into_iter().find(|f| f.as_str() == s)
    }

    /// `FIELD_KIND`.
    pub fn kind(self) -> FieldKind {
        match self {
            F::Name | F::Reference | F::Brand | F::Category | F::Type | F::Notes | F::Tags => {
                FieldKind::Text
            }
            F::HeightU | F::DmxChannelsDefault => FieldKind::Int,
            F::WidthFraction => FieldKind::Enum,
            F::DepthMm
            | F::DimLmm
            | F::DimWmm
            | F::DimHmm
            | F::Weight
            | F::PowerW
            | F::HeatBtuH => FieldKind::Number,
            F::HasDualPsu | F::Is2110 | F::IsLightingFixture => FieldKind::Bool,
        }
    }

    /// `FIELD_SYNONYMS` (FR/EN, compared after [`normalize_token`]).
    pub fn synonyms(self) -> &'static [&'static str] {
        match self {
            F::Name => &[
                "name",
                "nom",
                "designation",
                "designation produit",
                "libelle",
                "intitule",
                "appellation",
                "produit",
                "materiel",
                "equipement",
                "equipment",
                "item",
                "article",
                "titre",
            ],
            F::Reference => &[
                "reference",
                "ref",
                "refs",
                "modele",
                "model",
                "model number",
                "part number",
                "part no",
                "pn",
                "sku",
                "code",
                "code article",
                "code produit",
                "mpn",
                "type ref",
            ],
            F::Brand => &[
                "brand",
                "marque",
                "fabricant",
                "fabriquant",
                "manufacturer",
                "constructeur",
                "maker",
                "vendor",
                "fournisseur",
                "make",
            ],
            F::Category => &[
                "category",
                "categorie",
                "categories",
                "classification",
                "famille",
                "family",
                "groupe",
                "group",
                "rubrique",
                "class",
                "classe",
                "segment",
            ],
            F::Type => &[
                "type",
                "sous type",
                "subtype",
                "kind",
                "genre",
                "nature",
                "sorte",
            ],
            F::HeightU => &[
                "u",
                "hu",
                "height u",
                "hauteur u",
                "rack u",
                "ru",
                "unites",
                "unite",
                "units",
                "unit",
                "nb u",
                "nombre u",
                "taille u",
                "hauteur rack",
                "rack height",
            ],
            F::WidthFraction => &[
                "width fraction",
                "largeur fraction",
                "fraction largeur",
                "fraction",
                "largeur rack",
                "rack width",
                "width",
                "largeur",
                "occupation largeur",
                "format largeur",
            ],
            F::DepthMm => &[
                "depth",
                "profondeur",
                "prof",
                "depth mm",
                "profondeur mm",
                "prof mm",
                "profondeur (mm)",
                "d mm",
                "depth (mm)",
            ],
            F::DimLmm => &[
                "longueur",
                "length",
                "long",
                "l mm",
                "longueur mm",
                "length mm",
                "longueur (mm)",
                "dim l",
                "dimension l",
            ],
            F::DimWmm => &[
                "largeur mm",
                "width mm",
                "l mm largeur",
                "largeur (mm)",
                "dim w",
                "dim l largeur",
                "dimension largeur",
                "width (mm)",
                "larg mm",
            ],
            F::DimHmm => &[
                "hauteur",
                "height",
                "haut",
                "h mm",
                "hauteur mm",
                "height mm",
                "hauteur (mm)",
                "dim h",
                "dimension h",
            ],
            F::Weight => &[
                "weight",
                "poids",
                "masse",
                "mass",
                "poids kg",
                "weight kg",
                "poids (kg)",
                "kg",
                "poids net",
                "net weight",
            ],
            F::PowerW => &[
                "power",
                "puissance",
                "conso",
                "consommation",
                "watts",
                "watt",
                "w",
                "power w",
                "puissance w",
                "puissance (w)",
                "conso w",
                "power consumption",
                "consommation electrique",
            ],
            F::HeatBtuH => &[
                "heat",
                "chaleur",
                "btu",
                "btu h",
                "btuh",
                "btu hr",
                "dissipation",
                "dissipation thermique",
                "heat dissipation",
                "degagement thermique",
            ],
            F::HasDualPsu => &[
                "dual psu",
                "double alimentation",
                "double alim",
                "redundant psu",
                "redundant power",
                "alimentation redondante",
                "alim redondante",
                "psu redondant",
                "double psu",
                "redondance alim",
                "dual power",
            ],
            F::Is2110 => &[
                "2110",
                "st 2110",
                "smpte 2110",
                "st2110",
                "is 2110",
                "ip 2110",
                "compatible 2110",
                "2110 compatible",
            ],
            F::IsLightingFixture => &[
                "lighting",
                "eclairage",
                "projecteur",
                "lumiere",
                "fixture",
                "luminaire",
                "spot",
                "lighting fixture",
                "appareil eclairage",
                "is lighting",
            ],
            F::DmxChannelsDefault => &[
                "dmx",
                "dmx channels",
                "canaux dmx",
                "channels dmx",
                "nb canaux dmx",
                "dmx channel",
                "canaux",
                "dmx footprint",
                "empreinte dmx",
            ],
            F::Notes => &[
                "notes",
                "note",
                "commentaire",
                "commentaires",
                "comment",
                "comments",
                "remarque",
                "remarques",
                "observation",
                "observations",
                "description",
                "desc",
            ],
            F::Tags => &[
                "tags",
                "tag",
                "etiquettes",
                "etiquette",
                "mots cles",
                "keywords",
                "labels",
                "label",
            ],
        }
    }
}

// ── normalization ───────────────────────────────────────────────────────────

/// `normalizeToken`: accents and case removed, every run of characters
/// outside `[a-z0-9]` becomes one space, trimmed.
pub fn normalize_token(input: &str) -> String {
    let lower = strip_accents_lower(input);
    let mut out = String::with_capacity(lower.len());
    let mut gap = false;
    for c in lower.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if gap && !out.is_empty() {
                out.push(' ');
            }
            gap = false;
            out.push(c);
        } else {
            gap = true;
        }
    }
    out
}

// ── Levenshtein ─────────────────────────────────────────────────────────────

/// Edit distance over UTF-16 code units, like the JavaScript original.
pub fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<u16> = a.encode_utf16().collect();
    let b: Vec<u16> = b.encode_utf16().collect();
    if a == b {
        return 0;
    }
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut curr = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        curr[0] = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            curr[j] = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b.len()]
}

/// Similarity in [0, 1] from Levenshtein (1 = identical).
pub fn similarity(a: &str, b: &str) -> f64 {
    let (la, lb) = (a.encode_utf16().count(), b.encode_utf16().count());
    if la == 0 && lb == 0 {
        return 1.0;
    }
    let max = la.max(lb);
    1.0 - levenshtein(a, b) as f64 / max as f64
}

// ── value sample ────────────────────────────────────────────────────────────

pub(super) const BOOL_TRUE: [&str; 9] = ["oui", "yes", "y", "true", "vrai", "1", "x", "o", "on"];
const BOOL_FALSE_DETECT: [&str; 8] = ["non", "no", "n", "false", "faux", "0", "off", ""];

const WIDTH_FRACTION_TOKENS: [&str; 15] = [
    "full", "half", "third", "quarter", "1", "1 1", "1 2", "1 3", "1 4", "plein", "pleine",
    "entier", "demi", "tiers", "quart",
];

/// `^-?\d+(\.\d+)?$` (ASCII digits, like JavaScript's `\d`).
pub(super) fn is_decimal(t: &str) -> bool {
    let t = t.strip_prefix('-').unwrap_or(t);
    let (int, frac) = match t.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (t, None),
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    digits(int) && frac.is_none_or(digits)
}

/// `isNumericLike`: first `,` → `.`, whitespace removed.
fn is_numeric_like(v: &str) -> bool {
    let t: String = js_trim(v)
        .replacen(',', ".", 1)
        .chars()
        .filter(|c| !super::is_js_space(*c))
        .collect();
    !t.is_empty() && is_decimal(&t)
}

/// `isRackUnitLike`: `^\s*\d{1,2}\s*u\s*$`, case-insensitive ("2U", "12 u").
fn is_rack_unit_like(v: &str) -> bool {
    let t = js_trim(v);
    let Some(body) = t.strip_suffix(['u', 'U']) else {
        return false;
    };
    let digits = body.trim_end_matches(super::is_js_space);
    (1..=2).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit())
}

#[derive(Default)]
struct ValueProfile {
    ratio_numeric: f64,
    ratio_bool: f64,
    ratio_rack_unit: f64,
    ratio_width_fraction: f64,
    distinct_ratio: f64,
}

fn profile_values(values: &[&str]) -> ValueProfile {
    let sample: Vec<&str> = values
        .iter()
        .map(|v| js_trim(v))
        .filter(|v| !v.is_empty())
        .take(100)
        .collect();
    if sample.is_empty() {
        return ValueProfile::default();
    }
    let (mut numeric, mut boolean, mut rack, mut width) = (0, 0, 0, 0);
    let mut distinct: HashSet<String> = HashSet::new();
    for v in &sample {
        if is_numeric_like(v) {
            numeric += 1;
        }
        let nv = normalize_token(v);
        if BOOL_TRUE.contains(&nv.as_str()) || BOOL_FALSE_DETECT.contains(&nv.as_str()) {
            boolean += 1;
        }
        if is_rack_unit_like(v) {
            rack += 1;
        }
        if WIDTH_FRACTION_TOKENS.contains(&nv.as_str()) {
            width += 1;
        }
        distinct.insert(nv);
    }
    let n = sample.len() as f64;
    ValueProfile {
        ratio_numeric: numeric as f64 / n,
        ratio_bool: boolean as f64 / n,
        ratio_rack_unit: rack as f64 / n,
        ratio_width_fraction: width as f64 / n,
        distinct_ratio: distinct.len() as f64 / n,
    }
}

// ── scoring ─────────────────────────────────────────────────────────────────

const HEADER_WEIGHT: f64 = 0.75;
const VALUE_WEIGHT: f64 = 0.25;

/// Whole-word inclusion of `needle` in `haystack`.
fn contains_as_word(haystack: &str, needle: &str) -> bool {
    !needle.is_empty() && format!(" {haystack} ").contains(&format!(" {needle} "))
}

fn score_header(header_norm: &str, field: TargetField) -> f64 {
    let mut best: f64 = 0.0;
    for syn in field.synonyms() {
        let syn_norm = normalize_token(syn);
        if header_norm == syn_norm {
            best = best.max(1.0);
            continue;
        }
        if contains_as_word(header_norm, &syn_norm) {
            best = best.max(0.85);
            continue;
        }
        // An empty header "contains" every synonym, as in arkyo.
        if header_norm.contains(syn_norm.as_str()) || syn_norm.contains(header_norm) {
            best = best.max(0.7);
            continue;
        }
        let sim = similarity(header_norm, &syn_norm);
        if sim >= 0.8 {
            best = best.max(sim * 0.75);
        }
    }
    best
}

fn value_bonus(field: TargetField, p: &ValueProfile) -> f64 {
    match field.kind() {
        FieldKind::Number | FieldKind::Int => {
            let mut b = if p.ratio_numeric >= 0.8 {
                1.0
            } else {
                p.ratio_numeric * 0.5
            };
            if field == F::HeightU && p.ratio_rack_unit >= 0.5 {
                b = 1.0;
            }
            if p.ratio_numeric < 0.3 && p.ratio_rack_unit < 0.3 {
                b = -1.0;
            }
            b
        }
        FieldKind::Bool => {
            if p.ratio_bool >= 0.8 {
                1.0
            } else if p.ratio_bool < 0.4 {
                -1.0
            } else {
                p.ratio_bool * 0.5
            }
        }
        FieldKind::Enum => {
            if p.ratio_width_fraction >= 0.5 {
                1.0
            } else if p.ratio_numeric >= 0.8 {
                -0.5
            } else {
                0.0
            }
        }
        FieldKind::Text => {
            if p.ratio_numeric >= 0.9 {
                -0.5
            } else if field == F::Name && p.distinct_ratio >= 0.7 {
                0.3
            } else {
                0.0
            }
        }
    }
}

fn clamp01(n: f64) -> f64 {
    n.clamp(0.0, 1.0)
}

fn normalize_bonus(b: f64) -> f64 {
    clamp01((b + 1.0) / 2.0)
}

/// `ColumnMapping`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    pub header: String,
    pub index: usize,
    pub suggested_field: Option<TargetField>,
    pub score: f64,
    pub alternatives: Vec<TargetField>,
}

pub const DEFAULT_THRESHOLD: f64 = 0.45;

/// `detectColumns({ headers, rows, threshold })`.
pub fn detect_columns(
    headers: &[String],
    rows: &[Vec<String>],
    threshold: f64,
) -> Vec<ColumnMapping> {
    let scored: Vec<Vec<(TargetField, f64)>> = headers
        .iter()
        .enumerate()
        .map(|(col, header)| {
            let values: Vec<&str> = rows
                .iter()
                .map(|r| r.get(col).map_or("", String::as_str))
                .collect();
            let profile = profile_values(&values);
            let header_norm = normalize_token(header);
            let mut per: Vec<(TargetField, f64)> = ALL_TARGET_FIELDS
                .iter()
                .map(|&field| {
                    let hs = score_header(&header_norm, field);
                    let bonus = value_bonus(field, &profile);
                    let combined = if hs <= 0.0 {
                        bonus.max(0.0) * 0.15 * VALUE_WEIGHT
                    } else {
                        clamp01(hs * HEADER_WEIGHT + normalize_bonus(bonus) * VALUE_WEIGHT)
                    };
                    (field, round4(combined))
                })
                .collect();
            per.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            per
        })
        .collect();

    // Greedy assignment over every (column, field) pair above the threshold.
    let mut pairs: Vec<(usize, TargetField, f64)> = scored
        .iter()
        .enumerate()
        .flat_map(|(col, per)| {
            per.iter()
                .filter(|(_, s)| *s >= threshold)
                .map(move |(f, s)| (col, *f, *s))
        })
        .collect();
    pairs.sort_by(|a, b| b.2.total_cmp(&a.2).then(a.0.cmp(&b.0)).then(a.1.cmp(&b.1)));
    let mut taken_cols = HashSet::new();
    let mut taken_fields = HashSet::new();
    let mut assigned: HashMap<usize, TargetField> = HashMap::new();
    for (col, field, _) in pairs {
        if taken_cols.contains(&col) || taken_fields.contains(&field) {
            continue;
        }
        taken_cols.insert(col);
        taken_fields.insert(field);
        assigned.insert(col, field);
    }

    scored
        .into_iter()
        .enumerate()
        .map(|(index, per)| {
            let suggested = assigned.get(&index).copied();
            let alternatives = per
                .iter()
                .filter(|(f, s)| Some(*f) != suggested && *s >= threshold * 0.6)
                .take(3)
                .map(|(f, _)| *f)
                .collect();
            let score = match suggested {
                Some(f) => per.iter().find(|(x, _)| *x == f).map_or(0.0, |p| p.1),
                None => per.first().map_or(0.0, |p| p.1),
            };
            ColumnMapping {
                header: headers[index].clone(),
                index,
                suggested_field: suggested,
                score,
                alternatives,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    //! arkyo:tests/unit/import-detect-columns.test.ts
    use super::*;

    fn detect(headers: &[&str], rows: &[&[&str]]) -> Vec<ColumnMapping> {
        let h: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
        let r: Vec<Vec<String>> = rows
            .iter()
            .map(|r| r.iter().map(|s| s.to_string()).collect())
            .collect();
        detect_columns(&h, &r, DEFAULT_THRESHOLD)
    }

    fn field(m: &[ColumnMapping], header: &str) -> Option<TargetField> {
        m.iter()
            .find(|c| c.header == header)
            .unwrap()
            .suggested_field
    }

    #[test]
    fn normalize_token_strips_accents_case_punctuation() {
        assert_eq!(normalize_token("Référence (mm)"), "reference mm");
        assert_eq!(normalize_token("Poids_kg"), "poids kg");
        assert_eq!(normalize_token("  MARQUE  "), "marque");
    }

    #[test]
    fn levenshtein_and_similarity() {
        assert_eq!(levenshtein("marque", "marque"), 0);
        assert_eq!(similarity("marque", "marque"), 1.0);
        assert_eq!(levenshtein("marque", "marques"), 1);
        assert!(similarity("brand", "brnad") > 0.5);
    }

    #[test]
    fn french_headers() {
        let m = detect(
            &[
                "Désignation",
                "Marque",
                "Référence",
                "U",
                "Profondeur (mm)",
                "Poids kg",
            ],
            &[
                &["Caméra HD", "Sony", "HXC-100", "2", "450", "6.5"],
                &["Grille SDI", "Blackmagic", "GX-12", "1", "300", "3.2"],
            ],
        );
        assert_eq!(field(&m, "Désignation"), Some(F::Name));
        assert_eq!(field(&m, "Marque"), Some(F::Brand));
        assert_eq!(field(&m, "Référence"), Some(F::Reference));
        assert_eq!(field(&m, "U"), Some(F::HeightU));
        assert_eq!(field(&m, "Profondeur (mm)"), Some(F::DepthMm));
        assert_eq!(field(&m, "Poids kg"), Some(F::Weight));
    }

    #[test]
    fn english_headers() {
        let m = detect(
            &[
                "Name",
                "Brand",
                "Model",
                "Rack U",
                "Depth",
                "Weight",
                "Power (W)",
            ],
            &[],
        );
        assert_eq!(field(&m, "Name"), Some(F::Name));
        assert_eq!(field(&m, "Brand"), Some(F::Brand));
        assert_eq!(field(&m, "Model"), Some(F::Reference));
        assert_eq!(field(&m, "Rack U"), Some(F::HeightU));
        assert_eq!(field(&m, "Depth"), Some(F::DepthMm));
        assert_eq!(field(&m, "Weight"), Some(F::Weight));
        assert_eq!(field(&m, "Power (W)"), Some(F::PowerW));
    }

    #[test]
    fn booleans_and_2110_from_headers() {
        let m = detect(
            &["Nom", "ST 2110", "Double alimentation"],
            &[&["Switch", "oui", "non"], &["Routeur", "non", "oui"]],
        );
        assert_eq!(field(&m, "ST 2110"), Some(F::Is2110));
        assert_eq!(field(&m, "Double alimentation"), Some(F::HasDualPsu));
    }

    #[test]
    fn deterministic_and_unique() {
        let a = detect(&["Nom", "Désignation", "Marque"], &[]);
        let fields: Vec<_> = a.iter().filter_map(|m| m.suggested_field).collect();
        let set: HashSet<_> = fields.iter().collect();
        assert_eq!(set.len(), fields.len());
        let b = detect(&["Nom", "Désignation", "Marque"], &[]);
        assert_eq!(a, b);
    }

    #[test]
    fn unknown_column() {
        let m = detect(&["Fournisseur XYZ zzz", "Colonne bidon 42"], &[]);
        let c = m.iter().find(|c| c.header == "Colonne bidon 42").unwrap();
        assert!(c.suggested_field.is_none() || c.score < 0.7);
    }

    #[test]
    fn alternatives_exclude_suggestion() {
        let m = detect(&["Hauteur"], &[]);
        assert!(!m[0].alternatives.contains(&m[0].suggested_field.unwrap()));
    }

    #[test]
    fn value_inspection() {
        // "2U" values make a vaguely named column a rack height.
        assert!(is_rack_unit_like(" 12 u "));
        assert!(!is_rack_unit_like("123U"));
        assert!(is_numeric_like("1 200,5"));
        assert!(!is_numeric_like("1.2.3"));
        let m = detect(&["Hauteur rack"], &[&["2U"], &["1U"]]);
        assert_eq!(m[0].suggested_field, Some(F::HeightU));
    }
}
