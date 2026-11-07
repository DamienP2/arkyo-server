//! Phase 4b, Task 1: rack slots
//! (`POST/DELETE /api/racks/:id/slots`, `PATCH/DELETE /api/racks/:id/slots/:slotId`,
//! arkyo:app/api/racks/[id]/slots/route.ts and [slotId]/route.ts).
mod common;
use std::net::SocketAddr;
use std::time::Duration;

use arkyo_server::events::RackSubscription;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tokio::sync::broadcast::error::TryRecvError;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

const LIST: &str = "/api/tenant/projects";
const NOW: &str = "2026-11-07T10:00:00.000Z";
const CLIENT: &str = "tab-1";
const VIEW_MSG: &str = r#"Invalid option: expected one of "FRONT"|"REAR"|"REAR_INTERIOR"|"SIDE""#;
const REFINE_MSG: &str = "catalogEquipmentId, panelId, or (label + heightU) required";

struct Ctx {
    e: Env,
    tok: String,
    project: String,
    rack: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let mut c = Ctx {
        e,
        tok,
        project: String::new(),
        rack: String::new(),
    };
    let r = c
        .send(
            "POST",
            LIST,
            Some(json!({"name": "Match", "interventionType": "PRESTATION"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    c.project = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .send(
            "POST",
            &format!("{LIST}/{}/locations", c.project),
            Some(json!({"name": "Plateau"})),
        )
        .await;
    let loc = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .send(
            "POST",
            &format!("{LIST}/{}/racks", c.project),
            Some(json!({"racks": [{"name": "Baie A", "locationId": loc}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    c.rack = r.body["racks"][0]["id"].as_str().unwrap().to_string();
    catalogue_fixture(&c.e.pool).await;
    c
}

impl Ctx {
    /// A request of the owner, with `X-Client-Id: tab-1`.
    async fn send(&self, method: &str, uri: &str, body: Option<Value>) -> Reply {
        send_as(&self.e, Some(&self.tok), method, uri, body).await
    }

    fn slots(&self) -> String {
        format!("/api/racks/{}/slots", self.rack)
    }

    fn slot(&self, id: &str) -> String {
        format!("/api/racks/{}/slots/{id}", self.rack)
    }

    async fn place(&self, body: Value) -> Value {
        let r = self.send("POST", &self.slots(), Some(body.clone())).await;
        assert_eq!(r.status, StatusCode::CREATED, "{body} → {:?}", r.body);
        r.body
    }

    /// Adds `quantity` of `eq` to the rack's inventory (ghost slots).
    async fn inventory(&self, eq: &str, quantity: i64) {
        let r = self
            .send(
                "POST",
                &format!("{LIST}/{}/racks/{}/inventory", self.project, self.rack),
                Some(json!({"catalogEquipmentId": eq, "quantity": quantity})),
            )
            .await;
        assert!(r.status.is_success(), "{:?}", r.body);
    }
}

async fn send_as(
    e: &Env,
    tok: Option<&str>,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> Reply {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-client-id", CLIENT);
    if let Some(t) = tok {
        b = b.header(header::COOKIE, format!("arkyo_session={t}"));
    }
    let mut req = match body {
        Some(v) => b
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(v.to_string())),
        None => b.body(Body::empty()),
    }
    .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    let res = e.app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        cookie: None,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
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

/// A brand, `eq1` (2U, HALF), `eq-nh` (no height), `eq2` and a panel `pa1`
/// (1U) with two connector slots.
async fn catalogue_fixture(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Blackmagic',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","reference","brandId","heightU","widthFraction","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM 2 M/E','SWATEMPSW2ME','b1',2,'HALF','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","createdById","createdAt","updatedAt") VALUES ('eq-nh','Boîtier','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","heightU","createdById","createdAt","updatedAt") VALUES ('eq2','Routeur',1,'u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","slotsPerU","createdById","createdAt","updatedAt") VALUES ('pa1','Patch 24 XLR','PATCH',1,24,'u',?,?)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","sizeSlots","label","catalogConnectorTypeId","mountD") VALUES ('ps1','pa1',0,1,'IN 1','ct1',1)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position") VALUES ('ps2','pa1',1)"#,
    ] {
        exec(pool, sql).await;
    }
}

async fn next_app(rx: &mut Receiver<String>) -> Value {
    let s = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("évènement app attendu")
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

async fn next_rack(rx: &mut RackSubscription) -> Value {
    let s = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("évènement rack attendu")
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

async fn no_rack_event(rx: &mut RackSubscription) {
    assert!(
        tokio::time::timeout(Duration::from_millis(50), rx.recv())
            .await
            .is_err(),
        "aucun évènement rack attendu"
    );
}

fn app_event(entity: &str, action: &str, id: &str, meta: Value) -> Value {
    let mut ev = json!({"type": "update", "entity": entity, "action": action, "id": id});
    for (k, v) in meta.as_object().unwrap() {
        ev[k] = v.clone();
    }
    ev
}

fn is_auto_label(l: &str) -> bool {
    const CHARS: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    l.len() == 5 && l.starts_with('#') && l[1..].chars().all(|c| CHARS.contains(c))
}

/// `(startU, heightU, label, inventoryItemId)` of a slot.
async fn slot_row(
    pool: &SqlitePool,
    id: &str,
) -> Option<(Option<i64>, Option<f64>, Option<String>, Option<String>)> {
    sqlx::query_as(
        r#"SELECT "startU", "heightU", "label", "inventoryItemId" FROM "RackSlot" WHERE "id" = ?"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .unwrap()
}

async fn quantity(pool: &SqlitePool, rack: &str, eq: &str) -> i64 {
    sqlx::query_scalar(
        r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "rackId" = ? AND "catalogEquipmentId" = ?"#,
    )
    .bind(rack)
    .bind(eq)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Rows written by any slot route.
async fn snapshot(pool: &SqlitePool) -> Vec<i64> {
    let mut out = Vec::new();
    for t in [
        "RackSlot",
        "RackInventoryItem",
        "AuditLog",
        "SynopticAdapter",
        "RackConnection",
    ] {
        out.push(int(pool, &format!(r#"SELECT COUNT(*) FROM "{t}""#)).await);
    }
    out.push(
        int(
            pool,
            r#"SELECT COALESCE(SUM("quantity"), 0) FROM "RackInventoryItem""#,
        )
        .await,
    );
    out
}

// ── POST : pose ────────────────────────────────────────────────────────────

#[tokio::test]
async fn place_equipment_in_free_units() {
    let c = ctx().await;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    // Nothing in the inventory: a row is created, its ghost is placed.
    let slot = c
        .place(json!({"equipmentId": "eq1", "startU": 3, "widthFraction": "HALF", "column": 1}))
        .await;
    let id = slot["id"].as_str().unwrap().to_string();
    assert_eq!(slot["rackId"], json!(c.rack));
    assert_eq!(slot["catalogEquipmentId"], json!("eq1"));
    assert_eq!(slot["view"], json!("FRONT"));
    assert_eq!(slot["startU"], json!(3));
    assert_eq!(slot["heightU"].as_f64(), Some(2.0), "hauteur du catalogue");
    assert_eq!(slot["widthFraction"], json!("HALF"));
    assert_eq!(slot["column"], json!(1));
    assert!(is_auto_label(slot["label"].as_str().unwrap()), "{slot}");
    assert_eq!(slot["panel"], Value::Null);
    assert_eq!(slot["children"], json!([]));
    assert_eq!(slot["parentSlotId"], Value::Null);
    assert!(
        slot.get("inventoryItemId").is_none(),
        "non renvoyé par arkyo"
    );
    assert_eq!(
        slot["equipment"],
        json!({"id": "eq1", "name": "ATEM 2 M/E", "reference": "SWATEMPSW2ME", "heightU": 2,
               "widthFraction": "HALF", "brand": {"id": "b1", "name": "Blackmagic"}})
    );
    assert_eq!(quantity(&c.e.pool, &c.rack, "eq1").await, 1);
    let item: String = sqlx::query_scalar(r#"SELECT "id" FROM "RackInventoryItem""#)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(
        slot_row(&c.e.pool, &id).await.unwrap().3.as_deref(),
        Some(item.as_str())
    );
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "slot_added", "slot": slot})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(
            "slot",
            "created",
            &id,
            json!({"rackId": c.rack, "clientId": CLIENT})
        )
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(
            "rack_inventory",
            "updated",
            &c.rack,
            json!({"rackId": c.rack, "itemId": item, "clientId": CLIENT})
        )
    );
    let audit: (String, String, String) = sqlx::query_as(
        r#"SELECT "action", "entityType", "entityId" FROM "AuditLog" ORDER BY rowid DESC LIMIT 1"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        audit,
        ("rackSlot.create".into(), "RackSlot".into(), id.clone())
    );

    // A ghost already exists (inventory +1): it is claimed, the client knew
    // it, so `slot_updated` and no inventory event.
    c.inventory("eq1", 1).await;
    while app.try_recv().is_ok() {}
    let ghost: String = sqlx::query_scalar(
        r#"SELECT "id" FROM "RackSlot" WHERE "startU" IS NULL AND "catalogEquipmentId" = 'eq1'"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    let claimed = c
        .place(json!({"catalogEquipmentId": "eq1", "startU": 10, "heightU": 1.5, "view": "REAR"}))
        .await;
    assert_eq!(claimed["id"], json!(ghost));
    assert_eq!(claimed["heightU"].as_f64(), Some(1.5));
    assert_eq!(claimed["view"], json!("REAR"));
    assert_eq!(claimed["widthFraction"], json!("FULL"), "défaut d'arkyo");
    assert_eq!(quantity(&c.e.pool, &c.rack, "eq1").await, 2);
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "slot_updated", "slot": claimed})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(
            "slot",
            "updated",
            &ghost,
            json!({"rackId": c.rack, "clientId": CLIENT})
        )
    );
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));

    // Unknown height in the catalogue: 1U.
    let nh = c.place(json!({"equipmentId": "eq-nh", "startU": 20})).await;
    assert_eq!(nh["heightU"].as_f64(), Some(1.0));
    assert_eq!(nh["equipment"]["brand"], Value::Null);

    // A panel: its height, its `panel` with the connector slots.
    let p = c.place(json!({"panelId": "pa1", "startU": 30})).await;
    assert_eq!(p["heightU"].as_f64(), Some(1.0));
    assert_eq!(p["equipment"], Value::Null);
    assert_eq!(
        p["panel"],
        json!({"id": "pa1", "name": "Patch 24 XLR", "heightU": 1, "slotsPerU": 24,
               "rearCableDepthMm": 80, "slots": [
                 {"id": "ps1", "position": 0, "sizeSlots": 1, "label": "IN 1", "notes": null,
                  "catalogConnectorTypeId": "ct1", "mountD": true},
                 {"id": "ps2", "position": 1, "sizeSlots": 1, "label": null, "notes": null,
                  "catalogConnectorTypeId": null, "mountD": false}]})
    );
    let pq: i64 = int(
        &c.e.pool,
        r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "panelId" = 'pa1'"#,
    )
    .await;
    assert_eq!(pq, 1);

    // An accessory (label + heightU): a plain slot, outside the inventory.
    while app.try_recv().is_ok() {}
    let acc = c
        .place(json!({"label": "Plaque pleine", "heightU": 1, "startU": 40,
                      "notes": "{\"accessoryType\":\"plaque\"}"}))
        .await;
    let acc_id = acc["id"].as_str().unwrap();
    assert_eq!(acc["label"], json!("Plaque pleine"));
    assert_eq!(slot_row(&c.e.pool, acc_id).await.unwrap().3, None);
    assert_eq!(next_app(&mut app).await["action"], json!("created"));
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));
    // Drain the rack stream: slot_added for eq-nh, the panel and the accessory.
    for _ in 0..3 {
        assert_eq!(next_rack(&mut rack).await["type"], json!("slot_added"));
    }
    no_rack_event(&mut rack).await;
}

/// Schema and reference refusals only (out-of-range `startU`/`column`/
/// `heightU`, enums, unknown or full shelf, unknown reference): despite the
/// name, there is no server-side collision check, as in arkyo; see
/// [`overlap_is_left_to_the_canvas_like_arkyo`].
#[tokio::test]
async fn collision_and_out_of_bounds_rejected_nothing_written() {
    let c = ctx().await;
    let shelf = c
        .place(json!({"label": "Étagère", "heightU": 1, "startU": 5,
                      "notes": "{\"accessoryType\":\"etagere\"}"}))
        .await;
    let shelf = shelf["id"].as_str().unwrap().to_string();
    let plate = c
        .place(json!({"label": "Plaque", "heightU": 1, "startU": 6, "notes": "{\"accessoryType\":\"plaque\"}"}))
        .await;
    let plate = plate["id"].as_str().unwrap().to_string();
    let before = snapshot(&c.e.pool).await;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let field = |k: &str, m: &str| json!({"error": {"formErrors": [], "fieldErrors": {k: [m]}}});
    let cases: Vec<(Value, Value)> = vec![
        (
            json!({"equipmentId": "eq1", "startU": 0}),
            field("startU", "Too small: expected number to be >=1"),
        ),
        (
            json!({"equipmentId": "eq1", "startU": 1.5}),
            field("startU", "Invalid input: expected int, received number"),
        ),
        (
            json!({"equipmentId": "eq1"}),
            field(
                "startU",
                "Invalid input: expected number, received undefined",
            ),
        ),
        (
            json!({"equipmentId": "eq1", "startU": 1, "column": 4}),
            field("column", "Too big: expected number to be <=3"),
        ),
        (
            json!({"equipmentId": "eq1", "startU": 1, "column": -1}),
            field("column", "Too small: expected number to be >=0"),
        ),
        (
            json!({"equipmentId": "eq1", "startU": 1, "heightU": 0}),
            field("heightU", "Too small: expected number to be >0"),
        ),
        (
            json!({"equipmentId": "eq1", "startU": 1, "view": "TOP"}),
            field("view", VIEW_MSG),
        ),
        (
            json!({"equipmentId": "eq1", "startU": 1, "widthFraction": "SIXTH"}),
            field(
                "widthFraction",
                r#"Invalid option: expected one of "FULL"|"HALF"|"THIRD"|"QUARTER""#,
            ),
        ),
        (
            json!({"equipmentId": "", "startU": 1}),
            field(
                "equipmentId",
                "Too small: expected string to have >=1 characters",
            ),
        ),
        (
            json!({"label": "Plaque", "startU": 1}),
            json!({"error": {"formErrors": [REFINE_MSG], "fieldErrors": {}}}),
        ),
        (
            json!({"label": "", "heightU": 1, "startU": 1}),
            json!({"error": {"formErrors": [REFINE_MSG], "fieldErrors": {}}}),
        ),
        (
            json!({"equipmentId": "eq1", "startU": 1, "parentSlotId": "nope"}),
            json!({"error": "Parent shelf not found"}),
        ),
        (
            json!({"equipmentId": "eq1", "startU": 6, "parentSlotId": plate}),
            json!({"error": "Parent slot is not a shelf"}),
        ),
        (
            json!({"panelId": "nope", "startU": 1}),
            json!({"error": "Référence introuvable."}),
        ),
        (
            json!({"label": "Plaque", "heightU": 1, "startU": 1, "inventoryItemId": "nope"}),
            json!({"error": "Référence introuvable."}),
        ),
    ];
    for (body, want) in cases {
        let r = c.send("POST", &c.slots(), Some(body.clone())).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::BAD_REQUEST, want),
            "{body}"
        );
    }
    // Unreadable body: 400 (arkyo: implicit 500).
    let r = c.send("POST", &c.slots(), None).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Corps de requête invalide"})
        )
    );
    // Unknown rack: 404 (arkyo: implicit 500).
    let r = c
        .send(
            "POST",
            "/api/racks/nope/slots",
            Some(json!({"equipmentId": "eq1", "startU": 1})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );

    // A full shelf (10 children).
    for i in 0..10 {
        exec(
            &c.e.pool,
            &format!(
                r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","parentSlotId","startU","heightU","createdAt","updatedAt")
                   VALUES ('child{i}','{}','eq2','{shelf}',5,1,?,?)"#,
                c.rack
            ),
        )
        .await;
    }
    let full = snapshot(&c.e.pool).await;
    let r = c
        .send(
            "POST",
            &c.slots(),
            Some(json!({"equipmentId": "eq2", "startU": 5, "heightU": 1, "parentSlotId": shelf})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Maximum 10 équipements par étagère"})
        )
    );
    assert_eq!(snapshot(&c.e.pool).await, full);
    exec(
        &c.e.pool,
        r#"DELETE FROM "RackSlot" WHERE "id" LIKE 'child%'"#,
    )
    .await;

    // arkyo's degenerate case (more placed slots than the quantity, the sync
    // makes no ghost): arkyo's status and message (decision 1), rolled back.
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","createdAt","updatedAt")
               VALUES ('odd','{}','eq2',1,?,?)"#,
            c.rack
        ),
    )
    .await;
    for (i, u) in [20, 22, 24].into_iter().enumerate() {
        exec(
            &c.e.pool,
            &format!(
                r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","heightU","createdAt","updatedAt")
                   VALUES ('odd{i}','{}','eq2','odd',{u},1,?,?)"#,
                c.rack
            ),
        )
        .await;
    }
    let odd = snapshot(&c.e.pool).await;
    let r = c
        .send(
            "POST",
            &c.slots(),
            Some(json!({"equipmentId": "eq2", "startU": 1})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error": format!(
                "Impossible de créer un slot fantôme pour l'équipement eq2 dans le rack {}.",
                c.rack
            )})
        )
    );
    assert_eq!(snapshot(&c.e.pool).await, odd);
    exec(
        &c.e.pool,
        r#"DELETE FROM "RackSlot" WHERE "id" LIKE 'odd%'"#,
    )
    .await;
    exec(
        &c.e.pool,
        r#"DELETE FROM "RackInventoryItem" WHERE "id" = 'odd'"#,
    )
    .await;

    // Inventory cap (arkyo-server): no ghost and 999 already.
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","createdAt","updatedAt")
               VALUES ('big','{}','eq2',999,?,?)"#,
            c.rack
        ),
    )
    .await;
    let capped = snapshot(&c.e.pool).await;
    let r = c
        .send(
            "POST",
            &c.slots(),
            Some(json!({"equipmentId": "eq2", "startU": 1})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{:?}", r.body);
    assert_eq!(snapshot(&c.e.pool).await, capped);
    exec(
        &c.e.pool,
        r#"DELETE FROM "RackInventoryItem" WHERE "id" = 'big'"#,
    )
    .await;

    // PATCH out of the schema's bounds.
    for (body, want) in [
        (
            json!({"startU": 0}),
            field("startU", "Too small: expected number to be >=1"),
        ),
        (
            json!({"startU": null}),
            field("startU", "Invalid input: expected number, received null"),
        ),
        (
            json!({"column": 7}),
            field("column", "Too big: expected number to be <=3"),
        ),
        (json!({"view": "TOP"}), field("view", VIEW_MSG)),
        (
            json!({"panelLabels": [1]}),
            field(
                "panelLabels",
                "Invalid input: expected record, received array",
            ),
        ),
    ] {
        let r = c.send("PATCH", &c.slot(&plate), Some(body.clone())).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::BAD_REQUEST, want),
            "{body}"
        );
    }

    assert_eq!(snapshot(&c.e.pool).await, before, "rien n'est écrit");
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));
    no_rack_event(&mut rack).await;
    let (start, height, _, _) = slot_row(&c.e.pool, &plate).await.unwrap();
    assert_eq!((start, height), (Some(6), Some(1.0)));
}

