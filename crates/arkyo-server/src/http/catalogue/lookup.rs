//! arkyo:app/api/tenant/catalogue/lookup/route.ts (GET and POST).

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use super::connectors::{derive_d, function_ids};
use crate::catalogue::enrich::{
    enrich_equipment, personal_flags, Refs, ADAPTER, BRAND, CABLE_MODEL, CATEGORY, CONNECTOR_TYPE,
    EQUIPMENT, FUNCTION, PHASE, SIGNAL, TYPE,
};
use crate::http::parametres::connectors::load_symbols;
use crate::http::parametres::{
    db_error, flat_json, list_rows, objs, str_of, validate_flat, Field, Kind, Obj, Table,
};
use crate::http::{AppState, CurrentUser};

const ACTIVE: &str = r#"WHERE "isActive" = 1"#;

/// `GET`: the referentials the catalogue editors need.
pub async fn get(State(st): State<AppState>, _u: CurrentUser) -> Response {
    match referentials(&st).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_error(e),
    }
}

async fn referentials(st: &AppState) -> Result<Value, sqlx::Error> {
    let pool = &st.pool;
    let by_name = r#""name" COLLATE NOCASE"#;
    let cats = list_rows(pool, &CATEGORY, ACTIVE, by_name).await?;
    // One level of children, like `include: { children }`.
    let categories: Vec<Value> = cats
        .iter()
        .filter(|c| c.get("parentId").is_none_or(Value::is_null))
        .map(|r| {
            let mut r = r.clone();
            let id = str_of(&r, "id").unwrap_or("").to_string();
            let children: Vec<Value> = cats
                .iter()
                .filter(|c| str_of(c, "parentId") == Some(id.as_str()))
                .map(|c| Value::Object(c.clone()))
                .collect();
            r.insert("children".into(), Value::Array(children));
            Value::Object(r)
        })
        .collect();
    let brands = list_rows(pool, &BRAND, ACTIVE, by_name).await?;

    // Connector types: shape shared with arkyo's merged list.
    let mut conn = pool.acquire().await?;
    let symbols = load_symbols(&mut conn).await?;
    drop(conn);
    let mut connectors = list_rows(pool, &CONNECTOR_TYPE, ACTIVE, by_name).await?;
    for c in &mut connectors {
        let functions: Vec<Value> = function_ids(c)
            .into_iter()
            .map(|id| json!({ "functionId": id }))
            .collect();
        c.insert("functions".into(), Value::Array(functions));
        c.insert("source".into(), "PERSONAL".into());
        derive_d(c, &symbols);
    }

    let signals = list_rows(
        pool,
        &SIGNAL,
        ACTIVE,
        r#""sortOrder", "name" COLLATE NOCASE"#,
    )
    .await?;
    let functions = list_rows(
        pool,
        &FUNCTION,
        ACTIVE,
        r#""sortOrder", "label" COLLATE NOCASE"#,
    )
    .await?;
    let phases = list_rows(
        pool,
        &PHASE,
        ACTIVE,
        r#""sortOrder", "label" COLLATE NOCASE"#,
    )
    .await?;

    // Flat `{ id, name, functionId, parentId, source }`.
    let types: Vec<Value> = list_rows(
        pool,
        &TYPE,
        ACTIVE,
        r#""functionId", "sortOrder", "name" COLLATE NOCASE"#,
    )
    .await?
    .iter()
    .map(|t| {
        json!({
            "id": t.get("id"), "name": t.get("name"), "functionId": t.get("functionId"),
            "parentId": t.get("parentId"), "source": "PERSONAL",
        })
    })
    .collect();

    let refs = Refs::load(pool).await?;
    let cable_models: Vec<Value> = list_rows(
        pool,
        &CABLE_MODEL,
        ACTIVE,
        r#""sortOrder", "name" COLLATE NOCASE"#,
    )
    .await?
    .iter()
    .map(|m| {
        let brand = str_of(m, "brandId").and_then(|b| refs.brand_name(b));
        let mut o = json!({
            "id": m.get("id"), "name": m.get("name"), "reference": m.get("reference"),
            "source": "PERSONAL", "brandName": brand,
        });
        for k in [
            "functionId",
            "brandId",
            "impedance",
            "bandwidthMHz",
            "diameterMm",
            "conductor",
            "shielding",
            "jacketMaterial",
            "fireRating",
            "imageUrl",
        ] {
            o[k] = m.get(k).cloned().unwrap_or(Value::Null);
        }
        o
    })
    .collect();

    Ok(json!({
        "categories": categories,
        "brands": objs(brands),
        "connectorTypes": objs(connectors),
        "signals": objs(signals),
        "functions": objs(functions),
        "phases": objs(phases),
        "types": types,
        "cableModels": cable_models,
    }))
}

static BODY: [Field; 2] = [
    Field::new(
        "kind",
        Kind::Enum(
            &["equipment", "adapter", "connector"],
            "Invalid option: expected one of \"equipment\"|\"adapter\"|\"connector\"",
        ),
    )
    .required(),
    Field::new("ids", Kind::IdArr { min: 1, max: 200 }).required(),
];

/// `POST {kind, ids}`: batch lookup by ids, in the order asked.
pub async fn post(State(st): State<AppState>, _u: CurrentUser, body: Bytes) -> Response {
    let parsed: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let vals = match validate_flat(&parsed, &BODY) {
        Ok(v) => v,
        Err(flat) => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Validation invalide", "issues": flat_json(&flat) })),
            )
                .into_response()
        }
    };
    let kind = str_of(&vals, "kind").unwrap_or("").to_string();
    let ids: Vec<String> = vals["ids"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    match items(&st, &kind, &ids).await {
        Ok(items) => Json(json!({ "kind": kind, "items": items })).into_response(),
        Err(e) => db_error(e),
    }
}

/// Rows of `t` whose id is in `ids`, in the order of `ids`.
async fn by_ids(st: &AppState, t: &Table, ids: &[String]) -> Result<Vec<Obj>, sqlx::Error> {
    let rows = list_rows(&st.pool, t, "", r#""id""#).await?;
    let mut map: HashMap<String, Obj> = rows
        .into_iter()
        .filter_map(|r| Some((str_of(&r, "id")?.to_string(), r)))
        .collect();
    Ok(ids.iter().filter_map(|i| map.remove(i)).collect())
}

async fn items(st: &AppState, kind: &str, ids: &[String]) -> Result<Vec<Value>, sqlx::Error> {
    let mut rows = match kind {
        "equipment" => {
            let refs = Refs::load(&st.pool).await?;
            let mut rows = by_ids(st, &EQUIPMENT, ids).await?;
            for r in &mut rows {
                enrich_equipment(r, &refs, false);
                // TenantEquipment has no legacy `category` text.
                r.insert("category".into(), Value::Null);
            }
            rows
        }
        "adapter" => {
            let mut rows = by_ids(st, &ADAPTER, ids).await?;
            rows.iter_mut().for_each(personal_flags);
            rows
        }
        _ => by_ids(st, &CONNECTOR_TYPE, ids).await?,
    };
    Ok(rows.drain(..).map(Value::Object).collect())
}
