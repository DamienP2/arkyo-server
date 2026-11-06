//! arkyo:app/api/tenant/projects/[id]/racks/route.ts (`POST`): adds blank
//! containers, or clones a template rig's racks (`fromTemplateId`), to the
//! project's rig.
//!
//! Validation errors use arkyo's `{ error: "Validation invalide", issues }`.

use std::collections::BTreeMap;

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use super::super::parametres::{
    begin, bind, db_error, js_type, parse_body, str_of, validate_flat, Def, Field, Kind, Obj,
};
use super::super::{error, require, AppState, CurrentUser};
use super::{invalid, link_rack, next_position, project_rig, project_row};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::inventory::clone::{clone_rack_into, CloneScope, CloneTarget};
use crate::projects::naming::ensure_unique_rack_name;

const RACK_TYPES: &[&str] = &[
    "STANDARD",
    "FLIGHT_CASE_CLASSIC",
    "FLIGHT_CASE_SKB",
    "PELICAN",
    "CAP",
];
const RACK_TYPE_MSG: &str = r#"Invalid option: expected one of "STANDARD"|"FLIGHT_CASE_CLASSIC"|"FLIGHT_CASE_SKB"|"PELICAN"|"CAP""#;

/// `rackItemSchema` (route.ts:12-31).
static ITEM: [Field; 12] = [
    Field::new("name", Kind::NonEmpty).required(),
    Field::new("locationId", Kind::NonEmpty).required(),
    Field::new("rackType", Kind::Enum(RACK_TYPES, RACK_TYPE_MSG)).or(Def::Str("STANDARD")),
    Field::new("isRackable", Kind::Bool),
    Field::new("totalU", Kind::IntRange(1, 56)),
    Field::new("depthMm", Kind::IntPos),
    Field::new("widthMm", Kind::IntPos),
    Field::new("heightMm", Kind::IntPos),
    Field::new("hasWheels", Kind::Bool),
    Field::new("emptyWeightKg", Kind::NumNonNeg).nullable(),
    Field::new("rearInteriorGapMm", Kind::IntPos).nullable(),
    Field::new("fromTemplateId", Kind::Str),
];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

fn path_issue(path: Value, message: &str) -> Value {
    json!({ "path": path, "message": message })
}

/// `bodySchema.safeParse(body)` (`{ racks: rackItemSchema[] }`, min 1),
/// with `zodIssuesFromError`'s paths (`["racks", 1, "name"]`). Returns the
/// items with the `rackType` default applied.
fn parse(body: &Value) -> Result<Vec<Obj>, Vec<Value>> {
    let Value::Object(obj) = body else {
        return Err(vec![path_issue(
            json!(["root"]),
            &format!(
                "Invalid input: expected object, received {}",
                js_type(Some(body))
            ),
        )]);
    };
    let items = match obj.get("racks") {
        Some(Value::Array(items)) => items,
        other => {
            return Err(vec![path_issue(
                json!(["racks"]),
                &format!("Invalid input: expected array, received {}", js_type(other)),
            )])
        }
    };
    if items.is_empty() {
        return Err(vec![path_issue(
            json!(["racks"]),
            "Too small: expected array to have >=1 items",
        )]);
    }
    let mut issues = Vec::new();
    let mut out = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        if !item.is_object() {
            issues.push(path_issue(
                json!(["racks", i]),
                &format!(
                    "Invalid input: expected object, received {}",
                    js_type(Some(item))
                ),
            ));
            continue;
        }
        match validate_flat(item, &ITEM) {
            Ok(mut vals) => {
                for f in &ITEM {
                    if !vals.contains_key(f.name) && !matches!(f.default, Def::Null) {
                        vals.insert(f.name.into(), f.default.value());
                    }
                }
                out.push(vals);
            }
            Err((_, by_field)) => issues.extend(item_issues(i, &by_field)),
        }
    }
    if issues.is_empty() {
        Ok(out)
    } else {
        Err(issues)
    }
}

/// The issues of item `i`, in the schema's field order.
fn item_issues(i: usize, by_field: &BTreeMap<String, Vec<String>>) -> Vec<Value> {
    ITEM.iter()
        .flat_map(|f| {
            by_field
                .get(f.name)
                .into_iter()
                .flatten()
                .map(move |m| path_issue(json!(["racks", i, f.name]), m))
        })
        .collect()
}

/// `{ id, name, rackType }` of a created rack (response and audit).
fn summary(id: &str, name: &str, rack_type: &str) -> Value {
    json!({ "id": id, "name": name, "rackType": rack_type })
}

