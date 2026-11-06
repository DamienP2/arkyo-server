//! End-to-end path of phase 4a (Task 13), over HTTP on a fresh database:
//! owner setup, a catalogue (equipment, modular host and card, panel,
//! adapter, cable), the project wizard's three calls, a second location,
//! the container's inventory (equipment merged, panel, adapter, accessory,
//! host and a component in it), transfers (whole item and partial), the
//! container saved as a template then cloned back into the project, the
//! editor data, the usage guard of the cable and the adapter, then the
//! deletion of the location and of the project without any orphan.
//!
//! Request bodies are the ones the front sends:
//! `web/src/app/auth/setup-page.tsx`,
//! `web/src/components/projects/new-project-dialog.tsx` (`onSubmit`, with
//! `buildRackPayload` of `components/racks/rack-wizard-steps.tsx`) and, under
//! `web/src/app/(fullscreen)/project/[id]/inventaire/`:
//! `_components/inventaire-scope.tsx` (`createLocation`, `handleConfirmAdd`,
//! `handleHostDrop`, `handleTransferItem`, `assignRackToLocation`,
//! `deleteLocation`), `_components/component-config-modal.tsx`
//! (`handleInstall`), `_components/container-properties-panel.tsx`
//! (`handleSaveAsTemplate`), `_components/add-container-wizard.tsx`
//! (`handleSelectTemplate`) and `_components/item-properties-panel.tsx`
//! (item `DELETE`). The editor is read as `[id]/page.tsx` reads it.
//!
//! The cable and the synoptic adapter are used by `RackConnection` and
//! `SynopticAdapter`, which only the rack editor writes (phases 4b to 4d):
//! those two rows are inserted in SQL.
mod common;
use std::collections::BTreeSet;

use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const PROJECTS: &str = "/api/tenant/projects";
const EQUIPMENT: &str = "/api/tenant/catalogue/equipment";
const CABLES: &str = "/api/tenant/catalogue/cables";
const ADAPTERS: &str = "/api/tenant/catalogue/adapters";
const BRANDS: &str = "/api/tenant/parametres/brands";
const NOW: &str = "2026-11-06T10:00:00.000Z";

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

/// Ghost and placed slots of an inventory item.
async fn slots_of(pool: &SqlitePool, item: &str) -> i64 {
    count_by(
        pool,
        r#"SELECT COUNT(*) FROM "RackSlot" WHERE "inventoryItemId" = ?"#,
        item,
    )
    .await
}

/// The equipment editor's payload (`equipment-editor.tsx`, as in
/// `phase3_smoke.rs`), with `extra` merged over it.
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

/// `(id, kind, quantity, hostItemId)` of each line of a BOM, editor or
/// inventory route alike.
fn bom_lines(items: &Value) -> BTreeSet<(String, String, i64, Option<String>)> {
    items
        .as_array()
        .unwrap()
        .iter()
        .map(|it| {
            (
                id_of(it),
                it["kind"].as_str().unwrap().to_string(),
                it["quantity"].as_i64().unwrap(),
                it["hostItemId"].as_str().map(str::to_string),
            )
        })
        .collect()
}

/// `(kind, quantity, has host)` of a BOM: what a clone keeps.
fn bom_shape(items: &Value) -> Vec<(String, i64, bool)> {
    let mut v: Vec<_> = items
        .as_array()
        .unwrap()
        .iter()
        .map(|it| {
            (
                it["kind"].as_str().unwrap().to_string(),
                it["quantity"].as_i64().unwrap(),
                it["hostItemId"].is_string(),
            )
        })
        .collect();
    v.sort();
    v
}

