//! arkyo:app/api/tenant/parametres/cabling/{route,[id]/route}.ts and
//! arkyo:app/api/tenant/parametres/cable-models/route.ts (cable model
//! picker scored by signal compatibility).

use std::collections::HashMap;

use arkyo_core::permissions::Domain;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};

use super::{
    arkyo_personal, db_error, fold, list_rows, row_map, str_of, Def, Field, Fut, Hooks, Kind,
    NoHooks, Obj, Res, Table, NAME,
};
use crate::http::parametres::conflict;
use crate::http::{AppState, CurrentUser};

static CREATE: [Field; 17] = [
    Field::new("name", NAME).required(),
    Field::new("reference", Kind::MaxLen(100)).nullable(),
    Field::new("functionId", Kind::Str).nullable(),
    Field::new("brandId", Kind::Str).nullable(),
    Field::new("impedance", Kind::NumNonNeg).nullable(),
    Field::new("bandwidthMHz", Kind::NumNonNeg).nullable(),
    Field::new("diameterMm", Kind::NumPos).nullable(),
    Field::new("conductor", Kind::MaxLen(100)).nullable(),
    Field::new("shielding", Kind::MaxLen(100)).nullable(),
    Field::new("jacketMaterial", Kind::MaxLen(100)).nullable(),
    Field::new("fireRating", Kind::MaxLen(100)).nullable(),
    Field::new("customFields", Kind::AnyArr).or(Def::EmptyArr),
    Field::new("imageUrl", Kind::Asset).nullable(),
    Field::new("datasheetUrl", Kind::Asset).nullable(),
    Field::new("notes", Kind::Str).nullable(),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
    Field::new("isActive", Kind::Bool).or(Def::True),
];

static PATCH: [Field; 17] = [
    Field::new("name", NAME),
    Field::new("reference", Kind::MaxLen(100)).nullable(),
    Field::new("functionId", Kind::Str).nullable(),
    Field::new("brandId", Kind::Str).nullable(),
    Field::new("impedance", Kind::NumNonNeg).nullable(),
    Field::new("bandwidthMHz", Kind::NumNonNeg).nullable(),
    Field::new("diameterMm", Kind::NumPos).nullable(),
    Field::new("conductor", Kind::MaxLen(100)).nullable(),
    Field::new("shielding", Kind::MaxLen(100)).nullable(),
    Field::new("jacketMaterial", Kind::MaxLen(100)).nullable(),
    Field::new("fireRating", Kind::MaxLen(100)).nullable(),
    Field::new("customFields", Kind::AnyArr),
    Field::new("imageUrl", Kind::Asset).nullable(),
    Field::new("datasheetUrl", Kind::Asset).nullable(),
    Field::new("notes", Kind::Str).nullable(),
    Field::new("sortOrder", Kind::Int),
    Field::new("isActive", Kind::Bool),
];

pub static RES: Res = Res {
    table: Table {
        name: "TenantCableModel",
        bools: &["isActive"],
        jsons: &["customFields"],
    },
    entity: "tenant_parametres_cabling",
    audit: "tenant_cable_model",
    audit_type: "TenantCableModel",
    not_found: "Modèle de câble introuvable.",
    unique_msg: "Un modèle de câble avec ce nom et cette référence existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &CREATE,
    patch: &PATCH,
};

struct H;

