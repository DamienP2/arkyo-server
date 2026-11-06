//! Projects: arkyo:app/api/tenant/projects/** ([`tenant`]) and
//! arkyo:app/api/projects/route.ts ([`legacy`]).
//!
//! Shared here: the `Project` row as Prisma returns it, arkyo's
//! `{ error: "Validation invalide", issues }` envelope (`zodIssuesFromError`),
//! the `new Date(string)` conversion of the date fields and the duplicate
//! name key.

#![allow(clippy::result_large_err)]

mod legacy;
mod tenant;

use std::collections::BTreeMap;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::{fold, row_map, Field, Obj, Table};
use super::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tenant/projects", get(tenant::list).post(tenant::create))
        .route(
            "/tenant/projects/{id}",
            get(tenant::get)
                .patch(tenant::update)
                .delete(tenant::remove),
        )
        .route("/projects", get(legacy::list).post(legacy::create))
}

// ── rows ────────────────────────────────────────────────────────────────────

pub(crate) const PROJECT: Table = Table {
    name: "Project",
    bools: &[],
    jsons: &["ipMapPositions"],
};

/// The scalar fields of the Prisma `Project` model (what `findUnique`,
/// `create` and `update` return), in the schema's order. Listed rather than
/// `*` so a newer database's extra columns stay out of the JSON.
pub(crate) const PROJECT_COLS: &str = r#""id", "name", "clientName", "shootingDate",
    "shootingEndDate", "planningStart", "planningEnd", "commissioningDate", "location",
    "description", "status", "prestationType", "interventionType", "rigType", "createdAt",
    "updatedAt", "createdById", "ipMapPositions""#;

pub(crate) const RIG_CONFIG: Table = Table {
    name: "RigConfig",
    bools: &["isTemplate"],
    jsons: &[],
};

pub(crate) const RACK: Table = Table {
    name: "Rack",
    bools: &["isRackable", "hasWheels", "isVirtual"],
    jsons: &["numberingOverride", "constructionChecks"],
};

pub(crate) const PLAIN: Table = Table {
    name: "",
    bools: &[],
    jsons: &[],
};

pub(crate) const TECHNICAL_SHEET: Table = Table {
    name: "TechnicalSheet",
    bools: &[],
    jsons: &["blocks"],
};

/// The project `id` (Prisma scalars), `None` when it does not exist.
pub(crate) async fn project_row(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<Obj>, sqlx::Error> {
    let row = sqlx::query(&format!(
        r#"SELECT {PROJECT_COLS} FROM "Project" WHERE "id" = ?"#
    ))
    .bind(id)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|r| row_map(&r, &PROJECT)))
}

// ── validation ──────────────────────────────────────────────────────────────

/// `400 { error: "Validation invalide", issues }` (or another status).
pub(crate) fn invalid(status: StatusCode, issues: Vec<Value>) -> Response {
    (
        status,
        Json(json!({ "error": "Validation invalide", "issues": issues })),
    )
        .into_response()
}

pub(crate) fn issue(path: &str, message: &str) -> Value {
    json!({ "path": [path], "message": message })
}

/// `zodIssuesFromError(parsed.error)`: one `{path, message}` per failed
/// check, in the order of the schema's fields (Zod's order); a form-level
/// error (body not an object) gets the path `["root"]`.
pub(crate) fn zod_issues(
    fields: &[Field],
    flat: (Vec<String>, BTreeMap<String, Vec<String>>),
) -> Vec<Value> {
    let (form, by_field) = flat;
    let mut out: Vec<Value> = form.iter().map(|m| issue("root", m)).collect();
    for f in fields {
        for m in by_field.get(f.name).into_iter().flatten() {
            out.push(issue(f.name, m));
        }
    }
    out
}

/// `new Date(s).toISOString()` for the strings the front sends: an ISO
/// instant with an offset, a date alone (`YYYY-MM-DD`, read as UTC midnight
/// like JavaScript) or a date and time without offset (local time, like
/// JavaScript). `None` when JavaScript would give an Invalid Date.
pub(crate) fn js_date(s: &str) -> Option<String> {
    use jiff::civil::{Date, DateTime};
    use jiff::tz::TimeZone;
    use jiff::Timestamp;
    let ts = if let Ok(ts) = s.parse::<Timestamp>() {
        ts
    } else if let Ok(d) = s.parse::<Date>() {
        d.to_zoned(TimeZone::UTC).ok()?.timestamp()
    } else {
        s.parse::<DateTime>()
            .ok()?
            .to_zoned(TimeZone::system())
            .ok()?
            .timestamp()
    };
    Some(ts.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

/// The date fields of the `Project` model.
pub(crate) const DATE_FIELDS: [&str; 5] = [
    "shootingDate",
    "shootingEndDate",
    "planningStart",
    "planningEnd",
    "commissioningDate",
];

/// Converts the date fields of `vals` in place, as arkyo does
/// (`d ? new Date(d) : null`): `null` and `""` give `null`.
/// arkyo-server: a string `new Date` cannot read made Prisma throw (500);
/// it is reported as a validation issue on the field instead.
pub(crate) fn convert_dates(vals: &mut Obj) -> Result<(), Vec<Value>> {
    let mut issues = Vec::new();
    for name in DATE_FIELDS {
        let Some(v) = vals.get_mut(name) else {
            continue;
        };
        match v.as_str() {
            None | Some("") => *v = Value::Null,
            Some(s) => match js_date(s) {
                Some(iso) => *v = Value::String(iso),
                None => issues.push(issue(name, "Date invalide")),
            },
        }
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

/// Comparison key of a project name: trimmed, [`fold`]ed (NFC, Unicode
/// lower case), then without diacritics.
/// arkyo-server: arkyo compares with Postgres `mode: "insensitive"` (case
/// only); accents are ignored too here (phase decision : « Régie Nord » and
/// « regie nord » are the same name).
pub(crate) fn name_key(s: &str) -> String {
    use unicode_normalization::char::is_combining_mark;
    use unicode_normalization::UnicodeNormalization;
    fold(s.trim())
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .nfc()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_like_javascript() {
        assert_eq!(
            js_date("2026-11-10").as_deref(),
            Some("2026-11-10T00:00:00.000Z")
        );
        assert_eq!(
            js_date("2026-11-10T08:30:00.123Z").as_deref(),
            Some("2026-11-10T08:30:00.123Z")
        );
        assert_eq!(
            js_date("2026-11-10T10:00:00+02:00").as_deref(),
            Some("2026-11-10T08:00:00.000Z")
        );
        assert!(js_date("2026-11-10T10:00").is_some());
        assert_eq!(js_date("demain"), None);
        assert_eq!(js_date("2026-13-01"), None);
    }

    #[test]
    fn names_fold_case_and_accents() {
        assert_eq!(name_key("  Régie Nord "), "regie nord");
        assert_eq!(name_key("RÉGIE NORD"), "regie nord");
        assert_eq!(name_key("Re\u{301}gie"), "regie");
        assert_ne!(name_key("Régie Sud"), name_key("Régie Nord"));
    }
}
