//! Transfer of objects between bases (spec 2026-11-07-sauvegardes-design):
//! the rows of a project, a container (library rack), a rig template or a
//! panel, with the panels and the catalogue they reference, collected as a
//! [`Bundle`] (§3). Code proper to arkyo-server (arkyo has no such export).

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod archive;
pub mod graph;
pub mod import;
pub mod points;
mod remap;
pub mod rows;
pub mod site;

pub use graph::{classification, collect, owned_tables_in_insert_order, Class};

/// The kind of a transferable object (`manifest.json` `roots[].kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RootKind {
    Project,
    Rack,
    Rig,
    Panel,
}

impl RootKind {
    /// The table holding the object itself.
    pub fn table(self) -> &'static str {
        match self {
            RootKind::Project => "Project",
            RootKind::Rack => "Rack",
            RootKind::Rig => "RigConfig",
            RootKind::Panel => "Panel",
        }
    }
}

/// One object of a bundle, as named in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Root {
    pub kind: RootKind,
    pub id: String,
    pub name: String,
}

/// A row as stored: TEXT → string, INTEGER → integer, REAL → number,
/// NULL → null (JSON columns stay text).
pub type Row = serde_json::Map<String, Value>;

/// The rows of one or more roots and of their dependencies.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Bundle {
    pub roots: Vec<Root>,
    /// Table name → rows (only non-empty tables), each row once.
    pub tables: BTreeMap<String, Vec<Row>>,
    /// Paths under `<data>/uploads` referenced by a `"/uploads/…"` text value
    /// of an exported row (also inside JSON), without the `/uploads/` prefix.
    pub uploads: BTreeSet<String>,
}

#[derive(Debug)]
pub enum TransferError {
    /// The root does not exist here.
    NotFound(RootKind, String),
    /// A French message for the user.
    Invalid(String),
    Db(sqlx::Error),
    Io(std::io::Error),
    /// A write that failed (disk full, folder not writable).
    Storage(std::io::Error),
    /// A site restore failed and the original data could not all be put
    /// back: it is (partly) still in this folder.
    Stranded(std::path::PathBuf),
}

/// The message of [`TransferError::Storage`].
pub const STORAGE: &str = "Espace disque insuffisant ou dossier non inscriptible.";

/// The last failure of an automatic mechanism (AppConfig
/// `backups.projects.lastError`, `backups.site.lastError`), cleared on its
/// next success.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LastError {
    pub at: String,
    /// French, for the user.
    pub message: String,
}

/// The AppConfig key of the last error of the mechanism `key`.
fn last_error_key(key: &str) -> String {
    format!("{key}.lastError")
}

pub async fn load_last_error(pool: &sqlx::SqlitePool, key: &str) -> Option<LastError> {
    let v: Option<String> =
        sqlx::query_scalar(r#"SELECT "value" FROM "AppConfig" WHERE "key" = ?"#)
            .bind(last_error_key(key))
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    v.and_then(|v| serde_json::from_str(&v).ok())
}

/// Keeps `message` as the last error of `key` (`None` clears it). A
/// failure is only logged.
pub async fn record_last_error(pool: &sqlx::SqlitePool, key: &str, message: Option<String>) {
    let key = last_error_key(key);
    let res = match message {
        Some(message) => {
            let value = serde_json::to_string(&LastError {
                at: crate::ids::now_iso(),
                message,
            })
            .unwrap_or_default();
            sqlx::query(
                r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES (?,?,?,?)
                   ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt""#,
            )
            .bind(crate::ids::new_id())
            .bind(&key)
            .bind(value)
            .bind(crate::ids::now_iso())
            .execute(pool)
            .await
        }
        None => {
            sqlx::query(r#"DELETE FROM "AppConfig" WHERE "key" = ?"#)
                .bind(&key)
                .execute(pool)
                .await
        }
    };
    if let Err(e) = res {
        tracing::warn!("cannot record {key}: {e}");
    }
}

/// Removes the file when dropped.
pub struct RemoveOnDrop(pub std::path::PathBuf);

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

impl fmt::Display for TransferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TransferError::NotFound(kind, _) => f.write_str(match kind {
                RootKind::Project => "Projet introuvable",
                RootKind::Rack => "Contenant introuvable",
                RootKind::Rig => "Régie introuvable",
                RootKind::Panel => "Panel introuvable",
            }),
            TransferError::Invalid(msg) => f.write_str(msg),
            TransferError::Db(e) => write!(f, "Erreur de base de données : {e}"),
            TransferError::Io(e) => write!(f, "Erreur de fichier : {e}"),
            TransferError::Storage(_) => f.write_str(STORAGE),
            TransferError::Stranded(dir) => write!(
                f,
                "La restauration du site a échoué et les données d'origine n'ont pas pu être \
                 toutes remises en place : elles sont dans « {dir} ». Remettez-les en place à \
                 la main, puis supprimez « restore-stranded.json » du dossier de données. \
                 (The site restore failed and the original data could not all be put back: \
                 it is in « {dir} ». Put it back by hand, then delete restore-stranded.json \
                 from the data folder.)",
                dir = dir.display()
            ),
        }
    }
}

impl std::error::Error for TransferError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            TransferError::Db(e) => Some(e),
            TransferError::Io(e) | TransferError::Storage(e) => Some(e),
            _ => None,
        }
    }
}

impl From<sqlx::Error> for TransferError {
    fn from(e: sqlx::Error) -> Self {
        TransferError::Db(e)
    }
}

impl From<std::io::Error> for TransferError {
    fn from(e: std::io::Error) -> Self {
        TransferError::Io(e)
    }
}
