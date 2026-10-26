//! Over-the-air updates, without uninstalling.
//!
//! A new version comes either from the GitHub releases of the project
//! (private repository: a read-only token is stored in `<data>/update/`), or
//! from a release archive uploaded by an admin (servers without internet).
//! Either way the server:
//!
//! 1. extracts `arkyo-server` from the platform package (Ubuntu `.tar.gz`,
//!    macOS `.pkg` through pkgutil, Windows `.msi` through an administrative
//!    install of msiexec; older `.tar.gz` / `.zip` archives too) and checks
//!    the SHA-256 published by GitHub when there is one;
//! 2. runs `<new> --version`, which proves the binary runs on this machine;
//! 3. keeps the running binary as `arkyo-server.previous` and swaps the new one
//!    in (atomic rename; the running process keeps its old image);
//! 4. exits so the service manager (systemd, launchd, Windows SCM) starts the
//!    new version; a foreground server re-launches itself.
//!
//! The new version must start cleanly: if it fails to come up three times
//! in a row, the previous binary is put back automatically. Updates are
//! never installed on their own; checking only tells the admins.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DEFAULT_REPO: &str = "DamienP2/arkyo-server";

/// This build's platform, in the name of its update package
/// (`Arkyo-<version>-<PLATFORM>.*`).
pub const PLATFORM: &str = if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
    "linux-arm64"
} else if cfg!(target_os = "linux") {
    "linux-x86_64"
} else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    "macos-arm64"
} else if cfg!(target_os = "macos") {
    "macos-x86_64"
} else {
    "windows-x86_64"
};

/// The release files that carry this platform's server, by preference: the
/// update package (the server alone, small), then the installer or server
/// package of the release.
pub const PACKAGES: &[&str] = if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
    &["-linux-x86_64.tar.gz", "-ubuntu-x64.tar.gz"]
} else if cfg!(target_os = "linux") {
    &["-linux-arm64.tar.gz"]
} else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    &["-macos-arm64.tar.gz", "-macos-universal.pkg"]
} else if cfg!(target_os = "macos") {
    &["-macos-x86_64.tar.gz", "-macos-universal.pkg"]
} else {
    &["-windows-x86_64.zip", "-windows-x64.msi"]
};

const EXE: &str = if cfg!(windows) {
    "arkyo-server.exe"
} else {
    "arkyo-server"
};
const PREVIOUS: &str = if cfg!(windows) {
    "arkyo-server.previous.exe"
} else {
    "arkyo-server.previous"
};
const STAGED: &str = if cfg!(windows) {
    "arkyo-server.new.exe"
} else {
    "arkyo-server.new"
};
/// Exit code asking the service manager for a restart.
const RESTART_CODE: i32 = 75;
/// Oldest version whose data layout this server still reads.
const OLDEST_INSTALLABLE: &str = "0.1.0";
const MAX_FAILED_STARTS: u32 = 3;

pub fn current_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("update")
}

static EXE_PATH: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();

/// Path of the executable, resolved at startup: once the file is replaced,
/// Linux reports the running image as "… (deleted)".
fn exe_path() -> Result<PathBuf> {
    EXE_PATH
        .get_or_init(|| {
            std::env::current_exe()
                .ok()
                .map(|e| e.canonicalize().unwrap_or(e))
        })
        .clone()
        .ok_or_else(|| anyhow!("Impossible de localiser l'exécutable en cours"))
}

fn sibling(name: &str) -> Result<PathBuf> {
    Ok(exe_path()?.with_file_name(name))
}

// ------------------------------------------------------------- settings ----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// `owner/name` of the GitHub repository publishing releases.
    #[serde(default = "default_repo")]
    pub repo: String,
    /// Read-only token for private repositories (never sent to clients).
    #[serde(default)]
    pub token: String,
    /// Look for new versions in the background (installing stays manual).
    #[serde(default = "yes")]
    pub auto_check: bool,
}

fn default_repo() -> String {
    DEFAULT_REPO.into()
}
fn yes() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            repo: default_repo(),
            token: String::new(),
            auto_check: true,
        }
    }
}

