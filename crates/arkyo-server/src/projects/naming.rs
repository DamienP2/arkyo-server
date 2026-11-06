//! arkyo:lib/services/rack-naming.ts: unique rack (container) names within
//! a scope, suffixed " 2", " 3"… on collision.
//!
//! Scope: a project (`Some(project_id)`), or the pool of template racks
//! (`None`: every rack whose `RigConfig` has `projectId IS NULL`). Names
//! compare after `trim()` and lower casing (JavaScript `toLowerCase()`,
//! Unicode). No database constraint backs this, as in arkyo.

use std::collections::HashSet;

use sqlx::SqliteConnection;

/// `listScopedRackNames`: the trimmed, lower-cased names of the racks
/// linked (`RigRack`) to a rig of the scope, except `exclude`.
async fn scoped_names(
    conn: &mut SqliteConnection,
    project_id: Option<&str>,
    exclude: Option<&str>,
) -> Result<HashSet<String>, sqlx::Error> {
    let names: Vec<String> = sqlx::query_scalar(
        r#"SELECT r."name" FROM "RigRack" rr
           JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
           JOIN "Rack" r ON r."id" = rr."rackId"
           WHERE g."projectId" IS ?1 AND (?2 IS NULL OR rr."rackId" <> ?2)"#,
    )
    .bind(project_id)
    .bind(exclude)
    .fetch_all(conn)
    .await?;
    Ok(names.iter().map(|n| n.trim().to_lowercase()).collect())
}

/// `ensureUniqueRackName(db, projectId, baseName)`: `base` trimmed when it
/// is free in the scope, else `"<base> 2"`, `"<base> 3"`… (up to 999, then
/// a millisecond timestamp, as arkyo). An empty trimmed name is returned
/// as is (the routes validate `min(1)` beforehand).
pub async fn ensure_unique_rack_name(
    conn: &mut SqliteConnection,
    project_id: Option<&str>,
    base: &str,
) -> Result<String, sqlx::Error> {
    ensure_unique_rack_name_excluding(conn, project_id, base, None).await
}

/// [`ensure_unique_rack_name`] ignoring the rack `exclude` (rename: the
/// rack's current name does not collide with itself).
pub async fn ensure_unique_rack_name_excluding(
    conn: &mut SqliteConnection,
    project_id: Option<&str>,
    base: &str,
    exclude: Option<&str>,
) -> Result<String, sqlx::Error> {
    let trimmed = base.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let taken = scoped_names(conn, project_id, exclude).await?;
    Ok(pick(trimmed, &taken))
}

fn pick(trimmed: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(&trimmed.to_lowercase()) {
        return trimmed.to_string();
    }
    for n in 2..1000 {
        let candidate = format!("{trimmed} {n}");
        if !taken.contains(&candidate.to_lowercase()) {
            return candidate;
        }
    }
    format!("{trimmed} {}", jiff::Timestamp::now().as_millisecond())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|n| n.trim().to_lowercase()).collect()
    }

    #[test]
    fn suffixes_like_arkyo() {
        let taken = set(&["Baie A", "Baie A 2", "Baie A 3"]);
        assert_eq!(pick("Baie A", &taken), "Baie A 4");
        assert_eq!(pick("baie a", &taken), "baie a 4");
        assert_eq!(pick("Baie B", &taken), "Baie B");
        assert_eq!(pick("ÉCRAN", &set(&[" écran "])), "ÉCRAN 2");
    }
}
