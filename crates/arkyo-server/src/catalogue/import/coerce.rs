//! Conversion of spreadsheet text cells to the equipment column types, with
//! per-cell errors (arkyo:lib/services/import/coerce.ts). Pure.
//!
//! Numbers accept the French decimal comma, thousands spaces and a trailing
//! unit (`kg`, `W`, `mm`, `%`…); booleans oui/non, true/false, 1/0, x…;
//! `widthFraction` FULL/HALF/THIRD/QUARTER and their synonyms.

use serde::Serialize;

use super::detect::{is_decimal, FieldKind, TargetField, BOOL_TRUE};
use super::{is_js_space, js_round, js_trim, strip_accents_lower};

/// `WIDTH_FRACTION_MAP` (the `"1 2"`-style keys cannot match once spaces
/// are removed; kept for a 1:1 port of the table).
const WIDTH_FRACTION_MAP: [(&str, &str); 31] = [
    ("full", "FULL"),
    ("1", "FULL"),
    ("1/1", "FULL"),
    ("1 1", "FULL"),
    ("100", "FULL"),
    ("100%", "FULL"),
    ("plein", "FULL"),
    ("pleine", "FULL"),
    ("entier", "FULL"),
    ("entiere", "FULL"),
    ("half", "HALF"),
    ("1/2", "HALF"),
    ("1 2", "HALF"),
    ("0.5", "HALF"),
    ("50", "HALF"),
    ("50%", "HALF"),
    ("demi", "HALF"),
    ("moitie", "HALF"),
    ("third", "THIRD"),
    ("1/3", "THIRD"),
    ("1 3", "THIRD"),
    ("33", "THIRD"),
    ("33%", "THIRD"),
    ("tiers", "THIRD"),
    ("quarter", "QUARTER"),
    ("1/4", "QUARTER"),
    ("1 4", "QUARTER"),
    ("0.25", "QUARTER"),
    ("25", "QUARTER"),
    ("25%", "QUARTER"),
    ("quart", "QUARTER"),
];

const BOOL_FALSE: [&str; 7] = ["non", "no", "n", "false", "faux", "0", "off"];

/// `CoercedValue`.
#[derive(Clone, Debug, PartialEq)]
pub enum Coerced {
    Null,
    Text(String),
    Num(f64),
    Bool(bool),
}

/// Value and optional error message of one cell.
pub type Cell = (Coerced, Option<String>);

/// `cleanNumeric`: trim, whitespace removed, first `,` → `.`, trailing
/// unit (`[a-zA-Z%µ°"]+$`) removed.
fn clean_numeric(raw: &str) -> String {
    let s: String = js_trim(raw).chars().filter(|c| !is_js_space(*c)).collect();
    let s = s.replacen(',', ".", 1);
    s.trim_end_matches(|c: char| c.is_ascii_alphabetic() || matches!(c, '%' | 'µ' | '°' | '"'))
        .to_string()
}

fn not_a_number(raw: &str) -> Cell {
    (
        Coerced::Null,
        Some(format!("\"{raw}\" n'est pas un nombre valide")),
    )
}

pub fn coerce_number(raw: &str) -> Cell {
    let t = js_trim(raw);
    if t.is_empty() {
        return (Coerced::Null, None);
    }
    let cleaned = clean_numeric(t);
    if !is_decimal(&cleaned) {
        return not_a_number(raw);
    }
    match cleaned.parse::<f64>() {
        Ok(n) if n.is_finite() => (Coerced::Num(n), None),
        _ => not_a_number(raw),
    }
}

/// Tolerates "2U" / "12 U" (rack height) and rounds decimals.
pub fn coerce_int(raw: &str) -> Cell {
    let t = js_trim(raw);
    if t.is_empty() {
        return (Coerced::Null, None);
    }
    // `^(\d+)\s*u$` (case-insensitive).
    let unit = t.strip_suffix(['u', 'U']).and_then(|b| {
        let d = b.trim_end_matches(is_js_space);
        (!d.is_empty() && d.bytes().all(|c| c.is_ascii_digit())).then_some(d)
    });
    let source = unit.unwrap_or(t);
    match coerce_number(source) {
        (Coerced::Num(n), None) => (Coerced::Num(js_round(n)), None),
        other => other,
    }
}

