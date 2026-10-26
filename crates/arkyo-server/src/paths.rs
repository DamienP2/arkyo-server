//! Platform-specific default locations.

use std::path::{Path, PathBuf};

pub const SERVICE_NAME: &str = "arkyo-server";

/// Data directory for an interactive run (per user).
pub fn user_data_dir() -> PathBuf {
    directories::ProjectDirs::from("com", "Arkyo", "Arkyo")
        .map(|d| d.data_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("data"))
}

/// Data directory used by the system service.
pub fn system_data_dir() -> PathBuf {
    if cfg!(windows) {
        program_data().join("Arkyo")
    } else if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/Arkyo")
    } else {
        PathBuf::from("/var/lib/arkyo")
    }
}

fn program_data() -> PathBuf {
    std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
}

/// The data directory a CLI command acts on: explicit, else the installed
/// service's when it exists, else the per-user one.
pub fn cli_data_dir(explicit: Option<PathBuf>) -> PathBuf {
    cli_data_dir_in(explicit, &system_data_dir(), &user_data_dir())
}

/// Same rule with the candidate directories given (the service always writes
/// `config.json` at startup, which makes its directory detectable).
pub fn cli_data_dir_in(explicit: Option<PathBuf>, system: &Path, user: &Path) -> PathBuf {
    explicit.unwrap_or_else(|| {
        if system.join("config.json").exists() {
            system.to_path_buf()
        } else {
            user.to_path_buf()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_data_dir_prefers_explicit() {
        let sys = Path::new("/sys");
        let usr = Path::new("/usr");
        assert_eq!(
            cli_data_dir_in(Some("/x".into()), sys, usr),
            PathBuf::from("/x")
        );
    }

    #[test]
    fn cli_data_dir_targets_service_dir_when_it_has_config() {
        let sys = tempfile::tempdir().unwrap();
        let usr = tempfile::tempdir().unwrap();
        assert_eq!(
            cli_data_dir_in(None, sys.path(), usr.path()),
            usr.path().to_path_buf()
        );
        std::fs::write(sys.path().join("config.json"), "{}").unwrap();
        assert_eq!(
            cli_data_dir_in(None, sys.path(), usr.path()),
            sys.path().to_path_buf()
        );
    }
}
