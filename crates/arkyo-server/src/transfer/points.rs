//! Restore points of a project (spec 2026-11-07-sauvegardes-design §5):
//! `.arkyo` files under `<data>/backups/projects/<projectId>/`.

use std::path::PathBuf;

use super::import::export_to_file;
use super::{RootKind, TransferError};
use crate::http::AppState;
use crate::users::User;

/// The folder of the points of a project.
pub fn project_dir(st: &AppState, project_id: &str) -> Result<PathBuf, TransferError> {
    let plain = !project_id.is_empty()
        && project_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !plain {
        return Err(TransferError::Invalid(
            "Identifiant de projet invalide.".into(),
        ));
    }
    Ok(st
        .data_dir
        .join("backups")
        .join("projects")
        .join(project_id))
}

/// Writes the current state of the project as a point
/// `<AAAAMMJJ-HHMMSS>-avant-restauration.arkyo` (UTC), before a restore
/// replaces it.
pub async fn snapshot_before_restore(
    st: &AppState,
    project_id: &str,
    user: &User,
) -> Result<(), TransferError> {
    let dir = project_dir(st, project_id)?;
    std::fs::create_dir_all(&dir)?;
    let stamp = jiff::Timestamp::now().strftime("%Y%m%d-%H%M%S").to_string();
    let mut path = dir.join(format!("{stamp}-avant-restauration.arkyo"));
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{stamp}-{n}-avant-restauration.arkyo"));
        n += 1;
    }
    let part = path.with_extension("arkyo.part");
    let roots = [(RootKind::Project, project_id.to_string())];
    if let Err(e) = export_to_file(st, user, &roots, &part).await {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    std::fs::rename(&part, &path)?;
    Ok(())
}
