//! End-to-end path of phase 4b (Task 9), over HTTP on a fresh database:
//! owner setup, a catalogue (two equipments, a modular host and its card, a
//! panel), the project wizard (project, location, 24U container), the
//! container's inventory (two equipments, a panel, a host with a component),
//! the placement in FRONT and REAR (an accessory shelf with a child too), an
//! overlapping placement, a move, the construction checks (toggle, set,
//! clear), `canvas-data`, « Vider la baie », then the deletion of the
//! container without any orphan.
//!
//! Request bodies are the ones the front sends:
//! `web/src/app/auth/setup-page.tsx`,
//! `web/src/components/projects/new-project-dialog.tsx` (with
//! `buildRackPayload` of `components/racks/rack-wizard-steps.tsx`),
//! `[id]/inventaire/_components/inventaire-scope.tsx` (`handleConfirmAdd`,
//! `handleHostDrop`), `component-config-modal.tsx` (`handleInstall`) and
//! `container-properties-panel.tsx` (container `DELETE`), and, under
//! `web/src/app/(fullscreen)/project/[id]/rack/`:
//! `_components/rack-placement-canvas.tsx` (`placeEquipment`, the panel drop
//! of `handleDragEnd`, `placeAccessory`, `placeOnShelf`, `updateChildOrder`,
//! `moveSlot`, `removeSlot`), `_components/rack-info-panel.tsx` (« Vider la
//! baie ») and `rack-tab-client.tsx` (`canvas-data`).
//!
//! The construction checks are written by the rack editor only (phase 4d):
//! their bodies are those of arkyo's route
//! (arkyo:app/api/racks/[id]/construction-checks/route.ts).
mod common;
use std::collections::BTreeSet;
use std::time::Duration;

use arkyo_server::events::RackSubscription;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const PROJECTS: &str = "/api/tenant/projects";
const EQUIPMENT: &str = "/api/tenant/catalogue/equipment";
const BRANDS: &str = "/api/tenant/parametres/brands";

struct Owner<'a> {
    e: &'a Env,
    tok: String,
}

impl Owner<'_> {
    async fn req(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, path, LOCAL, Some(&self.tok), body).await
    }

    async fn ok(&self, method: &str, path: &str, body: Option<Value>, want: StatusCode) -> Value {
        let r = self.req(method, path, body).await;
        assert_eq!(r.status, want, "{method} {path}: {:?}", r.body);
        r.body
    }
}