impl Settings {
    pub fn load(data_dir: &Path) -> Self {
        std::fs::read(dir(data_dir).join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let d = dir(data_dir);
        std::fs::create_dir_all(&d)?;
        let path = d.join("settings.json");
        std::fs::write(&path, serde_json::to_vec_pretty(self)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }
}

// --------------------------------------------------------------- status ----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub name: String,
    pub notes: String,
    pub published_at: String,
    pub url: String,
    pub asset_id: u64,
    pub asset_name: String,
    pub size: u64,
    /// "sha256:<hex>" as published by GitHub.
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    #[default]
    Idle,
    Checking,
    Downloading,
    Installing,
    Restarting,
    Error,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: Phase,
    /// 0..1 while downloading.
    pub progress: f32,
    pub message: String,
    /// Newest release with a package for this platform.
    pub latest: Option<Release>,
    /// Every release with a package for this platform, newest first.
    pub releases: Vec<Release>,
    pub last_check: Option<i64>,
}

static STATUS: Mutex<Option<Status>> = Mutex::new(None);

pub fn status() -> Status {
    STATUS
        .lock()
        .map(|s| s.clone().unwrap_or_default())
        .unwrap_or_default()
}

fn set_status(f: impl FnOnce(&mut Status)) {
    if let Ok(mut s) = STATUS.lock() {
        f(s.get_or_insert_with(Status::default));
    }
}

fn busy() -> bool {
    matches!(
        status().phase,
        Phase::Checking | Phase::Downloading | Phase::Installing | Phase::Restarting
    )
}

/// Fails the update with a message the UI shows.
pub fn fail(e: &anyhow::Error) {
    tracing::error!("update failed: {e:#}");
    set_status(|s| {
        s.phase = Phase::Error;
        s.message = format!("{e:#}");
    });
}

/// What the settings page shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub current: &'static str,
    pub platform: &'static str,
    /// The release file to upload for an offline update (`Arkyo-<version>…`).
    pub package: String,
    pub repo: String,
    pub has_token: bool,
    pub auto_check: bool,
    /// Version kept for rollback.
    pub previous: Option<String>,
    /// Last update installed (or rolled back) and when.
    pub history: Option<History>,
    pub status: Status,
    pub supervised: bool,
}

pub fn info(data_dir: &Path) -> Info {
    let s = Settings::load(data_dir);
    Info {
        current: current_version(),
        platform: PLATFORM,
        package: format!("Arkyo-<version>{}", PACKAGES[0]),
        repo: s.repo,
        has_token: !s.token.is_empty(),
        auto_check: s.auto_check,
        previous: sibling(PREVIOUS)
            .ok()
            .filter(|p| p.exists())
            .and_then(|p| binary_version(&p).ok())
            .filter(|v| installable(v)),
        history: read_json(&dir(data_dir).join("history.json")),
        status: status(),
        supervised: crate::service::is_supervised(),
    }
}

// --------------------------------------------------------------- github ----

