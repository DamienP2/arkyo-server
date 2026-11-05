//! Spreadsheet import of equipment:
//! arkyo:app/api/tenant/parametres/import/{analyze,preview,commit}/route.ts.
//!
//! `catalog:write` (arkyo's 403 body). The engine is
//! [`crate::catalogue::import`]; these handlers read the request, load the
//! referentials and equipment, and write the commit.
//!
//! Single catalogue: `existing` lists only the local brands and categories
//! (`source: "tenant"`), there is no Arkyo catalogue to add.

use std::collections::{BTreeMap, HashMap};

use axum::body::Bytes;
use axum::extract::{FromRequest, Multipart, Request, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Map, Value};
use sqlx::SqliteConnection;

use super::{begin, bind, db_error, failure, fold, js_type, Obj};
use crate::audit;
use crate::catalogue::import::build::{build_equipment_input, BuildRefs};
use crate::catalogue::import::coerce::{coerce_row, ColumnMap};
use crate::catalogue::import::detect::{
    detect_columns, normalize_token, TargetField, ALL_TARGET_FIELDS, DEFAULT_THRESHOLD,
};
use crate::catalogue::import::parse::{normalize_matrix, parse_csv, parse_xlsx, TabularMatrix};
use crate::catalogue::import::preview::{preview_rows, ExistingEquipment};
use crate::catalogue::import::resolve::distinct_values;
use crate::http::catalogue::assert_can_write;
use crate::http::{error, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};

const MAX_ROWS: usize = 5000;
/// 8 Mo of CSV text (`z.string().max(MAX_CSV_BYTES)`).
const MAX_CSV_CHARS: usize = 8 * 1024 * 1024;
/// 12 Mo of file.
const MAX_FILE_BYTES: usize = 12 * 1024 * 1024;
const SAMPLE_ROWS: usize = 50;
/// Request body limit of the three routes: above the 12 Mo file (so that
/// arkyo's 413 message is the one answered) and a 5000-row JSON batch.
pub const MAX_BODY: usize = 32 * 1024 * 1024;
const EVENT: &str = "tenant_catalogue";

// ── Zod-like checks (`parsed.error.flatten()`) ──────────────────────────────

/// `fieldErrors` being built; `formErrors` only for a non-object body.
#[derive(Default)]
struct Errs(BTreeMap<String, Vec<String>>);

impl Errs {
    fn add(&mut self, field: &str, msg: impl Into<String>) {
        self.0.entry(field.into()).or_default().push(msg.into());
    }

    fn into_result(self) -> Result<(), Response> {
        if self.0.is_empty() {
            Ok(())
        } else {
            Err(failure((vec![], self.0)))
        }
    }
}

fn expected(what: &str, got: Option<&Value>) -> String {
    format!("Invalid input: expected {what}, received {}", js_type(got))
}

fn options(values: &[&str]) -> String {
    let list: Vec<String> = values.iter().map(|v| format!("\"{v}\"")).collect();
    format!("Invalid option: expected one of {}", list.join("|"))
}

/// The body as an object; anything else answers Zod's form error (a body
/// that is not JSON is `null`, like `req.json().catch(() => null)`).
fn body_object(body: &[u8]) -> Result<Obj, Response> {
    match serde_json::from_slice::<Value>(body).unwrap_or(Value::Null) {
        Value::Object(o) => Ok(o),
        other => Err(failure((
            vec![expected("object", Some(&other))],
            BTreeMap::new(),
        ))),
    }
}

/// `entity: z.literal("equipment").optional()`.
fn check_entity(o: &Obj, errs: &mut Errs) {
    if let Some(v) = o.get("entity") {
        if v != "equipment" {
            errs.add("entity", "Invalid input: expected \"equipment\"");
        }
    }
}

