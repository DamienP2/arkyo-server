//! Phase 2, Task 1: catalogue schema (migration 0002) and starting referentials
//! (seeds extracted once from arkyo by `tools/extract-seeds`).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use arkyo_server::db::open;
use serde_json::Value;
use sqlx::SqlitePool;

async fn count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{table}\""))
        .fetch_one(pool)
        .await
        .unwrap()
}

fn seeds_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("seeds")
}

/// Every seed file, by family name: `{ family, tables: [{ table, rows }] }`.
fn seed_files() -> HashMap<String, Value> {
    let mut out = HashMap::new();
    for entry in std::fs::read_dir(seeds_dir()).unwrap() {
        let p = entry.unwrap().path();
        if p.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        out.insert(v["family"].as_str().unwrap().to_string(), v);
    }
    out
}

fn rows<'a>(files: &'a HashMap<String, Value>, family: &str, table: &str) -> &'a Vec<Value> {
    let f = files
        .get(family)
        .unwrap_or_else(|| panic!("seed family {family} missing"));
    f["tables"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["table"] == table)
        .unwrap_or_else(|| panic!("{family}: table {table} missing"))["rows"]
        .as_array()
        .unwrap()
}

fn ids(rows: &[Value]) -> HashSet<String> {
    rows.iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect()
}

/// Minimum counts, set to the real counts of arkyo's seeds at commit
/// 88b2e4b (routes `app/api/supervisor/dev/seed-*` + scripts `scripts/seed-*`):
/// a lower count means the extraction or the insertion lost rows.
const EXPECTED: &[(&str, i64)] = &[
    ("TenantFunction", 11),           // seed-functions: 11 functions
    ("TenantPhase", 10),              // seed-phases: 10 phases
    ("TenantType", 166),              // seed-types: 90 types + 76 sub-types
    ("TenantEquipmentCategory", 109), // seed-eq-categories: 16 parents + 93 children
    ("TenantBrand", 171),             // seed-brands: 170 + "LAPP" (seed-cable-label-stocks)
    ("CatalogSymbol", 49),            // BUILTIN_CONNECTOR_ICONS: 49 symbols
    ("TenantConnectorType", 66),      // seed-connectors: 66 connectors
    ("TenantSignalType", 94),         // seed-signals: 94 signals
    ("TenantAdapter", 31),            // seed-adapters: 31 adapters
    ("TenantCableModel", 36),         // seed-cable-models: 36 models
    // seed-cables: 40 cords, 23 skipped by arkyo itself (connector name
    // unknown to seed-connectors: "XLR", "USB", "HD-BNC"…).
    ("TenantCable", 17),
    ("TenantDimensionPreset", 54), // seed-dimensions: 54 presets in 6 categories
    ("TenantPrintTemplate", 4),    // seed-print-templates: 4 cartouches
    ("TenantCableLabelStock", 8),  // seed-cable-label-stocks: LAPP LCK range
    ("PrintSettings", 1),          // singleton "default"
];

#[tokio::test]
async fn fresh_db_has_seeded_referentials() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    for (table, n) in EXPECTED {
        let got = count(&pool, table).await;
        assert!(got >= *n, "{table}: {got} rows, expected at least {n}");
    }
    // The equipment catalogue starts empty (no seed-equipment).
    assert_eq!(count(&pool, "TenantEquipment").await, 0);
    assert_eq!(count(&pool, "TenantEquipmentComponent").await, 0);
    // Empty tables of the phase.
    for t in ["AuditLog", "ExportTemplate", "TenantPrintExportPage"] {
        assert_eq!(count(&pool, t).await, 0, "{t}");
    }
    // Seeded rows carry the ids of the committed JSON files (stable ids).
    let files = seed_files();
    let video = rows(&files, "functions", "TenantFunction")
        .iter()
        .find(|r| r["key"] == "VIDEO")
        .unwrap();
    let id: String = sqlx::query_scalar("SELECT id FROM TenantFunction WHERE key = 'VIDEO'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(id, video["id"].as_str().unwrap());
    // Converted columns: JSON arrays, booleans 0/1, ISO dates.
    let (versions, function_ids, active, created): (String, String, i64, String) =
        sqlx::query_as(
            "SELECT versions, functionIds, isActive, createdAt FROM TenantConnectorType WHERE name = 'BNC'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
    let versions: Vec<String> = serde_json::from_str(&versions).unwrap();
    assert!(versions.contains(&"75Ω".to_string()), "{versions:?}");
    let function_ids: Vec<String> = serde_json::from_str(&function_ids).unwrap();
    assert_eq!(function_ids.len(), 3); // VIDEO, RF, SYNC
    assert_eq!(active, 1);
    assert!(created.len() == 24 && created.ends_with('Z'), "{created}");
    // Print settings singleton: arkyo's defaults.
    let (key, paper, orientation, margin): (String, String, String, i64) = sqlx::query_as(
        "SELECT key, defaultPaperFormat, defaultOrientation, defaultMarginTop FROM PrintSettings",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (key.as_str(), paper.as_str(), orientation.as_str(), margin),
        ("default", "A3", "LANDSCAPE", 15)
    );
    // Marker: every family is recorded as seeded.
    let applied: String =
        sqlx::query_scalar("SELECT value FROM AppConfig WHERE key = 'seeds.applied'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let applied: Vec<String> = serde_json::from_str(&applied).unwrap();
    for family in files.keys() {
        assert!(applied.contains(family), "{family} not in {applied:?}");
    }
}

#[tokio::test]
async fn reopen_does_not_duplicate_seeds() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    let before = count(&pool, "TenantSignalType").await;
    pool.close().await;
    let pool = open(d.path()).await.unwrap();
    assert_eq!(count(&pool, "TenantSignalType").await, before);
}

#[tokio::test]
async fn seeds_not_reinserted_after_user_deletes() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    assert!(count(&pool, "TenantBrand").await > 0);
    sqlx::query("DELETE FROM TenantBrand")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let pool = open(d.path()).await.unwrap();
    assert_eq!(count(&pool, "TenantBrand").await, 0);
}

