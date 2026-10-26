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
pub fn cli_data_dir(explicit: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    cli_data_dir_in(explicit, &system_data_dir(), &user_data_dir())
}

/// Same rule with the candidate directories given (the service always writes
/// `config.json` at startup, which makes its directory detectable).
///
/// A service directory this account cannot search (`/var/lib/arkyo` is 0700
/// on Linux) is an error: silently falling back to the per-user directory
/// would act on the wrong base.
pub fn cli_data_dir_in(
    explicit: Option<PathBuf>,
    system: &Path,
    user: &Path,
) -> anyhow::Result<PathBuf> {
    if let Some(dir) = explicit {
        return Ok(dir);
    }
    match system.join("config.json").try_exists() {
        Ok(true) => Ok(system.to_path_buf()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => anyhow::bail!(
            "le dossier de données du service ({}) existe mais n'est pas lisible par ce \
             compte. Lancez la commande avec `sudo -u arkyo arkyo-server …` (Ubuntu) ou \
             `sudo arkyo-server …`, ou choisissez un dossier avec --data-dir.",
            system.display()
        ),
        // Absent (or another error): no service installed here.
        Ok(false) | Err(_) => Ok(user.to_path_buf()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_data_dir_prefers_explicit() {
        let sys = Path::new("/sys");
        let usr = Path::new("/usr");
        assert_eq!(
            cli_data_dir_in(Some("/x".into()), sys, usr).unwrap(),
            PathBuf::from("/x")
        );
    }

    #[test]
    fn cli_data_dir_targets_service_dir_when_it_has_config() {
        let sys = tempfile::tempdir().unwrap();
        let usr = tempfile::tempdir().unwrap();
        assert_eq!(
            cli_data_dir_in(None, sys.path(), usr.path()).unwrap(),
            usr.path().to_path_buf()
        );
        std::fs::write(sys.path().join("config.json"), "{}").unwrap();
        assert_eq!(
            cli_data_dir_in(None, sys.path(), usr.path()).unwrap(),
            sys.path().to_path_buf()
        );
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_service_dir_is_an_error_not_a_fallback() {
        use std::os::unix::fs::PermissionsExt;
        // SAFETY: geteuid has no preconditions and cannot fail.
        if unsafe { libc::geteuid() } == 0 {
            return; // root can search a 0000 directory
        }
        let sys = tempfile::tempdir().unwrap();
        let usr = tempfile::tempdir().unwrap();
        std::fs::write(sys.path().join("config.json"), "{}").unwrap();
        let set = |m| std::fs::set_permissions(sys.path(), std::fs::Permissions::from_mode(m));
        set(0o000).unwrap();
        let r = cli_data_dir_in(None, sys.path(), usr.path());
        set(0o700).unwrap();
        let msg = r.unwrap_err().to_string();
        assert!(msg.contains("n'est pas lisible"), "{msg}");
        assert!(msg.contains("sudo -u arkyo"), "{msg}");
        // An explicit directory still wins.
        assert!(cli_data_dir_in(Some("/x".into()), sys.path(), usr.path()).is_ok());
    }
}
