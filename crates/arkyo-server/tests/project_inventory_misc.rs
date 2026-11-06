//! Phase 4a, Task 5: the inventory side routes.
//! - `PATCH/DELETE /api/tenant/projects/:id/racks/:rackId/inventory/:itemId`
//!   and `…/:itemId/transfer` (arkyo:app/api/tenant/projects/[id]/racks/
//!   [rackId]/inventory/[itemId]/**);
//! - `PATCH/DELETE /api/tenant/projects/:id/racks/:rackId` and
//!   `POST …/racks/reorder`;
//! - `PATCH/DELETE /api/tenant/projects/:id/locations/:locationId`;
//! - `GET /api/tenant/inventaire/catalog` and
//!   `GET /api/tenant/projects/:id/inventaire/catalog`;
//! - `GET /api/tenant/racks` (`?templates=true`).
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tokio::sync::broadcast::error::TryRecvError;
use tokio::sync::broadcast::Receiver;

const LIST: &str = "/api/tenant/projects";
const NOW: &str = "2026-11-06T10:00:00.000Z";

struct Ctx {
    e: Env,
    tok: String,
    project: String,
    /// The first location (« Plateau ») and its virtual rack.
    loc: String,
    virt: String,
    /// « Baie A » and « Baie B », in « Plateau ».
    rack: String,
    rack_b: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let mut c = Ctx {
        e,
        tok,
        project: String::new(),
        loc: String::new(),
        virt: String::new(),
        rack: String::new(),
        rack_b: String::new(),
    };
    c.project = c.new_project("Match").await;
    (c.loc, c.virt) = c.new_location(&c.project, "Plateau").await;
    c.rack = c.new_rack(&c.project, &c.loc, "Baie A").await;
    c.rack_b = c.new_rack(&c.project, &c.loc, "Baie B").await;
    catalogue_fixture(&c.e.pool).await;
    c
}

impl Ctx {
    async fn req(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, path, LOCAL, Some(&self.tok), body).await
    }

    async fn ok(&self, method: &str, path: &str, body: Option<Value>) -> Value {
        let r = self.req(method, path, body.clone()).await;
        assert!(
            r.status.is_success(),
            "{method} {path} {body:?} → {} {:?}",
            r.status,
            r.body
        );
        r.body
    }

    async fn new_project(&self, name: &str) -> String {
        let b = self
            .ok(
                "POST",
                LIST,
                Some(json!({"name": name, "interventionType": "PRESTATION"})),
            )
            .await;
        b["id"].as_str().unwrap().to_string()
    }

    /// `(locationId, virtualRackId)`.
    async fn new_location(&self, project: &str, name: &str) -> (String, String) {
        let b = self
            .ok(
                "POST",
                &format!("{LIST}/{project}/locations"),
                Some(json!({"name": name})),
            )
            .await;
        (
            b["id"].as_str().unwrap().to_string(),
            b["virtualRackId"].as_str().unwrap().to_string(),
        )
    }

    async fn new_rack(&self, project: &str, loc: &str, name: &str) -> String {
        let b = self
            .ok(
                "POST",
                &format!("{LIST}/{project}/racks"),
                Some(json!({"racks": [{"name": name, "locationId": loc}]})),
            )
            .await;
        b["racks"][0]["id"].as_str().unwrap().to_string()
    }

    fn inv(&self, rack: &str) -> String {
        format!("{LIST}/{}/racks/{rack}/inventory", self.project)
    }

    fn item_url(&self, rack: &str, item: &str) -> String {
        format!("{}/{item}", self.inv(rack))
    }

    /// Adds `body` to `rack`'s inventory, returns the item id.
    async fn add(&self, rack: &str, body: Value) -> String {
        let b = self.ok("POST", &self.inv(rack), Some(body)).await;
        b["item"]["id"].as_str().unwrap().to_string()
    }

    fn rack_url(&self, rack: &str) -> String {
        format!("{LIST}/{}/racks/{rack}", self.project)
    }

    fn loc_url(&self, loc: &str) -> String {
        format!("{LIST}/{}/locations/{loc}", self.project)
    }
}