pub fn coerce_bool(raw: &str) -> Cell {
    let t = js_trim(raw);
    if t.is_empty() {
        return (Coerced::Null, None);
    }
    let nv = strip_accents_lower(t);
    if BOOL_TRUE.contains(&nv.as_str()) {
        return (Coerced::Bool(true), None);
    }
    if BOOL_FALSE.contains(&nv.as_str()) {
        return (Coerced::Bool(false), None);
    }
    (
        Coerced::Null,
        Some(format!("\"{raw}\" n'est pas un booléen (oui/non)")),
    )
}

fn width_lookup(key: &str) -> Option<&'static str> {
    WIDTH_FRACTION_MAP
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| *v)
}

pub fn coerce_width_fraction(raw: &str) -> Cell {
    let t = js_trim(raw);
    if t.is_empty() {
        return (Coerced::Null, None);
    }
    let key: String = strip_accents_lower(t)
        .chars()
        .filter(|c| !is_js_space(*c))
        .collect();
    let direct = width_lookup(&key).or_else(|| width_lookup(key.strip_suffix('%').unwrap_or(&key)));
    match direct {
        Some(v) => (Coerced::Text(v.into()), None),
        None => (
            Coerced::Null,
            Some(format!(
                "\"{raw}\" n'est pas une largeur reconnue (FULL/HALF/THIRD/QUARTER)"
            )),
        ),
    }
}

/// `coerceField`: by the kind of `field`.
pub fn coerce_field(field: TargetField, raw: &str) -> Cell {
    match field.kind() {
        FieldKind::Int => coerce_int(raw),
        FieldKind::Number => coerce_number(raw),
        FieldKind::Bool => coerce_bool(raw),
        FieldKind::Enum => coerce_width_fraction(raw),
        FieldKind::Text => {
            let t = js_trim(raw);
            if t.is_empty() {
                (Coerced::Null, None)
            } else {
                (Coerced::Text(t.into()), None)
            }
        }
    }
}

/// `{ field, index }` of a mapped column.
#[derive(Clone, Copy, Debug)]
pub struct ColumnMap {
    pub field: TargetField,
    pub index: usize,
}

/// `CoerceError` (also the `cellIssues` of the preview).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CoerceError {
    pub field: TargetField,
    pub value: String,
    pub message: String,
}

/// `CoercedRow`: the last column mapped to a field wins.
#[derive(Clone, Debug, Default)]
pub struct CoercedRow {
    pub values: Vec<(TargetField, Coerced)>,
    pub errors: Vec<CoerceError>,
}

impl CoercedRow {
    pub fn get(&self, field: TargetField) -> Option<&Coerced> {
        self.values
            .iter()
            .rev()
            .find(|(f, _)| *f == field)
            .map(|(_, v)| v)
    }
}

/// `coerceRow`: invalid cells are reported and set to null.
pub fn coerce_row(row: &[String], mapping: &[ColumnMap]) -> CoercedRow {
    let mut out = CoercedRow::default();
    for m in mapping {
        let raw = row.get(m.index).map_or("", String::as_str);
        let (value, error) = coerce_field(m.field, raw);
        if let Some(message) = error {
            out.errors.push(CoerceError {
                field: m.field,
                value: raw.into(),
                message,
            });
        }
        out.values.push((m.field, value));
    }
    out
}

