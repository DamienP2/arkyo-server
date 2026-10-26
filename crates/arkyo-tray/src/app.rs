use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

/// Loopback port used only as a single-instance lock.
const INSTANCE_LOCK: &str = "127.0.0.1:47820";
const DEFAULT_PORT: u16 = 8090;

enum UserEvent {
    Menu(MenuEvent),
    Status(bool),
}

// ---------------------------------------------------------------- words ----

const TITLE: &str = "Arkyo";
const OPEN: &str = "Ouvrir Arkyo";
const START: &str = "Démarrer le service";
const STOP: &str = "Arrêter le service";
const QUIT: &str = "Quitter";
const RUNNING: &str = "En marche";
const STOPPED: &str = "Arrêté";
const CHECKING: &str = "Vérification…";

fn status_label(running: bool) -> String {
    format!("{TITLE} — {}", if running { RUNNING } else { STOPPED })
}

// ------------------------------------------------------------ locations ----

/// The service's data directory (the tray talks to the installed service).
fn data_dir() -> PathBuf {
    if cfg!(windows) {
        std::env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
            .join("Arkyo")
    } else {
        PathBuf::from("/Library/Application Support/Arkyo")
    }
}

fn server_exe() -> PathBuf {
    if cfg!(windows) {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("arkyo-server.exe")))
            .unwrap_or_else(|| PathBuf::from("arkyo-server.exe"))
    } else {
        PathBuf::from("/usr/local/arkyo/arkyo-server")
    }
}

/// The port saved in `config.json` of `dir`, else the default one.
fn port_in(dir: &Path) -> u16 {
    std::fs::read(dir.join("config.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|j| j.get("port")?.as_u64())
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p != 0)
        .unwrap_or(DEFAULT_PORT)
}

/// The web interface address for the configuration found in `dir`.
fn ui_url_in(dir: &Path) -> String {
    format!("http://localhost:{}", port_in(dir))
}

fn ui_url() -> String {
    ui_url_in(&data_dir())
}

// -------------------------------------------------------------- actions ----

fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    let r = Command::new("open").arg(url).spawn();
    #[cfg(windows)]
    let r = Command::new("explorer.exe").arg(url).spawn();
    if let Err(e) = r {
        eprintln!("cannot open {url}: {e}");
    }
}

/// Shows a native error dialog (the tray has no window of its own).
fn alert(message: &str) {
    #[cfg(target_os = "macos")]
    {
        let esc = |t: &str| t.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "display alert \"Arkyo\" message \"{}\" as critical",
            esc(message)
        );
        let _ = Command::new("osascript").args(["-e", &script]).spawn();
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let ps = format!(
            "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('{}', 'Arkyo', 'OK', 'Error')",
            message.replace('\'', "''")
        );
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_millis(1500)))
        .build()
        .into()
}

/// The server answers `ok` on `/healthz` when it runs.
fn is_running() -> bool {
    agent()
        .get(format!("{}/healthz", ui_url()))
        .call()
        .is_ok_and(|r| r.status().is_success())
}

/// Runs `arkyo-server service <action>` with administrator rights: without a
/// password when the installer allowed it (sudoers), else the system prompt.
fn service_as_admin(action: &'static str) -> Result<(), String> {
    let exe = server_exe();
    #[cfg(target_os = "macos")]
    {
        let quiet = Command::new("sudo")
            .arg("-n")
            .arg(&exe)
            .args(["service", action])
            .output();
        if quiet.is_ok_and(|o| o.status.success()) {
            return Ok(());
        }
        let cmd = format!("'{}' service {action} 2>&1", exe.display());
        let script = format!(
            "do shell script \"{}\" with administrator privileges",
            cmd.replace('\\', "\\\\").replace('"', "\\\"")
        );
        match Command::new("osascript").args(["-e", &script]).output() {
            Ok(o) if o.status.success() => Ok(()),
            // -128: the user cancelled the authentication dialog.
            Ok(o) if String::from_utf8_lossy(&o.stderr).contains("-128") => Ok(()),
            Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let ps = format!(
            "$p = Start-Process -Verb RunAs -WindowStyle Hidden -Wait -PassThru -FilePath '{}' -ArgumentList 'service','{action}'; exit $p.ExitCode",
            exe.display().to_string().replace('\'', "''")
        );
        match Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("arkyo-server service {action} : {s}")),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Start or stop the service, then refresh the status.
fn server_action(start: bool, refresh: EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || {
        let action = if start { "start" } else { "stop" };
        if let Err(e) = service_as_admin(action) {
            let what = if start { "démarrer" } else { "arrêter" };
            alert(&format!("Impossible de {what} le service Arkyo.\n\n{e}"));
        }
        let _ = refresh.send_event(UserEvent::Status(is_running()));
    });
}

fn poll(proxy: EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || loop {
        if proxy.send_event(UserEvent::Status(is_running())).is_err() {
            return;
        }
        std::thread::sleep(Duration::from_secs(2));
    });
}