fn agent() -> ureq::Agent {
    // The OS trust store: works behind corporate TLS inspection too.
    let tls = ureq::tls::TlsConfig::builder()
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_global(Some(Duration::from_secs(600)))
        .max_redirects(0)
        .http_status_as_error(false)
        .user_agent(concat!("arkyo-server/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn github_get(s: &Settings, url: &str, accept: &str) -> Result<ureq::http::Response<ureq::Body>> {
    let mut req = agent()
        .get(url)
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", "2022-11-28");
    if !s.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", s.token.trim()));
    }
    req.call()
        .with_context(|| format!("Impossible de joindre {url}"))
}

fn http_error(status: u16, what: &str, s: &Settings) -> anyhow::Error {
    match status {
        401 => anyhow!("GitHub a refusé le jeton (expiré ou révoqué ?)"),
        403 => anyhow!(
            "GitHub a refusé la requête (limite atteinte, ou le jeton ne peut pas lire {})",
            s.repo
        ),
        404 if s.token.is_empty() => anyhow!(
            "{} introuvable : le dépôt est privé, ajoutez un jeton en lecture seule",
            s.repo
        ),
        404 => anyhow!("Aucun {what} trouvé dans {}", s.repo),
        code => anyhow!("GitHub a répondu HTTP {code}"),
    }
}

#[derive(Deserialize)]
struct GhAsset {
    id: u64,
    name: String,
    size: u64,
    #[serde(default)]
    digest: Option<String>,
    /// "uploaded" once the file is complete ("starter" while it uploads).
    #[serde(default)]
    state: Option<String>,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    html_url: String,
    assets: Vec<GhAsset>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// A version this server can run on its data (see [`OLDEST_INSTALLABLE`]).
fn installable(version: &str) -> bool {
    !is_newer(OLDEST_INSTALLABLE, version)
}

/// The published releases whose package for this platform is fully
/// uploaded, newest first: a tag, or a release still being built, is not
/// a version this server can install.
fn usable_releases(
    all: Vec<GhRelease>,
    pick: impl Fn(Vec<GhAsset>) -> Option<GhAsset>,
) -> Vec<Release> {
    let mut out: Vec<Release> = all
        .into_iter()
        .filter(|gh| !gh.draft && !gh.prerelease)
        .filter_map(|gh| {
            let version = gh.tag_name.trim_start_matches('v').to_string();
            if !installable(&version) {
                return None;
            }
            let uploaded = gh
                .assets
                .into_iter()
                .filter(|a| a.state.as_deref().is_none_or(|s| s == "uploaded"))
                .collect();
            let asset = pick(uploaded)?;
            Some(Release {
                version,
                name: gh.name.unwrap_or_else(|| gh.tag_name.clone()),
                notes: gh.body.unwrap_or_default(),
                published_at: gh.published_at.unwrap_or_default(),
                url: gh.html_url,
                asset_id: asset.id,
                asset_name: asset.name,
                size: asset.size,
                digest: asset.digest,
            })
        })
        .collect();
    out.sort_by_key(|a| std::cmp::Reverse(version_key(&a.version)));
    out
}

/// The releases that can be installed here; returns the newest one.
pub fn check(data_dir: &Path) -> Result<Option<Release>> {
    let s = Settings::load(data_dir);
    set_status(|st| {
        st.phase = Phase::Checking;
        st.message.clear();
    });
    let res = (|| {
        let url = format!(
            "https://api.github.com/repos/{}/releases?per_page=50",
            s.repo.trim()
        );
        let mut r = github_get(&s, &url, "application/vnd.github+json")?;
        if r.status() != 200 {
            return Err(http_error(r.status().as_u16(), "version publiée", &s));
        }
        let body = r.body_mut().read_to_string()?;
        let all: Vec<GhRelease> =
            serde_json::from_str(&body).context("Réponse inattendue de GitHub")?;
        Ok(usable_releases(all, pick_package))
    })();
    match res {
        Ok(releases) => {
            let latest = releases.first().cloned();
            set_status(|st| {
                st.phase = Phase::Idle;
                st.latest = latest.clone();
                st.releases = releases;
                st.last_check = Some(now_ms());
            });
            Ok(latest)
        }
        Err(e) => {
            fail(&e);
            Err(e)
        }
    }
}

/// The release file for this platform (see [`PACKAGES`]): the update
/// package first, then the installer or server package of the release.
fn pick_package(assets: Vec<GhAsset>) -> Option<GhAsset> {
    assets
        .into_iter()
        .filter_map(|a| Some((PACKAGES.iter().position(|p| a.name.ends_with(p))?, a)))
        .min_by_key(|(r, _)| *r)
        .map(|(_, a)| a)
}

/// Downloads a release archive, reporting progress.
fn download(s: &Settings, r: &Release) -> Result<Vec<u8>> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/assets/{}",
        s.repo.trim(),
        r.asset_id
    );
    let mut res = github_get(s, &url, "application/octet-stream")?;
    // Private assets redirect to a signed storage URL: follow it without
    // the GitHub token.
    if (300..400).contains(&res.status().as_u16()) {
        let location = res
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| anyhow!("Redirection GitHub sans destination"))?
            .to_string();
        res = agent()
            .get(&location)
            .call()
            .context("Impossible de télécharger le paquet")?;
    }
    if res.status() != 200 {
        return Err(http_error(res.status().as_u16(), "paquet", s));
    }
    let total = r.size.max(1);
    let mut reader = res
        .into_body()
        .into_with_config()
        .limit(512 * 1024 * 1024)
        .reader();
    let mut out = Vec::with_capacity(r.size as usize);
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        set_status(|st| st.progress = (out.len() as f32 / total as f32).min(1.0));
    }
    if let Some(d) = r.digest.as_deref().and_then(|d| d.strip_prefix("sha256:")) {
        let got = hex(&Sha256::digest(&out));
        if !got.eq_ignore_ascii_case(d) {
            bail!("Le téléchargement est corrompu (SHA-256 différent)");
        }
    }
    Ok(out)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Downloads and installs a release (the latest one, or `version`, which
/// may be older: going back), then restarts.
pub fn install_release(data_dir: &Path, version: Option<&str>) -> Result<()> {
    if busy() {
        bail!("Une mise à jour est déjà en cours");
    }
    let s = Settings::load(data_dir);
    if status().releases.is_empty() {
        check(data_dir)?;
    }
    let st = status();
    let release = match version {
        Some(v) => st
            .releases
            .into_iter()
            .find(|r| r.version == v.trim_start_matches('v'))
            .ok_or_else(|| anyhow!("Aucune version {v} avec un paquet pour {PLATFORM}"))?,
        None => st
            .latest
            .ok_or_else(|| anyhow!("Aucune version avec un paquet pour {PLATFORM}"))?,
    };
    let allow_older = version.is_some();
    set_status(|st| {
        st.phase = Phase::Downloading;
        st.progress = 0.0;
        st.message = format!("Téléchargement de {}", release.asset_name);
    });
    let res = (|| {
        let archive = download(&s, &release)?;
        let binary = extract_binary(&archive)?;
        let v = install(data_dir, &binary, allow_older)?;
        Ok(v)
    })();
    match res {
        Ok(v) => {
            tracing::info!(version = v, "update installed, restarting");
            restart_soon();
            Ok(())
        }
        Err(e) => {
            fail(&e);
            Err(e)
        }
    }
}

// ------------------------------------------------------------- packages ----

/// A file of a release package: an archive, or the installer of this
/// platform. None when it is not one; Some(None) when the file is not in it.
fn from_package(bytes: &[u8], want: impl Fn(&str) -> bool) -> Result<Option<Option<Vec<u8>>>> {
    if let Some(found) = from_archive(bytes, &want)? {
        return Ok(Some(found));
    }
    let Some(kind) = Installer::of(bytes) else {
        return Ok(None);
    };
    let dir = kind.unpack(bytes)?;
    find_file(&dir.0, &dir.0, &want).map(Some)
}

/// macOS (xar) and Windows (OLE compound file) installers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Installer {
    Pkg,
    Msi,
}

