//! Starting referentials (decision 4 of phase 2).
//!
//! The rows come from arkyo's seed routes, frozen once into `seeds/*.json` by
//! `tools/extract-seeds` (stable cuid ids, never regenerated) and embedded in
//! the binary. They are inserted when a family has never been seeded and its
//! table is empty; a family is then recorded in the `AppConfig` key
//! `seeds.applied` (JSON array), so rows the user deletes are not inserted
//! again on the next start. Only `restore-arkyo` ([`SeedMode::Restore`]) and
//! the purge ([`SeedMode::Purge`]) put seeded rows back.

use std::collections::BTreeSet;

use anyhow::Context;
use serde::Deserialize;
use serde_json::Value;
use sqlx::{SqliteConnection, SqlitePool};

use crate::ids::{new_id, now_iso};

/// `AppConfig` key holding the families already seeded (JSON array of names).
pub const APPLIED_KEY: &str = "seeds.applied";

/// A family of seeded rows: one JSON file, one or more tables.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeedKind {
    Functions,
    Phases,
    Types,
    EquipmentCategories,
    Brands,
    Symbols,
    Connectors,
    Signals,
    Adapters,
    CableModels,
    Cables,
    Dimensions,
    PrintTemplates,
    CableLabelStocks,
    PrintExportModels,
    PrintSettings,
}

impl SeedKind {
    /// Every family, in insertion order (parents before the rows that
    /// reference them).
    pub const ALL: [SeedKind; 16] = [
        SeedKind::Functions,
        SeedKind::Phases,
        SeedKind::Types,
        SeedKind::EquipmentCategories,
        SeedKind::Brands,
        SeedKind::Symbols,
        SeedKind::Connectors,
        SeedKind::Signals,
        SeedKind::Adapters,
        SeedKind::CableModels,
        SeedKind::Cables,
        SeedKind::Dimensions,
        SeedKind::PrintTemplates,
        SeedKind::CableLabelStocks,
        SeedKind::PrintExportModels,
        SeedKind::PrintSettings,
    ];

    /// The family name: file stem in `seeds/` and entry of `seeds.applied`.
    pub fn name(self) -> &'static str {
        match self {
            SeedKind::Functions => "functions",
            SeedKind::Phases => "phases",
            SeedKind::Types => "types",
            SeedKind::EquipmentCategories => "equipment-categories",
            SeedKind::Brands => "brands",
            SeedKind::Symbols => "symbols",
            SeedKind::Connectors => "connectors",
            SeedKind::Signals => "signals",
            SeedKind::Adapters => "adapters",
            SeedKind::CableModels => "cable-models",
            SeedKind::Cables => "cables",
            SeedKind::Dimensions => "dimensions",
            SeedKind::PrintTemplates => "print-templates",
            SeedKind::CableLabelStocks => "cable-label-stocks",
            SeedKind::PrintExportModels => "print-export-models",
            SeedKind::PrintSettings => "print-settings",
        }
    }

    fn json(self) -> &'static str {
        match self {
            SeedKind::Functions => include_str!("../seeds/functions.json"),
            SeedKind::Phases => include_str!("../seeds/phases.json"),
            SeedKind::Types => include_str!("../seeds/types.json"),
            SeedKind::EquipmentCategories => include_str!("../seeds/equipment-categories.json"),
            SeedKind::Brands => include_str!("../seeds/brands.json"),
            SeedKind::Symbols => include_str!("../seeds/symbols.json"),
            SeedKind::Connectors => include_str!("../seeds/connectors.json"),
            SeedKind::Signals => include_str!("../seeds/signals.json"),
            SeedKind::Adapters => include_str!("../seeds/adapters.json"),
            SeedKind::CableModels => include_str!("../seeds/cable-models.json"),
            SeedKind::Cables => include_str!("../seeds/cables.json"),
            SeedKind::Dimensions => include_str!("../seeds/dimensions.json"),
            SeedKind::PrintTemplates => include_str!("../seeds/print-templates.json"),
            SeedKind::CableLabelStocks => include_str!("../seeds/cable-label-stocks.json"),
            SeedKind::PrintExportModels => include_str!("../seeds/print-export-models.json"),
            SeedKind::PrintSettings => include_str!("../seeds/print-settings.json"),
        }
    }

    /// The parsed seed file.
    pub fn family(self) -> anyhow::Result<Family> {
        let f: Family = serde_json::from_str(self.json())
            .with_context(|| format!("seeds/{}.json", self.name()))?;
        anyhow::ensure!(
            f.family == self.name(),
            "seeds/{}.json: wrong family",
            self.name()
        );
        Ok(f)
    }
}

