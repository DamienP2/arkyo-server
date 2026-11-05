//! Equipment catalogue API (`/api/tenant/catalogue/{equipment,lookup,connectors}`),
//! Task 4 of phase 2.
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const BASE: &str = "/api/tenant/catalogue";

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
    async fn create(&self, body: Value) -> Value {
        let r = self.req("POST", "/equipment", Some(body)).await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body
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

async fn first_id(pool: &SqlitePool, table: &str) -> String {
    sqlx::query_scalar(&format!(
        r#"SELECT "id" FROM "{table}" WHERE "isActive" = 1 ORDER BY "id" LIMIT 1"#
    ))
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn list_shape_matches_arkyo() {
    let c = ctx().await;
    let brand = first_id(&c.e.pool, "TenantBrand").await;
    let ftype = first_id(&c.e.pool, "TenantType").await;
    let func = first_id(&c.e.pool, "TenantFunction").await;
    let cat = first_id(&c.e.pool, "TenantEquipmentCategory").await;
    let item = c
        .create(json!({
            "name": "Console X", "reference": "CX-1", "brandId": brand, "typeId": ftype,
            "categoryId": cat, "functionIds": [func], "heightU": 2,
        }))
        .await;
    let g = c.req("GET", "/equipment", None).await;
    assert_eq!(g.status, StatusCode::OK);
    assert_eq!(g.body["arkyo"], json!([]));
    let p = &g.body["personal"].as_array().unwrap()[0];
    assert_eq!(p["id"], item["id"]);
    assert_eq!(p["source"], "PERSONAL");
    assert_eq!(p["isAccessible"], true);
    assert_eq!(p["arkyoDrift"], false);
    assert_eq!(p["arkyoSourceGone"], false);
    assert_eq!(p["shadowsArkyo"], false);
    assert!(p["clonedFromArkyoId"].is_null());
    assert!(p["clonedFromArkyoVersion"].is_null());
    assert_eq!(p["brand"]["id"], brand);
    assert!(p["brand"]["name"].is_string());
    assert_eq!(p["equipmentCategory"]["id"], cat);
    assert_eq!(p["type"]["id"], ftype);
    assert!(p["type"]["name"].is_string());
    let f = &p["functions"].as_array().unwrap()[0];
    assert_eq!(f["id"], func);
    assert!(f["label"].is_string());
    assert!(f.get("color").is_some() && f.get("sortOrder").is_some());
    // columns come back typed like Prisma's JSON
    assert_eq!(p["isRackable"], true);
    assert_eq!(p["widthFraction"], "FULL");
    assert_eq!(p["connectors"], json!([]));
    assert_eq!(p["functionIds"], json!([func]));
    assert_eq!(p["heightU"], 2);

    // search + isActive filter
    let q = c.req("GET", "/equipment?q=cx-1", None).await;
    assert_eq!(q.body["personal"].as_array().unwrap().len(), 1);
    let q = c.req("GET", "/equipment?q=zzz", None).await;
    assert_eq!(q.body["personal"], json!([]));
    let id = item["id"].as_str().unwrap();
    c.req(
        "PATCH",
        &format!("/equipment/{id}"),
        Some(json!({"isActive": false})),
    )
    .await;
    let g = c.req("GET", "/equipment", None).await;
    assert_eq!(g.body["personal"], json!([]));
    let g = c.req("GET", "/equipment?isActive=false", None).await;
    assert_eq!(g.body["personal"].as_array().unwrap().len(), 1);

    // detail
    let d = c.req("GET", &format!("/equipment/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    assert_eq!(d.body["source"], "PERSONAL");
    assert_eq!(d.body["isAccessible"], true);
    assert_eq!(d.body["item"]["id"], id);
    assert_eq!(d.body["item"]["brand"]["id"], brand);
    assert_eq!(d.body["item"]["type"]["id"], ftype);
    let d = c.req("GET", "/equipment/nope", None).await;
    assert_eq!(d.status, StatusCode::NOT_FOUND);
    assert_eq!(d.body, json!({"error": "Équipement introuvable"}));
}

#[tokio::test]
async fn create_patch_delete_roundtrip() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    let item = c
        .create(json!({
            "name": "Ampli", "weight": 12.5, "isRackable": false,
            "connectors": [{"name": "XLR"}], "tags": ["a"], "dmxModes": null,
        }))
        .await;
    let id = item["id"].as_str().unwrap().to_string();
    assert_eq!(item["isRackable"], false);
    assert_eq!(item["weight"], 12.5);
    assert_eq!(item["connectors"], json!([{"name": "XLR"}]));
    assert_eq!(item["dmxModes"], json!([]));
    assert_eq!(item["componentSlotSpan"], 1);
    assert_eq!(item["shadowsArkyo"], false);
    assert!(item["createdById"].is_string());
    assert_eq!(audit_count(&c.e.pool, "CREATE", &id).await, 1);
    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(
        ev,
        json!({"type":"update","entity":"tenant_catalogue","action":"created","id":id})
    );

    // PATCH never forks: 200 with the updated row
    let p = c
        .req(
            "PATCH",
            &format!("/equipment/{id}"),
            Some(json!({"name": "Ampli 2", "reference": "R", "heightU": 3, "tags": null})),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK, "{:?}", p.body);
    assert_eq!(p.body["id"], id);
    assert_eq!(p.body["name"], "Ampli 2");
    assert_eq!(p.body["heightU"], 3);
    assert_eq!(p.body["weight"], 12.5);
    assert_eq!(p.body["tags"], json!([]));
    assert_eq!(audit_count(&c.e.pool, "UPDATE", &id).await, 1);
    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(ev["action"], "updated");

    // category given by name resolves to categoryId
    let cat_name: String =
        sqlx::query_scalar(r#"SELECT "name" FROM "TenantEquipmentCategory" LIMIT 1"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    let cat_id: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "TenantEquipmentCategory" WHERE "name" = ?"#)
            .bind(&cat_name)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    let p = c
        .req(
            "PATCH",
            &format!("/equipment/{id}"),
            Some(json!({"category": cat_name})),
        )
        .await;
    assert_eq!(p.body["categoryId"], cat_id);

    // host and component are exclusive (on the resulting state)
    let r = c
        .req(
            "PATCH",
            &format!("/equipment/{id}"),
            Some(json!({"isComponentHost": true, "isComponent": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": "Un équipement ne peut pas être à la fois modulaire et composant."})
    );
    c.req(
        "PATCH",
        &format!("/equipment/{id}"),
        Some(json!({"isComponentHost": true})),
    )
    .await;
    let r = c
        .req(
            "PATCH",
            &format!("/equipment/{id}"),
            Some(json!({"isComponent": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c
        .req(
            "POST",
            "/equipment",
            Some(json!({"name": "X", "isComponentHost": true, "isComponent": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    // validation: Zod flatten shape
    let r = c.req("POST", "/equipment", Some(json!({"name": ""}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["error"]["fieldErrors"]["name"],
        json!(["Too small: expected string to have >=1 characters"])
    );
    let r = c
        .req(
            "POST",
            "/equipment",
            Some(json!({"name": "X", "heightU": 1.5, "hostSlotCount": 0, "connectors": "x"})),
        )
        .await;
    let fe = &r.body["error"]["fieldErrors"];
    assert_eq!(
        fe["heightU"],
        json!(["Invalid input: expected int, received number"])
    );
    assert_eq!(
        fe["hostSlotCount"],
        json!(["Too small: expected number to be >=1"])
    );
    assert_eq!(
        fe["connectors"],
        json!(["Invalid input: expected array, received string"])
    );

    // missing
    let r = c
        .req("PATCH", "/equipment/nope", Some(json!({"name": "Y"})))
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Équipement personnel introuvable"}));
    let r = c.req("DELETE", "/equipment/nope", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Équipement personnel introuvable"}));

    let d = c.req("DELETE", &format!("/equipment/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    assert_eq!(d.body, json!({"success": true}));
    assert_eq!(audit_count(&c.e.pool, "DELETE", &id).await, 1);
    let g = c.req("GET", &format!("/equipment/{id}"), None).await;
    assert_eq!(g.status, StatusCode::NOT_FOUND);
}

/// Stand-in for the phase-3 inventory tables arkyo checks before a delete.
async fn use_in_rack(pool: &SqlitePool, equipment_id: &str) {
    sqlx::query(r#"CREATE TABLE IF NOT EXISTS "RackSlot" ("id" TEXT PRIMARY KEY, "catalogEquipmentId" TEXT)"#)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(r#"INSERT INTO "RackSlot" ("id","catalogEquipmentId") VALUES (?, ?)"#)
        .bind(arkyo_server::ids::new_id())
        .bind(equipment_id)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn delete_in_use_is_409() {
    let c = ctx().await;
    let id = c.create(json!({"name": "Used"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    use_in_rack(&c.e.pool, &id).await;
    let d = c.req("DELETE", &format!("/equipment/{id}"), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({"error": "Utilisé dans 1 projet(s) — suppression impossible", "usageCount": 1})
    );
}

#[tokio::test]
async fn duplicate_names_copy() {
    let c = ctx().await;
    let src = c
        .create(json!({
            "name": "Mixeur", "reference": "M1", "heightU": 2, "connectors": [{"a": 1}],
            "functionIds": ["f1"], "isActive": true, "notes": "n",
        }))
        .await;
    let id = src["id"].as_str().unwrap();
    let r = c
        .req("POST", &format!("/equipment/{id}/duplicate"), None)
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_ne!(r.body["id"], src["id"]);
    assert_eq!(r.body["name"], "Mixeur (copie)");
    assert_eq!(r.body["reference"], "M1");
    assert_eq!(r.body["heightU"], 2);
    assert_eq!(r.body["connectors"], json!([{"a": 1}]));
    assert_eq!(r.body["functionIds"], json!(["f1"]));
    assert_eq!(r.body["notes"], "n");
    let new_id = r.body["id"].as_str().unwrap();
    assert_eq!(audit_count(&c.e.pool, "DUPLICATE", new_id).await, 1);
    let r = c.req("POST", "/equipment/nope/duplicate", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Équipement introuvable"}));
}

#[tokio::test]
async fn check_duplicate_by_name_ci() {
    let c = ctx().await;
    c.create(json!({"name": "Yamaha CL5", "reference": "CL5-X"}))
        .await;
    c.create(json!({"name": "Autre", "reference": "ZZ"})).await;
    let r = c
        .req("GET", "/equipment/check-duplicate?name=yamaha", None)
        .await;
    assert_eq!(r.status, StatusCode::OK);
    let m = r.body["matches"].as_array().unwrap();
    assert_eq!(m.len(), 1);
    assert_eq!(m[0]["name"], "Yamaha CL5");
    assert_eq!(m[0]["source"], "PERSONAL");
    assert_eq!(m[0]["matchField"], "name");
    let r = c
        .req(
            "GET",
            "/equipment/check-duplicate?name=yamaha&reference=cl5",
            None,
        )
        .await;
    assert_eq!(r.body["matches"][0]["matchField"], "both");
    let r = c
        .req("GET", "/equipment/check-duplicate?reference=zz", None)
        .await;
    assert_eq!(r.body["matches"][0]["matchField"], "reference");
    // too short: nothing
    let r = c
        .req("GET", "/equipment/check-duplicate?name=y", None)
        .await;
    assert_eq!(r.body, json!({"matches": []}));
    let r = c.req("GET", "/equipment/check-duplicate", None).await;
    assert_eq!(r.body, json!({"matches": []}));
}

#[tokio::test]
async fn bulk_delete_skips_in_use() {
    let c = ctx().await;
    let a = c.create(json!({"name": "A"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let b = c.create(json!({"name": "B"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    use_in_rack(&c.e.pool, &b).await;
    let r = c
        .req(
            "POST",
            "/equipment/bulk-delete",
            Some(json!({"ids": [a, b, "ghost"]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["deleted"], 1);
    let failed = r.body["failed"].as_array().unwrap();
    assert_eq!(failed.len(), 2);
    assert_eq!(failed[0]["id"], b);
    assert_eq!(
        failed[0]["reason"],
        "Utilisé dans 1 projet(s) — suppression impossible"
    );
    assert_eq!(failed[1]["id"], "ghost");
    assert_eq!(failed[1]["reason"], "Équipement personnel introuvable");
    assert_eq!(audit_count(&c.e.pool, "BULK_DELETE", "batch").await, 1);
    let left: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "TenantEquipment""#)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(left, 1);
    let r = c
        .req("POST", "/equipment/bulk-delete", Some(json!({"ids": []})))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["error"]["fieldErrors"]["ids"],
        json!(["Too small: expected array to have >=1 items"])
    );
}

#[tokio::test]
async fn restore_is_404() {
    let c = ctx().await;
    let id = c.create(json!({"name": "A"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let r = c
        .req("POST", &format!("/equipment/{id}/restore"), None)
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Aucune version Arkyo"}));
}

#[tokio::test]
async fn lookup_returns_all_referentials() {
    let c = ctx().await;
    let r = c.req("GET", "/lookup", None).await;
    assert_eq!(r.status, StatusCode::OK);
    for k in [
        "categories",
        "brands",
        "connectorTypes",
        "signals",
        "functions",
        "phases",
        "types",
        "cableModels",
    ] {
        let a = r.body[k].as_array().unwrap_or_else(|| panic!("{k}"));
        assert!(!a.is_empty(), "{k} empty");
    }
    assert!(r.body["categories"][0]["children"].is_array());
    let t = &r.body["types"][0];
    assert_eq!(t["source"], "PERSONAL");
    for k in ["id", "name", "functionId", "parentId"] {
        assert!(t.get(k).is_some(), "{k}");
    }
    let ct = &r.body["connectorTypes"][0];
    assert_eq!(ct["source"], "PERSONAL");
    assert!(ct["functions"].is_array());
    assert!(ct["hasNeutrikD"].is_boolean());
    assert!(ct.get("dTypeSvgUrl").is_some());
    let cm = &r.body["cableModels"][0];
    assert_eq!(cm["source"], "PERSONAL");
    assert!(cm.get("brandName").is_some());

    // POST: batch lookup
    let eq = c.create(json!({"name": "E"})).await;
    let id = eq["id"].as_str().unwrap();
    let r = c
        .req(
            "POST",
            "/lookup",
            Some(json!({"kind": "equipment", "ids": [id, "ghost"]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["kind"], "equipment");
    let items = r.body["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["source"], "PERSONAL");
    assert!(items[0]["category"].is_null());
    let cid = first_id(&c.e.pool, "TenantConnectorType").await;
    let r = c
        .req(
            "POST",
            "/lookup",
            Some(json!({"kind": "connector", "ids": [cid]})),
        )
        .await;
    assert_eq!(r.body["items"].as_array().unwrap().len(), 1);
    let r = c
        .req(
            "POST",
            "/lookup",
            Some(json!({"kind": "adapter", "ids": ["x"]})),
        )
        .await;
    assert_eq!(r.body, json!({"kind": "adapter", "items": []}));
    let r = c
        .req("POST", "/lookup", Some(json!({"kind": "nope", "ids": []})))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body["error"], "Validation invalide");
    assert!(r.body["issues"]["fieldErrors"]["kind"].is_array());
    assert!(r.body["issues"]["fieldErrors"]["ids"].is_array());
}

#[tokio::test]
async fn connectors_has_neutrik_d() {
    let c = ctx().await;
    let r = c.req("GET", "/connectors", None).await;
    assert_eq!(r.status, StatusCode::OK);
    let all = r.body.as_array().unwrap();
    assert!(!all.is_empty());
    assert!(all.iter().all(|x| x["hasNeutrikD"].is_boolean()));
    assert!(all.iter().all(|x| x["functions"].is_array()));
    // a connector on a D-capable builtin symbol, and one without a symbol
    let mk = |name: &str, icon: Value| json!({"name": name, "iconId": icon});
    let a = call(
        &c.e.app,
        "POST",
        "/api/tenant/parametres/connectors",
        LOCAL,
        Some(&c.tok),
        Some(mk("Zz XLR test", json!("xlr3"))),
    )
    .await;
    assert_eq!(a.status, StatusCode::CREATED, "{:?}", a.body);
    let b = call(
        &c.e.app,
        "POST",
        "/api/tenant/parametres/connectors",
        LOCAL,
        Some(&c.tok),
        Some(mk("Zz Plain test", Value::Null)),
    )
    .await;
    assert_eq!(b.status, StatusCode::CREATED);
    let r = c.req("GET", "/connectors?q=zz%20", None).await;
    let items = r.body.as_array().unwrap();
    assert_eq!(items.len(), 2);
    let find = |n: &str| items.iter().find(|x| x["name"] == n).unwrap();
    assert_eq!(find("Zz XLR test")["hasNeutrikD"], true);
    assert_eq!(find("Zz Plain test")["hasNeutrikD"], false);
    // by ids
    let id = a.body["id"].as_str().unwrap();
    let r = c.req("GET", &format!("/connectors?ids={id}"), None).await;
    assert_eq!(r.body.as_array().unwrap().len(), 1);
    assert_eq!(r.body[0]["hasNeutrikD"], true);
}

#[tokio::test]
async fn consultation_cannot_write_403() {
    let e = env().await;
    add_user(&e.pool, "c@b.fr", "consultation", false).await;
    let tok = login(&e.app, "c@b.fr").await;
    let g = call(
        &e.app,
        "GET",
        &format!("{BASE}/equipment"),
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(g.status, StatusCode::OK);
    for (m, p, b) in [
        ("POST", "/equipment", Some(json!({"name": "X"}))),
        ("PATCH", "/equipment/abc", Some(json!({"name": "X"}))),
        ("DELETE", "/equipment/abc", None),
        ("POST", "/equipment/abc/duplicate", None),
        ("POST", "/equipment/abc/restore", None),
        (
            "POST",
            "/equipment/bulk-delete",
            Some(json!({"ids": ["a"]})),
        ),
    ] {
        let r = call(&e.app, m, &format!("{BASE}{p}"), LOCAL, Some(&tok), b).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{m} {p}");
        assert_eq!(
            r.body,
            json!({"code": "INSUFFICIENT_PERMISSION", "domain": "catalog", "minLevel": "write"})
        );
    }
    let r = call(
        &e.app,
        "GET",
        &format!("{BASE}/equipment"),
        LOCAL,
        None,
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}