/// `columns: z.array(z.object({ index: int >= 0, field: enum })).min(1)`.
fn check_columns(o: &Obj, errs: &mut Errs) -> Vec<ColumnMap> {
    let mut out = Vec::new();
    let Some(Value::Array(items)) = o.get("columns") else {
        errs.add("columns", expected("array", o.get("columns")));
        return out;
    };
    if items.is_empty() {
        errs.add("columns", "Too small: expected array to have >=1 items");
    }
    let fields: Vec<&str> = ALL_TARGET_FIELDS.iter().map(|f| f.as_str()).collect();
    for it in items {
        let Value::Object(c) = it else {
            errs.add("columns", expected("object", Some(it)));
            continue;
        };
        let index = match c.get("index") {
            Some(Value::Number(n)) => match n.as_f64() {
                Some(f) if f.fract() != 0.0 => {
                    errs.add("columns", "Invalid input: expected int, received number");
                    None
                }
                Some(f) if f < 0.0 => {
                    errs.add("columns", "Too small: expected number to be >=0");
                    None
                }
                Some(f) => Some(f as usize),
                None => None,
            },
            other => {
                errs.add("columns", expected("number", other));
                None
            }
        };
        let field = match c
            .get("field")
            .and_then(Value::as_str)
            .and_then(TargetField::parse)
        {
            Some(f) => Some(f),
            None => {
                errs.add("columns", options(&fields));
                None
            }
        };
        if let (Some(index), Some(field)) = (index, field) {
            out.push(ColumnMap { field, index });
        }
    }
    out
}

/// `rows: z.array(z.array(z.string())).max(5000)`.
fn check_rows(o: &Obj, errs: &mut Errs) -> Vec<Vec<String>> {
    let Some(Value::Array(items)) = o.get("rows") else {
        errs.add("rows", expected("array", o.get("rows")));
        return vec![];
    };
    if items.len() > MAX_ROWS {
        errs.add(
            "rows",
            format!("Too big: expected array to have <={MAX_ROWS} items"),
        );
    }
    let mut rows = Vec::with_capacity(items.len());
    for it in items {
        let Value::Array(cells) = it else {
            errs.add("rows", expected("array", Some(it)));
            continue;
        };
        let mut row = Vec::with_capacity(cells.len());
        for c in cells {
            match c {
                Value::String(s) => row.push(s.clone()),
                other => errs.add("rows", expected("string", Some(other))),
            }
        }
        rows.push(row);
    }
    rows
}

// ── analyze ─────────────────────────────────────────────────────────────────

/// `boundMatrix`: at most `MAX_ROWS` data rows, silently.
fn bound_matrix(m: TabularMatrix) -> TabularMatrix {
    let mut m = m;
    m.rows.truncate(MAX_ROWS);
    m
}

/// `readMatrixFromRequest`: multipart `file` (CSV or XLSX), or JSON
/// `{ csv }` / `{ matrix, sheetNames? }`.
async fn read_matrix(st: &AppState, req: Request) -> Result<TabularMatrix, Response> {
    let is_multipart = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("multipart/form-data"));
    if is_multipart {
        return read_file(st, req).await;
    }
    let body = Bytes::from_request(req, st)
        .await
        .map_err(IntoResponse::into_response)?;
    let o = body_object(&body)?;
    let mut errs = Errs::default();
    check_entity(&o, &mut errs);
    let csv = match o.get("csv") {
        None => None,
        Some(Value::String(s)) => {
            if s.encode_utf16().count() > MAX_CSV_CHARS {
                errs.add(
                    "csv",
                    format!("Too big: expected string to have <={MAX_CSV_CHARS} characters"),
                );
            }
            Some(s.as_str())
        }
        other => {
            errs.add("csv", expected("string", other));
            None
        }
    };
    let matrix: Option<Vec<Vec<Value>>> = match o.get("matrix") {
        None => None,
        Some(Value::Array(items)) => {
            if items.len() > MAX_ROWS + 1 {
                errs.add(
                    "matrix",
                    format!("Too big: expected array to have <={} items", MAX_ROWS + 1),
                );
            }
            let mut rows = Vec::with_capacity(items.len());
            for it in items {
                match it {
                    Value::Array(cells) => rows.push(cells.clone()),
                    other => errs.add("matrix", expected("array", Some(other))),
                }
            }
            Some(rows)
        }
        other => {
            errs.add("matrix", expected("array", other));
            None
        }
    };
    let sheet_names: Option<Vec<String>> = match o.get("sheetNames") {
        None => None,
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .filter_map(|it| match it {
                    Value::String(s) => Some(s.clone()),
                    other => {
                        errs.add("sheetNames", expected("string", Some(other)));
                        None
                    }
                })
                .collect(),
        ),
        other => {
            errs.add("sheetNames", expected("array", other));
            None
        }
    };
    errs.into_result()?;
    if let Some(csv) = csv {
        return Ok(bound_matrix(parse_csv(csv)));
    }
    if let Some(matrix) = matrix {
        return Ok(bound_matrix(normalize_matrix(&matrix, sheet_names)));
    }
    Err(error(
        StatusCode::BAD_REQUEST,
        "Fournir `file` (multipart), `csv` ou `matrix`.",
    ))
}