fn id_of(v: &Value) -> String {
    v["id"].as_str().unwrap().to_string()
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn count_by(pool: &SqlitePool, sql: &str, bind: &str) -> i64 {
    sqlx::query_scalar(sql)
        .bind(bind)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// `(placed, ghost)` slots of an inventory item.
async fn slots_of(pool: &SqlitePool, item: &str) -> (i64, i64) {
    let placed = count_by(
        pool,
        r#"SELECT COUNT(*) FROM "RackSlot" WHERE "inventoryItemId" = ? AND "startU" IS NOT NULL"#,
        item,
    )
    .await;
    let ghosts = count_by(
        pool,
        r#"SELECT COUNT(*) FROM "RackSlot" WHERE "inventoryItemId" = ? AND "startU" IS NULL"#,
        item,
    )
    .await;
    (placed, ghosts)
}

async fn quantity(pool: &SqlitePool, item: &str) -> i64 {
    count_by(
        pool,
        r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "id" = ?"#,
        item,
    )
    .await
}

/// `(inventoryItemId, startU, view)` of a slot.
async fn slot_row(pool: &SqlitePool, id: &str) -> (Option<String>, Option<i64>, String) {
    sqlx::query_as(r#"SELECT "inventoryItemId", "startU", "view" FROM "RackSlot" WHERE "id" = ?"#)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn stored_checks(pool: &SqlitePool, rack: &str) -> String {
    sqlx::query_scalar(r#"SELECT "constructionChecks" FROM "Rack" WHERE "id" = ?"#)
        .bind(rack)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn next_rack(rx: &mut RackSubscription) -> Value {
    let s = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("évènement rack attendu")
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

/// The equipment editor's payload (`equipment-editor.tsx`, as in
/// `phase4a_smoke.rs`), with `extra` merged over it.
fn equipment_body(name: &str, brand: &str, connector: &str, extra: Value) -> Value {
    let mut body = json!({
        "name": name,
        "reference": null,
        "category": null,
        "brandId": brand,
        "isRackable": true,
        "heightU": 2,
        "depthMm": 450,
        "rearCableDepthMm": null,
        "widthFraction": "FULL",
        "dimLmm": null, "dimWmm": null, "dimHmm": null,
        "weight": 7.5, "powerW": 120, "heatBtuH": 409.5,
        "connectors": [{
            "id": "port-in-1", "face": "REAR", "connectorTypeId": connector,
            "signalName": "SDI", "quantity": 4, "label": "SDI IN",
            "direction": "IN", "gender": "FEMALE"
        }],
        "signalCapacities": [{ "signalName": "SDI", "in": 4, "out": 0 }],
        "is2110": false, "ip2110Mode": null,
        "imageUrl": null, "iconUrl": null,
        "rackSymbolUrl": null, "rackSymbolRearUrl": null,
        "rackPhotoFrontUrl": null, "rackPhotoRearUrl": null,
        "notes": null, "documents": [], "tags": null, "isActive": true,
        "isLightingFixture": false, "dmxChannelsDefault": null, "dmxModes": [],
        "isComponentHost": false, "hostSlotCount": null,
        "isComponent": false, "componentSlotSpan": 1,
        "typeId": null, "functionIds": []
    });
    for (k, v) in extra.as_object().unwrap() {
        body[k] = v.clone();
    }
    body
}

/// `placeEquipment` of `rack-placement-canvas.tsx`.
fn place_equipment(eq: &str, view: &str, start_u: i64, height_u: i64) -> Value {
    json!({
        "equipmentId": eq, "view": view, "startU": start_u, "heightU": height_u,
        "widthFraction": "FULL", "column": 0,
    })
}

#[tokio::test]
async fn phase4b_rack_tab_end_to_end() {
    let e = env().await;
    let pool = &e.pool;

    // ── 0. Owner (setup page body) and catalogue ────────────────────────
    let r = call(
        &e.app,
        "POST",
        "/api/auth/setup",
        LOCAL,
        None,
        Some(json!({
            "name": "Proprio", "email": "owner@site.fr",
            "username": "proprio", "password": "secret123"
        })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let o = Owner {
        e: &e,
        tok: token_of(r.cookie.as_deref().unwrap()),
    };
    let brand = o
        .ok(
            "POST",
            BRANDS,
            Some(json!({ "name": "Marque Phase 4b", "website": null, "logoUrl": null })),
            StatusCode::CREATED,
        )
        .await;
    let brand = id_of(&brand);
    let connectors = o
        .ok(
            "GET",
            "/api/tenant/catalogue/connectors",
            None,
            StatusCode::OK,
        )
        .await;
    let bnc = id_of(&connectors[0]);
    let new_equipment = async |name: &str, extra: Value| {
        let r = o
            .ok(
                "POST",
                EQUIPMENT,
                Some(equipment_body(name, &brand, &bnc, extra)),
                StatusCode::CREATED,
            )
            .await;
        id_of(&r)
    };
    let mixer = new_equipment("Mélangeur Vidéo", json!({})).await;
    let router = new_equipment("Routeur SDI", json!({ "heightU": 1 })).await;
    let host = new_equipment(
        "Châssis modulaire",
        json!({ "isComponentHost": true, "hostSlotCount": 4 }),
    )
    .await;
    let card = new_equipment(
        "Carte SDI",
        json!({ "isRackable": false, "heightU": null, "isComponent": true,
                "componentSlotSpan": 1 }),
    )
    .await;
    let panel = o
        .ok(
            "POST",
            "/api/panels",
            Some(json!({
                "name": "Patch SDI", "heightU": 1, "slotsPerU": 8,
                "rearCableDepthMm": 80, "notes": null,
            })),
            StatusCode::CREATED,
        )
        .await;
    let panel = id_of(&panel);

    // ── 1. Project, location and a 24U container ────────────────────────
    let project = o
        .ok(
            "POST",
            PROJECTS,
            Some(json!({
                "name": "Finale Rack",
                "interventionType": "PRESTATION",
                "rigType": "FLIGHT_CASE",
                "clientName": "France TV",
                "location": "Bercy",
                "planningStart": "2026-12-01",
                "planningEnd": "2026-12-04",
                "shootingDate": "2026-12-03",
            })),
            StatusCode::CREATED,
        )
        .await;
    let pid = id_of(&project);
    let base = format!("{PROJECTS}/{pid}");
    let location = o
        .ok(
            "POST",
            &format!("{base}/locations"),
            Some(json!({ "name": "Car régie" })),
            StatusCode::CREATED,
        )
        .await;
    let location_id = id_of(&location);
    let virtual_rack = location["virtualRackId"].as_str().unwrap().to_string();
    let created = o
        .ok(
            "POST",
            &format!("{base}/racks"),
            Some(json!({ "racks": [{
                "name": "Baie 24U",
                "rackType": "STANDARD",
                "isRackable": true,
                "depthMm": 600,
                "totalU": 24,
                "locationId": location_id,
            }] })),
            StatusCode::CREATED,
        )
        .await;
    let rack = id_of(&created["racks"][0]);
    let inv = format!("{base}/racks/{rack}/inventory");
    let canvas_data = format!("{base}/racks/{rack}/canvas-data");
    let slots = format!("/api/racks/{rack}/slots");
    let slot_url = |id: &str| format!("{slots}/{id}");

    // ── 2. Inventory: 2 equipments, 1 panel, 1 host with a component ────
    let add = async |body: Value| {
        let r = o.ok("POST", &inv, Some(body), StatusCode::CREATED).await;
        id_of(&r["item"])
    };
    let mixer_item = add(json!({ "equipmentId": mixer, "quantity": 1 })).await;
    let router_item = add(json!({ "equipmentId": router, "quantity": 1 })).await;
    let panel_item = add(json!({ "panelId": panel, "quantity": 1 })).await;
    let host_item = add(json!({ "catalogEquipmentId": host })).await;
    let card_item = add(json!({
        "catalogEquipmentId": card, "hostItemId": host_item, "hostSlotIndex": 0,
    }))
    .await;
    // One ghost per unit of equipment or panel, none for a component.
    for item in [&mixer_item, &router_item, &panel_item, &host_item] {
        assert_eq!(slots_of(pool, item).await, (0, 1), "{item}");
    }
    assert_eq!(slots_of(pool, &card_item).await, (0, 0));

    // ── 3. Placement in FRONT and REAR ──────────────────────────────────
    let mut events = e.events.subscribe_rack(&rack);
    // The first drop claims the ghost the client already knew: slot_updated.
    let mixer_slot = o
        .ok(
            "POST",
            &slots,
            Some(place_equipment(&mixer, "FRONT", 1, 2)),
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(
        next_rack(&mut events).await,
        json!({ "type": "slot_updated", "slot": mixer_slot })
    );
    let mixer_slot = id_of(&mixer_slot);
    let router_slot = o
        .ok(
            "POST",
            &slots,
            Some(place_equipment(&router, "REAR", 1, 1)),
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(router_slot["view"], "REAR");
    let router_slot = id_of(&router_slot);
    // The panel drop of handleDragEnd: no heightU, the panel's (1U).
    let panel_slot = o
        .ok(
            "POST",
            &slots,
            Some(json!({
                "panelId": panel, "view": "FRONT", "startU": 3,
                "widthFraction": "FULL", "column": 0,
            })),
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(panel_slot["heightU"].as_f64(), Some(1.0));
    assert_eq!(panel_slot["panel"]["id"], panel.as_str());
    let panel_slot = id_of(&panel_slot);
    let host_slot = o
        .ok(
            "POST",
            &slots,
            Some(place_equipment(&host, "FRONT", 5, 2)),
            StatusCode::CREATED,
        )
        .await;
    let host_slot = id_of(&host_slot);
    // Each placement is the item's own ghost, now placed: the inventory
    // does not change.
    for (item, slot, start_u, view) in [
        (&mixer_item, &mixer_slot, 1, "FRONT"),
        (&router_item, &router_slot, 1, "REAR"),
        (&panel_item, &panel_slot, 3, "FRONT"),
        (&host_item, &host_slot, 5, "FRONT"),
    ] {
        assert_eq!(slots_of(pool, item).await, (1, 0), "{item}");
        assert_eq!(quantity(pool, item).await, 1, "{item}");
        assert_eq!(
            slot_row(pool, slot).await,
            (Some(item.clone()), Some(start_u), view.to_string())
        );
    }
    // An accessory shelf (placeAccessory) and an equipment on it
    // (placeOnShelf, then updateChildOrder): no inventory line for either.
    let shelf = o
        .ok(
            "POST",
            &slots,
            Some(json!({
                "label": "Étagère 600mm 1U",
                "notes": r#"{"accessoryType":"etagere","depthMm":600}"#,
                "view": "FRONT", "startU": 8, "heightU": 1,
                "widthFraction": "FULL", "column": 0,
            })),
            StatusCode::CREATED,
        )
        .await;
    let shelf = id_of(&shelf);
    let child = o
        .ok(
            "POST",
            &slots,
            Some(json!({
                "equipmentId": router, "parentSlotId": shelf, "view": "FRONT",
                "startU": 8, "heightU": 1, "widthFraction": "FULL", "column": 0,
            })),
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(child["parentSlotId"], shelf.as_str());
    let child = id_of(&child);
    let child_order =
        format!(r#"{{"accessoryType":"etagere","depthMm":600,"childOrder":["{child}"]}}"#);
    o.ok(
        "PATCH",
        &slot_url(&shelf),
        Some(json!({ "notes": child_order })),
        StatusCode::OK,
    )
    .await;
    assert_eq!(slot_row(pool, &child).await.0, None);
    assert_eq!(quantity(pool, &router_item).await, 1);

    // ── 4. Overlap ──────────────────────────────────────────────────────
    // arkyo has no server-side collision guard (ruling 4b T1, test
    // `overlap_is_left_to_the_canvas_like_arkyo` of rack_slots.rs): the
    // canvas refuses a drop on occupied units (`handleDragEnd`, toast
    // « Position occupée par … ») and on units past `totalU`
    // (`placeEquipment`, « … dépasse la taille du rack. »), then never
    // sends the request. The route itself accepts a router over the mixer
    // (FRONT, U1): no free ghost left, so the inventory line grows by one,
    // as arkyo's `ensureGhostSlotForRef`.
    let overlap = o
        .ok(
            "POST",
            &slots,
            Some(place_equipment(&router, "FRONT", 1, 1)),
            StatusCode::CREATED,
        )
        .await;
    let overlap = id_of(&overlap);
    assert_eq!(quantity(pool, &router_item).await, 2);
    assert_eq!(slots_of(pool, &router_item).await, (2, 0));
    // Undone as the user would: « Retirer » turns it back into a ghost,
    // the quantity dialog drops the extra unit.
    let r = o
        .ok("DELETE", &slot_url(&overlap), None, StatusCode::OK)
        .await;
    assert_eq!(r, json!({ "ok": true, "unplaced": true }));
    assert_eq!(slots_of(pool, &router_item).await, (1, 1));
    let r = o
        .ok(
            "PATCH",
            &format!("{inv}/{router_item}"),
            Some(json!({ "quantity": 1 })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(r["item"]["quantity"], 1);
    assert_eq!(slots_of(pool, &router_item).await, (1, 0));
    assert_eq!(
        slot_row(pool, &router_slot).await,
        (Some(router_item.clone()), Some(1), "REAR".to_string()),
        "the placed unit stays"
    );

    // ── 5. Move a slot (moveSlot) ───────────────────────────────────────
    let mut events = e.events.subscribe_rack(&rack);
    let moved = o
        .ok(
            "PATCH",
            &slot_url(&router_slot),
            Some(json!({ "startU": 10, "column": 0, "view": "REAR" })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(moved["startU"], 10);
    assert_eq!(moved["equipment"]["id"], router.as_str());
    assert_eq!(
        next_rack(&mut events).await,
        json!({ "type": "slot_updated", "slot": moved })
    );
    assert_eq!(
        slot_row(pool, &router_slot).await,
        (Some(router_item.clone()), Some(10), "REAR".to_string())
    );
    assert_eq!(quantity(pool, &router_item).await, 1);

    // ── 6. Construction checks: toggle, set, clear ──────────────────────
    let checks = format!("/api/racks/{rack}/construction-checks");
    let r = o.ok("GET", &checks, None, StatusCode::OK).await;
    assert_eq!(r, json!({ "checks": [] }));
    let port = format!("{mixer_slot}:p0");
    let r = o
        .ok(
            "PATCH",
            &checks,
            Some(json!({ "action": "toggle", "id": port })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(r, json!({ "checks": [port] }));
    assert_eq!(
        next_rack(&mut events).await,
        json!({ "type": "construction_checks_updated" })
    );
    let r = o
        .ok(
            "PATCH",
            &checks,
            Some(json!({ "action": "set", "ids": [port, host_slot] })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(r, json!({ "checks": [port, host_slot] }));
    let r = o.ok("GET", &checks, None, StatusCode::OK).await;
    assert_eq!(r, json!({ "checks": [port, host_slot] }));
    let r = o
        .ok(
            "PATCH",
            &checks,
            Some(json!({ "action": "clear" })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(r, json!({ "checks": [] }));
    // arkyo's trap: Prisma.JsonNull, the JSON text `null`.
    assert_eq!(stored_checks(pool, &rack).await, "null");
    o.ok(
        "PATCH",
        &checks,
        Some(json!({ "action": "toggle", "id": panel_slot })),
        StatusCode::OK,
    )
    .await;

    // ── 7. canvas-data (rack-tab-client.tsx) ────────────────────────────
    let cd = o.ok("GET", &canvas_data, None, StatusCode::OK).await;
    assert_eq!(cd["rack"]["id"], rack.as_str());
    assert_eq!(cd["rack"]["totalU"], 24);
    assert_eq!(cd["rack"]["constructionChecks"], json!([panel_slot]));
    assert_eq!(cd["rack"]["rigs"].as_array().unwrap().len(), 1);
    let top: Vec<(String, Option<i64>, String)> = cd["rack"]["slots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                id_of(s),
                s["startU"].as_i64(),
                s["view"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(
        top,
        vec![
            (mixer_slot.clone(), Some(1), "FRONT".to_string()),
            (panel_slot.clone(), Some(3), "FRONT".to_string()),
            (host_slot.clone(), Some(5), "FRONT".to_string()),
            (shelf.clone(), Some(8), "FRONT".to_string()),
            (router_slot.clone(), Some(10), "REAR".to_string()),
        ],
        "top-level slots by startU, the shelf child under its shelf"
    );
    let by_id = |id: &str| {
        cd["rack"]["slots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == id)
            .unwrap()
            .clone()
    };
    assert_eq!(by_id(&mixer_slot)["equipment"]["id"], mixer.as_str());
    assert_eq!(by_id(&panel_slot)["panel"]["id"], panel.as_str());
    let comps = by_id(&host_slot)["components"].clone();
    assert_eq!(comps.as_array().unwrap().len(), 1, "{comps}");
    assert_eq!(comps[0]["itemId"], card_item.as_str());
    assert_eq!(comps[0]["slotIndex"], 0);
    assert_eq!(comps[0]["equipment"]["id"], card.as_str());
    let kids = by_id(&shelf)["children"].clone();
    assert_eq!(kids.as_array().unwrap().len(), 1, "{kids}");
    assert_eq!(kids[0]["id"], child.as_str());
    assert_eq!(kids[0]["equipment"]["id"], router.as_str());
    let palette: BTreeSet<String> = cd["allEquipment"]
        .as_array()
        .unwrap()
        .iter()
        .map(id_of)
        .collect();
    assert_eq!(
        palette,
        BTreeSet::from([mixer.clone(), router.clone(), host.clone(), card.clone()])
    );
    assert_eq!(cd["allPanels"][0]["id"], panel.as_str());
    assert_eq!(cd["cableSafetyDepthMm"], 150);

    // ── 8. « Vider la baie » (rack-info-panel.tsx) ──────────────────────
    let r = o.ok("DELETE", &slots, None, StatusCode::OK).await;
    assert_eq!(r, json!({ "ok": true }));
    // Inventory slots back to ghosts, the shelf and its child gone, the
    // inventory kept, the checks an empty array (not the `null` trap).
    for item in [&mixer_item, &router_item, &panel_item, &host_item] {
        assert_eq!(slots_of(pool, item).await, (0, 1), "{item}");
        assert_eq!(quantity(pool, item).await, 1, "{item}");
    }
    for id in [&shelf, &child] {
        assert_eq!(
            count_by(
                pool,
                r#"SELECT COUNT(*) FROM "RackSlot" WHERE "id" = ?"#,
                id
            )
            .await,
            0
        );
    }
    assert_eq!(stored_checks(pool, &rack).await, "[]");
    let inventory = o.ok("GET", &inv, None, StatusCode::OK).await;
    assert_eq!(inventory["items"].as_array().unwrap().len(), 5);
    let cd = o.ok("GET", &canvas_data, None, StatusCode::OK).await;
    let top = cd["rack"]["slots"].as_array().unwrap();
    assert_eq!(top.len(), 4, "{top:?}");
    assert!(top.iter().all(|s| s["startU"].is_null()), "{top:?}");
    assert_eq!(cd["rack"]["constructionChecks"], json!([]));

    // ── 9. The container deleted, without any orphan ────────────────────
    let r = o
        .ok(
            "DELETE",
            &format!("{base}/racks/{rack}"),
            None,
            StatusCode::OK,
        )
        .await;
    assert_eq!(r, json!({ "ok": true }));
    let r = o.req("GET", &canvas_data, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "{:?}", r.body);
    for table in [
        "RackSlot",
        "RackInventoryItem",
        "RigRack",
        "RackConnection",
        "SynopticAdapter",
    ] {
        assert_eq!(
            count_by(
                pool,
                &format!(r#"SELECT COUNT(*) FROM "{table}" WHERE "rackId" = ?"#),
                &rack
            )
            .await,
            0,
            "{table}"
        );
    }
    for (sql, n) in [
        (r#"SELECT COUNT(*) FROM "RackSlot""#, 0),
        (r#"SELECT COUNT(*) FROM "RackInventoryItem""#, 0),
        // Only the location's virtual rack is left.
        (r#"SELECT COUNT(*) FROM "Rack""#, 1),
        (
            r#"SELECT COUNT(*) FROM "Rack" WHERE "id" NOT IN (SELECT "rackId" FROM "RigRack")"#,
            0,
        ),
        (
            r#"SELECT COUNT(*) FROM "RackSlot" WHERE "parentSlotId" IS NOT NULL AND "parentSlotId" NOT IN (SELECT "id" FROM "RackSlot")"#,
            0,
        ),
    ] {
        assert_eq!(count(pool, sql).await, n, "{sql}");
    }
    assert_eq!(
        count_by(
            pool,
            r#"SELECT COUNT(*) FROM "Rack" WHERE "id" = ?"#,
            &virtual_rack
        )
        .await,
        1
    );
    let fk = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(fk.len(), 0, "foreign_key_check");
    let ed = o
        .ok("GET", &format!("{base}/editor"), None, StatusCode::OK)
        .await;
    let rack_ids: Vec<String> = ed["inventaire"]["racks"]
        .as_array()
        .unwrap()
        .iter()
        .map(id_of)
        .collect();
    assert_eq!(rack_ids, vec![virtual_rack]);
}