/// A temporary folder, removed when dropped.
struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl Installer {
    fn of(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(b"xar!") {
            Some(Installer::Pkg)
        } else if bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) {
            Some(Installer::Msi)
        } else {
            None
        }
    }

    /// Unpacks it with the system's own tool, without installing anything.
    fn unpack(self, bytes: &[u8]) -> Result<TempDir> {
        let (ext, os) = match self {
            Installer::Pkg => ("pkg", "macos"),
            Installer::Msi => ("msi", "windows"),
        };
        if std::env::consts::OS != os {
            bail!("Un paquet .{ext} est pour {os} : importez le paquet de cette plateforme ({PLATFORM})");
        }
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let tmp =
            TempDir(std::env::temp_dir().join(format!("arkyo-update-{}-{n}", std::process::id())));
        let _ = std::fs::remove_dir_all(&tmp.0);
        std::fs::create_dir_all(&tmp.0)?;
        let file = tmp.0.join(format!("package.{ext}"));
        std::fs::write(&file, bytes)?;
        let out = tmp.0.join("unpacked");
        let status = match self {
            // The payloads come out as plain files.
            Installer::Pkg => std::process::Command::new("/usr/sbin/pkgutil")
                .arg("--expand-full")
                .arg(&file)
                .arg(&out)
                .status(),
            // An administrative install only copies the files out.
            Installer::Msi => std::process::Command::new("msiexec")
                .arg("/a")
                .arg(&file)
                .arg("/qn")
                .arg(format!("TARGETDIR={}", out.display()))
                .status(),
        }
        .with_context(|| format!("Impossible d'ouvrir le paquet .{ext}"))?;
        if !status.success() {
            bail!("Impossible d'ouvrir le paquet .{ext} ({status})");
        }
        Ok(tmp)
    }
}