/// arkyo has no server-side collision check: the canvas refuses occupied
/// or overflowing positions before posting (`findFreeColForWf`,
/// `uIndex + heightU - 1 > totalU`, rack-placement-canvas.tsx:1137-1146).
/// The route accepts what the schema accepts, shelf children included
/// (they share their shelf's U).
#[tokio::test]
async fn overlap_is_left_to_the_canvas_like_arkyo() {
    let c = ctx().await;
    let a = c.place(json!({"equipmentId": "eq2", "startU": 1})).await;
    let b = c.place(json!({"equipmentId": "eq2", "startU": 1})).await;
    assert_ne!(a["id"], b["id"]);
    // 42U rack, a FULL slot in column 3, a 2U item at U42.
    let c3 = c
        .place(json!({"equipmentId": "eq1", "startU": 42, "column": 3}))
        .await;
    assert_eq!(
        (c3["startU"].clone(), c3["column"].clone()),
        (json!(42), json!(3))
    );
}

// ── PATCH / DELETE : déplacement et retrait ────────────────────────────────

#[tokio::test]
async fn move_slot_updates_inventory_and_ghosts() {
    let c = ctx().await;
    let slot = c.place(json!({"equipmentId": "eq1", "startU": 3})).await;
    let id = slot["id"].as_str().unwrap().to_string();
    let item = slot_row(&c.e.pool, &id).await.unwrap().3.unwrap();
    let other = c.place(json!({"equipmentId": "eq2", "startU": 10})).await;
    let other = other["id"].as_str().unwrap().to_string();
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    // Move: position, view, column; panel labels.
    let r = c
        .send(
            "PATCH",
            &c.slot(&id),
            Some(
                json!({"startU": 8, "view": "REAR", "column": 0, "label": "Mixeur",
                        "panelLabels": {"0": "A"}, "synopticX": 12.5, "bogus": "x"}),
            ),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let moved = r.body;
    assert_eq!(moved["id"], json!(id));
    assert_eq!(moved["startU"], json!(8));
    assert_eq!(moved["view"], json!("REAR"));
    assert_eq!(moved["label"], json!("Mixeur"));
    assert_eq!(moved["panelLabels"], json!({"0": "A"}));
    assert_eq!(moved["synopticX"].as_f64(), Some(12.5));
    assert!(moved.get("bogus").is_none(), "clé hors schéma ignorée");
    assert_eq!(moved["parentSlotId"], Value::Null);
    assert_eq!(moved["heightU"].as_f64(), Some(2.0));
    assert_eq!(moved["equipment"]["id"], json!("eq1"));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "slot_updated", "slot": moved})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(
            "slot",
            "updated",
            &id,
            json!({"rackId": c.rack, "itemId": id, "clientId": CLIENT})
        )
    );
    // The inventory does not move.
    assert_eq!(quantity(&c.e.pool, &c.rack, "eq1").await, 1);
    let r = c
        .send("PATCH", &c.slot(&id), Some(json!({"panelLabels": null})))
        .await;
    assert_eq!(r.body["panelLabels"], Value::Null);
    let raw: Option<String> =
        sqlx::query_scalar(r#"SELECT "panelLabels" FROM "RackSlot" WHERE "id" = ?"#)
            .bind(&id)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(raw, None, "DbNull");
    next_rack(&mut rack).await;
    next_app(&mut app).await;

    // Unknown slot, or slot of another rack: 404 (arkyo: implicit 500).
    for path in [c.slot("nope"), format!("/api/racks/nope/slots/{id}")] {
        let r = c.send("PATCH", &path, Some(json!({"startU": 2}))).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": "Slot introuvable"}))
        );
        let r = c.send("DELETE", &path, None).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": "Slot introuvable"}))
        );
    }

    // Wiring of the placed slot: a cable, a panel row, an external port.
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","toSlotId","createdAt")
               VALUES ('cx','{}','{id}','{other}',?)"#,
            c.rack
        ),
    )
    .await;
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt")
               VALUES ('row','{id}',0,1,1,?,?)"#
        ),
    )
    .await;
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt")
               VALUES ('xp','{}','{id}',0,?,?)"#,
            c.rack
        ),
    )
    .await;

    // Remove an inventory slot: it goes back to a ghost, the inventory keeps it.
    let r = c.send("DELETE", &c.slot(&id), None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::OK, json!({"ok": true, "unplaced": true}))
    );
    assert_eq!(
        slot_row(&c.e.pool, &id).await,
        Some((None, None, None, Some(item.clone())))
    );
    let ghost: (i64, Option<String>, Option<String>, Option<f64>) = sqlx::query_as(
        r#"SELECT "column", "notes", "panelLabels", "synopticX" FROM "RackSlot" WHERE "id" = ?"#,
    )
    .bind(&id)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(ghost, (0, None, None, None));
    assert_eq!(quantity(&c.e.pool, &c.rack, "eq1").await, 1);
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackConnection""#).await,
        0
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackSlotPanelRow""#).await,
        0
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "ExternalPort""#).await,
        1,
        "conservé comme dans arkyo"
    );
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "slot_removed", "slotId": id, "removedAdapterIds": []})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(
            "slot",
            "deleted",
            &id,
            json!({"rackId": c.rack, "itemId": id, "clientId": CLIENT})
        )
    );
    let audit: String =
        sqlx::query_scalar(r#"SELECT "action" FROM "AuditLog" ORDER BY rowid DESC LIMIT 1"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(audit, "rackSlot.unplace");

    // Placing it again claims the same ghost: no new inventory.
    let again = c.place(json!({"equipmentId": "eq1", "startU": 20})).await;
    assert_eq!(again["id"], json!(id));
    assert_eq!(quantity(&c.e.pool, &c.rack, "eq1").await, 1);
    assert_eq!(
        int(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "RackSlot" WHERE "catalogEquipmentId" = 'eq1'"#
        )
        .await,
        1
    );
    assert_eq!(next_rack(&mut rack).await["type"], json!("slot_updated"));
}