#[tokio::test]
async fn restore_reinserts_missing_rows_only() {
    use arkyo_server::seeds::{apply, SeedKind, SeedMode};
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    let total = count(&pool, "TenantDimensionPreset").await;
    sqlx::query(
        "UPDATE TenantDimensionPreset SET sortOrder = 99 WHERE category = 'RACK_U' AND value = 1",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM TenantDimensionPreset WHERE category = 'RACK_U' AND value <> 1")
        .execute(&pool)
        .await
        .unwrap();
    let left = count(&pool, "TenantDimensionPreset").await;
    let report = apply(&pool, SeedMode::Restore(SeedKind::Dimensions))
        .await
        .unwrap();
    assert_eq!(report.total() as i64, total - left);
    assert_eq!(count(&pool, "TenantDimensionPreset").await, total);
    // The edited builtin is kept as the user left it.
    let sort: i64 = sqlx::query_scalar(
        "SELECT sortOrder FROM TenantDimensionPreset WHERE category = 'RACK_U' AND value = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(sort, 99);
    // Idempotent.
    let again = apply(&pool, SeedMode::Restore(SeedKind::Dimensions))
        .await
        .unwrap();
    assert_eq!(again.total(), 0);
}

#[tokio::test]
async fn purge_mode_reinserts_every_family() {
    use arkyo_server::seeds::{apply, SeedMode};
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    let brands = count(&pool, "TenantBrand").await;
    let types = count(&pool, "TenantType").await;
    sqlx::query("DELETE FROM TenantBrand")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM TenantType")
        .execute(&pool)
        .await
        .unwrap();
    apply(&pool, SeedMode::Purge).await.unwrap();
    assert_eq!(count(&pool, "TenantBrand").await, brands);
    assert_eq!(count(&pool, "TenantType").await, types);
}

/// A base created by v0.1 (migration 0001 only, phase 1).
async fn v01_base(dir: &Path) {
    let migrations = tempfile::tempdir().unwrap();
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations/0001_socle.sql"),
        migrations.path().join("0001_socle.sql"),
    )
    .unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(dir.join("arkyo.db"))
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePool::connect_with(options).await.unwrap();
    sqlx::migrate::Migrator::new(migrations.path())
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO AppConfig (id, key, value, updatedAt) VALUES ('c1', 'site.name', 'Studio', '2026-10-26T10:00:00.000Z')",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;
}

#[tokio::test]
async fn seeds_fill_empty_tables_on_upgrade() {
    let d = tempfile::tempdir().unwrap();
    v01_base(d.path()).await;
    let pool = open(d.path()).await.expect("v0.2 opens a v0.1 base");
    for (table, n) in EXPECTED {
        let got = count(&pool, table).await;
        assert!(got >= *n, "{table}: {got} rows, expected at least {n}");
    }
    // Phase-1 data is untouched.
    let name: String = sqlx::query_scalar("SELECT value FROM AppConfig WHERE key = 'site.name'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Studio");
}

#[tokio::test]
async fn seeds_skip_a_family_whose_table_already_has_rows() {
    // A table filled by other means before its family was ever seeded (e.g.
    // a restored backup) is left as it is, and the family is recorded.
    let d = tempfile::tempdir().unwrap();
    v01_base(d.path()).await;
    let pool = open(d.path()).await.unwrap();
    sqlx::query("DELETE FROM TenantPhase")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO TenantPhase (id, key, label, createdAt, updatedAt) \
         VALUES ('cperso', 'PERSO', 'Perso', '2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.000Z')",
    )
    .execute(&pool)
    .await
    .unwrap();
    // Forget that phases were seeded.
    let applied: String =
        sqlx::query_scalar("SELECT value FROM AppConfig WHERE key = 'seeds.applied'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let mut applied: Vec<String> = serde_json::from_str(&applied).unwrap();
    applied.retain(|f| f != "phases");
    sqlx::query("UPDATE AppConfig SET value = ? WHERE key = 'seeds.applied'")
        .bind(serde_json::to_string(&applied).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let pool = open(d.path()).await.unwrap();
    assert_eq!(count(&pool, "TenantPhase").await, 1);
}

#[test]
fn seed_ids_are_unique_and_stable() {
    let files = seed_files();
    // Unique cuid v1 ids across every file.
    let mut seen = HashSet::new();
    for (family, f) in &files {
        for t in f["tables"].as_array().unwrap() {
            for r in t["rows"].as_array().unwrap() {
                let id = r["id"]
                    .as_str()
                    .unwrap_or_else(|| panic!("{family}: row without id"));
                assert!(
                    id.len() == 25
                        && id.starts_with('c')
                        && id
                            .chars()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
                    "{family}: {id} is not a cuid"
                );
                assert!(seen.insert(id.to_string()), "{family}: duplicate id {id}");
            }
        }
    }

    // Internal references resolve.
    let functions = ids(rows(&files, "functions", "TenantFunction"));
    let types = rows(&files, "types", "TenantType");
    let type_ids = ids(types);
    let categories = rows(&files, "equipment-categories", "TenantEquipmentCategory");
    let category_ids = ids(categories);
    let brands = ids(rows(&files, "brands", "TenantBrand"));
    let connectors = rows(&files, "connectors", "TenantConnectorType");
    let connector_ids = ids(connectors);
    let models = rows(&files, "cable-models", "TenantCableModel");
    let model_ids = ids(models);

    let opt_in = |v: &Value, set: &HashSet<String>, what: &str| {
        if let Some(s) = v.as_str() {
            assert!(set.contains(s), "{what}: unresolved reference {s}");
        } else {
            assert!(v.is_null(), "{what}: {v}");
        }
    };
    let all_in = |v: &Value, set: &HashSet<String>, what: &str| {
        for x in v
            .as_array()
            .unwrap_or_else(|| panic!("{what}: not an array"))
        {
            assert!(set.contains(x.as_str().unwrap()), "{what}: unresolved {x}");
        }
    };

    for t in types {
        assert!(
            t["functionId"].is_string(),
            "type {} without function",
            t["name"]
        );
        opt_in(&t["functionId"], &functions, "type.functionId");
        opt_in(&t["parentId"], &type_ids, "type.parentId");
    }
    // Depth 1: a sub-type's parent is a root.
    let roots: HashSet<&str> = types
        .iter()
        .filter(|t| t["parentId"].is_null())
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    for t in types.iter().filter(|t| !t["parentId"].is_null()) {
        assert!(roots.contains(t["parentId"].as_str().unwrap()));
    }
    for c in categories {
        opt_in(&c["parentId"], &category_ids, "category.parentId");
    }
    for c in connectors {
        all_in(&c["functionIds"], &functions, "connector.functionIds");
        assert!(c["versions"].is_array());
    }
    let signals = rows(&files, "signals", "TenantSignalType");
    for s in signals {
        opt_in(&s["functionId"], &functions, "signal.functionId");
        all_in(&s["connectorIds"], &connector_ids, "signal.connectorIds");
    }
    for m in models {
        opt_in(&m["functionId"], &functions, "cableModel.functionId");
        opt_in(&m["brandId"], &brands, "cableModel.brandId");
    }
    for c in rows(&files, "cables", "TenantCable") {
        opt_in(
            &c["leftConnectorId"],
            &connector_ids,
            "cable.leftConnectorId",
        );
        opt_in(
            &c["rightConnectorId"],
            &connector_ids,
            "cable.rightConnectorId",
        );
        opt_in(&c["functionId"], &functions, "cable.functionId");
        opt_in(&c["brandId"], &brands, "cable.brandId");
        opt_in(&c["cableModelId"], &model_ids, "cable.cableModelId");
    }
    for a in rows(&files, "adapters", "TenantAdapter") {
        opt_in(&a["functionId"], &functions, "adapter.functionId");
        for side in ["inputs", "outputs"] {
            for port in a[side].as_array().unwrap() {
                opt_in(&port["connectorTypeId"], &connector_ids, "adapter port");
            }
        }
    }
    for s in rows(&files, "cable-label-stocks", "TenantCableLabelStock") {
        opt_in(&s["brandId"], &brands, "labelStock.brandId");
    }

    // Spot checks against arkyo's sources.
    let bnc = connectors.iter().find(|c| c["name"] == "BNC").unwrap();
    assert_eq!(bnc["iconId"], "bnc");
    let sdi = signals.iter().find(|s| s["name"] == "12G-SDI").unwrap();
    assert_eq!(sdi["bandwidth"], "11.88 Gbps");
    assert!(sdi["connectorIds"].as_array().unwrap().contains(&bnc["id"]));
    let camera = types.iter().find(|t| t["name"] == "Caméra").unwrap();
    let ptz = types
        .iter()
        .find(|t| t["name"] == "PTZ" && t["parentId"] == camera["id"])
        .unwrap();
    assert_eq!(ptz["functionId"], camera["functionId"]);
}

#[tokio::test]
async fn older_binary_tolerates_0002() {
    // Rule of additive migrations, applied to 0002: this binary opens a base
    // migrated by a newer version (unknown migration, unknown table, new
    // column on a catalogue table, unknown seed family) and keeps what it
    // does not know.
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    for sql in [
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES (9999, 'future phase', 1, X'00', 0)",
        "CREATE TABLE \"FutureTable\" (id TEXT PRIMARY KEY)",
        "ALTER TABLE \"TenantBrand\" ADD COLUMN \"futureColumn\" TEXT NOT NULL DEFAULT ''",
        "DELETE FROM TenantPhase",
        "UPDATE AppConfig SET value = '[\"future-family\"]' WHERE key = 'seeds.applied'",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    pool.close().await;
    let pool = open(d.path())
        .await
        .expect("this binary opens a base of a newer version");
    // Families missing from the marker were seeded into their empty tables,
    // the others (non-empty) are recorded without duplicates.
    assert!(count(&pool, "TenantPhase").await >= 10);
    let applied: String =
        sqlx::query_scalar("SELECT value FROM AppConfig WHERE key = 'seeds.applied'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let applied: Vec<String> = serde_json::from_str(&applied).unwrap();
    assert!(
        applied.contains(&"future-family".to_string()),
        "{applied:?}"
    );
    assert!(applied.contains(&"phases".to_string()), "{applied:?}");
    // Purge still works with the unknown column (it has a default).
    sqlx::query("DELETE FROM TenantBrand")
        .execute(&pool)
        .await
        .unwrap();
    arkyo_server::seeds::apply(&pool, arkyo_server::seeds::SeedMode::Purge)
        .await
        .unwrap();
    assert!(count(&pool, "TenantBrand").await > 0);
}

#[tokio::test]
async fn catalogue_foreign_keys() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    let now = "2026-10-26T10:00:00.000Z";
    // TenantEquipmentComponent.hostId → TenantEquipment (cascade).
    sqlx::query(
        "INSERT INTO TenantEquipment (id, name, createdById, createdAt, updatedAt) VALUES ('h1', 'Hôte', 'u', ?, ?)",
    )
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO TenantEquipmentComponent (id, hostId, componentId, slotIndex, createdAt) VALUES ('k1', 'h1', 'x', 0, ?)",
    )
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();
    let bad = sqlx::query(
        "INSERT INTO TenantEquipmentComponent (id, hostId, componentId, slotIndex, createdAt) VALUES ('k2', 'nope', 'x', 0, ?)",
    )
    .bind(now)
    .execute(&pool)
    .await;
    assert!(bad.is_err());
    sqlx::query("DELETE FROM TenantEquipment WHERE id = 'h1'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(count(&pool, "TenantEquipmentComponent").await, 0);
    // Soft FKs stay plain text (cross-referential, resolved by the API).
    sqlx::query(
        "INSERT INTO TenantType (id, name, functionId, parentId, createdAt, updatedAt) VALUES ('t1', 'Libre', 'inconnue', 'inconnu', ?, ?)",
    )
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();
    // AuditLog.projectId has no FK until the Project table exists (phase 3).
    sqlx::query(
        "INSERT INTO AuditLog (id, userId, action, entityType, entityId, projectId, createdAt) VALUES ('a1', 'u', 'x', 'y', 'z', 'p', ?)",
    )
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();
}
