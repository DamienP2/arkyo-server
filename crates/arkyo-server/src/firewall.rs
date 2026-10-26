//! macOS application firewall: it blocks incoming connections to a program it
//! does not know, silently for a service (no one sees the prompt). Each
//! unsigned update is a new program to it.
//!
//! `socketfilterfw --add` signs an unsigned program in place: it must never
//! touch the file of the running server (macOS kills a process whose code
//! changes under it). It is run by the installer before the service starts
//! (`packaging/macos/pkg/scripts/postinstall`), and by an update on the new
//! file once swapped in — the running process keeps its old image.

use std::path::Path;

#[cfg(target_os = "macos")]
const FW: &str = "/usr/libexec/ApplicationFirewall/socketfilterfw";

/// The `socketfilterfw` calls allowing `exe`, given the output of
/// `socketfilterfw --getglobalstate`: none when the firewall is off
/// ("Firewall is disabled. (State = 0)").
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn commands(exe: &Path, global_state: &str) -> Vec<Vec<String>> {
    if global_state.contains("State = 0") {
        return Vec::new();
    }
    let path = exe.to_string_lossy().into_owned();
    vec![
        vec!["--add".into(), path.clone()],
        vec!["--unblockapp".into(), path],
    ]
}

/// Lets other machines reach `exe` through the macOS firewall. Only root can
/// change the firewall: does nothing otherwise, and elsewhere than on macOS.
#[cfg(target_os = "macos")]
pub fn allow(exe: &Path) {
    use std::process::Command;
    // SAFETY: geteuid has no preconditions and cannot fail.
    if unsafe { libc::geteuid() } != 0 {
        return;
    }
    let run = |args: &[String]| {
        Command::new(FW)
            .args(args)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
    };
    let Ok(state) = run(&["--getglobalstate".to_string()]) else {
        return;
    };
    let mut failed = Vec::new();
    for args in commands(exe, &state) {
        if let Err(e) = run(&args) {
            failed.push(format!("{}: {e}", args[0]));
        }
    }
    if failed.is_empty() {
        tracing::info!(exe = %exe.display(), "allowed through the macOS firewall");
    } else {
        tracing::warn!(exe = %exe.display(), errors = ?failed, "cannot allow the server through the macOS firewall");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn allow(_exe: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_to_do_when_the_firewall_is_off() {
        let exe = Path::new("/usr/local/arkyo/arkyo-server");
        assert!(commands(exe, "Firewall is disabled. (State = 0)\n").is_empty());
    }

    #[test]
    fn adds_and_unblocks_the_swapped_in_file() {
        let exe = Path::new("/usr/local/arkyo/arkyo-server");
        for state in [
            "Firewall is enabled. (State = 1)\n",
            "Firewall is blocking all non-essential incoming connections. (State = 2)\n",
        ] {
            assert_eq!(
                commands(exe, state),
                [
                    ["--add", "/usr/local/arkyo/arkyo-server"],
                    ["--unblockapp", "/usr/local/arkyo/arkyo-server"],
                ]
            );
        }
    }
}
