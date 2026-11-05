//! arkyo:app/api/tenant/parametres/categories/{route,category/**,function/**,
//! phase/**,type/**}.ts and `type/_type-hierarchy-guard.ts` with
//! arkyo:lib/services/catalog/type-hierarchy.ts.

use arkyo_core::permissions::Domain;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};
use unicode_normalization::UnicodeNormalization;

use super::{
    any_row, bad, conflict, db_error, list_rows, refuse_if_used, str_of, Def, Field, Fut, Hooks,
    Kind, NoHooks, Obj, Res, Table, KEY, LABEL, NAME,
};
use crate::catalogue::in_use;
use crate::http::{AppState, CurrentUser};

// ── GET /categories ─────────────────────────────────────────────────────────

pub async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let run = async {
        let active = r#"WHERE "isActive" = 1"#;
        let cats = list_rows(
            &st.pool,
            &CATEGORY.table,
            active,
            r#""sortOrder", "name" COLLATE NOCASE"#,
        )
        .await?;
        // One level of children, like arkyo's `include: { children }`.
        let roots: Vec<Value> = cats
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
        let functions = list_rows(
            &st.pool,
            &FUNCTION.table,
            active,
            r#""sortOrder", "label" COLLATE NOCASE"#,
        )
        .await?;
        let phases = list_rows(
            &st.pool,
            &PHASE.table,
            active,
            r#""sortOrder", "label" COLLATE NOCASE"#,
        )
        .await?;
        let types = list_rows(
            &st.pool,
            &TYPE.table,
            active,
            r#""sortOrder", "name" COLLATE NOCASE"#,
        )
        .await?;
        Ok::<_, sqlx::Error>(json!({
            "categories": { "arkyo": [], "personal": roots },
            "functions": { "arkyo": [], "personal": super::objs(functions) },
            "phases": { "arkyo": [], "personal": super::objs(phases) },
            "types": { "arkyo": [], "personal": super::objs(types) },
        }))
    };
    match run.await {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_error(e),
    }
}

// ── category ────────────────────────────────────────────────────────────────

static CATEGORY_CREATE: [Field; 5] = [
    Field::new("name", NAME).required(),
    Field::new("color", Kind::Str),
    Field::new("iconId", Kind::Str),
    Field::new("parentId", Kind::Str),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
];

static CATEGORY_PATCH: [Field; 6] = [
    Field::new("name", NAME),
    Field::new("color", Kind::Str).nullable(),
    Field::new("iconId", Kind::Str).nullable(),
    Field::new("parentId", Kind::Str).nullable(),
    Field::new("sortOrder", Kind::Int),
    Field::new("isActive", Kind::Bool),
];

static CATEGORY: Res = Res {
    table: Table {
        name: "TenantEquipmentCategory",
        bools: &["isActive"],
        jsons: &[],
    },
    entity: "tenant_parametres_categories",
    audit: "tenant_category",
    audit_type: "TenantEquipmentCategory",
    not_found: "Catégorie introuvable.",
    unique_msg: "Une catégorie avec ce nom existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &CATEGORY_CREATE,
    patch: &CATEGORY_PATCH,
};

struct CategoryHooks;

impl Hooks for CategoryHooks {
    fn in_use<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        id: &'a str,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            refuse_if_used(
                in_use::category(conn, id).await,
                |_, c| {
                    format!(
                        "Cette catégorie ne peut pas être supprimée car elle est référencée par {} sous-catégorie(s) et {} équipement(s) personnel(s).",
                        c[0].1, c[1].1
                    )
                },
                false,
            )
        })
    }
}

pub async fn category_create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    super::create(&st, &u, &CATEGORY, &NoHooks, body).await
}
pub async fn category_update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    super::patch_row(&st, &u, &CATEGORY, &NoHooks, &id, body).await
}
pub async fn category_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &CATEGORY, &CategoryHooks, &id).await
}

// ── function / phase (same shape: key + label) ──────────────────────────────

static FUNCTION_CREATE: [Field; 4] = [
    Field::new("key", KEY).required(),
    Field::new("label", LABEL).required(),
    Field::new("color", Kind::Str),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
];

static FUNCTION_PATCH: [Field; 5] = [
    Field::new("key", KEY),
    Field::new("label", LABEL),
    Field::new("color", Kind::Str).nullable(),
    Field::new("sortOrder", Kind::Int),
    Field::new("isActive", Kind::Bool),
];

static FUNCTION: Res = Res {
    table: Table {
        name: "TenantFunction",
        bools: &["isActive"],
        jsons: &[],
    },
    entity: "tenant_parametres_categories",
    audit: "tenant_function",
    audit_type: "TenantFunction",
    not_found: "Fonction introuvable.",
    unique_msg: "Une fonction avec cette clé existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &FUNCTION_CREATE,
    patch: &FUNCTION_PATCH,
};