/// The first file under `dir` whose path (relative to `root`, with `/`)
/// `want` accepts.
fn find_file(root: &Path, dir: &Path, want: &impl Fn(&str) -> bool) -> Result<Option<Vec<u8>>> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            if let Some(found) = find_file(root, &path, want)? {
                return Ok(Some(found));
            }
        } else if kind.is_file() {
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel = rel.to_string_lossy().replace('\\', "/");
            if want(&rel) {
                return Ok(Some(std::fs::read(&path)?));
            }
        }
    }
    Ok(None)
}

/// A file of a release archive (`.tar.gz` / `.zip`); None when it is not one.
fn from_archive(bytes: &[u8], want: impl Fn(&str) -> bool) -> Result<Option<Option<Vec<u8>>>> {
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
        for entry in archive.entries().context("Archive .tar.gz invalide")? {
            let mut entry = entry?;
            let path = entry.path()?.to_string_lossy().into_owned();
            if want(&path) {
                let mut out = Vec::new();
                entry.read_to_end(&mut out)?;
                return Ok(Some(Some(out)));
            }
        }
        return Ok(Some(None));
    }
    if bytes.starts_with(b"PK") {
        let mut zip =
            zip::ZipArchive::new(std::io::Cursor::new(bytes)).context("Archive .zip invalide")?;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i)?;
            if f.name().is_ok_and(|n| want(&n)) {
                let mut out = Vec::new();
                f.read_to_end(&mut out)?;
                return Ok(Some(Some(out)));
            }
        }
        return Ok(Some(None));
    }
    Ok(None)
}

/// `arkyo-server` from a release package (archive or installer) or a bare binary.
pub fn extract_binary(bytes: &[u8]) -> Result<Vec<u8>> {
    let is_exe = |name: &str| Path::new(name).file_name().and_then(|n| n.to_str()) == Some(EXE);
    match from_package(bytes, is_exe)? {
        Some(Some(b)) => return Ok(b),
        Some(None) => bail!("Pas de {EXE} dans ce paquet"),
        None => {}
    }
    // ELF, Mach-O (thin or universal) or PE.
    let magic = [
        &b"\x7fELF"[..],
        &[0xcf, 0xfa, 0xed, 0xfe],
        &[0xca, 0xfe, 0xba, 0xbe],
        b"MZ",
    ];
    if magic.iter().any(|m| bytes.starts_with(m)) {
        return Ok(bytes.to_vec());
    }
    bail!(
        "Paquet inconnu : importez le paquet de mise à jour de cette plateforme (Arkyo-<version>{})",
        PACKAGES[0]
    )
}

/// Version printed by `<binary> --version` ("arkyo-server 0.3.0").
fn binary_version(path: &Path) -> Result<String> {
    let out = std::process::Command::new(path)
        .arg("--version")
        .output()
        .context("Le nouveau programme ne peut pas s'exécuter sur cette machine")?;
    let text = String::from_utf8_lossy(&out.stdout);
    match text.trim().strip_prefix("arkyo-server ") {
        Some(v) if out.status.success() => Ok(v.trim().to_string()),
        _ => bail!("Ce n'est pas un serveur Arkyo pour {PLATFORM}"),
    }
}

/// Orders "1.2.10" after "1.2.9"; a pre-release ("0.1.0-dev") comes before
/// its release.
fn version_key(v: &str) -> (Vec<u64>, bool, String) {
    let v = v.split('+').next().unwrap_or(v);
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    (
        core.split('.').map(|p| p.parse().unwrap_or(0)).collect(),
        pre.is_none(),
        pre.unwrap_or_default().to_string(),
    )
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    version_key(candidate) > version_key(current)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    from: String,
    to: String,
    starts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub from: String,
    pub to: String,
    pub at: i64,
    /// "installed", "rolled back" or "restored automatically".
    pub outcome: String,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(v)?)?;
    Ok(())
}

fn permission_hint(e: std::io::Error, dir: &Path) -> anyhow::Error {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        anyhow!(
            "Le serveur ne peut pas remplacer son programme dans {} (permission refusée). Sous Linux, relancez l'installation (sudo ./install.sh) pour autoriser les mises à jour depuis le web.",
            dir.display()
        )
    } else {
        e.into()
    }
}

