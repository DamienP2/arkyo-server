//! Role-based permissions: five domains, four ordered levels.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Domain {
    Projects,
    Design,
    Catalog,
    Members,
    Settings,
}

impl Domain {
    pub const ALL: [Domain; 5] = [
        Domain::Projects,
        Domain::Design,
        Domain::Catalog,
        Domain::Members,
        Domain::Settings,
    ];
}

/// Ordered: `None < Read < Write < Admin`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    None,
    Read,
    Write,
    Admin,
}

pub type Permissions = BTreeMap<Domain, Level>;

#[derive(Debug, Clone, Copy)]
pub struct BuiltinRole {
    pub key: &'static str,
    pub label: &'static str,
    pub color: &'static str,
    pub is_owner: bool,
    /// Levels in `Domain::ALL` order: projects, design, catalog, members, settings.
    pub permissions: [Level; 5],
}

impl BuiltinRole {
    pub fn permissions(&self) -> Permissions {
        Domain::ALL.into_iter().zip(self.permissions).collect()
    }
}

use Level::{Admin, None as No, Read, Write};

pub const BUILTIN_ROLES: [BuiltinRole; 4] = [
    BuiltinRole {
        key: "owner",
        label: "Propriétaire",
        color: "#7c3aed",
        is_owner: true,
        permissions: [Admin, Admin, Admin, Admin, Admin],
    },
    BuiltinRole {
        key: "chef-projet",
        label: "Chef de projet",
        color: "#4f46e5",
        is_owner: false,
        permissions: [Write, Write, Write, No, No],
    },
    BuiltinRole {
        key: "technicien",
        label: "Technicien",
        color: "#059669",
        is_owner: false,
        permissions: [Write, Write, Read, No, No],
    },
    BuiltinRole {
        key: "consultation",
        label: "Consultation",
        color: "#6b7280",
        is_owner: false,
        permissions: [Read, No, Read, No, No],
    },
];

/// Unknown keys are ignored, missing domains are `None`, invalid JSON gives all `None`.
pub fn parse_permissions(json: &str) -> Permissions {
    let raw: BTreeMap<String, serde_json::Value> = serde_json::from_str(json).unwrap_or_default();
    Domain::ALL
        .into_iter()
        .map(|d| {
            let level = raw
                .get(domain_key(d))
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or(Level::None);
            (d, level)
        })
        .collect()
}

fn domain_key(d: Domain) -> &'static str {
    match d {
        Domain::Projects => "projects",
        Domain::Design => "design",
        Domain::Catalog => "catalog",
        Domain::Members => "members",
        Domain::Settings => "settings",
    }
}

pub fn has_permission(p: &Permissions, d: Domain, min: Level) -> bool {
    p.get(&d).copied().unwrap_or(Level::None) >= min
}

pub fn owner_permissions() -> Permissions {
    Domain::ALL.into_iter().map(|d| (d, Level::Admin)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ignores_unknown_and_defaults_none() {
        let p = parse_permissions(r#"{"projects":"write","foo":"admin"}"#);
        assert_eq!(p[&Domain::Projects], Level::Write);
        assert_eq!(p[&Domain::Settings], Level::None);
        assert_eq!(p.len(), 5);
    }

    #[test]
    fn invalid_json_is_all_none() {
        let p = parse_permissions("{oops");
        assert!(p.values().all(|l| *l == Level::None));
    }

    #[test]
    fn level_ordering() {
        assert!(has_permission(&owner_permissions(), Domain::Members, Level::Admin));
        assert!(Level::Read < Level::Write);
        assert!(!has_permission(&parse_permissions("{}"), Domain::Projects, Level::Read));
    }
}
