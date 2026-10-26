//! Arkyo desktop companion.
//!
//! A small menu bar (macOS) / notification area (Windows) app installed next
//! to the server: it shows whether the server runs, opens the web interface
//! and starts / stops the background service.
#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(any(target_os = "macos", windows))]
mod app;

#[cfg(any(target_os = "macos", windows))]
fn main() {
    app::run();
}

#[cfg(not(any(target_os = "macos", windows)))]
fn main() {
    eprintln!("L'app tray Arkyo est disponible sur macOS et Windows ; sous Linux utilisez `arkyo-server service status` et l'interface web.");
}