#[tokio::test]
async fn phase4a_project_editor_inventory_end_to_end() {
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
            Some(json!({ "name": "Marque Phase 4a", "website": null, "logoUrl": null })),
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
    let left = id_of(&connectors[0]);
    let right = id_of(&connectors[1]);
    let mixer = o
        .ok(
            "POST",
            EQUIPMENT,
            Some(equipment_body("Mélangeur Vidéo", &brand, &right, json!({}))),
            StatusCode::CREATED,
        )
        .await;
    let mixer = id_of(&mixer);
    let host = o
        .ok(
            "POST",
            EQUIPMENT,
            Some(equipment_body(
                "Châssis modulaire",
                &brand,
                &right,
                json!({ "isComponentHost": true, "hostSlotCount": 4 }),
            )),
            StatusCode::CREATED,
        )
        .await;
    let host = id_of(&host);
    let card = o
        .ok(
            "POST",
            EQUIPMENT,
            Some(equipment_body(
                "Carte SDI",
                &brand,
                &right,
                json!({ "isRackable": false, "heightU": null, "isComponent": true,
                        "componentSlotSpan": 1 }),
            )),
            StatusCode::CREATED,
        )
        .await;
    let card = id_of(&card);
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
    let adapter = o
        .ok(
            "POST",
            ADAPTERS,
            Some(json!({
                "name": "Adaptateur BNC", "reference": "AD-4A", "functionId": null,
                "inputs": [{ "connectorTypeId": left, "gender": "MALE", "quantity": 1, "label": "Entrée" }],
                "outputs": [{ "connectorTypeId": right, "gender": "FEMALE", "quantity": 1, "label": "Sortie" }],
                "notes": null, "imageUrl": null
            })),
            StatusCode::CREATED,
        )
        .await;
    let adapter = id_of(&adapter);
    let cable = o
        .ok(
            "POST",
            CABLES,
            Some(json!({
                "name": "Cordon BNC", "reference": "CB-4A",
                "leftConnectorId": left, "leftGender": "MALE",
                "rightConnectorId": right, "rightGender": "MALE",
                "functionId": null, "brandId": brand, "model": null,
                "useCases": [], "availableLengths": [1, 2],
                "customMinLength": null, "customMaxLength": null,
                "notes": null, "imageUrl": null
            })),
            StatusCode::CREATED,
        )
        .await;
    let cable = id_of(&cable);

    // ── 1. Project wizard: project, first location, first container ─────
    let project = o
        .ok(
            "POST",
            PROJECTS,
            Some(json!({
                "name": "Tournoi Indoor",
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
    let car = o
        .ok(
            "POST",
            &format!("{base}/locations"),
            Some(json!({ "name": "Car régie" })),
            StatusCode::CREATED,
        )
        .await;
    let car_id = id_of(&car);
    let car_virtual = car["virtualRackId"].as_str().unwrap().to_string();
    let created = o
        .ok(
            "POST",
            &format!("{base}/racks"),
            Some(json!({ "racks": [{
                "name": "Baie vidéo",
                "rackType": "STANDARD",
                "isRackable": true,
                "depthMm": 600,
                "totalU": 42,
                "locationId": car_id,
            }] })),
            StatusCode::CREATED,
        )
        .await;
    let rack = id_of(&created["racks"][0]);
    let inv = |rack: &str| format!("{base}/racks/{rack}/inventory");

    // ── 2. Second location (createLocation) ─────────────────────────────
    let plateau = o
        .ok(
            "POST",
            &format!("{base}/locations"),
            Some(json!({ "name": "Plateau" })),
            StatusCode::CREATED,
        )
        .await;
    let plateau_id = id_of(&plateau);
    let plateau_virtual = plateau["virtualRackId"].as_str().unwrap().to_string();
    assert_ne!(plateau_virtual, car_virtual);
    let locations = o
        .ok("GET", &format!("{base}/locations"), None, StatusCode::OK)
        .await;
    let ids: Vec<String> = locations.as_array().unwrap().iter().map(id_of).collect();
    assert_eq!(ids, vec![car_id.clone(), plateau_id.clone()]);

    // ── 3. Inventory of the container (handleConfirmAdd, handleHostDrop) ─
    let r = o
        .ok(
            "POST",
            &inv(&rack),
            Some(json!({ "equipmentId": mixer, "quantity": 2 })),
            StatusCode::CREATED,
        )
        .await;
    let mixer_item = id_of(&r["item"]);
    assert_eq!(r["item"]["kind"], "equipment");
    assert_eq!(r["item"]["refId"], mixer.as_str());
    // A second drop of the same reference merges into the line.
    let r = o
        .ok(
            "POST",
            &inv(&rack),
            Some(json!({ "equipmentId": mixer, "quantity": 1 })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(id_of(&r["item"]), mixer_item);
    assert_eq!(r["item"]["quantity"], 3);
    let r = o
        .ok(
            "POST",
            &inv(&rack),
            Some(json!({ "panelId": panel, "quantity": 1 })),
            StatusCode::CREATED,
        )
        .await;
    let panel_item = id_of(&r["item"]);
    assert_eq!(r["item"]["kind"], "panel");
    let r = o
        .ok(
            "POST",
            &inv(&rack),
            Some(json!({ "adapterId": adapter, "quantity": 3 })),
            StatusCode::CREATED,
        )
        .await;
    let adapter_item = id_of(&r["item"]);
    assert_eq!(r["item"]["kind"], "adapter");
    let r = o
        .ok(
            "POST",
            &inv(&rack),
            Some(json!({
                "accessoryType": "etagere", "accessoryHeightU": 1,
                "accessoryDepthMm": 300, "quantity": 1,
            })),
            StatusCode::CREATED,
        )
        .await;
    let shelf_item = id_of(&r["item"]);
    assert_eq!(r["item"]["kind"], "accessory");
    let r = o
        .ok(
            "POST",
            &inv(&rack),
            Some(json!({ "catalogEquipmentId": host })),
            StatusCode::CREATED,
        )
        .await;
    let host_item = id_of(&r["item"]);
    assert_eq!(r["item"]["isComponentHost"], true);
    assert_eq!(r["item"]["hostSlotCount"], 4);
    // Ghost slots: one per unit of equipment or panel, none for an
    // adapter or an accessory.
    assert_eq!(slots_of(pool, &mixer_item).await, 3);
    assert_eq!(slots_of(pool, &panel_item).await, 1);
    assert_eq!(slots_of(pool, &host_item).await, 1);
    assert_eq!(slots_of(pool, &adapter_item).await, 0);
    assert_eq!(slots_of(pool, &shelf_item).await, 0);

    // ── 4. A component in the host (component-config-modal) ─────────────
    let r = o
        .ok(
            "POST",
            &inv(&rack),
            Some(json!({
                "catalogEquipmentId": card, "hostItemId": host_item, "hostSlotIndex": 0,
            })),
            StatusCode::CREATED,
        )
        .await;
    let card_item = id_of(&r["item"]);
    assert_eq!(r["item"]["hostItemId"], host_item.as_str());
    assert_eq!(r["item"]["hostSlotIndex"], 0);
    assert_eq!(r["item"]["isComponent"], true);
    assert_eq!(slots_of(pool, &card_item).await, 0);
    // The same slot is taken now.
    let r = o
        .req(
            "POST",
            &inv(&rack),
            Some(json!({
                "catalogEquipmentId": card, "hostItemId": host_item, "hostSlotIndex": 0,
            })),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::CONFLICT, json!({ "error": "Slot occupé" }))
    );

    // ── 5. Transfers (handleTransferItem) ───────────────────────────────
    // Whole item (quantity 1): the transfer route, to the free equipment
    // of the second location. Its slots are purged, not re-synced.
    let r = o
        .ok(
            "POST",
            &format!("{}/{panel_item}/transfer", inv(&rack)),
            Some(json!({ "targetRackId": plateau_virtual })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(r["item"]["rackId"], plateau_virtual.as_str());
    assert_eq!(slots_of(pool, &panel_item).await, 0);
    // Part of a line (quantity > 1): one unit added to the target, the
    // source decremented.
    let r = o
        .ok(
            "POST",
            &inv(&car_virtual),
            Some(json!({ "catalogAdapterId": adapter, "quantity": 1 })),
            StatusCode::CREATED,
        )
        .await;
    let free_adapter = id_of(&r["item"]);
    let r = o
        .ok(
            "PATCH",
            &format!("{}/{adapter_item}", inv(&rack)),
            Some(json!({ "quantity": 2 })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(r["item"]["quantity"], 2);
    let source = o.ok("GET", &inv(&rack), None, StatusCode::OK).await;
    let expected_source: BTreeSet<_> = [
        (mixer_item.clone(), "equipment", 3, None),
        (adapter_item.clone(), "adapter", 2, None),
        (shelf_item.clone(), "accessory", 1, None),
        (host_item.clone(), "equipment", 1, None),
        (card_item.clone(), "equipment", 1, Some(host_item.clone())),
    ]
    .into_iter()
    .map(|(i, k, q, h)| (i, k.to_string(), q, h))
    .collect();
    assert_eq!(bom_lines(&source["items"]), expected_source);

    // ── 6. Saved as a template, then cloned into the project ────────────
    let saved = o
        .ok(
            "POST",
            &format!("{base}/racks/{rack}/save-as-template"),
            Some(json!({})),
            StatusCode::CREATED,
        )
        .await;
    let template = id_of(&saved["rack"]);
    let template_rig = id_of(&saved["rigConfig"]);
    assert_ne!(template, rack);
    // A saved template is a draft (`BROUILLON`, rack-clone.ts): on the
    // templates page, not yet in the wizard's library (`ACTIF` only).
    let drafts = o
        .ok("GET", "/api/racks?templates=true", None, StatusCode::OK)
        .await;
    assert!(drafts.to_string().contains(&template), "{drafts}");
    let library = o
        .ok(
            "GET",
            "/api/tenant/racks?templates=true",
            None,
            StatusCode::OK,
        )
        .await;
    assert_eq!(library, json!([]));
    // The template's status menu of the rack editor (arkyo
    // rigs/[id]/rack/[rackId]/rack-editor.tsx, phase 4d) makes it available.
    o.ok(
        "PATCH",
        &format!("/api/racks/{template}"),
        Some(json!({ "templateStatus": "ACTIF" })),
        StatusCode::OK,
    )
    .await;
    let library = o
        .ok(
            "GET",
            "/api/tenant/racks?templates=true",
            None,
            StatusCode::OK,
        )
        .await;
    assert_eq!(library[0]["id"], template.as_str(), "{library}");
    assert_eq!(
        count_by(
            pool,
            r#"SELECT COUNT(*) FROM "RackInventoryItem" WHERE "rackId" = ?"#,
            &template
        )
        .await,
        5
    );
    let cloned = o
        .ok(
            "POST",
            &format!("{base}/racks/clone-from-template"),
            Some(json!({ "rackTemplateId": template, "locationId": plateau_id })),
            StatusCode::CREATED,
        )
        .await;
    let clone = id_of(&cloned["rack"]);
    assert!(![rack.as_str(), template.as_str()].contains(&clone.as_str()));
    // arkyo's card has no `locationId` (the wizard falls back on its own):
    // the location is checked on the editor data below.
    assert!(cloned["rack"]["rigConfigId"].is_string(), "{cloned}");
    let clone_name = cloned["rack"]["name"].as_str().unwrap();
    assert!(
        clone_name.starts_with("Baie vidéo") && clone_name != "Baie vidéo",
        "{clone_name}"
    );
    let clone_inv = o.ok("GET", &inv(&clone), None, StatusCode::OK).await;
    assert_eq!(bom_shape(&clone_inv["items"]), bom_shape(&source["items"]));
    // The component hangs off the clone's own host.
    let clone_host = clone_inv["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|it| it["isComponentHost"] == true)
        .map(id_of)
        .unwrap();
    let clone_card = clone_inv["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|it| it["isComponent"] == true)
        .unwrap();
    assert_eq!(clone_card["hostItemId"], clone_host.as_str());

    // ── 7. Editor data (page.tsx) ───────────────────────────────────────
    let ed = o
        .ok("GET", &format!("{base}/editor"), None, StatusCode::OK)
        .await;
    assert_eq!(ed["header"]["id"], pid.as_str());
    assert_eq!(ed["header"]["name"], "Tournoi Indoor");
    assert_eq!(ed["fiche"]["id"], pid.as_str());
    assert_eq!(ed["cartographie"]["maps"], json!([]));
    let locs: Vec<(String, String)> = ed["inventaire"]["locations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| (id_of(l), l["virtualRackId"].as_str().unwrap().to_string()))
        .collect();
    assert_eq!(
        locs,
        vec![
            (car_id.clone(), car_virtual.clone()),
            (plateau_id.clone(), plateau_virtual.clone())
        ]
    );
    let racks = ed["inventaire"]["racks"].as_array().unwrap();
    let rack_ids: BTreeSet<String> = racks.iter().map(id_of).collect();
    let want: BTreeSet<String> = [&rack, &clone, &car_virtual, &plateau_virtual]
        .into_iter()
        .cloned()
        .collect();
    assert_eq!(rack_ids, want, "the template stays out of the project");
    for r in racks {
        let id = id_of(r);
        let location = r["locationId"].as_str().unwrap();
        let expected_location = if id == rack || id == car_virtual {
            &car_id
        } else {
            &plateau_id
        };
        assert_eq!(location, expected_location, "{id}");
        assert_eq!(
            r["isVirtual"],
            id == car_virtual || id == plateau_virtual,
            "{id}"
        );
        // Each BOM is the one of the inventory route.
        let listed = o.ok("GET", &inv(&id), None, StatusCode::OK).await;
        assert_eq!(bom_lines(&r["bom"]), bom_lines(&listed["items"]), "{id}");
    }
    let by_id = |id: &str| racks.iter().find(|r| r["id"] == id).unwrap();
    assert_eq!(
        bom_lines(&by_id(&plateau_virtual)["bom"]),
        BTreeSet::from([(panel_item.clone(), "panel".to_string(), 1, None)])
    );
    assert_eq!(
        bom_lines(&by_id(&car_virtual)["bom"]),
        BTreeSet::from([(free_adapter.clone(), "adapter".to_string(), 1, None)])
    );

    // ── 8. A used cable or adapter is not deleted (409) ─────────────────
    let slot: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "RackSlot" WHERE "inventoryItemId" = ? LIMIT 1"#)
            .bind(&mixer_item)
            .fetch_one(pool)
            .await
            .unwrap();
    for sql in [
        r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","label","createdAt","updatedAt")
           VALUES ('syn-4a', ?, ?, 10, 20, 'Adapt', ?, ?)"#,
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toAdapterId","toAdapterSide","toAdapterPortIndex","catalogCableModelId","createdAt")
           VALUES ('cx-4a', ?, ?, 0, 'syn-4a', 'A', 0, ?, ?)"#,
    ] {
        let q = sqlx::query(sql).bind(&rack);
        let q = if sql.contains("RackConnection") {
            q.bind(&slot).bind(&cable).bind(NOW)
        } else {
            q.bind(&adapter).bind(NOW).bind(NOW)
        };
        q.execute(pool).await.unwrap();
    }
    let r = o.req("DELETE", &format!("{CABLES}/{cable}"), None).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(
        r.body,
        json!({ "error": "Utilisé dans 1 connexion(s) — suppression impossible", "usageCount": 1 })
    );
    let r = o
        .req("DELETE", &format!("{ADAPTERS}/{adapter}"), None)
        .await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    // arkyo-server: the inventory rows count too (arkyo: synoptics only):
    // the synoptic, plus the 4 inventory rows of the containers, the saved
    // template and its clone built above.
    let inventory_rows: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "RackInventoryItem" WHERE "catalogAdapterId" = ?"#,
    )
    .bind(&adapter)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(inventory_rows, 4);
    assert_eq!(
        r.body,
        json!({ "error": "Utilisé dans 5 synoptique(s) ou inventaire(s) — suppression impossible", "usageCount": 5 })
    );
    o.ok("GET", &format!("{CABLES}/{cable}"), None, StatusCode::OK)
        .await;
    o.ok(
        "GET",
        &format!("{ADAPTERS}/{adapter}"),
        None,
        StatusCode::OK,
    )
    .await;

    // ── 9. Location, then project, deleted without orphans ──────────────
    let location_url = format!("{base}/locations/{plateau_id}");
    let r = o.req("DELETE", &location_url, None).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(
        r.body["error"],
        "Ce lieu contient des contenants — déplacez-les avant suppression"
    );
    // assignRackToLocation: the cloned container goes to the first one.
    o.ok(
        "PATCH",
        &format!("{base}/racks/{clone}"),
        Some(json!({ "locationId": car_id })),
        StatusCode::OK,
    )
    .await;
    let r = o.req("DELETE", &location_url, None).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(
        r.body["error"],
        "Ce lieu contient des équipements libres — retirez-les avant suppression"
    );
    let r = o
        .ok(
            "DELETE",
            &format!("{}/{panel_item}", inv(&plateau_virtual)),
            None,
            StatusCode::OK,
        )
        .await;
    assert_eq!(r, json!({ "ok": true }));
    let r = o.ok("DELETE", &location_url, None, StatusCode::OK).await;
    assert_eq!(r, json!({ "ok": true }));
    assert_eq!(
        count_by(
            pool,
            r#"SELECT COUNT(*) FROM "Rack" WHERE "id" = ?"#,
            &plateau_virtual
        )
        .await,
        0
    );
    let ed = o
        .ok("GET", &format!("{base}/editor"), None, StatusCode::OK)
        .await;
    let rack_ids: BTreeSet<String> = ed["inventaire"]["racks"]
        .as_array()
        .unwrap()
        .iter()
        .map(id_of)
        .collect();
    assert_eq!(
        rack_ids,
        BTreeSet::from([rack.clone(), clone.clone(), car_virtual.clone()])
    );
    assert_eq!(ed["inventaire"]["locations"].as_array().unwrap().len(), 1);

    let r = o.ok("DELETE", &base, None, StatusCode::OK).await;
    assert_eq!(r, json!({ "ok": true }));
    let r = o.req("GET", &format!("{base}/editor"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "{:?}", r.body);

    // Only the template is left: its rig, its rack, its inventory and
    // slots. No row of the project survives, nothing dangles.
    for (sql, n) in [
        (r#"SELECT COUNT(*) FROM "Project""#, 0),
        (r#"SELECT COUNT(*) FROM "Location""#, 0),
        (
            r#"SELECT COUNT(*) FROM "RigConfig" WHERE "projectId" IS NOT NULL"#,
            0,
        ),
        (r#"SELECT COUNT(*) FROM "SynopticAdapter""#, 0),
        (r#"SELECT COUNT(*) FROM "RackConnection""#, 0),
        // Every rack belongs to a rig, every rig rack to the template rig.
        (
            r#"SELECT COUNT(*) FROM "Rack" WHERE "id" NOT IN (SELECT "rackId" FROM "RigRack")"#,
            0,
        ),
        (
            r#"SELECT COUNT(*) FROM "RigRack" rr JOIN "RigConfig" g ON g."id" = rr."rigConfigId" WHERE g."projectId" IS NOT NULL"#,
            0,
        ),
        // Ghost slots always have their item.
        (
            r#"SELECT COUNT(*) FROM "RackSlot" WHERE "startU" IS NULL AND "inventoryItemId" IS NULL"#,
            0,
        ),
        (
            r#"SELECT COUNT(*) FROM "RackInventoryItem" WHERE "hostItemId" IS NOT NULL AND "hostItemId" NOT IN (SELECT "id" FROM "RackInventoryItem")"#,
            0,
        ),
    ] {
        assert_eq!(count(pool, sql).await, n, "{sql}");
    }
    let racks: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "Rack""#)
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(racks, vec![template.clone()]);
    let rigs: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "RigConfig""#)
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(rigs, vec![template_rig]);
    assert_eq!(
        count_by(
            pool,
            r#"SELECT COUNT(*) FROM "RackInventoryItem" WHERE "rackId" <> ?"#,
            &template
        )
        .await,
        0
    );
    assert_eq!(
        count_by(
            pool,
            r#"SELECT COUNT(*) FROM "RackSlot" WHERE "rackId" <> ?"#,
            &template
        )
        .await,
        0
    );
    let fk = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(fk.len(), 0, "foreign_key_check");

    // The template still uses the equipment; the cable is free again.
    let r = o.req("DELETE", &format!("{EQUIPMENT}/{mixer}"), None).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    o.ok("DELETE", &format!("{CABLES}/{cable}"), None, StatusCode::OK)
        .await;
    let library = o
        .ok(
            "GET",
            "/api/tenant/racks?templates=true",
            None,
            StatusCode::OK,
        )
        .await;
    assert!(library.to_string().contains(&template), "{library}");
}
