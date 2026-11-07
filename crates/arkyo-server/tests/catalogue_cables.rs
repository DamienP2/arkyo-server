//! Cable and adapter catalogue API (`/api/tenant/catalogue/{cables,adapters}`),
//! Task 5 of phase 2.
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
    async fn create(&self, kind: &str, body: Value) -> Value {
        let r = self.req("POST", &format!("/{kind}"), Some(body)).await;
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

fn find<'a>(list: &'a Value, name: &str) -> &'a Value {
    list["personal"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["name"] == name)
        .unwrap_or_else(|| panic!("{name} not in list"))
}

#[tokio::test]
async fn cable_list_resolves_connectors_brand_function() {
    let c = ctx().await;
    let brand = first_id(&c.e.pool, "TenantBrand").await;
    let func = first_id(&c.e.pool, "TenantFunction").await;
    let left = first_id(&c.e.pool, "TenantConnectorType").await;
    let right: String = sqlx::query_scalar(
        r#"SELECT "id" FROM "TenantConnectorType" WHERE "id" <> ? ORDER BY "id" LIMIT 1"#,
    )
    .bind(&left)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    let item = c
        .create(
            "cables",
            json!({
                "name": "Cordon Z", "reference": "CZ-1", "leftConnectorId": left, "leftGender": "MALE",
                "rightConnectorId": right, "rightGender": "FEMALE", "functionId": func,
                "brandId": brand, "availableLengths": [5, 1.5, 10], "useCases": ["INSTALLATION"],
            }),
        )
        .await;
    // the stored row, like Prisma's create
    assert_eq!(item["name"], "Cordon Z");
    assert_eq!(item["availableLengths"], json!([5, 1.5, 10]));
    assert_eq!(item["useCases"], json!(["INSTALLATION"]));
    assert_eq!(item["isActive"], true);
    assert_eq!(item["sortOrder"], 0);
    assert_eq!(item["shadowsArkyo"], false);
    assert!(item["createdById"].is_string());
    assert!(item.get("brand").is_none());

    let g = c.req("GET", "/cables?scope=all", None).await;
    assert_eq!(g.status, StatusCode::OK);
    assert_eq!(g.body["arkyo"], json!([]));
    let p = find(&g.body, "Cordon Z");
    assert_eq!(p["id"], item["id"]);
    assert_eq!(p["source"], "PERSONAL");
    assert_eq!(p["isAccessible"], true);
    assert_eq!(p["arkyoDrift"], false);
    assert_eq!(p["arkyoSourceGone"], false);
    assert_eq!(p["shadowsArkyo"], false);
    assert!(p["clonedFromArkyoId"].is_null());
    assert_eq!(p["brand"]["id"], brand);
    assert!(p["brand"]["name"].is_string());
    assert_eq!(p["function"]["id"], func);
    assert!(p["function"]["label"].is_string());
    assert_eq!(p["leftConnector"]["id"], left);
    assert!(p["leftConnector"]["name"].is_string());
    assert_eq!(p["rightConnector"]["id"], right);

    // search by name only, isActive filter
    let q = c.req("GET", "/cables?q=cordon%20z", None).await;
    assert_eq!(q.body["personal"].as_array().unwrap().len(), 1);
    let q = c.req("GET", "/cables?q=CZ-1", None).await;
    assert_eq!(q.body["personal"], json!([]));
    let id = item["id"].as_str().unwrap();
    c.req(
        "PATCH",
        &format!("/cables/{id}"),
        Some(json!({"isActive": false})),
    )
    .await;
    let g = c.req("GET", "/cables", None).await;
    assert!(g.body["personal"]
        .as_array()
        .unwrap()
        .iter()
        .all(|x| x["name"] != "Cordon Z"));
    let g = c.req("GET", "/cables?isActive=false", None).await;
    assert_eq!(g.body["personal"].as_array().unwrap().len(), 1);

    // unresolved ids give null, not an error
    let lone = c
        .create("cables", json!({"name": "Lone", "brandId": "ghost"}))
        .await;
    let g = c.req("GET", "/cables", None).await;
    let l = find(&g.body, "Lone");
    assert_eq!(l["id"], lone["id"]);
    assert!(l["brand"].is_null() && l["function"].is_null() && l["leftConnector"].is_null());
}

