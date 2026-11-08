//! The table graph of each transferable object (spec §3.1–3.2), declared
//! once: what each root owns, what it depends on, and the class of every
//! table of the base (a phase that adds a table must classify it here, the
//! `every_table_is_classified` test walks `sqlite_master`).

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde_json::Value;
use sqlx::SqliteConnection;

use super::rows::select_rows;
use super::{Bundle, Root, RootKind, Row, TransferError};

/// What a table is to the transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Class {
    /// Rows owned by a project, a container or a rig (taken with their root).
    Owned,
    /// Catalogue rows: added on import only when their id is missing here.
    Catalogue,
    /// Panels: taken when referenced (and roots of their own).
    Dependency,
    /// Site rows, never exported.
    System,
}

/// Every table of the base and its class. Within each class, parents come
/// before children (the insert order of an import).
pub fn classification() -> &'static [(&'static str, Class)] {
    CLASSIFICATION
}

/// The owned tables, parents before children (foreign keys).
pub fn owned_tables_in_insert_order() -> &'static [&'static str] {
    OWNED
}

const OWNED: &[&str] = &[
    "Project",
    "TechnicalSheet",
    "ProjectDocument",
    "Task",
    "Message",
    "Location",
    "RigConfig",
    "Rack",
    "RigRack",
    "RackInventoryItem",
    "RackSlot",
    "RackSlotPanelRow",
    "RackZone",
    "RackLabel",
    "CableBundle",
    "SynopticAdapter",
    "ExternalPort",
    "RackConnection",
    "ProjectEquipment",
    "ProjectSynopticAdapter",
    "ProjectCableBundle",
    "ProjectConnection",
    "ProjectSynopticZone",
    "ProjectSynopticLabel",
    "SynopticGuide",
    "ProjectSynopticLayout",
    "AuditLog",
];

const CLASSIFICATION: &[(&str, Class)] = &[
    ("Role", Class::System),
    ("User", Class::System),
    ("UserProfile", Class::System),
    ("AuthSession", Class::System),
    ("Notification", Class::System),
    ("AppConfig", Class::System),
    ("CatalogSymbol", Class::System),
    ("PrintSettings", Class::System),
    ("TenantPrintTemplate", Class::System),
    ("TenantCableLabelStock", Class::System),
    ("TenantPrintExportModel", Class::System),
    ("TenantPrintExportPage", Class::System),
    ("ExportTemplate", Class::System),
    // Referentials (sent whole), then the referenced catalogue.
    ("TenantFunction", Class::Catalogue),
    ("TenantPhase", Class::Catalogue),
    ("TenantBrand", Class::Catalogue),
    ("TenantEquipmentCategory", Class::Catalogue),
    ("TenantType", Class::Catalogue),
    ("TenantConnectorType", Class::Catalogue),
    ("TenantSignalType", Class::Catalogue),
    ("TenantDimensionPreset", Class::Catalogue),
    ("TenantCableModel", Class::Catalogue),
    ("TenantEquipment", Class::Catalogue),
    ("TenantEquipmentComponent", Class::Catalogue),
    ("TenantCable", Class::Catalogue),
    ("TenantAdapter", Class::Catalogue),
    ("Panel", Class::Dependency),
    ("PanelSlot", Class::Dependency),
    ("Project", Class::Owned),
    ("TechnicalSheet", Class::Owned),
    ("ProjectDocument", Class::Owned),
    ("Task", Class::Owned),
    ("Message", Class::Owned),
    ("Location", Class::Owned),
    ("RigConfig", Class::Owned),
    ("Rack", Class::Owned),
    ("RigRack", Class::Owned),
    ("RackInventoryItem", Class::Owned),
    ("RackSlot", Class::Owned),
    ("RackSlotPanelRow", Class::Owned),
    ("RackZone", Class::Owned),
    ("RackLabel", Class::Owned),
    ("CableBundle", Class::Owned),
    ("SynopticAdapter", Class::Owned),
    ("ExternalPort", Class::Owned),
    ("RackConnection", Class::Owned),
    ("ProjectEquipment", Class::Owned),
    ("ProjectSynopticAdapter", Class::Owned),
    ("ProjectCableBundle", Class::Owned),
    ("ProjectConnection", Class::Owned),
    ("ProjectSynopticZone", Class::Owned),
    ("ProjectSynopticLabel", Class::Owned),
    ("SynopticGuide", Class::Owned),
    ("ProjectSynopticLayout", Class::Owned),
    ("AuditLog", Class::Owned),
];

