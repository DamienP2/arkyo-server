//! A coerced row + the resolved brand/category ids → the equipment write
//! payload (arkyo:lib/services/import/build-equipment.ts). Pure. `name` is
//! required: a row without one is invalid.

use serde_json::{Map, Value};

use super::coerce::{split_tags, Coerced, CoercedRow};
use super::detect::TargetField as F;
use super::{js_round, js_trim};

/// `EquipmentImportInput` (absent fields stay `None`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EquipmentInput {
    pub name: String,
    pub reference: Option<String>,
    pub brand_id: Option<String>,
    pub category_id: Option<String>,
    /// Integer columns that received a number (`INT_FIELDS`).
    pub ints: Vec<(&'static str, i64)>,
    /// Float columns (`NUM_FIELDS`).
    pub nums: Vec<(&'static str, f64)>,
    /// Boolean columns (`BOOL_FIELDS`).
    pub bools: Vec<(&'static str, bool)>,
    pub width_fraction: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
}

/// Brand / category ids resolved for the row.
#[derive(Clone, Debug, Default)]
pub struct BuildRefs {
    pub brand_id: Option<String>,
    pub category_id: Option<String>,
}

const INT_FIELDS: [F; 7] = [
    F::HeightU,
    F::DepthMm,
    F::DimLmm,
    F::DimWmm,
    F::DimHmm,
    F::PowerW,
    F::DmxChannelsDefault,
];
const NUM_FIELDS: [F; 2] = [F::Weight, F::HeatBtuH];
const BOOL_FIELDS: [F; 3] = [F::HasDualPsu, F::Is2110, F::IsLightingFixture];

fn text(row: &CoercedRow, f: F) -> Option<&str> {
    match row.get(f) {
        Some(Coerced::Text(s)) => Some(s),
        _ => None,
    }
}

/// `buildEquipmentInput`: `Err("Nom manquant")` without a name.
pub fn build_equipment_input(row: &CoercedRow, refs: BuildRefs) -> Result<EquipmentInput, String> {
    let name = text(row, F::Name).map(js_trim).unwrap_or("");
    if name.is_empty() {
        return Err("Nom manquant".into());
    }
    let mut input = EquipmentInput {
        name: name.into(),
        brand_id: refs.brand_id,
        category_id: refs.category_id,
        ..Default::default()
    };
    if let Some(r) = text(row, F::Reference)
        .map(js_trim)
        .filter(|r| !r.is_empty())
    {
        input.reference = Some(r.into());
    }
    for f in INT_FIELDS {
        if let Some(Coerced::Num(n)) = row.get(f) {
            input.ints.push((f.as_str(), js_round(*n) as i64));
        }
    }
    for f in NUM_FIELDS {
        if let Some(Coerced::Num(n)) = row.get(f) {
            input.nums.push((f.as_str(), *n));
        }
    }
    for f in BOOL_FIELDS {
        if let Some(Coerced::Bool(b)) = row.get(f) {
            input.bools.push((f.as_str(), *b));
        }
    }
    if let Some(w) = text(row, F::WidthFraction).filter(|w| !w.is_empty()) {
        input.width_fraction = Some(w.into());
    }
    if let Some(n) = text(row, F::Notes).map(js_trim).filter(|n| !n.is_empty()) {
        input.notes = Some(n.into());
    }
    if let Some(t) = text(row, F::Tags) {
        let tags = split_tags(Some(t));
        if !tags.is_empty() {
            input.tags = Some(tags);
        }
    }
    Ok(input)
}

impl EquipmentInput {
    /// arkyo commit `toWriteData`: name, reference, brandId and categoryId
    /// always (null when absent), the other columns only when the row set
    /// them.
    pub fn write_data(&self) -> Map<String, Value> {
        let opt = |v: &Option<String>| v.clone().map_or(Value::Null, Value::String);
        let mut m = Map::new();
        m.insert("name".into(), Value::String(self.name.clone()));
        m.insert("reference".into(), opt(&self.reference));
        m.insert("brandId".into(), opt(&self.brand_id));
        m.insert("categoryId".into(), opt(&self.category_id));
        for (k, v) in &self.ints {
            m.insert((*k).into(), Value::from(*v));
        }
        for (k, v) in &self.nums {
            m.insert((*k).into(), Value::from(*v));
        }
        for (k, v) in &self.bools {
            m.insert((*k).into(), Value::Bool(*v));
        }
        if let Some(n) = &self.notes {
            m.insert("notes".into(), Value::String(n.clone()));
        }
        if let Some(w) = &self.width_fraction {
            m.insert("widthFraction".into(), Value::String(w.clone()));
        }
        if let Some(t) = &self.tags {
            m.insert(
                "tags".into(),
                Value::Array(t.iter().cloned().map(Value::String).collect()),
            );
        }
        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalogue::import::coerce::{coerce_row, ColumnMap};

    fn build(fields: &[F], cells: &[&str]) -> Result<EquipmentInput, String> {
        let mapping: Vec<ColumnMap> = fields
            .iter()
            .enumerate()
            .map(|(index, &field)| ColumnMap { field, index })
            .collect();
        let row: Vec<String> = cells.iter().map(|s| s.to_string()).collect();
        build_equipment_input(&coerce_row(&row, &mapping), BuildRefs::default())
    }

    #[test]
    fn name_required() {
        assert_eq!(build(&[F::Name], &["  "]), Err("Nom manquant".into()));
    }

    #[test]
    fn typed_fields() {
        let i = build(
            &[
                F::Name,
                F::HeightU,
                F::Weight,
                F::Is2110,
                F::Tags,
                F::WidthFraction,
                F::Notes,
            ],
            &["Cam", "2,6", "6,5 kg", "oui", "a;b", "1/4", " n "],
        )
        .unwrap();
        assert_eq!(i.ints, [("heightU", 3)]);
        assert_eq!(i.nums, [("weight", 6.5)]);
        assert_eq!(i.bools, [("is2110", true)]);
        assert_eq!(i.tags, Some(vec!["a".into(), "b".into()]));
        assert_eq!(i.width_fraction.as_deref(), Some("QUARTER"));
        assert_eq!(i.notes.as_deref(), Some("n"));
        let w = i.write_data();
        assert_eq!(w["brandId"], Value::Null);
        assert_eq!(w["reference"], Value::Null);
        assert!(!w.contains_key("depthMm"));
    }
}
