use arkyo_core::password;
use arkyo_server::http::{self, AppState};
use arkyo_server::{config, db, paths, service, update, users};

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::{routing::get, Router};
use clap::{Args, Parser, Subcommand};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "arkyo-server", version, about = "Arkyo server")]
struct Cli {
    #[command(flatten)]
    run: RunArgs,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Run the server in the foreground (default).
    Run(RunArgs),
    /// Manage the system service.
    #[command(subcommand)]
    Service(ServiceCmd),
    /// Manage users.
    User {
        #[command(subcommand)]
        cmd: UserCmd,
    },
}

#[derive(Subcommand, Debug)]
enum ServiceCmd {
    /// Register this executable as a system service and start it.
    Install {
        /// TCP port saved to config.json before the first start.
        #[arg(long)]
        port: Option<u16>,
        /// Address saved to config.json before the first start.
        #[arg(long)]
        bind: Option<IpAddr>,
        /// [default: /var/lib/arkyo, /Library/Application Support/Arkyo
        /// or %ProgramData%\Arkyo]
        #[arg(long)]
        data_dir: Option<PathBuf>,
    },
    /// Stop and remove the service (data is kept).
    Uninstall,
    Start,
    Stop,
    Status,
}

fn service_command(cmd: ServiceCmd) -> anyhow::Result<()> {
    match cmd {
        ServiceCmd::Install {
            port,
            bind,
            data_dir,
        } => {
            let data_dir = data_dir.unwrap_or_else(paths::system_data_dir);
            service::install(&service::InstallOptions {
                data_dir: data_dir.clone(),
                port,
                bind,
            })?;
            let port = port.unwrap_or_else(|| config::Config::load(&data_dir).port);
            println!("Service `{}` installed and started.", paths::SERVICE_NAME);
            println!("  Data:  {}", data_dir.display());
            println!("  Open:  http://localhost:{port}/");
            Ok(())
        }
        ServiceCmd::Uninstall => {
            service::uninstall()?;
            println!("Service removed (data kept).");
            Ok(())
        }
        ServiceCmd::Start => service::start(),
        ServiceCmd::Stop => service::stop(),
        ServiceCmd::Status => service::status(),
    }
}

#[derive(Subcommand, Debug)]
enum UserCmd {
    /// Create an account (the password is asked twice).
    Add {
        email: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        username: Option<String>,
        /// owner, chef-projet, technicien, consultation or a custom role key.
        #[arg(long, default_value = "owner")]
        role: String,
        /// Force a password change at first login.
        #[arg(long)]
        temporary: bool,
        #[arg(long, env = "ARKYO_DATA_DIR")]
        data_dir: Option<PathBuf>,
    },
    /// Change a password.
    Passwd {
        /// Email or username.
        user: String,
        #[arg(long)]
        temporary: bool,
        #[arg(long, env = "ARKYO_DATA_DIR")]
        data_dir: Option<PathBuf>,
    },
    /// List accounts.
    List {
        #[arg(long, env = "ARKYO_DATA_DIR")]
        data_dir: Option<PathBuf>,
    },
    /// Delete an account.
    Remove {
        user: String,
        #[arg(long, env = "ARKYO_DATA_DIR")]
        data_dir: Option<PathBuf>,
    },
    /// Disable an account.
    Disable {
        user: String,
        #[arg(long, env = "ARKYO_DATA_DIR")]
        data_dir: Option<PathBuf>,
    },
    /// Re-enable an account.
    Enable {
        user: String,
        #[arg(long, env = "ARKYO_DATA_DIR")]
        data_dir: Option<PathBuf>,
    },
}

fn prompt_password() -> anyhow::Result<String> {
    let pw = rpassword::prompt_password("Mot de passe : ")?;
    password::validate(&pw).map_err(|e| anyhow::anyhow!(e))?;
    if rpassword::prompt_password("Confirmation : ")? != pw {
        anyhow::bail!("Les mots de passe ne correspondent pas");
    }
    Ok(pw)
}

impl UserCmd {
    fn data_dir(&self) -> Option<PathBuf> {
        match self {
            UserCmd::Add { data_dir, .. }
            | UserCmd::Passwd { data_dir, .. }
            | UserCmd::List { data_dir }
            | UserCmd::Remove { data_dir, .. }
            | UserCmd::Disable { data_dir, .. }
            | UserCmd::Enable { data_dir, .. } => data_dir.clone(),
        }
    }
}

