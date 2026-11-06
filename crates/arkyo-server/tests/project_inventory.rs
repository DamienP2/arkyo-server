//! Phase 4a, Task 4: inventory of a container
//! (`GET/POST /api/tenant/projects/:id/racks/:rackId/inventory`,
//! arkyo:app/api/tenant/projects/[id]/racks/[rackId]/inventory/route.ts).
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tokio::sync::broadcast::error::TryRecvError;
use tokio::sync::broadcast::Receiver;

const LIST: &str = "/api/tenant/projects";
const NOW: &str = "2026-11-06T10:00:00.000Z";
const UNKNOWN: &str = "Référence catalogue introuvable après création.";

struct Ctx {
    e: Env,
    tok: String,
    owner: String,
    project: String,
    rack: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    let o = add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let mut c = Ctx {
        e,
        tok,
        owner: o.id,
        project: String::new(),
        rack: String::new(),
    };
    let (project, rack) = c.project_with_rack("Match").await;
    c.project = project;
    c.rack = rack;
    catalogue_fixture(&c.e.pool).await;
    c
}

impl Ctx {
    async fn req(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, path, LOCAL, Some(&self.tok), body).await
    }

    /// A project, its first location and a rack in it.
    async fn project_with_rack(&self, name: &str) -> (String, String) {
        let r = self
            .req(
                "POST",
                LIST,
                Some(json!({"name": name, "interventionType": "PRESTATION"})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        let project = r.body["id"].as_str().unwrap().to_string();
        let r = self
            .req(
                "POST",
                &format!("{LIST}/{project}/locations"),
                Some(json!({"name": "Plateau"})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        let loc = r.body["id"].as_str().unwrap().to_string();
        let r = self
            .req(
                "POST",
                &format!("{LIST}/{project}/racks"),
                Some(json!({"racks": [{"name": "Baie A", "locationId": loc}]})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        let rack = r.body["racks"][0]["id"].as_str().unwrap().to_string();
        (project, rack)
    }

    fn url(&self) -> String {
        format!("{LIST}/{}/racks/{}/inventory", self.project, self.rack)
    }

    async fn post(&self, body: Value) -> Reply {
        self.req("POST", &self.url(), Some(body)).await
    }

    async fn post_ok(&self, body: Value, status: StatusCode) -> Value {
        let r = self.post(body.clone()).await;
        assert_eq!(r.status, status, "{body} → {:?}", r.body);
        r.body["item"].clone()
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

/// A brand, a category, two functions, `eq1` (active), `eq-off`
/// (inactive), a host `host-eq` (4 slots), a component `comp-eq` (span 2),
/// two adapters `ad1` / `ad-off` and a panel `pa1`.
async fn catalogue_fixture(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Blackmagic',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","createdAt","updatedAt") VALUES ('cat1','Régie','#112233',?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f-audio','t_audio','Audio','#00aa00',2,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f-video','t_video','Vidéo','#0000aa',1,?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","reference","brandId","categoryId","heightU","depthMm","widthFraction","weight","powerW","functionIds","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM 2 M/E','SWATEMPSW2ME','b1','cat1',2,400,'HALF',4.5,150,'["f-audio","f-video"]','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","categoryId","isActive","createdById","createdAt","updatedAt") VALUES ('eq-off','Vieux mixeur','cat1',0,'u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isComponentHost","hostSlotCount","createdById","createdAt","updatedAt") VALUES ('host-eq','Châssis',1,4,'u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isComponent","componentSlotSpan","isRackable","createdById","createdAt","updatedAt") VALUES ('comp-eq','Carte',1,2,0,'u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","reference","functionId","createdById","createdAt","updatedAt") VALUES ('ad1','XLR F → Jack','AD-1','f-audio','u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","isActive","createdById","createdAt","updatedAt") VALUES ('ad-off','Vieil adaptateur',0,'u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","createdById","createdAt","updatedAt") VALUES ('pa1','Patch 24 XLR','PATCH',1,'u',?,?)"#,
    ] {
        exec(pool, sql).await;
    }
}

/// `(startU, label)` of the slots of `item`.
async fn slots_of(pool: &SqlitePool, item: &str) -> Vec<(Option<i64>, Option<String>)> {
    sqlx::query_as(
        r#"SELECT "startU", "label" FROM "RackSlot" WHERE "inventoryItemId" = ? ORDER BY "createdAt", rowid"#,
    )
    .bind(item)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn is_auto_label(l: &str) -> bool {
    const CHARS: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    l.len() == 5 && l.starts_with('#') && l[1..].chars().all(|c| CHARS.contains(c))
}

/// The `after` of the audit entries of `item`.
async fn audit_after(pool: &SqlitePool, item: &str) -> Vec<Value> {
    let rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        r#"SELECT "action", "entityType", "projectId", "after" FROM "AuditLog" WHERE "entityId" = ? ORDER BY rowid"#,
    )
    .bind(item)
    .fetch_all(pool)
    .await
    .unwrap();
    rows.into_iter()
        .map(|(a, t, p, after)| {
            assert_eq!(
                (a.as_str(), t.as_str()),
                ("create_inventory_item", "RackInventoryItem")
            );
            assert!(p.is_some());
            serde_json::from_str(&after).unwrap()
        })
        .collect()
}

async fn next_event(rx: &mut Receiver<String>) -> Value {
    let s = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
        .await
        .expect("évènement attendu")
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

fn assert_inventory_event(ev: &Value, c: &Ctx, item: &str) {
    assert_eq!(
        ev,
        &json!({
            "type": "update",
            "entity": "rack_inventory",
            "action": "updated",
            "id": c.rack,
            "projectId": c.project,
            "rackId": c.rack,
            "itemId": item,
        })
    );
}

// ── équipement : création, slots fantômes, audit, évènement, GET ───────────

#[tokio::test]
async fn add_equipment_creates_item_and_ghost_slot() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();

    let item = c
        .post_ok(
            json!({"catalogEquipmentId": "eq1", "quantity": 2}),
            StatusCode::CREATED,
        )
        .await;
    let id = item["id"].as_str().unwrap().to_string();
    assert_eq!(id.len(), 25);
    assert_eq!(
        item,
        json!({
            "id": id,
            "kind": "equipment",
            "refId": "eq1",
            "quantity": 2,
            "name": "ATEM 2 M/E",
            "reference": "SWATEMPSW2ME",
            "imageUrl": null,
            "brandName": "Blackmagic",
            "heightU": 2,
            "widthFraction": "HALF",
            "panelType": null,
            "weightKg": 4.5,
            "powerW": 150,
            "depthMm": 400,
            "isRackable": true,
            "category": "Vidéo",
            "categoryColor": "#0000aa",
            "snapshotId": null,
            "hostItemId": null,
            "hostSlotIndex": null,
            "isComponentHost": false,
            "hostSlotCount": null,
            "isComponent": false,
            "componentSlotSpan": 1,
        })
    );

    // Two ghost slots (startU null), auto-labelled #XXXX.
    let slots = slots_of(&c.e.pool, &id).await;
    assert_eq!(slots.len(), 2);
    for (start, label) in &slots {
        assert_eq!(*start, None);
        assert!(is_auto_label(label.as_deref().unwrap()), "{label:?}");
    }
    let (rack_id, eq, view, width): (String, String, String, String) = sqlx::query_as(
        r#"SELECT "rackId","catalogEquipmentId","view","widthFraction" FROM "RackSlot" WHERE "inventoryItemId" = ? LIMIT 1"#,
    )
    .bind(&id)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        (rack_id.as_str(), eq.as_str(), view.as_str(), width.as_str()),
        (c.rack.as_str(), "eq1", "FRONT", "FULL")
    );

    // Audit and app event, with arkyo's meta (no clientId).
    assert_eq!(
        audit_after(&c.e.pool, &id).await,
        vec![json!({"rackId": c.rack, "refKind": "equipment", "refId": "eq1", "quantity": 2})]
    );
    let user: String =
        sqlx::query_scalar(r#"SELECT "userId" FROM "AuditLog" WHERE "entityId" = ?"#)
            .bind(&id)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(user, c.owner);
    assert_inventory_event(&next_event(&mut rx).await, &c, &id);

    // Legacy `equipmentId`, inactive catalogue item accepted (arkyo).
    let off = c
        .post_ok(json!({"equipmentId": "eq-off"}), StatusCode::CREATED)
        .await;
    assert_eq!(off["refId"], "eq-off");
    assert_eq!(off["quantity"], 1);
    assert_eq!(off["category"], "Régie");
    assert_eq!(off["categoryColor"], "#112233");
    assert_eq!(
        slots_of(&c.e.pool, off["id"].as_str().unwrap()).await.len(),
        1
    );

    // An adapter: no slot.
    let ad = c
        .post_ok(json!({"catalogAdapterId": "ad1"}), StatusCode::CREATED)
        .await;
    assert_eq!(ad["kind"], "adapter");
    assert_eq!(ad["category"], "Audio");
    assert_eq!(ad["isRackable"], false);
    assert!(slots_of(&c.e.pool, ad["id"].as_str().unwrap())
        .await
        .is_empty());

    // GET: createdAt asc, orphans (equipment gone from the catalogue) dropped.
    let r = c.req("GET", &c.url(), None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let items = r.body["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items[0], item);
    assert_eq!(items[1]["refId"], "eq-off");
    assert_eq!(items[2]["refId"], "ad1");
    exec(
        &c.e.pool,
        r#"DELETE FROM "TenantEquipment" WHERE "id" = 'eq-off'"#,
    )
    .await;
    let r = c.req("GET", &c.url(), None).await;
    let refs: Vec<&str> = r.body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["refId"].as_str().unwrap())
        .collect();
    assert_eq!(refs, ["eq1", "ad1"]);

    // GET of a rack outside the project.
    let (other, other_rack) = c.project_with_rack("Autre").await;
    let r = c
        .req(
            "GET",
            &format!("{LIST}/{}/racks/{other_rack}/inventory", c.project),
            None,
        )
        .await;
    assert_eq!(
        (r.status, r.body.clone()),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    let r = c
        .req(
            "GET",
            &format!("{LIST}/{other}/racks/{other_rack}/inventory"),
            None,
        )
        .await;
    assert_eq!(r.body, json!({"items": []}));
}

// ── composants modulaires ───────────────────────────────────────────────────

#[tokio::test]
async fn add_component_into_host() {
    let c = ctx().await;

    // A host is never merged: one row per unit, quantity forced to 1.
    let host = c
        .post_ok(
            json!({"catalogEquipmentId": "host-eq", "quantity": 3}),
            StatusCode::CREATED,
        )
        .await;
    let host_id = host["id"].as_str().unwrap().to_string();
    assert_eq!(host["quantity"], 1);
    assert_eq!(host["isComponentHost"], true);
    assert_eq!(host["hostSlotCount"], 4);
    assert_eq!(slots_of(&c.e.pool, &host_id).await.len(), 1);

    let mut rx = c.e.events.subscribe();
    let comp = c
        .post_ok(
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": host_id, "hostSlotIndex": 0, "quantity": 5}),
            StatusCode::CREATED,
        )
        .await;
    let comp_id = comp["id"].as_str().unwrap().to_string();
    assert_eq!(comp["hostItemId"], host_id.as_str());
    assert_eq!(comp["hostSlotIndex"], 0);
    assert_eq!(comp["quantity"], 1);
    assert_eq!(comp["isComponent"], true);
    assert_eq!(comp["componentSlotSpan"], 2);
    // No slot of its own.
    assert!(slots_of(&c.e.pool, &comp_id).await.is_empty());
    assert_eq!(
        audit_after(&c.e.pool, &comp_id).await,
        vec![
            json!({"rackId": c.rack, "refKind": "equipment", "refId": "comp-eq", "quantity": 1,
                    "hostItemId": host_id, "hostSlotIndex": 0})
        ]
    );
    assert_inventory_event(&next_event(&mut rx).await, &c, &comp_id);

    // arkyo's errors, in its order.
    let eq1 = c
        .post_ok(json!({"catalogEquipmentId": "eq1"}), StatusCode::CREATED)
        .await;
    let eq1_id = eq1["id"].as_str().unwrap();
    let cases = [
        (
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": host_id}),
            StatusCode::BAD_REQUEST,
            "hostItemId et hostSlotIndex doivent être fournis ensemble",
        ),
        (
            json!({"catalogEquipmentId": "comp-eq", "hostSlotIndex": 2}),
            StatusCode::BAD_REQUEST,
            "hostItemId et hostSlotIndex doivent être fournis ensemble",
        ),
        (
            json!({"panelId": "pa1", "hostItemId": host_id, "hostSlotIndex": 2}),
            StatusCode::BAD_REQUEST,
            "Seul un équipement peut être installé comme composant",
        ),
        (
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": "nope", "hostSlotIndex": 2}),
            StatusCode::NOT_FOUND,
            "Not found",
        ),
        (
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": comp_id, "hostSlotIndex": 0}),
            StatusCode::BAD_REQUEST,
            "Impossible d'imbriquer un composant dans un composant",
        ),
        (
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": eq1_id, "hostSlotIndex": 0}),
            StatusCode::BAD_REQUEST,
            "Cet équipement ne peut pas accueillir de composants",
        ),
        (
            json!({"catalogEquipmentId": "nope", "hostItemId": host_id, "hostSlotIndex": 2}),
            StatusCode::NOT_FOUND,
            "Équipement composant introuvable",
        ),
        (
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": host_id, "hostSlotIndex": 3}),
            StatusCode::BAD_REQUEST,
            "Composant hors des limites de l'équipement modulaire",
        ),
        (
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": host_id, "hostSlotIndex": 1}),
            StatusCode::CONFLICT,
            "Slot occupé",
        ),
        (
            json!({"catalogEquipmentId": "host-eq", "cloneComponentsFromItemId": "nope"}),
            StatusCode::BAD_REQUEST,
            "Exemplaire source introuvable dans ce rack",
        ),
        (
            json!({"catalogEquipmentId": "host-eq", "cloneComponentsFromItemId": comp_id}),
            StatusCode::BAD_REQUEST,
            "Impossible de dupliquer depuis un composant",
        ),
    ];
    let before = int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackInventoryItem""#).await;
    for (body, status, msg) in cases {
        let r = c.post(body.clone()).await;
        assert_eq!(
            (r.status, r.body.clone()),
            (status, json!({ "error": msg })),
            "{body}"
        );
    }
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackInventoryItem""#).await,
        before
    );

    // The free half of the host takes another card.
    c.post_ok(
        json!({"catalogEquipmentId": "comp-eq", "hostItemId": host_id, "hostSlotIndex": 2}),
        StatusCode::CREATED,
    )
    .await;

    // A second unit cloning the first one's components.
    let host2 = c
        .post_ok(
            json!({"catalogEquipmentId": "host-eq", "cloneComponentsFromItemId": host_id}),
            StatusCode::CREATED,
        )
        .await;
    let host2_id = host2["id"].as_str().unwrap();
    assert_ne!(host2_id, host_id);
    let cloned: Vec<(String, i64, i64)> = sqlx::query_as(
        r#"SELECT "catalogEquipmentId","hostSlotIndex","quantity" FROM "RackInventoryItem"
           WHERE "hostItemId" = ? ORDER BY "hostSlotIndex""#,
    )
    .bind(host2_id)
    .fetch_all(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        cloned,
        vec![("comp-eq".into(), 0, 1), ("comp-eq".into(), 2, 1)]
    );
    assert_eq!(slots_of(&c.e.pool, host2_id).await.len(), 1);
    assert_eq!(
        audit_after(&c.e.pool, host2_id).await,
        vec![
            json!({"rackId": c.rack, "refKind": "equipment", "refId": "host-eq", "quantity": 1,
                    "clonedComponentsFrom": host_id, "clonedComponentCount": 2})
        ]
    );

    // GET lists the components with their host.
    let r = c.req("GET", &c.url(), None).await;
    let items = r.body["items"].as_array().unwrap();
    let in_host2 = items.iter().filter(|i| i["hostItemId"] == host2_id).count();
    assert_eq!(in_host2, 2);

    // Deleting a host takes its components along (cascade).
    exec(
        &c.e.pool,
        &format!(r#"DELETE FROM "RackInventoryItem" WHERE "id" = '{host_id}'"#),
    )
    .await;
    assert_eq!(
        int(
            &c.e.pool,
            &format!(
                r#"SELECT COUNT(*) FROM "RackInventoryItem" WHERE "hostItemId" = '{host_id}'"#
            )
        )
        .await,
        0
    );
}

// ── dédoublonnage ───────────────────────────────────────────────────────────

/// arkyo-server: `quantity` plafonnée à 999 (une transaction SQLite verrouille
/// toute la base pendant la création des slots fantômes).
#[tokio::test]
async fn quantity_is_capped_at_999() {
    let c = ctx().await;
    let too_big = json!({"error": "Validation invalide", "issues": [
        {"path": ["quantity"], "message": "Too big: expected number to be <=999"}
    ]});
    let audit_before = int(&c.e.pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await;

    // Creation over the cap: 400, nothing written.
    for body in [
        json!({"catalogEquipmentId": "eq1", "quantity": 1000}),
        json!({"catalogAdapterId": "ad1", "quantity": 9007199254740991_i64}),
    ] {
        let r = c.post(body.clone()).await;
        assert_eq!(
            (r.status, r.body.clone()),
            (StatusCode::BAD_REQUEST, too_big.clone()),
            "{body}"
        );
    }
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackInventoryItem""#).await,
        0
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackSlot""#).await,
        0
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await,
        audit_before
    );

    // Merge: up to 999 is fine, beyond is a 400 and the row is unchanged.
    let ad = c
        .post_ok(
            json!({"catalogAdapterId": "ad1", "quantity": 998}),
            StatusCode::CREATED,
        )
        .await;
    let r = c
        .post(json!({"catalogAdapterId": "ad1", "quantity": 2}))
        .await;
    assert_eq!(
        (r.status, r.body.clone()),
        (StatusCode::BAD_REQUEST, too_big.clone())
    );
    let merged = c
        .post_ok(json!({"catalogAdapterId": "ad1"}), StatusCode::OK)
        .await;
    assert_eq!(
        (merged["id"].clone(), merged["quantity"].clone()),
        (ad["id"].clone(), json!(999))
    );
    let r = c.post(json!({"catalogAdapterId": "ad1"})).await;
    assert_eq!((r.status, r.body), (StatusCode::BAD_REQUEST, too_big));
    assert_eq!(
        int(
            &c.e.pool,
            r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "catalogAdapterId" = 'ad1'"#
        )
        .await,
        999
    );
}

#[tokio::test]
async fn duplicate_add_merges_quantity_like_arkyo() {
    let c = ctx().await;

    let first = c
        .post_ok(json!({"catalogEquipmentId": "eq1"}), StatusCode::CREATED)
        .await;
    let id = first["id"].as_str().unwrap().to_string();
    let mut rx = c.e.events.subscribe();
    // Merge: 200, same row, quantity added, ghosts follow.
    let merged = c
        .post_ok(
            json!({"catalogEquipmentId": "eq1", "quantity": 2}),
            StatusCode::OK,
        )
        .await;
    assert_eq!(merged["id"], id.as_str());
    assert_eq!(merged["quantity"], 3);
    assert_eq!(slots_of(&c.e.pool, &id).await.len(), 3);
    assert_eq!(
        audit_after(&c.e.pool, &id).await[1],
        json!({"rackId": c.rack, "refKind": "equipment", "refId": "eq1", "quantity": 3})
    );
    assert_inventory_event(&next_event(&mut rx).await, &c, &id);
    // The legacy field merges into the same row.
    let again = c
        .post_ok(json!({"equipmentId": "eq1"}), StatusCode::OK)
        .await;
    assert_eq!(
        (again["id"].clone(), again["quantity"].clone()),
        (json!(id), json!(4))
    );

    // Panel: merged, with ghost slots.
    let p = c
        .post_ok(json!({"panelId": "pa1"}), StatusCode::CREATED)
        .await;
    let p2 = c
        .post_ok(json!({"panelId": "pa1", "quantity": 1}), StatusCode::OK)
        .await;
    assert_eq!(p2["id"], p["id"]);
    assert_eq!(p2["quantity"], 2);
    assert_eq!(p2["kind"], "panel");
    assert_eq!(p2["panelType"], "PATCH");
    assert_eq!(p2["category"], "Panels de patch");
    assert_eq!(
        slots_of(&c.e.pool, p["id"].as_str().unwrap()).await.len(),
        2
    );

    // Adapter (legacy `adapterId` too): merged, no slot.
    let a = c
        .post_ok(json!({"catalogAdapterId": "ad1"}), StatusCode::CREATED)
        .await;
    let a2 = c.post_ok(json!({"adapterId": "ad1"}), StatusCode::OK).await;
    assert_eq!(
        (a2["id"].clone(), a2["quantity"].clone()),
        (a["id"].clone(), json!(2))
    );

    // Accessories merge on type + height + variant + depth.
    let plaque =
        json!({"accessoryType": "plaque", "accessoryHeightU": 2, "accessoryVariant": "aere"});
    let pl = c.post_ok(plaque.clone(), StatusCode::CREATED).await;
    assert_eq!(pl["name"], "Plaque aérée 2U");
    assert_eq!(pl["kind"], "accessory");
    assert_eq!(pl["accessoryVariant"], "aere");
    assert!(pl.get("refId").is_none());
    assert!(pl.get("accessoryDepthMm").is_none());
    let pl_id = pl["id"].as_str().unwrap().to_string();
    let pl2 = c.post_ok(plaque, StatusCode::OK).await;
    assert_eq!(
        (pl2["id"].clone(), pl2["quantity"].clone()),
        (json!(pl_id), json!(2))
    );
    assert!(slots_of(&c.e.pool, &pl_id).await.is_empty());
    assert_eq!(
        audit_after(&c.e.pool, &pl_id).await[0],
        json!({"rackId": c.rack, "refKind": "accessory", "accessoryType": "plaque",
               "accessoryHeightU": 2, "accessoryVariant": "aere", "accessoryDepthMm": null,
               "quantity": 1})
    );
    // Another variant, another depth: other rows.
    let plein = c
        .post_ok(
            json!({"accessoryType": "plaque", "accessoryHeightU": 2, "accessoryVariant": "plein"}),
            StatusCode::CREATED,
        )
        .await;
    assert_ne!(plein["id"], json!(pl_id));
    let shelf = json!({"accessoryType": "etagere", "accessoryHeightU": 1, "accessoryDepthMm": 450,
                       "accessoryVariant": "aere"});
    let s1 = c.post_ok(shelf.clone(), StatusCode::CREATED).await;
    assert_eq!(s1["name"], "Étagère 1U · 450mm");
    assert_eq!(s1["depthMm"], 450);
    // The shelf's variant is ignored (validateInventoryRef), so it merges.
    let s2 = c
        .post_ok(
            json!({"accessoryType": "etagere", "accessoryHeightU": 1, "accessoryDepthMm": 450}),
            StatusCode::OK,
        )
        .await;
    assert_eq!(s2["id"], s1["id"]);
    let s3 = c
        .post_ok(
            json!({"accessoryType": "etagere", "accessoryHeightU": 1, "accessoryDepthMm": 600}),
            StatusCode::CREATED,
        )
        .await;
    assert_ne!(s3["id"], s1["id"]);

    // A host is never merged.
    let h1 = c
        .post_ok(
            json!({"catalogEquipmentId": "host-eq"}),
            StatusCode::CREATED,
        )
        .await;
    let h2 = c
        .post_ok(
            json!({"catalogEquipmentId": "host-eq"}),
            StatusCode::CREATED,
        )
        .await;
    assert_ne!(h1["id"], h2["id"]);

    // arkyo-server: correction. arkyo's dedup did not filter `hostItemId IS
    // NULL` (annex B): a top-level add raised the component's row. Here it
    // gets its own row and the component stays at quantity 1.
    let comp = c
        .post_ok(
            json!({"catalogEquipmentId": "comp-eq", "hostItemId": h1["id"], "hostSlotIndex": 0}),
            StatusCode::CREATED,
        )
        .await;
    let top = c
        .post_ok(
            json!({"catalogEquipmentId": "comp-eq"}),
            StatusCode::CREATED,
        )
        .await;
    assert_ne!(top["id"], comp["id"]);
    assert_eq!(top["quantity"], 1);
    assert_eq!(top["hostItemId"], Value::Null);
    let comp_qty = int(
        &c.e.pool,
        &format!(
            r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "id" = '{}'"#,
            comp["id"].as_str().unwrap()
        ),
    )
    .await;
    assert_eq!(comp_qty, 1);
    // A second top-level add merges into the top-level row, not the component.
    let merged = c
        .post_ok(json!({"catalogEquipmentId": "comp-eq"}), StatusCode::OK)
        .await;
    assert_eq!(merged["id"], top["id"]);
    assert_eq!(merged["quantity"], 2);
}

// ── références invalides : rien n'est écrit ─────────────────────────────────

#[tokio::test]
async fn invalid_ref_is_rejected_nothing_written() {
    let c = ctx().await;
    let (other, other_rack) = c.project_with_rack("Autre").await;
    let mut rx = c.e.events.subscribe();
    let audit_before = int(&c.e.pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await;

    let msg = |m: &str| json!({ "error": m });
    let cases: Vec<(Value, StatusCode, Value)> = vec![
        (
            json!({}),
            StatusCode::BAD_REQUEST,
            msg("Référence catalogue manquante"),
        ),
        (
            json!({"catalogEquipmentId": "", "panelId": null}),
            StatusCode::BAD_REQUEST,
            msg("Référence catalogue manquante"),
        ),
        (
            json!({"catalogEquipmentId": "eq1", "panelId": "pa1"}),
            StatusCode::BAD_REQUEST,
            msg("Plusieurs références catalogue fournies — exactement une attendue"),
        ),
        (
            json!({"accessoryType": "plaque"}),
            StatusCode::BAD_REQUEST,
            msg("Accessoire incomplet : type et hauteur U requis"),
        ),
        (
            json!({"accessoryType": "plaque", "accessoryHeightU": 1}),
            StatusCode::BAD_REQUEST,
            msg("Variant requis pour les plaques"),
        ),
        (
            json!({"accessoryType": "tiroir", "accessoryHeightU": 1}),
            StatusCode::BAD_REQUEST,
            msg("Profondeur requise pour les étagères et tiroirs"),
        ),
        (
            json!({"catalogEquipmentId": "nope"}),
            StatusCode::NOT_FOUND,
            msg(UNKNOWN),
        ),
        (
            json!({"panelId": "nope"}),
            StatusCode::NOT_FOUND,
            msg(UNKNOWN),
        ),
        (
            json!({"catalogAdapterId": "nope"}),
            StatusCode::NOT_FOUND,
            msg(UNKNOWN),
        ),
        // Zod (`Validation invalide` + issues).
        (
            json!({"catalogEquipmentId": "eq1", "quantity": 0}),
            StatusCode::BAD_REQUEST,
            json!({"error": "Validation invalide", "issues": [
                {"path": ["quantity"], "message": "Too small: expected number to be >=1"}
            ]}),
        ),
        (
            json!({"catalogEquipmentId": "eq1", "quantity": null, "accessoryType": "rail",
                   "accessoryHeightU": 9, "hostSlotIndex": 1.5}),
            StatusCode::BAD_REQUEST,
            json!({"error": "Validation invalide", "issues": [
                {"path": ["accessoryType"], "message": r#"Invalid option: expected one of "plaque"|"etagere"|"tiroir""#},
                {"path": ["accessoryHeightU"], "message": "Too big: expected number to be <=8"},
                {"path": ["quantity"], "message": "Invalid input: expected number, received null"},
                {"path": ["hostSlotIndex"], "message": "Invalid input: expected int, received number"},
            ]}),
        ),
        (
            json!(["eq1"]),
            StatusCode::BAD_REQUEST,
            json!({"error": "Validation invalide", "issues": [
                {"path": ["root"], "message": "Invalid input: expected object, received array"}
            ]}),
        ),
    ];
    for (body, status, expected) in cases {
        let r = c.post(body.clone()).await;
        assert_eq!((r.status, r.body.clone()), (status, expected), "{body}");
    }

    // A rack outside the project, or unknown: 404 before the body is read.
    for url in [
        format!("{LIST}/{}/racks/{other_rack}/inventory", c.project),
        format!("{LIST}/{other}/racks/{}/inventory", c.rack),
        format!("{LIST}/{}/racks/nope/inventory", c.project),
    ] {
        let r = c
            .req("POST", &url, Some(json!({"catalogEquipmentId": "eq1"})))
            .await;
        assert_eq!(
            (r.status, r.body.clone()),
            (StatusCode::NOT_FOUND, json!({"error": "Not found"})),
            "{url}"
        );
    }

    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackInventoryItem""#).await,
        0
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackSlot""#).await,
        0
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await,
        audit_before
    );
    assert!(matches!(rx.try_recv(), Err(TryRecvError::Empty)));
}

// ── gardes ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn consultation_cannot_write() {
    let c = ctx().await;
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;

    let r = call(
        &c.e.app,
        "POST",
        &c.url(),
        LOCAL,
        Some(&ct),
        Some(json!({"catalogEquipmentId": "eq1"})),
    )
    .await;
    assert_eq!(
        (r.status, r.body.clone()),
        (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"}))
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackInventoryItem""#).await,
        0
    );

    // Reading only needs a session.
    c.post_ok(json!({"catalogEquipmentId": "eq1"}), StatusCode::CREATED)
        .await;
    let r = call(&c.e.app, "GET", &c.url(), LOCAL, Some(&ct), None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["items"].as_array().unwrap().len(), 1);

    for method in ["GET", "POST"] {
        let r = call(
            &c.e.app,
            method,
            &c.url(),
            LOCAL,
            None,
            Some(json!({"catalogEquipmentId": "eq1"})),
        )
        .await;
        assert_eq!(
            (r.status, r.body),
            (
                StatusCode::UNAUTHORIZED,
                json!({"error": "Non authentifié"})
            ),
            "{method}"
        );
    }
}
