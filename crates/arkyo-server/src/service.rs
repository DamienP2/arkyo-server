//! Installs the server as a native background service: systemd (Linux),
//! launchd (macOS) or the Service Control Manager (Windows). Also holds the
//! supervision hooks the updater uses.
//!
//! `arkyo-server service install` registers the *current* executable, so copy
//! the binary to its final location first (the packaged installers do).

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{bail, Context, Result};

static SUPERVISED: AtomicBool = AtomicBool::new(false);

/// Records whether this process runs under a service manager that restarts it.
/// `windows_service` is true when started by the Windows SCM.
pub fn set_supervised(windows_service: bool) {
    // systemd sets INVOCATION_ID, launchd sets XPC_SERVICE_NAME to the label.
    let env = |k: &str| std::env::var(k).ok();
    let supervised = windows_service
        || env("ARKYO_SUPERVISED").is_some_and(|v| v == "1")
        || env("INVOCATION_ID").is_some()
        || env("XPC_SERVICE_NAME").is_some_and(|v| v == LAUNCHD_LABEL);
    SUPERVISED.store(supervised, Ordering::Relaxed);
}

pub fn is_supervised() -> bool {
    SUPERVISED.load(Ordering::Relaxed)
}

pub const LAUNCHD_LABEL: &str = "com.arkyo.server";

pub struct InstallOptions {
    pub data_dir: PathBuf,
    /// Saved to `config.json` before the service starts, when given.
    pub port: Option<u16>,
    pub bind: Option<IpAddr>,
}

/// Creates the data directory and persists the requested port/bind.
fn prepare_data_dir(o: &InstallOptions) -> Result<()> {
    std::fs::create_dir_all(&o.data_dir).map_err(|e| permission_hint(e.into(), &o.data_dir))?;
    if o.port.is_some() || o.bind.is_some() {
        let mut cfg = crate::config::Config::load(&o.data_dir);
        if let Some(p) = o.port {
            cfg.port = p;
        }
        if let Some(b) = o.bind {
            cfg.bind = b;
        }
        cfg.save(&o.data_dir)
            .map_err(|e| permission_hint(e, &o.data_dir))?;
    }
    Ok(())
}

fn exe() -> Result<PathBuf> {
    let p = std::env::current_exe().context("cannot locate the server executable")?;
    Ok(p.canonicalize().unwrap_or(p))
}

#[allow(dead_code)]
fn run(cmd: &str, args: &[&str]) -> Result<()> {
    let out = Command::new(cmd)
        .args(args)
        .output()
        .with_context(|| format!("cannot run `{cmd}`"))?;
    print!("{}", String::from_utf8_lossy(&out.stdout));
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        bail!(
            "`{cmd} {}` failed ({}): {}",
            args.join(" "),
            out.status,
            err.trim()
        );
    }
    Ok(())
}

fn permission_hint(e: anyhow::Error, path: &Path) -> anyhow::Error {
    let denied = e.chain().any(|c| {
        c.downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == std::io::ErrorKind::PermissionDenied)
    });
    if denied {
        let how = if cfg!(windows) {
            "an elevated (Administrator) prompt"
        } else {
            "sudo"
        };
        anyhow::anyhow!(
            "permission denied writing {} — run this command with {how}",
            path.display()
        )
    } else {
        e
    }
}

/// Quotes a systemd command-line word when it contains whitespace.
fn systemd_word(s: &str) -> String {
    if s.chars().any(char::is_whitespace) {
        format!("\"{s}\"")
    } else {
        s.to_string()
    }
}

/// The systemd unit running `exe` on `data_dir` as the `arkyo` account.
pub fn unit_file(exe: &Path, data_dir: &Path) -> String {
    let exe = systemd_word(&exe.to_string_lossy());
    let data = systemd_word(&data_dir.to_string_lossy());
    format!(
        "[Unit]\n\
         Description=Arkyo server\n\
         After=network-online.target\n\
         Wants=network-online.target\n\n\
         [Service]\n\
         ExecStart={exe} run --data-dir {data}\n\
         User=arkyo\n\
         Restart=on-failure\n\
         RestartSec=2\n\
         AmbientCapabilities=CAP_NET_BIND_SERVICE\n\
         LimitNOFILE=65536\n\
         NoNewPrivileges=yes\n\
         ProtectSystem=full\n\
         ReadWritePaths={data}\n\n\
         [Install]\n\
         WantedBy=multi-user.target\n"
    )
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

const LAUNCHD_LOG_DIR: &str = "/Library/Logs/Arkyo";

/// The launchd daemon definition running `exe` on `data_dir`.
pub fn launchd_plist(exe: &Path, data_dir: &Path) -> String {
    let args_xml: String = [
        exe.to_string_lossy().into_owned(),
        "run".into(),
        "--data-dir".into(),
        data_dir.to_string_lossy().into_owned(),
    ]
    .iter()
    .map(|a| format!("    <string>{}</string>\n", xml_escape(a)))
    .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{args_xml}  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>{LAUNCHD_LOG_DIR}/arkyo-server.log</string>
  <key>StandardErrorPath</key><string>{LAUNCHD_LOG_DIR}/arkyo-server.log</string>
</dict>
</plist>
"#
    )
}

