//! arkyo:app/api/tenant/parametres/connectors/{route,[id]/route}.ts and
//! arkyo:app/api/_lib/connector-dtype.ts (derived `hasNeutrikD`).

use arkyo_core::permissions::Domain;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;
use sqlx::{Row, SqliteConnection};

use super::{
    arkyo_personal, case_only_duplicate, db_error, list_rows, refuse_if_used, str_of, Def, Field,
    Fut, Hooks, Kind, Obj, Res, Table, NAME,
};
use crate::catalogue::in_use;
use crate::http::{AppState, CurrentUser};

/// arkyo:components/ui/connector-icon.tsx `D_TYPE_KEYS`: built-in symbols
/// drawn by code that have a "D" (Neutrik) version.
pub const D_TYPE_KEYS: [&str; 18] = [
    "xlr3", "xlr4", "xlr5", "rj45", "powercon", "true1", "speakon", "bnc", "rca", "jack635",
    "jack35", "usba", "usbb", "usbc", "hdmi", "lc", "din5", "toslink",
];

static CREATE: [Field; 7] = [
    Field::new("name", NAME).required(),
    Field::new("versions", Kind::StrArr).or(Def::EmptyArr),
    Field::new("iconId", Kind::Str).nullable(),
    Field::new("svgUrl", Kind::Asset).nullable(),
    Field::new("color", Kind::Str).nullable(),
    Field::new("functionIds", Kind::StrArr).or(Def::EmptyArr),
    Field::new("isActive", Kind::Bool).or(Def::True),
];

static PATCH: [Field; 7] = [
    Field::new("name", NAME),
    Field::new("versions", Kind::StrArr),
    Field::new("iconId", Kind::Str).nullable(),
    Field::new("svgUrl", Kind::Asset).nullable(),
    Field::new("color", Kind::Str).nullable(),
    Field::new("functionIds", Kind::StrArr),
    Field::new("isActive", Kind::Bool),
];

pub static RES: Res = Res {
    table: Table {
        name: "TenantConnectorType",
        bools: &["isActive"],
        jsons: &["versions", "functionIds"],
    },
    entity: "tenant_parametres_connectors",
    audit: "tenant_connector_type",
    audit_type: "TenantConnectorType",
    not_found: "Type de connecteur introuvable.",
    unique_msg: "Un type de connecteur avec ce nom existe déjà dans votre espace.",
    domain: Domain::Settings,
    create: &CREATE,
    patch: &PATCH,
};

struct Symbol {
    key: String,
    svg_url: Option<String>,
    svg_url_d: Option<String>,
    builtin: bool,
}

async fn load_symbols(conn: &mut SqliteConnection) -> Result<Vec<Symbol>, sqlx::Error> {
    let rows =
        sqlx::query(r#"SELECT "key", "svgUrl", "svgUrlD", "isBuiltin" FROM "CatalogSymbol""#)
            .fetch_all(conn)
            .await?;
    Ok(rows
        .iter()
        .map(|r| Symbol {
            key: r.get("key"),
            svg_url: r.get("svgUrl"),
            svg_url_d: r.get("svgUrlD"),
            builtin: r.get::<i64, _>("isBuiltin") != 0,
        })
        .collect())
}

/// `deriveHasNeutrikD`: from the symbol the connector references.
fn has_neutrik_d(icon_id: Option<&str>, svg_url: Option<&str>, symbols: &[Symbol]) -> bool {
    let found = symbols.iter().find(|s| {
        icon_id.is_some_and(|i| s.key == i || s.svg_url.as_deref() == Some(i))
            || svg_url.is_some_and(|u| s.svg_url.as_deref() == Some(u))
    });
    match found {
        Some(s) => s.svg_url_d.is_some() || (s.builtin && D_TYPE_KEYS.contains(&s.key.as_str())),
        None => icon_id.is_some_and(|i| D_TYPE_KEYS.contains(&i)),
    }
}

fn derive(row: &mut Obj, symbols: &[Symbol]) {
    let d = has_neutrik_d(str_of(row, "iconId"), str_of(row, "svgUrl"), symbols);
    row.insert("hasNeutrikD".into(), Value::Bool(d));
}

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
                    "TenantConnectorType",
                    "name",
                    name,
                    own,
                    "Ce connecteur existe déjà dans le catalogue Arkyo.",
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
                in_use::connector_type(conn, id).await,
                |n, _| {
                    format!("Ce type de connecteur est utilisé par {n} cordon(s) du catalogue personnel et ne peut pas être supprimé.")
                },
                true,
            )
        })
    }

    fn present<'a>(&'a self, conn: &'a mut SqliteConnection, row: &'a mut Obj) -> Fut<'a, ()> {
        Box::pin(async move {
            let symbols = load_symbols(conn).await.unwrap_or_default();
            derive(row, &symbols);
        })
    }
}

pub async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await?;
        let symbols = load_symbols(&mut conn).await?;
        let mut rows = list_rows(
            &st.pool,
            &RES.table,
            r#"WHERE "isActive" = 1"#,
            r#""name" COLLATE NOCASE"#,
        )
        .await?;
        for r in &mut rows {
            derive(r, &symbols);
        }
        Ok::<_, sqlx::Error>(rows)
    };
    match run.await {
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
