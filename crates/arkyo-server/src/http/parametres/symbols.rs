//! arkyo:app/api/tenant/parametres/symbols/route.ts and
//! arkyo:app/api/symbol-overrides/route.ts
//!
//! Bare array of `SymbolItem` read from `CatalogSymbol`: a built-in symbol is
//! drawn by code (`svgUrl` = its key, `svgUrlD` null), a custom one by image.

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Extension;
use axum::Json;
use serde_json::{json, Value};
use sqlx::Row;

use super::connectors::D_TYPE_KEYS;
use super::db_error;
use crate::http::{AppState, CurrentUser, Resolved};

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

/// GET /api/symbol-overrides: the built-in symbols whose drawing is replaced
/// by an uploaded SVG, `{ [key]: { svg, svgD } }`, for the icon store of
/// `connector-icon.tsx`. Any session; without one, `{}` (code drawing).
/// A built-in row stores `svgUrl` null (the symbols list substitutes the
/// key): a value equal to the key is that placeholder, not an override.
/// `(key, svg, svgD)` of an overridden built-in symbol.
type Override = (String, Option<String>, Option<String>);

pub async fn overrides(
    State(st): State<AppState>,
    session: Option<Extension<Resolved>>,
) -> Response {
    if session.is_none() {
        return Json(json!({})).into_response();
    }
    let rows: Result<Vec<Override>, _> = sqlx::query_as(
        r#"SELECT "key", NULLIF("svgUrl", "key"), NULLIF("svgUrlD", "key") FROM "CatalogSymbol"
           WHERE "isBuiltin" = 1
             AND (NULLIF("svgUrl", "key") IS NOT NULL OR NULLIF("svgUrlD", "key") IS NOT NULL)"#,
    )
    .fetch_all(&st.pool)
    .await;
    match rows {
        Ok(rows) => {
            let map: serde_json::Map<String, Value> = rows
                .into_iter()
                .map(|(key, svg, svg_d)| (key, json!({ "svg": svg, "svgD": svg_d })))
                .collect();
            Json(Value::Object(map)).into_response()
        }
        Err(e) => db_error(e),
    }
}