// ---------------------------------------------------------------- Linux ----
#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use crate::paths::SERVICE_NAME;

    const UNIT: &str = "/etc/systemd/system/arkyo-server.service";
    const USER: &str = "arkyo";

    pub fn install(o: &InstallOptions) -> Result<()> {
        let exe = exe()?;
        // Dedicated unprivileged account owning the data directory.
        if Command::new("id")
            .arg(USER)
            .output()
            .map(|o| !o.status.success())
            .unwrap_or(true)
        {
            run(
                "useradd",
                &[
                    "--system",
                    "--no-create-home",
                    "--shell",
                    "/usr/sbin/nologin",
                    USER,
                ],
            )
            .context("cannot create the service account (are you root?)")?;
        }
        prepare_data_dir(o)?;
        run(
            "chown",
            &[
                "-R",
                &format!("{USER}:{USER}"),
                &o.data_dir.to_string_lossy(),
            ],
        )?;
        std::fs::write(UNIT, unit_file(&exe, &o.data_dir))
            .map_err(|e| permission_hint(e.into(), Path::new(UNIT)))?;
        run("systemctl", &["daemon-reload"])?;
        run("systemctl", &["enable", "--now", SERVICE_NAME])?;
        Ok(())
    }

    pub fn uninstall() -> Result<()> {
        let _ = run("systemctl", &["disable", "--now", SERVICE_NAME]);
        match std::fs::remove_file(UNIT) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(permission_hint(e.into(), Path::new(UNIT))),
        }
        run("systemctl", &["daemon-reload"])
    }

    pub fn start() -> Result<()> {
        run("systemctl", &["start", SERVICE_NAME])
    }
    pub fn stop() -> Result<()> {
        run("systemctl", &["stop", SERVICE_NAME])
    }
    pub fn status() -> Result<()> {
        run("systemctl", &["status", "--no-pager", SERVICE_NAME])
    }
}

// ---------------------------------------------------------------- macOS ----
#[cfg(target_os = "macos")]
mod imp {
    use super::*;

    const LABEL: &str = LAUNCHD_LABEL;
    const PLIST: &str = "/Library/LaunchDaemons/com.arkyo.server.plist";

    pub fn install(o: &InstallOptions) -> Result<()> {
        let exe = exe()?;
        prepare_data_dir(o)?;
        std::fs::create_dir_all(LAUNCHD_LOG_DIR)
            .map_err(|e| permission_hint(e.into(), Path::new(LAUNCHD_LOG_DIR)))?;
        let plist = launchd_plist(&exe, &o.data_dir);
        // Replace a previous installation cleanly. launchd unloads
        // asynchronously, so wait for it before loading the new definition.
        let _ = Command::new("launchctl")
            .args(["bootout", &target()])
            .output();
        wait_unloaded();
        std::fs::write(PLIST, plist).map_err(|e| permission_hint(e.into(), Path::new(PLIST)))?;
        bootstrap()
    }
    fn target() -> String {
        format!("system/{LABEL}")
    }