async fn read_file(st: &AppState, req: Request) -> Result<TabularMatrix, Response> {
    let missing = || error(StatusCode::BAD_REQUEST, "Fichier manquant");
    let mut mp = Multipart::from_request(req, st)
        .await
        .map_err(|_| missing())?;
    loop {
        let Some(field) = mp.next_field().await.map_err(|e| e.into_response())? else {
            return Err(missing());
        };
        if field.name() != Some("file") {
            continue;
        }
        // A text part named `file` is not a File (arkyo `instanceof File`).
        let Some(name) = field.file_name().map(str::to_lowercase) else {
            return Err(missing());
        };
        let mime = field.content_type().unwrap_or("").to_string();
        let bytes = field.bytes().await.map_err(|e| e.into_response())?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err(error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Fichier trop volumineux",
            ));
        }
        if name.ends_with(".xlsx") || mime.contains("spreadsheetml") {
            return parse_xlsx(&bytes).map(bound_matrix).map_err(|e| {
                tracing::warn!("import xlsx: {e}");
                error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Impossible de lire le fichier XLSX côté serveur. Renvoyez la matrice pré-parsée (champ `matrix`).",
                )
            });
        }
        return Ok(bound_matrix(parse_csv(&String::from_utf8_lossy(&bytes))));
    }
}

async fn refs(st: &AppState, table: &str) -> Result<Vec<Value>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(&format!(
        r#"SELECT "id", "name" FROM "{table}" WHERE "isActive" = 1 ORDER BY "name", "id""#
    ))
    .fetch_all(&st.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, name)| json!({ "id": id, "name": name, "source": "tenant" }))
        .collect())
}

/// POST /api/tenant/parametres/import/analyze: matrix, detected mapping,
/// distinct brand/category values and the existing ones. No write.
pub async fn analyze(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    req: Request,
) -> Response {
    let run = async {
        assert_can_write(&st, &u).await?;
        let m = read_matrix(&st, req).await?;
        if m.headers.is_empty() {
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Le tableur ne contient aucune colonne exploitable.",
            ));
        }
        let mapping = detect_columns(&m.headers, &m.rows, DEFAULT_THRESHOLD);
        let distinct = |f: TargetField| -> Vec<String> {
            mapping
                .iter()
                .find(|c| c.suggested_field == Some(f))
                .map(|c| {
                    distinct_values(
                        m.rows
                            .iter()
                            .map(|r| r.get(c.index).map_or("", String::as_str)),
                    )
                })
                .unwrap_or_default()
        };
        let brands = refs(&st, "TenantBrand").await.map_err(db_error)?;
        let categories = refs(&st, "TenantEquipmentCategory")
            .await
            .map_err(db_error)?;
        let mut out = Map::new();
        out.insert("entity".into(), "equipment".into());
        if let Some(names) = &m.sheet_names {
            out.insert("sheetNames".into(), json!(names));
        }
        out.insert("headers".into(), json!(m.headers));
        out.insert("totalRows".into(), json!(m.rows.len()));
        out.insert(
            "sampleRows".into(),
            json!(m.rows.iter().take(SAMPLE_ROWS).collect::<Vec<_>>()),
        );
        out.insert("mapping".into(), json!(mapping));
        out.insert(
            "refValues".into(),
            json!({ "brands": distinct(TargetField::Brand),
                    "categories": distinct(TargetField::Category) }),
        );
        out.insert(
            "existing".into(),
            json!({ "brands": brands, "categories": categories }),
        );
        Ok(Json(Value::Object(out)).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

// ── preview ─────────────────────────────────────────────────────────────────

async fn existing_equipment(
    conn: &mut SqliteConnection,
) -> Result<Vec<ExistingEquipment>, sqlx::Error> {
    let rows: Vec<(String, String, Option<String>)> =
        sqlx::query_as(r#"SELECT "id", "name", "reference" FROM "TenantEquipment" ORDER BY rowid"#)
            .fetch_all(conn)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(id, name, reference)| ExistingEquipment {
            id,
            name,
            reference,
        })
        .collect())
}