impl Hooks for H {
    /// arkyo refused a name (or reference) present in the Arkyo catalogue;
    /// the unique key here is (name, reference), so a model that only
    /// differs by case from another (same name and reference) is refused
    /// with arkyo's message, and an exact one by the unique index.
    fn check<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        body: &'a mut Obj,
        existing: Option<&'a Obj>,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            if !body.contains_key("name") && !body.contains_key("reference") {
                return Ok(());
            }
            let pick = |k: &str| -> Option<String> {
                match body.get(k) {
                    Some(v) => v.as_str().map(str::to_string),
                    None => existing.and_then(|e| str_of(e, k)).map(str::to_string),
                }
            };
            let Some(name) = pick("name") else {
                return Ok(());
            };
            let reference = pick("reference");
            let own = existing.and_then(|e| str_of(e, "id")).unwrap_or("");
            let rows: Vec<(String, String, Option<String>)> =
                sqlx::query_as(r#"SELECT "id", "name", "reference" FROM "TenantCableModel""#)
                    .fetch_all(&mut *conn)
                    .await
                    .map_err(db_error)?;
            for (id, n, r) in &rows {
                if id == own || fold(n) != fold(&name) {
                    continue;
                }
                let same_ref = match (&reference, r) {
                    (None, None) => true,
                    (Some(a), Some(b)) => fold(a) == fold(b),
                    _ => false,
                };
                if !same_ref {
                    continue;
                }
                // The unique index ignores NULL references, so an exact
                // (name, NULL) duplicate is refused here.
                if *n == name && reference.as_deref() == r.as_deref() {
                    return Err(conflict(RES.unique_msg));
                }
                return Err(conflict(
                    "Un modèle de câble avec ce nom existe déjà dans le catalogue Arkyo.",
                ));
            }
            Ok(())
        })
    }
}

pub async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    match list_rows(
        &st.pool,
        &RES.table,
        r#"WHERE "isActive" = 1"#,
        r#""sortOrder", "name" COLLATE NOCASE"#,
    )
    .await
    {
        Ok(rows) => Json::<Value>(arkyo_personal(rows)).into_response(),
        Err(e) => db_error(e),
    }
}

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    super::create(&st, &u, &RES, &H, body).await
}

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    super::patch_row(&st, &u, &RES, &H, &id, body).await
}

/// arkyo deletes without a usage check for cable models.
pub async fn delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &RES, &NoHooks, &id).await
}

// ── GET /cable-models ───────────────────────────────────────────────────────

fn num(o: &Obj, k: &str) -> Option<f64> {
    o.get(k).and_then(Value::as_f64)
}

/// `computeCompatibility`.
fn compatibility(cable: &Obj, signal: Option<&Obj>) -> &'static str {
    let Some(signal) = signal else {
        return "unknown";
    };
    let (imp, bw) = (num(cable, "impedance"), num(cable, "bandwidthMHz"));
    let (req_imp, min_bw) = (
        num(signal, "requiredImpedance"),
        num(signal, "minBandwidthMHz"),
    );
    let impedance_ok = req_imp.is_none_or(|r| imp.is_some_and(|i| (i - r).abs() <= 0.5));
    let bandwidth_ok = min_bw.is_none_or(|m| bw.is_some_and(|b| b >= m));
    if impedance_ok && bandwidth_ok {
        if (req_imp.is_some() && imp.is_none()) || (min_bw.is_some() && bw.is_none()) {
            return "unknown";
        }
        return "match";
    }
    if !impedance_ok {
        return "incompatible";
    }
    "warn"
}

async fn lookup(
    conn: &mut SqliteConnection,
    sql: &str,
    key: &str,
) -> Result<Option<Obj>, sqlx::Error> {
    let t = Table {
        name: "",
        bools: &[],
        jsons: &[],
    };
    Ok(sqlx::query(sql)
        .bind(key)
        .fetch_optional(conn)
        .await?
        .map(|r| row_map(&r, &t)))
}

fn pick(o: &Obj, keys: &[&str]) -> Value {
    Value::Object(
        keys.iter()
            .map(|k| ((*k).to_string(), o.get(*k).cloned().unwrap_or(Value::Null)))
            .collect(),
    )
}