/// The referentials, small, sent whole (§3.2).
const REFERENTIALS: &[&str] = &[
    "TenantFunction",
    "TenantPhase",
    "TenantBrand",
    "TenantEquipmentCategory",
    "TenantType",
    "TenantConnectorType",
    "TenantSignalType",
    "TenantDimensionPreset",
    "TenantCableModel",
];

/// Tables of a project keyed by `projectId`.
const PROJECT_TABLES: &[&str] = &[
    "TechnicalSheet",
    "ProjectDocument",
    "Task",
    "Message",
    "Location",
    "RigConfig",
    "ProjectEquipment",
    "ProjectSynopticAdapter",
    "ProjectCableBundle",
    "ProjectConnection",
    "ProjectSynopticZone",
    "ProjectSynopticLabel",
    "SynopticGuide",
    "ProjectSynopticLayout",
];

/// Tables of a container keyed by `rackId`.
const RACK_TABLES: &[&str] = &[
    "RackInventoryItem",
    "RackSlot",
    "RackZone",
    "RackLabel",
    "CableBundle",
    "SynopticAdapter",
    "ExternalPort",
    "RackConnection",
    "SynopticGuide",
];

/// `IN` over a JSON array bound once (any number of ids, one variable).
const IN_IDS: &str = "IN (SELECT value FROM json_each(?))";

/// Collected rows, each `(table, id)` once whatever the number of roots.
#[derive(Default)]
struct Acc {
    tables: BTreeMap<String, Vec<Row>>,
    seen: HashSet<(String, String)>,
}

impl Acc {
    fn add(&mut self, table: &str, rows: Vec<Row>) {
        for row in rows {
            if let Some(id) = row.get("id").and_then(Value::as_str) {
                if !self.seen.insert((table.to_string(), id.to_string())) {
                    continue;
                }
            }
            self.tables.entry(table.to_string()).or_default().push(row);
        }
    }

    /// The distinct text values of `column` in every collected table.
    fn refs(&self, column: &str) -> Vec<String> {
        let mut out = BTreeSet::new();
        for rows in self.tables.values() {
            for row in rows {
                if let Some(id) = row.get(column).and_then(Value::as_str) {
                    out.insert(id.to_string());
                }
            }
        }
        out.into_iter().collect()
    }
}

async fn fetch(
    conn: &mut SqliteConnection,
    acc: &mut Acc,
    table: &str,
    where_sql: &str,
    binds: &[&str],
) -> Result<(), TransferError> {
    let rows = select_rows(conn, table, where_sql, binds).await?;
    acc.add(table, rows);
    Ok(())
}

fn json_ids(ids: &[String]) -> String {
    serde_json::to_string(ids).expect("ids serialize")
}

/// Collects the rows of `roots` and of their dependencies (panels,
/// referenced catalogue, referentials) and the uploads they reference. The
/// caller holds a read transaction on `conn` for a consistent snapshot.
pub async fn collect(
    conn: &mut SqliteConnection,
    roots: &[(RootKind, String)],
) -> Result<Bundle, TransferError> {
    let mut acc = Acc::default();
    let mut out_roots: Vec<Root> = Vec::new();
    for (kind, id) in roots {
        if out_roots.iter().any(|r| r.kind == *kind && r.id == *id) {
            continue;
        }
        let name: Option<String> = sqlx::query_scalar(&format!(
            r#"SELECT "name" FROM "{}" WHERE "id" = ?"#,
            kind.table()
        ))
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some(name) = name else {
            return Err(TransferError::NotFound(*kind, id.clone()));
        };
        match kind {
            RootKind::Project => project_graph(conn, &mut acc, id).await?,
            RootKind::Rack => rack_graph(conn, &mut acc, std::slice::from_ref(id)).await?,
            RootKind::Rig => rig_graph(conn, &mut acc, id).await?,
            RootKind::Panel => panel_graph(conn, &mut acc, std::slice::from_ref(id)).await?,
        }
        out_roots.push(Root {
            kind: *kind,
            id: id.clone(),
            name,
        });
    }
    dependencies(conn, &mut acc).await?;
    let mut uploads = BTreeSet::new();
    for rows in acc.tables.values() {
        for row in rows {
            for v in row.values() {
                scan_value(v, &mut uploads);
            }
        }
    }
    Ok(Bundle {
        roots: out_roots,
        tables: acc.tables,
        uploads,
    })
}