async fn exec(pool: &SqlitePool, sql: &str) {
    let mut q = sqlx::query(sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

async fn int(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn text(pool: &SqlitePool, sql: &str) -> Option<String> {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

/// `eq1` (active), `eq-off` (inactive), a host `host-eq` (4 slots), a
/// component `comp-eq` (span 2), adapters `ad1` / `ad-off`, panels.
async fn catalogue_fixture(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Blackmagic',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","createdAt","updatedAt") VALUES ('cat1','Régie','#112233',?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f-video','t_video','Vidéo','#0000aa',1,?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","reference","brandId","categoryId","heightU","functionIds","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM 2 M/E','SWATEMPSW2ME','b1','cat1',2,'["f-video"]','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","categoryId","isActive","createdById","createdAt","updatedAt") VALUES ('eq-off','Vieux mixeur','cat1',0,'u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isComponentHost","hostSlotCount","createdById","createdAt","updatedAt") VALUES ('host-eq','Châssis',1,4,'u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isComponent","componentSlotSpan","isRackable","createdById","createdAt","updatedAt") VALUES ('comp-eq','Carte',1,2,0,'u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","reference","functionId","createdById","createdAt","updatedAt") VALUES ('ad1','XLR F → Jack','AD-1','f-video','u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","isActive","createdById","createdAt","updatedAt") VALUES ('ad-off','Vieil adaptateur',0,'u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","createdById","createdAt","updatedAt") VALUES ('pa2','Patch 48 BNC','PATCH',2,'u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","createdById","createdAt","updatedAt") VALUES ('pa1','Bandeau','ACCESSORY',1,'u',?,?)"#,
    ] {
        exec(pool, sql).await;
    }
}

async fn next_event(rx: &mut Receiver<String>) -> Value {
    let s = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
        .await
        .expect("évènement attendu")
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

fn no_event(rx: &mut Receiver<String>) {
    assert!(matches!(rx.try_recv(), Err(TryRecvError::Empty)));
}

/// `(action, entityType, entityId, projectId, before, after)` of the last
/// audit entry.
async fn last_audit(pool: &SqlitePool) -> (String, String, String, Option<String>, Value, Value) {
    let (a, t, id, p, before, after): (
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        r#"SELECT "action","entityType","entityId","projectId","before","after" FROM "AuditLog" ORDER BY rowid DESC LIMIT 1"#,
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let parse = |s: Option<String>| s.map_or(Value::Null, |s| serde_json::from_str(&s).unwrap());
    (a, t, id, p, parse(before), parse(after))
}

async fn audit_count(pool: &SqlitePool) -> i64 {
    int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await
}

fn inventory_event(project: &str, rack: &str, item: &str) -> Value {
    json!({
        "type": "update", "entity": "rack_inventory", "action": "updated", "id": rack,
        "projectId": project, "rackId": rack, "itemId": item,
    })
}

async fn slot_count(pool: &SqlitePool, item: &str) -> i64 {
    int(
        pool,
        &format!(r#"SELECT COUNT(*) FROM "RackSlot" WHERE "inventoryItemId" = '{item}'"#),
    )
    .await
}

async fn insert_slot(pool: &SqlitePool, id: &str, rack: &str, item: Option<&str>) {
    sqlx::query(
        r#"INSERT INTO "RackSlot" ("id","rackId","inventoryItemId","startU","createdAt","updatedAt") VALUES (?,?,?,1,?,?)"#,
    )
    .bind(id)
    .bind(rack)
    .bind(item)
    .bind(NOW)
    .bind(NOW)
    .execute(pool)
    .await
    .unwrap();
}

fn issues(path: &str, message: &str) -> Value {
    json!({"error": "Validation invalide", "issues": [{"path": [path], "message": message}]})
}

fn flat(field: &str, message: &str) -> Value {
    json!({"error": {"formErrors": [], "fieldErrors": {field: [message]}}})
}

// ── transfert ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn transfer_item_between_racks() {
    let c = ctx().await;
    let p = &c.e.pool;
    let item = c
        .add(&c.rack, json!({"catalogEquipmentId": "eq1", "quantity": 2}))
        .await;
    assert_eq!(slot_count(p, &item).await, 2);
    let url = format!("{}/transfer", c.item_url(&c.rack, &item));

    let other = c.new_project("Autre").await;
    let (other_loc, _) = c.new_location(&other, "Ailleurs").await;
    let foreign = c.new_rack(&other, &other_loc, "Baie X").await;

    // Errors first: nothing is written.
    let before = audit_count(p).await;
    let mut rx = c.e.events.subscribe();
    let cases: Vec<(String, Option<Value>, StatusCode, Value)> = vec![
        (
            format!("{}/transfer", c.item_url(&c.rack, "nope")),
            Some(json!({"targetRackId": c.rack_b})),
            StatusCode::NOT_FOUND,
            json!({"error": "Not found"}),
        ),
        // The item is not in that rack.
        (
            format!("{}/transfer", c.item_url(&c.rack_b, &item)),
            Some(json!({"targetRackId": c.rack_b})),
            StatusCode::NOT_FOUND,
            json!({"error": "Not found"}),
        ),
        (
            url.clone(),
            Some(json!({})),
            StatusCode::BAD_REQUEST,
            issues(
                "targetRackId",
                "Invalid input: expected string, received undefined",
            ),
        ),
        // `req.json().catch(() => ({}))`.
        (
            url.clone(),
            None,
            StatusCode::BAD_REQUEST,
            issues(
                "targetRackId",
                "Invalid input: expected string, received undefined",
            ),
        ),
        (
            url.clone(),
            Some(json!({"targetRackId": ""})),
            StatusCode::BAD_REQUEST,
            issues(
                "targetRackId",
                "Too small: expected string to have >=1 characters",
            ),
        ),
        (
            url.clone(),
            Some(json!({"targetRackId": foreign})),
            StatusCode::NOT_FOUND,
            json!({"error": "Not found"}),
        ),
    ];
    for (u, body, status, expected) in cases {
        let r = c.req("POST", &u, body.clone()).await;
        assert_eq!((r.status, r.body), (status, expected), "{u} {body:?}");
    }
    assert_eq!(audit_count(p).await, before);
    no_event(&mut rx);

    // Cabled: a RackConnection on one of its slots, then an ExternalPort.
    let slot: String = sqlx::query_scalar(
        r#"SELECT "id" FROM "RackSlot" WHERE "inventoryItemId" = ? ORDER BY rowid LIMIT 1"#,
    )
    .bind(&item)
    .fetch_one(p)
    .await
    .unwrap();
    let uncable = json!({"error": "Décâblez cet équipement avant de le déplacer."});
    exec(p, &format!(r#"INSERT INTO "RackConnection" ("id","rackId","toSlotId","createdAt") VALUES ('cx1','{}','{slot}',?)"#, c.rack)).await;
    let r = c
        .req("POST", &url, Some(json!({"targetRackId": c.rack_b})))
        .await;
    assert_eq!((r.status, r.body), (StatusCode::CONFLICT, uncable.clone()));
    exec(p, r#"DELETE FROM "RackConnection""#).await;
    exec(p, &format!(r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('ep1','{}','{slot}',0,?,?)"#, c.rack)).await;
    let r = c
        .req("POST", &url, Some(json!({"targetRackId": c.rack_b})))
        .await;
    assert_eq!((r.status, r.body), (StatusCode::CONFLICT, uncable.clone()));
    exec(p, r#"DELETE FROM "ExternalPort""#).await;
    assert_eq!(audit_count(p).await, before);
    no_event(&mut rx);

    // The transfer: raw row, slots purged and not re-synced (arkyo).
    let r = c
        .req("POST", &url, Some(json!({"targetRackId": c.rack_b})))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let moved = &r.body["item"];
    assert_eq!(moved["id"], json!(item));
    assert_eq!(moved["rackId"], json!(c.rack_b));
    assert_eq!(moved["quantity"], 2);
    assert_eq!(moved["catalogEquipmentId"], "eq1");
    assert_eq!(moved["snapshotId"], Value::Null);
    assert!(moved.get("name").is_none(), "ligne brute, non enrichie");
    assert_eq!(slot_count(p, &item).await, 0);
    let (a, t, id, proj, b, af) = last_audit(p).await;
    assert_eq!(
        (a.as_str(), t.as_str(), id.as_str(), proj.as_deref()),
        (
            "transfer_inventory_item",
            "RackInventoryItem",
            item.as_str(),
            Some(c.project.as_str())
        )
    );
    assert_eq!(b, json!({"rackId": c.rack}));
    assert_eq!(af, json!({"targetRackId": c.rack_b}));
    assert_eq!(
        next_event(&mut rx).await,
        inventory_event(&c.project, &c.rack, &item)
    );
    assert_eq!(
        next_event(&mut rx).await,
        inventory_event(&c.project, &c.rack_b, &item)
    );
    no_event(&mut rx);
    // B's inventory lists it, A's no more.
    let b_items = c.ok("GET", &c.inv(&c.rack_b), None).await;
    assert_eq!(b_items["items"][0]["id"], json!(item));
    let a_items = c.ok("GET", &c.inv(&c.rack), None).await;
    assert_eq!(a_items["items"], json!([]));

    // A host and its components move together; a cable on a component blocks.
    let host = c
        .add(&c.rack, json!({"catalogEquipmentId": "host-eq"}))
        .await;
    let comp = c
        .add(
            &c.rack,
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": host, "hostSlotIndex": 0}),
        )
        .await;
    let host_url = format!("{}/transfer", c.item_url(&c.rack, &host));
    exec(p, &format!(r#"INSERT INTO "RackConnection" ("id","rackId","fromComponentItemId","createdAt") VALUES ('cx2','{}','{comp}',?)"#, c.rack)).await;
    let r = c
        .req("POST", &host_url, Some(json!({"targetRackId": c.virt})))
        .await;
    assert_eq!((r.status, r.body), (StatusCode::CONFLICT, uncable));
    exec(p, r#"DELETE FROM "RackConnection""#).await;
    // The virtual rack of a location is a valid target (« équipements libres »).
    let r = c
        .req("POST", &host_url, Some(json!({"targetRackId": c.virt})))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(
        text(
            p,
            &format!(r#"SELECT "rackId" FROM "RackInventoryItem" WHERE "id" = '{comp}'"#)
        )
        .await
        .as_deref(),
        Some(c.virt.as_str())
    );
    assert_eq!(slot_count(p, &host).await, 0);

    // Consultation: 403, nothing moved.
    add_user(p, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let r = call(
        &c.e.app,
        "POST",
        &format!("{}/transfer", c.item_url(&c.rack_b, &item)),
        LOCAL,
        Some(&ct),
        Some(json!({"targetRackId": c.rack})),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"}))
    );
}

// ── PATCH / DELETE d'un item ────────────────────────────────────────────────

#[tokio::test]
async fn patch_and_delete_item_like_arkyo() {
    let c = ctx().await;
    let p = &c.e.pool;
    let item = c.add(&c.rack, json!({"catalogEquipmentId": "eq1"})).await;
    let url = c.item_url(&c.rack, &item);
    let mut rx = c.e.events.subscribe();
    let before = audit_count(p).await;

    let cases: Vec<(String, Option<Value>, StatusCode, Value)> = vec![
        (
            c.item_url(&c.rack_b, &item),
            Some(json!({"quantity": 2})),
            StatusCode::NOT_FOUND,
            json!({"error": "Not found"}),
        ),
        (
            url.clone(),
            Some(json!({})),
            StatusCode::BAD_REQUEST,
            issues("root", "quantity ou hostSlotIndex requis"),
        ),
        (
            url.clone(),
            Some(json!({"quantity": 0})),
            StatusCode::BAD_REQUEST,
            issues("quantity", "Too small: expected number to be >=1"),
        ),
        // arkyo-server: plafond de quantité.
        (
            url.clone(),
            Some(json!({"quantity": 1000})),
            StatusCode::BAD_REQUEST,
            issues("quantity", "Too big: expected number to be <=999"),
        ),
        (
            url.clone(),
            Some(json!({"hostSlotIndex": 1})),
            StatusCode::BAD_REQUEST,
            json!({"error": "Seul un composant installé peut changer de slot"}),
        ),
    ];
    for (u, body, status, expected) in cases {
        let r = c.req("PATCH", &u, body.clone()).await;
        assert_eq!((r.status, r.body), (status, expected), "{u} {body:?}");
    }
    // arkyo-server: an unreadable body is a 400 (arkyo: implicit 500).
    let r = call(&c.e.app, "PATCH", &url, LOCAL, Some(&c.tok), None).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(audit_count(p).await, before);
    no_event(&mut rx);

    // Quantity: raw row, ghost slots re-synced.
    let r = c.req("PATCH", &url, Some(json!({"quantity": 3}))).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["item"]["quantity"], 3);
    assert_eq!(r.body["item"]["rackId"], json!(c.rack));
    assert!(r.body["item"].get("name").is_none());
    assert_eq!(slot_count(p, &item).await, 3);
    let (a, _, id, _, _, af) = last_audit(p).await;
    assert_eq!(
        (a.as_str(), id.as_str()),
        ("update_inventory_item", item.as_str())
    );
    assert_eq!(af, json!({"quantity": 3}));
    assert_eq!(
        next_event(&mut rx).await,
        inventory_event(&c.project, &c.rack, &item)
    );
    c.ok("PATCH", &url, Some(json!({"quantity": 1}))).await;
    assert_eq!(slot_count(p, &item).await, 1);
    let _ = next_event(&mut rx).await;

    // A host chassis and a component: quantity is fixed.
    let host = c
        .add(&c.rack, json!({"catalogEquipmentId": "host-eq"}))
        .await;
    let comp = c
        .add(
            &c.rack,
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": host, "hostSlotIndex": 0}),
        )
        .await;
    let _ = next_event(&mut rx).await;
    let _ = next_event(&mut rx).await;
    let r = c
        .req(
            "PATCH",
            &c.item_url(&c.rack, &host),
            Some(json!({"quantity": 2})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Un châssis s'ajoute par exemplaire — ajoutez ou supprimez des exemplaires."})
        )
    );
    let comp_url = c.item_url(&c.rack, &comp);
    let r = c
        .req("PATCH", &comp_url, Some(json!({"quantity": 2})))
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "La quantité d'un composant installé est fixe"})
        )
    );
    // hostSlotIndex wins over quantity; bounds and overlap.
    let r = c
        .req("PATCH", &comp_url, Some(json!({"hostSlotIndex": 3})))
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Composant hors des limites de l'équipement modulaire"})
        )
    );
    let other = c
        .add(
            &c.rack,
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": host, "hostSlotIndex": 2}),
        )
        .await;
    let _ = next_event(&mut rx).await;
    let r = c
        .req("PATCH", &comp_url, Some(json!({"hostSlotIndex": 1})))
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::CONFLICT, json!({"error": "Slot occupé"}))
    );
    c.ok("DELETE", &c.item_url(&c.rack, &other), None).await;
    let _ = next_event(&mut rx).await;
    let r = c
        .req(
            "PATCH",
            &comp_url,
            Some(json!({"hostSlotIndex": 2, "quantity": 9})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["item"]["hostSlotIndex"], 2);
    assert_eq!(r.body["item"]["quantity"], 1);
    let (_, _, _, _, _, af) = last_audit(p).await;
    assert_eq!(af, json!({"hostSlotIndex": 2}));
    assert_eq!(
        next_event(&mut rx).await,
        inventory_event(&c.project, &c.rack, &comp)
    );

    // DELETE: its slots go (cables with them), a host takes its components.
    let slot: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "RackSlot" WHERE "inventoryItemId" = ? LIMIT 1"#)
            .bind(&item)
            .fetch_one(p)
            .await
            .unwrap();
    exec(p, &format!(r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","createdAt") VALUES ('cx1','{}','{slot}',?)"#, c.rack)).await;
    let r = c.req("DELETE", &url, None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(slot_count(p, &item).await, 0);
    assert_eq!(int(p, r#"SELECT COUNT(*) FROM "RackConnection""#).await, 0);
    let (a, t, id, proj, b, _) = last_audit(p).await;
    assert_eq!(
        (a.as_str(), t.as_str(), id.as_str(), proj.as_deref()),
        (
            "delete_inventory_item",
            "RackInventoryItem",
            item.as_str(),
            Some(c.project.as_str())
        )
    );
    assert_eq!(b, json!({"rackId": c.rack, "itemId": item}));
    assert_eq!(
        next_event(&mut rx).await,
        inventory_event(&c.project, &c.rack, &item)
    );
    let r = c.req("DELETE", &url, None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    c.ok("DELETE", &c.item_url(&c.rack, &host), None).await;
    assert_eq!(
        int(p, r#"SELECT COUNT(*) FROM "RackInventoryItem""#).await,
        0
    );
    assert_eq!(
        int(
            p,
            r#"SELECT COUNT(*) FROM "RackSlot" WHERE "inventoryItemId" IS NULL"#
        )
        .await,
        0,
        "aucun slot orphelin"
    );
}

// ── contenants : PATCH, DELETE, réordonnancement ────────────────────────────

#[tokio::test]
async fn patch_and_delete_rack_like_arkyo() {
    let c = ctx().await;
    let p = &c.e.pool;
    let (loc2, _) = c.new_location(&c.project, "Régie").await;
    let url = c.rack_url(&c.rack);
    let mut rx = c.e.events.subscribe();
    let before = audit_count(p).await;

    let cases: Vec<(String, Option<Value>, StatusCode, Value)> = vec![
        (
            c.rack_url("nope"),
            Some(json!({"name": "X"})),
            StatusCode::NOT_FOUND,
            json!({"error": "Not found"}),
        ),
        (
            url.clone(),
            Some(json!({"totalU": 61})),
            StatusCode::BAD_REQUEST,
            flat("totalU", "Too big: expected number to be <=60"),
        ),
        (
            url.clone(),
            Some(json!({"emptyWeightKg": 600})),
            StatusCode::BAD_REQUEST,
            flat("emptyWeightKg", "Too big: expected number to be <=500"),
        ),
        (
            url.clone(),
            Some(json!({"locationId": null})),
            StatusCode::BAD_REQUEST,
            flat(
                "locationId",
                "Invalid input: expected string, received null",
            ),
        ),
        (
            url.clone(),
            Some(json!({"name": ""})),
            StatusCode::BAD_REQUEST,
            flat("name", "Too small: expected string to have >=1 characters"),
        ),
        (
            c.rack_url(&c.virt),
            Some(json!({"locationId": loc2})),
            StatusCode::BAD_REQUEST,
            json!({"error": "Un contenant virtuel ne peut pas être réaffecté"}),
        ),
        (
            url.clone(),
            Some(json!({"locationId": "ailleurs"})),
            StatusCode::BAD_REQUEST,
            json!({"error": "Emplacement introuvable"}),
        ),
    ];
    for (u, body, status, expected) in cases {
        let r = c.req("PATCH", &u, body.clone()).await;
        assert_eq!((r.status, r.body), (status, expected), "{u} {body:?}");
    }
    assert_eq!(audit_count(p).await, before);
    no_event(&mut rx);

    // A move, a unique name, nullable fields cleared.
    let body = json!({
        "locationId": loc2, "name": "baie b", "canvasX": 10, "canvasY": null,
        "totalU": 12, "hasWheels": true, "emptyWeightKg": 12.5, "widthMm": null, "inconnu": 1,
    });
    let r = c.req("PATCH", &url, Some(body)).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let rack = &r.body;
    assert_eq!(rack["id"], json!(c.rack));
    assert_eq!(rack["name"], "baie b 2");
    assert_eq!(rack["locationId"], json!(loc2));
    assert_eq!(rack["canvasX"], 10);
    assert_eq!(rack["canvasY"], Value::Null);
    assert_eq!(rack["totalU"], 12);
    assert_eq!(rack["hasWheels"], true);
    assert_eq!(rack["emptyWeightKg"], 12.5);
    assert_eq!(rack["isVirtual"], false);
    assert_eq!(rack["constructionChecks"], json!([]));
    let (a, t, id, proj, _, af) = last_audit(p).await;
    assert_eq!(
        (a.as_str(), t.as_str(), id.as_str(), proj.as_deref()),
        (
            "update_rack",
            "Rack",
            c.rack.as_str(),
            Some(c.project.as_str())
        )
    );
    assert_eq!(
        af,
        json!({"canvasX": 10, "canvasY": null, "locationId": loc2, "name": "baie b",
               "totalU": 12, "widthMm": null, "hasWheels": true, "emptyWeightKg": 12.5})
    );
    let rack_event = |action: &str, rack: &str| {
        json!({"type": "update", "entity": "rack", "action": action, "id": rack,
               "projectId": c.project, "rackId": rack})
    };
    assert_eq!(next_event(&mut rx).await, rack_event("updated", &c.rack));
    // Keeping its own name is not a collision; `{}` (or no body) changes nothing.
    let r = c
        .req("PATCH", &url, Some(json!({"name": "baie b 2"})))
        .await;
    assert_eq!(r.body["name"], "baie b 2");
    let _ = next_event(&mut rx).await;
    let r = call(&c.e.app, "PATCH", &url, LOCAL, Some(&c.tok), None).await;
    assert_eq!(r.status, StatusCode::OK);
    let _ = next_event(&mut rx).await;

    // DELETE: the virtual rack is refused, a container goes with its content.
    let r = c.req("DELETE", &c.rack_url(&c.virt), None).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Un contenant virtuel se supprime via son emplacement"})
        )
    );
    let item = c
        .add(&c.rack, json!({"catalogEquipmentId": "eq1", "quantity": 2}))
        .await;
    let _ = next_event(&mut rx).await;
    exec(p, &format!(r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('z1','{}',0,0,1,1,?,?)"#, c.rack)).await;
    let r = c.req("DELETE", &url, None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    for table in ["RackInventoryItem", "RackSlot", "RackZone"] {
        assert_eq!(
            int(
                p,
                &format!(
                    r#"SELECT COUNT(*) FROM "{table}" WHERE "rackId" = '{}'"#,
                    c.rack
                )
            )
            .await,
            0,
            "{table}"
        );
    }
    assert_eq!(slot_count(p, &item).await, 0);
    assert_eq!(
        int(
            p,
            &format!(
                r#"SELECT COUNT(*) FROM "RigRack" WHERE "rackId" = '{}'"#,
                c.rack
            )
        )
        .await,
        0
    );
    let (a, _, id, _, b, _) = last_audit(p).await;
    assert_eq!((a.as_str(), id.as_str()), ("delete_rack", c.rack.as_str()));
    assert_eq!(b, json!({"rackId": c.rack, "rackName": "baie b 2"}));
    assert_eq!(next_event(&mut rx).await, rack_event("deleted", &c.rack));
    let r = c.req("DELETE", &url, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);

    // A template rack also used by the project is unlinked, not deleted.
    exec(p, r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('tpl-rig','Modèle',1,'u',?,?)"#).await;
    exec(p, r#"INSERT INTO "Rack" ("id","name","templateStatus","createdAt","updatedAt") VALUES ('tpl-rack','Modèle 1','ACTIF',?,?)"#).await;
    exec(p, r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr-tpl','tpl-rig','tpl-rack',0)"#).await;
    let rig: String = text(
        p,
        &format!(
            r#"SELECT "id" FROM "RigConfig" WHERE "projectId" = '{}'"#,
            c.project
        ),
    )
    .await
    .unwrap();
    exec(p, &format!(r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr-shared','{rig}','tpl-rack',9)"#)).await;
    let r = c.req("DELETE", &c.rack_url("tpl-rack"), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        int(p, r#"SELECT COUNT(*) FROM "Rack" WHERE "id" = 'tpl-rack'"#).await,
        1
    );
    assert_eq!(
        int(
            p,
            r#"SELECT COUNT(*) FROM "RigRack" WHERE "rackId" = 'tpl-rack'"#
        )
        .await,
        1
    );
    let r = c.req("DELETE", &c.rack_url("tpl-rack"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn reorder_racks_positions() {
    let c = ctx().await;
    let p = &c.e.pool;
    let url = format!("{LIST}/{}/racks/reorder", c.project);
    let other = c.new_project("Autre").await;
    let (other_loc, _) = c.new_location(&other, "Ailleurs").await;
    let foreign = c.new_rack(&other, &other_loc, "Baie X").await;
    let mut rx = c.e.events.subscribe();
    let before = audit_count(p).await;

    let not_ours = json!({"error": "Un ou plusieurs contenants n'appartiennent pas au projet."});
    let cases: Vec<(Option<Value>, Value)> = vec![
        (
            Some(json!({})),
            flat(
                "rackIds",
                "Invalid input: expected array, received undefined",
            ),
        ),
        (
            None,
            flat(
                "rackIds",
                "Invalid input: expected array, received undefined",
            ),
        ),
        (
            Some(json!({"rackIds": []})),
            flat("rackIds", "Too small: expected array to have >=1 items"),
        ),
        (
            Some(json!({"rackIds": [1]})),
            flat("rackIds", "Invalid input: expected string, received number"),
        ),
        (
            Some(json!({"rackIds": [c.rack, foreign]})),
            not_ours.clone(),
        ),
        (Some(json!({"rackIds": [c.rack, c.rack]})), not_ours.clone()),
    ];
    for (body, expected) in cases {
        let r = c.req("POST", &url, body.clone()).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::BAD_REQUEST, expected),
            "{body:?}"
        );
    }
    assert_eq!(audit_count(p).await, before);
    no_event(&mut rx);

    let order = [c.rack_b.clone(), c.virt.clone(), c.rack.clone()];
    let r = c.req("POST", &url, Some(json!({"rackIds": order}))).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    let positions: Vec<(String, i64)> = sqlx::query_as(
        r#"SELECT rr."rackId", rr."position" FROM "RigRack" rr JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
           WHERE g."projectId" = ? ORDER BY rr."position""#,
    )
    .bind(&c.project)
    .fetch_all(p)
    .await
    .unwrap();
    assert_eq!(
        positions,
        vec![
            (order[0].clone(), 0),
            (order[1].clone(), 1),
            (order[2].clone(), 2)
        ]
    );
    let (a, t, id, proj, _, af) = last_audit(p).await;
    assert_eq!(
        (a.as_str(), t.as_str(), id.as_str(), proj.as_deref()),
        (
            "reorder_racks",
            "Project",
            c.project.as_str(),
            Some(c.project.as_str())
        )
    );
    assert_eq!(af, json!({"rackIds": order}));
    // The published id is the project's.
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rack", "action": "updated", "id": c.project,
               "projectId": c.project})
    );
    no_event(&mut rx);
}

// ── lieux ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn patch_location_syncs_virtual_rack() {
    let c = ctx().await;
    let p = &c.e.pool;
    let url = c.loc_url(&c.loc);
    let mut rx = c.e.events.subscribe();
    let before = audit_count(p).await;

    for (body, expected) in [
        (
            json!({"cableCode": "ABCDEF"}),
            flat(
                "cableCode",
                "Too big: expected string to have <=5 characters",
            ),
        ),
        (
            json!({"canvasW": 0}),
            flat("canvasW", "Too small: expected number to be >0"),
        ),
        (
            json!({"sortOrder": -1}),
            flat("sortOrder", "Too small: expected number to be >=0"),
        ),
        (
            json!({"name": "x".repeat(121)}),
            flat("name", "Too big: expected string to have <=120 characters"),
        ),
    ] {
        let r = c.req("PATCH", &url, Some(body.clone())).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::BAD_REQUEST, expected),
            "{body}"
        );
    }
    let r = c
        .req("PATCH", &c.loc_url("nope"), Some(json!({"name": "X"})))
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    assert_eq!(audit_count(p).await, before);
    no_event(&mut rx);

    let body = json!({"name": "  Studio  ", "cableCode": " st-1", "canvasX": 5, "canvasW": null});
    let r = c.req("PATCH", &url, Some(body)).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["id"], json!(c.loc));
    assert_eq!(r.body["projectId"], json!(c.project));
    assert_eq!(r.body["name"], "Studio");
    assert_eq!(r.body["cableCode"], "ST1");
    assert_eq!(r.body["canvasX"], 5);
    assert_eq!(r.body["canvasW"], Value::Null);
    assert_eq!(r.body["virtualRackId"], json!(c.virt));
    assert_eq!(r.body["containerCount"], 2);
    let (name, code): (String, Option<String>) =
        sqlx::query_as(r#"SELECT "name", "cableCode" FROM "Rack" WHERE "id" = ?"#)
            .bind(&c.virt)
            .fetch_one(p)
            .await
            .unwrap();
    assert_eq!((name.as_str(), code.as_deref()), ("Studio", Some("ST1")));
    let (a, t, id, proj, _, af) = last_audit(p).await;
    assert_eq!(
        (a.as_str(), t.as_str(), id.as_str(), proj.as_deref()),
        (
            "update_location",
            "Location",
            c.loc.as_str(),
            Some(c.project.as_str())
        )
    );
    assert_eq!(
        af,
        json!({"name": "  Studio  ", "cableCode": " st-1", "canvasX": 5, "canvasW": null})
    );
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "location", "action": "updated", "id": c.loc,
               "projectId": c.project})
    );
    // `cableCode: null` clears both; the canvas alone leaves the rack alone.
    let r = c.req("PATCH", &url, Some(json!({"cableCode": null}))).await;
    assert_eq!(r.body["cableCode"], Value::Null);
    assert_eq!(
        text(
            p,
            &format!(
                r#"SELECT "cableCode" FROM "Rack" WHERE "id" = '{}'"#,
                c.virt
            )
        )
        .await,
        None
    );
}

#[tokio::test]
async fn delete_location_deletes_its_virtual_and_own_racks() {
    let c = ctx().await;
    let p = &c.e.pool;
    let racks_before = int(p, r#"SELECT COUNT(*) FROM "Rack""#).await;

    // A shared template rack, outside any location: never touched.
    exec(p, r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('tpl-rig','Modèle',1,'u',?,?)"#).await;
    exec(p, r#"INSERT INTO "Rack" ("id","name","templateStatus","createdAt","updatedAt") VALUES ('tpl-rack','Modèle 1','ACTIF',?,?)"#).await;
    exec(p, r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr-tpl','tpl-rig','tpl-rack',0)"#).await;

    // Containers: 409, nothing deleted.
    let url = c.loc_url(&c.loc);
    let mut rx = c.e.events.subscribe();
    let before = audit_count(p).await;
    let r = c.req("DELETE", &url, None).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({"error": "Ce lieu contient des contenants — déplacez-les avant suppression"})
        )
    );
    // Free equipment in the virtual rack: 409 too.
    let (loc2, virt2) = c.new_location(&c.project, "Régie").await;
    let _ = next_event(&mut rx).await;
    let free = c.add(&virt2, json!({"catalogEquipmentId": "eq1"})).await;
    let _ = next_event(&mut rx).await;
    let r = c.req("DELETE", &c.loc_url(&loc2), None).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({"error": "Ce lieu contient des équipements libres — retirez-les avant suppression"})
        )
    );
    let r = c.req("DELETE", &c.loc_url("nope"), None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    assert_eq!(audit_count(p).await, before + 2);
    no_event(&mut rx);

    // Emptied, the location goes with its virtual rack and everything on it.
    c.ok("DELETE", &c.item_url(&virt2, &free), None).await;
    let _ = next_event(&mut rx).await;
    insert_slot(p, "s-virt", &virt2, None).await;
    exec(p, &format!(r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('z1','{virt2}',0,0,1,1,?,?)"#)).await;
    exec(p, &format!(r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","createdAt") VALUES ('cx1','{virt2}','s-virt',?)"#)).await;
    let r = c.req("DELETE", &c.loc_url(&loc2), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        int(
            p,
            &format!(r#"SELECT COUNT(*) FROM "Location" WHERE "id" = '{loc2}'"#)
        )
        .await,
        0
    );
    for (table, col) in [
        ("Rack", "id"),
        ("RigRack", "rackId"),
        ("RackSlot", "rackId"),
        ("RackZone", "rackId"),
        ("RackConnection", "rackId"),
        ("RackInventoryItem", "rackId"),
    ] {
        assert_eq!(
            int(
                p,
                &format!(r#"SELECT COUNT(*) FROM "{table}" WHERE "{col}" = '{virt2}'"#)
            )
            .await,
            0,
            "{table}"
        );
    }
    let (a, t, id, proj, b, _) = last_audit(p).await;
    assert_eq!(
        (a.as_str(), t.as_str(), id.as_str(), proj.as_deref()),
        (
            "delete_location",
            "Location",
            loc2.as_str(),
            Some(c.project.as_str())
        )
    );
    assert_eq!(b, json!({"name": "Régie"}));
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "location", "action": "deleted", "id": loc2,
               "projectId": c.project})
    );
    no_event(&mut rx);

    // Containers deleted, then the location: no rack of it survives.
    c.ok("DELETE", &c.rack_url(&c.rack), None).await;
    c.ok("DELETE", &c.rack_url(&c.rack_b), None).await;
    let r = c.req("DELETE", &url, None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(int(p, r#"SELECT COUNT(*) FROM "Location""#).await, 0);
    // Only the template rack is left: no orphan rack, rig link or slot.
    assert_eq!(racks_before, 3, "virtuel + deux contenants");
    let left: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "Rack""#)
        .fetch_all(p)
        .await
        .unwrap();
    assert_eq!(left, vec!["tpl-rack".to_string()]);
    assert_eq!(int(p, r#"SELECT COUNT(*) FROM "RigRack""#).await, 1);
    assert_eq!(int(p, r#"SELECT COUNT(*) FROM "RackSlot""#).await, 0);

    // A template rack another rig shares, yet attached to a location (an
    // anomaly): the location goes, the rack stays, without the location.
    let (loc3, virt3) = c.new_location(&c.project, "Annexe").await;
    exec(p, &format!(r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr-v3','tpl-rig','{virt3}',1)"#)).await;
    let r = c.req("DELETE", &c.loc_url(&loc3), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        text(
            p,
            &format!(r#"SELECT "locationId" FROM "Rack" WHERE "id" = '{virt3}'"#)
        )
        .await,
        None
    );
    assert_eq!(
        int(
            p,
            &format!(r#"SELECT COUNT(*) FROM "RigRack" WHERE "rackId" = '{virt3}'"#)
        )
        .await,
        1,
        "seul le lien de la régie modèle reste"
    );
}

// ── catalogue de l'inventaire ───────────────────────────────────────────────

#[tokio::test]
async fn catalog_lists_active_local_items() {
    let c = ctx().await;
    let tenant = c.ok("GET", "/api/tenant/inventaire/catalog", None).await;
    let project = c
        .ok(
            "GET",
            &format!("{LIST}/{}/inventaire/catalog", c.project),
            None,
        )
        .await;
    assert_eq!(tenant, project);

    let ids = |key: &str| -> Vec<String> {
        tenant[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_string())
            .collect()
    };
    let eqs = ids("equipments");
    assert!(eqs.contains(&"eq1".to_string()));
    assert!(!eqs.contains(&"eq-off".to_string()));
    let ads = ids("adapters");
    assert!(ads.contains(&"ad1".to_string()));
    assert!(!ads.contains(&"ad-off".to_string()));

    let eq1 = tenant["equipments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "eq1")
        .unwrap();
    assert_eq!(eq1["brandName"], "Blackmagic");
    assert_eq!(eq1["categoryName"], "Vidéo");
    assert_eq!(eq1["categoryColor"], "#0000aa");
    assert_eq!(eq1["heightU"], 2);
    assert_eq!(eq1["source"], "PERSONAL");
    let ad1 = tenant["adapters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "ad1")
        .unwrap();
    assert_eq!(
        ad1,
        &json!({"id": "ad1", "name": "XLR F → Jack", "reference": "AD-1", "imageUrl": null,
                "categoryName": "Vidéo", "categoryColor": "#0000aa", "source": "PERSONAL"})
    );
    // Every panel, by name.
    let panels = tenant["panels"].as_array().unwrap();
    let ours: Vec<&Value> = panels
        .iter()
        .filter(|p| p["id"] == "pa1" || p["id"] == "pa2")
        .collect();
    assert_eq!(
        ours,
        vec![
            &json!({"id": "pa1", "name": "Bandeau", "reference": null, "type": "ACCESSORY", "heightU": 1}),
            &json!({"id": "pa2", "name": "Patch 48 BNC", "reference": null, "type": "PATCH", "heightU": 2}),
        ]
    );
    let names: Vec<&str> = panels.iter().map(|p| p["name"].as_str().unwrap()).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted);

    let r = c
        .req("GET", &format!("{LIST}/nope/inventaire/catalog"), None)
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    for path in [
        "/api/tenant/inventaire/catalog".to_string(),
        format!("{LIST}/{}/inventaire/catalog", c.project),
    ] {
        let r = call(&c.e.app, "GET", &path, LOCAL, None, None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{path}");
    }
}

// ── /api/tenant/racks ───────────────────────────────────────────────────────

#[tokio::test]
async fn tenant_racks_templates_only_actif() {
    let c = ctx().await;
    let p = &c.e.pool;
    for sql in [
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('tpl-rig','Modèle',1,'u',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","templateStatus","rackType","totalU","depthMm","hasWheels","createdAt","updatedAt") VALUES ('t-actif','Actif','ACTIF','PELICAN',8,450,1,'2030-01-01T00:00:00.000Z',?)"#,
        r#"INSERT INTO "Rack" ("id","name","templateStatus","createdAt","updatedAt") VALUES ('t-brouillon','Brouillon','BROUILLON','2030-01-02T00:00:00.000Z',?)"#,
        r#"INSERT INTO "Rack" ("id","name","templateStatus","createdAt","updatedAt") VALUES ('t-inactif','Inactif','INACTIF','2030-01-03T00:00:00.000Z',?)"#,
        r#"INSERT INTO "Rack" ("id","name","templateStatus","createdAt","updatedAt") VALUES ('t-rig','Dans un modèle','ACTIF','2030-01-04T00:00:00.000Z',?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr1','tpl-rig','t-rig',0)"#,
    ] {
        exec(p, sql).await;
    }
    insert_slot(p, "s1", "t-actif", None).await;
    insert_slot(p, "s2", "t-actif", None).await;
    // A project rack marked ACTIF stays out.
    exec(
        p,
        &format!(
            r#"UPDATE "Rack" SET "templateStatus" = 'ACTIF' WHERE "id" = '{}'"#,
            c.rack
        ),
    )
    .await;

    let r = c.ok("GET", "/api/tenant/racks?templates=true", None).await;
    assert_eq!(
        r,
        json!([
            {"id": "t-rig", "name": "Dans un modèle", "rackType": "STANDARD", "totalU": 42,
             "depthMm": 600, "hasWheels": false, "slotsCount": 0},
            {"id": "t-actif", "name": "Actif", "rackType": "PELICAN", "totalU": 8,
             "depthMm": 450, "hasWheels": true, "slotsCount": 2},
        ])
    );

    // Without the exact `true`: every rack, project ones included.
    for path in ["/api/tenant/racks", "/api/tenant/racks?templates=TRUE"] {
        let all = c.ok("GET", path, None).await;
        let ids: Vec<&str> = all
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids.len(), 7, "{path}: {ids:?}");
        assert_eq!(&ids[..4], &["t-rig", "t-inactif", "t-brouillon", "t-actif"]);
        for id in [&c.rack, &c.rack_b, &c.virt] {
            assert!(ids.contains(&id.as_str()));
        }
    }
    let r = call(&c.e.app, "GET", "/api/tenant/racks", LOCAL, None, None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}