    fn loaded() -> bool {
        Command::new("launchctl")
            .args(["print", &target()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn wait_unloaded() {
        for _ in 0..50 {
            if !loaded() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    /// `launchctl bootstrap` fails with "5: Input/output error" while a
    /// previous instance is still unloading: retry for a few seconds.
    fn bootstrap() -> Result<()> {
        let mut last = String::new();
        for _ in 0..8 {
            let out = Command::new("launchctl")
                .args(["bootstrap", "system", PLIST])
                .output()
                .context("cannot run launchctl")?;
            if out.status.success() || loaded() {
                return Ok(());
            }
            last = String::from_utf8_lossy(&out.stderr).trim().to_string();
            std::thread::sleep(std::time::Duration::from_millis(750));
        }
        bail!("launchctl bootstrap failed: {last}")
    }

    pub fn uninstall() -> Result<()> {
        let _ = Command::new("launchctl")
            .args(["bootout", &target()])
            .output();
        wait_unloaded();
        match std::fs::remove_file(PLIST) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(permission_hint(e.into(), Path::new(PLIST))),
        }
    }

    pub fn start() -> Result<()> {
        if !Path::new(PLIST).exists() {
            bail!("the service is not installed — run `sudo arkyo-server service install`");
        }
        // Loading the daemon starts it (RunAtLoad); if it is already loaded
        // but stopped, kickstart it.
        if !loaded() {
            return bootstrap();
        }
        run("launchctl", &["kickstart", "-k", &target()])
    }
    pub fn stop() -> Result<()> {
        if !loaded() {
            return Ok(());
        }
        run("launchctl", &["kill", "SIGTERM", &target()])
    }
    pub fn status() -> Result<()> {
        run("launchctl", &["print", &format!("system/{LABEL}")])
    }
}

// -------------------------------------------------------------- Windows ----
#[cfg(windows)]
mod imp {
    use std::ffi::{OsStr, OsString};
    use std::time::Duration;

    use windows_service::service::{
        ServiceAccess, ServiceAction, ServiceActionType, ServiceErrorControl,
        ServiceFailureActions, ServiceFailureResetPeriod, ServiceInfo, ServiceStartType,
        ServiceState, ServiceType,
    };
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    use super::*;
    use crate::paths::SERVICE_NAME;

    const DISPLAY_NAME: &str = "Arkyo Server";
    const FIREWALL_RULE: &str = "Arkyo Server";
    /// Rules an older install added under a former name.
    const LEGACY_FIREWALL_RULES: [&str; 0] = [];

    fn manager(access: ServiceManagerAccess) -> Result<ServiceManager> {
        ServiceManager::local_computer(None::<&str>, access).context(
            "cannot open the Service Control Manager — run from an elevated (Administrator) prompt",
        )
    }

    pub fn install(o: &InstallOptions) -> Result<()> {
        let exe = exe()?;
        prepare_data_dir(o)?;
        let m = manager(ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE)?;
        let info = ServiceInfo {
            name: OsString::from(SERVICE_NAME),
            display_name: OsString::from(DISPLAY_NAME),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: exe.clone(),
            launch_arguments: [
                "run",
                "--service",
                "--data-dir",
                &o.data_dir.to_string_lossy(),
            ]
            .iter()
            .map(OsString::from)
            .collect(),
            dependencies: vec![],
            account_name: None, // LocalSystem
            account_password: None,
        };
        let svc = m
            .create_service(&info, ServiceAccess::CHANGE_CONFIG | ServiceAccess::START)
            .context(
                "cannot create the service (already installed? run `service uninstall` first)",
            )?;
        svc.set_description("Arkyo project and team management server")?;
        let restart = ServiceAction {
            action_type: ServiceActionType::Restart,
            delay: Duration::from_secs(2),
        };
        svc.update_failure_actions(ServiceFailureActions {
            reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86_400)),
            reboot_msg: None,
            command: None,
            actions: Some(vec![restart.clone(), restart.clone(), restart]),
        })?;
        // Let users reach the web UI through Windows Firewall.
        for rule in std::iter::once(FIREWALL_RULE).chain(LEGACY_FIREWALL_RULES) {
            let _ = Command::new("netsh")
                .args([
                    "advfirewall",
                    "firewall",
                    "delete",
                    "rule",
                    &format!("name={rule}"),
                ])
                .output();
        }
        if let Err(e) = run(
            "netsh",
            &[
                "advfirewall",
                "firewall",
                "add",
                "rule",
                &format!("name={FIREWALL_RULE}"),
                "dir=in",
                "action=allow",
                &format!("program={}", exe.display()),
                "enable=yes",
                "profile=any",
            ],
        ) {
            eprintln!("warning: firewall rule not added: {e}");
        }
        svc.start(&[] as &[&OsStr])
            .context("service created but failed to start")?;
        Ok(())
    }

    pub fn uninstall() -> Result<()> {
        let m = manager(ServiceManagerAccess::CONNECT)?;
        let svc = m
            .open_service(
                SERVICE_NAME,
                ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE,
            )
            .context("service not installed")?;
        if svc.query_status()?.current_state != ServiceState::Stopped {
            let _ = svc.stop();
            for _ in 0..50 {
                if svc.query_status()?.current_state == ServiceState::Stopped {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        svc.delete()?;
        for rule in std::iter::once(FIREWALL_RULE).chain(LEGACY_FIREWALL_RULES) {
            let _ = Command::new("netsh")
                .args([
                    "advfirewall",
                    "firewall",
                    "delete",
                    "rule",
                    &format!("name={rule}"),
                ])
                .output();
        }
        Ok(())
    }

    pub fn start() -> Result<()> {
        let m = manager(ServiceManagerAccess::CONNECT)?;
        m.open_service(SERVICE_NAME, ServiceAccess::START)?
            .start(&[] as &[&OsStr])?;
        Ok(())
    }

    pub fn stop() -> Result<()> {
        let m = manager(ServiceManagerAccess::CONNECT)?;
        m.open_service(SERVICE_NAME, ServiceAccess::STOP)?.stop()?;
        Ok(())
    }

    pub fn status() -> Result<()> {
        let m = manager(ServiceManagerAccess::CONNECT)?;
        let st = m
            .open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS)
            .context("service not installed")?
            .query_status()?;
        println!("{SERVICE_NAME}: {:?}", st.current_state);
        Ok(())
    }
}

// ------------------------------------------------- other platforms (BSD) ----
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
mod imp {
    use super::*;
    fn unsupported() -> Result<()> {
        bail!("service management is not supported on this platform; run `arkyo-server run` under your init system")
    }
    pub fn install(_: &InstallOptions) -> Result<()> {
        unsupported()
    }
    pub fn uninstall() -> Result<()> {
        unsupported()
    }
    pub fn start() -> Result<()> {
        unsupported()
    }
    pub fn stop() -> Result<()> {
        unsupported()
    }
    pub fn status() -> Result<()> {
        unsupported()
    }
}

pub use imp::{install, start, status, stop, uninstall};

// ---------------------------------------------- Windows service runtime ----
/// Entry point when the SCM launches us (`run --service`).
#[cfg(windows)]
pub mod windows_runtime {
    use std::ffi::OsString;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use windows_service::service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};

    use crate::paths::SERVICE_NAME;

    /// The server body: runs until the notifier fires (service Stop).
    pub type Body = Box<dyn FnOnce(Arc<tokio::sync::Notify>) -> anyhow::Result<()> + Send>;

    static BODY: Mutex<Option<Body>> = Mutex::new(None);

    define_windows_service!(ffi_service_main, service_main);

    pub fn run(body: Body) -> anyhow::Result<()> {
        *BODY.lock().unwrap() = Some(body);
        service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
        Ok(())
    }

    fn service_main(_: Vec<OsString>) {
        if let Err(e) = run_service() {
            tracing::error!("service failed: {e:#}");
        }
    }

    fn run_service() -> anyhow::Result<()> {
        let body = BODY
            .lock()
            .unwrap()
            .take()
            .expect("body set before dispatch");
        let stop = Arc::new(tokio::sync::Notify::new());
        let stop2 = stop.clone();
        let handle = service_control_handler::register(SERVICE_NAME, move |ctrl| match ctrl {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                stop2.notify_one();
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        })?;
        let status = |state, accept| ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: accept,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::from_secs(5),
            process_id: None,
        };
        handle.set_service_status(status(
            ServiceState::Running,
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        ))?;
        let result = body(stop);
        handle.set_service_status(status(ServiceState::Stopped, ServiceControlAccept::empty()))?;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn systemd_unit_points_to_exe_and_system_dir() {
        let u = unit_file(
            Path::new("/opt/arkyo/arkyo-server"),
            Path::new("/var/lib/arkyo"),
        );
        assert!(
            u.contains("ExecStart=/opt/arkyo/arkyo-server run --data-dir /var/lib/arkyo\n"),
            "{u}"
        );
        assert!(u.contains("Restart=on-failure"));
        assert!(u.contains("ReadWritePaths=/var/lib/arkyo"));
    }

    #[test]
    fn systemd_unit_quotes_paths_with_spaces() {
        let u = unit_file(
            Path::new("/opt/my arkyo/arkyo-server"),
            Path::new("/var/lib/a b"),
        );
        assert!(
            u.contains("ExecStart=\"/opt/my arkyo/arkyo-server\" run --data-dir \"/var/lib/a b\"")
        );
    }

    #[test]
    fn launchd_plist_label() {
        let p = launchd_plist(
            Path::new("/usr/local/bin/arkyo-server"),
            Path::new("/Library/Application Support/Arkyo"),
        );
        assert!(p.contains("<string>com.arkyo.server</string>"));
        assert!(p.contains("<string>/usr/local/bin/arkyo-server</string>"));
        assert!(p.contains("<string>/Library/Application Support/Arkyo</string>"));
        assert!(p.contains("<key>SuccessfulExit</key><false/>"));
    }

    #[test]
    fn launchd_plist_escapes_xml() {
        let p = launchd_plist(Path::new("/a&b/arkyo-server"), Path::new("/d"));
        assert!(p.contains("/a&amp;b/arkyo-server"));
    }
}