// ── POST /api/tenant/projects/:id/racks ─────────────────────────────────────

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    create_inner(&st, &me, &id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn create_inner(
    st: &AppState,
    me: &crate::users::User,
    project_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let items =
        parse(&parse_body(&body)?).map_err(|issues| invalid(StatusCode::BAD_REQUEST, issues))?;

    // arkyo-server: une seule transaction ; arkyo écrivait rack par rack, si
    // bien qu'un « Template introuvable » laissait en base les contenants
    // déjà créés et la régie. Ici, toute erreur annule la requête entière.
    let mut tx = begin(&st.pool).await?;
    let project = project_row(&mut tx, project_id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;

    // Every referenced location belongs to the project (route.ts:66-75).
    let mut location_ids: Vec<&str> = items
        .iter()
        .filter_map(|it| str_of(it, "locationId"))
        .collect();
    location_ids.sort_unstable();
    location_ids.dedup();
    let sql = format!(
        r#"SELECT COUNT(*) FROM "Location" WHERE "projectId" = ? AND "id" IN ({})"#,
        vec!["?"; location_ids.len()].join(", ")
    );
    let mut q = sqlx::query_scalar::<_, i64>(&sql).bind(project_id);
    for l in &location_ids {
        q = q.bind(*l);
    }
    let found = q.fetch_one(&mut *tx).await.map_err(db_error)?;
    if found != location_ids.len() as i64 {
        return Err(error(StatusCode::BAD_REQUEST, "Emplacement introuvable"));
    }

    let rig_id = project_rig(&mut tx, &project, &me.id)
        .await
        .map_err(db_error)?;
    let mut position = next_position(&mut tx, &rig_id).await.map_err(db_error)?;

    let mut created: Vec<Value> = Vec::new();
    for item in &items {
        let name = str_of(item, "name").unwrap_or_default();
        let location_id = str_of(item, "locationId").unwrap_or_default();
        if let Some(template_id) = str_of(item, "fromTemplateId").filter(|t| !t.is_empty()) {
            let is_template: Option<String> = sqlx::query_scalar(
                r#"SELECT "id" FROM "RigConfig" WHERE "id" = ? AND "isTemplate" = 1"#,
            )
            .bind(template_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
            if is_template.is_none() {
                return Err(error(
                    StatusCode::NOT_FOUND,
                    &format!("Template introuvable : {template_id}"),
                ));
            }
            let sources: Vec<String> = sqlx::query_scalar(
                r#"SELECT "rackId" FROM "RigRack" WHERE "rigConfigId" = ? ORDER BY "position", "id""#,
            )
            .bind(template_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_error)?;
            for src in &sources {
                // `name || srcRack.name` (name is min(1), so always the body's).
                let base = if name.is_empty() {
                    sqlx::query_scalar(r#"SELECT "name" FROM "Rack" WHERE "id" = ?"#)
                        .bind(src)
                        .fetch_one(&mut *tx)
                        .await
                        .map_err(db_error)?
                } else {
                    name.to_string()
                };
                let unique = ensure_unique_rack_name(&mut tx, Some(project_id), &base)
                    .await
                    .map_err(db_error)?;
                // The inline copy of route.ts:150-218 (slots, inventory
                // derived from them), shared with `cloneRackInto`.
                let rack = clone_rack_into(
                    &mut tx,
                    src,
                    CloneTarget {
                        name: &unique,
                        location_id: Some(location_id),
                        scope: CloneScope::SlotsOnly,
                    },
                )
                .await
                .map_err(db_error)?;
                link_rack(&mut tx, &rig_id, &rack.id, position)
                    .await
                    .map_err(db_error)?;
                position += 1;
                created.push(summary(&rack.id, &rack.name, &rack.rack_type));
            }
            continue;
        }

        let unique = ensure_unique_rack_name(&mut tx, Some(project_id), name)
            .await
            .map_err(db_error)?;
        let id = new_id();
        let now = now_iso();
        let rack_type = str_of(item, "rackType").unwrap_or("STANDARD").to_string();
        let opt = |k: &str| item.get(k).cloned().unwrap_or(Value::Null);
        let mut q = sqlx::query(
            r#"INSERT INTO "Rack" ("id","name","rackType","isRackable","totalU","depthMm","widthMm",
                   "heightMm","hasWheels","emptyWeightKg","rearInteriorGapMm","locationId","createdAt","updatedAt")
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"#,
        )
        .bind(&id)
        .bind(&unique)
        .bind(&rack_type);
        for v in [
            item.get("isRackable").cloned().unwrap_or(Value::Bool(true)),
            item.get("totalU").cloned().unwrap_or(Value::from(42)),
            item.get("depthMm").cloned().unwrap_or(Value::from(600)),
            opt("widthMm"),
            opt("heightMm"),
            item.get("hasWheels").cloned().unwrap_or(Value::Bool(false)),
            opt("emptyWeightKg"),
            opt("rearInteriorGapMm"),
        ] {
            q = bind(q, &v);
        }
        q.bind(location_id)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        link_rack(&mut tx, &rig_id, &id, position)
            .await
            .map_err(db_error)?;
        position += 1;
        created.push(summary(&id, &unique, &rack_type));
    }

    audit::log(
        &mut tx,
        &me.id,
        "add_rack",
        "Project",
        project_id,
        Some(project_id),
        None,
        Some(json!({ "racks": created })),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish_meta(
        "rig",
        "updated",
        Some(&rig_id),
        EventMeta {
            project_id: Some(project_id.to_string()),
            ..EventMeta::default()
        },
    );
    Ok((
        StatusCode::CREATED,
        Json(json!({ "rigConfigId": rig_id, "racks": created })),
    )
        .into_response())
}