/// Content of a `seeds/<family>.json` file.
#[derive(Debug, Deserialize)]
pub struct Family {
    pub family: String,
    pub tables: Vec<TableRows>,
}

/// Rows of one table, as `{ column: value }` objects; `createdAt` and
/// `updatedAt` are set at insertion.
#[derive(Debug, Deserialize)]
pub struct TableRows {
    pub table: String,
    pub rows: Vec<serde_json::Map<String, Value>>,
}

/// What [`apply`] does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeedMode {
    /// Base without a seed marker (new base, or base of v0.1): every family
    /// whose table is empty.
    Initial,
    /// Base already seeded: only the families never seeded (added by a newer
    /// version) whose table is empty.
    MissingTables,
    /// `restore-arkyo`: the seeded rows of this family that are missing
    /// (by id or by a unique key); existing rows are kept as they are.
    Restore(SeedKind),
    /// After the purge emptied the catalogue: every family again.
    Purge,
}

/// Rows inserted per family.
#[derive(Debug, Default)]
pub struct Applied {
    pub per_kind: Vec<(SeedKind, u64)>,
}

impl Applied {
    pub fn total(&self) -> u64 {
        self.per_kind.iter().map(|(_, n)| n).sum()
    }

    pub fn get(&self, kind: SeedKind) -> u64 {
        self.per_kind
            .iter()
            .filter(|(k, _)| *k == kind)
            .map(|(_, n)| n)
            .sum()
    }
}

/// Mode to use at start-up: [`SeedMode::Initial`] without a marker,
/// [`SeedMode::MissingTables`] otherwise.
pub async fn startup_mode(pool: &SqlitePool) -> anyhow::Result<SeedMode> {
    let marker: Option<String> = sqlx::query_scalar("SELECT value FROM AppConfig WHERE key = ?")
        .bind(APPLIED_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(if marker.is_some() {
        SeedMode::MissingTables
    } else {
        SeedMode::Initial
    })
}

/// Applies the seeds in one transaction. `BEGIN IMMEDIATE`: the write lock
/// is taken before the tables and the marker are read, so two processes
/// opening a new base at the same time wait for each other (no duplicate,
/// no failure on a stale read).
pub async fn apply(pool: &SqlitePool, mode: SeedMode) -> anyhow::Result<Applied> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let applied = apply_in(&mut tx, mode).await?;
    tx.commit().await?;
    Ok(applied)
}

/// Same as [`apply`], inside a transaction of the caller (the purge empties
/// the tables and reseeds atomically).
pub async fn apply_in(conn: &mut SqliteConnection, mode: SeedMode) -> anyhow::Result<Applied> {
    let mut marker = read_marker(conn).await?;
    let known = marker.clone();
    let mut out = Applied::default();
    let kinds: Vec<SeedKind> = match mode {
        SeedMode::Restore(kind) => vec![kind],
        _ => SeedKind::ALL.to_vec(),
    };
    for kind in kinds {
        let family = kind.family()?;
        let wanted = match mode {
            SeedMode::Initial => true,
            SeedMode::MissingTables => !marker.contains(kind.name()),
            SeedMode::Restore(_) | SeedMode::Purge => true,
        };
        if !wanted {
            continue;
        }
        // At start-up, a table that already has rows (restored backup, data
        // of a newer version…) is left as it is.
        let fill = match mode {
            SeedMode::Initial | SeedMode::MissingTables => is_empty(conn, &family).await?,
            SeedMode::Restore(_) | SeedMode::Purge => true,
        };
        let n = if fill {
            insert_family(conn, &family).await?
        } else {
            0
        };
        out.per_kind.push((kind, n));
        marker.insert(kind.name().to_string());
    }
    if marker != known {
        write_marker(conn, &marker).await?;
    }
    Ok(out)
}

