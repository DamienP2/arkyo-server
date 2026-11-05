//! arkyo:app/api/tenant/catalogue/connectors/route.ts (GET) with
//! arkyo:app/api/_lib/connector-dtype.ts (`hasNeutrikD`, `dTypeSvgUrl`).

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use crate::catalogue::enrich::{Refs, CONNECTOR_TYPE};
use crate::http::parametres::connectors::{d_type_svg_url, has_neutrik_d, load_symbols, Symbol};
use crate::http::parametres::{db_error, fold, list_rows, str_of, Obj};
use crate::http::{AppState, CurrentUser};

/// Adds the derived `hasNeutrikD` and `dTypeSvgUrl` (never stored).
pub fn derive_d(row: &mut Obj, symbols: &[Symbol]) {
    let (icon, svg) = (str_of(row, "iconId"), str_of(row, "svgUrl"));
    let d = has_neutrik_d(icon, svg, symbols);
    let url = d_type_svg_url(icon, svg, symbols);
    row.insert("hasNeutrikD".into(), Value::Bool(d));
    row.insert("dTypeSvgUrl".into(), url.map_or(Value::Null, Value::String));
}

/// Ids of the `functionIds` JSON array.
pub fn function_ids(row: &Obj) -> Vec<String> {
    row.get("functionIds")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// `GET /connectors?q=&ids=`: a bare array, each item with
/// `functions: [{functionId, function}]` and the derived fields.
pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let run = async {
        let ids: Vec<&str> = q
            .get("ids")
            .map(|s| s.split(',').filter(|x| !x.is_empty()).collect())
            .unwrap_or_default();
        let by_ids = q.contains_key("ids") && !q["ids"].is_empty();
        let mut conn = st.pool.acquire().await?;
        let symbols = load_symbols(&mut conn).await?;
        drop(conn);
        let refs = Refs::load(&st.pool).await?;
        let filter = if by_ids {
            ""
        } else {
            r#"WHERE "isActive" = 1"#
        };
        let mut rows =
            list_rows(&st.pool, CONNECTOR_TYPE, filter, r#""name" COLLATE NOCASE"#).await?;
        if by_ids {
            rows.retain(|r| str_of(r, "id").is_some_and(|i| ids.contains(&i)));
        } else if let Some(needle) = q.get("q").filter(|s| !s.is_empty()) {
            let n = fold(needle);
            rows.retain(|r| fold(str_of(r, "name").unwrap_or("")).contains(&n));
        }
        for r in &mut rows {
            let functions: Vec<Value> = function_ids(r)
                .into_iter()
                .filter_map(|id| {
                    let f = refs.function(&id)?;
                    Some(json!({ "functionId": id, "function": f }))
                })
                .collect();
            r.insert("functions".into(), Value::Array(functions));
            derive_d(r, &symbols);
        }
        Ok::<_, sqlx::Error>(rows)
    };
    match run.await {
        Ok(rows) => {
            Json(Value::Array(rows.into_iter().map(Value::Object).collect())).into_response()
        }
        Err(e) => db_error(e),
    }
}
