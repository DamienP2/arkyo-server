//! Print settings: arkyo:app/api/tenant/parametres/print/**
//! (`route`, `templates/**`, `label-stocks/**`, `export-models/**`).
//!
//! `PrintSettings` is a read-only singleton (seeded). Templates and label
//! stocks use the shared flow; export models (with their three pages) have
//! their own handlers. The `restore-arkyo` routes reinsert the seeded rows
//! that are missing (the export-models family is empty by design).

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::{
    begin, db_error, get_row, list_rows, list_rows_conn, objs, parse_body, require, validate, Def,
    Field, Kind, NoHooks, Obj, Res, Table,
};
use crate::audit;
use crate::http::{error, server_error, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};
use crate::seeds::{self, SeedKind, SeedMode};

const PAPER: Kind = Kind::Enum(
    &["A4", "A3", "A2", "A1", "A0", "LETTER", "LEGAL"],
    r#"Invalid option: expected one of "A4"|"A3"|"A2"|"A1"|"A0"|"LETTER"|"LEGAL""#,
);
const ORIENTATION: Kind = Kind::Enum(
    &["PORTRAIT", "LANDSCAPE"],
    r#"Invalid option: expected one of "PORTRAIT"|"LANDSCAPE""#,
);
/// `z.string().min(1, "Le nom est obligatoire").max(100)`.
const NAME_100: Kind = Kind::Bounded {
    min_msg: "Le nom est obligatoire",
    max: 100,
    max_msg: "Too big: expected string to have <=100 characters",
    upper: false,
};
const REGEX_MSG: &str = "Lettres majuscules, chiffres ou underscore uniquement";

pub fn router() -> Router<AppState> {
    const P: &str = "/tenant/parametres/print";
    Router::new()
        .route(P, get(list).post(template_create))
        .route(
            &format!("{P}/templates/restore-arkyo"),
            post(template_restore),
        )
        .route(
            &format!("{P}/templates/{{id}}"),
            patch(template_update).delete(template_delete),
        )
        .route(
            &format!("{P}/label-stocks"),
            get(stock_list).post(stock_create),
        )
        .route(
            &format!("{P}/label-stocks/restore-arkyo"),
            post(stock_restore),
        )
        .route(
            &format!("{P}/label-stocks/{{id}}"),
            patch(stock_update).delete(stock_delete),
        )
        .route(
            &format!("{P}/export-models"),
            get(model_list).post(model_create),
        )
        .route(
            &format!("{P}/export-models/restore-arkyo"),
            post(model_restore),
        )
        .route(
            &format!("{P}/export-models/{{id}}"),
            get(model_get).patch(model_update).delete(model_delete),
        )
        .route(
            &format!("{P}/export-models/{{id}}/pages/{{page_id}}"),
            patch(page_update),
        )
}

// ── templates ───────────────────────────────────────────────────────────────

const TEMPLATE_KEY: Kind = Kind::UpperKey {
    min_msg: "La clé est obligatoire",
    max: 50,
    max_msg: "Clé trop longue (50 max)",
    regex_msg: REGEX_MSG,
};

static TEMPLATE_CREATE: [Field; 8] = [
    Field::new("key", TEMPLATE_KEY).required(),
    Field::new("name", NAME_100).required(),
    Field::new("description", Kind::Str).nullable(),
    Field::new("paperFormat", PAPER).or(Def::Str("A4")),
    Field::new("orientation", ORIENTATION).or(Def::Str("PORTRAIT")),
    Field::new("slots", Kind::Slots).or(Def::EmptyArr),
    Field::new("layout", Kind::Any).nullable(),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
];

static TEMPLATE_PATCH: [Field; 8] = [
    Field::new("name", NAME_100),
    Field::new("description", Kind::Str).nullable(),
    Field::new("paperFormat", PAPER),
    Field::new("orientation", ORIENTATION),
    Field::new("slots", Kind::Slots),
    Field::new("layout", Kind::Any).nullable(),
    Field::new("isActive", Kind::Bool),
    Field::new("sortOrder", Kind::Int),
];

static TEMPLATE: Res = Res {
    table: Table {
        name: "TenantPrintTemplate",
        bools: &["isActive"],
        jsons: &["slots", "layout"],
    },
    entity: "tenant_parametres_print",
    audit: "tenant_print_template",
    audit_type: "TenantPrintTemplate",
    not_found: "Template introuvable.",
    unique_msg: "Un template avec cette clé existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &TEMPLATE_CREATE,
    patch: &TEMPLATE_PATCH,
};

