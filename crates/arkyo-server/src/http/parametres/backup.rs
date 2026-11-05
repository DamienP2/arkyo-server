//! Backup and restore of the catalogue, format `arkyo-backup` v1:
//! arkyo:app/api/tenant/parametres/backup/{route,_lib,summary/route,
//! restore/route}.ts and arkyo:lib/services/backup.ts.
//!
//! Single catalogue: the backup holds the whole local catalogue and its
//! referentials (all of them are the site's own). Sections, field
//! allow-lists, restore modes (`merge` = upsert by id, `replace` = purge then
//! recreate with the same ids), order (settings → equipment → cables →
//! adapters) and one transaction per section are arkyo's: a failing section
//! is rolled back alone, the previous ones stay.
//!
//! Additions to arkyo, all tolerated by an arkyo file (unknown fields are
//! ignored, missing ones keep their column default):
//! - the allow-lists carry the columns arkyo's lists forgot or that come
//!   from the merged `Catalog*` models (marked below), so a backup restores
//!   exactly what it saved;
//! - each equipment row carries its `defaultComponents` (the component
//!   slots of a modular host, like `printExportModels` carry their `pages`);
//! - `createdById` is rewritten to the restoring user when the file's
//!   author does not exist here (missing, or not a user of this server);
//!   the seeds' author [`SEED_AUTHOR`] and existing users are kept, so a
//!   backup restored on its own server gives back the same catalogue;
//! - a failing section still logs the audit row and publishes the event
//!   when earlier sections were committed.

use std::collections::{BTreeMap, HashMap, HashSet};

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::numbering::NUMBERING_KEYS;
use super::{
    begin, bind, db_error, failure, get_row, js_type, list_rows_conn, objs, print, require, str_of,
    Obj, Table,
};
use crate::audit;
use crate::catalogue::enrich::{
    ADAPTER, BRAND, CABLE, CABLE_MODEL, CATEGORY, CONNECTOR_TYPE, EQUIPMENT, FUNCTION, PHASE,
    SIGNAL, TYPE,
};
use crate::catalogue::import::js_number_string;
use crate::http::{error, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};
use crate::users::User;

/// Request body limit of the restore route (the whole backup file).
pub const MAX_BODY: usize = 64 * 1024 * 1024;

// ── format ──────────────────────────────────────────────────────────────────

/// `BACKUP_SECTIONS` keys, in arkyo's order.
const SECTIONS: [&str; 4] = ["equipment", "cables", "adapters", "settings"];
/// Restore order (`SECTION_ORDER`).
const SECTION_ORDER: [&str; 4] = ["settings", "equipment", "cables", "adapters"];

fn section_label(s: &str) -> &'static str {
    match s {
        "equipment" => "Équipements",
        "cables" => "Câbles",
        "adapters" => "Adaptateurs",
        _ => "Paramètres",
    }
}

// ── allow-lists (`_lib.ts`) ─────────────────────────────────────────────────

#[rustfmt::skip]
const EQUIPMENT_FIELDS: &[&str] = &[
    "id", "name", "reference", "brandId", "categoryId", "typeId",
    "clonedFromArkyoId", "shadowsArkyo", "clonedFromArkyoVersion",
    "isRackable", "heightU", "depthMm", "widthFraction",
    "dimLmm", "dimWmm", "dimHmm", "weight", "powerW", "heatBtuH",
    "hasDualPsu", "is2110", "ip2110Mode", "isLightingFixture",
    "dmxChannelsDefault", "dmxModes", "connectors", "signalCapacities",
    "customFields", "imageUrl", "iconUrl", "rackSymbolUrl", "rackSymbolRearUrl",
    "rackPhotoFrontUrl", "rackPhotoRearUrl", "schemaImageUrl", "frontImageUrl",
    "rearImageUrl", "documents", "notes", "tags", "isActive", "createdById",
    "createdAt", "updatedAt", "functionIds", "phaseIds",
    // arkyo-server: TenantEquipment columns missing from arkyo's list.
    "rearCableDepthMm", "isComponentHost", "hostSlotCount", "isComponent",
    "componentSlotSpan",
];