/// `splitTags`: `,` `;` `|` separators, trimmed, empty entries dropped.
pub fn split_tags(raw: Option<&str>) -> Vec<String> {
    raw.map(|s| {
        s.split([',', ';', '|'])
            .map(js_trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    //! arkyo:tests/unit/import-coerce.test.ts
    use super::*;
    use TargetField as F;

    fn num(c: Cell) -> Option<f64> {
        match c.0 {
            Coerced::Num(n) => Some(n),
            _ => None,
        }
    }

    #[test]
    fn coerce_number_cases() {
        assert_eq!(num(coerce_number("450")), Some(450.0));
        assert_eq!(num(coerce_number("6,5")), Some(6.5));
        assert_eq!(num(coerce_number("6.5 kg")), Some(6.5));
        assert_eq!(num(coerce_number("1 200")), Some(1200.0));
        assert_eq!(coerce_number(""), (Coerced::Null, None));
        let r = coerce_number("abc");
        assert_eq!(r.0, Coerced::Null);
        assert_eq!(r.1.as_deref(), Some("\"abc\" n'est pas un nombre valide"));
    }

    #[test]
    fn coerce_int_cases() {
        assert_eq!(num(coerce_int("2U")), Some(2.0));
        assert_eq!(num(coerce_int("12 U")), Some(12.0));
        assert_eq!(num(coerce_int("2.7")), Some(3.0));
    }

    #[test]
    fn coerce_bool_cases() {
        assert_eq!(coerce_bool("oui").0, Coerced::Bool(true));
        assert_eq!(coerce_bool("Non").0, Coerced::Bool(false));
        assert_eq!(coerce_bool("true").0, Coerced::Bool(true));
        assert_eq!(coerce_bool("0").0, Coerced::Bool(false));
        assert_eq!(coerce_bool("x").0, Coerced::Bool(true));
        assert!(coerce_bool("peut-être").1.is_some());
    }

    #[test]
    fn coerce_width_fraction_cases() {
        let w = |s: &str| coerce_width_fraction(s).0;
        let t = |s: &str| Coerced::Text(s.into());
        assert_eq!(w("FULL"), t("FULL"));
        assert_eq!(w("half"), t("HALF"));
        assert_eq!(w("1/2"), t("HALF"));
        assert_eq!(w("1/3"), t("THIRD"));
        assert_eq!(w("quart"), t("QUARTER"));
        assert_eq!(w("100%"), t("FULL"));
        assert_eq!(w("plein"), t("FULL"));
        assert_eq!(w("Moitié"), t("HALF"));
        assert!(coerce_width_fraction("2/5").1.is_some());
    }

    #[test]
    fn coerce_field_routes_by_kind() {
        assert_eq!(num(coerce_field(F::HeightU, "3U")), Some(3.0));
        assert_eq!(num(coerce_field(F::Weight, "6,5")), Some(6.5));
        assert_eq!(coerce_field(F::Is2110, "oui").0, Coerced::Bool(true));
        assert_eq!(
            coerce_field(F::WidthFraction, "demi").0,
            Coerced::Text("HALF".into())
        );
        assert_eq!(
            coerce_field(F::Name, "  Caméra  ").0,
            Coerced::Text("Caméra".into())
        );
    }

    #[test]
    fn split_tags_cases() {
        assert_eq!(split_tags(Some("hd, sdi ; ip")), ["hd", "sdi", "ip"]);
        assert!(split_tags(Some("")).is_empty());
        assert!(split_tags(None).is_empty());
    }

    fn mapping() -> Vec<ColumnMap> {
        [F::Name, F::HeightU, F::Weight, F::Is2110]
            .into_iter()
            .enumerate()
            .map(|(index, field)| ColumnMap { field, index })
            .collect()
    }

    fn row(cells: &[&str]) -> Vec<String> {
        cells.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn coerce_row_complete() {
        let r = coerce_row(&row(&["Switch", "1", "3,2", "oui"]), &mapping());
        assert_eq!(r.get(F::Name), Some(&Coerced::Text("Switch".into())));
        assert_eq!(r.get(F::HeightU), Some(&Coerced::Num(1.0)));
        assert_eq!(r.get(F::Weight), Some(&Coerced::Num(3.2)));
        assert_eq!(r.get(F::Is2110), Some(&Coerced::Bool(true)));
        assert!(r.errors.is_empty());
    }

    #[test]
    fn coerce_row_collects_errors() {
        let r = coerce_row(&row(&["Switch", "abc", "", "peut-être"]), &mapping());
        assert_eq!(r.get(F::Name), Some(&Coerced::Text("Switch".into())));
        assert_eq!(r.get(F::HeightU), Some(&Coerced::Null));
        assert_eq!(r.get(F::Is2110), Some(&Coerced::Null));
        let fields: Vec<_> = r.errors.iter().map(|e| e.field).collect();
        assert!(fields.contains(&F::HeightU) && fields.contains(&F::Is2110));
    }
}
