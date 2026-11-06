//! Settings referentials API (`/api/tenant/parametres/**`), Task 3 of phase 2.
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const BASE: &str = "/api/tenant/parametres";

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
        call(
            &self.e.app,
            method,
            &format!("{BASE}{path}"),
            LOCAL,
            Some(&self.tok),
            body,
        )
        .await
    }
}

async fn audit_count(pool: &SqlitePool, action: &str, id: &str) -> i64 {
    sqlx::query_scalar(r#"SELECT COUNT(*) FROM "AuditLog" WHERE "action" = ? AND "entityId" = ?"#)
        .bind(action)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn insert_equipment(pool: &SqlitePool, extra_col: &str, extra_val: &str) {
    let sql = format!(
        r#"INSERT INTO "TenantEquipment" ("id","name","createdById","createdAt","updatedAt","{extra_col}")
           VALUES (?, 'Eq', 'u', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)"#
    );
    sqlx::query(&sql)
        .bind(arkyo_server::ids::new_id())
        .bind(extra_val)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_cable(pool: &SqlitePool, col: &str, val: &str) {
    let sql = format!(
        r#"INSERT INTO "TenantCable" ("id","name","createdById","createdAt","updatedAt","{col}")
           VALUES (?, 'Cab', 'u', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)"#
    );
    sqlx::query(&sql)
        .bind(arkyo_server::ids::new_id())
        .bind(val)
        .execute(pool)
        .await
        .unwrap();
}

// ── permissions & validation ────────────────────────────────────────────────

#[tokio::test]
async fn get_requires_a_session() {
    let e = env().await;
    let r = call(&e.app, "GET", &format!("{BASE}/brands"), LOCAL, None, None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert_eq!(r.body, json!({"error": "Non authentifié"}));
}

#[tokio::test]
async fn technicien_cannot_write_settings_403() {
    let e = env().await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let tok = login(&e.app, "t@b.fr").await;
    // reads are open to any session
    let g = call(
        &e.app,
        "GET",
        &format!("{BASE}/brands"),
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(g.status, StatusCode::OK);
    for (m, p, b) in [
        ("POST", "/brands", Some(json!({"name": "X"}))),
        ("POST", "/connectors", Some(json!({"name": "X"}))),
        ("POST", "/cabling", Some(json!({"name": "X"}))),
        ("POST", "/categories/category", Some(json!({"name": "X"}))),
        ("POST", "/categories/type", Some(json!({"name": "X"}))),
        ("POST", "/dimensions/restore-arkyo", None),
        ("PATCH", "/brands/abc", Some(json!({"name": "X"}))),
        ("DELETE", "/brands/abc", None),
    ] {
        let r = call(&e.app, m, &format!("{BASE}{p}"), LOCAL, Some(&tok), b).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{m} {p}");
        assert_eq!(r.body, json!({"error": "Accès refusé"}));
    }
}

#[tokio::test]
async fn invalid_body_is_400_with_zod_flatten_shape() {
    let c = ctx().await;
    let r = c.req("POST", "/brands", Some(json!({"name": ""}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["error"]["fieldErrors"]["name"],
        json!(["Le nom est obligatoire"])
    );
    assert_eq!(r.body["error"]["formErrors"], json!([]));
    let r = c
        .req(
            "POST",
            "/brands",
            Some(json!({"name": "X", "website": "nope"})),
        )
        .await;
    assert_eq!(
        r.body["error"]["fieldErrors"]["website"],
        json!(["URL invalide"])
    );
    let r = c
        .req(
            "POST",
            "/categories/function",
            Some(json!({"key": "abc", "label": "L"})),
        )
        .await;
    assert_eq!(
        r.body["error"]["fieldErrors"]["key"],
        json!(["La clé doit être en majuscules, chiffres et tirets bas uniquement"])
    );
}

// ── brands ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn brands_list_create_rename_delete() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    let g = c.req("GET", "/brands", None).await;
    assert_eq!(g.status, StatusCode::OK);
    assert_eq!(g.body["arkyo"], json!([]));
    assert!(g.body["personal"].is_array());

    let r = c
        .req(
            "POST",
            "/brands",
            Some(json!({"name": "Zzz Brand", "website": "https://zzz.example", "logoUrl": "/uploads/a.png"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["name"], "Zzz Brand");
    assert_eq!(r.body["isActive"], true);
    assert!(r.body["createdAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(audit_count(&c.e.pool, "tenant_brand.create", &id).await, 1);
    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(
        ev,
        json!({"type":"update","entity":"tenant_parametres_brands","action":"create","id":id})
    );

    let g = c.req("GET", "/brands", None).await;
    assert!(g.body["personal"]
        .as_array()
        .unwrap()
        .iter()
        .any(|b| b["id"] == id));

    let p = c
        .req(
            "PATCH",
            &format!("/brands/{id}"),
            Some(json!({"name": "Zzz Renamed", "website": null})),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK);
    assert_eq!(p.body["name"], "Zzz Renamed");
    assert!(p.body["website"].is_null());
    assert_eq!(p.body["logoUrl"], "/uploads/a.png");
    assert_eq!(audit_count(&c.e.pool, "tenant_brand.update", &id).await, 1);

    let d = c.req("DELETE", &format!("/brands/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    assert_eq!(d.body, json!({"success": true}));
    assert_eq!(audit_count(&c.e.pool, "tenant_brand.delete", &id).await, 1);
    let d = c.req("DELETE", &format!("/brands/{id}"), None).await;
    assert_eq!(d.status, StatusCode::NOT_FOUND);
    assert_eq!(d.body, json!({"error": "Fabricant introuvable."}));
    let p = c
        .req(
            "PATCH",
            &format!("/brands/{id}"),
            Some(json!({"name": "A"})),
        )
        .await;
    assert_eq!(p.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn create_duplicate_brand_is_409() {
    let c = ctx().await;
    let a = c
        .req("POST", "/brands", Some(json!({"name": "Dup Brand"})))
        .await;
    assert_eq!(a.status, StatusCode::CREATED);
    let b = c
        .req("POST", "/brands", Some(json!({"name": "Dup Brand"})))
        .await;
    assert_eq!(b.status, StatusCode::CONFLICT);
    assert_eq!(
        b.body,
        json!({"error": "Un fabricant avec ce nom existe déjà dans votre espace."})
    );
    let b = c
        .req("POST", "/brands", Some(json!({"name": "dup brand"})))
        .await;
    assert_eq!(b.status, StatusCode::CONFLICT);
    assert_eq!(
        b.body,
        json!({"error": "Ce fabricant existe déjà dans le catalogue Arkyo."})
    );
    // renaming onto another brand
    let o = c
        .req("POST", "/brands", Some(json!({"name": "Other Brand"})))
        .await;
    let id = o.body["id"].as_str().unwrap();
    let p = c
        .req(
            "PATCH",
            &format!("/brands/{id}"),
            Some(json!({"name": "Dup Brand"})),
        )
        .await;
    assert_eq!(p.status, StatusCode::CONFLICT);
    // keeping its own name (only case changes) is fine
    let p = c
        .req(
            "PATCH",
            &format!("/brands/{id}"),
            Some(json!({"name": "OTHER BRAND"})),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK);
}

#[tokio::test]
async fn delete_brand_in_use_is_409() {
    let c = ctx().await;
    let b = c
        .req("POST", "/brands", Some(json!({"name": "Used Brand"})))
        .await;
    let id = b.body["id"].as_str().unwrap().to_string();
    insert_equipment(&c.e.pool, "brandId", &id).await;
    let d = c.req("DELETE", &format!("/brands/{id}"), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({
            "error": "Ce fabricant est utilisé par 1 item(s) du catalogue personnel et ne peut pas être supprimé.",
            "count": 1,
            "breakdown": {"equipment": 1, "cable": 0}
        })
    );
    sqlx::query(r#"UPDATE "TenantEquipment" SET "brandId" = NULL"#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    insert_cable(&c.e.pool, "brandId", &id).await;
    let d = c.req("DELETE", &format!("/brands/{id}"), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(d.body["breakdown"], json!({"equipment": 0, "cable": 1}));
    sqlx::query(r#"DELETE FROM "TenantCable""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    let d = c.req("DELETE", &format!("/brands/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
}

// ── connectors ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn create_duplicate_connector_is_409() {
    let c = ctx().await;
    let a = c
        .req("POST", "/connectors", Some(json!({"name": "Conn X"})))
        .await;
    assert_eq!(a.status, StatusCode::CREATED, "{:?}", a.body);
    let b = c
        .req("POST", "/connectors", Some(json!({"name": "Conn X"})))
        .await;
    assert_eq!(b.status, StatusCode::CONFLICT);
    assert_eq!(
        b.body,
        json!({"error": "Un type de connecteur avec ce nom existe déjà dans votre espace."})
    );
    let b = c
        .req("POST", "/connectors", Some(json!({"name": "conn x"})))
        .await;
    assert_eq!(
        b.body,
        json!({"error": "Ce connecteur existe déjà dans le catalogue Arkyo."})
    );
}

#[tokio::test]
async fn connectors_crud_and_derived_neutrik_d() {
    let c = ctx().await;
    let g = c.req("GET", "/connectors", None).await;
    assert_eq!(g.body["arkyo"], json!([]));
    let r = c
        .req(
            "POST",
            "/connectors",
            Some(json!({"name": "XLR test", "iconId": "xlr3", "versions": ["a", "b"], "functionIds": ["f1"], "hasNeutrikD": false})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED);
    assert_eq!(r.body["hasNeutrikD"], true);
    assert_eq!(r.body["versions"], json!(["a", "b"]));
    assert_eq!(r.body["functionIds"], json!(["f1"]));
    let id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(
        audit_count(&c.e.pool, "tenant_connector_type.create", &id).await,
        1
    );

    let p = c
        .req(
            "PATCH",
            &format!("/connectors/{id}"),
            Some(json!({"name": "XLR renamed", "iconId": null})),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK);
    assert_eq!(p.body["hasNeutrikD"], false);
    assert_eq!(p.body["name"], "XLR renamed");

    let g = c.req("GET", "/connectors", None).await;
    let item = g.body["personal"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == id)
        .unwrap();
    assert_eq!(item["hasNeutrikD"], false);

    let d = c.req("DELETE", &format!("/connectors/{id}"), None).await;
    assert_eq!(d.body, json!({"success": true}));
    let d = c.req("DELETE", &format!("/connectors/{id}"), None).await;
    assert_eq!(d.body, json!({"error": "Type de connecteur introuvable."}));
}

#[tokio::test]
async fn delete_connector_used_by_cable_is_409() {
    let c = ctx().await;
    let r = c
        .req("POST", "/connectors", Some(json!({"name": "Conn Used"})))
        .await;
    let id = r.body["id"].as_str().unwrap().to_string();
    insert_cable(&c.e.pool, "leftConnectorId", &id).await;
    let d = c.req("DELETE", &format!("/connectors/{id}"), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({
            "error": "Ce type de connecteur est utilisé par 1 cordon(s) du catalogue personnel et ne peut pas être supprimé.",
            "count": 1,
            "breakdown": {"cableLeft": 1, "cableRight": 0}
        })
    );
}

// ── signals ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn signals_crud() {
    let c = ctx().await;
    let r = c
        .req(
            "POST",
            "/signals",
            Some(json!({"name": "Sig T", "color": "#ff0000", "requiredImpedance": 75, "connectorIds": ["c1"], "isIp": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["isIp"], true);
    assert_eq!(r.body["connectorIds"], json!(["c1"]));
    assert_eq!(r.body["requiredImpedance"], 75.0);
    let id = r.body["id"].as_str().unwrap().to_string();
    let b = c
        .req("POST", "/signals", Some(json!({"name": "Sig T"})))
        .await;
    assert_eq!(b.status, StatusCode::CONFLICT);
    assert_eq!(
        b.body,
        json!({"error": "Un type de signal avec ce nom existe déjà dans votre espace."})
    );
    let b = c
        .req("POST", "/signals", Some(json!({"name": "SIG T"})))
        .await;
    assert_eq!(
        b.body,
        json!({"error": "Un signal portant ce nom existe déjà dans le catalogue Arkyo."})
    );
    let p = c
        .req(
            "PATCH",
            &format!("/signals/{id}"),
            Some(json!({"name": "Sig U", "requiredImpedance": -1})),
        )
        .await;
    assert_eq!(p.status, StatusCode::BAD_REQUEST);
    let p = c
        .req(
            "PATCH",
            &format!("/signals/{id}"),
            Some(json!({"name": "Sig U"})),
        )
        .await;
    assert_eq!(p.body["name"], "Sig U");
    let g = c.req("GET", "/signals", None).await;
    assert!(g.body["personal"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["id"] == id));
    assert_eq!(g.body["arkyo"], json!([]));
    // arkyo does not check usage before deleting a signal
    insert_equipment(&c.e.pool, "signalCapacities", r#"[{"signalName":"Sig U"}]"#).await;
    let d = c.req("DELETE", &format!("/signals/{id}"), None).await;
    assert_eq!(d.body, json!({"success": true}));
    let d = c.req("DELETE", &format!("/signals/{id}"), None).await;
    assert_eq!(d.body, json!({"error": "Type de signal introuvable."}));
}

// ── cabling & cable-models ──────────────────────────────────────────────────

#[tokio::test]
async fn cabling_crud_and_pair_uniqueness() {
    let c = ctx().await;
    let r = c
        .req(
            "POST",
            "/cabling",
            Some(json!({"name": "Cab M", "reference": "R1", "impedance": 75, "customFields": [{"a": 1}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["customFields"], json!([{"a": 1}]));
    assert_eq!(r.body["sortOrder"], 0);
    let id = r.body["id"].as_str().unwrap().to_string();
    let b = c
        .req(
            "POST",
            "/cabling",
            Some(json!({"name": "Cab M", "reference": "R1"})),
        )
        .await;
    assert_eq!(b.status, StatusCode::CONFLICT);
    assert_eq!(
        b.body,
        json!({"error": "Un modèle de câble avec ce nom et cette référence existe déjà dans votre espace."})
    );
    // same name, other reference: allowed
    let ok = c
        .req(
            "POST",
            "/cabling",
            Some(json!({"name": "Cab M", "reference": "R2"})),
        )
        .await;
    assert_eq!(ok.status, StatusCode::CREATED);
    let p = c
        .req(
            "PATCH",
            &format!("/cabling/{id}"),
            Some(json!({"diameterMm": 0})),
        )
        .await;
    assert_eq!(p.status, StatusCode::BAD_REQUEST);
    let p = c
        .req(
            "PATCH",
            &format!("/cabling/{id}"),
            Some(json!({"notes": "n", "imageUrl": "https://x/y.png"})),
        )
        .await;
    assert_eq!(p.body["notes"], "n");
    let g = c.req("GET", "/cabling", None).await;
    assert_eq!(g.body["arkyo"], json!([]));
    assert!(g.body["personal"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == id));
    let d = c.req("DELETE", &format!("/cabling/{id}"), None).await;
    assert_eq!(d.body, json!({"success": true}));
    let d = c.req("DELETE", &format!("/cabling/{id}"), None).await;
    assert_eq!(d.body, json!({"error": "Modèle de câble introuvable."}));
}

#[tokio::test]
async fn cable_models_scored_by_signal() {
    let c = ctx().await;
    let f = c
        .req(
            "POST",
            "/categories/function",
            Some(json!({"key": "ZFN", "label": "Zed fn", "color": "#112233"})),
        )
        .await;
    let fid = f.body["id"].as_str().unwrap().to_string();
    let br = c
        .req("POST", "/brands", Some(json!({"name": "CM Brand"})))
        .await;
    let bid = br.body["id"].as_str().unwrap().to_string();
    c.req(
        "POST",
        "/cabling",
        Some(json!({"name": "CM ok", "functionId": fid, "brandId": bid, "impedance": 75, "bandwidthMHz": 1000})),
    )
    .await;
    c.req(
        "POST",
        "/cabling",
        Some(json!({"name": "CM bad", "functionId": fid, "impedance": 50, "bandwidthMHz": 1000})),
    )
    .await;
    c.req(
        "POST",
        "/signals",
        Some(json!({"name": "Sig CM", "functionId": fid, "requiredImpedance": 75, "minBandwidthMHz": 500, "color": "#abcdef"})),
    )
    .await;
    c.req(
        "POST",
        "/connectors",
        Some(json!({"name": "Conn CM", "iconId": "bnc", "color": "#010203"})),
    )
    .await;
    let r = c
        .req(
            "GET",
            "/cable-models?signalName=Sig%20CM&leftConnector=Conn%20CM",
            None,
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let models = r.body["models"].as_array().unwrap();
    assert_eq!(models.len(), 2);
    let ok = models.iter().find(|m| m["name"] == "CM ok").unwrap();
    assert_eq!(ok["compatibility"], "match");
    assert_eq!(ok["brand"]["name"], "CM Brand");
    assert_eq!(
        ok["function"],
        json!({"id": fid, "label": "Zed fn", "color": "#112233"})
    );
    let bad = models.iter().find(|m| m["name"] == "CM bad").unwrap();
    assert_eq!(bad["compatibility"], "incompatible");
    assert_eq!(
        r.body["leftConnector"],
        json!({"name": "Conn CM", "iconId": "bnc", "color": "#010203"})
    );
    assert!(r.body["rightConnector"].is_null());
    assert_eq!(r.body["signal"]["name"], "Sig CM");
    assert_eq!(r.body["signal"]["requiredImpedance"], 75.0);
    let r = c.req("GET", "/cable-models", None).await;
    assert!(r.body["signal"].is_null());
    assert_eq!(r.body["models"][0]["compatibility"], "unknown");
}

// ── symbols ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn symbols_is_a_bare_array() {
    let c = ctx().await;
    let r = c.req("GET", "/symbols", None).await;
    assert_eq!(r.status, StatusCode::OK);
    let a = r.body.as_array().unwrap();
    assert!(!a.is_empty());
    let xlr = a.iter().find(|s| s["id"] == "xlr3").unwrap();
    assert_eq!(xlr["svgUrl"], "xlr3");
    assert_eq!(xlr["isBuiltin"], true);
    assert_eq!(xlr["hasD"], true);
    assert!(xlr["svgUrlD"].is_null());
}

/// arkyo:app/api/symbol-overrides: `{}` without a session; with one, the
/// built-in symbols whose drawing is replaced by an uploaded SVG, as
/// `{ [key]: { svg, svgD } }`. Never the key placeholder of the symbols list.
#[tokio::test]
async fn symbol_overrides_lists_only_real_builtin_overrides() {
    let c = ctx().await;
    let url = "/api/symbol-overrides";
    let anon = call(&c.e.app, "GET", url, LOCAL, None, None).await;
    assert_eq!(anon.status, StatusCode::OK);
    assert_eq!(anon.body, json!({}));
    let r = call(&c.e.app, "GET", url, LOCAL, Some(&c.tok), None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body, json!({}));
    for (key, svg, svg_d) in [
        ("xlr3", Some("/uploads/symbols/xlr.svg"), None),
        ("bnc", None, Some("/uploads/symbols/bnc-d.svg")),
        // the key placeholder is not an override
        ("rj45", Some("rj45"), None),
    ] {
        sqlx::query(r#"UPDATE "CatalogSymbol" SET "svgUrl" = ?, "svgUrlD" = ? WHERE "key" = ?"#)
            .bind(svg)
            .bind(svg_d)
            .bind(key)
            .execute(&c.e.pool)
            .await
            .unwrap();
    }
    sqlx::query(
        r#"INSERT INTO "CatalogSymbol" ("id","key","label","isBuiltin","svgUrl","sortOrder","createdAt","updatedAt")
           VALUES ('s1','perso','Perso',0,'/uploads/symbols/perso.svg',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    let r = call(&c.e.app, "GET", url, LOCAL, Some(&c.tok), None).await;
    assert_eq!(
        r.body,
        json!({
            "xlr3": { "svg": "/uploads/symbols/xlr.svg", "svgD": null },
            "bnc": { "svg": null, "svgD": "/uploads/symbols/bnc-d.svg" },
        })
    );
}

// ── categories ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn categories_get_shape_and_tree() {
    let c = ctx().await;
    let root = c
        .req(
            "POST",
            "/categories/category",
            Some(json!({"name": "Cat Root"})),
        )
        .await;
    assert_eq!(root.status, StatusCode::CREATED, "{:?}", root.body);
    let rid = root.body["id"].as_str().unwrap().to_string();
    let child = c
        .req(
            "POST",
            "/categories/category",
            Some(json!({"name": "Cat Child", "parentId": rid, "color": "#fff"})),
        )
        .await;
    assert_eq!(child.status, StatusCode::CREATED);
    let g = c.req("GET", "/categories", None).await;
    for k in ["categories", "functions", "phases", "types"] {
        assert_eq!(g.body[k]["arkyo"], json!([]), "{k}");
        assert!(g.body[k]["personal"].is_array(), "{k}");
    }
    let cats = g.body["categories"]["personal"].as_array().unwrap();
    let r = cats.iter().find(|x| x["id"] == rid).unwrap();
    assert_eq!(r["children"].as_array().unwrap().len(), 1);
    assert_eq!(r["children"][0]["name"], "Cat Child");
    // children are not listed at root level
    assert!(cats.iter().all(|x| x["name"] != "Cat Child"));
}

#[tokio::test]
async fn category_delete_guards() {
    let c = ctx().await;
    let root = c
        .req(
            "POST",
            "/categories/category",
            Some(json!({"name": "Cat A"})),
        )
        .await;
    let rid = root.body["id"].as_str().unwrap().to_string();
    let child = c
        .req(
            "POST",
            "/categories/category",
            Some(json!({"name": "Cat B", "parentId": rid})),
        )
        .await;
    let cid = child.body["id"].as_str().unwrap().to_string();
    let d = c
        .req("DELETE", &format!("/categories/category/{rid}"), None)
        .await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({
            "error": "Cette catégorie ne peut pas être supprimée car elle est référencée par 1 sous-catégorie(s) et 0 équipement(s) personnel(s).",
            "breakdown": {"children": 1, "equipment": 0}
        })
    );
    insert_equipment(&c.e.pool, "categoryId", &cid).await;
    let d = c
        .req("DELETE", &format!("/categories/category/{cid}"), None)
        .await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(d.body["breakdown"], json!({"children": 0, "equipment": 1}));
    sqlx::query(r#"DELETE FROM "TenantEquipment""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(
        c.req("DELETE", &format!("/categories/category/{cid}"), None)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        c.req("DELETE", &format!("/categories/category/{rid}"), None)
            .await
            .status,
        StatusCode::OK
    );
    let dup = c
        .req(
            "POST",
            "/categories/category",
            Some(json!({"name": "Cat A"})),
        )
        .await;
    assert_eq!(dup.status, StatusCode::CREATED);
    let dup = c
        .req(
            "POST",
            "/categories/category",
            Some(json!({"name": "Cat A"})),
        )
        .await;
    assert_eq!(dup.status, StatusCode::CONFLICT);
    assert_eq!(
        dup.body,
        json!({"error": "Une catégorie avec ce nom existe déjà dans votre espace."})
    );
}

#[tokio::test]
async fn functions_and_phases_crud_and_guards() {
    let c = ctx().await;
    let f = c
        .req(
            "POST",
            "/categories/function",
            Some(json!({"key": "FN_T", "label": "Fn T", "sortOrder": 5})),
        )
        .await;
    assert_eq!(f.status, StatusCode::CREATED, "{:?}", f.body);
    let fid = f.body["id"].as_str().unwrap().to_string();
    assert_eq!(
        audit_count(&c.e.pool, "tenant_function.create", &fid).await,
        1
    );
    let dup = c
        .req(
            "POST",
            "/categories/function",
            Some(json!({"key": "FN_T", "label": "Other label"})),
        )
        .await;
    assert_eq!(dup.status, StatusCode::CONFLICT);
    assert_eq!(
        dup.body,
        json!({"error": "Une fonction avec cette clé existe déjà dans votre espace."})
    );
    let dup = c
        .req(
            "POST",
            "/categories/function",
            Some(json!({"key": "FN_OTHER", "label": "fn t"})),
        )
        .await;
    assert_eq!(
        dup.body,
        json!({"error": "Cette fonction existe déjà dans le catalogue Arkyo (clé ou libellé)."})
    );
    let p = c
        .req(
            "PATCH",
            &format!("/categories/function/{fid}"),
            Some(json!({"label": "Fn T2", "color": null})),
        )
        .await;
    assert_eq!(p.body["label"], "Fn T2");

    // in use by a connector (JSON array), a signal, a type, a cable model
    let conn = c
        .req(
            "POST",
            "/connectors",
            Some(json!({"name": "Conn F", "functionIds": [fid]})),
        )
        .await;
    assert_eq!(conn.status, StatusCode::CREATED);
    let d = c
        .req("DELETE", &format!("/categories/function/{fid}"), None)
        .await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({
            "error": "Cette fonction est utilisée par 1 entité(s) et ne peut pas être supprimée.",
            "breakdown": {"types": 0, "signals": 0, "cableModels": 0, "connectors": 1}
        })
    );
    c.req(
        "DELETE",
        &format!("/connectors/{}", conn.body["id"].as_str().unwrap()),
        None,
    )
    .await;
    c.req(
        "POST",
        "/categories/type",
        Some(json!({"name": "Type F", "functionId": fid})),
    )
    .await;
    let d = c
        .req("DELETE", &format!("/categories/function/{fid}"), None)
        .await;
    assert_eq!(d.body["breakdown"]["types"], 1);
    sqlx::query(r#"DELETE FROM "TenantType""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    let d = c
        .req("DELETE", &format!("/categories/function/{fid}"), None)
        .await;
    assert_eq!(d.status, StatusCode::OK);
    let d = c
        .req("DELETE", &format!("/categories/function/{fid}"), None)
        .await;
    assert_eq!(d.body, json!({"error": "Fonction introuvable."}));

    // phases
    let ph = c
        .req(
            "POST",
            "/categories/phase",
            Some(json!({"key": "PH_T", "label": "Ph T"})),
        )
        .await;
    assert_eq!(ph.status, StatusCode::CREATED);
    let pid = ph.body["id"].as_str().unwrap().to_string();
    let dup = c
        .req(
            "POST",
            "/categories/phase",
            Some(json!({"key": "PH_X", "label": "PH T"})),
        )
        .await;
    assert_eq!(
        dup.body,
        json!({"error": "Cette phase existe déjà dans le catalogue Arkyo (clé ou libellé)."})
    );
    insert_equipment(&c.e.pool, "phaseIds", &format!("[\"{pid}\"]")).await;
    let d = c
        .req("DELETE", &format!("/categories/phase/{pid}"), None)
        .await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({
            "error": "Cette phase est utilisée par 1 équipement(s) personnel(s) et ne peut pas être supprimée.",
            "breakdown": {"equipment": 1}
        })
    );
    sqlx::query(r#"DELETE FROM "TenantEquipment""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(
        c.req("DELETE", &format!("/categories/phase/{pid}"), None)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        c.req("DELETE", &format!("/categories/phase/{pid}"), None)
            .await
            .body,
        json!({"error": "Phase introuvable."})
    );
}

#[tokio::test]
async fn type_hierarchy_depth_1_enforced() {
    let c = ctx().await;
    let f = c
        .req(
            "POST",
            "/categories/function",
            Some(json!({"key": "FN_H", "label": "Fn H"})),
        )
        .await;
    let fid = f.body["id"].as_str().unwrap().to_string();
    let root = c
        .req(
            "POST",
            "/categories/type",
            Some(json!({"name": "Root H", "functionId": fid})),
        )
        .await;
    assert_eq!(root.status, StatusCode::CREATED, "{:?}", root.body);
    let rid = root.body["id"].as_str().unwrap().to_string();
    // sub-type inherits the parent's function (own value ignored)
    let sub = c
        .req(
            "POST",
            "/categories/type",
            Some(json!({"name": "Sub H", "parentId": rid, "functionId": "ignored"})),
        )
        .await;
    assert_eq!(sub.status, StatusCode::CREATED);
    assert_eq!(sub.body["functionId"], fid);
    assert_eq!(sub.body["parentId"], rid);
    let sid = sub.body["id"].as_str().unwrap().to_string();
    // depth 2 refused
    let deep = c
        .req(
            "POST",
            "/categories/type",
            Some(json!({"name": "Deep H", "parentId": sid})),
        )
        .await;
    assert_eq!(deep.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        deep.body,
        json!({"error": "Un sous-type ne peut pas lui-même avoir de sous-type (profondeur 1 maximum)."})
    );
    // unknown parent
    let r = c
        .req(
            "POST",
            "/categories/type",
            Some(json!({"name": "Orphan", "parentId": "nope"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body, json!({"error": "Type parent introuvable."}));
    // a type with children cannot become a sub-type
    let other = c
        .req("POST", "/categories/type", Some(json!({"name": "Other H"})))
        .await;
    let oid = other.body["id"].as_str().unwrap().to_string();
    let p = c
        .req(
            "PATCH",
            &format!("/categories/type/{rid}"),
            Some(json!({"parentId": oid})),
        )
        .await;
    assert_eq!(p.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        p.body,
        json!({"error": "Ce type a des sous-types : il ne peut pas devenir lui-même un sous-type."})
    );
    // own parent
    let p = c
        .req(
            "PATCH",
            &format!("/categories/type/{rid}"),
            Some(json!({"parentId": rid})),
        )
        .await;
    assert_eq!(
        p.body,
        json!({"error": "Un type ne peut pas être son propre parent."})
    );
    // sibling duplicate (case and accent insensitive), same name under another parent is fine
    let dup = c
        .req(
            "POST",
            "/categories/type",
            Some(json!({"name": "sub h", "parentId": rid})),
        )
        .await;
    assert_eq!(dup.status, StatusCode::CONFLICT);
    assert_eq!(
        dup.body,
        json!({"error": "Un type avec ce nom existe déjà sous ce parent dans votre espace."})
    );
    let ok = c
        .req(
            "POST",
            "/categories/type",
            Some(json!({"name": "Sub H", "parentId": oid})),
        )
        .await;
    assert_eq!(ok.status, StatusCode::CREATED);
    let rootdup = c
        .req("POST", "/categories/type", Some(json!({"name": "ROOT H"})))
        .await;
    assert_eq!(rootdup.status, StatusCode::CONFLICT);
    // delete guards
    let d = c
        .req("DELETE", &format!("/categories/type/{rid}"), None)
        .await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({
            "error": "Ce type est utilisé par 0 équipement(s) personnel(s) et/ou 1 sous-type(s), et ne peut pas être supprimé.",
            "breakdown": {"equipment": 0, "children": 1}
        })
    );
    insert_equipment(&c.e.pool, "typeId", &sid).await;
    let d = c
        .req("DELETE", &format!("/categories/type/{sid}"), None)
        .await;
    assert_eq!(d.body["breakdown"], json!({"equipment": 1, "children": 0}));
    sqlx::query(r#"DELETE FROM "TenantEquipment""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(
        c.req("DELETE", &format!("/categories/type/{sid}"), None)
            .await
            .status,
        StatusCode::OK
    );
    // renaming a sub-type keeps its parent's function
    let p = c
        .req(
            "PATCH",
            &format!("/categories/type/{rid}"),
            Some(json!({"name": "Root H2"})),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK);
    assert_eq!(p.body["name"], "Root H2");
}

// ── dimensions ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn dimensions_crud() {
    let c = ctx().await;
    let r = c
        .req(
            "POST",
            "/dimensions",
            Some(json!({"category": "CABLE_LENGTH", "value": 123.5, "unit": "M"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["isReel"], false);
    let id = r.body["id"].as_str().unwrap().to_string();
    let dup = c
        .req(
            "POST",
            "/dimensions",
            Some(json!({"category": "CABLE_LENGTH", "value": 123.5, "unit": "M"})),
        )
        .await;
    assert_eq!(dup.status, StatusCode::CONFLICT);
    assert_eq!(
        dup.body,
        json!({"error": "Une dimension avec cette valeur existe déjà dans cette catégorie."})
    );
    let bad = c
        .req(
            "POST",
            "/dimensions",
            Some(json!({"category": "NOPE", "value": -1, "unit": "X"})),
        )
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        bad.body["error"]["fieldErrors"]["category"],
        json!(["Catégorie invalide. Valeurs acceptées : RACK_U, RACK_WIDTH, RACK_DEPTH, CABLE_SAFETY_DEPTH, CABLE_LENGTH, BEND_RADIUS"])
    );
    assert_eq!(
        bad.body["error"]["fieldErrors"]["value"],
        json!(["La valeur doit être positive"])
    );
    let p = c
        .req(
            "PATCH",
            &format!("/dimensions/{id}"),
            Some(json!({"isReel": true, "value": 124})),
        )
        .await;
    assert_eq!(p.body["isReel"], true);
    let g = c.req("GET", "/dimensions", None).await;
    assert!(g.body.as_array().unwrap().iter().any(|d| d["id"] == id));
    let d = c.req("DELETE", &format!("/dimensions/{id}"), None).await;
    assert_eq!(d.body, json!({"success": true}));
    let d = c.req("DELETE", &format!("/dimensions/{id}"), None).await;
    assert_eq!(d.body, json!({"error": "Preset de dimension introuvable."}));
}

#[tokio::test]
async fn restore_dimensions_recreates_builtins() {
    let c = ctx().await;
    let before = c
        .req("GET", "/dimensions", None)
        .await
        .body
        .as_array()
        .unwrap()
        .len();
    assert!(before > 0, "seeded");
    let mut rx = c.e.events.subscribe();
    sqlx::query(r#"DELETE FROM "TenantDimensionPreset""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(c.req("GET", "/dimensions", None).await.body, json!([]));
    let r = c.req("POST", "/dimensions/restore-arkyo", None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!({"restored": before}));
    assert_eq!(
        c.req("GET", "/dimensions", None)
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        before
    );
    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(
        ev,
        json!({"type":"update","entity":"tenant_parametres_dimensions","action":"restore","id":"bulk"})
    );
    assert_eq!(
        audit_count(
            &c.e.pool,
            "tenant_dimension_preset.restore_arkyo",
            "bulk_restore"
        )
        .await,
        1
    );
    // idempotent: nothing missing, nothing written
    let r = c.req("POST", "/dimensions/restore-arkyo", None).await;
    assert_eq!(r.body, json!({"restored": 0}));
    assert_eq!(
        audit_count(
            &c.e.pool,
            "tenant_dimension_preset.restore_arkyo",
            "bulk_restore"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn signals_are_guarded_by_design_write_like_arkyo() {
    let e = env().await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    add_user(&e.pool, "c@b.fr", "consultation", false).await;
    let t = login(&e.app, "t@b.fr").await;
    let c = login(&e.app, "c@b.fr").await;
    let url = format!("{BASE}/signals");
    let ok = call(
        &e.app,
        "POST",
        &url,
        LOCAL,
        Some(&t),
        Some(json!({"name": "Sig D"})),
    )
    .await;
    assert_eq!(ok.status, StatusCode::CREATED);
    let no = call(
        &e.app,
        "POST",
        &url,
        LOCAL,
        Some(&c),
        Some(json!({"name": "Sig E"})),
    )
    .await;
    assert_eq!(no.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cabling_null_reference_duplicates_are_409() {
    let c = ctx().await;
    let name: String = sqlx::query_scalar(
        r#"SELECT "name" FROM "TenantCableModel" WHERE "reference" IS NULL LIMIT 1"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    let r = c.req("POST", "/cabling", Some(json!({"name": name}))).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(
        r.body,
        json!({"error": "Un modèle de câble avec ce nom et cette référence existe déjà dans votre espace."})
    );
    let r = c
        .req(
            "POST",
            "/cabling",
            Some(json!({"name": name.to_uppercase() + "x"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED);
    let id = r.body["id"].as_str().unwrap().to_string();
    let p = c
        .req(
            "PATCH",
            &format!("/cabling/{id}"),
            Some(json!({"name": name})),
        )
        .await;
    assert_eq!(p.status, StatusCode::CONFLICT);
    let p = c
        .req(
            "PATCH",
            &format!("/cabling/{id}"),
            Some(json!({"name": name.to_lowercase()})),
        )
        .await;
    if name.to_lowercase() != name {
        assert_eq!(
            p.body,
            json!({"error": "Un modèle de câble avec ce nom existe déjà dans le catalogue Arkyo."})
        );
    }
}

#[tokio::test]
async fn duplicate_checks_are_unicode_aware() {
    let c = ctx().await;
    let a = c
        .req("POST", "/brands", Some(json!({"name": "Éclairage Zz"})))
        .await;
    assert_eq!(a.status, StatusCode::CREATED);
    let b = c
        .req("POST", "/brands", Some(json!({"name": "éclairage zz"})))
        .await;
    assert_eq!(b.status, StatusCode::CONFLICT);
    assert_eq!(
        b.body,
        json!({"error": "Ce fabricant existe déjà dans le catalogue Arkyo."})
    );
    let f = c
        .req(
            "POST",
            "/categories/function",
            Some(json!({"key": "FN_U1", "label": "Éclairage Fn"})),
        )
        .await;
    assert_eq!(f.status, StatusCode::CREATED);
    let f = c
        .req(
            "POST",
            "/categories/function",
            Some(json!({"key": "FN_U2", "label": "éclairage fn"})),
        )
        .await;
    assert_eq!(f.status, StatusCode::CONFLICT);
}
