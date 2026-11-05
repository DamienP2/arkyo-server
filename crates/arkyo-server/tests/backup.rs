//! Backup, summary and restore of the catalogue (Task 7 of phase 2,
//! arkyo:app/api/tenant/parametres/backup/**).
mod common;
use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

const BACKUP: &str = "/api/tenant/parametres/backup";
const SUMMARY: &str = "/api/tenant/parametres/backup/summary";
const RESTORE: &str = "/api/tenant/parametres/backup/restore";
const EQUIPMENT: &str = "/api/tenant/catalogue/equipment";

struct Ctx {
    e: Env,
    tok: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    Ctx { e, tok }
}

impl Ctx {
    async fn req(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, path, LOCAL, Some(&self.tok), body).await
    }

    async fn user_id(&self) -> String {
        sqlx::query_scalar(r#"SELECT "id" FROM "User" WHERE "email" = 'o@b.fr'"#)
            .fetch_one(&self.e.pool)
            .await
            .unwrap()
    }

    /// GET backup: status, Content-Disposition and the parsed file.
    async fn download(&self, query: &str) -> (StatusCode, String, Value) {
        let mut req = Request::builder()
            .method("GET")
            .uri(format!("{BACKUP}{query}"))
            .header(header::COOKIE, format!("arkyo_session={}", self.tok))
            .body(Body::empty())
            .unwrap();
        req.extensions_mut().insert(axum::extract::ConnectInfo(
            LOCAL.parse::<std::net::SocketAddr>().unwrap(),
        ));
        let res = self.e.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let cd = res
            .headers()
            .get(header::CONTENT_DISPOSITION)
            .map(|v| v.to_str().unwrap().to_string())
            .unwrap_or_default();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, cd, serde_json::from_slice(&bytes).unwrap())
    }
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