#[tokio::test]
async fn remove_host_slot_removes_components() {
    let c = ctx().await;
    let shelf = c
        .place(json!({"label": "Étagère", "heightU": 2, "startU": 5,
                      "notes": "{\"accessoryType\":\"etagere\",\"childOrder\":[]}"}))
        .await;
    let shelf = shelf["id"].as_str().unwrap().to_string();
    let mut children = Vec::new();
    for _ in 0..2 {
        let ch = c
            .place(
                json!({"equipmentId": "eq2", "parentSlotId": shelf, "startU": 5,
                          "heightU": 2, "view": "FRONT"}),
            )
            .await;
        assert_eq!(ch["parentSlotId"], json!(shelf));
        children.push(ch["id"].as_str().unwrap().to_string());
    }
    // Shelf children stay out of the inventory.
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackInventoryItem""#).await,
        0
    );
    let r = c.send("PATCH", &c.slot(&shelf), Some(json!({}))).await;
    let ids: Vec<&str> = r.body["children"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, children);
    assert_eq!(
        r.body["children"][0],
        json!({"id": children[0], "catalogEquipmentId": "eq2", "heightU": 2.0,
               "widthFraction": "FULL", "synopticX": null, "synopticY": null})
    );
    let other = c.place(json!({"equipmentId": "eq1", "startU": 20})).await;
    let other = other["id"].as_str().unwrap().to_string();
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","toSlotId","createdAt")
               VALUES ('cx','{}','{}','{other}',?)"#,
            c.rack, children[0]
        ),
    )
    .await;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let r = c.send("DELETE", &c.slot(&shelf), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    for id in [&shelf, &children[0], &children[1]] {
        assert_eq!(slot_row(&c.e.pool, id).await, None, "{id}");
    }
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RackConnection""#).await,
        0
    );
    assert!(slot_row(&c.e.pool, &other).await.is_some());
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "slot_removed", "slotId": shelf, "removedAdapterIds": []})
    );
    no_rack_event(&mut rack).await;
    assert_eq!(
        next_app(&mut app).await,
        app_event(
            "slot",
            "deleted",
            &shelf,
            json!({"rackId": c.rack, "itemId": shelf, "clientId": CLIENT})
        )
    );
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));
    let audit: (String, String) = sqlx::query_as(
        r#"SELECT "action", "entityId" FROM "AuditLog" ORDER BY rowid DESC LIMIT 1"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(audit, ("rackSlot.delete".into(), shelf));
}