/// `{ templates, settings }`: active templates and the `PrintSettings`
/// singleton (`null` when absent).
async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let templates = match list_rows(
        &st.pool,
        &TEMPLATE.table,
        r#"WHERE "isActive" = 1"#,
        r#""sortOrder", "name""#,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => return db_error(e),
    };
    let settings_table = Table {
        name: "PrintSettings",
        bools: &[],
        jsons: &["pdfOptions"],
    };
    let settings = match list_rows(
        &st.pool,
        &settings_table,
        r#"WHERE "key" = 'default'"#,
        r#""id""#,
    )
    .await
    {
        Ok(r) => r.into_iter().next().map_or(Value::Null, Value::Object),
        Err(e) => return db_error(e),
    };
    Json(json!({ "templates": objs(templates), "settings": settings })).into_response()
}

async fn template_create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    super::create(&st, &u, &TEMPLATE, &NoHooks, body).await
}

async fn template_update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    super::patch_row(&st, &u, &TEMPLATE, &NoHooks, &id, body).await
}

async fn template_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &TEMPLATE, &NoHooks, &id).await
}

async fn template_restore(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    restore(
        &st,
        &u,
        SeedKind::PrintTemplates,
        "tenant_print_template.restore_arkyo",
        "TenantPrintTemplate",
        TEMPLATE.entity,
    )
    .await
}

// ── label stocks ────────────────────────────────────────────────────────────

const POS: Kind = Kind::NumPos;

static STOCK_CREATE: [Field; 25] = [
    Field::new("name", NAME_100).required(),
    Field::new("reference", Kind::MaxLen(100)).nullable(),
    Field::new("brandId", Kind::Str).nullable(),
    Field::new("description", Kind::Str).nullable(),
    Field::new("datasheetUrl", Kind::Asset).nullable(),
    Field::new("paperFormat", PAPER).required(),
    Field::new("orientation", ORIENTATION).required(),
    Field::new("pageMarginTop", Kind::NumNonNeg).required(),
    Field::new("pageMarginRight", Kind::NumNonNeg).required(),
    Field::new("pageMarginBottom", Kind::NumNonNeg).required(),
    Field::new("pageMarginLeft", Kind::NumNonNeg).required(),
    Field::new("columns", Kind::IntMin(1)).required(),
    Field::new("rows", Kind::IntMin(1)).required(),
    Field::new("gutterX", Kind::NumNonNeg).required(),
    Field::new("gutterY", Kind::NumNonNeg).required(),
    Field::new("labelWidth", POS).required(),
    Field::new("labelHeight", POS).required(),
    Field::new("printableHeight", POS).nullable(),
    Field::new("wrapHeight", POS).nullable(),
    Field::new("printablePadding", Kind::NumNonNeg).nullable(),
    Field::new("printableColor", Kind::Str).nullable(),
    Field::new("cableDiameterMin", POS).nullable(),
    Field::new("cableDiameterMax", POS).nullable(),
    Field::new("isActive", Kind::Bool).or(Def::True),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
];

static STOCK_PATCH: [Field; 25] = [
    Field::new("name", NAME_100),
    Field::new("reference", Kind::MaxLen(100)).nullable(),
    Field::new("brandId", Kind::Str).nullable(),
    Field::new("description", Kind::Str).nullable(),
    Field::new("datasheetUrl", Kind::Asset).nullable(),
    Field::new("paperFormat", PAPER),
    Field::new("orientation", ORIENTATION),
    Field::new("pageMarginTop", Kind::NumNonNeg),
    Field::new("pageMarginRight", Kind::NumNonNeg),
    Field::new("pageMarginBottom", Kind::NumNonNeg),
    Field::new("pageMarginLeft", Kind::NumNonNeg),
    Field::new("columns", Kind::IntMin(1)),
    Field::new("rows", Kind::IntMin(1)),
    Field::new("gutterX", Kind::NumNonNeg),
    Field::new("gutterY", Kind::NumNonNeg),
    Field::new("labelWidth", POS),
    Field::new("labelHeight", POS),
    Field::new("printableHeight", POS).nullable(),
    Field::new("wrapHeight", POS).nullable(),
    Field::new("printablePadding", Kind::NumNonNeg).nullable(),
    Field::new("printableColor", Kind::Str).nullable(),
    Field::new("cableDiameterMin", POS).nullable(),
    Field::new("cableDiameterMax", POS).nullable(),
    Field::new("isActive", Kind::Bool),
    Field::new("sortOrder", Kind::Int),
];

