//! arkyo:app/api/projects/route.ts (`GET`, `POST`), read by the dashboard.
//!
//! Validation errors use Zod's `{ error: flatten() }`, as arkyo.

use std::collections::{BTreeMap, HashMap};

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use super::super::parametres::{
    begin, db_error, failure, get_row, parse_body, row_map, validate_flat, Field, Kind,
};
use super::super::{require, server_error, AppState, CurrentUser};
use super::tenant::insert_project;
use super::{convert_dates, project_row, PROJECT, PROJECT_COLS, TECHNICAL_SHEET};
use crate::audit;

/// `createSchema` (route.ts:7-14).
static CREATE: [Field; 6] = [
    Field::new("name", Kind::NonEmpty).required(),
    Field::new("clientName", Kind::Str),
    Field::new("shootingDate", Kind::Str),
    Field::new("location", Kind::Str),
    Field::new("description", Kind::Str),
    Field::new("prestationType", Kind::Str),
];

/// Session only. Every project (updatedAt desc) with
/// `technicalSheet { completionPercent }` and `_count { tasks }`.
///
/// `?stats=tasks` answers the dashboard's `task.groupBy({ by: ["status"],
/// _count: true })` instead: `[{ status, _count }]`.
pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    // arkyo-server: données de la page serveur d'arkyo (taskStats du
    // tableau de bord, app/(app)/dashboard/page.tsx:82).
    if q.get("stats").map(String::as_str) == Some("tasks") {
        let rows: Result<Vec<(String, i64)>, _> =
            sqlx::query_as(r#"SELECT "status", COUNT(*) FROM "Task" GROUP BY "status""#)
                .fetch_all(&st.pool)
                .await;
        return match rows {
            Ok(rows) => Json(Value::Array(
                rows.into_iter()
                    .map(|(status, n)| json!({ "status": status, "_count": n }))
                    .collect(),
            ))
            .into_response(),
            Err(e) => db_error(e),
        };
    }

    let cols = PROJECT_COLS
        .split(',')
        .map(|c| format!("p.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = sqlx::query(&format!(
        r#"SELECT {cols},
               s."completionPercent" AS "sheetCompletion", s."id" AS "sheetId",
               (SELECT COUNT(*) FROM "Task" t WHERE t."projectId" = p."id") AS "taskCount"
           FROM "Project" p LEFT JOIN "TechnicalSheet" s ON s."projectId" = p."id"
           ORDER BY p."updatedAt" DESC"#
    ))
    .fetch_all(&st.pool)
    .await;
    let rows = match rows {
        Ok(r) => r,
        Err(e) => return db_error(e),
    };
    let projects: Vec<Value> = rows
        .iter()
        .map(|r| {
            let mut m = row_map(r, &PROJECT);
            // The value row_map already decoded (no panicking accessor).
            let completion = m.remove("sheetCompletion").unwrap_or(Value::Null);
            let sheet = m
                .remove("sheetId")
                .filter(|v| !v.is_null())
                .map(|_| json!({ "completionPercent": completion }));
            let tasks = m.remove("taskCount").unwrap_or(Value::from(0));
            m.insert("technicalSheet".into(), sheet.unwrap_or(Value::Null));
            m.insert("_count".into(), json!({ "tasks": tasks }));
            Value::Object(m)
        })
        .collect();
    Json(Value::Array(projects)).into_response()
}

/// Creates a project and its sheet; answers `201` with the project and its
/// `technicalSheet`. No duplicate name check (arkyo has none here).
pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Bytes,
) -> Response {
    create_inner(&st, &me, body).await.unwrap_or_else(|r| r)
}

async fn create_inner(
    st: &AppState,
    me: &crate::users::User,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut vals = validate_flat(&parse_body(&body)?, &CREATE).map_err(failure)?;
    // arkyo-server: une date illisible faisait échouer Prisma (500).
    if convert_dates(&mut vals).is_err() {
        let mut fields = BTreeMap::new();
        fields.insert(
            "shootingDate".to_string(),
            vec!["Date invalide".to_string()],
        );
        return Err(failure((vec![], fields)));
    }

    let mut tx = begin(&st.pool).await?;
    let id = insert_project(&mut tx, &me.id, &vals)
        .await
        .map_err(db_error)?;
    let mut project = project_row(&mut tx, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    let sheet: Option<String> =
        sqlx::query_scalar(r#"SELECT "id" FROM "TechnicalSheet" WHERE "projectId" = ?"#)
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
    let sheet = match sheet {
        Some(sid) => get_row(&mut tx, &TECHNICAL_SHEET, &sid)
            .await
            .map_err(db_error)?
            .map_or(Value::Null, Value::Object),
        None => Value::Null,
    };
    project.insert("technicalSheet".into(), sheet);
    audit::log(
        &mut tx,
        &me.id,
        "project.create",
        "Project",
        &id,
        Some(&id),
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish("project", "created", Some(&id));
    Ok((StatusCode::CREATED, Json(Value::Object(project))).into_response())
}
