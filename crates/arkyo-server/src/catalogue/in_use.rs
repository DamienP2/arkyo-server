//! Reference counts used to refuse the deletion of a referential entry that
//! is still referenced (arkyo: `app/api/tenant/parametres/**/[id]/route.ts`).
//!
//! Each function returns the named counts, in the order of arkyo's
//! `breakdown`; the route sums them for its message. Only the references
//! arkyo's routes check are enforced by the routes: brand, connector type,
//! function, phase, type and category, plus the cable model (arkyo-server
//! correction, see [`cable_model`]). [`signal_type`] is provided for
//! completeness and is not called by the delete routes, because arkyo
//! deletes it without checking (its comments: no FK to count).
//!
//! EXTENSION POINT (phase 3): the project tables (`ProjectEquipment`,
//! `ProjectConnection`, …) do not exist yet. Phase 3 adds its own counts to
//! the functions below (same breakdown keys) when arkyo's routes look at
//! project rows too.

use sqlx::SqliteConnection;

/// Named counts (arkyo `breakdown` keys) of the references to one entry.
pub type Counts = Vec<(&'static str, i64)>;

pub fn total(counts: &Counts) -> i64 {
    counts.iter().map(|(_, n)| n).sum()
}

async fn count(conn: &mut SqliteConnection, sql: &str, id: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(sql).bind(id).fetch_one(conn).await
}

/// Rows of `table` whose JSON-array column `col` holds the string `id`.
async fn json_contains(
    conn: &mut SqliteConnection,
    table: &str,
    col: &str,
    id: &str,
) -> Result<i64, sqlx::Error> {
    count(
        conn,
        &format!(
            r#"SELECT COUNT(*) FROM "{table}" t
               WHERE EXISTS (SELECT 1 FROM json_each(t."{col}") j WHERE j.value = ?)"#
        ),
        id,
    )
    .await
}

/// Brand: `TenantEquipment.brandId`, `TenantCable.brandId`.
pub async fn brand(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    Ok(vec![
        (
            "equipment",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantEquipment" WHERE "brandId" = ?"#,
                id,
            )
            .await?,
        ),
        (
            "cable",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantCable" WHERE "brandId" = ?"#,
                id,
            )
            .await?,
        ),
    ])
}

/// Connector type: `TenantCable.leftConnectorId` / `rightConnectorId`.
/// (arkyo does not look into `TenantEquipment.connectors` nor
/// `TenantAdapter.inputs/outputs`.)
pub async fn connector_type(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    Ok(vec![
        (
            "cableLeft",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantCable" WHERE "leftConnectorId" = ?"#,
                id,
            )
            .await?,
        ),
        (
            "cableRight",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantCable" WHERE "rightConnectorId" = ?"#,
                id,
            )
            .await?,
        ),
    ])
}

/// Signal type, by name: equipment whose `signalCapacities[].signalName` is
/// `name`. Not enforced by the delete route (arkyo deletes directly).
pub async fn signal_type(conn: &mut SqliteConnection, name: &str) -> Result<Counts, sqlx::Error> {
    Ok(vec![(
        "equipment",
        count(
            conn,
            r#"SELECT COUNT(*) FROM "TenantEquipment" e
               WHERE EXISTS (SELECT 1 FROM json_each(e."signalCapacities") j
                             WHERE json_extract(j.value, '$.signalName') = ?)"#,
            name,
        )
        .await?,
    )])
}

/// Function: types, signal types and cable models (`functionId`) and
/// connector types (`functionIds` JSON array).
pub async fn function(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    Ok(vec![
        (
            "types",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantType" WHERE "functionId" = ?"#,
                id,
            )
            .await?,
        ),
        (
            "signals",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantSignalType" WHERE "functionId" = ?"#,
                id,
            )
            .await?,
        ),
        (
            "cableModels",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantCableModel" WHERE "functionId" = ?"#,
                id,
            )
            .await?,
        ),
        (
            "connectors",
            json_contains(conn, "TenantConnectorType", "functionIds", id).await?,
        ),
    ])
}

/// Phase: `TenantEquipment.phaseIds` (JSON array).
pub async fn phase(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    Ok(vec![(
        "equipment",
        json_contains(conn, "TenantEquipment", "phaseIds", id).await?,
    )])
}