/// arkyo-server: correction d'un défaut d'arkyo. Le PATCH d'arkyo ignore
/// `parentSlotId` (absent d'`updateSchema`) : un enfant glissé d'une étagère
/// à l'autre (`reorderShelfChild`, rack-placement-canvas.tsx) revenait sous
/// son ancienne étagère au rechargement. Le PATCH l'accepte désormais, avec
/// la vérification de la création (étagère du même rack, 10 enfants au plus,
/// le slot déplacé exclu du compte) ; seul un enfant d'étagère en change.
#[tokio::test]
async fn move_shelf_child_to_another_shelf() {
    let c = ctx().await;
    let shelf_at = |u: i64| {
        json!({"label": "Étagère", "heightU": 1, "startU": u,
               "notes": "{\"accessoryType\":\"etagere\",\"childOrder\":[]}"})
    };
    let a = c.place(shelf_at(5)).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let b = c.place(shelf_at(9)).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let child = c
        .place(json!({"equipmentId": "eq2", "parentSlotId": a, "startU": 5, "heightU": 1}))
        .await;
    let child = child["id"].as_str().unwrap().to_string();
    let top = c.place(json!({"equipmentId": "eq1", "startU": 20})).await;
    let top = top["id"].as_str().unwrap().to_string();
    let plate = c
        .place(json!({"label": "Plaque", "heightU": 1, "startU": 30,
                      "notes": "{\"accessoryType\":\"plaque\"}"}))
        .await;
    let plate = plate["id"].as_str().unwrap().to_string();
    // A shelf of another rack of the project.
    let r = c
        .send(
            "POST",
            &format!("{LIST}/{}/locations", c.project),
            Some(json!({"name": "Régie"})),
        )
        .await;
    let loc = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .send(
            "POST",
            &format!("{LIST}/{}/racks", c.project),
            Some(json!({"racks": [{"name": "Baie B", "locationId": loc}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let rack2 = r.body["racks"][0]["id"].as_str().unwrap().to_string();
    let r = c
        .send(
            "POST",
            &format!("/api/racks/{rack2}/slots"),
            Some(shelf_at(5)),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let foreign = r.body["id"].as_str().unwrap().to_string();
    // B full: 10 children.
    let full = c.place(shelf_at(12)).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    for i in 0..10 {
        exec(
            &c.e.pool,
            &format!(
                r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","parentSlotId","startU","heightU","createdAt","updatedAt")
                   VALUES ('child{i}','{}','eq2','{full}',12,1,?,?)"#,
                c.rack
            ),
        )
        .await;
    }
    let parent_of = |id: String| {
        let pool = c.e.pool.clone();
        async move {
            sqlx::query_scalar::<_, Option<String>>(
                r#"SELECT "parentSlotId" FROM "RackSlot" WHERE "id" = ?"#,
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };

    // Refusals: 400, nothing written, no event.
    let before = snapshot(&c.e.pool).await;
    let mut rack = c.e.events.subscribe_rack(&c.rack);
    let cases: Vec<(&str, &str, &str)> = vec![
        (&child, "nope", "Parent shelf not found"),
        (&child, &plate, "Parent slot is not a shelf"),
        (&child, &foreign, "Parent shelf not found"),
        (&child, &full, "Maximum 10 équipements par étagère"),
        (&child, &child, "Un slot ne peut pas être son propre parent"),
        (
            &top,
            &b,
            "Seul un équipement d'étagère peut changer d'étagère",
        ),
    ];
    for (slot, parent, msg) in cases {
        let r = c
            .send(
                "PATCH",
                &c.slot(slot),
                Some(json!({"parentSlotId": parent, "startU": 9, "view": "FRONT"})),
            )
            .await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::BAD_REQUEST, json!({"error": msg})),
            "{slot} → {parent}"
        );
    }
    let r = c
        .send("PATCH", &c.slot(&child), Some(json!({"parentSlotId": ""})))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{:?}", r.body);
    let r = c
        .send("PATCH", &c.slot("nope"), Some(json!({"parentSlotId": b})))
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Slot introuvable"}))
    );
    assert_eq!(snapshot(&c.e.pool).await, before);
    assert_eq!(parent_of(child.clone()).await, Some(a.clone()));
    assert_eq!(parent_of(top.clone()).await, None);
    no_rack_event(&mut rack).await;

    // Staying on its own (full) shelf: the moved slot is not counted.
    exec(
        &c.e.pool,
        &format!(r#"UPDATE "RackSlot" SET "parentSlotId" = '{full}' WHERE "id" = 'child9'"#),
    )
    .await;
    let r = c
        .send(
            "PATCH",
            &c.slot("child9"),
            Some(json!({"parentSlotId": full})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    next_rack(&mut rack).await;

    // The canvas' body (reorderShelfChild): A → B.
    let mut app = c.e.events.subscribe();
    let r = c
        .send(
            "PATCH",
            &c.slot(&child),
            Some(json!({"parentSlotId": b, "startU": 9, "view": "FRONT"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["parentSlotId"], json!(b));
    assert_eq!(r.body["startU"], json!(9));
    assert_eq!(parent_of(child.clone()).await, Some(b.clone()));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "slot_updated", "slot": r.body})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(
            "slot",
            "updated",
            &child,
            json!({"rackId": c.rack, "itemId": child, "clientId": CLIENT})
        )
    );
    // Shelf children stay out of the inventory.
    assert_eq!(
        int(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "RackInventoryItem" WHERE "catalogEquipmentId" = 'eq2'"#
        )
        .await,
        0
    );
}

// ── DELETE /slots : vider le rack ──────────────────────────────────────────

#[tokio::test]
async fn clear_rack_writes_empty_checks_and_event() {
    let c = ctx().await;
    let placed = c.place(json!({"equipmentId": "eq1", "startU": 3})).await;
    let placed = placed["id"].as_str().unwrap().to_string();
    let panel = c.place(json!({"panelId": "pa1", "startU": 10})).await;
    let panel = panel["id"].as_str().unwrap().to_string();
    let acc = c
        .place(json!({"label": "Plaque", "heightU": 1, "startU": 12}))
        .await;
    let acc = acc["id"].as_str().unwrap().to_string();
    c.inventory("eq2", 2).await; // two ghosts, never placed
    let rk = c.rack.clone();
    for sql in [
        format!(
            r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('z','{rk}',0,0,1,1,?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackLabel" ("id","rackId","x","y","createdAt","updatedAt") VALUES ('l','{rk}',0,0,?,?)"#
        ),
        format!(
            r#"INSERT INTO "CableBundle" ("id","rackId","name","createdAt","updatedAt") VALUES ('b','{rk}','Faisceau',?,?)"#
        ),
        format!(
            r#"INSERT INTO "SynopticAdapter" ("id","rackId","x","y","attachedSlotId","createdAt","updatedAt") VALUES ('ad','{rk}',0,0,'{placed}',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","toAdapterId","createdAt") VALUES ('cx','{rk}','{placed}','ad',?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('row','{panel}',0,1,1,?,?)"#
        ),
        format!(
            r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('xp','{rk}','{placed}',0,?,?)"#
        ),
        format!(r#"UPDATE "Rack" SET "constructionChecks" = '["tension"]' WHERE "id" = '{rk}'"#),
    ] {
        exec(&c.e.pool, &sql).await;
    }
    // Another rack keeps everything.
    exec(
        &c.e.pool,
        r#"INSERT INTO "Rack" ("id","name","constructionChecks","createdAt","updatedAt") VALUES ('r2','Autre','["x"]',?,?)"#,
    )
    .await;
    exec(
        &c.e.pool,
        r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('z2','r2',0,0,1,1,?,?)"#,
    )
    .await;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let r = c.send("DELETE", &c.slots(), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));

    // Inventory slots become ghosts, the others go.
    for id in [&placed, &panel] {
        let (start, height, label, item) = slot_row(&c.e.pool, id).await.unwrap();
        assert_eq!((start, height, label), (None, None, None), "{id}");
        assert!(item.is_some());
    }
    assert_eq!(slot_row(&c.e.pool, &acc).await, None);
    assert_eq!(
        int(
            &c.e.pool,
            &format!(r#"SELECT COUNT(*) FROM "RackSlot" WHERE "rackId" = '{rk}'"#)
        )
        .await,
        4
    );
    assert_eq!(quantity(&c.e.pool, &c.rack, "eq1").await, 1);
    assert_eq!(quantity(&c.e.pool, &c.rack, "eq2").await, 2);
    for (t, n) in [
        ("RackZone", 1),
        ("RackLabel", 0),
        ("CableBundle", 0),
        ("SynopticAdapter", 0),
        ("RackConnection", 0),
        ("RackSlotPanelRow", 0),
        ("ExternalPort", 1),
    ] {
        assert_eq!(
            int(&c.e.pool, &format!(r#"SELECT COUNT(*) FROM "{t}""#)).await,
            n,
            "{t}"
        );
    }
    // The cleared rack and another one, which keeps its checks.
    let checks: Vec<String> = sqlx::query_scalar(
        r#"SELECT "constructionChecks" FROM "Rack" WHERE "id" IN (?, 'r2') ORDER BY "id" = 'r2'"#,
    )
    .bind(&c.rack)
    .fetch_all(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(checks, ["[]", r#"["x"]"#]);

    assert_eq!(next_rack(&mut rack).await, json!({"type": "rack_cleared"}));
    no_rack_event(&mut rack).await;
    assert_eq!(
        next_app(&mut app).await,
        app_event(
            "slot",
            "deleted",
            &c.rack,
            json!({"rackId": c.rack, "clientId": CLIENT})
        )
    );
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));
    let audit: (String, String, String) = sqlx::query_as(
        r#"SELECT "action", "entityType", "entityId" FROM "AuditLog" ORDER BY rowid DESC LIMIT 1"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        audit,
        (
            "rackSlot.clearAll".into(),
            "RackSlot".into(),
            c.rack.clone()
        )
    );

    // Unknown rack: 404, nothing written (arkyo: implicit 500 after the deletes).
    let r = c.send("DELETE", "/api/racks/nope/slots", None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
}

// ── removedAdapterIds ──────────────────────────────────────────────────────

#[tokio::test]
async fn removed_adapters_reported_and_deleted() {
    let c = ctx().await;
    let acc = c
        .place(json!({"label": "Plaque", "heightU": 1, "startU": 1}))
        .await;
    let acc = acc["id"].as_str().unwrap().to_string();
    let inv = c.place(json!({"equipmentId": "eq1", "startU": 3})).await;
    let inv = inv["id"].as_str().unwrap().to_string();
    let rk = c.rack.clone();
    for (id, attached) in [
        ("ad1", Some(&acc)),
        ("ad2", Some(&acc)),
        ("ad3", Some(&inv)),
        ("ad4", None),
    ] {
        let att = attached.map_or("NULL".to_string(), |s| format!("'{s}'"));
        exec(
            &c.e.pool,
            &format!(
                r#"INSERT INTO "SynopticAdapter" ("id","rackId","x","y","attachedSlotId","createdAt","updatedAt")
                   VALUES ('{id}','{rk}',0,0,{att},?,?)"#
            ),
        )
        .await;
    }
    for (id, from, to) in [
        (
            "c1",
            r#""fromAdapterId","toSlotId""#,
            format!("'ad1','{inv}'"),
        ),
        (
            "c2",
            r#""fromSlotId","toAdapterId""#,
            format!("'{inv}','ad2'"),
        ),
        (
            "c3",
            r#""fromAdapterId","toAdapterId""#,
            "'ad4','ad3'".to_string(),
        ),
        (
            "c4",
            r#""fromAdapterId","toSlotId""#,
            format!("'ad4','{inv}'"),
        ),
    ] {
        exec(
            &c.e.pool,
            &format!(
                r#"INSERT INTO "RackConnection" ("id","rackId",{from},"createdAt") VALUES ('{id}','{rk}',{to},?)"#
            ),
        )
        .await;
    }
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    // A free slot: deleted, with its adapters and their cables.
    let r = c.send("DELETE", &c.slot(&acc), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "slot_removed", "slotId": acc, "removedAdapterIds": ["ad1", "ad2"]})
    );
    let ids = |t: &'static str| {
        let pool = c.e.pool.clone();
        async move {
            sqlx::query_scalar::<_, String>(&format!(r#"SELECT "id" FROM "{t}" ORDER BY "id""#))
                .fetch_all(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(ids("SynopticAdapter").await, ["ad3", "ad4"]);
    assert_eq!(ids("RackConnection").await, ["c3", "c4"]);

    // An inventory slot: unplaced, its adapter and every cable on it go.
    let r = c.send("DELETE", &c.slot(&inv), None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::OK, json!({"ok": true, "unplaced": true}))
    );
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "slot_removed", "slotId": inv, "removedAdapterIds": ["ad3"]})
    );
    assert_eq!(ids("SynopticAdapter").await, ["ad4"]);
    assert_eq!(ids("RackConnection").await, Vec::<String>::new());
    // No dangling reference left.
    assert_eq!(
        int(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "SynopticAdapter" WHERE "attachedSlotId" IS NOT NULL"#
        )
        .await,
        0
    );
}

// ── permissions ────────────────────────────────────────────────────────────

#[tokio::test]
async fn consultation_cannot_write() {
    let c = ctx().await;
    let slot = c.place(json!({"equipmentId": "eq1", "startU": 3})).await;
    let id = slot["id"].as_str().unwrap().to_string();
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let before = snapshot(&c.e.pool).await;
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let calls = [
        (
            "POST",
            c.slots(),
            Some(json!({"equipmentId": "eq1", "startU": 10})),
        ),
        ("DELETE", c.slots(), None),
        ("PATCH", c.slot(&id), Some(json!({"startU": 10}))),
        ("DELETE", c.slot(&id), None),
    ];
    for (method, path, body) in &calls {
        let r = send_as(&c.e, Some(&ct), method, path, body.clone()).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"})),
            "{method} {path}"
        );
        let r = send_as(&c.e, None, method, path, body.clone()).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {path}");
    }
    assert_eq!(snapshot(&c.e.pool).await, before);
    assert_eq!(slot_row(&c.e.pool, &id).await.unwrap().0, Some(3));
    no_rack_event(&mut rack).await;

    // A project manager (design:write) can.
    add_user(&c.e.pool, "p@b.fr", "chef-projet", false).await;
    let pt = login(&c.e.app, "p@b.fr").await;
    let r = send_as(
        &c.e,
        Some(&pt),
        "PATCH",
        &c.slot(&id),
        Some(json!({"startU": 10})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
}