#[tokio::test]
async fn cable_list_is_ordered_by_sort_order_then_newest() {
    let c = ctx().await;
    sqlx::query(r#"DELETE FROM "TenantCable""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    c.create("cables", json!({"name": "B", "sortOrder": 2}))
        .await;
    c.create("cables", json!({"name": "A", "sortOrder": 1}))
        .await;
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    c.create("cables", json!({"name": "C", "sortOrder": 1}))
        .await;
    let g = c.req("GET", "/cables", None).await;
    let names: Vec<&str> = g.body["personal"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["C", "A", "B"]);
}

#[tokio::test]
async fn cable_kind_model_returns_cable_models() {
    let c = ctx().await;
    let r = c.req("GET", "/cables?kind=model", None).await;
    assert_eq!(r.status, StatusCode::OK);
    let models = r.body.as_array().unwrap();
    assert!(!models.is_empty());
    assert!(models.iter().all(|m| m["isActive"] == true));
    // a model with a brand carries it resolved
    let with_brand = models.iter().find(|m| m["brandId"].is_string()).unwrap();
    assert_eq!(with_brand["brand"]["id"], with_brand["brandId"]);
    assert!(with_brand["brand"]["name"].is_string());
    // ordered by sortOrder then name
    let keys: Vec<(i64, String)> = models
        .iter()
        .map(|m| {
            (
                m["sortOrder"].as_i64().unwrap(),
                m["name"].as_str().unwrap().to_lowercase(),
            )
        })
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(
        keys.iter().map(|k| k.0).collect::<Vec<_>>(),
        sorted.iter().map(|k| k.0).collect::<Vec<_>>()
    );
    // inactive models are hidden, q filters on the name
    let first = models[0]["name"].as_str().unwrap().to_string();
    let id = models[0]["id"].as_str().unwrap().to_string();
    let q = c
        .req(
            "GET",
            &format!(
                "/cables?kind=model&q={}",
                first.to_uppercase().replace(' ', "%20")
            ),
            None,
        )
        .await;
    assert!(q.body.as_array().unwrap().iter().any(|m| m["id"] == id));
    let q = c.req("GET", "/cables?kind=model&q=zzzzzz", None).await;
    assert_eq!(q.body, json!([]));
    sqlx::query(r#"UPDATE "TenantCableModel" SET "isActive" = 0 WHERE "id" = ?"#)
        .bind(&id)
        .execute(&c.e.pool)
        .await
        .unwrap();
    let r = c.req("GET", "/cables?kind=model", None).await;
    assert!(r.body.as_array().unwrap().iter().all(|m| m["id"] != id));
}

#[tokio::test]
async fn cable_lengths_are_the_sorted_union() {
    let c = ctx().await;
    sqlx::query(r#"DELETE FROM "TenantCable""#)
        .execute(&c.e.pool)
        .await
        .unwrap();
    let r = c.req("GET", "/cables/lengths", None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!([]));
    c.create(
        "cables",
        json!({"name": "A", "availableLengths": [10, 2.5, 5]}),
    )
    .await;
    // inactive cables count too (arkyo has no filter); zero is dropped
    c.create(
        "cables",
        json!({"name": "B", "availableLengths": [5, 1, 0], "isActive": false}),
    )
    .await;
    let r = c.req("GET", "/cables/lengths", None).await;
    assert_eq!(r.body, json!([1, 2.5, 5, 10]));
}

#[tokio::test]
async fn cable_create_patch_delete_roundtrip() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    let item = c
        .create("cables", json!({"name": "Cordon", "cableModelId": "m1"}))
        .await;
    let id = item["id"].as_str().unwrap().to_string();
    // cableModelId is accepted on create only
    assert_eq!(item["cableModelId"], "m1");
    assert_eq!(audit_count(&c.e.pool, "CREATE", &id).await, 1);
    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(
        ev,
        json!({"type":"update","entity":"tenant_catalogue","action":"created","id":id})
    );

    let p = c
        .req(
            "PATCH",
            &format!("/cables/{id}"),
            Some(json!({
                "name": "Cordon 2", "reference": "R", "customMinLength": 0.5,
                "useCases": null, "availableLengths": [3], "cableModelId": "other", "sortOrder": 4,
            })),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK, "{:?}", p.body);
    assert_eq!(p.body["id"], id);
    assert_eq!(p.body["name"], "Cordon 2");
    assert_eq!(p.body["customMinLength"], 0.5);
    assert_eq!(p.body["useCases"], json!([]));
    assert_eq!(p.body["availableLengths"], json!([3]));
    assert_eq!(p.body["sortOrder"], 4);
    // the patch schema has no cableModelId: stripped, like Zod
    assert_eq!(p.body["cableModelId"], "m1");
    assert_eq!(audit_count(&c.e.pool, "UPDATE", &id).await, 1);
    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(ev["action"], "updated");

    // validation: Zod flatten shape
    let r = c.req("POST", "/cables", Some(json!({"name": ""}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["error"]["fieldErrors"]["name"],
        json!(["Too small: expected string to have >=1 characters"])
    );
    let r = c
        .req(
            "POST",
            "/cables",
            Some(json!({"name": "X", "sortOrder": 1.5, "availableLengths": ["a"], "useCases": [1], "isActive": "y"})),
        )
        .await;
    let fe = &r.body["error"]["fieldErrors"];
    assert_eq!(
        fe["sortOrder"],
        json!(["Invalid input: expected int, received number"])
    );
    assert_eq!(
        fe["availableLengths"],
        json!(["Invalid input: expected number, received string"])
    );
    assert_eq!(
        fe["useCases"],
        json!(["Invalid input: expected string, received number"])
    );
    assert_eq!(
        fe["isActive"],
        json!(["Invalid input: expected boolean, received string"])
    );
    let r = c.req("POST", "/cables", Some(json!({}))).await;
    assert_eq!(
        r.body["error"]["fieldErrors"]["name"],
        json!(["Invalid input: expected string, received undefined"])
    );

    // missing
    for (m, b) in [("PATCH", Some(json!({"name": "Y"}))), ("DELETE", None)] {
        let r = c.req(m, "/cables/nope", b).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{m}");
        assert_eq!(r.body, json!({"error": "Cordon personnel introuvable"}));
    }
    let r = c.req("GET", "/cables/nope", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Cordon introuvable"}));

    let d = c.req("DELETE", &format!("/cables/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    assert_eq!(d.body, json!({"success": true}));
    assert_eq!(audit_count(&c.e.pool, "DELETE", &id).await, 1);
    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(ev["action"], "deleted");
    let g = c.req("GET", &format!("/cables/{id}"), None).await;
    assert_eq!(g.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cable_detail_is_the_editor_payload_and_roundtrips() {
    let c = ctx().await;
    let brand = first_id(&c.e.pool, "TenantBrand").await;
    let func = first_id(&c.e.pool, "TenantFunction").await;
    let left = first_id(&c.e.pool, "TenantConnectorType").await;
    let item = c
        .create(
            "cables",
            json!({
                "name": "Edit", "reference": "E1", "leftConnectorId": left, "leftGender": "NEUTRAL",
                "rightConnectorId": "ghost", "functionId": func, "brandId": brand, "model": "M",
                "cableModelId": "cm", "useCases": ["PRESTATION", "INSTALLATION"],
                "availableLengths": [10, 1], "customMinLength": 1, "customMaxLength": 20.5,
                "notes": "n", "imageUrl": "/uploads/x.png", "sortOrder": 3,
            }),
        )
        .await;
    let id = item["id"].as_str().unwrap();
    let d = c.req("GET", &format!("/cables/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    assert_eq!(d.body["source"], "PERSONAL");
    assert_eq!(d.body["isAccessible"], true);
    let it = &d.body["item"];
    assert_eq!(it["id"], id);
    assert_eq!(it["function"]["id"], func);
    assert_eq!(it["brand"]["id"], brand);
    assert_eq!(it["leftConnector"]["id"], left);
    // unknown id stays unresolved, stored order of arrays is kept
    assert!(it["rightConnector"].is_null());
    assert_eq!(it["rightConnectorId"], "ghost");
    assert_eq!(it["useCases"], json!(["PRESTATION", "INSTALLATION"]));
    assert_eq!(it["availableLengths"], json!([10, 1]));
    assert_eq!(it["arkyoDrift"], false);
    assert_eq!(it["shadowsArkyo"], false);

    // the editor PATCHes the payload back: nothing changes
    let before = c.req("GET", &format!("/cables/{id}"), None).await.body["item"].clone();
    let p = c
        .req("PATCH", &format!("/cables/{id}"), Some(it.clone()))
        .await;
    assert_eq!(p.status, StatusCode::OK, "{:?}", p.body);
    let mut after = c.req("GET", &format!("/cables/{id}"), None).await.body["item"].clone();
    let mut before = before;
    for v in [&mut before, &mut after] {
        v.as_object_mut().unwrap().remove("updatedAt");
    }
    assert_eq!(before, after);
}

#[tokio::test]
async fn adapter_inputs_outputs_roundtrip() {
    let c = ctx().await;
    let func = first_id(&c.e.pool, "TenantFunction").await;
    let ct = first_id(&c.e.pool, "TenantConnectorType").await;
    let ports = json!([
        {"connectorTypeId": ct, "gender": "FEMALE", "quantity": 2, "label": "In"},
        {"connectorTypeId": "ghost", "gender": "MALE", "quantity": 1},
    ]);
    let item = c
        .create(
            "adapters",
            json!({
                "name": "Zorglub", "reference": "A1", "functionId": func,
                "inputs": ports, "outputs": [{"connectorTypeId": ct, "gender": "MALE", "quantity": 1}],
                "notes": "n", "imageUrl": "/uploads/a.png",
            }),
        )
        .await;
    let id = item["id"].as_str().unwrap().to_string();
    assert_eq!(item["inputs"], ports);
    assert_eq!(item["isActive"], true);
    assert_eq!(item["shadowsArkyo"], false);
    assert_eq!(audit_count(&c.e.pool, "CREATE", &id).await, 1);

    // list
    let g = c.req("GET", "/adapters?scope=all", None).await;
    assert_eq!(g.body["arkyo"], json!([]));
    let p = find(&g.body, "Zorglub");
    assert_eq!(p["source"], "PERSONAL");
    assert_eq!(p["isAccessible"], true);
    assert_eq!(p["function"]["id"], func);
    assert_eq!(p["inputs"], ports);
    // search by name, not by reference
    assert_eq!(
        c.req("GET", "/adapters?q=ZORG", None).await.body["personal"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        c.req("GET", "/adapters?q=A1", None).await.body["personal"],
        json!([])
    );
    // ?ids= only affects the (empty) arkyo side
    let g = c.req("GET", &format!("/adapters?ids={id}"), None).await;
    assert_eq!(g.body["arkyo"], json!([]));
    assert!(g.body["personal"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x["id"] == id));

    // detail = editor payload: row + function
    let d = c.req("GET", &format!("/adapters/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    assert_eq!(d.body["source"], "PERSONAL");
    assert_eq!(d.body["isAccessible"], true);
    let it = &d.body["item"];
    assert_eq!(it["function"]["id"], func);
    assert_eq!(it["inputs"], ports);
    assert_eq!(it["outputs"][0]["quantity"], 1);

    // PATCH echoing the payload changes nothing
    let mut before = it.clone();
    let p = c
        .req("PATCH", &format!("/adapters/{id}"), Some(it.clone()))
        .await;
    assert_eq!(p.status, StatusCode::OK, "{:?}", p.body);
    let mut after = c.req("GET", &format!("/adapters/{id}"), None).await.body["item"].clone();
    for v in [&mut before, &mut after] {
        v.as_object_mut().unwrap().remove("updatedAt");
    }
    assert_eq!(before, after);

    // real patch; null arrays become []
    let p = c
        .req(
            "PATCH",
            &format!("/adapters/{id}"),
            Some(json!({"name": "Zorglub 2", "inputs": null, "outputs": [{"x": 1}]})),
        )
        .await;
    assert_eq!(p.body["name"], "Zorglub 2");
    assert_eq!(p.body["inputs"], json!([]));
    assert_eq!(p.body["outputs"], json!([{"x": 1}]));
    // the echo and this patch
    assert_eq!(audit_count(&c.e.pool, "UPDATE", &id).await, 2);

    // validation and 404s
    let r = c
        .req(
            "POST",
            "/adapters",
            Some(json!({"name": "X", "inputs": "a"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["error"]["fieldErrors"]["inputs"],
        json!(["Invalid input: expected array, received string"])
    );
    for (m, b) in [("PATCH", Some(json!({"name": "Y"}))), ("DELETE", None)] {
        let r = c.req(m, "/adapters/nope", b).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{m}");
        assert_eq!(r.body, json!({"error": "Adaptateur personnel introuvable"}));
    }
    let r = c.req("GET", "/adapters/nope", None).await;
    assert_eq!(r.body, json!({"error": "Adaptateur introuvable"}));
    let d = c.req("DELETE", &format!("/adapters/{id}"), None).await;
    assert_eq!(d.body, json!({"success": true}));
    assert_eq!(audit_count(&c.e.pool, "DELETE", &id).await, 1);
}

/// A row of an editor table (migration 0004) whose catalogue soft FK
/// (`catalogCableModelId` or `catalogAdapterId`) is `id`, in a project `p`
/// and a rack `r` created on first use.
async fn use_in(pool: &SqlitePool, table: &str, id: &str) {
    const NOW: &str = "2026-11-06T10:00:00.000Z";
    for sql in [
        r#"INSERT OR IGNORE INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p','Match','u',?,?)"#,
        r#"INSERT OR IGNORE INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('r','Baie',?,?)"#,
    ] {
        sqlx::query(sql)
            .bind(NOW)
            .bind(NOW)
            .execute(pool)
            .await
            .unwrap();
    }
    let sql = match table {
        "RackConnection" => {
            r#"INSERT INTO "RackConnection" ("id","rackId","catalogCableModelId","createdAt") VALUES (?,'r',?,?)"#
        }
        "ProjectConnection" => {
            r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","catalogCableModelId","createdAt") VALUES (?,'p','r','r',?,?)"#
        }
        "SynopticAdapter" => {
            r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","createdAt","updatedAt") VALUES (?,'r',?,0,0,?,?)"#
        }
        "ProjectSynopticAdapter" => {
            r#"INSERT INTO "ProjectSynopticAdapter" ("id","projectId","catalogAdapterId","x","y","createdAt","updatedAt") VALUES (?,'p',?,0,0,?,?)"#
        }
        "RackInventoryItem" => {
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogAdapterId","createdAt","updatedAt") VALUES (?,'r',?,?,?)"#
        }
        _ => panic!("no catalogue reference in {table}"),
    };
    let mut q = sqlx::query(sql).bind(arkyo_server::ids::new_id()).bind(id);
    for _ in 2..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool).await.unwrap();
}

#[tokio::test]
async fn delete_in_use_409() {
    let c = ctx().await;
    // arkyo-server (4c, décision 2): `catalogCableModelId` holds a
    // `TenantCableModel.id`, so the connections guard the cable model
    // (`/api/tenant/parametres/cabling`), not the catalogue cable.
    let r = call(
        &c.e.app,
        "POST",
        "/api/tenant/parametres/cabling",
        LOCAL,
        Some(&c.tok),
        Some(json!({"name": "Used model"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let model = r.body["id"].as_str().unwrap().to_string();
    use_in(&c.e.pool, "ProjectConnection", &model).await;
    use_in(&c.e.pool, "RackConnection", &model).await;
    let model_url = format!("/api/tenant/parametres/cabling/{model}");
    let d = call(&c.e.app, "DELETE", &model_url, LOCAL, Some(&c.tok), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({
            "error": "Ce modèle de câble est utilisé par 2 connexion(s) et ne peut pas être supprimé.",
            "count": 2,
            "breakdown": {"rackConnections": 1, "projectConnections": 1}
        })
    );
    // A catalogue cable is never counted, even with its id in
    // `catalogCableModelId` (arkyo counted it there).
    let cable = c.create("cables", json!({"name": "Used"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    use_in(&c.e.pool, "RackConnection", &cable).await;
    let d = c.req("DELETE", &format!("/cables/{cable}"), None).await;
    assert_eq!(
        (d.status, d.body),
        (StatusCode::OK, json!({"success": true}))
    );

    let ad = c.create("adapters", json!({"name": "Used"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    use_in(&c.e.pool, "SynopticAdapter", &ad).await;
    let d = c.req("DELETE", &format!("/adapters/{ad}"), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({"error": "Utilisé dans 1 synoptique(s) ou inventaire(s) — suppression impossible", "usageCount": 1})
    );
    // arkyo-server: an adapter only in an inventory is in use too (arkyo
    // only counted the synoptics; the BOM line vanished silently).
    let inv = c.create("adapters", json!({"name": "In BOM"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    use_in(&c.e.pool, "RackInventoryItem", &inv).await;
    let d = c.req("DELETE", &format!("/adapters/{inv}"), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(
        d.body,
        json!({"error": "Utilisé dans 1 synoptique(s) ou inventaire(s) — suppression impossible", "usageCount": 1})
    );
    use_in(&c.e.pool, "RackInventoryItem", &ad).await;
    let d = c.req("DELETE", &format!("/adapters/{ad}"), None).await;
    assert_eq!(
        (d.status, d.body["usageCount"].clone()),
        (StatusCode::CONFLICT, json!(2))
    );
    // nothing else was deleted
    for id in [&ad, &inv] {
        assert_eq!(
            c.req("GET", &format!("/adapters/{id}"), None).await.status,
            StatusCode::OK
        );
    }
    let models: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM "TenantCableModel" WHERE "id" = ?"#)
            .bind(&model)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(models, 1);
}

#[tokio::test]
async fn duplicate_and_bulk_delete() {
    let c = ctx().await;
    // cable duplicate: arkyo's field list (no cableModelId), sortOrder 0, active
    let src = c
        .create(
            "cables",
            json!({
                "name": "Cordon", "reference": "R1", "leftConnectorId": "l", "leftGender": "MALE",
                "rightConnectorId": "r", "rightGender": "FEMALE", "functionId": "f", "brandId": "b",
                "model": "m", "cableModelId": "cm", "useCases": ["INSTALLATION"],
                "availableLengths": [2, 4], "customMinLength": 1, "customMaxLength": 9,
                "notes": "n", "imageUrl": "/uploads/i.png", "sortOrder": 7, "isActive": false,
            }),
        )
        .await;
    let sid = src["id"].as_str().unwrap();
    let r = c
        .req("POST", &format!("/cables/{sid}/duplicate"), None)
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let copy = &r.body;
    assert_ne!(copy["id"], src["id"]);
    assert_eq!(copy["name"], "Cordon (copie)");
    for k in [
        "reference",
        "leftConnectorId",
        "leftGender",
        "rightConnectorId",
        "rightGender",
        "functionId",
        "brandId",
        "model",
        "useCases",
        "availableLengths",
        "customMinLength",
        "customMaxLength",
        "notes",
        "imageUrl",
    ] {
        assert_eq!(copy[k], src[k], "{k}");
    }
    assert!(copy["cableModelId"].is_null());
    assert_eq!(copy["isActive"], true);
    assert_eq!(copy["sortOrder"], 0);
    let cid = copy["id"].as_str().unwrap().to_string();
    assert_eq!(audit_count(&c.e.pool, "DUPLICATE", &cid).await, 1);
    let after: Value = sqlx::query_scalar(
        r#"SELECT "after" FROM "AuditLog" WHERE "action" = 'DUPLICATE' AND "entityId" = ?"#,
    )
    .bind(&cid)
    .fetch_one(&c.e.pool)
    .await
    .map(|s: String| serde_json::from_str(&s).unwrap())
    .unwrap();
    assert_eq!(
        after,
        json!({"clonedFromPersonalId": sid, "personalName": "Cordon"})
    );
    let r = c.req("POST", "/cables/nope/duplicate", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Cordon introuvable"}));

    // adapter duplicate
    let asrc = c
        .create(
            "adapters",
            json!({"name": "Adapt", "inputs": [{"a": 1}], "outputs": [{"b": 2}], "functionId": "f", "isActive": false}),
        )
        .await;
    let aid = asrc["id"].as_str().unwrap();
    let r = c
        .req("POST", &format!("/adapters/{aid}/duplicate"), None)
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["name"], "Adapt (copie)");
    assert_eq!(r.body["inputs"], json!([{"a": 1}]));
    assert_eq!(r.body["outputs"], json!([{"b": 2}]));
    assert_eq!(r.body["functionId"], "f");
    assert_eq!(r.body["isActive"], true);
    let r2 = c.req("POST", "/adapters/nope/duplicate", None).await;
    assert_eq!(r2.body, json!({"error": "Adaptateur introuvable"}));

    // bulk delete: failures are isolated, one audit row for the batch.
    // arkyo-server (4c, décision 2): a cable id in `catalogCableModelId`
    // does not hold the cable any more.
    let used = c.create("cables", json!({"name": "U"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    use_in(&c.e.pool, "ProjectConnection", &used).await;
    let r = c
        .req(
            "POST",
            "/cables/bulk-delete",
            Some(json!({"ids": [sid, used, "ghost"]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["deleted"], 2);
    let failed = r.body["failed"].as_array().unwrap();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0]["id"], "ghost");
    assert_eq!(failed[0]["reason"], "Cordon personnel introuvable");
    assert_eq!(audit_count(&c.e.pool, "BULK_DELETE", "batch").await, 1);
    let r = c
        .req("POST", "/cables/bulk-delete", Some(json!({"ids": []})))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["error"]["fieldErrors"]["ids"],
        json!(["Too small: expected array to have >=1 items"])
    );

    let used_ad = c.create("adapters", json!({"name": "U"})).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    use_in(&c.e.pool, "SynopticAdapter", &used_ad).await;
    let r = c
        .req(
            "POST",
            "/adapters/bulk-delete",
            Some(json!({"ids": [aid, used_ad, "ghost"]})),
        )
        .await;
    assert_eq!(r.body["deleted"], 1);
    assert_eq!(r.body["failed"][0]["id"], used_ad.as_str());
    assert_eq!(
        r.body["failed"][0]["reason"],
        "Utilisé dans 1 synoptique(s) ou inventaire(s) — suppression impossible"
    );
    assert_eq!(
        r.body["failed"][1]["reason"],
        "Adaptateur personnel introuvable"
    );
    assert_eq!(audit_count(&c.e.pool, "BULK_DELETE", "batch").await, 2);
}

#[tokio::test]
async fn check_duplicate_for_cables_and_adapters() {
    let c = ctx().await;
    c.create(
        "cables",
        json!({"name": "Yamaha Link", "reference": "YL-9"}),
    )
    .await;
    c.create(
        "adapters",
        json!({"name": "Neutrik Adapt", "reference": "NA-1"}),
    )
    .await;
    c.create(
        "adapters",
        json!({"name": "Inactif Adapt", "isActive": false}),
    )
    .await;
    let r = c
        .req("GET", "/cables/check-duplicate?name=YAMAHA", None)
        .await;
    assert_eq!(r.status, StatusCode::OK);
    let m = r.body["matches"].as_array().unwrap();
    assert_eq!(m.len(), 1);
    assert_eq!(m[0]["name"], "Yamaha Link");
    assert_eq!(m[0]["reference"], "YL-9");
    assert_eq!(m[0]["source"], "PERSONAL");
    assert_eq!(m[0]["matchField"], "name");
    let r = c
        .req(
            "GET",
            "/cables/check-duplicate?name=yamaha&reference=yl-9",
            None,
        )
        .await;
    assert_eq!(r.body["matches"][0]["matchField"], "both");
    let r = c
        .req("GET", "/adapters/check-duplicate?reference=na", None)
        .await;
    assert_eq!(r.body["matches"][0]["matchField"], "reference");
    let r = c
        .req("GET", "/adapters/check-duplicate?name=adapt", None)
        .await;
    assert_eq!(
        r.body["matches"].as_array().unwrap().len(),
        1,
        "inactive hidden"
    );
    let r = c.req("GET", "/adapters/check-duplicate?name=n", None).await;
    assert_eq!(r.body, json!({"matches": []}));
    let r = c.req("GET", "/cables/check-duplicate", None).await;
    assert_eq!(r.body, json!({"matches": []}));
}

#[tokio::test]
async fn restore_is_404() {
    let c = ctx().await;
    for (kind, name) in [("cables", "A"), ("adapters", "B")] {
        let id = c.create(kind, json!({"name": name})).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let r = c.req("POST", &format!("/{kind}/{id}/restore"), None).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND);
        assert_eq!(r.body, json!({"error": "Aucune version Arkyo"}));
    }
}

#[tokio::test]
async fn consultation_cannot_write_403() {
    let e = env().await;
    add_user(&e.pool, "c@b.fr", "consultation", false).await;
    let tok = login(&e.app, "c@b.fr").await;
    for kind in ["cables", "adapters"] {
        let g = call(
            &e.app,
            "GET",
            &format!("{BASE}/{kind}"),
            LOCAL,
            Some(&tok),
            None,
        )
        .await;
        assert_eq!(g.status, StatusCode::OK);
        for (m, p, b) in [
            ("POST", format!("/{kind}"), Some(json!({"name": "X"}))),
            ("PATCH", format!("/{kind}/abc"), Some(json!({"name": "X"}))),
            ("DELETE", format!("/{kind}/abc"), None),
            ("POST", format!("/{kind}/abc/duplicate"), None),
            ("POST", format!("/{kind}/abc/restore"), None),
            (
                "POST",
                format!("/{kind}/bulk-delete"),
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
    }
    let r = call(
        &e.app,
        "GET",
        &format!("{BASE}/cables/lengths"),
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let r = call(&e.app, "GET", &format!("{BASE}/cables"), LOCAL, None, None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}
