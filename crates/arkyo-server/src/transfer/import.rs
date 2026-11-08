//! Export to and import from a `.arkyo` file (spec 2026-11-07-sauvegardes
//! §4): preview of a file, then one write transaction that inserts each
//! root with its mode (same ids when absent here, *Replace* or *Copy* when
//! present), adds the missing catalogue and panels (never modifying the
//! existing ones), then copies the missing uploads.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::query::Query;
use sqlx::sqlite::{Sqlite, SqliteArguments};
use sqlx::{SqliteConnection, SqlitePool};

use super::archive::{self, Author, Manifest};
use super::graph::{classification, Class};
use super::remap::{part_ids, partition, remap_row, root_tables, text, Part, Parter};
use super::rows::{columns, ColumnInfo};
use super::{collect, points, Bundle, Root, RootKind, Row, TransferError};
use crate::http::AppState;
use crate::ids::new_id;
use crate::users::User;

/// What to do with a root of the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Absent here: inserted with its ids.
    Insert,
    /// Present: the current graph is replaced by the file's (same ids).
    Replace,
    /// Present: inserted with new ids, its name suffixed « (copie) ».
    Copy,
}

#[derive(Debug, Clone, Serialize)]
pub struct RootPreview {
    pub kind: RootKind,
    pub id: String,
    pub name: String,
    /// The root's id exists here (a mode must be chosen).
    pub exists: bool,
    /// Owned rows of the root in the file, by table.
    pub counts: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Preview {
    pub manifest: Manifest,
    pub roots: Vec<RootPreview>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ImportOptions {
    /// Root id → mode, for the roots present here.
    #[serde(default)]
    pub modes: HashMap<String, Mode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RootReport {
    pub kind: RootKind,
    /// The final id (new in *Copy*).
    pub id: String,
    /// The final name (suffixed in *Copy*).
    pub name: String,
    pub mode: Mode,
    /// Rows written, by table.
    pub inserted: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub roots: Vec<RootReport>,
    /// Catalogue and panel rows added (missing here), by table.
    pub catalogue_added: BTreeMap<String, usize>,
    pub uploads_copied: usize,
    pub warnings: Vec<String>,
}

/// Columns holding a user id: an author unknown here becomes the importer.
const USER_COLUMNS: &[&str] = &[
    "createdById",
    "assignedToId",
    "userId",
    "authorId",
    "uploadedById",
];

/// `createdById` of the seeded catalogue rows: no user, kept as is (same
/// rule as the catalogue restore of `http/parametres/backup.rs`).
const SEED_AUTHOR: &str = "system";

/// Cable ids a rack may take, in the order `POST /api/racks` gives them.
const CABLE_IDS: [i64; 10] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, TransferError> + Send + 'static,
) -> Result<T, TransferError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| TransferError::Io(std::io::Error::other(e)))?
}

// ── Export ──────────────────────────────────────────────────────────────────

/// Writes the archive of `roots` at `out` from one read snapshot.
pub async fn export_to_file(
    st: &AppState,
    user: &User,
    roots: &[(RootKind, String)],
    out: &Path,
) -> Result<Manifest, TransferError> {
    let bundle = {
        let mut tx = crate::db::begin_read(&st.pool).await?;
        let bundle = collect(&mut tx, roots).await;
        tx.rollback().await?;
        bundle?
    };
    let author = Author {
        id: user.id.clone(),
        name: user.name.clone(),
        email: Some(user.email.clone()),
    };
    let uploads = st.data_dir.join("uploads");
    let out = out.to_path_buf();
    blocking(move || {
        let res = archive::write_archive(&bundle, Some(author), &uploads, &out);
        if res.is_err() {
            let _ = std::fs::remove_file(&out);
        }
        res
    })
    .await
}

// ── Preview ─────────────────────────────────────────────────────────────────

async fn root_exists(
    conn: &mut SqliteConnection,
    kind: RootKind,
    id: &str,
) -> Result<bool, TransferError> {
    let n: i64 = sqlx::query_scalar(&format!(
        r#"SELECT COUNT(*) FROM "{}" WHERE "id" = ?"#,
        kind.table()
    ))
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(n > 0)
}