/// Families recorded as seeded. Names unknown to this version (written by a
/// newer one) are kept when the marker is written back.
async fn read_marker(conn: &mut SqliteConnection) -> anyhow::Result<BTreeSet<String>> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM AppConfig WHERE key = ?")
        .bind(APPLIED_KEY)
        .fetch_optional(&mut *conn)
        .await?;
    Ok(value
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .unwrap_or_default()
        .into_iter()
        .collect())
}

async fn write_marker(
    conn: &mut SqliteConnection,
    marker: &BTreeSet<String>,
) -> anyhow::Result<()> {
    let value = serde_json::to_string(&marker.iter().collect::<Vec<_>>())?;
    sqlx::query(
        "INSERT INTO AppConfig (id, key, value, updatedAt) VALUES (?, ?, ?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt",
    )
    .bind(new_id())
    .bind(APPLIED_KEY)
    .bind(value)
    .bind(now_iso())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Whether the first table of the family is empty.
async fn is_empty(conn: &mut SqliteConnection, family: &Family) -> anyhow::Result<bool> {
    let Some(first) = family.tables.first() else {
        return Ok(true);
    };
    let n: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", quote(&first.table)?))
        .fetch_one(&mut *conn)
        .await?;
    Ok(n == 0)
}

/// Inserts the rows of a family; a row that collides with an existing one
/// (same id, or same unique key) is skipped. Returns the rows inserted.
async fn insert_family(conn: &mut SqliteConnection, family: &Family) -> anyhow::Result<u64> {
    let mut inserted = 0;
    let now = now_iso();
    for t in &family.tables {
        let table = quote(&t.table)?;
        for row in &t.rows {
            let mut cols = Vec::with_capacity(row.len() + 2);
            for c in row.keys() {
                cols.push(quote(c)?);
            }
            let stamps: Vec<&str> = ["createdAt", "updatedAt"]
                .into_iter()
                .filter(|c| !row.contains_key(*c))
                .collect();
            for c in &stamps {
                cols.push(quote(c)?);
            }
            let sql = format!(
                "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT DO NOTHING",
                cols.join(", "),
                vec!["?"; cols.len()].join(", ")
            );
            let mut q = sqlx::query(&sql);
            for v in row.values() {
                q = match v {
                    Value::Null => q.bind(None::<String>),
                    Value::Bool(b) => q.bind(i64::from(*b)),
                    Value::Number(n) => match n.as_i64() {
                        Some(i) => q.bind(i),
                        None => q.bind(n.as_f64()),
                    },
                    Value::String(s) => q.bind(s.as_str()),
                    Value::Array(_) | Value::Object(_) => q.bind(v.to_string()),
                };
            }
            for _ in &stamps {
                q = q.bind(now.as_str());
            }
            let r = q
                .execute(&mut *conn)
                .await
                .with_context(|| format!("seed {}: {}", family.family, t.table))?;
            inserted += r.rows_affected();
        }
    }
    Ok(inserted)
}

/// Quotes an identifier of a seed file (letters only: they come from the
/// committed JSON, never from a request).
fn quote(ident: &str) -> anyhow::Result<String> {
    anyhow::ensure!(
        !ident.is_empty() && ident.chars().all(|c| c.is_ascii_alphabetic()),
        "identifiant de seed invalide : {ident}"
    );
    Ok(format!("\"{ident}\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_family_parses_and_matches_its_file() {
        for kind in SeedKind::ALL {
            let f = kind.family().unwrap();
            assert!(!f.tables.is_empty(), "{}", kind.name());
        }
    }

    #[test]
    fn identifiers_are_letters_only() {
        assert!(quote("TenantBrand").is_ok());
        assert!(quote("a\"; DROP TABLE x; --").is_err());
        assert!(quote("").is_err());
    }
}