#[rustfmt::skip]
const CABLE_FIELDS: &[&str] = &[
    "id", "name", "reference", "leftConnectorId", "leftGender",
    "rightConnectorId", "rightGender", "functionId", "brandId", "model",
    "cableModelId", "useCases", "availableLengths", "customMinLength",
    "customMaxLength", "notes", "imageUrl", "isActive", "sortOrder",
    "clonedFromArkyoId", "shadowsArkyo", "clonedFromArkyoVersion",
    "createdById", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const ADAPTER_FIELDS: &[&str] = &[
    "id", "name", "reference", "functionId", "inputs", "outputs", "notes",
    "imageUrl", "isActive", "clonedFromArkyoId", "shadowsArkyo",
    "clonedFromArkyoVersion", "createdById", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const BRAND_FIELDS: &[&str] = &[
    "id", "name", "website", "logoUrl", "isActive", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const EQUIPMENT_CATEGORY_FIELDS: &[&str] = &[
    "id", "name", "color", "iconId", "parentId", "sortOrder", "isActive",
    "createdAt", "updatedAt",
];

#[rustfmt::skip]
const CONNECTOR_TYPE_FIELDS: &[&str] = &[
    "id", "name", "versions", "iconId", "svgUrl", "color", "functionIds",
    "isActive", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const SIGNAL_TYPE_FIELDS: &[&str] = &[
    "id", "name", "color", "functionId", "cablePrefix", "cableSuffix",
    "bandwidth", "requiredImpedance", "minBandwidthMHz", "connectorIds",
    "isIp", "supportsRedundancy", "redundancyStyle", "usesMulticast",
    "isActive", "createdAt", "updatedAt",
    // arkyo-server: merged from CatalogSignalType (decision 3).
    "isDefault", "sortOrder",
];

#[rustfmt::skip]
const FUNCTION_FIELDS: &[&str] = &[
    "id", "key", "label", "color", "sortOrder", "isActive", "createdAt", "updatedAt",
    // arkyo-server: merged from CatalogFunction (decision 3).
    "cablePrefix", "cableSuffix", "systemCategory",
];

#[rustfmt::skip]
const PHASE_FIELDS: &[&str] = &[
    "id", "key", "label", "sortOrder", "isActive", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const TYPE_FIELDS: &[&str] = &[
    "id", "name", "functionId", "parentId", "sortOrder", "isActive",
    "createdAt", "updatedAt",
    // arkyo-server: merged from CatalogType (decision 3).
    "iconId", "schemaImageUrl",
];

#[rustfmt::skip]
const DIMENSION_PRESET_FIELDS: &[&str] = &[
    "id", "category", "value", "unit", "isReel", "isActive", "sortOrder",
    "createdAt", "updatedAt",
];

#[rustfmt::skip]
const CABLE_MODEL_FIELDS: &[&str] = &[
    "id", "name", "reference", "functionId", "brandId", "impedance",
    "bandwidthMHz", "diameterMm", "conductor", "shielding", "jacketMaterial",
    "fireRating", "customFields", "imageUrl", "datasheetUrl", "notes",
    "isActive", "sortOrder", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const CABLE_LABEL_STOCK_FIELDS: &[&str] = &[
    "id", "name", "reference", "brandId", "description", "datasheetUrl",
    "paperFormat", "orientation", "pageMarginTop", "pageMarginRight",
    "pageMarginBottom", "pageMarginLeft", "columns", "rows", "gutterX",
    "gutterY", "labelWidth", "labelHeight", "printableHeight", "wrapHeight",
    "printablePadding", "printableColor", "cableDiameterMin",
    "cableDiameterMax", "isActive", "sortOrder", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const PRINT_TEMPLATE_FIELDS: &[&str] = &[
    "id", "key", "name", "description", "paperFormat", "orientation", "slots",
    "layout", "isActive", "sortOrder", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const PRINT_EXPORT_MODEL_FIELDS: &[&str] = &[
    "id", "key", "name", "description", "isActive", "sortOrder", "createdAt", "updatedAt",
];

#[rustfmt::skip]
const PRINT_EXPORT_PAGE_FIELDS: &[&str] = &["id", "kind", "layout", "createdAt", "updatedAt"];

#[rustfmt::skip]
const EXPORT_TEMPLATE_FIELDS: &[&str] = &["id", "scope", "name", "columns", "createdAt", "updatedAt"];

/// arkyo-server: the component slots nested in an equipment row.
#[rustfmt::skip]
const COMPONENT_FIELDS: &[&str] = &["id", "componentId", "slotIndex", "createdAt"];

static EXPORT_TEMPLATE: Table = Table {
    name: "ExportTemplate",
    bools: &[],
    jsons: &["columns"],
};
static APP_CONFIG: Table = Table {
    name: "AppConfig",
    bools: &[],
    jsons: &[],
};
static COMPONENT: Table = Table {
    name: "TenantEquipmentComponent",
    bools: &[],
    jsons: &[],
};

/// The "simple" settings models, in arkyo's restore order around the two
/// special ones (`categories` second, `printExportModels` and `appConfig`
/// last).
struct Model {
    key: &'static str,
    table: &'static Table,
    fields: &'static [&'static str],
}

fn settings_models() -> [Model; 10] {
    [
        Model {
            key: "brands",
            table: BRAND,
            fields: BRAND_FIELDS,
        },
        Model {
            key: "connectors",
            table: CONNECTOR_TYPE,
            fields: CONNECTOR_TYPE_FIELDS,
        },
        Model {
            key: "signals",
            table: SIGNAL,
            fields: SIGNAL_TYPE_FIELDS,
        },
        Model {
            key: "functions",
            table: FUNCTION,
            fields: FUNCTION_FIELDS,
        },
        Model {
            key: "phases",
            table: PHASE,
            fields: PHASE_FIELDS,
        },
        Model {
            key: "types",
            table: TYPE,
            fields: TYPE_FIELDS,
        },
        Model {
            key: "dimensionPresets",
            table: &super::dimensions::RES.table,
            fields: DIMENSION_PRESET_FIELDS,
        },
        Model {
            key: "cableModels",
            table: CABLE_MODEL,
            fields: CABLE_MODEL_FIELDS,
        },
        Model {
            key: "cableLabelStocks",
            table: &print::STOCK.table,
            fields: CABLE_LABEL_STOCK_FIELDS,
        },
        Model {
            key: "printTemplates",
            table: &print::TEMPLATE.table,
            fields: PRINT_TEMPLATE_FIELDS,
        },
    ]
}

fn main_table(section: &str) -> (&'static Table, &'static [&'static str]) {
    match section {
        "equipment" => (&EQUIPMENT, EQUIPMENT_FIELDS),
        "cables" => (&CABLE, CABLE_FIELDS),
        _ => (&ADAPTER, ADAPTER_FIELDS),
    }
}

// ── GET /backup ─────────────────────────────────────────────────────────────

/// `parseSections`: the known sections of `?sections=`, all when none.
fn parse_sections(param: Option<&String>) -> Vec<&'static str> {
    let asked: Vec<&str> = param
        .map(|p| p.split(',').map(str::trim).collect())
        .unwrap_or_default();
    let mut out: Vec<&'static str> = Vec::new();
    for s in asked {
        if let Some(k) = SECTIONS.iter().find(|k| **k == s) {
            out.push(k);
        }
    }
    if out.is_empty() {
        SECTIONS.to_vec()
    } else {
        out
    }
}

async fn all(conn: &mut SqliteConnection, t: &Table) -> Result<Vec<Obj>, sqlx::Error> {
    list_rows_conn(conn, t, "", r#""id""#).await
}

/// Rows of `t` grouped by `parent` (component slots, export pages).
async fn children(
    conn: &mut SqliteConnection,
    t: &Table,
    parent: &str,
    order: &str,
) -> Result<HashMap<String, Vec<Value>>, sqlx::Error> {
    let mut by: HashMap<String, Vec<Value>> = HashMap::new();
    for r in list_rows_conn(conn, t, "", order).await? {
        let key = str_of(&r, parent).unwrap_or("").to_string();
        by.entry(key).or_default().push(Value::Object(r));
    }
    Ok(by)
}

async fn dump(conn: &mut SqliteConnection, sections: &[&str]) -> Result<Obj, sqlx::Error> {
    let mut data = Obj::new();
    if sections.contains(&"equipment") {
        let mut comps = children(conn, &COMPONENT, "hostId", r#""hostId", "slotIndex""#).await?;
        let mut rows = all(conn, &EQUIPMENT).await?;
        for r in &mut rows {
            let id = str_of(r, "id").unwrap_or("").to_string();
            r.insert(
                "defaultComponents".into(),
                Value::Array(comps.remove(&id).unwrap_or_default()),
            );
        }
        data.insert("equipment".into(), objs(rows));
    }
    if sections.contains(&"cables") {
        data.insert("cables".into(), objs(all(conn, &CABLE).await?));
    }
    if sections.contains(&"adapters") {
        data.insert("adapters".into(), objs(all(conn, &ADAPTER).await?));
    }
    if sections.contains(&"settings") {
        let mut s = Obj::new();
        for m in settings_models() {
            s.insert(m.key.into(), objs(all(conn, m.table).await?));
        }
        s.insert("categories".into(), objs(all(conn, CATEGORY).await?));
        let mut pages = children(conn, &print::PAGE_TABLE, "modelId", r#""id""#).await?;
        let mut models = all(conn, &print::MODEL_TABLE).await?;
        for m in &mut models {
            let id = str_of(m, "id").unwrap_or("").to_string();
            m.insert(
                "pages".into(),
                Value::Array(pages.remove(&id).unwrap_or_default()),
            );
        }
        s.insert("printExportModels".into(), objs(models));
        s.insert(
            "exportTemplates".into(),
            objs(all(conn, &EXPORT_TEMPLATE).await?),
        );
        let cfg = list_rows_conn(conn, &APP_CONFIG, "", r#""key""#)
            .await?
            .into_iter()
            .filter(|r| str_of(r, "key").is_some_and(|k| NUMBERING_KEYS.contains(&k)))
            .collect();
        s.insert("appConfig".into(), objs(cfg));
        data.insert("settings".into(), Value::Object(s));
    }
    Ok(data)
}

/// GET /api/tenant/parametres/backup?sections=…: the JSON file, as an
/// attachment `arkyo-sauvegarde-AAAA-MM-JJ.json`.
pub async fn download(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let sections = parse_sections(q.get("sections"));
    let run = async {
        let mut conn = st.pool.acquire().await?;
        dump(&mut conn, &sections).await
    };
    let data = match run.await {
        Ok(d) => d,
        Err(e) => return db_error(e),
    };
    let backup = json!({
        "meta": { "format": "arkyo-backup", "version": 1, "exportedAt": now_iso(),
                  "sections": sections },
        "data": data,
    });
    let date = jiff::Zoned::now().strftime("%Y-%m-%d").to_string();
    let body = serde_json::to_string_pretty(&backup).unwrap_or_default();
    (
        [
            (
                header::CONTENT_TYPE,
                "application/json; charset=utf-8".to_string(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"arkyo-sauvegarde-{date}.json\""),
            ),
        ],
        body,
    )
        .into_response()
}

// ── GET /backup/summary ─────────────────────────────────────────────────────

async fn count(conn: &mut SqliteConnection, table: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(&format!(r#"SELECT COUNT(*) FROM "{table}""#))
        .fetch_one(conn)
        .await
}

/// GET /api/tenant/parametres/backup/summary: `{ equipment, cables,
/// adapters, settings }` (settings = sum over the settings models).
pub async fn summary(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let run = async {
        let mut c = st.pool.acquire().await?;
        let equipment = count(&mut c, EQUIPMENT.name).await?;
        let cables = count(&mut c, CABLE.name).await?;
        let adapters = count(&mut c, ADAPTER.name).await?;
        let mut settings = 0;
        for m in settings_models() {
            settings += count(&mut c, m.table.name).await?;
        }
        for t in [CATEGORY.name, print::MODEL_TABLE.name, EXPORT_TEMPLATE.name] {
            settings += count(&mut c, t).await?;
        }
        let keys: Vec<String> = sqlx::query_scalar(r#"SELECT "key" FROM "AppConfig""#)
            .fetch_all(&mut *c)
            .await?;
        settings += keys
            .iter()
            .filter(|k| NUMBERING_KEYS.contains(&k.as_str()))
            .count() as i64;
        Ok::<_, sqlx::Error>(json!({
            "equipment": equipment, "cables": cables, "adapters": adapters, "settings": settings
        }))
    };
    match run.await {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_error(e),
    }
}

// ── POST /backup/restore ────────────────────────────────────────────────────

/// `String(value)` of JavaScript, for the messages quoting file values.
fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.as_f64().map(js_number_string).unwrap_or_default(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| {
                if x.is_null() {
                    String::new()
                } else {
                    js_string(Some(x))
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// `validateBackupFile`: the envelope only (`meta`, `data`, section types).
fn validate_backup(raw: &Value) -> Result<&Obj, String> {
    let Value::Object(obj) = raw else {
        return Err("Fichier invalide : ce n'est pas un objet JSON.".into());
    };
    let Some(Value::Object(meta)) = obj.get("meta") else {
        return Err("Fichier invalide : section « meta » manquante ou incorrecte.".into());
    };
    if meta.get("format") != Some(&Value::String("arkyo-backup".into())) {
        return Err("Ce fichier n'est pas une sauvegarde Arkyo (format inconnu).".into());
    }
    if meta.get("version").and_then(Value::as_f64) != Some(1.0) {
        return Err(format!(
            "Version de sauvegarde non prise en charge ({}).",
            js_string(meta.get("version"))
        ));
    }
    match meta.get("exportedAt") {
        Some(Value::String(s)) if !crate::catalogue::import::js_trim(s).is_empty() => {}
        _ => return Err("Fichier invalide : date d'export manquante.".into()),
    }
    let sections = match meta.get("sections") {
        Some(Value::Array(a)) if !a.is_empty() => a,
        _ => return Err("Fichier invalide : aucune section déclarée.".into()),
    };
    for s in sections {
        if !s.as_str().is_some_and(|s| SECTIONS.contains(&s)) {
            return Err(format!(
                "Fichier invalide : section inconnue « {} ».",
                js_string(Some(s))
            ));
        }
    }
    let Some(Value::Object(data)) = obj.get("data") else {
        return Err("Fichier invalide : section « data » manquante ou incorrecte.".into());
    };
    for key in ["equipment", "cables", "adapters"] {
        if data.get(key).is_some_and(|v| !v.is_array()) {
            return Err(format!(
                "Fichier invalide : la section « {key} » doit être une liste."
            ));
        }
    }
    if let Some(settings) = data.get("settings") {
        let Value::Object(s) = settings else {
            return Err("Fichier invalide : la section « settings » doit être un objet.".into());
        };
        for (k, v) in s {
            if !v.is_array() {
                return Err(format!(
                    "Fichier invalide : « settings.{k} » doit être une liste."
                ));
            }
        }
    }
    Ok(data)
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Merge,
    Replace,
}

#[derive(Default, Serialize)]
struct Report {
    created: i64,
    updated: i64,
    deleted: i64,
}

impl Report {
    fn add(&mut self, r: Report) {
        self.created += r.created;
        self.updated += r.updated;
        self.deleted += r.deleted;
    }
}

/// `pickFields`: the allowed fields of an object row (others ignored).
fn pick(row: &Value, allowed: &[&str]) -> Option<Obj> {
    let Value::Object(o) = row else {
        return None;
    };
    Some(
        allowed
            .iter()
            .filter_map(|f| o.get(*f).map(|v| ((*f).to_string(), v.clone())))
            .collect(),
    )
}

/// Picked rows with a non-empty string `id`.
fn valid_rows<'a>(
    rows: &'a [Value],
    allowed: &'a [&str],
) -> impl Iterator<Item = (Obj, &'a Value)> + 'a {
    rows.iter().filter_map(move |raw| {
        let p = pick(raw, allowed)?;
        str_of(&p, "id").filter(|id| !id.is_empty())?;
        Some((p, raw))
    })
}

/// Column value: JSON columns are stored as JSON text (null stays NULL).
fn column_value(t: &Table, key: &str, v: &Value) -> Value {
    if t.jsons.contains(&key) && !v.is_null() {
        Value::String(v.to_string())
    } else {
        v.clone()
    }
}

async fn exists(conn: &mut SqliteConnection, t: &Table, id: &str) -> Result<bool, sqlx::Error> {
    Ok(get_row(conn, t, id).await?.is_some())
}

async fn execute(
    conn: &mut SqliteConnection,
    sql: &str,
    values: Vec<Value>,
) -> Result<(), sqlx::Error> {
    let mut q = sqlx::query(sql);
    for v in &values {
        q = bind(q, v);
    }
    q.execute(conn).await.map(|_| ())
}

/// `create({ data })`: the row's fields, `createdAt`/`updatedAt` defaulting
/// to now like Prisma.
async fn insert(conn: &mut SqliteConnection, t: &Table, mut data: Obj) -> Result<(), sqlx::Error> {
    let now = now_iso();
    // Every restored table has both columns but the component slots
    // (`createdAt` only).
    let stamps: &[&str] = if t.name == COMPONENT.name {
        &["createdAt"]
    } else {
        &["createdAt", "updatedAt"]
    };
    for k in stamps {
        if !data.contains_key(*k) {
            data.insert((*k).into(), Value::String(now.clone()));
        }
    }
    let cols: Vec<String> = data.keys().map(|k| format!("\"{k}\"")).collect();
    let values = data.iter().map(|(k, v)| column_value(t, k, v)).collect();
    let sql = format!(
        r#"INSERT INTO "{}" ({}) VALUES ({})"#,
        t.name,
        cols.join(", "),
        vec!["?"; cols.len()].join(", ")
    );
    execute(conn, &sql, values).await
}

/// `update({ where: { id }, data })`: `updatedAt` defaults to now.
async fn update(
    conn: &mut SqliteConnection,
    t: &Table,
    id: &str,
    mut data: Obj,
) -> Result<(), sqlx::Error> {
    data.remove("id");
    if !data.contains_key("updatedAt") {
        data.insert("updatedAt".into(), Value::String(now_iso()));
    }
    let sets: Vec<String> = data.keys().map(|k| format!("\"{k}\" = ?")).collect();
    let mut values: Vec<Value> = data.iter().map(|(k, v)| column_value(t, k, v)).collect();
    values.push(Value::String(id.into()));
    let sql = format!(
        r#"UPDATE "{}" SET {} WHERE "id" = ?"#,
        t.name,
        sets.join(", ")
    );
    execute(conn, &sql, values).await
}

async fn delete_all(conn: &mut SqliteConnection, t: &Table) -> Result<i64, sqlx::Error> {
    let r = sqlx::query(&format!(r#"DELETE FROM "{}""#, t.name))
        .execute(conn)
        .await?;
    Ok(r.rows_affected() as i64)
}

/// `createdById` of the seeded cords and adapters (`tools/extract-seeds`):
/// no user, kept as is by a restore.
const SEED_AUTHOR: &str = "system";

/// Authors a restored row may keep: every user of this server plus
/// [`SEED_AUTHOR`]. Loaded once per section.
async fn known_authors(conn: &mut SqliteConnection) -> Result<HashSet<String>, sqlx::Error> {
    let mut ids: HashSet<String> = sqlx::query_scalar(r#"SELECT "id" FROM "User""#)
        .fetch_all(&mut *conn)
        .await?
        .into_iter()
        .collect();
    ids.insert(SEED_AUTHOR.into());
    Ok(ids)
}

/// Author of a restored row: the file's one when it is in `known`, else
/// `fallback` (the restoring user).
fn author_of(data: &Obj, known: &HashSet<String>, fallback: &str) -> String {
    match str_of(data, "createdById") {
        Some(by) if known.contains(by) => by.into(),
        _ => fallback.into(),
    }
}

/// `restoreSimpleModel`, with `createdById` resolved by [`author_of`]
/// when `author` is given.
async fn restore_simple(
    conn: &mut SqliteConnection,
    t: &Table,
    rows: &[Value],
    allowed: &[&str],
    mode: Mode,
    author: Option<&str>,
) -> Result<Report, sqlx::Error> {
    let mut rep = Report::default();
    if mode == Mode::Replace {
        rep.deleted = delete_all(conn, t).await?;
    }
    let known = match author {
        Some(_) => known_authors(conn).await?,
        None => HashSet::new(),
    };
    for (mut data, raw) in valid_rows(rows, allowed) {
        let id = str_of(&data, "id").unwrap_or("").to_string();
        if let Some(a) = author {
            let by = author_of(&data, &known, a);
            data.insert("createdById".into(), Value::String(by));
        }
        if mode == Mode::Replace || !exists(conn, t, &id).await? {
            insert(conn, t, data).await?;
            rep.created += 1;
        } else {
            update(conn, t, &id, data).await?;
            rep.updated += 1;
        }
        if t.name == EQUIPMENT.name {
            restore_components(conn, &id, raw).await?;
        }
    }
    Ok(rep)
}

/// arkyo-server: the host's component slots follow the file when the row
/// carries `defaultComponents` (an arkyo file does not: slots untouched).
async fn restore_components(
    conn: &mut SqliteConnection,
    host: &str,
    raw: &Value,
) -> Result<(), sqlx::Error> {
    let Some(Value::Array(items)) = raw.get("defaultComponents") else {
        return Ok(());
    };
    sqlx::query(r#"DELETE FROM "TenantEquipmentComponent" WHERE "hostId" = ?"#)
        .bind(host)
        .execute(&mut *conn)
        .await?;
    for (mut c, _) in valid_rows(items, COMPONENT_FIELDS) {
        c.insert("hostId".into(), Value::String(host.into()));
        insert(conn, &COMPONENT, c).await?;
    }
    Ok(())
}

/// Self-referencing `parentId`: rows first without it, then the links.
async fn restore_categories(
    conn: &mut SqliteConnection,
    rows: &[Value],
    mode: Mode,
) -> Result<Report, sqlx::Error> {
    let base: Vec<&str> = EQUIPMENT_CATEGORY_FIELDS
        .iter()
        .copied()
        .filter(|f| *f != "parentId")
        .collect();
    let rep = restore_simple(conn, CATEGORY, rows, &base, mode, None).await?;
    for (p, _) in valid_rows(rows, EQUIPMENT_CATEGORY_FIELDS) {
        let Some(parent) = p.get("parentId") else {
            continue;
        };
        sqlx::query(r#"UPDATE "TenantEquipmentCategory" SET "parentId" = ? WHERE "id" = ?"#)
            .bind(parent.as_str())
            .bind(str_of(&p, "id"))
            .execute(&mut *conn)
            .await?;
    }
    Ok(rep)
}

/// Models with their nested `pages` (merge: model updated, pages replaced).
async fn restore_export_models(
    conn: &mut SqliteConnection,
    rows: &[Value],
    mode: Mode,
) -> Result<Report, sqlx::Error> {
    let mut rep = Report::default();
    if mode == Mode::Replace {
        rep.deleted = delete_all(conn, &print::MODEL_TABLE).await?;
    }
    for (data, raw) in valid_rows(rows, PRINT_EXPORT_MODEL_FIELDS) {
        let id = str_of(&data, "id").unwrap_or("").to_string();
        let pages: Vec<Obj> = match raw.get("pages") {
            Some(Value::Array(p)) => valid_rows(p, PRINT_EXPORT_PAGE_FIELDS)
                .map(|(mut p, _)| {
                    p.insert("modelId".into(), Value::String(id.clone()));
                    p
                })
                .collect(),
            _ => vec![],
        };
        if mode == Mode::Replace || !exists(conn, &print::MODEL_TABLE, &id).await? {
            insert(conn, &print::MODEL_TABLE, data).await?;
            rep.created += 1;
        } else {
            update(conn, &print::MODEL_TABLE, &id, data).await?;
            sqlx::query(r#"DELETE FROM "TenantPrintExportPage" WHERE "modelId" = ?"#)
                .bind(&id)
                .execute(&mut *conn)
                .await?;
            rep.updated += 1;
        }
        for p in pages {
            insert(conn, &print::PAGE_TABLE, p).await?;
        }
    }
    Ok(rep)
}

/// Upsert by key of the numbering keys only (merge and replace alike).
async fn restore_app_config(
    conn: &mut SqliteConnection,
    rows: &[Value],
) -> Result<Report, sqlx::Error> {
    let mut rep = Report::default();
    for raw in rows {
        let (Some(key), Some(value)) = (
            raw.get("key").and_then(Value::as_str),
            raw.get("value").and_then(Value::as_str),
        ) else {
            continue;
        };
        if !NUMBERING_KEYS.contains(&key) {
            continue;
        }
        let found: Option<String> =
            sqlx::query_scalar(r#"SELECT "id" FROM "AppConfig" WHERE "key" = ?"#)
                .bind(key)
                .fetch_optional(&mut *conn)
                .await?;
        sqlx::query(
            r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES (?,?,?,?)
               ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt""#,
        )
        .bind(new_id())
        .bind(key)
        .bind(value)
        .bind(now_iso())
        .execute(&mut *conn)
        .await?;
        if found.is_some() {
            rep.updated += 1;
        } else {
            rep.created += 1;
        }
    }
    Ok(rep)
}

async fn restore_settings(
    conn: &mut SqliteConnection,
    s: &Obj,
    mode: Mode,
) -> Result<Report, sqlx::Error> {
    let mut agg = Report::default();
    let rows = |k: &str| s.get(k).and_then(Value::as_array).map(Vec::as_slice);
    let models = settings_models();
    let simple = |k: &str| models.iter().find(|m| m.key == k).expect("model");
    // arkyo's order: brands, categories, connectors, signals, functions,
    // phases, types, dimensionPresets, cableModels, cableLabelStocks,
    // printTemplates, printExportModels, exportTemplates, appConfig.
    for key in [
        "brands",
        "categories",
        "connectors",
        "signals",
        "functions",
        "phases",
        "types",
        "dimensionPresets",
        "cableModels",
        "cableLabelStocks",
        "printTemplates",
        "printExportModels",
        "exportTemplates",
        "appConfig",
    ] {
        let Some(r) = rows(key) else {
            continue;
        };
        let rep = match key {
            "categories" => restore_categories(conn, r, mode).await?,
            "printExportModels" => restore_export_models(conn, r, mode).await?,
            "exportTemplates" => {
                restore_simple(
                    conn,
                    &EXPORT_TEMPLATE,
                    r,
                    EXPORT_TEMPLATE_FIELDS,
                    mode,
                    None,
                )
                .await?
            }
            "appConfig" => restore_app_config(conn, r).await?,
            k => {
                let m = simple(k);
                restore_simple(conn, m.table, r, m.fields, mode, None).await?
            }
        };
        agg.add(rep);
    }
    Ok(agg)
}

/// `restoreBodySchema`: `{ modes: { [section]?: "merge"|"replace" },
/// backup: unknown }`.
#[allow(clippy::result_large_err)]
fn parse_restore_body(body: &[u8]) -> Result<(HashMap<&'static str, Mode>, Value), Response> {
    let mut o = match serde_json::from_slice(body).unwrap_or(Value::Null) {
        Value::Object(o) => o,
        other => {
            return Err(failure((
                vec![format!(
                    "Invalid input: expected object, received {}",
                    js_type(Some(&other))
                )],
                BTreeMap::new(),
            )))
        }
    };
    let modes_error =
        |msg: String| failure((vec![], BTreeMap::from([("modes".to_string(), vec![msg])])));
    let Some(Value::Object(modes)) = o.get("modes") else {
        return Err(modes_error(format!(
            "Invalid input: expected object, received {}",
            js_type(o.get("modes"))
        )));
    };
    let mut out = HashMap::new();
    for s in SECTIONS {
        let mode = match modes.get(s).map(|v| v.as_str()) {
            None => continue,
            Some(Some("merge")) => Mode::Merge,
            Some(Some("replace")) => Mode::Replace,
            Some(_) => {
                return Err(modes_error(
                    r#"Invalid option: expected one of "merge"|"replace""#.into(),
                ))
            }
        };
        out.insert(s, mode);
    }
    Ok((out, o.remove("backup").unwrap_or(Value::Null)))
}

/// `formatSectionError`.
fn section_error(section: &str, detail: &str) -> String {
    format!(
        "Échec de la restauration de la section « {} » : {detail}. Cette section a été annulée (rollback) ; les sections déjà restaurées avant celle-ci restent en base.",
        section_label(section)
    )
}

async fn restore_section(
    st: &AppState,
    user: &User,
    section: &str,
    data: &Obj,
    mode: Mode,
) -> Result<Option<Report>, String> {
    let run = async {
        let mut tx = st.pool.begin_with("BEGIN IMMEDIATE").await?;
        let rep = if section == "settings" {
            let Some(Value::Object(s)) = data.get("settings") else {
                return Ok(None);
            };
            restore_settings(&mut tx, s, mode).await?
        } else {
            let Some(Value::Array(rows)) = data.get(section) else {
                return Ok(None);
            };
            let (t, fields) = main_table(section);
            restore_simple(&mut tx, t, rows, fields, mode, Some(&user.id)).await?
        };
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Some(rep))
    };
    // Dropping the transaction on error rolls the section back.
    run.await.map_err(|e| {
        tracing::warn!("restauration {section}: {e}");
        e.to_string()
    })
}

/// Audit row and event of a restore that committed at least one section.
async fn record(st: &AppState, user: &User, report: &Obj) -> Result<(), Response> {
    let mut tx = begin(&st.pool).await?;
    audit::log(
        &mut tx,
        &user.id,
        "tenant_backup.restore",
        "Backup",
        "restore",
        None,
        None,
        Some(Value::Object(report.clone())),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events
        .publish("tenant_parametres_backup", "restore", None);
    Ok(())
}

/// POST /api/tenant/parametres/backup/restore.
pub async fn restore(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    let run = async {
        require(&u, &st.pool, Domain::Settings, Level::Write).await?;
        let (modes, backup) = parse_restore_body(&body)?;
        let data = validate_backup(&backup).map_err(|m| error(StatusCode::BAD_REQUEST, &m))?;
        let mut report = Obj::new();
        for section in SECTION_ORDER {
            let Some(&mode) = modes.get(section) else {
                continue;
            };
            match restore_section(&st, &u, section, data, mode).await {
                Ok(Some(rep)) => {
                    report.insert(section.into(), json!(rep));
                }
                Ok(None) => {}
                Err(detail) => {
                    if !report.is_empty() {
                        record(&st, &u, &report).await?;
                    }
                    return Err(error(
                        StatusCode::BAD_REQUEST,
                        &section_error(section, &detail),
                    ));
                }
            }
        }
        record(&st, &u, &report).await?;
        Ok(Json(json!({ "report": report })).into_response())
    };
    run.await.unwrap_or_else(|r: Response| r)
}
