//! Print, numbering, application settings and purge (Task 6 of phase 2).
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

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
}

const PRINT: &str = "/api/tenant/parametres/print";
const NUMBERING: &str = "/api/tenant/parametres/numbering";
const APPLICATION: &str = "/api/tenant/parametres/application";

async fn count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!(r#"SELECT COUNT(*) FROM "{table}""#))
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn audit_count(pool: &SqlitePool, action: &str, id: &str) -> i64 {
    sqlx::query_scalar(r#"SELECT COUNT(*) FROM "AuditLog" WHERE "action" = ? AND "entityId" = ?"#)
        .bind(action)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn next_event(rx: &mut tokio::sync::broadcast::Receiver<String>) -> Value {
    serde_json::from_str(&rx.recv().await.unwrap()).unwrap()
}

/// A non-owner role holding `level` on settings only.
async fn role_user(e: &Env, level: &str) -> String {
    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r1','custom','Custom',?, '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .bind(json!({ "settings": level }).to_string())
    .execute(&e.pool)
    .await
    .unwrap();
    add_user(&e.pool, "c@b.fr", "custom", false).await;
    login(&e.app, "c@b.fr").await
}

// ── numbering / application / admin config ──────────────────────────────────

#[tokio::test]
async fn numbering_allowlist_and_delete() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    let r = c
        .req(
            "PATCH",
            NUMBERING,
            Some(json!({
                "cable_pad": "3",
                "cable_sep1": "-",
                "cable_numbering_pad": 4,
                "evil_key": "x",
                "seeds.applied": "[]"
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type":"update","entity":"config","action":"updated"})
    );
    let g = c.req("GET", NUMBERING, None).await;
    assert_eq!(
        g.body,
        json!({"cable_pad": "3", "cable_sep1": "-", "cable_numbering_pad": "4"})
    );
    // unknown keys are skipped, not stored
    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "AppConfig" WHERE "key" = 'evil_key'"#)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    // update and delete
    c.req(
        "PATCH",
        NUMBERING,
        Some(json!({"cable_pad": "5", "cable_sep1": "__DELETE__"})),
    )
    .await;
    let g = c.req("GET", NUMBERING, None).await;
    assert_eq!(
        g.body,
        json!({"cable_pad": "5", "cable_numbering_pad": "4"})
    );
}

#[tokio::test]
async fn application_and_admin_config_share_app_config() {
    let c = ctx().await;
    let r = c
        .req(
            "PATCH",
            APPLICATION,
            Some(json!({"site_name": "Salle A", "cable_pad": "2"})),
        )
        .await;
    assert_eq!(r.body, json!({"ok": true}));
    let g = c.req("GET", APPLICATION, None).await;
    assert_eq!(g.body["site_name"], "Salle A");
    assert_eq!(g.body["cable_pad"], "2");
    assert!(
        g.body.get("seeds.applied").is_none(),
        "internal marker hidden"
    );
    let a = c.req("GET", "/api/admin/config", None).await;
    assert_eq!(a.body, g.body);
    // admin/config accepts any key, and "__DELETE__"
    let r = c
        .req(
            "PATCH",
            "/api/admin/config",
            Some(json!({"site_name": "__DELETE__", "other": "1"})),
        )
        .await;
    assert_eq!(r.body, json!({"ok": true}));
    let g = c.req("GET", APPLICATION, None).await;
    assert!(g.body.get("site_name").is_none());
    assert_eq!(g.body["other"], "1");
    // the seed marker cannot be overwritten
    c.req("PATCH", APPLICATION, Some(json!({"seeds.applied": "[]"})))
        .await;
    let marker: String =
        sqlx::query_scalar(r#"SELECT "value" FROM "AppConfig" WHERE "key" = 'seeds.applied'"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_ne!(marker, "[]");
}

/// Final review, Important 5: `site.name` / `site.logoUrl` are owner-only
/// (espace route, `Kind::Asset` check). The generic config writers skip
/// them, even for an admin; reading them still works.
#[tokio::test]
async fn site_keys_are_not_writable_through_generic_config() {
    let e = env().await;
    let tok = role_user(&e, "admin").await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let owner = login(&e.app, "o@b.fr").await;
    let r = call(
        &e.app,
        "PATCH",
        "/api/tenant/espace/informations",
        LOCAL,
        Some(&owner),
        Some(json!({"name": "Régie", "logoUrl": "/uploads/logo.png"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    for url in [APPLICATION, "/api/admin/config"] {
        let w = call(
            &e.app,
            "PATCH",
            url,
            LOCAL,
            Some(&tok),
            Some(json!({"site.name": "X", "site.logoUrl": "http://ailleurs/pixel.png", "autre": "1"})),
        )
        .await;
        assert_eq!(w.status, StatusCode::OK, "{url}");
        let w = call(
            &e.app,
            "PATCH",
            url,
            LOCAL,
            Some(&tok),
            Some(json!({"site.logoUrl": "__DELETE__"})),
        )
        .await;
        assert_eq!(w.status, StatusCode::OK, "{url}");
    }
    let site = call(&e.app, "GET", "/api/site", LOCAL, Some(&tok), None).await;
    assert_eq!(
        site.body,
        json!({"name": "Régie", "logoUrl": "/uploads/logo.png", "interface": "classique"})
    );
    let g = call(&e.app, "GET", APPLICATION, LOCAL, Some(&tok), None).await;
    assert_eq!(g.body["site.name"], "Régie");
    assert_eq!(g.body["autre"], "1");
}

#[tokio::test]
async fn settings_permissions() {
    let e = env().await;
    let tok = role_user(&e, "write").await;
    let g = call(&e.app, "GET", NUMBERING, LOCAL, Some(&tok), None).await;
    assert_eq!(g.status, StatusCode::OK);
    let w = call(
        &e.app,
        "PATCH",
        NUMBERING,
        LOCAL,
        Some(&tok),
        Some(json!({"cable_pad": "1"})),
    )
    .await;
    assert_eq!(w.status, StatusCode::OK);
    let w = call(
        &e.app,
        "PATCH",
        APPLICATION,
        LOCAL,
        Some(&tok),
        Some(json!({"a": "1"})),
    )
    .await;
    assert_eq!(w.status, StatusCode::OK);
    // admin/config needs settings:admin
    let w = call(
        &e.app,
        "PATCH",
        "/api/admin/config",
        LOCAL,
        Some(&tok),
        Some(json!({"a": "1"})),
    )
    .await;
    assert_eq!(w.status, StatusCode::FORBIDDEN);
    assert_eq!(w.body, json!({"error": "Accès refusé"}));
    let none = call(&e.app, "GET", NUMBERING, LOCAL, None, None).await;
    assert_eq!(none.status, StatusCode::UNAUTHORIZED);
}

// ── print templates ─────────────────────────────────────────────────────────

#[tokio::test]
async fn print_template_crud_and_restore() {
    let c = ctx().await;
    let g = c.req("GET", PRINT, None).await;
    assert_eq!(g.status, StatusCode::OK);
    let seeded = g.body["templates"].as_array().unwrap().len();
    assert!(seeded > 0);
    assert_eq!(g.body["settings"]["key"], "default");
    assert!(g.body["settings"]["pdfOptions"].is_object());

    let mut rx = c.e.events.subscribe();
    let r = c
        .req(
            "POST",
            PRINT,
            Some(json!({
                "key": "MON_CARTOUCHE",
                "name": "Mon cartouche",
                "slots": [{"key": "a", "label": "A", "type": "TEXT"}]
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["paperFormat"], "A4");
    assert_eq!(r.body["orientation"], "PORTRAIT");
    assert_eq!(r.body["isActive"], true);
    assert_eq!(r.body["layout"], Value::Null);
    assert_eq!(r.body["slots"][0]["label"], "A");
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type":"update","entity":"tenant_parametres_print","action":"create","id":id})
    );
    assert_eq!(
        audit_count(&c.e.pool, "tenant_print_template.create", &id).await,
        1
    );

    // duplicate key, bad key
    let d = c
        .req(
            "POST",
            PRINT,
            Some(json!({"key": "MON_CARTOUCHE", "name": "X"})),
        )
        .await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({"error": "Un template avec cette clé existe déjà dans votre espace."})
    );
    let b = c
        .req("POST", PRINT, Some(json!({"key": "bad key", "name": ""})))
        .await;
    assert_eq!(b.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        b.body["error"]["fieldErrors"]["key"],
        json!(["Lettres majuscules, chiffres ou underscore uniquement"])
    );
    assert_eq!(
        b.body["error"]["fieldErrors"]["name"],
        json!(["Le nom est obligatoire"])
    );
    let b = c
        .req(
            "POST",
            PRINT,
            Some(json!({"key": "K", "name": "N", "slots": [{"key": "a"}]})),
        )
        .await;
    assert_eq!(b.status, StatusCode::BAD_REQUEST);
    assert!(b.body["error"]["fieldErrors"]["slots"].is_array());

    // patch
    let p = c
        .req(
            "PATCH",
            &format!("{PRINT}/templates/{id}"),
            Some(
                json!({"name": "Renommé", "layout": {"x": 1}, "isActive": false, "key": "IGNORED"}),
            ),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK);
    assert_eq!(p.body["name"], "Renommé");
    assert_eq!(p.body["key"], "MON_CARTOUCHE");
    assert_eq!(p.body["layout"], json!({"x": 1}));
    assert_eq!(p.body["isActive"], false);
    // inactive templates leave the list
    let g = c.req("GET", PRINT, None).await;
    assert_eq!(g.body["templates"].as_array().unwrap().len(), seeded);
    let p = c
        .req(
            "PATCH",
            &format!("{PRINT}/templates/{id}"),
            Some(json!({"layout": null})),
        )
        .await;
    assert_eq!(p.body["layout"], Value::Null);
    let p = c
        .req("PATCH", &format!("{PRINT}/templates/nope"), Some(json!({})))
        .await;
    assert_eq!(p.status, StatusCode::NOT_FOUND);
    assert_eq!(p.body, json!({"error": "Template introuvable."}));

    // delete
    let d = c
        .req("DELETE", &format!("{PRINT}/templates/{id}"), None)
        .await;
    assert_eq!(d.body, json!({"success": true}));
    let d = c
        .req("DELETE", &format!("{PRINT}/templates/{id}"), None)
        .await;
    assert_eq!(d.status, StatusCode::NOT_FOUND);

    // restore the seeded ones
    sqlx::query(r#"DELETE FROM "TenantPrintTemplate""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    let r = c
        .req("POST", &format!("{PRINT}/templates/restore-arkyo"), None)
        .await;
    assert_eq!(r.body, json!({"restored": seeded}));
    assert_eq!(
        audit_count(
            &c.e.pool,
            "tenant_print_template.restore_arkyo",
            "bulk_restore"
        )
        .await,
        1
    );
    let r = c
        .req("POST", &format!("{PRINT}/templates/restore-arkyo"), None)
        .await;
    assert_eq!(r.body, json!({"restored": 0}));
    assert_eq!(
        count(&c.e.pool, "TenantPrintTemplate").await as usize,
        seeded
    );
}

// ── label stocks ────────────────────────────────────────────────────────────

fn stock_body() -> Value {
    json!({
        "name": "Planche test", "reference": "REF1",
        "paperFormat": "A4", "orientation": "PORTRAIT",
        "pageMarginTop": 5, "pageMarginRight": 5, "pageMarginBottom": 5, "pageMarginLeft": 5,
        "columns": 2, "rows": 10, "gutterX": 1, "gutterY": 1,
        "labelWidth": 50.5, "labelHeight": 20
    })
}

#[tokio::test]
async fn label_stock_crud() {
    let c = ctx().await;
    let base = format!("{PRINT}/label-stocks");
    let g = c.req("GET", &base, None).await;
    let seeded = g.body.as_array().unwrap().len();
    assert!(seeded > 0);
    let mut rx = c.e.events.subscribe();
    let r = c.req("POST", &base, Some(stock_body())).await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["labelWidth"], 50.5);
    assert_eq!(r.body["isActive"], true);
    assert_eq!(r.body["brandId"], Value::Null);
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type":"update","entity":"tenant_parametres_print_labels","action":"create","id":id})
    );
    assert_eq!(
        audit_count(&c.e.pool, "tenant_cable_label_stock.create", &id).await,
        1
    );
    let d = c.req("POST", &base, Some(stock_body())).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({"error": "Une planche avec ce nom et cette référence existe déjà dans votre espace."})
    );
    let b = c
        .req(
            "POST",
            &base,
            Some(json!({"name": "X", "columns": 0, "labelWidth": 0})),
        )
        .await;
    assert_eq!(b.status, StatusCode::BAD_REQUEST);
    let fe = &b.body["error"]["fieldErrors"];
    assert_eq!(
        fe["columns"],
        json!(["Too small: expected number to be >=1"])
    );
    assert_eq!(
        fe["labelWidth"],
        json!(["Too small: expected number to be >0"])
    );
    assert!(fe["paperFormat"].is_array());

    let p = c
        .req(
            "PATCH",
            &format!("{base}/{id}"),
            Some(json!({"rows": 12, "printableColor": "#fff", "reference": null})),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK);
    assert_eq!(p.body["rows"], 12);
    assert_eq!(p.body["reference"], Value::Null);
    assert_eq!(
        audit_count(&c.e.pool, "tenant_cable_label_stock.update", &id).await,
        1
    );
    let p = c
        .req("PATCH", &format!("{base}/nope"), Some(json!({})))
        .await;
    assert_eq!(p.status, StatusCode::NOT_FOUND);
    assert_eq!(p.body, json!({"error": "Planche introuvable."}));
    let g = c.req("GET", &base, None).await;
    assert_eq!(g.body.as_array().unwrap().len(), seeded + 1);

    let d = c.req("DELETE", &format!("{base}/{id}"), None).await;
    assert_eq!(d.body, json!({"success": true}));
    let d = c.req("DELETE", &format!("{base}/{id}"), None).await;
    assert_eq!(d.status, StatusCode::NOT_FOUND);

    sqlx::query(r#"DELETE FROM "TenantCableLabelStock""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    let r = c.req("POST", &format!("{base}/restore-arkyo"), None).await;
    assert_eq!(r.body, json!({"restored": seeded}));
    let r = c.req("POST", &format!("{base}/restore-arkyo"), None).await;
    assert_eq!(r.body, json!({"restored": 0}));
}

// ── export models ───────────────────────────────────────────────────────────

#[tokio::test]
async fn export_model_pages_crud() {
    let c = ctx().await;
    let base = format!("{PRINT}/export-models");
    assert_eq!(c.req("GET", &base, None).await.body, json!([]));
    let mut rx = c.e.events.subscribe();
    let r = c
        .req("POST", &base, Some(json!({"name": "Mon modèle é"})))
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["key"], "MON_MOD_LE");
    let kinds: Vec<&str> = r.body["pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["BACK", "COVER", "INTERIOR"]);
    assert_eq!(r.body["pages"][0]["layout"], Value::Null);
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type":"update","entity":"tenant_parametres_print","action":"create","id":id})
    );
    assert_eq!(
        audit_count(&c.e.pool, "tenant_print_export_model.create", &id).await,
        1
    );
    let d = c
        .req(
            "POST",
            &base,
            Some(json!({"name": "Autre", "key": "MON_MOD_LE"})),
        )
        .await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({"error": "La clé \"MON_MOD_LE\" est déjà utilisée."})
    );
    let b = c
        .req("POST", &base, Some(json!({"name": "A", "key": "bad"})))
        .await;
    assert_eq!(b.status, StatusCode::BAD_REQUEST);

    let g = c.req("GET", &format!("{base}/{id}"), None).await;
    assert_eq!(g.body["pages"].as_array().unwrap().len(), 3);
    let g = c.req("GET", &format!("{base}/nope"), None).await;
    assert_eq!(g.status, StatusCode::NOT_FOUND);
    assert_eq!(g.body, json!({"error": "Modèle introuvable."}));

    let p = c
        .req(
            "PATCH",
            &format!("{base}/{id}"),
            Some(json!({"name": "Renommé", "description": "d", "key": "NOPE"})),
        )
        .await;
    assert_eq!(p.body["name"], "Renommé");
    assert_eq!(p.body["key"], "MON_MOD_LE");
    assert_eq!(p.body["pages"].as_array().unwrap().len(), 3);

    // page layout
    let page_id = p.body["pages"][1]["id"].as_str().unwrap().to_string();
    let pp = c
        .req(
            "PATCH",
            &format!("{base}/{id}/pages/{page_id}"),
            Some(json!({"layout": {"a": [1, 2]}, "name": "ignored", "slots": []})),
        )
        .await;
    assert_eq!(pp.status, StatusCode::OK, "{:?}", pp.body);
    assert_eq!(pp.body["layout"], json!({"a": [1, 2]}));
    assert_eq!(pp.body["kind"], "COVER");
    assert_eq!(
        audit_count(&c.e.pool, "tenant_print_export_page.update", &page_id).await,
        1
    );
    let pp = c
        .req(
            "PATCH",
            &format!("{base}/{id}/pages/{page_id}"),
            Some(json!({"layout": null})),
        )
        .await;
    assert_eq!(pp.body["layout"], Value::Null);
    let pp = c
        .req("PATCH", &format!("{base}/{id}/pages/nope"), Some(json!({})))
        .await;
    assert_eq!(pp.status, StatusCode::NOT_FOUND);
    assert_eq!(
        pp.body,
        json!({"error": "Page introuvable pour ce modèle."})
    );
    let pp = c
        .req(
            "PATCH",
            &format!("{base}/nope/pages/{page_id}"),
            Some(json!({})),
        )
        .await;
    assert_eq!(pp.body, json!({"error": "Modèle introuvable."}));

    // delete cascades
    let d = c.req("DELETE", &format!("{base}/{id}"), None).await;
    assert_eq!(d.body, json!({"success": true}));
    assert_eq!(count(&c.e.pool, "TenantPrintExportPage").await, 0);
    let d = c.req("DELETE", &format!("{base}/{id}"), None).await;
    assert_eq!(d.status, StatusCode::NOT_FOUND);

    // no built-in export model: nothing to restore
    let r = c.req("POST", &format!("{base}/restore-arkyo"), None).await;
    assert_eq!(r.body, json!({"restored": 0}));
}

// ── purge ───────────────────────────────────────────────────────────────────

const PURGE: &str = "/api/admin/purge";

async fn add_equipment(pool: &SqlitePool, id: &str) {
    sqlx::query(
        r#"INSERT INTO "TenantEquipment" ("id","name","createdById","createdAt","updatedAt")
           VALUES (?,'Eq','u','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn purge_single_target_deletes_only() {
    let c = ctx().await;
    assert!(count(&c.e.pool, "TenantBrand").await > 0);
    let types = count(&c.e.pool, "TenantType").await;
    add_equipment(&c.e.pool, "eq1").await;
    let bad = c.req("POST", PURGE, Some(json!({"target": "zzz"}))).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.body, json!({"error": "Cible inconnue"}));
    let bad = c.req("POST", PURGE, Some(json!({}))).await;
    assert_eq!(bad.body, json!({"error": "Cible inconnue"}));

    let r = c
        .req("POST", PURGE, Some(json!({"target": "brands"})))
        .await;
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(count(&c.e.pool, "TenantBrand").await, 0, "not reseeded");
    assert_eq!(count(&c.e.pool, "TenantEquipment").await, 1);
    assert_eq!(count(&c.e.pool, "TenantType").await, types);
    assert_eq!(audit_count(&c.e.pool, "admin.purge", "brands").await, 1);
    let r = c
        .req("POST", PURGE, Some(json!({"target": "equipment"})))
        .await;
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(count(&c.e.pool, "TenantEquipment").await, 0);
}

/// Final review, Important 4: the "symbols" target empties the custom
/// symbols only, like `all`; the built-in ones (no restore) stay.
#[tokio::test]
async fn purge_symbols_keeps_builtin_symbols() {
    let c = ctx().await;
    let builtin = || {
        let pool = c.e.pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                r#"SELECT COUNT(*) FROM "CatalogSymbol" WHERE "isBuiltin" = 1"#,
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let before = builtin().await;
    assert!(before > 0);
    sqlx::query(
        r#"INSERT INTO "CatalogSymbol" ("id","key","label","isBuiltin","svgUrl","sortOrder","createdAt","updatedAt")
           VALUES ('s1','perso','Perso',0,'/uploads/symbols/perso.svg',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    let r = c
        .req("POST", PURGE, Some(json!({"target": "symbols"})))
        .await;
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(builtin().await, before);
    assert_eq!(count(&c.e.pool, "CatalogSymbol").await, before);
}

#[tokio::test]
async fn purge_all_resets_listed_families_and_keeps_print_and_taxonomy() {
    let c = ctx().await;
    let brands = count(&c.e.pool, "TenantBrand").await;
    let connectors = count(&c.e.pool, "TenantConnectorType").await;
    let cables = count(&c.e.pool, "TenantCable").await;
    let templates = count(&c.e.pool, "TenantPrintTemplate").await;
    let functions = count(&c.e.pool, "TenantFunction").await;
    add_equipment(&c.e.pool, "eq1").await;
    c.req(
        "POST",
        "/api/tenant/parametres/brands",
        Some(json!({"name": "Ma marque"})),
    )
    .await;
    c.req(
        "POST",
        PRINT,
        Some(json!({"key": "PERSO", "name": "Perso"})),
    )
    .await;
    c.req(
        "POST",
        "/api/tenant/parametres/categories/function",
        Some(json!({"key": "MAFONCTION", "label": "Ma fonction"})),
    )
    .await;
    c.req("PATCH", NUMBERING, Some(json!({"cable_pad": "7"})))
        .await;
    sqlx::query(
        r#"INSERT INTO "CatalogSymbol" ("id","key","label","isBuiltin","createdAt","updatedAt")
           VALUES ('s1','perso','Perso',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    // a deleted seeded cord comes back; a deleted phase does not (kept family)
    sqlx::query(r#"DELETE FROM "TenantCable""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    sqlx::query(r#"DELETE FROM "TenantPhase""#)
        .execute(&c.e.pool)
        .await
        .unwrap();

    let r = c.req("POST", PURGE, Some(json!({"target": "all"}))).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(count(&c.e.pool, "TenantEquipment").await, 0);
    assert_eq!(count(&c.e.pool, "TenantBrand").await, brands);
    assert_eq!(count(&c.e.pool, "TenantConnectorType").await, connectors);
    assert_eq!(count(&c.e.pool, "TenantCable").await, cables);
    let one = |sql: &'static str| {
        let pool = c.e.pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(
        one(r#"SELECT COUNT(*) FROM "TenantBrand" WHERE "name"='Ma marque'"#).await,
        0
    );
    assert_eq!(
        one(r#"SELECT COUNT(*) FROM "CatalogSymbol" WHERE "id"='s1'"#).await,
        0
    );
    assert!(one(r#"SELECT COUNT(*) FROM "CatalogSymbol" WHERE "isBuiltin"=1"#).await > 0);
    // kept
    assert_eq!(count(&c.e.pool, "TenantPhase").await, 0);
    assert_eq!(count(&c.e.pool, "TenantPrintTemplate").await, templates + 1);
    assert_eq!(count(&c.e.pool, "TenantFunction").await, functions + 1);
    assert_eq!(count(&c.e.pool, "PrintSettings").await, 1);
    assert_eq!(
        c.req("GET", NUMBERING, None).await.body,
        json!({"cable_pad": "7"})
    );
    assert_eq!(audit_count(&c.e.pool, "admin.purge", "all").await, 1);
}

#[tokio::test]
async fn purge_publishes_family_events() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    c.req("POST", PURGE, Some(json!({"target": "brands"})))
        .await;
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type":"update","entity":"tenant_parametres_brands","action":"purge","id":"bulk"})
    );
    c.req("POST", PURGE, Some(json!({"target": "adapters"})))
        .await;
    let mut entities = vec![];
    for _ in 0..3 {
        entities.push(
            next_event(&mut rx).await["entity"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    assert!(entities.contains(&"tenant_catalogue".to_string()));
    c.req("POST", PURGE, Some(json!({"target": "all"}))).await;
    let mut seen = vec![];
    for _ in 0..7 {
        seen.push(
            next_event(&mut rx).await["entity"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    for want in [
        "tenant_catalogue",
        "tenant_parametres_brands",
        "tenant_parametres_categories",
        "tenant_parametres_connectors",
        "tenant_parametres_signals",
        "tenant_parametres_symbols",
    ] {
        assert!(seen.contains(&want.to_string()), "{want}");
    }
}

#[tokio::test]
async fn purge_requires_settings_admin() {
    let e = env().await;
    let tok = role_user(&e, "write").await;
    let r = call(
        &e.app,
        "POST",
        "/api/admin/purge",
        LOCAL,
        Some(&tok),
        Some(json!({"target": "all"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.body, json!({"error": "Accès refusé"}));
    let r = call(
        &e.app,
        "POST",
        "/api/admin/purge",
        LOCAL,
        None,
        Some(json!({"target": "all"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert!(count(&e.pool, "TenantBrand").await > 0);
}

#[tokio::test]
async fn print_writes_require_settings_write() {
    let e = env().await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let tok = login(&e.app, "t@b.fr").await;
    for (m, p, b) in [
        (
            "POST",
            PRINT.to_string(),
            Some(json!({"key": "A", "name": "A"})),
        ),
        ("PATCH", format!("{PRINT}/templates/x"), Some(json!({}))),
        ("DELETE", format!("{PRINT}/templates/x"), None),
        ("POST", format!("{PRINT}/templates/restore-arkyo"), None),
        ("POST", format!("{PRINT}/label-stocks"), Some(json!({}))),
        ("POST", format!("{PRINT}/label-stocks/restore-arkyo"), None),
        (
            "POST",
            format!("{PRINT}/export-models"),
            Some(json!({"name": "A"})),
        ),
        ("POST", format!("{PRINT}/export-models/restore-arkyo"), None),
        (
            "PATCH",
            format!("{PRINT}/export-models/x/pages/y"),
            Some(json!({})),
        ),
        ("PATCH", NUMBERING.to_string(), Some(json!({}))),
    ] {
        let r = call(&e.app, m, &p, LOCAL, Some(&tok), b).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{m} {p}");
    }
    for p in [
        PRINT.to_string(),
        format!("{PRINT}/label-stocks"),
        format!("{PRINT}/export-models"),
    ] {
        let r = call(&e.app, "GET", &p, LOCAL, Some(&tok), None).await;
        assert_eq!(r.status, StatusCode::OK, "{p}");
    }
}
