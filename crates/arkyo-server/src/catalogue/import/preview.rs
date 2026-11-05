//! Per-row status of an import batch before the commit: new / duplicate /
//! invalid, without writing (arkyo:lib/services/import/preview.ts). Pure.
//!
//! Mirror of the commit's dedup: `reference` (trimmed, exact) first, then
//! `name` (trimmed, case-insensitive), against the database and against the
//! previous rows of the file (`matchRow` = first occurrence). A row may match
//! both: `match` is the database item and `matchRow` is set too.

use std::collections::HashMap;

use serde::Serialize;

use super::build::{build_equipment_input, BuildRefs};
use super::coerce::{coerce_row, CoerceError, ColumnMap};
use super::js_trim;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ExistingEquipment {
    pub id: String,
    pub name: String,
    pub reference: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    New,
    Duplicate,
    Invalid,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowPreview {
    pub row: usize,
    pub status: Status,
    #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
    pub matched: Option<ExistingEquipment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_row: Option<usize>,
    pub cell_issues: Vec<CoerceError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Summary {
    pub new: usize,
    pub duplicate: usize,
    pub invalid: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PreviewResult {
    pub rows: Vec<RowPreview>,
    pub summary: Summary,
}

/// `name.trim().toLowerCase()`.
fn name_key(name: &str) -> String {
    js_trim(name).to_lowercase()
}

/// `previewRows`.
pub fn preview_rows(
    rows: &[Vec<String>],
    mapping: &[ColumnMap],
    existing: &[ExistingEquipment],
) -> PreviewResult {
    let mut base_ref: HashMap<String, &ExistingEquipment> = HashMap::new();
    let mut base_name: HashMap<String, &ExistingEquipment> = HashMap::new();
    for e in existing {
        if let Some(r) = e
            .reference
            .as_deref()
            .map(js_trim)
            .filter(|r| !r.is_empty())
        {
            base_ref.entry(r.to_string()).or_insert(e);
        }
        base_name.entry(name_key(&e.name)).or_insert(e);
    }
    let mut file_ref: HashMap<String, usize> = HashMap::new();
    let mut file_name: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::with_capacity(rows.len());
    let mut summary = Summary::default();

    for (i, row) in rows.iter().enumerate() {
        let coerced = coerce_row(row, mapping);
        let cell_issues = coerced.errors.clone();
        let input = match build_equipment_input(&coerced, BuildRefs::default()) {
            Ok(input) => input,
            Err(reason) => {
                out.push(RowPreview {
                    row: i,
                    status: Status::Invalid,
                    matched: None,
                    match_row: None,
                    cell_issues,
                    reason: Some(reason),
                });
                summary.invalid += 1;
                continue;
            }
        };
        let r = input
            .reference
            .as_deref()
            .map(js_trim)
            .filter(|r| !r.is_empty());
        let nk = name_key(&input.name);

        let matched = r
            .and_then(|r| base_ref.get(r))
            .or_else(|| base_name.get(&nk))
            .map(|e| (*e).clone());
        let match_row = match r.and_then(|r| file_ref.get(r)) {
            Some(i) => Some(*i),
            None => file_name.get(&nk).copied(),
        };
        if let Some(r) = r {
            file_ref.entry(r.to_string()).or_insert(i);
        }
        file_name.entry(nk).or_insert(i);

        let duplicate = matched.is_some() || match_row.is_some();
        if duplicate {
            summary.duplicate += 1;
        } else {
            summary.new += 1;
        }
        out.push(RowPreview {
            row: i,
            status: if duplicate {
                Status::Duplicate
            } else {
                Status::New
            },
            matched,
            match_row,
            cell_issues,
            reason: None,
        });
    }
    PreviewResult { rows: out, summary }
}

#[cfg(test)]
mod tests {
    //! arkyo:tests/unit/import-preview.test.ts
    use super::*;
    use crate::catalogue::import::detect::TargetField as F;

    fn mapping(fields: &[F]) -> Vec<ColumnMap> {
        fields
            .iter()
            .enumerate()
            .map(|(index, &field)| ColumnMap { field, index })
            .collect()
    }

    fn rows(r: &[&[&str]]) -> Vec<Vec<String>> {
        r.iter()
            .map(|r| r.iter().map(|s| s.to_string()).collect())
            .collect()
    }

    fn eq(id: &str, name: &str, reference: Option<&str>) -> ExistingEquipment {
        ExistingEquipment {
            id: id.into(),
            name: name.into(),
            reference: reference.map(str::to_string),
        }
    }

    fn summary(new: usize, duplicate: usize, invalid: usize) -> Summary {
        Summary {
            new,
            duplicate,
            invalid,
        }
    }

    const NR: [F; 2] = [F::Name, F::Reference];

    #[test]
    fn valid_row_without_match_is_new() {
        let r = preview_rows(&rows(&[&["Ampli Crown", "CRN-123"]]), &mapping(&NR), &[]);
        assert_eq!(r.rows[0].status, Status::New);
        assert!(r.rows[0].cell_issues.is_empty());
        assert!(r.rows[0].matched.is_none() && r.rows[0].match_row.is_none());
        assert_eq!(r.summary, summary(1, 0, 0));
    }

    #[test]
    fn base_match_by_trimmed_reference() {
        let ex = [eq("eq-ref", "Caméra Sony", Some("SNY-CAM-1"))];
        let r = preview_rows(
            &rows(&[&["Autre nom", "  SNY-CAM-1  "]]),
            &mapping(&NR),
            &ex,
        );
        assert_eq!(r.rows[0].status, Status::Duplicate);
        assert_eq!(r.rows[0].matched, Some(ex[0].clone()));
        assert_eq!(r.summary, summary(0, 1, 0));
    }

    #[test]
    fn base_match_by_case_insensitive_name() {
        let ex = [eq("eq-name", "Caméra Sony", Some("SNY-CAM-1"))];
        let r = preview_rows(&rows(&[&["  CAMÉRA sony  ", ""]]), &mapping(&NR), &ex);
        assert_eq!(r.rows[0].status, Status::Duplicate);
        assert_eq!(r.rows[0].matched.as_ref().unwrap().id, "eq-name");
    }

    #[test]
    fn reference_wins_over_name() {
        let ex = [
            eq("eq-A", "Ampli A", Some("REF-A")),
            eq("eq-B", "Ampli B", Some("REF-B")),
        ];
        let r = preview_rows(&rows(&[&["Ampli B", "REF-A"]]), &mapping(&NR), &ex);
        assert_eq!(r.rows[0].matched.as_ref().unwrap().id, "eq-A");
    }

    #[test]
    fn unknown_reference_falls_back_to_name() {
        let ex = [eq("eq-name", "Ampli Crown", Some("OTHER-REF"))];
        let r = preview_rows(
            &rows(&[&["Ampli Crown", "REF-INCONNUE"]]),
            &mapping(&NR),
            &ex,
        );
        assert_eq!(r.rows[0].matched.as_ref().unwrap().id, "eq-name");
    }

    #[test]
    fn in_file_duplicate_points_to_first_row() {
        let r = preview_rows(
            &rows(&[&["Ampli Crown", "CRN-123"], &["Ampli Crown", "CRN-123"]]),
            &mapping(&NR),
            &[],
        );
        assert_eq!(r.rows[0].status, Status::New);
        assert_eq!(r.rows[1].status, Status::Duplicate);
        assert_eq!(r.rows[1].match_row, Some(0));
        assert!(r.rows[1].matched.is_none());
        assert_eq!(r.summary, summary(1, 1, 0));
    }

    #[test]
    fn base_and_file_match_both_reported() {
        let ex = [eq("eq-base", "Ampli Crown", Some("CRN-123"))];
        let r = preview_rows(
            &rows(&[&["Ampli Crown", "CRN-123"], &["Ampli Crown", "CRN-123"]]),
            &mapping(&NR),
            &ex,
        );
        assert_eq!(r.rows[1].matched.as_ref().unwrap().id, "eq-base");
        assert_eq!(r.rows[1].match_row, Some(0));
    }

    #[test]
    fn missing_name_is_invalid() {
        let r = preview_rows(&rows(&[&["", "REF-1"]]), &mapping(&NR), &[]);
        assert_eq!(r.rows[0].status, Status::Invalid);
        assert_eq!(r.rows[0].reason.as_deref(), Some("Nom manquant"));
        assert_eq!(r.summary, summary(0, 0, 1));
    }

    #[test]
    fn cell_issues_do_not_block() {
        let r = preview_rows(
            &rows(&[&["Ampli Crown", "abc"]]),
            &mapping(&[F::Name, F::Weight]),
            &[],
        );
        assert_eq!(r.rows[0].status, Status::New);
        assert_eq!(r.rows[0].cell_issues.len(), 1);
        assert_eq!(r.rows[0].cell_issues[0].field, F::Weight);
        assert_eq!(r.rows[0].cell_issues[0].value, "abc");
        assert!(r.rows[0].cell_issues[0].message.contains("nombre valide"));
    }

    #[test]
    fn mixed_batch_summary() {
        let ex = [eq("eq-base", "Ampli Crown", Some("CRN-123"))];
        let r = preview_rows(
            &rows(&[
                &["Ampli Crown", "CRN-123"],
                &["Micro Shure", "SHR-1"],
                &["", "SANS-NOM"],
                &["Micro Shure", "SHR-1"],
            ]),
            &mapping(&NR),
            &ex,
        );
        let st: Vec<Status> = r.rows.iter().map(|x| x.status).collect();
        assert_eq!(
            st,
            [
                Status::Duplicate,
                Status::New,
                Status::Invalid,
                Status::Duplicate
            ]
        );
        assert_eq!(r.summary, summary(1, 2, 1));
    }
}