pub async fn cable_models(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await?;
        let non_empty = |k: &str| q.get(k).filter(|v| !v.is_empty()).cloned();
        let signal = match non_empty("signalName") {
            Some(n) => {
                lookup(
                    &mut conn,
                    r#"SELECT "id","functionId","requiredImpedance","minBandwidthMHz","color"
                       FROM "TenantSignalType" WHERE "name" = ?"#,
                    &n,
                )
                .await?
            }
            None => None,
        };
        let connector_sql =
            r#"SELECT "name","iconId","color" FROM "TenantConnectorType" WHERE "name" = ?"#;
        let left = match non_empty("leftConnector") {
            Some(n) => lookup(&mut conn, connector_sql, &n).await?,
            None => None,
        };
        let right = match non_empty("rightConnector") {
            Some(n) => lookup(&mut conn, connector_sql, &n).await?,
            None => None,
        };
        let functions = sqlx::query(r#"SELECT "id","label","color" FROM "TenantFunction""#)
            .fetch_all(&mut *conn)
            .await?;
        let function_of = |id: Option<&str>| -> Value {
            id.and_then(|id| functions.iter().find(|f| f.get::<String, _>("id") == id))
                .map_or(Value::Null, |f| {
                    json!({"id": f.get::<String,_>("id"), "label": f.get::<String,_>("label"),
                           "color": f.get::<Option<String>,_>("color")})
                })
        };
        let brands = sqlx::query(r#"SELECT "id","name","logoUrl" FROM "TenantBrand""#)
            .fetch_all(&mut *conn)
            .await?;
        let signal_function_id = signal
            .as_ref()
            .and_then(|s| str_of(s, "functionId"))
            .map(str::to_string);
        let effective = non_empty("functionId").or(signal_function_id);
        let mut sql = String::from(r#"SELECT * FROM "TenantCableModel" WHERE "isActive" = 1"#);
        if effective.is_some() {
            sql.push_str(r#" AND "functionId" = ?"#);
        }
        sql.push_str(r#" ORDER BY "sortOrder", "name" COLLATE NOCASE"#);
        let mut query = sqlx::query(&sql);
        if let Some(f) = &effective {
            query = query.bind(f);
        }
        let rows = query.fetch_all(&mut *conn).await?;
        let models: Vec<Value> = rows
            .iter()
            .map(|r| {
                let m = row_map(r, &RES.table);
                let mut out = pick(
                    &m,
                    &[
                        "id",
                        "name",
                        "reference",
                        "impedance",
                        "bandwidthMHz",
                        "diameterMm",
                        "conductor",
                        "shielding",
                        "jacketMaterial",
                        "fireRating",
                        "imageUrl",
                    ],
                );
                let brand = str_of(&m, "brandId")
                    .and_then(|id| brands.iter().find(|b| b.get::<String, _>("id") == id))
                    .map_or(Value::Null, |b| {
                        json!({"id": b.get::<String,_>("id"), "name": b.get::<String,_>("name"),
                               "logoUrl": b.get::<Option<String>,_>("logoUrl")})
                    });
                if let Value::Object(o) = &mut out {
                    o.insert("pinned".into(), Value::Bool(false));
                    o.insert(
                        "sortOrder".into(),
                        m.get("sortOrder").cloned().unwrap_or(Value::Null),
                    );
                    o.insert("function".into(), function_of(str_of(&m, "functionId")));
                    o.insert("brand".into(), brand);
                    o.insert(
                        "compatibility".into(),
                        json!(compatibility(&m, signal.as_ref())),
                    );
                }
                out
            })
            .collect();
        let signal_json = match (&signal, non_empty("signalName")) {
            (Some(s), Some(name)) => json!({
                "name": name,
                "color": s.get("color").cloned().unwrap_or(Value::Null),
                "requiredImpedance": s.get("requiredImpedance").cloned().unwrap_or(Value::Null),
                "minBandwidthMHz": s.get("minBandwidthMHz").cloned().unwrap_or(Value::Null),
                "function": function_of(str_of(s, "functionId")),
            }),
            _ => Value::Null,
        };
        Ok::<_, sqlx::Error>(json!({
            "models": models,
            "leftConnector": left.map_or(Value::Null, Value::Object),
            "rightConnector": right.map_or(Value::Null, Value::Object),
            "signal": signal_json,
        }))
    };
    match run.await {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_error(e),
    }
}