/// A catalogue with every kind of value: JSON arrays, booleans, floats, a
/// component, a sub-category, a numbering key.
async fn populate(c: &Ctx) -> (String, String) {
    let r = c
        .req(
            "POST",
            "/api/tenant/parametres/brands",
            Some(json!({ "name": "Marque Test", "website": "https://ex.fr" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let brand = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .req(
            "POST",
            "/api/tenant/parametres/categories/category",
            Some(json!({ "name": "Parent Cat" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let parent = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .req(
            "POST",
            "/api/tenant/parametres/categories/category",
            Some(json!({ "name": "Enfant Cat", "parentId": parent })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let host = c
        .req(
            "POST",
            EQUIPMENT,
            Some(json!({
                "name": "Châssis", "reference": "CH-1", "brandId": brand,
                "heightU": 3, "weight": 6.5, "heatBtuH": 120.25, "is2110": true,
                "isComponentHost": true, "hostSlotCount": 4, "rearCableDepthMm": 80,
                "tags": ["hd", "sdi"], "connectors": [{"face": "REAR", "quantity": 2}],
                "functionIds": ["f1", "f2"], "notes": "ligne 1\nligne 2"
            })),
        )
        .await;
    assert_eq!(host.status, StatusCode::CREATED, "{:?}", host.body);
    let comp = c
        .req(
            "POST",
            EQUIPMENT,
            Some(json!({ "name": "Carte", "isComponent": true, "componentSlotSpan": 2 })),
        )
        .await;
    assert_eq!(comp.status, StatusCode::CREATED, "{:?}", comp.body);
    let host_id = host.body["id"].as_str().unwrap().to_string();
    sqlx::query(
        r#"INSERT INTO "TenantEquipmentComponent" ("id","hostId","componentId","slotIndex","createdAt")
           VALUES ('comp1', ?, ?, 0, '2026-01-01T00:00:00.000Z')"#,
    )
    .bind(&host_id)
    .bind(comp.body["id"].as_str().unwrap())
    .execute(&c.e.pool)
    .await
    .unwrap();
    let r = c
        .req(
            "PATCH",
            "/api/tenant/parametres/numbering",
            Some(json!({ "cable_pad": "3", "cable_sep1": "-" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    (host_id, brand)
}

fn rows<'a>(b: &'a Value, path: &[&str]) -> &'a Vec<Value> {
    let mut v = &b["data"];
    for p in path {
        v = &v[*p];
    }
    v.as_array().unwrap_or_else(|| panic!("{path:?} absent"))
}

// ── GET backup / summary ────────────────────────────────────────────────────

#[tokio::test]
async fn backup_dumps_sections_and_summary_counts() {
    let c = ctx().await;
    populate(&c).await;
    let (status, cd, b) = c.download("").await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        cd.starts_with("attachment; filename=\"arkyo-sauvegarde-") && cd.ends_with(".json\""),
        "{cd}"
    );
    assert_eq!(b["meta"]["format"], "arkyo-backup");
    assert_eq!(b["meta"]["version"], 1);
    assert_eq!(
        b["meta"]["sections"],
        json!(["equipment", "cables", "adapters", "settings"])
    );
    let host = rows(&b, &["equipment"])
        .iter()
        .find(|e| e["name"] == "Châssis")
        .unwrap();
    // Prisma-like values: booleans, parsed JSON, floats.
    assert_eq!(host["is2110"], true);
    assert_eq!(host["tags"], json!(["hd", "sdi"]));
    assert_eq!(host["weight"], 6.5);
    assert_eq!(host["defaultComponents"][0]["slotIndex"], 0);
    assert!(!rows(&b, &["settings", "brands"]).is_empty());
    let keys: Vec<&str> = rows(&b, &["settings", "appConfig"])
        .iter()
        .map(|r| r["key"].as_str().unwrap())
        .collect();
    assert_eq!(keys.len(), 2, "{keys:?}");
    assert!(rows(&b, &["settings", "printExportModels"])
        .iter()
        .all(|m| m["pages"].is_array()));

    // ?sections= keeps only the known ones; unknown only → all.
    let (_, _, part) = c.download("?sections=cables,bogus").await;
    assert_eq!(part["meta"]["sections"], json!(["cables"]));
    assert!(part["data"].get("equipment").is_none());
    let (_, _, all) = c.download("?sections=bogus").await;
    assert_eq!(all["meta"]["sections"].as_array().unwrap().len(), 4);

    let s = c.req("GET", SUMMARY, None).await;
    assert_eq!(s.status, StatusCode::OK);
    assert_eq!(s.body["equipment"], 2);
    let settings_total: usize = b["data"]["settings"]
        .as_object()
        .unwrap()
        .values()
        .map(|v| v.as_array().unwrap().len())
        .sum();
    assert_eq!(s.body["settings"], settings_total);
    assert_eq!(
        s.body["cables"],
        rows(&b, &["cables"]).len(),
        "{:?}",
        s.body
    );

    let anon = call(&c.e.app, "GET", SUMMARY, LOCAL, None, None).await;
    assert_eq!(anon.status, StatusCode::UNAUTHORIZED);
}

// ── POST restore ────────────────────────────────────────────────────────────

/// Review Focus 3: export, restore in `replace` on a fresh database, export
/// again: the same catalogue (createdById rewritten to the restoring user;
/// AppConfig rows are upserted by key, so only key/value are compared).
#[tokio::test]
async fn backup_restore_replace_roundtrip_identical() {
    let a = ctx().await;
    populate(&a).await;
    let (_, _, b1) = a.download("").await;

    let b = ctx().await;
    let modes = json!({ "equipment": "replace", "cables": "replace",
                        "adapters": "replace", "settings": "replace" });
    let mut rx = b.e.events.subscribe();
    let r = b
        .req(
            "POST",
            RESTORE,
            Some(json!({ "modes": modes, "backup": b1 })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let eq_n = rows(&b1, &["equipment"]).len();
    assert_eq!(r.body["report"]["equipment"]["created"], eq_n);
    assert_eq!(r.body["report"]["equipment"]["deleted"], 0);
    assert_eq!(r.body["report"]["equipment"]["updated"], 0);
    assert!(r.body["report"]["settings"]["deleted"].as_i64().unwrap() > 0);
    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(
        ev,
        json!({"type":"update","entity":"tenant_parametres_backup","action":"restore"})
    );
    assert_eq!(
        count(
            &b.e.pool,
            r#"SELECT COUNT(*) FROM "AuditLog" WHERE "action"='tenant_backup.restore' AND "entityType"='Backup' AND "entityId"='restore'"#
        )
        .await,
        1
    );

    let (_, _, b2) = b.download("").await;
    let uid = b.user_id().await;
    let mut d1 = b1["data"].clone();
    for section in ["equipment", "cables", "adapters"] {
        for row in d1[section].as_array_mut().unwrap() {
            row["createdById"] = Value::String(uid.clone());
        }
    }
    let mut d2 = b2["data"].clone();
    for d in [&mut d1, &mut d2] {
        let cfg = d["settings"]["appConfig"].as_array_mut().unwrap();
        for row in cfg.iter_mut() {
            *row = json!({ "key": row["key"], "value": row["value"] });
        }
        cfg.sort_by(|x, y| x["key"].as_str().cmp(&y["key"].as_str()));
    }
    for section in ["equipment", "cables", "adapters"] {
        assert_eq!(d1[section], d2[section], "section {section}");
    }
    for (k, v) in d1["settings"].as_object().unwrap() {
        assert_eq!(v, &d2["settings"][k], "settings.{k}");
    }
    assert_eq!(d1, d2);
}

#[tokio::test]
async fn restore_merge_upserts_without_delete() {
    let c = ctx().await;
    let (host, _) = populate(&c).await;
    let (_, _, mut b) = c.download("?sections=equipment").await;
    let extra = c
        .req(
            "POST",
            EQUIPMENT,
            Some(json!({ "name": "Absent du fichier" })),
        )
        .await;
    assert_eq!(extra.status, StatusCode::CREATED);
    {
        let eq = b["data"]["equipment"].as_array_mut().unwrap();
        let h = eq.iter_mut().find(|e| e["id"] == host.as_str()).unwrap();
        h["name"] = json!("Châssis modifié");
        h["defaultComponents"] = json!([]);
        let mut fresh = h.clone();
        fresh["id"] = json!("cnewequipment0000000000001");
        fresh["name"] = json!("Nouveau");
        fresh["unknownField"] = json!("ignoré");
        eq.push(fresh);
    }
    let r = c
        .req(
            "POST",
            RESTORE,
            Some(json!({ "modes": { "equipment": "merge", "settings": "merge" }, "backup": b })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    // settings absent from the file: skipped, not reported.
    assert_eq!(
        r.body["report"],
        json!({ "equipment": { "created": 1, "updated": 2, "deleted": 0 } })
    );
    let names: Vec<String> =
        sqlx::query_scalar(r#"SELECT "name" FROM "TenantEquipment" ORDER BY "name""#)
            .fetch_all(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(
        names,
        ["Absent du fichier", "Carte", "Châssis modifié", "Nouveau"]
    );
    // The host's components follow the file (emptied here).
    assert_eq!(
        count(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "TenantEquipmentComponent""#
        )
        .await,
        0
    );
}

#[tokio::test]
async fn restore_section_failure_keeps_previous_sections() {
    let c = ctx().await;
    let uid = c.user_id().await;
    let backup = json!({
        "meta": { "format": "arkyo-backup", "version": 1,
                  "exportedAt": "2026-11-05T10:00:00.000Z",
                  "sections": ["settings", "equipment"] },
        "data": {
            "settings": { "brands": [{ "id": "cbrandfromfile00000000001", "name": "Marque Fichier",
                                       "isActive": true, "createdAt": "2026-01-01T00:00:00.000Z",
                                       "updatedAt": "2026-01-01T00:00:00.000Z" }] },
            "equipment": [
                { "id": "cokequipment0000000000001", "name": "Valide", "createdById": "ailleurs" },
                { "id": "cbadequipment000000000001", "reference": "sans nom" }
            ]
        }
    });
    let r = c
        .req(
            "POST",
            RESTORE,
            Some(
                json!({ "modes": { "settings": "merge", "equipment": "merge" }, "backup": backup }),
            ),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{:?}", r.body);
    let msg = r.body["error"].as_str().unwrap();
    assert!(
        msg.starts_with("Échec de la restauration de la section « Équipements » : "),
        "{msg}"
    );
    assert!(msg.ends_with(
        ". Cette section a été annulée (rollback) ; les sections déjà restaurées avant celle-ci restent en base."
    ));
    // Settings committed, equipment section rolled back as a whole.
    assert_eq!(
        count(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "TenantBrand" WHERE "name"='Marque Fichier'"#
        )
        .await,
        1
    );
    assert_eq!(
        count(&c.e.pool, r#"SELECT COUNT(*) FROM "TenantEquipment""#).await,
        0
    );

    // The same equipment section without the bad row: createdById rewritten.
    let mut ok = backup.clone();
    ok["data"]["equipment"].as_array_mut().unwrap().pop();
    let r = c
        .req(
            "POST",
            RESTORE,
            Some(json!({ "modes": { "equipment": "merge" }, "backup": ok })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let created_by: String = sqlx::query_scalar(
        r#"SELECT "createdById" FROM "TenantEquipment" WHERE "id"='cokequipment0000000000001'"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(created_by, uid);
}

#[tokio::test]
async fn restore_validates_body_file_and_permission() {
    let c = ctx().await;
    let r = c
        .req(
            "POST",
            RESTORE,
            Some(json!({ "modes": { "equipment": "x" }, "backup": {} })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(
        r.body["error"]["fieldErrors"]["modes"].is_array(),
        "{:?}",
        r.body
    );

    let cases = [
        (json!([]), "Fichier invalide : ce n'est pas un objet JSON."),
        (
            json!({ "meta": { "format": "x" }, "data": {} }),
            "Ce fichier n'est pas une sauvegarde Arkyo (format inconnu).",
        ),
        (
            json!({ "meta": { "format": "arkyo-backup", "version": 2 }, "data": {} }),
            "Version de sauvegarde non prise en charge (2).",
        ),
        (
            json!({ "meta": { "format": "arkyo-backup", "version": 1, "exportedAt": "x",
                              "sections": ["nope"] }, "data": {} }),
            "Fichier invalide : section inconnue « nope ».",
        ),
        (
            json!({ "meta": { "format": "arkyo-backup", "version": 1, "exportedAt": "x",
                              "sections": ["settings"] }, "data": { "settings": { "brands": 1 } } }),
            "Fichier invalide : « settings.brands » doit être une liste.",
        ),
    ];
    for (backup, msg) in cases {
        let r = c
            .req(
                "POST",
                RESTORE,
                Some(json!({ "modes": {}, "backup": backup })),
            )
            .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST);
        assert_eq!(r.body["error"], msg);
    }

    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r1','lecteur','Lecteur','{"settings":"read"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    add_user(&c.e.pool, "l@b.fr", "lecteur", false).await;
    let tok = login(&c.e.app, "l@b.fr").await;
    let r = call(
        &c.e.app,
        "POST",
        RESTORE,
        LOCAL,
        Some(&tok),
        Some(json!({ "modes": {}, "backup": {} })),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
}
