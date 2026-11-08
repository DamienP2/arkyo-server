//! The `.arkyo` archive (spec 2026-11-07-sauvegardes-design §3): a zip with
//! `manifest.json`, `data.json` and `uploads/<path>`.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::{Bundle, Root, Row, TransferError};

const FORMAT: &str = "arkyo-server-transfer";
const VERSION: u32 = 1;
/// Maximum sum of the declared uncompressed sizes of an archive.
const MAX_TOTAL: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Author {
    pub id: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub created_at: String,
    #[serde(default)]
    pub created_by: Option<Author>,
    pub roots: Vec<Root>,
    pub counts: BTreeMap<String, usize>,
    /// The label of a restore point (`transfer::points`), kept in the file
    /// so that a rebuilt index still has it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

fn bad() -> TransferError {
    TransferError::Invalid("Archive invalide.".into())
}

fn zip_err(_: zip::result::ZipError) -> TransferError {
    bad()
}

/// An upload path (relative to `<data>/uploads`) that stays inside it.
pub(crate) fn safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.contains('\\')
        && !rel.contains('\0')
        && Path::new(rel)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
        && !rel.starts_with('/')
        && !rel.contains("//")
        && !rel.ends_with('/')
}

/// Writes `bundle` as an archive at `out`. A referenced upload missing from
/// `uploads_dir` is skipped (the value stays in the rows).
pub fn write_archive(
    bundle: &Bundle,
    author: Option<Author>,
    uploads_dir: &Path,
    out: &Path,
) -> Result<Manifest, TransferError> {
    write_archive_labeled(bundle, author, None, uploads_dir, out)
}

/// [`write_archive`] with the label of a restore point in the manifest.
pub fn write_archive_labeled(
    bundle: &Bundle,
    author: Option<Author>,
    label: Option<String>,
    uploads_dir: &Path,
    out: &Path,
) -> Result<Manifest, TransferError> {
    let manifest = Manifest {
        format: FORMAT.into(),
        version: VERSION,
        app_version: env!("CARGO_PKG_VERSION").into(),
        created_at: crate::ids::now_iso(),
        created_by: author,
        roots: bundle.roots.clone(),
        counts: bundle
            .tables
            .iter()
            .map(|(t, r)| (t.clone(), r.len()))
            .collect(),
        label,
    };
    let opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true);
    let mut z = ZipWriter::new(File::create(out)?);
    z.start_file("manifest.json", opts).map_err(zip_err)?;
    serde_json::to_writer(&mut z, &manifest).map_err(|_| bad())?;
    z.start_file("data.json", opts).map_err(zip_err)?;
    serde_json::to_writer(&mut z, &bundle.tables).map_err(|_| bad())?;
    for rel in &bundle.uploads {
        if !safe_rel(rel) {
            continue;
        }
        let src = uploads_dir.join(rel);
        if !src.is_file() {
            continue;
        }
        z.start_file(format!("uploads/{rel}"), opts)
            .map_err(zip_err)?;
        io::copy(&mut File::open(&src)?, &mut z)?;
    }
    z.finish().map_err(zip_err)?;
    Ok(manifest)
}

fn open(path: &Path) -> Result<ZipArchive<File>, TransferError> {
    ZipArchive::new(File::open(path)?).map_err(zip_err)
}

/// Checks every entry name and the total declared size; returns the
/// `(index, relative upload path, declared size)` of the upload files.
fn scan(z: &mut ZipArchive<File>) -> Result<Vec<(usize, String, u64)>, TransferError> {
    let mut total: u64 = 0;
    let mut uploads = Vec::new();
    for i in 0..z.len() {
        let e = z.by_index_raw(i).map_err(zip_err)?;
        total = total.saturating_add(e.size());
        let name = e.name().map_err(zip_err)?;
        if name.starts_with('/') || name.contains('\\') || name.split('/').any(|p| p == "..") {
            return Err(bad());
        }
        if let Some(rel) = name.strip_prefix("uploads/") {
            if e.is_dir() {
                continue;
            }
            if !safe_rel(rel) {
                return Err(bad());
            }
            uploads.push((i, rel.to_string(), e.size()));
        }
    }
    if total > MAX_TOTAL {
        return Err(TransferError::Invalid("Archive trop volumineuse.".into()));
    }
    Ok(uploads)
}

