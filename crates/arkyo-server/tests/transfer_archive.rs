//! Sauvegardes, Task 2: the `.arkyo` archive (manifest, data, uploads).
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::Path;

use arkyo_server::transfer::archive::{
    data_digest, extract_uploads, read_archive, write_archive, Author,
};
use arkyo_server::transfer::{Bundle, Root, RootKind, Row, TransferError};
use serde_json::json;
use zip::write::SimpleFileOptions;

fn row(v: serde_json::Value) -> Row {
    v.as_object().unwrap().clone()
}

fn sample() -> Bundle {
    let mut tables = BTreeMap::new();
    tables.insert(
        "Project".to_string(),
        vec![row(
            json!({"id":"p1","name":"Show","logo":"/uploads/logos/a.png","n":3,"x":1.5,"z":null}),
        )],
    );
    tables.insert(
        "Panel".to_string(),
        vec![
            row(json!({"id":"a","name":"A"})),
            row(json!({"id":"b","name":"B"})),
        ],
    );
    Bundle {
        roots: vec![Root {
            kind: RootKind::Project,
            id: "p1".into(),
            name: "Show".into(),
        }],
        tables,
        uploads: BTreeSet::from(["logos/a.png".to_string(), "missing/b.png".to_string()]),
    }
}

fn invalid(r: Result<impl std::fmt::Debug, TransferError>) -> String {
    match r {
        Err(TransferError::Invalid(m)) => m,
        other => panic!("expected Invalid, got {other:?}"),
    }
}

/// Builds a zip with the given (name, bytes) entries.
fn zip_of(path: &Path, entries: &[(&str, &[u8])]) {
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    for (n, b) in entries {
        z.start_file(*n, SimpleFileOptions::default()).unwrap();
        z.write_all(b).unwrap();
    }
    z.finish().unwrap();
}

const MANIFEST: &str = r#"{"format":"arkyo-server-transfer","version":1,"appVersion":"0.1.0","createdAt":"2026-11-07T10:00:00.000Z","createdBy":null,"roots":[],"counts":{}}"#;

#[test]
fn roundtrip_keeps_rows_and_uploads() {
    let dir = tempfile::tempdir().unwrap();
    let uploads = dir.path().join("uploads");
    std::fs::create_dir_all(uploads.join("logos")).unwrap();
    std::fs::write(uploads.join("logos/a.png"), b"PNGDATA").unwrap();
    let out = dir.path().join("x.arkyo");
    let bundle = sample();
    let author = Author {
        id: "u1".into(),
        name: Some("Ada".into()),
        email: None,
    };
    let m = write_archive(&bundle, Some(author), &uploads, &out).unwrap();
    assert_eq!(m.format, "arkyo-server-transfer");
    assert_eq!(m.version, 1);
    assert_eq!(m.counts["Panel"], 2);
    assert_eq!(m.counts["Project"], 1);

    let (m2, b2) = read_archive(&out).unwrap();
    assert_eq!(m2.roots, bundle.roots);
    assert_eq!(m2.created_by.unwrap().id, "u1");
    assert_eq!(b2.roots, bundle.roots);
    assert_eq!(b2.tables, bundle.tables);
    // only the file that exists was archived
    assert_eq!(b2.uploads, BTreeSet::from(["logos/a.png".to_string()]));

    let target = dir.path().join("other");
    assert_eq!(extract_uploads(&out, &target).unwrap(), 1);
    assert_eq!(
        std::fs::read(target.join("logos/a.png")).unwrap(),
        b"PNGDATA"
    );
}

#[test]
fn rejects_non_zip() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.arkyo");
    std::fs::write(&p, b"not a zip at all").unwrap();
    assert_eq!(invalid(read_archive(&p)), "Archive invalide.");
}

#[test]
fn rejects_missing_manifest() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.arkyo");
    zip_of(&p, &[("data.json", b"{}")]);
    assert_eq!(invalid(read_archive(&p)), "Archive invalide.");
}

