//! Audit trail (`AuditLog`), written by the write routes inside their own
//! transaction so the entry commits or rolls back with the change.

use serde_json::Value;
use sqlx::SqliteConnection;

use crate::ids::{new_id, now_iso};

#[allow(clippy::too_many_arguments)]
pub async fn log(
    conn: &mut SqliteConnection,
    user_id: &str,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    project_id: Option<&str>,
    before: Option<Value>,
    after: Option<Value>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","projectId","before","after","createdAt")
           VALUES (?,?,?,?,?,?,?,?,?)"#,
    )
    .bind(new_id())
    .bind(user_id)
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .bind(project_id)
    .bind(before.map(|v| v.to_string()))
    .bind(after.map(|v| v.to_string()))
    .bind(now_iso())
    .execute(conn)
    .await?;
    Ok(())
}
