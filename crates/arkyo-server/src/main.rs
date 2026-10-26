use arkyo_core::password;
use arkyo_server::{config, db, paths, users};

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
        #[command(subcommand)]
        cmd: UserCmd,
    },
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

async fn user_command(cmd: UserCmd) -> anyhow::Result<()> {
    let open = |d: Option<PathBuf>| async move {
        let dir = paths::cli_data_dir(d);
        std::fs::create_dir_all(&dir)?;
        let pool = db::open(&dir).await?;
        anyhow::Ok((dir, pool))
    };
    let find = |pool: sqlx::SqlitePool, ident: String| async move {
        users::find_by_identifier(&pool, &ident)
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
            data_dir,
        } => {
            let (dir, pool) = open(data_dir).await?;
            let password = prompt_password()?;
            let u = users::create(
                &pool,
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
            user,
            temporary,
            data_dir,
        } => {
            let (_, pool) = open(data_dir).await?;
            let u = find(pool.clone(), user).await?;
            let pw = prompt_password()?;
            users::set_password(&pool, &u.id, &pw, temporary).await?;
            println!("Mot de passe modifié.");
        }
        UserCmd::List { data_dir } => {
            let (_, pool) = open(data_dir).await?;
            for u in users::list(&pool).await {
                println!(
                    "{}  {}{}",
                    u.email,
                    u.role_key,
                    if u.is_active { "" } else { " (désactivé)" }
                );
            }
        }
        UserCmd::Remove { user, data_dir } => {
            let (_, pool) = open(data_dir).await?;
            let u = find(pool.clone(), user).await?;
            users::delete(&pool, &u.id).await?;
            println!("Utilisateur {} supprimé.", u.email);
        }
        UserCmd::Disable { user, data_dir } => {
            let (_, pool) = open(data_dir).await?;
            let u = find(pool.clone(), user).await?;
            users::set_active(&pool, &u.id, false).await?;
            println!("Utilisateur {} désactivé.", u.email);
        }
        UserCmd::Enable { user, data_dir } => {
            let (_, pool) = open(data_dir).await?;
            let u = find(pool.clone(), user).await?;
            users::set_active(&pool, &u.id, true).await?;
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
        Some(Command::User { cmd }) => user_command(cmd).await,
        Some(Command::Service { .. }) => {
            eprintln!("not implemented yet");
            std::process::exit(2);
        }
    }
}
