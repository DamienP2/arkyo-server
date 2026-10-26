//! Notifications of the current user (same shapes as arkyo's `/api/notifications/**`).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{error, server_error, AppState, CurrentUser};
use crate::ids::now_iso;

#[derive(Deserialize)]
pub struct ListQuery {
    page: Option<String>,
    limit: Option<String>,
    unread: Option<String>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: String,
    #[sqlx(rename = "recipientId")]
    recipient_id: String,
    r#type: String,
    title: String,
    message: Option<String>,
    data: Option<String>,
    #[sqlx(rename = "readAt")]
    read_at: Option<String>,
    #[sqlx(rename = "createdAt")]
    created_at: String,
}

impl Row {
    fn json(self) -> Value {
        let data = self
            .data
            .and_then(|d| serde_json::from_str::<Value>(&d).ok())
            .unwrap_or(Value::Null);
        json!({
            "id": self.id, "recipientId": self.recipient_id, "type": self.r#type,
            "title": self.title, "message": self.message, "data": data,
            "readAt": self.read_at, "createdAt": self.created_at,
        })
    }
}

async fn count_of(st: &AppState, user: &str, unread_only: bool) -> i64 {
    let sql = if unread_only {
        r#"SELECT COUNT(*) FROM "Notification" WHERE "recipientId" = ? AND "readAt" IS NULL"#
    } else {
        r#"SELECT COUNT(*) FROM "Notification" WHERE "recipientId" = ?"#
    };
    sqlx::query_scalar(sql)
        .bind(user)
        .fetch_one(&st.pool)
        .await
        .unwrap_or(0)
}

pub async fn list(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Query(q): Query<ListQuery>,
) -> Response {
    let page = q
        .page
        .and_then(|p| p.parse::<i64>().ok())
        .unwrap_or(1)
        .max(1);
    let limit = q
        .limit
        .and_then(|p| p.parse::<i64>().ok())
        .unwrap_or(20)
        .clamp(1, 50);
    let unread_only = q.unread.as_deref() == Some("true");
    let filter = if unread_only {
        r#" AND "readAt" IS NULL"#
    } else {
        ""
    };
    let rows: Result<Vec<Row>, _> = sqlx::query_as(&format!(
        r#"SELECT "id","recipientId","type","title","message","data","readAt","createdAt"
           FROM "Notification" WHERE "recipientId" = ?{filter}
           ORDER BY "readAt" IS NOT NULL, "readAt" ASC, "createdAt" DESC LIMIT ? OFFSET ?"#
    ))
    .bind(&u.id)
    .bind(limit)
    .bind((page - 1) * limit)
    .fetch_all(&st.pool)
    .await;
    let Ok(rows) = rows else {
        return server_error();
    };
    let total = count_of(&st, &u.id, false).await;
    let unread = count_of(&st, &u.id, true).await;
    Json(json!({
        "items": rows.into_iter().map(Row::json).collect::<Vec<_>>(),
        "count": unread,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) / limit,
    }))
    .into_response()
}

pub async fn count(State(st): State<AppState>, user: Result<CurrentUser, Response>) -> Json<Value> {
    match user {
        Ok(CurrentUser(u)) => Json(json!({ "count": count_of(&st, &u.id, true).await })),
        Err(_) => Json(json!({ "count": 0 })),
    }
}

#[derive(Deserialize)]
pub struct ActionBody {
    action: Option<String>,
}

pub async fn patch_all(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Result<Json<ActionBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let action = body.ok().and_then(|b| b.0.action);
    if action.as_deref() != Some("read-all") {
        return error(StatusCode::BAD_REQUEST, "Action inconnue");
    }
    let r = sqlx::query(
        r#"UPDATE "Notification" SET "readAt" = ? WHERE "recipientId" = ? AND "readAt" IS NULL"#,
    )
    .bind(now_iso())
    .bind(&u.id)
    .execute(&st.pool)
    .await;
    match r {
        Ok(_) => Json(json!({ "ok": true })).into_response(),
        Err(_) => server_error(),
    }
}

pub async fn mark_read(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let r = sqlx::query(
        r#"UPDATE "Notification" SET "readAt" = COALESCE("readAt", ?) WHERE "id" = ? AND "recipientId" = ?"#,
    )
    .bind(now_iso())
    .bind(&id)
    .bind(&u.id)
    .execute(&st.pool)
    .await;
    match r {
        Ok(r) if r.rows_affected() > 0 => Json(json!({ "ok": true })).into_response(),
        Ok(_) => error(StatusCode::NOT_FOUND, "Notification introuvable"),
        Err(_) => server_error(),
    }
}

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let r = sqlx::query(r#"DELETE FROM "Notification" WHERE "id" = ? AND "recipientId" = ?"#)
        .bind(&id)
        .bind(&u.id)
        .execute(&st.pool)
        .await;
    match r {
        Ok(_) => Json(json!({ "ok": true })).into_response(),
        Err(_) => server_error(),
    }
}