/// The roots of a file, whether each exists here and its row counts.
pub async fn preview(
    pool: &SqlitePool,
    bundle: &Bundle,
    manifest: &Manifest,
) -> Result<Preview, TransferError> {
    let mut conn = pool.acquire().await?;
    let mut roots = Vec::new();
    for root in unique_roots(bundle) {
        let part = partition(bundle, root.kind, &root.id);
        roots.push(RootPreview {
            kind: root.kind,
            id: root.id.clone(),
            name: root.name.clone(),
            exists: root_exists(&mut conn, root.kind, &root.id).await?,
            counts: part.iter().map(|(t, i)| (t.clone(), i.len())).collect(),
        });
    }
    Ok(Preview {
        manifest: manifest.clone(),
        roots,
    })
}

fn unique_roots(bundle: &Bundle) -> Vec<&Root> {
    let mut seen = HashSet::new();
    bundle
        .roots
        .iter()
        .filter(|r| seen.insert((r.kind, r.id.as_str())))
        .collect()
}

// ── Writing rows ────────────────────────────────────────────────────────────

struct Fk {
    from: String,
    table: String,
    to: String,
}

/// The local schema of a table of the file.
struct TableSchema {
    cols: Vec<ColumnInfo>,
    fks: Vec<Fk>,
}

impl TableSchema {
    fn col(&self, name: &str) -> Option<&ColumnInfo> {
        self.cols.iter().find(|c| c.name == name)
    }
}

/// Mutable state of one import.
struct Ctx<'a> {
    importer: &'a str,
    known_users: HashSet<String>,
    /// Table → ids this import writes (final ids).
    planned: HashMap<String, HashSet<String>>,
    /// `(table, column, value)` → present here.
    present: HashMap<(String, String, String), bool>,
    /// Cable ids of the file's racks (kept free for them when possible).
    cable_ids: HashSet<i64>,
    /// File id → id here of a catalogue row already here under another id
    /// (same unique key): references to it are rewritten.
    alias: HashMap<String, String>,
    warned: HashSet<String>,
    warnings: Vec<String>,
}

impl Ctx<'_> {
    fn warn(&mut self, msg: String) {
        if self.warned.insert(msg.clone()) {
            self.warnings.push(msg);
        }
    }

    /// A row with this `to` value exists in `table` here or is written by
    /// this import.
    async fn parent_present(
        &mut self,
        conn: &mut SqliteConnection,
        table: &str,
        to: &str,
        value: &str,
    ) -> Result<bool, TransferError> {
        if to == "id"
            && self
                .planned
                .get(table)
                .is_some_and(|ids| ids.contains(value))
        {
            return Ok(true);
        }
        let key = (table.to_string(), to.to_string(), value.to_string());
        if let Some(p) = self.present.get(&key) {
            return Ok(*p);
        }
        let n: i64 = sqlx::query_scalar(&format!(
            r#"SELECT COUNT(*) FROM "{table}" WHERE "{to}" = ?"#
        ))
        .bind(value)
        .fetch_one(&mut *conn)
        .await?;
        self.present.insert(key, n > 0);
        Ok(n > 0)
    }
}

fn is_ident(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// The local schema of every importable table of the file; a warning for
/// the others.
async fn load_schemas(
    conn: &mut SqliteConnection,
    bundle: &Bundle,
    ctx: &mut Ctx<'_>,
) -> Result<HashMap<String, TableSchema>, TransferError> {
    let classes: HashMap<&str, Class> = classification().iter().copied().collect();
    let mut out = HashMap::new();
    for table in bundle.tables.keys() {
        let cols = if is_ident(table) {
            columns(conn, table).await?
        } else {
            Vec::new()
        };
        if cols.is_empty() {
            ctx.warn(format!("La table « {table} » est inconnue ici : ignorée."));
            continue;
        }
        if matches!(classes.get(table.as_str()), None | Some(Class::System)) {
            ctx.warn(format!("La table « {table} » ne s'importe pas : ignorée."));
            continue;
        }
        let fks: Vec<(String, String, Option<String>)> = sqlx::query_as(&format!(
            r#"SELECT "from", "table", "to" FROM pragma_foreign_key_list('{table}')"#
        ))
        .fetch_all(&mut *conn)
        .await?;
        let fks = fks
            .into_iter()
            .map(|(from, table, to)| Fk {
                from,
                table,
                to: to.unwrap_or_else(|| "id".into()),
            })
            .collect();
        out.insert(table.clone(), TableSchema { cols, fks });
    }
    Ok(out)
}

fn bind_value<'q>(
    q: Query<'q, Sqlite, SqliteArguments<'q>>,
    v: &Value,
) -> Query<'q, Sqlite, SqliteArguments<'q>> {
    match v {
        Value::Null => q.bind(None::<String>),
        Value::Bool(b) => q.bind(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => q.bind(i),
            None => q.bind(n.as_f64()),
        },
        Value::String(s) => q.bind(s.clone()),
        other => q.bind(other.to_string()),
    }
}