/// Type: `TenantEquipment.typeId` and sub-types (`TenantType.parentId`).
pub async fn type_(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    Ok(vec![
        (
            "equipment",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantEquipment" WHERE "typeId" = ?"#,
                id,
            )
            .await?,
        ),
        (
            "children",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantType" WHERE "parentId" = ?"#,
                id,
            )
            .await?,
        ),
    ])
}

/// Equipment category: sub-categories and `TenantEquipment.categoryId`.
pub async fn category(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    Ok(vec![
        (
            "children",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantEquipmentCategory" WHERE "parentId" = ?"#,
                id,
            )
            .await?,
        ),
        (
            "equipment",
            count(
                conn,
                r#"SELECT COUNT(*) FROM "TenantEquipment" WHERE "categoryId" = ?"#,
                id,
            )
            .await?,
        ),
    ])
}

/// Cable model: the `RackConnection` and `ProjectConnection` rows whose
/// `catalogCableModelId` is `id`.
///
/// arkyo-server: correction d'un défaut d'arkyo (4c, décision 2). Le
/// synoptique écrit un `TenantCableModel.id` dans `catalogCableModelId`
/// (`synoptic-cable-model-picker.tsx:48`), mais arkyo comptait ces
/// connexions à la suppression d'un câble (`assertCableNotInUse`,
/// `lib/services/tenant-catalogue.ts:189-213`) et supprimait le modèle sans
/// contrôle : la garde passe du câble au modèle de câble. La référence
/// `TenantCable.cableModelId` reste sans garde, comme dans arkyo.
pub async fn cable_model(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    references(
        conn,
        id,
        &[
            ("rackConnections", "RackConnection"),
            ("projectConnections", "ProjectConnection"),
        ],
        "catalogCableModelId",
    )
    .await
}

/// Counts, per `(key, table)` of `refs`, the rows of the project tables that
/// exist and whose `col` is `id`.
///
/// EXTENSION POINT (phase 3): these tables are created by the phase that
/// ports projects. Until then they do not exist and the item is never "in
/// use"; once they exist the check counts them without change.
async fn references(
    conn: &mut SqliteConnection,
    id: &str,
    refs: &[(&'static str, &str)],
    col: &str,
) -> Result<Counts, sqlx::Error> {
    let mut out = Counts::new();
    for (key, table) in refs {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&mut *conn)
        .await?;
        if exists > 0 {
            out.push((
                key,
                count(
                    conn,
                    &format!(r#"SELECT COUNT(*) FROM "{table}" WHERE "{col}" = ?"#),
                    id,
                )
                .await?,
            ));
        }
    }
    Ok(out)
}

/// Equipment (arkyo `assertEquipmentNotInUse`): `RackInventoryItem` and
/// `RackSlot` rows pointing at it through `catalogEquipmentId`.
pub async fn equipment(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    references(
        conn,
        id,
        &[("inventory", "RackInventoryItem"), ("slots", "RackSlot")],
        "catalogEquipmentId",
    )
    .await
}

/// Cable (arkyo `assertCableNotInUse`): nothing references a catalogue
/// cable.
///
/// arkyo-server: correction d'un défaut d'arkyo (4c, décision 2). arkyo
/// comptait ici les connexions dont `catalogCableModelId` valait l'id du
/// câble, alors que cette colonne contient un `TenantCableModel.id` : la
/// garde a été déplacée vers [`cable_model`], et un câble du catalogue se
/// supprime sans contrôle d'usage.
pub async fn cable(_conn: &mut SqliteConnection, _id: &str) -> Result<Counts, sqlx::Error> {
    Ok(Counts::new())
}

/// Adapter (arkyo `assertAdapterNotInUse`): `SynopticAdapter` and
/// `ProjectSynopticAdapter` rows through `catalogAdapterId`.
///
/// arkyo-server: correction, les lignes `RackInventoryItem` comptent aussi
/// (comme pour un équipement) : arkyo laissait supprimer un adaptateur
/// présent dans un inventaire, et sa ligne disparaissait en silence du BOM
/// et des exports.
pub async fn adapter(conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
    references(
        conn,
        id,
        &[
            ("synoptic", "SynopticAdapter"),
            ("projectSynoptic", "ProjectSynopticAdapter"),
            ("inventory", "RackInventoryItem"),
        ],
        "catalogAdapterId",
    )
    .await
}
