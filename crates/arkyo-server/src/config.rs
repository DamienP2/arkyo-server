//! Server settings persisted in `<data dir>/config.json`.

use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const DEFAULT_PORT: u16 = 8090;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub port: u16,
    pub bind: IpAddr,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: DEFAULT_PORT,
            bind: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        }
    }
}

impl Config {
    /// Reads `config.json`; defaults when it is absent or unreadable.
    pub fn load(dir: &Path) -> Config {
        std::fs::read(dir.join("config.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    /// Writes `config.json` atomically (temporary file, then rename).
    pub fn save(&self, dir: &Path) -> anyhow::Result<()> {
        std::fs::create_dir_all(dir)?;
        let tmp = dir.join("config.json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, dir.join("config.json"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_missing() {
        let d = tempfile::tempdir().unwrap();
        let c = Config::load(d.path());
        assert_eq!(c.port, 8090);
        assert_eq!(c.bind.to_string(), "0.0.0.0");
    }

    #[test]
    fn roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let c = Config {
            port: 9001,
            ..Config::default()
        };
        c.save(d.path()).unwrap();
        assert_eq!(Config::load(d.path()).port, 9001);
        let raw = std::fs::read_to_string(d.path().join("config.json")).unwrap();
        assert!(raw.contains("\"port\": 9001"), "{raw}");
        assert!(!d.path().join("config.json.tmp").exists());
    }

    #[test]
    fn unreadable_falls_back_to_defaults() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("config.json"), "{oops").unwrap();
        assert_eq!(Config::load(d.path()).port, 8090);
    }
}