/// Swaps `binary` in place of the running executable. Returns its version.
pub fn install(data_dir: &Path, binary: &[u8], allow_older: bool) -> Result<String> {
    set_status(|st| {
        st.phase = Phase::Installing;
        st.message = "Vérification de la nouvelle version".into();
    });
    let exe = exe_path()?;
    let folder = exe
        .parent()
        .ok_or_else(|| anyhow!("no folder for {}", exe.display()))?
        .to_path_buf();
    let staged = folder.join(STAGED);
    std::fs::write(&staged, binary).map_err(|e| permission_hint(e, &folder))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
    }
    let version = match binary_version(&staged) {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_file(&staged);
            return Err(e);
        }
    };
    if !installable(&version) {
        let _ = std::fs::remove_file(&staged);
        bail!("La version {version} est antérieure à Arkyo {OLDEST_INSTALLABLE} et ne peut pas lire les données de ce serveur");
    }
    if !allow_older && !is_newer(&version, current_version()) {
        let _ = std::fs::remove_file(&staged);
        bail!(
            "La version {version} n'est pas plus récente que {}",
            current_version()
        );
    }
    let previous = folder.join(PREVIOUS);
    swap_in(&exe, &staged, &previous).map_err(|e| permission_hint(e, &folder))?;
    write_json(
        &dir(data_dir).join("pending.json"),
        &Pending {
            from: current_version().into(),
            to: version.clone(),
            starts: 0,
        },
    )?;
    write_json(
        &dir(data_dir).join("history.json"),
        &History {
            from: current_version().into(),
            to: version.clone(),
            at: now_ms(),
            outcome: "installed".into(),
        },
    )?;
    set_status(|st| {
        st.phase = Phase::Restarting;
        st.message = format!("Redémarrage en version {version}");
    });
    Ok(version)
}

/// Makes `staged` the executable and keeps the current one as `previous`.
fn swap_in(exe: &Path, staged: &Path, previous: &Path) -> std::io::Result<()> {
    if previous.exists() {
        std::fs::remove_file(previous)?;
    }
    if cfg!(windows) {
        // A running .exe cannot be overwritten, but it can be renamed.
        std::fs::rename(exe, previous)?;
    } else {
        std::fs::copy(exe, previous)?;
    }
    if let Err(e) = std::fs::rename(staged, exe) {
        if cfg!(windows) {
            let _ = std::fs::rename(previous, exe);
        }
        return Err(e);
    }
    Ok(())
}

/// Puts the previous version back (the current one becomes "previous").
pub fn rollback(data_dir: &Path, outcome: &str) -> Result<String> {
    let exe = exe_path()?;
    let folder = exe
        .parent()
        .ok_or_else(|| anyhow!("Pas de dossier"))?
        .to_path_buf();
    let previous = folder.join(PREVIOUS);
    if !previous.exists() {
        bail!("Aucune version précédente");
    }
    let version = binary_version(&previous)?;
    if outcome == "rolled back" && !installable(&version) {
        bail!("La version {version} est antérieure à Arkyo {OLDEST_INSTALLABLE} et ne peut pas lire les données de ce serveur");
    }
    let staged = folder.join(STAGED);
    std::fs::copy(&previous, &staged).map_err(|e| permission_hint(e, &folder))?;
    swap_in(&exe, &staged, &previous).map_err(|e| permission_hint(e, &folder))?;
    let _ = std::fs::remove_file(dir(data_dir).join("pending.json"));
    write_json(
        &dir(data_dir).join("history.json"),
        &History {
            from: current_version().into(),
            to: version.clone(),
            at: now_ms(),
            outcome: outcome.into(),
        },
    )?;
    set_status(|st| {
        st.phase = Phase::Restarting;
        st.message = format!("Retour à la version {version}");
    });
    Ok(version)
}

// -------------------------------------------------------------- restart ----

/// Lets the HTTP answer leave, then restarts on the new binary.
pub fn restart_soon() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(800));
        restart_now();
    });
}

fn restart_now() -> ! {
    if !crate::service::is_supervised() {
        // Foreground server: start the new binary with the same arguments;
        // it waits for this process to release the port.
        match exe_path().and_then(|exe| {
            std::process::Command::new(exe)
                .args(std::env::args_os().skip(1))
                .spawn()
                .map_err(Into::into)
        }) {
            Ok(_) => std::process::exit(0),
            Err(e) => tracing::error!("cannot relaunch: {e:#}"),
        }
    }
    // Non-zero exit: systemd (Restart=always), launchd (KeepAlive) and the
    // Windows SCM (failure actions) start the service again.
    std::process::exit(RESTART_CODE);
}