/// POST /api/tenant/parametres/import/preview: status of each row (new /
/// duplicate / invalid) for the chosen mapping. No write.
pub async fn preview(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    let run = async {
        assert_can_write(&st, &u).await?;
        let o = body_object(&body)?;
        let mut errs = Errs::default();
        check_entity(&o, &mut errs);
        let columns = check_columns(&o, &mut errs);
        let rows = check_rows(&o, &mut errs);
        errs.into_result()?;
        let mut conn = st.pool.acquire().await.map_err(db_error)?;
        let existing = existing_equipment(&mut conn).await.map_err(db_error)?;
        Ok(Json(json!(preview_rows(&rows, &columns, &existing))).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

// ── commit ──────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq)]
enum Policy {
    Skip,
    Update,
    Duplicate,
}

const POLICIES: [&str; 3] = ["skip", "update", "duplicate"];

fn policy(s: &str) -> Option<Policy> {
    match s {
        "skip" => Some(Policy::Skip),
        "update" => Some(Policy::Update),
        "duplicate" => Some(Policy::Duplicate),
        _ => None,
    }
}

/// A reference decision: `None` = create, `Some(id)` = link.
type Decisions = Vec<(String, Option<String>)>;

struct CommitBody {
    columns: Vec<ColumnMap>,
    rows: Vec<Vec<String>>,
    brands: Decisions,
    categories: Decisions,
    dedup: Policy,
    overrides: HashMap<String, (Option<Policy>, bool)>,
}

/// `z.record(z.string(), refDecisionSchema)`.
fn check_decisions(v: Option<&Value>, errs: &mut Errs) -> Decisions {
    let mut out = Vec::new();
    let Some(v) = v else {
        return out;
    };
    let Value::Object(m) = v else {
        errs.add("refDecisions", expected("record", Some(v)));
        return out;
    };
    for (value, d) in m {
        let Value::Object(d) = d else {
            errs.add("refDecisions", expected("object", Some(d)));
            continue;
        };
        let id = match d.get("id") {
            None => None,
            Some(Value::String(s)) => Some(s.clone()),
            other => {
                errs.add("refDecisions", expected("string", other));
                continue;
            }
        };
        match d.get("action").and_then(Value::as_str) {
            Some("create") => out.push((value.clone(), None)),
            Some("link") => match id.filter(|i| !i.is_empty()) {
                Some(id) => out.push((value.clone(), Some(id))),
                None => errs.add("refDecisions", "action=link exige un id"),
            },
            _ => errs.add("refDecisions", options(&["create", "link"])),
        }
    }
    out
}

fn check_commit(o: &Obj) -> Result<CommitBody, Response> {
    let mut errs = Errs::default();
    check_entity(o, &mut errs);
    let columns = check_columns(o, &mut errs);
    let rows = check_rows(o, &mut errs);
    let (mut brands, mut categories) = (Vec::new(), Vec::new());
    match o.get("refDecisions") {
        None => {}
        Some(Value::Object(r)) => {
            brands = check_decisions(r.get("brands"), &mut errs);
            categories = check_decisions(r.get("categories"), &mut errs);
        }
        other => errs.add("refDecisions", expected("object", other)),
    }
    let dedup = match o.get("dedupPolicy") {
        None => Policy::Skip,
        Some(v) => v.as_str().and_then(policy).unwrap_or_else(|| {
            errs.add("dedupPolicy", options(&POLICIES));
            Policy::Skip
        }),
    };
    let mut overrides = HashMap::new();
    match o.get("perRowOverrides") {
        None => {}
        Some(Value::Object(m)) => {
            for (k, v) in m {
                let Value::Object(ov) = v else {
                    errs.add("perRowOverrides", expected("object", Some(v)));
                    continue;
                };
                let d = match ov.get("dedup") {
                    None => None,
                    Some(x) => match x.as_str().and_then(policy) {
                        Some(p) => Some(p),
                        None => {
                            errs.add("perRowOverrides", options(&POLICIES));
                            None
                        }
                    },
                };
                let skip = match ov.get("skip") {
                    None => false,
                    Some(Value::Bool(b)) => *b,
                    other => {
                        errs.add("perRowOverrides", expected("boolean", other));
                        false
                    }
                };
                overrides.insert(k.clone(), (d, skip));
            }
        }
        other => errs.add("perRowOverrides", expected("record", other)),
    }
    errs.into_result()?;
    Ok(CommitBody {
        columns,
        rows,
        brands,
        categories,
        dedup,
        overrides,
    })
}

/// `materializeRefs`: normalized value → id; `create` upserts by name
/// (`createFn`) and is reported in `createdRefs`.
async fn materialize(
    tx: &mut SqliteConnection,
    table: &str,
    decisions: &Decisions,
    created: &mut Vec<Value>,
) -> Result<HashMap<String, String>, sqlx::Error> {
    let mut map = HashMap::new();
    for (value, link) in decisions {
        let key = normalize_token(value);
        if key.is_empty() {
            continue;
        }
        if let Some(id) = link {
            map.insert(key, id.clone());
            continue;
        }
        let name = crate::catalogue::import::js_trim(value).to_string();
        let found: Option<String> =
            sqlx::query_scalar(&format!(r#"SELECT "id" FROM "{table}" WHERE "name" = ?"#))
                .bind(&name)
                .fetch_optional(&mut *tx)
                .await?;
        let id = match found {
            Some(id) => id,
            None => {
                let id = new_id();
                let now = now_iso();
                sqlx::query(&format!(
                    r#"INSERT INTO "{table}" ("id","name","createdAt","updatedAt") VALUES (?,?,?,?)"#
                ))
                .bind(&id)
                .bind(&name)
                .bind(&now)
                .bind(&now)
                .execute(&mut *tx)
                .await?;
                id
            }
        };
        map.insert(key, id.clone());
        created.push(json!({ "value": name, "id": id }));
    }
    Ok(map)
}

/// An equipment row of the dedup index (kept up to date during the batch).
struct Known {
    id: String,
    reference: Option<String>,
    folded: String,
}

/// arkyo `findExisting`: `reference` (exact) first, then `name`
/// (case-insensitive), first match in creation order.
fn find_existing(known: &[Known], reference: Option<&str>, name: &str) -> Option<usize> {
    if let Some(r) = reference {
        if let Some(i) = known.iter().position(|k| k.reference.as_deref() == Some(r)) {
            return Some(i);
        }
    }
    let f = fold(name);
    known.iter().position(|k| k.folded == f)
}

async fn write_row(
    tx: &mut SqliteConnection,
    sql: &str,
    values: &[Value],
) -> Result<(), sqlx::Error> {
    let mut q = sqlx::query(sql);
    for v in values {
        q = bind(q, v);
    }
    q.execute(tx).await.map(|_| ())
}

/// POST /api/tenant/parametres/import/commit: creates the decided brands
/// and categories, then creates or updates each row's equipment (dedup by
/// reference then name). A failing row is reported and the batch goes on.
pub async fn commit(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    let run = async {
        assert_can_write(&st, &u).await?;
        let b = check_commit(&body_object(&body)?)?;
        let brand_col = b
            .columns
            .iter()
            .find(|c| c.field == TargetField::Brand)
            .map(|c| c.index);
        let cat_col = b
            .columns
            .iter()
            .find(|c| c.field == TargetField::Category)
            .map(|c| c.index);

        // One transaction for the batch: a failing statement only undoes
        // itself in SQLite, so a bad row does not cancel the others.
        let mut tx = begin(&st.pool).await?;
        let mut created_brands = Vec::new();
        let mut created_cats = Vec::new();
        let brand_ids = materialize(&mut tx, "TenantBrand", &b.brands, &mut created_brands)
            .await
            .map_err(db_error)?;
        let cat_ids = materialize(
            &mut tx,
            "TenantEquipmentCategory",
            &b.categories,
            &mut created_cats,
        )
        .await
        .map_err(db_error)?;

        let mut known: Vec<Known> = existing_equipment(&mut tx)
            .await
            .map_err(db_error)?
            .into_iter()
            .map(|e| Known {
                folded: fold(&e.name),
                id: e.id,
                reference: e.reference,
            })
            .collect();

        let (mut created, mut updated, mut skipped) = (0, 0, 0);
        let mut failed: Vec<Value> = Vec::new();
        let mut last: Option<String> = None;
        let lookup = |col: Option<usize>, ids: &HashMap<String, String>, row: &[String]| {
            col.and_then(|i| ids.get(&normalize_token(row.get(i).map_or("", String::as_str))))
                .cloned()
        };

        for (i, row) in b.rows.iter().enumerate() {
            let ov = b.overrides.get(&i.to_string());
            if ov.is_some_and(|o| o.1) {
                skipped += 1;
                continue;
            }
            let pol = ov.and_then(|o| o.0).unwrap_or(b.dedup);
            let refs = BuildRefs {
                brand_id: lookup(brand_col, &brand_ids, row),
                category_id: lookup(cat_col, &cat_ids, row),
            };
            let input = match build_equipment_input(&coerce_row(row, &b.columns), refs) {
                Ok(input) => input,
                Err(reason) => {
                    failed.push(json!({ "row": i, "reason": reason }));
                    continue;
                }
            };
            let data = input.write_data();
            let now = now_iso();
            let hit = find_existing(&known, input.reference.as_deref(), &input.name);
            if let (Some(k), true) = (hit, pol != Policy::Duplicate) {
                if pol == Policy::Skip {
                    skipped += 1;
                    continue;
                }
                let id = known[k].id.clone();
                let mut sets: Vec<String> = data.keys().map(|c| format!("\"{c}\" = ?")).collect();
                sets.push("\"updatedAt\" = ?".into());
                let mut values: Vec<Value> = data.values().cloned().collect();
                values.push(Value::String(now));
                values.push(Value::String(id.clone()));
                let sql = format!(
                    r#"UPDATE "TenantEquipment" SET {} WHERE "id" = ?"#,
                    sets.join(", ")
                );
                match write_row(&mut tx, &sql, &values).await {
                    Ok(()) => {
                        known[k].reference = input.reference.clone();
                        known[k].folded = fold(&input.name);
                        updated += 1;
                        last = Some(id);
                    }
                    Err(e) => failed.push(json!({ "row": i, "reason": e.to_string() })),
                }
                continue;
            }
            let id = new_id();
            let mut cols: Vec<String> = ["id", "createdAt", "updatedAt", "createdById"]
                .iter()
                .map(|c| format!("\"{c}\""))
                .collect();
            let mut values = vec![
                Value::String(id.clone()),
                Value::String(now.clone()),
                Value::String(now),
                Value::String(u.id.clone()),
            ];
            for (k, v) in &data {
                cols.push(format!("\"{k}\""));
                values.push(v.clone());
            }
            let sql = format!(
                r#"INSERT INTO "TenantEquipment" ({}) VALUES ({})"#,
                cols.join(", "),
                vec!["?"; cols.len()].join(", ")
            );
            match write_row(&mut tx, &sql, &values).await {
                Ok(()) => {
                    known.push(Known {
                        id: id.clone(),
                        reference: input.reference.clone(),
                        folded: fold(&input.name),
                    });
                    created += 1;
                    last = Some(id);
                }
                Err(e) => failed.push(json!({ "row": i, "reason": e.to_string() })),
            }
        }

        audit::log(
            &mut tx,
            &u.id,
            "IMPORT",
            "TenantEquipment",
            last.as_deref().unwrap_or("batch"),
            None,
            None,
            Some(json!({
                "created": created, "updated": updated, "skipped": skipped,
                "failed": failed.len(), "createdBrands": created_brands.len(),
                "createdCategories": created_cats.len()
            })),
        )
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        st.events.publish(EVENT, "imported", last.as_deref());
        Ok(Json(json!({
            "created": created, "updated": updated, "skipped": skipped, "failed": failed,
            "createdRefs": { "brands": created_brands, "categories": created_cats }
        }))
        .into_response())
    };
    run.await.unwrap_or_else(|r: Response| r)
}