#[test]
fn rejects_foreign_format() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.arkyo");
    let m = MANIFEST.replace("arkyo-server-transfer", "arkyo-server-site");
    zip_of(&p, &[("manifest.json", m.as_bytes()), ("data.json", b"{}")]);
    assert_eq!(
        invalid(read_archive(&p)),
        "Ce fichier n'est pas un export Strata Arkyo."
    );
}

#[test]
fn rejects_newer_major_version() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.arkyo");
    let m = MANIFEST.replace("\"version\":1", "\"version\":2");
    zip_of(&p, &[("manifest.json", m.as_bytes()), ("data.json", b"{}")]);
    assert_eq!(
        invalid(read_archive(&p)),
        "Ce fichier vient d'une version plus récente de Strata Arkyo."
    );
}

#[test]
fn rejects_path_traversal() {
    let dir = tempfile::tempdir().unwrap();
    for bad in [
        "uploads/../../x",
        "/abs/x",
        "uploads//abs/x",
        "uploads/..\\x",
    ] {
        let p = dir.path().join("a.arkyo");
        zip_of(
            &p,
            &[
                ("manifest.json", MANIFEST.as_bytes()),
                ("data.json", b"{}"),
                (bad, b"boom"),
            ],
        );
        assert_eq!(invalid(read_archive(&p)), "Archive invalide.", "{bad}");
        let target = dir.path().join("t");
        assert_eq!(
            invalid(extract_uploads(&p, &target)),
            "Archive invalide.",
            "{bad}"
        );
        assert!(!dir.path().join("x").exists());
    }
}

/// Patches the declared uncompressed size of every central-directory entry.
fn patch_declared_sizes(path: &Path, size: u32) {
    let mut b = std::fs::read(path).unwrap();
    let mut i = 0;
    while i + 46 <= b.len() {
        if b[i..i + 4] == [0x50, 0x4b, 0x01, 0x02] {
            b[i + 24..i + 28].copy_from_slice(&size.to_le_bytes());
            let n = u16::from_le_bytes([b[i + 28], b[i + 29]]) as usize;
            let m = u16::from_le_bytes([b[i + 30], b[i + 31]]) as usize;
            let k = u16::from_le_bytes([b[i + 32], b[i + 33]]) as usize;
            i += 46 + n + m + k;
        } else {
            i += 1;
        }
    }
    std::fs::write(path, b).unwrap();
}

#[test]
fn rejects_oversized() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.arkyo");
    zip_of(
        &p,
        &[
            ("manifest.json", MANIFEST.as_bytes()),
            ("data.json", b"{}"),
            ("uploads/a.bin", b"aaaa"),
        ],
    );
    // 3 entries x ~2 GiB declared > 4 GiB
    patch_declared_sizes(&p, 0x8000_0000);
    assert_eq!(invalid(read_archive(&p)), "Archive trop volumineuse.");
    let target = dir.path().join("t");
    assert_eq!(
        invalid(extract_uploads(&p, &target)),
        "Archive trop volumineuse."
    );
}

#[test]
fn extract_never_overwrites() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("a.png"), b"NEW").unwrap();
    std::fs::write(src.join("b.png"), b"NEWB").unwrap();
    let mut bundle = sample();
    bundle.uploads = BTreeSet::from(["a.png".to_string(), "b.png".to_string()]);
    let out = dir.path().join("x.arkyo");
    write_archive(&bundle, None, &src, &out).unwrap();

    let target = dir.path().join("target");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("a.png"), b"OLD").unwrap();
    assert_eq!(extract_uploads(&out, &target).unwrap(), 1);
    assert_eq!(std::fs::read(target.join("a.png")).unwrap(), b"OLD");
    assert_eq!(std::fs::read(target.join("b.png")).unwrap(), b"NEWB");
    assert_eq!(extract_uploads(&out, &target).unwrap(), 0);
}

#[test]
fn digest_is_order_independent() {
    let a = sample();
    let mut b = sample();
    b.tables.get_mut("Panel").unwrap().reverse();
    assert_eq!(data_digest(&a), data_digest(&b));
    assert_eq!(data_digest(&a).len(), 64);
    let mut c = sample();
    c.tables.get_mut("Panel").unwrap()[0].insert("name".into(), json!("changed"));
    assert_ne!(data_digest(&a), data_digest(&c));
}
