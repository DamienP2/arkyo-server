//! arkyo:app/api/tenant/parametres/symbols/route.ts
//!
//! Bare array of `SymbolItem` read from `CatalogSymbol`: a built-in symbol is
//! drawn by code (`svgUrl` = its key, `svgUrlD` null), a custom one by image.

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::Row;

use super::connectors::D_TYPE_KEYS;
use super::db_error;
use crate::http::{AppState, CurrentUser};

pub async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let rows = sqlx::query(
        r#"SELECT "key","label","isBuiltin","svgUrl","svgUrlD" FROM "CatalogSymbol"
           ORDER BY "sortOrder", "label" COLLATE NOCASE"#,
    )
    .fetch_all(&st.pool)
    .await;
    match rows {
        Ok(rows) => {
            let items: Vec<Value> = rows
                .iter()
                .map(|r| {
                    let key: String = r.get("key");
                    let builtin = r.get::<i64, _>("isBuiltin") != 0;
                    let svg_url: Option<String> = r.get("svgUrl");
                    let svg_url_d: Option<String> = r.get("svgUrlD");
                    json!({
                        "id": key,
                        "label": r.get::<String, _>("label"),
                        "svgUrl": if builtin { key.clone() } else { svg_url.unwrap_or_default() },
                        "isBuiltin": builtin,
                        "hasD": svg_url_d.is_some() || (builtin && D_TYPE_KEYS.contains(&key.as_str())),
                        "svgUrlD": if builtin { None } else { svg_url_d },
                    })
                })
                .collect();
            Json(items).into_response()
        }
        Err(e) => db_error(e),
    }
}