/// How a row is written.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Write {
    /// Owned row (*Replace*, *Copy*): inserted, or its columns overwritten
    /// when its id exists.
    Upsert,
    /// Owned row (*Insert*): inserted, kept as it is when its id exists.
    InsertOnly,
    /// Catalogue or panel: inserted only when its id is missing here.
    IfMissing,
}

/// The cable id a rack takes: its own when no other rack has it, else the
/// first free one, preferably one no rack of the file wants (`None` if none
/// is free).
async fn free_cable_id(
    conn: &mut SqliteConnection,
    rack_id: &str,
    wanted: i64,
    reserved: &HashSet<i64>,
) -> Result<Option<i64>, TransferError> {
    let used: Vec<i64> = sqlx::query_scalar(
        r#"SELECT "cableId" FROM "Rack" WHERE "cableId" IS NOT NULL AND "id" <> ?"#,
    )
    .bind(rack_id)
    .fetch_all(&mut *conn)
    .await?;
    if !used.contains(&wanted) {
        return Ok(Some(wanted));
    }
    let free = |n: &i64| !used.contains(n);
    Ok(CABLE_IDS
        .into_iter()
        .find(|n| free(n) && !reserved.contains(n))
        .or_else(|| CABLE_IDS.into_iter().find(free)))
}

