//! Presence stubs until phase 7.

use axum::Json;
use serde_json::{json, Value};

use super::CurrentUser;

pub async fn get(_: CurrentUser) -> Json<Value> {
    Json(json!({ "members": [] }))
}

pub async fn post(_: CurrentUser) -> Json<Value> {
    Json(json!({ "ok": true }))
}
