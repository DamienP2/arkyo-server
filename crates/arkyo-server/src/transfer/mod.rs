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
pub mod rows;

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
        }
    }
}

impl std::error::Error for TransferError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            TransferError::Db(e) => Some(e),
            TransferError::Io(e) => Some(e),
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
