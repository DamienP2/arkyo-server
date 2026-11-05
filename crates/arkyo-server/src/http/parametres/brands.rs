//! arkyo:app/api/tenant/parametres/brands/{route,[id]/route}.ts

use arkyo_core::permissions::Domain;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;
use sqlx::SqliteConnection;

use super::{
    arkyo_personal, case_only_duplicate, db_error, list_rows, refuse_if_used, str_of, Def, Field,
    Fut, Hooks, Kind, Obj, Res, Table, NAME,
};
use crate::catalogue::in_use;
use crate::http::{AppState, CurrentUser};

static CREATE: [Field; 4] = [
    Field::new("name", NAME).required(),
    Field::new("website", Kind::Url).nullable(),
    Field::new("logoUrl", Kind::Asset).nullable(),
    Field::new("isActive", Kind::Bool).or(Def::True),
];

static PATCH: [Field; 4] = [
    Field::new("name", NAME),
    Field::new("website", Kind::Url).nullable(),
    Field::new("logoUrl", Kind::Asset).nullable(),
    Field::new("isActive", Kind::Bool),
];

pub static RES: Res = Res {
    table: Table {
        name: "TenantBrand",
        bools: &["isActive"],
        jsons: &[],
    },
    entity: "tenant_parametres_brands",
    audit: "tenant_brand",
    audit_type: "TenantBrand",
    not_found: "Fabricant introuvable.",
    unique_msg: "Un fabricant avec ce nom existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &CREATE,
    patch: &PATCH,
};

struct H;

impl Hooks for H {
    fn check<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        body: &'a mut Obj,
        existing: Option<&'a Obj>,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            if let Some(name) = str_of(body, "name") {
                let own = existing.and_then(|e| str_of(e, "id"));
                case_only_duplicate(
                    conn,
                    "TenantBrand",
                    "name",
                    name,
                    own,
                    "Ce fabricant existe déjà dans le catalogue Arkyo.",
                )
                .await?;
            }
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
                in_use::brand(conn, id).await,
                |n, _| {
                    format!("Ce fabricant est utilisé par {n} item(s) du catalogue personnel et ne peut pas être supprimé.")
                },
                true,
            )
        })
    }
}

pub async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    match list_rows(
        &st.pool,
        &RES.table,
        r#"WHERE "isActive" = 1"#,
        r#""name" COLLATE NOCASE"#,
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

pub async fn delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &RES, &H, &id).await
}