/// Project: its own tables, its rigs' `RigRack`, its audit rows (the
/// filter of `GET /api/tenant/projects/:id/audit`, without limit) and the
/// container graph of its racks (racks of its rigs and of its locations).
async fn project_graph(
    conn: &mut SqliteConnection,
    acc: &mut Acc,
    project_id: &str,
) -> Result<(), TransferError> {
    let p = project_id;
    fetch(conn, acc, "Project", r#""id" = ?"#, &[p]).await?;
    for table in PROJECT_TABLES {
        fetch(conn, acc, table, r#""projectId" = ?"#, &[p]).await?;
    }
    fetch(
        conn,
        acc,
        "RigRack",
        r#""rigConfigId" IN (SELECT "id" FROM "RigConfig" WHERE "projectId" = ?)"#,
        &[p],
    )
    .await?;
    // Same filter as http/audit_read.rs::project (racks of its rigs).
    let rig_racks = r#"SELECT rr."rackId" FROM "RigRack" rr
        JOIN "RigConfig" rc ON rc."id" = rr."rigConfigId" WHERE rc."projectId" = ?"#;
    let audit = format!(
        r#"("entityType" = 'Project' AND "entityId" = ?)
         OR ("entityType" = 'Rack' AND "entityId" IN ({rig_racks}))
         OR ("entityType" = 'RackConnection' AND "entityId" IN
              (SELECT "id" FROM "RackConnection" WHERE "rackId" IN ({rig_racks})))
         OR ("entityType" = 'ProjectConnection' AND "entityId" IN
              (SELECT "id" FROM "ProjectConnection" WHERE "projectId" = ?))"#
    );
    fetch(conn, acc, "AuditLog", &audit, &[p, p, p, p]).await?;
    let racks: Vec<String> = sqlx::query_scalar(&format!(
        r#"{rig_racks}
           UNION SELECT r."id" FROM "Rack" r JOIN "Location" l ON l."id" = r."locationId"
           WHERE l."projectId" = ?"#
    ))
    .bind(p)
    .bind(p)
    .fetch_all(&mut *conn)
    .await?;
    rack_graph(conn, acc, &racks).await
}

/// Containers: the racks, their tables, their panel rows and their audit
/// rows (the filter of `GET /api/racks/:id/audit`, without limit).
async fn rack_graph(
    conn: &mut SqliteConnection,
    acc: &mut Acc,
    rack_ids: &[String],
) -> Result<(), TransferError> {
    if rack_ids.is_empty() {
        return Ok(());
    }
    let ids = json_ids(rack_ids);
    let r = ids.as_str();
    fetch(conn, acc, "Rack", &format!(r#""id" {IN_IDS}"#), &[r]).await?;
    for table in RACK_TABLES {
        fetch(conn, acc, table, &format!(r#""rackId" {IN_IDS}"#), &[r]).await?;
    }
    fetch(
        conn,
        acc,
        "RackSlotPanelRow",
        &format!(r#""slotId" IN (SELECT "id" FROM "RackSlot" WHERE "rackId" {IN_IDS})"#),
        &[r],
    )
    .await?;
    let audit = format!(
        r#"("entityType" = 'Rack' AND "entityId" {IN_IDS})
         OR ("entityType" = 'RackConnection' AND "entityId" IN
              (SELECT "id" FROM "RackConnection" WHERE "rackId" {IN_IDS}))"#
    );
    fetch(conn, acc, "AuditLog", &audit, &[r, r]).await
}

/// Rig: the rig, its `RigRack` and the container graph of its racks.
async fn rig_graph(
    conn: &mut SqliteConnection,
    acc: &mut Acc,
    rig_id: &str,
) -> Result<(), TransferError> {
    fetch(conn, acc, "RigConfig", r#""id" = ?"#, &[rig_id]).await?;
    fetch(conn, acc, "RigRack", r#""rigConfigId" = ?"#, &[rig_id]).await?;
    let racks: Vec<String> =
        sqlx::query_scalar(r#"SELECT "rackId" FROM "RigRack" WHERE "rigConfigId" = ?"#)
            .bind(rig_id)
            .fetch_all(&mut *conn)
            .await?;
    rack_graph(conn, acc, &racks).await
}

async fn panel_graph(
    conn: &mut SqliteConnection,
    acc: &mut Acc,
    panel_ids: &[String],
) -> Result<(), TransferError> {
    if panel_ids.is_empty() {
        return Ok(());
    }
    let ids = json_ids(panel_ids);
    let p = ids.as_str();
    fetch(conn, acc, "Panel", &format!(r#""id" {IN_IDS}"#), &[p]).await?;
    fetch(
        conn,
        acc,
        "PanelSlot",
        &format!(r#""panelId" {IN_IDS}"#),
        &[p],
    )
    .await
}

/// Dependencies of every root (§3.1–3.2): the referenced panels, the
/// referentials (whole), the referenced equipment (with the equipment their
/// components designate, transitively) and adapters. `catalogCableModelId`
/// and `catalogConnectorTypeId` point into referentials, already whole.
async fn dependencies(conn: &mut SqliteConnection, acc: &mut Acc) -> Result<(), TransferError> {
    let panels = acc.refs("panelId");
    panel_graph(conn, acc, &panels).await?;
    for table in REFERENTIALS {
        fetch(conn, acc, table, "1", &[]).await?;
    }
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut frontier = acc.refs("catalogEquipmentId");
    loop {
        frontier.retain(|id| seen.insert(id.clone()));
        if frontier.is_empty() {
            break;
        }
        let ids = json_ids(&frontier);
        let e = ids.as_str();
        fetch(
            conn,
            acc,
            "TenantEquipment",
            &format!(r#""id" {IN_IDS}"#),
            &[e],
        )
        .await?;
        let components = select_rows(
            conn,
            "TenantEquipmentComponent",
            &format!(r#""hostId" {IN_IDS}"#),
            &[e],
        )
        .await?;
        frontier = components
            .iter()
            .filter_map(|c| c.get("componentId").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        acc.add("TenantEquipmentComponent", components);
    }
    let adapters = acc.refs("catalogAdapterId");
    if !adapters.is_empty() {
        let ids = json_ids(&adapters);
        fetch(
            conn,
            acc,
            "TenantAdapter",
            &format!(r#""id" {IN_IDS}"#),
            &[ids.as_str()],
        )
        .await?;
    }
    Ok(())
}

fn scan_value(v: &Value, out: &mut BTreeSet<String>) {
    match v {
        Value::String(s) => scan_text(s, out),
        Value::Array(items) => items.iter().for_each(|i| scan_value(i, out)),
        Value::Object(map) => map.values().for_each(|i| scan_value(i, out)),
        _ => {}
    }
}

/// A `"/uploads/…"` value, or JSON text holding some.
fn scan_text(s: &str, out: &mut BTreeSet<String>) {
    if let Some(rest) = s.strip_prefix("/uploads/") {
        if let Some(path) = upload_path(rest) {
            out.insert(path);
        }
        return;
    }
    let t = s.trim_start();
    if t.starts_with('{') || t.starts_with('[') {
        if let Ok(v) = serde_json::from_str::<Value>(t) {
            scan_value(&v, out);
        }
    }
}

/// The relative path under `uploads/` of a URL tail, as `GET /uploads/*`
/// resolves it (query and fragment dropped, percent-decoded); `None` for a
/// path that would leave the folder.
fn upload_path(rest: &str) -> Option<String> {
    let rest = rest.split(['?', '#']).next().unwrap_or("");
    let decoded = percent_encoding::percent_decode_str(rest)
        .decode_utf8()
        .ok()?;
    let bad = decoded.is_empty()
        || decoded.contains('\0')
        || decoded.contains('\\')
        || decoded
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == "..");
    (!bad).then(|| decoded.into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_paths_stay_in_the_folder() {
        assert_eq!(
            upload_path("documents/a.pdf"),
            Some("documents/a.pdf".into())
        );
        assert_eq!(upload_path("a%20b.png?v=2"), Some("a b.png".into()));
        assert_eq!(upload_path("../x"), None);
        assert_eq!(upload_path("a/../../x"), None);
        assert_eq!(upload_path("/etc/passwd"), None);
        assert_eq!(upload_path("a\\b"), None);
        assert_eq!(upload_path(""), None);
    }

    #[test]
    fn uploads_are_found_inside_json() {
        let mut out = BTreeSet::new();
        scan_text(
            r#"[{"img":"/uploads/a.png"},"/uploads/b.png","x /uploads/c"]"#,
            &mut out,
        );
        scan_text("/uploads/d.png", &mut out);
        scan_text("voir /uploads/e.png", &mut out);
        let want: BTreeSet<String> = ["a.png", "b.png", "d.png"].map(String::from).into();
        assert_eq!(out, want);
    }
}