/// Called first thing at startup: counts starts of a fresh update and puts
/// the previous version back if the new one keeps failing.
pub fn startup_guard(data_dir: &Path) {
    let path = dir(data_dir).join("pending.json");
    let Some(mut p) = read_json::<Pending>(&path) else {
        return;
    };
    if p.to != current_version() {
        // Rolled back by hand, or replaced outside the updater.
        let _ = std::fs::remove_file(&path);
        return;
    }
    p.starts += 1;
    if p.starts > MAX_FAILED_STARTS {
        tracing::error!(
            version = p.to,
            "the update failed to start {MAX_FAILED_STARTS} times; restoring {}",
            p.from
        );
        match rollback(data_dir, "restored automatically") {
            Ok(_) => restart_now(),
            Err(e) => tracing::error!("automatic rollback failed: {e:#}"),
        }
        let _ = std::fs::remove_file(&path);
        return;
    }
    let _ = write_json(&path, &p);
}

/// Marks the update as good once the server has run for a while.
pub fn confirm_after(data_dir: PathBuf, delay: Duration) {
    tokio::spawn(async move {
        tokio::time::sleep(delay).await;
        let path = dir(&data_dir).join("pending.json");
        if path.exists() {
            tracing::info!(version = current_version(), "update confirmed");
            let _ = std::fs::remove_file(path);
        }
    });
}