/// Writes one row with the columns that exist here; `Ok(false)` when a
/// catalogue row was already here.
async fn write_row(
    conn: &mut SqliteConnection,
    ctx: &mut Ctx<'_>,
    ts: &TableSchema,
    table: &str,
    mut row: Row,
    how: Write,
) -> Result<bool, TransferError> {
    if !ctx.alias.is_empty() {
        remap_row(&mut row, &ctx.alias);
    }
    for k in row.keys() {
        if ts.col(k).is_none() {
            ctx.warn(format!(
                "La colonne « {k} » de « {table} » est inconnue ici : ignorée."
            ));
        }
    }
    let id = text(&row, "id").map(str::to_string);
    if how == Write::IfMissing {
        if let Some(id) = &id {
            let n: i64 =
                sqlx::query_scalar(&format!(r#"SELECT COUNT(*) FROM "{table}" WHERE "id" = ?"#))
                    .bind(id)
                    .fetch_one(&mut *conn)
                    .await?;
            if n > 0 {
                return Ok(false);
            }
        }
    }
    // Authors unknown here → the importer.
    for c in USER_COLUMNS {
        let Some(info) = ts.col(c) else { continue };
        let keep = match row.get(*c) {
            Some(Value::String(s)) => ctx.known_users.contains(s),
            Some(Value::Null) | None => !(info.notnull && info.dflt_value.is_none()),
            Some(_) => false,
        };
        if !keep {
            row.insert((*c).to_string(), Value::String(ctx.importer.to_string()));
        }
    }
    // A reference to a row neither in the file nor here → NULL.
    for fk in &ts.fks {
        let Some(Value::String(v)) = row.get(&fk.from) else {
            continue;
        };
        let v = v.clone();
        let nullable = ts.col(&fk.from).is_some_and(|c| !c.notnull);
        if nullable && !ctx.parent_present(conn, &fk.table, &fk.to, &v).await? {
            row.insert(fk.from.clone(), Value::Null);
        }
    }
    if table == "Rack" {
        if let (Some(id), Some(wanted)) = (&id, row.get("cableId").and_then(Value::as_i64)) {
            let got = free_cable_id(conn, id, wanted, &ctx.cable_ids).await?;
            if got != Some(wanted) {
                let name = text(&row, "name").unwrap_or(id).to_string();
                ctx.warn(match got {
                    Some(n) => format!(
                        "L'identifiant de câblage {wanted} de « {name} » est déjà pris ici : {n} attribué."
                    ),
                    None => format!(
                        "L'identifiant de câblage {wanted} de « {name} » est déjà pris ici et aucun n'est libre : laissé vide."
                    ),
                });
                row.insert("cableId".into(), got.map_or(Value::Null, Value::from));
            }
        }
    }

    let mut cols: Vec<&str> = Vec::new();
    // Columns the file lacks: their default (an SQL expression of the local
    // schema), also when an existing row is overwritten.
    let mut defaults: Vec<String> = Vec::new();
    for c in &ts.cols {
        if row.contains_key(&c.name) {
            cols.push(&c.name);
        } else if c.notnull && c.dflt_value.is_none() {
            return Err(TransferError::Invalid(format!(
                "La colonne « {} » de « {table} » manque dans le fichier.",
                c.name
            )));
        } else {
            let value = c.dflt_value.as_deref().unwrap_or("NULL");
            defaults.push(format!(r#""{}" = {value}"#, c.name));
        }
    }
    let names = cols
        .iter()
        .map(|c| format!(r#""{c}""#))
        .collect::<Vec<_>>()
        .join(", ");
    let marks = vec!["?"; cols.len()].join(", ");
    let has_id = ts.col("id").is_some() && id.is_some();
    let tail = match how {
        Write::Upsert if has_id => {
            let set = cols
                .iter()
                .filter(|c| **c != "id")
                .map(|c| format!(r#""{c}" = excluded."{c}""#))
                .chain(defaults)
                .collect::<Vec<_>>()
                .join(", ");
            if set.is_empty() {
                r#" ON CONFLICT("id") DO NOTHING"#.to_string()
            } else {
                format!(r#" ON CONFLICT("id") DO UPDATE SET {set}"#)
            }
        }
        Write::Upsert => String::new(),
        Write::InsertOnly => r#" ON CONFLICT("id") DO NOTHING"#.to_string(),
        // Another unique key (a brand of the same name under another id):
        // the local row wins.
        Write::IfMissing => " ON CONFLICT DO NOTHING".to_string(),
    };
    let sql = format!(r#"INSERT INTO "{table}" ({names}) VALUES ({marks}){tail}"#);
    let mut q = sqlx::query(&sql);
    for c in &cols {
        q = bind_value(q, &row[*c]);
    }
    let done = q.execute(&mut *conn).await?.rows_affected() > 0;
    if !done && how == Write::IfMissing {
        // Its id is missing here: another unique key clashed.
        let name = text(&row, "name")
            .or(id.as_deref())
            .unwrap_or("?")
            .to_string();
        let local = same_unique_key(conn, table, &row).await?;
        match (&id, local) {
            (Some(id), Some(local)) => {
                ctx.alias.insert(id.clone(), local);
                ctx.warn(format!(
                    "« {name} » ({table}) existe déjà ici sous un autre identifiant : celui d'ici est utilisé."
                ));
            }
            (id, _) => {
                if let (Some(id), Some(planned)) = (id, ctx.planned.get_mut(table)) {
                    planned.remove(id);
                }
                ctx.warn(format!(
                    "« {name} » ({table}) existe déjà ici sous un autre identifiant : non ajouté."
                ));
            }
        }
    }
    Ok(done)
}

/// The id of the row here that has one of the unique keys of `row`.
async fn same_unique_key(
    conn: &mut SqliteConnection,
    table: &str,
    row: &Row,
) -> Result<Option<String>, TransferError> {
    let indexes: Vec<(String, i64, String)> =
        sqlx::query_as(r#"SELECT "name", "unique", "origin" FROM pragma_index_list(?)"#)
            .bind(table)
            .fetch_all(&mut *conn)
            .await?;
    for (index, unique, origin) in indexes {
        if unique == 0 || origin == "pk" {
            continue;
        }
        let cols: Vec<String> =
            sqlx::query_scalar(r#"SELECT "name" FROM pragma_index_info(?) ORDER BY "seqno""#)
                .bind(&index)
                .fetch_all(&mut *conn)
                .await?;
        // NULLs never clash; an expression index has unnamed columns.
        let values: Option<Vec<&Value>> = cols
            .iter()
            .map(|c| row.get(c).filter(|v| !v.is_null()))
            .collect();
        let Some(values) = values.filter(|v| !v.is_empty()) else {
            continue;
        };
        let filter = cols
            .iter()
            .map(|c| format!(r#""{c}" = ?"#))
            .collect::<Vec<_>>()
            .join(" AND ");
        let sql = format!(r#"SELECT "id" FROM "{table}" WHERE {filter} LIMIT 1"#);
        let mut q = sqlx::query_scalar::<_, String>(&sql);
        for v in values {
            q = match v {
                Value::Number(n) => match n.as_i64() {
                    Some(i) => q.bind(i),
                    None => q.bind(n.as_f64()),
                },
                Value::Bool(b) => q.bind(i64::from(*b)),
                Value::String(s) => q.bind(s.clone()),
                other => q.bind(other.to_string()),
            };
        }
        if let Some(id) = q.fetch_optional(&mut *conn).await? {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

// ── Import ──────────────────────────────────────────────────────────────────

struct RootPlan<'a> {
    root: &'a Root,
    mode: Mode,
    part: Part,
    /// Old id → new id (*Copy* only).
    map: HashMap<String, String>,
}

impl RootPlan<'_> {
    fn final_id(&self, id: &str) -> String {
        self.map.get(id).cloned().unwrap_or_else(|| id.to_string())
    }

    fn final_name(&self) -> String {
        match self.mode {
            Mode::Copy => format!("{} (copie)", self.root.name),
            _ => self.root.name.clone(),
        }
    }
}

/// A root id that is safe as a file name (`<data>/backups/projects/<id>`).
fn plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Imports the archive at `archive_path` in one transaction (nothing is
/// written on error), then copies its missing uploads.
pub async fn import(
    st: &AppState,
    user: &User,
    archive_path: &Path,
    opts: ImportOptions,
) -> Result<Report, TransferError> {
    let path = archive_path.to_path_buf();
    let (manifest, bundle) = blocking(move || archive::read_archive(&path)).await?;

    let mut tx = crate::db::begin_immediate(&st.pool).await?;
    // Self references (RackSlot.parentSlotId, RackInventoryItem.hostItemId,
    // TenantEquipmentCategory.parentId) come in rowid order, not parents
    // first: the keys are checked at commit.
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await?;

    // Modes: absent here → insert; present → the chosen one.
    let mut plans: Vec<RootPlan> = Vec::new();
    for root in unique_roots(&bundle) {
        if !plain_id(&root.id) {
            return Err(TransferError::Invalid("Archive invalide.".into()));
        }
        let exists = root_exists(&mut tx, root.kind, &root.id).await?;
        let mode = match (exists, opts.modes.get(&root.id)) {
            (false, _) => Mode::Insert,
            (true, Some(Mode::Replace)) => Mode::Replace,
            (true, Some(Mode::Copy)) => Mode::Copy,
            (true, _) => {
                return Err(TransferError::Invalid(format!(
                    "Choisissez Remplacer ou Copie pour « {} ».",
                    root.name
                )))
            }
        };
        let part = partition(&bundle, root.kind, &root.id);
        let mut map = HashMap::new();
        if mode == Mode::Copy {
            for ids in part_ids(&bundle, &part).into_values() {
                for id in ids {
                    map.entry(id).or_insert_with(new_id);
                }
            }
        }
        plans.push(RootPlan {
            root,
            mode,
            part,
            map,
        });
    }

    // A restore point of each project about to be replaced (its own read,
    // on another connection: this transaction has written nothing yet).
    for plan in &plans {
        if plan.mode == Mode::Replace && plan.root.kind == RootKind::Project {
            points::snapshot_before_restore(st, &plan.root.id, user).await?;
        }
    }

    let mut known_users: HashSet<String> = sqlx::query_scalar(r#"SELECT "id" FROM "User""#)
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .collect();
    known_users.insert(SEED_AUTHOR.into());
    let mut ctx = Ctx {
        importer: &user.id,
        known_users,
        planned: HashMap::new(),
        present: HashMap::new(),
        cable_ids: HashSet::new(),
        alias: HashMap::new(),
        warned: HashSet::new(),
        warnings: Vec::new(),
    };
    let schemas = load_schemas(&mut tx, &bundle, &mut ctx).await?;

    // Dependencies: catalogue and panel rows outside every root's graph.
    let mut in_roots: HashSet<(&str, usize)> = HashSet::new();
    for plan in &plans {
        for (t, idx) in &plan.part {
            in_roots.extend(idx.iter().map(|i| (t.as_str(), *i)));
        }
    }
    let mut deps: Vec<(&str, usize)> = Vec::new();
    for (table, class) in classification() {
        if !matches!(class, Class::Catalogue | Class::Dependency) {
            continue;
        }
        if let Some(rows) = bundle.tables.get(*table) {
            deps.extend(
                (0..rows.len())
                    .filter(|i| !in_roots.contains(&(*table, *i)))
                    .map(|i| (*table, i)),
            );
        }
    }

    // The ids this import writes, for the references it keeps.
    for (t, i) in &deps {
        if let Some(id) = text(&bundle.tables[*t][*i], "id") {
            ctx.planned
                .entry(t.to_string())
                .or_default()
                .insert(id.to_string());
        }
    }
    for plan in &plans {
        for (t, ids) in part_ids(&bundle, &plan.part) {
            let set = ctx.planned.entry(t).or_default();
            set.extend(ids.iter().map(|id| plan.final_id(id)));
        }
        if let (Some(idx), Some(rows)) = (plan.part.get("Rack"), bundle.tables.get("Rack")) {
            ctx.cable_ids.extend(
                idx.iter()
                    .filter_map(|i| rows[*i].get("cableId").and_then(Value::as_i64)),
            );
        }
    }

    // Replace: the rows of the current graph that the file does not have
    // are deleted (children first); the others are overwritten below. A
    // rack another rig uses keeps its current state: its rows of the file
    // are skipped.
    let mut skipped: Vec<HashSet<(String, usize)>> = Vec::new();
    for plan in &plans {
        let mut skip = HashSet::new();
        if plan.mode == Mode::Replace {
            let shared = delete_stale(&mut tx, plan, &bundle).await?;
            let mut rows = Parter::new(&bundle);
            rows.racks(&shared.keys().cloned().collect());
            for (t, idx) in rows.part {
                skip.extend(idx.into_iter().map(|i| (t.clone(), i)));
            }
            for name in shared.values() {
                ctx.warn(format!(
                    "Le contenant « {name} » est aussi utilisé par une autre régie : il garde son état actuel."
                ));
            }
        }
        skipped.push(skip);
    }

    let mut report = Report::default();
    for (table, i) in deps {
        let Some(ts) = schemas.get(table) else {
            continue;
        };
        let row = bundle.tables[table][i].clone();
        if write_row(&mut tx, &mut ctx, ts, table, row, Write::IfMissing).await? {
            *report.catalogue_added.entry(table.to_string()).or_default() += 1;
        }
    }
    let mut kept: BTreeMap<String, usize> = BTreeMap::new();
    for (plan, skip) in plans.iter().zip(&skipped) {
        let mut inserted = BTreeMap::new();
        let how = match plan.mode {
            Mode::Insert => Write::InsertOnly,
            Mode::Replace | Mode::Copy => Write::Upsert,
        };
        for table in root_tables(plan.root.kind) {
            let (Some(idx), Some(ts)) = (plan.part.get(*table), schemas.get(*table)) else {
                continue;
            };
            for i in idx {
                if skip.contains(&(table.to_string(), *i)) {
                    continue;
                }
                let mut row = bundle.tables[*table][*i].clone();
                if plan.mode == Mode::Copy {
                    let is_root =
                        *table == plan.root.kind.table() && text(&row, "id") == Some(&plan.root.id);
                    remap_row(&mut row, &plan.map);
                    if is_root {
                        row.insert("name".into(), Value::String(plan.final_name()));
                    }
                }
                if write_row(&mut tx, &mut ctx, ts, table, row, how).await? {
                    *inserted.entry(table.to_string()).or_default() += 1;
                } else {
                    *kept.entry(table.to_string()).or_default() += 1;
                }
            }
        }
        let id = plan.final_id(&plan.root.id);
        let project_id = (plan.root.kind == RootKind::Project).then_some(id.as_str());
        crate::audit::log(
            &mut tx,
            &user.id,
            "IMPORT",
            plan.root.kind.table(),
            &id,
            project_id,
            None,
            Some(json!({ "mode": plan.mode, "file": manifest.created_at })),
        )
        .await?;
        report.roots.push(RootReport {
            kind: plan.root.kind,
            id,
            name: plan.final_name(),
            mode: plan.mode,
            inserted,
        });
    }
    tx.commit().await?;
    for (table, n) in kept {
        ctx.warn(format!(
            "{n} ligne(s) de « {table} » existaient déjà ici et ont été gardées telles quelles."
        ));
    }
    report.warnings = std::mem::take(&mut ctx.warnings);

    // Uploads after the commit, never overwriting.
    let path = archive_path.to_path_buf();
    let uploads = st.data_dir.join("uploads");
    match blocking(move || archive::extract_uploads(&path, &uploads)).await {
        Ok(n) => report.uploads_copied = n,
        Err(e) => report
            .warnings
            .push(format!("Fichiers envoyés non copiés : {e}")),
    }

    for r in &report.roots {
        let created = r.mode != Mode::Replace;
        let (entity, action) = match r.kind {
            RootKind::Project => ("project", if created { "created" } else { "updated" }),
            RootKind::Rack => ("rack", if created { "created" } else { "updated" }),
            RootKind::Rig => ("rig", if created { "created" } else { "updated" }),
            // Names of http/panels.rs.
            RootKind::Panel => ("panel", if created { "create" } else { "update" }),
        };
        st.events.publish(entity, action, Some(&r.id));
    }
    Ok(report)
}

/// Deletes the rows of the root's current graph absent from the file, in
/// reverse insert order. A rack another rig still uses (outside this graph,
/// current or of the file) is kept with all its rows, as the project
/// deletion does; returns these racks (id → name here).
async fn delete_stale(
    conn: &mut SqliteConnection,
    plan: &RootPlan<'_>,
    bundle: &Bundle,
) -> Result<BTreeMap<String, String>, TransferError> {
    let (kind, id) = (plan.root.kind, plan.root.id.as_str());
    let current = collect(conn, &[(kind, id.to_string())]).await?;
    let file = part_ids(bundle, &plan.part);
    let current_ids = part_ids(&current, &partition(&current, kind, id));
    let ids_of = |table: &str| -> BTreeSet<&String> {
        current_ids
            .get(table)
            .into_iter()
            .chain(file.get(table))
            .flatten()
            .collect()
    };
    let (rigs, racks) = (ids_of("RigConfig"), ids_of("Rack"));
    let shared: BTreeMap<String, String> = if racks.is_empty() || kind == RootKind::Rack {
        BTreeMap::new()
    } else {
        sqlx::query_as(
            r#"SELECT DISTINCT r."id", r."name" FROM "RigRack" rr JOIN "Rack" r ON r."id" = rr."rackId"
               WHERE rr."rackId" IN (SELECT value FROM json_each(?))
                 AND rr."rigConfigId" NOT IN (SELECT value FROM json_each(?))"#,
        )
        .bind(serde_json::to_string(&racks).expect("ids"))
        .bind(serde_json::to_string(&rigs).expect("ids"))
        .fetch_all(&mut *conn)
        .await?
        .into_iter()
        .collect()
    };
    let mut keep = Parter::new(&current);
    keep.racks(&shared.keys().cloned().collect());
    let keep = part_ids(&current, &keep.part);
    for table in root_tables(kind).iter().rev() {
        let Some(ids) = current_ids.get(*table) else {
            continue;
        };
        let stale: Vec<&String> = ids
            .iter()
            .filter(|i| !file.get(*table).is_some_and(|f| f.contains(*i)))
            .filter(|i| !keep.get(*table).is_some_and(|k| k.contains(*i)))
            .collect();
        if stale.is_empty() {
            continue;
        }
        sqlx::query(&format!(
            r#"DELETE FROM "{table}" WHERE "id" IN (SELECT value FROM json_each(?))"#
        ))
        .bind(serde_json::to_string(&stale).expect("ids"))
        .execute(&mut *conn)
        .await?;
    }
    Ok(shared)
}