async fn user_command(cmd: UserCmd) -> anyhow::Result<()> {
    let dir = paths::cli_data_dir(cmd.data_dir())?;
    // `sudo` in the service account's directory: refuse planted symlinks or
    // hard links before SQLite (running as root) opens them.
    #[cfg(unix)]
    db::check_root_open(&dir)?;
    let result = async {
        let pool = db::open(&dir).await?;
        let r = user_command_on(&pool, &dir, cmd).await;
        // Checkpoints the WAL and releases the base before handing it back.
        pool.close().await;
        r
    }
    .await;
    // `sudo arkyo-server user …` must not leave root-owned base files that
    // the service account can no longer open.
    #[cfg(unix)]
    db::restore_owner(&dir);
    result
}

async fn user_command_on(
    pool: &sqlx::SqlitePool,
    dir: &std::path::Path,
    cmd: UserCmd,
) -> anyhow::Result<()> {
    let find = |ident: String| async move {
        users::find_by_identifier(pool, &ident)
            .await
            .map(|(u, _)| u)
            .ok_or_else(|| anyhow::anyhow!("Utilisateur introuvable"))
    };
    match cmd {
        UserCmd::Add {
            email,
            name,
            username,
            role,
            temporary,
            data_dir: _,
        } => {
            let password = prompt_password()?;
            let u = users::create(
                pool,
                users::NewUser {
                    email,
                    name,
                    username,
                    role_key: role,
                    password,
                    must_change_password: temporary,
                },
            )
            .await?;
            println!("Utilisateur {} créé dans {}.", u.email, dir.display());
        }
        UserCmd::Passwd {
            user, temporary, ..
        } => {
            let u = find(user).await?;
            let pw = prompt_password()?;
            users::reset_password(pool, &u.id, &pw, temporary).await?;
            println!("Mot de passe modifié (sessions ouvertes fermées).");
        }
        UserCmd::List { .. } => {
            for u in users::list(pool).await {
                println!(
                    "{}  {}{}",
                    u.email,
                    u.role_key,
                    if u.is_active { "" } else { " (désactivé)" }
                );
            }
        }
        UserCmd::Remove { user, .. } => {
            let u = find(user).await?;
            users::delete(pool, &u.id).await?;
            println!("Utilisateur {} supprimé.", u.email);
        }
        UserCmd::Disable { user, .. } => {
            let u = find(user).await?;
            users::set_active(pool, &u.id, false).await?;
            println!("Utilisateur {} désactivé.", u.email);
        }
        UserCmd::Enable { user, .. } => {
            let u = find(user).await?;
            users::set_active(pool, &u.id, true).await?;
            println!("Utilisateur {} activé.", u.email);
        }
    }
    Ok(())
}

#[derive(Args, Debug, Clone, Default)]
struct RunArgs {
    /// TCP port, overriding the saved settings for this run.
    #[arg(long, env = "ARKYO_PORT")]
    port: Option<u16>,
    /// Address to listen on, overriding the saved settings for this run.
    #[arg(long, env = "ARKYO_BIND")]
    bind: Option<IpAddr>,
    /// Directory holding config.json and the data
    /// [default: per-user application data directory].
    #[arg(long, env = "ARKYO_DATA_DIR")]
    data_dir: Option<PathBuf>,
    /// Started by the Windows Service Control Manager.
    #[arg(long, hide = true)]
    service: bool,
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .merge(http::router(state))
}

fn run(args: RunArgs) -> anyhow::Result<()> {
    service::set_supervised(args.service);
    if args.service {
        #[cfg(windows)]
        {
            let dir = args.data_dir.clone().unwrap_or_else(paths::system_data_dir);
            return service::windows_runtime::run(Box::new(move |stop| {
                tokio::runtime::Runtime::new()?
                    .block_on(serve(args, dir, async move { stop.notified().await }))
            }));
        }
        #[cfg(not(windows))]
        anyhow::bail!("--service is only meaningful on Windows");
    }
    // Under launchd/systemd the service data lives in the system directory.
    let dir = args.data_dir.clone().unwrap_or_else(|| {
        if service::is_supervised() {
            paths::system_data_dir()
        } else {
            paths::user_data_dir()
        }
    });
    tokio::runtime::Runtime::new()?.block_on(serve(args, dir, shutdown_signal()))
}

