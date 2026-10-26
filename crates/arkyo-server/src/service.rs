//! System-service supervision hooks.
//!
//! Minimal for now: it only tells the updater whether a service manager
//! (systemd, launchd, the Windows SCM) will restart the process. Installing
//! and running the service itself is completed in Task 9.

use std::sync::atomic::{AtomicBool, Ordering};

static SUPERVISED: AtomicBool = AtomicBool::new(false);

/// Records whether this process runs under a service manager that restarts it.
/// `windows_service` is true when started by the Windows SCM.
pub fn set_supervised(windows_service: bool) {
    // systemd sets INVOCATION_ID, launchd sets XPC_SERVICE_NAME to the label.
    let env = |k: &str| std::env::var(k).ok();
    let supervised = windows_service
        || env("ARKYO_SUPERVISED").is_some_and(|v| v == "1")
        || env("INVOCATION_ID").is_some()
        || env("XPC_SERVICE_NAME").is_some_and(|v| v == "com.arkyo.server");
    SUPERVISED.store(supervised, Ordering::Relaxed);
}

pub fn is_supervised() -> bool {
    SUPERVISED.load(Ordering::Relaxed)
}