static STOCK: Res = Res {
    table: Table {
        name: "TenantCableLabelStock",
        bools: &["isActive"],
        jsons: &[],
    },
    entity: "tenant_parametres_print_labels",
    audit: "tenant_cable_label_stock",
    audit_type: "TenantCableLabelStock",
    not_found: "Planche introuvable.",
    unique_msg: "Une planche avec ce nom et cette référence existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &STOCK_CREATE,
    patch: &STOCK_PATCH,
};

async fn stock_list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    match list_rows(
        &st.pool,
        &STOCK.table,
        r#"WHERE "isActive" = 1"#,
        r#""sortOrder", "name""#,
    )
    .await
    {
        Ok(rows) => Json(objs(rows)).into_response(),
        Err(e) => db_error(e),
    }
}

async fn stock_create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    super::create(&st, &u, &STOCK, &NoHooks, body).await
}

async fn stock_update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    super::patch_row(&st, &u, &STOCK, &NoHooks, &id, body).await
}

async fn stock_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &STOCK, &NoHooks, &id).await
}

async fn stock_restore(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    restore(
        &st,
        &u,
        SeedKind::CableLabelStocks,
        "tenant_cable_label_stock.restore_arkyo",
        "TenantCableLabelStock",
        STOCK.entity,
    )
    .await
}

// ── restore-arkyo ───────────────────────────────────────────────────────────

