//! Equipment duplication and duplicate detection
//! (arkyo:app/api/tenant/catalogue/equipment/[id]/duplicate and
//! check-duplicate).

use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::enrich::EQUIPMENT;
use crate::http::parametres::{list_rows_conn, str_of, Obj};

/// Columns that are not copied: identity, ownership, dates (set by the
/// insert), `documents` (arkyo's personal duplicate does not copy them) and
/// the fork lineage (always empty in the single catalogue).
const NOT_COPIED: [&str; 9] = [
    "id",
    "createdById",
    "createdAt",
    "updatedAt",
    "documents",
    "clonedFromArkyoId",
    "clonedFromArkyoVersion",
    "shadowsArkyo",
    "isActive",
];

/// Column values of the copy of `source`: name suffixed " (copie)", active.
pub fn copy_values(source: &Obj) -> Vec<(String, Value)> {
    let mut out: Vec<(String, Value)> = source
        .iter()
        .filter(|(k, _)| !NOT_COPIED.contains(&k.as_str()))
        .map(|(k, v)| {
            if k == "name" {
                let n = str_of(source, "name").unwrap_or("");
                (k.clone(), Value::String(format!("{n} (copie)")))
            } else {
                (k.clone(), v.clone())
            }
        })
        .collect();
    out.push(("isActive".into(), Value::Bool(true)));
    out
}

const MIN_NAME: usize = 2;
const MIN_REFERENCE: usize = 1;
const LIMIT: usize = 5;

fn fold(s: &str) -> String {
    crate::http::parametres::fold(s)
}

/// Active equipment whose name and/or reference contains the (trimmed)
/// query, case-insensitively: at most 5, most recently updated first, each
/// `{id, name, reference, source: "PERSONAL", matchField}`.
pub async fn matches(
    conn: &mut SqliteConnection,
    name: &str,
    reference: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    let name = name.trim();
    let reference = reference.trim();
    let q_name = (name.chars().count() >= MIN_NAME).then(|| fold(name));
    let q_ref = (reference.chars().count() >= MIN_REFERENCE).then(|| fold(reference));
    if q_name.is_none() && q_ref.is_none() {
        return Ok(vec![]);
    }
    let rows = list_rows_conn(
        conn,
        &EQUIPMENT,
        r#"WHERE "isActive" = 1"#,
        r#""updatedAt" DESC"#,
    )
    .await?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            let n = fold(str_of(r, "name").unwrap_or(""));
            let rf = fold(str_of(r, "reference").unwrap_or(""));
            let by_name = q_name.as_ref().is_some_and(|q| n.contains(q.as_str()));
            let by_ref = q_ref
                .as_ref()
                .is_some_and(|q| !rf.is_empty() && rf.contains(q.as_str()));
            if !by_name && !by_ref {
                return None;
            }
            // arkyo `computeMatchField`
            let field = if by_name && by_ref {
                "both"
            } else if by_ref {
                "reference"
            } else {
                "name"
            };
            Some(json!({
                "id": r.get("id"), "name": r.get("name"), "reference": r.get("reference"),
                "source": "PERSONAL", "matchField": field,
            }))
        })
        .take(LIMIT)
        .collect())
}
