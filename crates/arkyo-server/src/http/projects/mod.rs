//! Projects: arkyo:app/api/tenant/projects/** ([`tenant`], [`locations`],
//! [`racks`], [`inventory`]) and arkyo:app/api/projects/route.ts ([`legacy`]).
//!
//! Shared here: the `Project` row as Prisma returns it, arkyo's
//! `{ error: "Validation invalide", issues }` envelope (`zodIssuesFromError`),
//! the `new Date(string)` conversion of the date fields and the duplicate
//! name key.

#![allow(clippy::result_large_err)]

mod inventory;
mod legacy;
mod locations;
mod racks;
mod tenant;

use std::collections::BTreeMap;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::{fold, row_map, str_of, Field, Obj, Table};
use super::AppState;
use crate::ids::{new_id, now_iso};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tenant/projects", get(tenant::list).post(tenant::create))
        .route(
            "/tenant/projects/{id}",
            get(tenant::get)
                .patch(tenant::update)
                .delete(tenant::remove),
        )
        .route(
            "/tenant/projects/{id}/locations",
            get(locations::list).post(locations::create),
        )
        .route("/tenant/projects/{id}/racks", post(racks::create))
        .route(
            "/tenant/projects/{id}/racks/{rack_id}/inventory",
            get(inventory::list).post(inventory::create),
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

/// The project's rig: its first `RigConfig` (`rigConfigs: { take: 1 }`),
/// created when missing as `"<name> — Régie principale"`, of the project's
/// `rigType` (or `FLIGHT_CASE`), by `user_id` (locations/route.ts:111-122,
/// racks/route.ts:78-88).
pub(crate) async fn project_rig(
    conn: &mut SqliteConnection,
    project: &Obj,
    user_id: &str,
) -> Result<String, sqlx::Error> {
    let project_id = str_of(project, "id").unwrap_or_default();
    let existing: Option<String> = sqlx::query_scalar(
        r#"SELECT "id" FROM "RigConfig" WHERE "projectId" = ? ORDER BY "createdAt", "id" LIMIT 1"#,
    )
    .bind(project_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = new_id();
    let now = now_iso();
    sqlx::query(
        r#"INSERT INTO "RigConfig" ("id","name","type","projectId","createdById","createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?)"#,
    )
    .bind(&id)
    .bind(format!(
        "{} — Régie principale",
        str_of(project, "name").unwrap_or_default()
    ))
    .bind(str_of(project, "rigType").unwrap_or("FLIGHT_CASE"))
    .bind(project_id)
    .bind(user_id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *conn)
    .await?;
    Ok(id)
}

/// `assertRackBelongsToProject(db, rackId, projectId)`: the rack is linked
/// to a rig of the project (`rigs.some.rigConfig.projectId`).
pub(crate) async fn rack_in_project(
    conn: &mut SqliteConnection,
    rack_id: &str,
    project_id: &str,
) -> Result<bool, sqlx::Error> {
    let found: Option<i64> = sqlx::query_scalar(
        r#"SELECT 1 FROM "RigRack" rr JOIN "RigConfig" rc ON rc."id" = rr."rigConfigId"
           WHERE rr."rackId" = ? AND rc."projectId" = ? LIMIT 1"#,
    )
    .bind(rack_id)
    .bind(project_id)
    .fetch_optional(conn)
    .await?;
    Ok(found.is_some())
}

/// The position after the last `RigRack` of `rig_id` (0 for an empty rig).
pub(crate) async fn next_position(
    conn: &mut SqliteConnection,
    rig_id: &str,
) -> Result<i64, sqlx::Error> {
    let last: Option<i64> =
        sqlx::query_scalar(r#"SELECT MAX("position") FROM "RigRack" WHERE "rigConfigId" = ?"#)
            .bind(rig_id)
            .fetch_one(conn)
            .await?;
    Ok(last.map_or(0, |p| p + 1))
}

/// Links `rack_id` to `rig_id` at `position`.
pub(crate) async fn link_rack(
    conn: &mut SqliteConnection,
    rig_id: &str,
    rack_id: &str,
    position: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES (?,?,?,?)"#,
    )
    .bind(new_id())
    .bind(rig_id)
    .bind(rack_id)
    .bind(position)
    .execute(conn)
    .await?;
    Ok(())
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