/// Background check every 6 hours (never installs).
pub fn spawn_auto_check(data_dir: PathBuf) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            let s = Settings::load(&data_dir);
            if s.auto_check && !busy() {
                let d = data_dir.clone();
                match tokio::task::spawn_blocking(move || check(&d)).await {
                    Ok(Ok(Some(r))) if is_newer(&r.version, current_version()) => {
                        tracing::info!(version = r.version, "a new version is available")
                    }
                    Ok(Err(e)) => tracing::debug!("update check: {e:#}"),
                    _ => {}
                }
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_newer_semver() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("0.10.0", "0.9.3"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.9", "0.2.0"));
        assert!(!is_newer("0.1.0-dev", "0.1.0"));
        assert!(is_newer("0.1.0", "0.1.0-dev"));
    }

    fn tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut tar = tar::Builder::new(Vec::new());
        for (name, data) in entries {
            let mut h = tar::Header::new_gnu();
            h.set_size(data.len() as u64);
            h.set_mode(0o755);
            tar.append_data(&mut h, name, *data).unwrap();
        }
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut gz, &tar.into_inner().unwrap()).unwrap();
        gz.finish().unwrap()
    }

    #[test]
    fn extract_binary_from_update_tarball() {
        let body = b"\x7fELF fake binary";
        let archive = tar_gz(&[
            ("Arkyo-0.2.0-linux-x86_64/README.md", b"hello"),
            ("Arkyo-0.2.0-linux-x86_64/arkyo-server", body),
        ]);
        assert_eq!(extract_binary(&archive).unwrap(), body);
        // A bare binary is accepted, anything else is refused.
        assert_eq!(extract_binary(b"\x7fELF raw").unwrap(), b"\x7fELF raw");
        assert!(extract_binary(b"not a package").is_err());
        // An archive without the server says so.
        let empty = tar_gz(&[("Arkyo-0.2.0-linux-x86_64/README.md", b"hi")]);
        assert!(extract_binary(&empty).is_err());
    }

    #[test]
    fn extract_binary_from_update_zip() {
        use std::io::Write;
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("Arkyo-0.2.0-windows-x86_64/arkyo-server.exe", o)
                .unwrap();
            z.write_all(b"MZ fake").unwrap();
            z.finish().unwrap();
        }
        let zip_bytes = buf.into_inner();
        let found = from_archive(&zip_bytes, |n| n.ends_with("arkyo-server.exe")).unwrap();
        assert_eq!(found, Some(Some(b"MZ fake".to_vec())));
    }

    #[test]
    fn asset_name_per_platform() {
        let name = format!(
            "Arkyo-0.2.0-{PLATFORM}{}",
            if cfg!(windows) { ".zip" } else { ".tar.gz" }
        );
        assert!(PACKAGES[0].starts_with('-') && name.ends_with(PACKAGES[0]));
        assert!(name.starts_with("Arkyo-"));
        let asset = |id, name: &str| GhAsset {
            id,
            name: name.into(),
            size: 1,
            digest: None,
            state: None,
        };
        let names = [
            "Arkyo-0.2.0-macos-arm64.tar.gz",
            "Arkyo-0.2.0-macos-x86_64.tar.gz",
            "Arkyo-0.2.0-linux-x86_64.tar.gz",
            "Arkyo-0.2.0-windows-x86_64.zip",
            "Arkyo-0.2.0-macos-universal.pkg",
            "Arkyo-0.2.0-macos-universal.dmg",
            "Arkyo-0.2.0-windows-x64.msi",
            "Arkyo-0.2.0-ubuntu-x64.tar.gz",
        ];
        let all = names
            .iter()
            .enumerate()
            .map(|(i, n)| asset(i as u64, n))
            .collect();
        assert_eq!(pick_package(all).map(|a| a.name), Some(name));
        // Without the update package: the installer of the platform.
        let rest = names
            .iter()
            .filter(|n| !n.ends_with(PACKAGES[0]))
            .enumerate()
            .map(|(i, n)| asset(i as u64, n))
            .collect();
        let installer = pick_package(rest).map(|a| a.name);
        if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            assert_eq!(installer.as_deref(), Some("Arkyo-0.2.0-ubuntu-x64.tar.gz"));
        } else if cfg!(target_os = "macos") {
            assert_eq!(
                installer.as_deref(),
                Some("Arkyo-0.2.0-macos-universal.pkg")
            );
        } else if cfg!(windows) {
            assert_eq!(installer.as_deref(), Some("Arkyo-0.2.0-windows-x64.msi"));
        }
    }

    #[test]
    fn only_releases_with_this_platforms_package_are_offered() {
        let gh = |tag: &str, assets: &[(&str, &str)], draft: bool| GhRelease {
            tag_name: tag.into(),
            name: None,
            body: None,
            published_at: None,
            html_url: String::new(),
            assets: assets
                .iter()
                .enumerate()
                .map(|(i, (name, state))| GhAsset {
                    id: i as u64,
                    name: (*name).into(),
                    size: 1,
                    digest: None,
                    state: Some((*state).into()),
                })
                .collect(),
            draft,
            prerelease: false,
        };
        let ours = format!("Arkyo-x{}", PACKAGES[0]);
        let all = vec![
            gh("v0.4.0", &[], false),
            gh("v0.3.2", &[(&ours, "starter")], false),
            gh("v0.3.1", &[(&ours, "uploaded")], false),
            gh("v0.3.3", &[(&ours, "uploaded")], true),
            gh("v0.2.0", &[("Arkyo-x-other.tar.gz", "uploaded")], false),
            gh("v0.1.0", &[(&ours, "uploaded")], false),
        ];
        let got: Vec<String> = usable_releases(all, pick_package)
            .into_iter()
            .map(|r| r.version)
            .collect();
        assert_eq!(got, ["0.3.1", "0.1.0"]);
    }

    #[test]
    fn installers_are_recognised_and_searched() {
        assert_eq!(Installer::of(b"xar!\x00\x1c"), Some(Installer::Pkg));
        assert_eq!(
            Installer::of(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]),
            Some(Installer::Msi)
        );
        assert_eq!(Installer::of(b"\x7fELF"), None);
        let dir = std::env::temp_dir().join(format!("arkyo-find-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let deep = dir.join("Arkyo.pkg/Payload/usr/local/arkyo");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(deep.join("INSTALL.md"), b"doc").unwrap();
        std::fs::write(deep.join(EXE), b"server").unwrap();
        let exe = |n: &str| Path::new(n).file_name().and_then(|n| n.to_str()) == Some(EXE);
        assert_eq!(
            find_file(&dir, &dir, &exe).unwrap(),
            Some(b"server".to_vec())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn settings_default_to_the_arkyo_repo_and_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let s = Settings::load(dir.path());
        assert_eq!(s.repo, "DamienP2/arkyo-server");
        assert!(s.auto_check);
        let mut s = s;
        s.auto_check = false;
        s.save(dir.path()).unwrap();
        assert!(!Settings::load(dir.path()).auto_check);
    }
}