fn read_entry_json(z: &mut ZipArchive<File>, name: &str) -> Result<Value, TransferError> {
    let e = z.by_name(name).map_err(zip_err)?;
    let size = e.size();
    serde_json::from_reader(io::BufReader::new(e.take(size))).map_err(|_| bad())
}

/// Reads the manifest and the rows (uploads are not read into memory).
pub fn read_archive(path: &Path) -> Result<(Manifest, Bundle), TransferError> {
    let mut z = open(path)?;
    let uploads = scan(&mut z)?;
    let m = read_entry_json(&mut z, "manifest.json")?;
    if m.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(TransferError::Invalid(
            "Ce fichier n'est pas un export Strata Arkyo.".into(),
        ));
    }
    if m.get("version").and_then(Value::as_u64).unwrap_or(0) > u64::from(VERSION) {
        return Err(TransferError::Invalid(
            "Ce fichier vient d'une version plus récente de Strata Arkyo.".into(),
        ));
    }
    let manifest: Manifest = serde_json::from_value(m).map_err(|_| bad())?;
    let Value::Object(data) = read_entry_json(&mut z, "data.json")? else {
        return Err(bad());
    };
    let mut tables = BTreeMap::new();
    for (table, rows) in data {
        let Value::Array(rows) = rows else {
            return Err(bad());
        };
        let rows = rows
            .into_iter()
            .map(|r| match r {
                Value::Object(o) => Ok(o),
                _ => Err(bad()),
            })
            .collect::<Result<Vec<Row>, _>>()?;
        tables.insert(table, rows);
    }
    let bundle = Bundle {
        roots: manifest.roots.clone(),
        tables,
        uploads: uploads.into_iter().map(|(_, rel, _)| rel).collect(),
    };
    Ok((manifest, bundle))
}

/// Copies the archive's uploads into `uploads_dir`, only those absent there;
/// returns how many were copied.
pub fn extract_uploads(path: &Path, uploads_dir: &Path) -> Result<usize, TransferError> {
    let mut z = open(path)?;
    let uploads = scan(&mut z)?;
    let mut copied = 0;
    for (i, rel, size) in uploads {
        let dest: PathBuf = uploads_dir.join(&rel);
        if dest.exists() {
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let part = dest.with_extension("part-transfer");
        let mut entry = z.by_index(i).map_err(zip_err)?;
        let written = {
            let mut f = File::create(&part)?;
            // Never write more than declared.
            let n = io::copy(&mut (&mut entry).take(size), &mut f)?;
            f.flush()?;
            n
        };
        if written != size {
            let _ = std::fs::remove_file(&part);
            return Err(bad());
        }
        std::fs::rename(&part, &dest)?;
        copied += 1;
    }
    Ok(copied)
}

struct HashWriter(Sha256);

impl Write for HashWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.update(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// SHA-256 (hex) of the canonical `data.json`: tables sorted, rows sorted by
/// `id` then by their JSON, keys sorted.
pub fn data_digest(bundle: &Bundle) -> String {
    let mut w = HashWriter(Sha256::new());
    let canon: BTreeMap<&String, Vec<(String, String)>> = bundle
        .tables
        .iter()
        .map(|(t, rows)| {
            let mut v: Vec<(String, String)> = rows
                .iter()
                .map(|r| {
                    let sorted: BTreeMap<&String, &Value> = r.iter().collect();
                    let id = match r.get("id") {
                        Some(Value::String(s)) => s.clone(),
                        _ => String::new(),
                    };
                    (id, serde_json::to_string(&sorted).unwrap_or_default())
                })
                .collect();
            v.sort();
            (t, v)
        })
        .collect();
    for (t, rows) in &canon {
        let _ = write!(w, "{t:?}:[");
        for (_, json) in rows {
            let _ = write!(w, "{json},");
        }
        let _ = write!(w, "]");
    }
    let hex: String = w.0.finalize().iter().map(|b| format!("{b:02x}")).collect();
    hex
}