async fn serve(
    args: RunArgs,
    dir: PathBuf,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    // A fresh update that keeps failing is rolled back here.
    update::startup_guard(&dir);
    let cfg = config::Config::load(&dir);
    let pool = db::open(&dir).await?;
    // The service always writes config.json: it marks its data directory for
    // the CLI (`paths::cli_data_dir`).
    if !dir.join("config.json").exists() {
        if let Err(e) = cfg.save(&dir) {
            tracing::warn!("cannot write config.json: {e:#}");
        }
    }
    let state = AppState {
        pool,
        data_dir: dir.clone(),
        config: Arc::new(RwLock::new(cfg.clone())),
    };
    let addr = SocketAddr::new(args.bind.unwrap_or(cfg.bind), args.port.unwrap_or(cfg.port));
    let listener = bind_retry(addr).await?;
    update::confirm_after(dir.clone(), std::time::Duration::from_secs(60));
    update::spawn_auto_check(dir.clone());
    tracing::info!("listening on http://{addr} (data dir {})", dir.display());
    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown.await;
        // Open SSE streams would otherwise keep graceful shutdown waiting.
        http::close_event_streams();
    })
    .await?;
    tracing::info!("shut down");
    Ok(())
}

/// After an update the previous process may still hold the port briefly.
async fn bind_retry(addr: SocketAddr) -> std::io::Result<tokio::net::TcpListener> {
    bind_retry_with(addr, 20, std::time::Duration::from_millis(250)).await
}

async fn bind_retry_with(
    addr: SocketAddr,
    retries: u32,
    delay: std::time::Duration,
) -> std::io::Result<tokio::net::TcpListener> {
    let mut attempt = 0;
    loop {
        match tokio::net::TcpListener::bind(addr).await {
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse && attempt < retries => {
                attempt += 1;
                tokio::time::sleep(delay).await;
            }
            r => return r,
        }
    }
}

/// Ctrl-C everywhere, plus SIGTERM on Unix (systemd / launchd stop).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {
            _ = ctrl_c => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    ctrl_c.await;
}

/// Where a Windows service logs: it has no console (`<data>/logs/arkyo-server.log`).
fn log_file(args: &RunArgs) -> Option<PathBuf> {
    args.service.then(|| {
        args.data_dir
            .clone()
            .unwrap_or_else(paths::system_data_dir)
            .join("logs")
            .join("arkyo-server.log")
    })
}

/// Logs to `file` when given (and writable), else to stdout.
fn init_logging(file: Option<PathBuf>) {
    use std::io::IsTerminal;
    use tracing_subscriber::prelude::*;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let file = file.and_then(|p| {
        std::fs::create_dir_all(p.parent()?).ok()?;
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(p)
            .ok()
    });
    let (to_file, to_stdout) = match file {
        Some(f) => (
            Some(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(std::sync::Mutex::new(f)),
            ),
            None,
        ),
        None => (
            None,
            Some(tracing_subscriber::fmt::layer().with_ansi(std::io::stdout().is_terminal())),
        ),
    };
    tracing_subscriber::registry()
        .with(filter)
        .with(to_file)
        .with(to_stdout)
        .init();
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    init_logging(match &cli.command {
        None => log_file(&cli.run),
        Some(Command::Run(args)) => log_file(args),
        Some(_) => None,
    });
    match cli.command {
        None => run(cli.run),
        Some(Command::Run(args)) => run(args),
        Some(Command::User { cmd }) => tokio::runtime::Runtime::new()?.block_on(user_command(cmd)),
        Some(Command::Service(cmd)) => {
            if let Err(e) = service_command(cmd) {
                eprintln!("error: {e:#}");
                std::process::exit(1);
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn bind_retry_waits_for_the_port_to_be_released() {
        let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = held.local_addr().unwrap();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(held);
        });
        let l = bind_retry_with(addr, 20, Duration::from_millis(50)).await;
        assert!(l.is_ok(), "{l:?}");
    }

    #[test]
    fn only_the_windows_service_logs_to_a_file() {
        let args = RunArgs {
            data_dir: Some(PathBuf::from("/data")),
            service: true,
            ..RunArgs::default()
        };
        assert_eq!(
            log_file(&args),
            Some(PathBuf::from("/data").join("logs").join("arkyo-server.log"))
        );
        let default = RunArgs {
            service: true,
            ..RunArgs::default()
        };
        assert_eq!(
            log_file(&default),
            Some(
                paths::system_data_dir()
                    .join("logs")
                    .join("arkyo-server.log")
            )
        );
        assert_eq!(log_file(&RunArgs::default()), None);
    }

    #[tokio::test]
    async fn bind_retry_gives_up_with_addr_in_use() {
        let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = held.local_addr().unwrap();
        let e = bind_retry_with(addr, 3, Duration::from_millis(10))
            .await
            .unwrap_err();
        assert_eq!(e.kind(), std::io::ErrorKind::AddrInUse);
    }
}