static PHASE_CREATE: [Field; 3] = [
    Field::new("key", KEY).required(),
    Field::new("label", LABEL).required(),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
];

static PHASE_PATCH: [Field; 4] = [
    Field::new("key", KEY),
    Field::new("label", LABEL),
    Field::new("sortOrder", Kind::Int),
    Field::new("isActive", Kind::Bool),
];

static PHASE: Res = Res {
    table: Table {
        name: "TenantPhase",
        bools: &["isActive"],
        jsons: &[],
    },
    entity: "tenant_parametres_categories",
    audit: "tenant_phase",
    audit_type: "TenantPhase",
    not_found: "Phase introuvable.",
    unique_msg: "Une phase avec cette clé existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &PHASE_CREATE,
    patch: &PHASE_PATCH,
};

/// arkyo refused a key or label present in the Arkyo catalogue (ignoring
/// case). Here: another row whose label matches ignoring case, or whose key
/// only differs by case; an identical key is left to the unique index
/// ("clé … dans votre espace").
async fn key_label_duplicate(
    conn: &mut SqliteConnection,
    table: &str,
    body: &Obj,
    existing: Option<&Obj>,
    msg: &str,
) -> Result<(), Response> {
    let own = existing.and_then(|e| str_of(e, "id")).unwrap_or("");
    let mut conds = Vec::new();
    let mut binds: Vec<&str> = Vec::new();
    if let Some(k) = str_of(body, "key") {
        conds.push(r#"(lower("key") = lower(?) AND "key" <> ?)"#);
        binds.push(k);
        binds.push(k);
    }
    if let Some(l) = str_of(body, "label") {
        conds.push(r#"lower("label") = lower(?)"#);
        binds.push(l);
    }
    if conds.is_empty() {
        return Ok(());
    }
    binds.push(own);
    let sql = format!(
        r#"SELECT 1 FROM "{table}" WHERE ({}) AND "id" <> ? LIMIT 1"#,
        conds.join(" OR ")
    );
    if any_row(conn, &sql, &binds).await? {
        return Err(conflict(msg));
    }
    Ok(())
}

struct FunctionHooks;

impl Hooks for FunctionHooks {
    fn check<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        body: &'a mut Obj,
        existing: Option<&'a Obj>,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            key_label_duplicate(
                conn,
                "TenantFunction",
                body,
                existing,
                "Cette fonction existe déjà dans le catalogue Arkyo (clé ou libellé).",
            )
            .await
        })
    }

    fn in_use<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        id: &'a str,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            refuse_if_used(
                in_use::function(conn, id).await,
                |n, _| {
                    format!("Cette fonction est utilisée par {n} entité(s) et ne peut pas être supprimée.")
                },
                false,
            )
        })
    }
}

struct PhaseHooks;

impl Hooks for PhaseHooks {
    fn check<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        body: &'a mut Obj,
        existing: Option<&'a Obj>,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            key_label_duplicate(
                conn,
                "TenantPhase",
                body,
                existing,
                "Cette phase existe déjà dans le catalogue Arkyo (clé ou libellé).",
            )
            .await
        })
    }

    fn in_use<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        id: &'a str,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            refuse_if_used(
                in_use::phase(conn, id).await,
                |n, _| {
                    format!("Cette phase est utilisée par {n} équipement(s) personnel(s) et ne peut pas être supprimée.")
                },
                false,
            )
        })
    }
}

pub async fn function_create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    super::create(&st, &u, &FUNCTION, &FunctionHooks, body).await
}
pub async fn function_update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    super::patch_row(&st, &u, &FUNCTION, &FunctionHooks, &id, body).await
}
pub async fn function_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &FUNCTION, &FunctionHooks, &id).await
}

pub async fn phase_create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    super::create(&st, &u, &PHASE, &PhaseHooks, body).await
}
pub async fn phase_update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    super::patch_row(&st, &u, &PHASE, &PhaseHooks, &id, body).await
}
pub async fn phase_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &PHASE, &PhaseHooks, &id).await
}

// ── type ────────────────────────────────────────────────────────────────────

static TYPE_CREATE: [Field; 4] = [
    Field::new("name", NAME).required(),
    Field::new("functionId", Kind::Str).nullable(),
    Field::new("parentId", Kind::Str).nullable(),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
];

static TYPE_PATCH: [Field; 5] = [
    Field::new("name", NAME),
    Field::new("functionId", Kind::Str).nullable(),
    Field::new("parentId", Kind::Str).nullable(),
    Field::new("sortOrder", Kind::Int),
    Field::new("isActive", Kind::Bool),
];