// ----------------------------------------------------------------- icon ----

fn icon() -> Icon {
    #[cfg(target_os = "macos")]
    let (rgba, size) = (
        include_bytes!("../../../assets/icons/tray-template-44.rgba").to_vec(),
        44,
    );
    #[cfg(windows)]
    let (rgba, size) = (
        include_bytes!("../../../assets/icons/tray-color-64.rgba").to_vec(),
        64,
    );
    Icon::from_rgba(rgba, size, size).expect("valid tray icon")
}

// ------------------------------------------------------------------ app ----

pub fn run() {
    let background = std::env::args().any(|a| a == "--background");

    // Second launch (e.g. from the Applications folder while the menu bar
    // app already runs): just bring up the web interface.
    let Ok(_lock) = TcpListener::bind(INSTANCE_LOCK) else {
        open_url(&ui_url());
        return;
    };

    #[allow(unused_mut)]
    let mut event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    #[cfg(target_os = "macos")]
    {
        use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
        // Menu bar only: no Dock icon, no app switcher entry.
        event_loop.set_activation_policy(ActivationPolicy::Accessory);
    }
    let proxy = event_loop.create_proxy();
    let menu_proxy = proxy.clone();
    MenuEvent::set_event_handler(Some(move |e| {
        let _ = menu_proxy.send_event(UserEvent::Menu(e));
    }));

    let status_item = MenuItem::new(CHECKING, false, None);
    let open_item = MenuItem::new(OPEN, false, None);
    let start_stop = MenuItem::new(START, true, None);
    let quit_item = MenuItem::new(QUIT, true, None);
    let menu = Menu::new();
    let _ = menu.append_items(&[
        &status_item,
        &PredefinedMenuItem::separator(),
        &open_item,
        &PredefinedMenuItem::separator(),
        &start_stop,
        &quit_item,
    ]);
    let mut menu = Some(menu);
    let mut tray: Option<TrayIcon> = None;
    let mut running = false;
    let mut first_status = true;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            // The tray must be created once the event loop runs (macOS).
            Event::NewEvents(StartCause::Init) => {
                // macOS draws a monochrome template that follows the menu bar theme.
                #[cfg(target_os = "macos")]
                let builder = TrayIconBuilder::new().with_icon_templated(icon());
                #[cfg(windows)]
                let builder = TrayIconBuilder::new().with_icon(icon());
                let mut builder = builder.with_tooltip(TITLE);
                if let Some(m) = menu.take() {
                    builder = builder.with_menu(Box::new(m));
                }
                match builder.build() {
                    Ok(t) => tray = Some(t),
                    Err(e) => {
                        eprintln!("cannot create the tray icon: {e}");
                        *control_flow = ControlFlow::Exit;
                    }
                }
                poll(proxy.clone());
            }
            Event::UserEvent(UserEvent::Status(now)) => {
                // Opened by the user (not at login): show the web interface
                // once the server answers.
                if first_status && !background && now {
                    open_url(&ui_url());
                }
                if first_status || now != running {
                    let label = status_label(now);
                    status_item.set_text(&label);
                    open_item.set_enabled(now);
                    start_stop.set_text(if now { STOP } else { START });
                    if let Some(t) = tray.as_ref() {
                        let _ = t.set_tooltip(Some(label));
                    }
                }
                first_status = false;
                running = now;
            }
            Event::UserEvent(UserEvent::Menu(e)) => {
                let id = e.id();
                if id == open_item.id() {
                    open_url(&ui_url());
                } else if id == start_stop.id() {
                    server_action(!running, proxy.clone());
                } else if id == quit_item.id() {
                    tray.take();
                    *control_flow = ControlFlow::Exit;
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_url_uses_configured_port() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(ui_url_in(d.path()), "http://localhost:8090");
        std::fs::write(
            d.path().join("config.json"),
            r#"{ "port": 9001, "bind": "0.0.0.0" }"#,
        )
        .unwrap();
        assert_eq!(ui_url_in(d.path()), "http://localhost:9001");
        std::fs::write(d.path().join("config.json"), "not json").unwrap();
        assert_eq!(ui_url_in(d.path()), "http://localhost:8090");
    }

    #[test]
    fn status_labels_are_french() {
        assert_eq!(status_label(true), "Arkyo — En marche");
        assert_eq!(status_label(false), "Arkyo — Arrêté");
    }
}