/// Puts back the seeded rows of `kind` that are missing; existing rows are
/// kept. Audit row and event only when something was restored.
async fn restore(
    st: &AppState,
    u: &crate::users::User,
    kind: SeedKind,
    action: &str,
    audit_type: &str,
    entity: &str,
) -> Response {
    let run = async {
        require(u, &st.pool, Domain::Settings, Level::Write).await?;
        let mut tx = begin(&st.pool).await?;
        let applied = seeds::apply_in(&mut tx, SeedMode::Restore(kind))
            .await
            .map_err(|e| {
                tracing::error!("restore {}: {e:#}", kind.name());
                server_error()
            })?;
        let n = applied.get(kind);
        if n > 0 {
            audit::log(
                &mut tx,
                &u.id,
                action,
                audit_type,
                "bulk_restore",
                None,
                None,
                Some(json!({ "restored": n })),
            )
            .await
            .map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)?;
        if n > 0 {
            st.events.publish(entity, "restore", Some("bulk"));
        }
        Ok::<Response, Response>(Json(json!({ "restored": n })).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

// ── export models ───────────────────────────────────────────────────────────

const MODEL_ENTITY: &str = "tenant_parametres_print";
const MODEL_NOT_FOUND: &str = "Modèle introuvable.";

static MODEL_TABLE: Table = Table {
    name: "TenantPrintExportModel",
    bools: &["isActive"],
    jsons: &[],
};
static PAGE_TABLE: Table = Table {
    name: "TenantPrintExportPage",
    bools: &[],
    jsons: &["layout"],
};

static MODEL_CREATE: [Field; 3] = [
    Field::new(
        "name",
        Kind::Bounded {
            min_msg: "Too small: expected string to have >=1 characters",
            max: 100,
            max_msg: "Too big: expected string to have <=100 characters",
            upper: false,
        },
    )
    .required(),
    Field::new(
        "key",
        Kind::UpperKey {
            min_msg: "Too small: expected string to have >=1 characters",
            max: usize::MAX,
            max_msg: "",
            regex_msg: REGEX_MSG,
        },
    ),
    Field::new("description", Kind::Str).nullable(),
];

static MODEL_PATCH: [Field; 2] = [
    Field::new(
        "name",
        Kind::Bounded {
            min_msg: "Too small: expected string to have >=1 characters",
            max: 100,
            max_msg: "Too big: expected string to have <=100 characters",
            upper: false,
        },
    ),
    Field::new("description", Kind::Str).nullable(),
];

static PAGE_PATCH: [Field; 6] = [
    // accepted and ignored: only `layout` is persisted
    Field::new("name", Kind::Str),
    Field::new("description", Kind::Str).nullable(),
    Field::new("paperFormat", Kind::Str),
    Field::new("orientation", Kind::Str),
    Field::new("slots", Kind::Any).nullable(),
    Field::new("layout", Kind::Any).nullable(),
];

/// `name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")`.
fn name_to_key(name: &str) -> String {
    let mut out = String::new();
    let mut in_run = false;
    for c in name.to_uppercase().chars() {
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            out.push(c);
            in_run = false;
        } else if !in_run {
            out.push('_');
            in_run = true;
        }
    }
    out.trim_matches('_').to_string()
}

/// A model row with its `pages` (by `kind`).
async fn model_with_pages(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<Obj>, sqlx::Error> {
    let Some(mut m) = get_row(conn, &MODEL_TABLE, id).await? else {
        return Ok(None);
    };
    let pages = list_rows_conn(
        conn,
        &PAGE_TABLE,
        &format!(r#"WHERE "modelId" = '{}'"#, id.replace('\'', "''")),
        r#""kind""#,
    )
    .await?;
    m.insert("pages".into(), objs(pages));
    Ok(Some(m))
}

async fn model_list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await.map_err(db_error)?;
        let models = list_rows_conn(&mut conn, &MODEL_TABLE, "", r#""sortOrder", "name""#)
            .await
            .map_err(db_error)?;
        let mut out = Vec::with_capacity(models.len());
        for m in models {
            let id = m
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            out.push(
                model_with_pages(&mut conn, &id)
                    .await
                    .map_err(db_error)?
                    .map_or(Value::Null, Value::Object),
            );
        }
        Ok::<Response, Response>(Json(Value::Array(out)).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

async fn model_get(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await.map_err(db_error)?;
        let m = model_with_pages(&mut conn, &id)
            .await
            .map_err(db_error)?
            .ok_or_else(|| error(StatusCode::NOT_FOUND, MODEL_NOT_FOUND))?;
        Ok::<Response, Response>(Json(Value::Object(m)).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

async fn model_create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    let run = async {
        require(&u, &st.pool, Domain::Settings, Level::Write).await?;
        let vals = validate(&parse_body(&body)?, &MODEL_CREATE)?;
        let name = vals["name"].as_str().unwrap_or("").to_string();
        let key = vals
            .get("key")
            .and_then(Value::as_str)
            .map_or_else(|| name_to_key(&name), str::to_string);
        let description = vals.get("description").cloned().unwrap_or(Value::Null);
        let mut tx = begin(&st.pool).await?;
        let taken: Option<String> =
            sqlx::query_scalar(r#"SELECT "id" FROM "TenantPrintExportModel" WHERE "key" = ?"#)
                .bind(&key)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_error)?;
        if taken.is_some() {
            return Err(super::conflict(&format!(
                "La clé \"{key}\" est déjà utilisée."
            )));
        }
        let id = new_id();
        let now = now_iso();
        sqlx::query(
            r#"INSERT INTO "TenantPrintExportModel" ("id","key","name","description","createdAt","updatedAt")
               VALUES (?,?,?,?,?,?)"#,
        )
        .bind(&id)
        .bind(&key)
        .bind(&name)
        .bind(description.as_str())
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        for kind in ["COVER", "INTERIOR", "BACK"] {
            sqlx::query(
                r#"INSERT INTO "TenantPrintExportPage" ("id","modelId","kind","createdAt","updatedAt")
                   VALUES (?,?,?,?,?)"#,
            )
            .bind(new_id())
            .bind(&id)
            .bind(kind)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        let model = model_with_pages(&mut tx, &id)
            .await
            .map_err(db_error)?
            .ok_or_else(server_error)?;
        audit::log(
            &mut tx,
            &u.id,
            "tenant_print_export_model.create",
            "TenantPrintExportModel",
            &id,
            None,
            None,
            None,
        )
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        st.events.publish(MODEL_ENTITY, "create", Some(&id));
        Ok::<Response, Response>((StatusCode::CREATED, Json(Value::Object(model))).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

async fn model_update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let run = async {
        require(&u, &st.pool, Domain::Settings, Level::Write).await?;
        let mut tx = begin(&st.pool).await?;
        let existing = model_with_pages(&mut tx, &id)
            .await
            .map_err(db_error)?
            .ok_or_else(|| error(StatusCode::NOT_FOUND, MODEL_NOT_FOUND))?;
        let vals = validate(&parse_body(&body)?, &MODEL_PATCH)?;
        let mut sets = vec!["\"updatedAt\" = ?".to_string()];
        let mut values = vec![Value::String(now_iso())];
        for f in &MODEL_PATCH {
            if let Some(v) = vals.get(f.name) {
                sets.push(format!("\"{}\" = ?", f.name));
                values.push(v.clone());
            }
        }
        let sql = format!(
            r#"UPDATE "TenantPrintExportModel" SET {} WHERE "id" = ?"#,
            sets.join(", ")
        );
        let mut q = sqlx::query(&sql);
        for v in &values {
            q = super::bind(q, v);
        }
        q.bind(&id).execute(&mut *tx).await.map_err(db_error)?;
        let model = model_with_pages(&mut tx, &id)
            .await
            .map_err(db_error)?
            .ok_or_else(server_error)?;
        audit::log(
            &mut tx,
            &u.id,
            "tenant_print_export_model.update",
            "TenantPrintExportModel",
            &id,
            None,
            Some(Value::Object(existing)),
            Some(Value::Object(model.clone())),
        )
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        st.events.publish(MODEL_ENTITY, "update", Some(&id));
        Ok::<Response, Response>(Json(Value::Object(model)).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

async fn model_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let run = async {
        require(&u, &st.pool, Domain::Settings, Level::Write).await?;
        let mut tx = begin(&st.pool).await?;
        let existing = get_row(&mut tx, &MODEL_TABLE, &id)
            .await
            .map_err(db_error)?
            .ok_or_else(|| error(StatusCode::NOT_FOUND, MODEL_NOT_FOUND))?;
        // pages go with the model (ON DELETE CASCADE)
        sqlx::query(r#"DELETE FROM "TenantPrintExportModel" WHERE "id" = ?"#)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        audit::log(
            &mut tx,
            &u.id,
            "tenant_print_export_model.delete",
            "TenantPrintExportModel",
            &id,
            None,
            Some(Value::Object(existing)),
            None,
        )
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        st.events.publish(MODEL_ENTITY, "delete", Some(&id));
        Ok::<Response, Response>(Json(json!({ "success": true })).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

async fn model_restore(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    restore(
        &st,
        &u,
        SeedKind::PrintExportModels,
        "tenant_print_export_model.restore_arkyo",
        "TenantPrintExportModel",
        MODEL_ENTITY,
    )
    .await
}

/// `PATCH …/export-models/{id}/pages/{pageId}`: only `layout` is persisted.
async fn page_update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path((model_id, page_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let run = async {
        require(&u, &st.pool, Domain::Settings, Level::Write).await?;
        let mut tx = begin(&st.pool).await?;
        get_row(&mut tx, &MODEL_TABLE, &model_id)
            .await
            .map_err(db_error)?
            .ok_or_else(|| error(StatusCode::NOT_FOUND, MODEL_NOT_FOUND))?;
        let existing = get_row(&mut tx, &PAGE_TABLE, &page_id)
            .await
            .map_err(db_error)?
            .filter(|p| p.get("modelId").and_then(Value::as_str) == Some(model_id.as_str()))
            .ok_or_else(|| error(StatusCode::NOT_FOUND, "Page introuvable pour ce modèle."))?;
        let vals = validate(&parse_body(&body)?, &PAGE_PATCH)?;
        let mut sets = vec!["\"updatedAt\" = ?".to_string()];
        let mut values = vec![Value::String(now_iso())];
        if let Some(layout) = vals.get("layout") {
            sets.push("\"layout\" = ?".into());
            values.push(layout.clone());
        }
        let sql = format!(
            r#"UPDATE "TenantPrintExportPage" SET {} WHERE "id" = ?"#,
            sets.join(", ")
        );
        let mut q = sqlx::query(&sql);
        for v in &values {
            q = super::bind(q, v);
        }
        q.bind(&page_id).execute(&mut *tx).await.map_err(db_error)?;
        let page = get_row(&mut tx, &PAGE_TABLE, &page_id)
            .await
            .map_err(db_error)?
            .ok_or_else(server_error)?;
        audit::log(
            &mut tx,
            &u.id,
            "tenant_print_export_page.update",
            "TenantPrintExportPage",
            &page_id,
            None,
            Some(Value::Object(existing)),
            Some(Value::Object(page.clone())),
        )
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        st.events.publish(MODEL_ENTITY, "update", Some(&page_id));
        Ok::<Response, Response>(Json(Value::Object(page)).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}