static TYPE: Res = Res {
    table: Table {
        name: "TenantType",
        bools: &["isActive"],
        jsons: &[],
    },
    entity: "tenant_parametres_categories",
    audit: "tenant_type",
    audit_type: "TenantType",
    not_found: "Type introuvable.",
    unique_msg: "Un type avec ce nom existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &TYPE_CREATE,
    patch: &TYPE_PATCH,
};

/// `normalizeName`: NFD without combining marks, lower case, trimmed.
fn normalize_name(s: &str) -> String {
    s.nfd()
        .filter(|c| !('\u{0300}'..='\u{036f}').contains(c))
        .collect::<String>()
        .to_lowercase()
        .trim()
        .to_string()
}

struct TypeHooks;

impl Hooks for TypeHooks {
    /// `applyTenantTypeHierarchyGuard`: depth 1 maximum, `functionId`
    /// inherited from the parent, sibling name uniqueness. arkyo's extra
    /// check of the name against the Arkyo catalogue ("Ce type existe déjà
    /// dans le catalogue Arkyo (libellé)", global, not per parent) cannot be
    /// kept in a single catalogue where sub-types repeat names under
    /// different parents; the sibling rule below is the one that applies.
    fn check<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        body: &'a mut Obj,
        existing: Option<&'a Obj>,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            let touched = existing.is_none()
                || ["parentId", "functionId", "name"]
                    .iter()
                    .any(|k| body.contains_key(*k));
            if !touched {
                return Ok(());
            }
            let current = existing.and_then(|e| str_of(e, "id"));
            let eff = |k: &str| -> Option<String> {
                match body.get(k) {
                    Some(v) => v.as_str().map(str::to_string),
                    None => existing.and_then(|e| str_of(e, k)).map(str::to_string),
                }
            };
            let name = eff("name").unwrap_or_default();
            let own_function = eff("functionId");
            let parent_id = eff("parentId");

            if let (Some(p), Some(c)) = (&parent_id, current) {
                if p == c {
                    return Err(bad("Un type ne peut pas être son propre parent."));
                }
            }
            let mut parent: Option<(String, Option<String>, Option<String>)> = None;
            if let Some(pid) = &parent_id {
                let row = sqlx::query(
                    r#"SELECT "id","parentId","functionId" FROM "TenantType" WHERE "id" = ?"#,
                )
                .bind(pid)
                .fetch_optional(&mut *conn)
                .await
                .map_err(db_error)?;
                let Some(row) = row else {
                    return Err(bad("Type parent introuvable."));
                };
                parent = Some((row.get("id"), row.get("parentId"), row.get("functionId")));
            }
            if let Some((_, Some(_), _)) = &parent {
                return Err(bad(
                    "Un sous-type ne peut pas lui-même avoir de sous-type (profondeur 1 maximum).",
                ));
            }
            if let (Some(_), Some(c)) = (&parent, current) {
                let n: i64 =
                    sqlx::query_scalar(r#"SELECT COUNT(*) FROM "TenantType" WHERE "parentId" = ?"#)
                        .bind(c)
                        .fetch_one(&mut *conn)
                        .await
                        .map_err(db_error)?;
                if n > 0 {
                    return Err(bad(
                        "Ce type a des sous-types : il ne peut pas devenir lui-même un sous-type.",
                    ));
                }
            }
            let final_function = match &parent {
                Some((_, _, f)) => f.clone(),
                None => own_function,
            };
            let final_parent = parent.as_ref().map(|(id, _, _)| id.clone());

            let siblings: Vec<String> = sqlx::query_scalar(
                r#"SELECT "name" FROM "TenantType" WHERE "parentId" IS ? AND "id" <> ?"#,
            )
            .bind(final_parent.clone())
            .bind(current.unwrap_or(""))
            .fetch_all(&mut *conn)
            .await
            .map_err(db_error)?;
            let target = normalize_name(&name);
            if siblings.iter().any(|s| normalize_name(s) == target) {
                return Err(conflict(
                    "Un type avec ce nom existe déjà sous ce parent dans votre espace.",
                ));
            }
            body.insert(
                "functionId".into(),
                final_function.map_or(Value::Null, Value::String),
            );
            body.insert(
                "parentId".into(),
                final_parent.map_or(Value::Null, Value::String),
            );
            Ok(())
        })
    }

    fn in_use<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        id: &'a str,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            refuse_if_used(
                in_use::type_(conn, id).await,
                |_, c| {
                    format!(
                        "Ce type est utilisé par {} équipement(s) personnel(s) et/ou {} sous-type(s), et ne peut pas être supprimé.",
                        c[0].1, c[1].1
                    )
                },
                false,
            )
        })
    }
}

pub async fn type_create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    super::create(&st, &u, &TYPE, &TypeHooks, body).await
}
pub async fn type_update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    super::patch_row(&st, &u, &TYPE, &TypeHooks, &id, body).await
}
pub async fn type_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &TYPE, &TypeHooks, &id).await
}
