// Consumed by the service and user commands (Tasks 3 and 9).
#[allow(dead_code)]
mod config;
#[allow(dead_code)]
mod paths;

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

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
    Service {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Manage users.
    User {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
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
}

fn router() -> Router {
    Router::new().route("/healthz", get(|| async { "ok" }))
}

async fn run(args: RunArgs) -> anyhow::Result<()> {
    let dir = args.data_dir.unwrap_or_else(paths::user_data_dir);
    let cfg = config::Config::load(&dir);
    let addr = SocketAddr::new(args.bind.unwrap_or(cfg.bind), args.port.unwrap_or(cfg.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on http://{addr} (data dir {})", dir.display());
    axum::serve(listener, router())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    tracing::info!("shut down");
    Ok(())
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let cli = Cli::parse();
    match cli.command {
        None => run(cli.run).await,
        Some(Command::Run(args)) => run(args).await,
        Some(Command::Service { .. }) | Some(Command::User { .. }) => {
            eprintln!("not implemented yet");
            std::process::exit(2);
        }
    }
}
