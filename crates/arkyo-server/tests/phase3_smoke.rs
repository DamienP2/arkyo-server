//! End-to-end path of phase 3 (Task 13), over HTTP on a fresh database:
//! owner setup, project with its location and container (the wizard's three
//! calls), a template container, a panel with three slots, a rig linking the
//! template container, a catalogue equipment placed in rack slots (its
//! DELETE is refused), project deletion, the container library, then the
//! phase-2 catalogue backup (export, purge, restore) is unaffected.
//!
//! Request bodies are the ones the front sends:
//! `web/src/app/auth/setup-page.tsx`,
//! `web/src/components/projects/new-project-dialog.tsx` (`onSubmit`, with
//! `buildRackPayload` of `components/racks/rack-wizard-steps.tsx`),
//! `web/src/app/(app)/racks/racks-client.tsx` (`NewRackWizard.onSubmit`),
//! `web/src/components/panels/new-panel-wizard.tsx` via `panels-client.tsx`,
//! `web/src/app/(fullscreen)/panels/[id]/panel-editor.tsx`
//! (`handlePlaceConnectors`), `web/src/app/(app)/rigs/[id]/rig-detail-client.tsx`
//! and arkyo's `rigs-client.tsx` for the rig (`{ name, type, notes }`).
//!
//! Placing equipment in a rack is the rack editor's job (phase 4): no route
//! of phase 3 writes `RackSlot`, so those two rows are inserted in SQL.
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};

const PROJECTS: &str = "/api/tenant/projects";
const RACKS: &str = "/api/racks";
const RIGS: &str = "/api/rigs";
const PANELS: &str = "/api/panels";
const EQUIPMENT: &str = "/api/tenant/catalogue/equipment";
const BRANDS: &str = "/api/tenant/parametres/brands";
/// Every section, like the default selection of `backup-card.tsx`.
const BACKUP: &str = "/api/tenant/parametres/backup?sections=equipment,cables,adapters,settings";
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

    /// The backup export without the fields that legitimately change
    /// between two exports of the same catalogue (see `phase2_smoke.rs`).
    async fn backup(&self) -> Value {
        let mut b = self.ok("GET", BACKUP, None, StatusCode::OK).await;
        b["meta"].as_object_mut().unwrap().remove("exportedAt");
        for row in b["data"]["settings"]["appConfig"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("updatedAt");
        }
        b
    }
}

fn ids(list: &Value) -> Vec<&str> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect()
}

fn id_of(v: &Value) -> String {
    v["id"].as_str().unwrap().to_string()
}

async fn count(pool: &sqlx::SqlitePool, sql: &str, bind: &str) -> i64 {
    sqlx::query_scalar(sql)
        .bind(bind)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn phase3_project_templates_panel_rig_and_catalogue() {
    let e = env().await;

    // 1. Owner (setup page body).
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

    // 2. Project wizard: project, first location, first container.
    let project = o
        .ok(
            "POST",
            PROJECTS,
            Some(json!({
                "name": "Finale Coupe",
                "interventionType": "PRESTATION",
                "rigType": "FLIGHT_CASE",
                "clientName": "France TV",
                "location": "Stade de France",
                "planningStart": "2026-11-20",
                "planningEnd": "2026-11-23",
                "shootingDate": "2026-11-22",
            })),
            StatusCode::CREATED,
        )
        .await;
    let pid = id_of(&project);
    assert_eq!(project["rigType"], "FLIGHT_CASE");
    assert_eq!(project["status"], "EN_PREPARATION");
    let location = o
        .ok(
            "POST",
            &format!("{PROJECTS}/{pid}/locations"),
            Some(json!({ "name": "Car régie" })),
            StatusCode::CREATED,
        )
        .await;
    let location_id = id_of(&location);
    let virtual_rack = location["virtualRackId"].as_str().unwrap().to_string();
    let created = o
        .ok(
            "POST",
            &format!("{PROJECTS}/{pid}/racks"),
            Some(json!({ "racks": [{
                "name": "Baie vidéo",
                "rackType": "STANDARD",
                "isRackable": true,
                "depthMm": 600,
                "totalU": 42,
                "locationId": location_id,
            }] })),
            StatusCode::CREATED,
        )
        .await;
    let project_rack = id_of(&created["racks"][0]);
    let list = o.ok("GET", PROJECTS, None, StatusCode::OK).await;
    assert!(
        list.to_string().contains(&pid),
        "projects list without the new project: {list}"
    );
    // Dashboard (`dashboard/page.tsx`): projects and task stats.
    let legacy = o.ok("GET", "/api/projects", None, StatusCode::OK).await;
    assert_eq!(ids(&legacy), vec![pid.as_str()]);
    let stats = o
        .ok("GET", "/api/projects?stats=tasks", None, StatusCode::OK)
        .await;
    assert_eq!(stats, json!([]));
    let locations = o
        .ok(
            "GET",
            &format!("{PROJECTS}/{pid}/locations"),
            None,
            StatusCode::OK,
        )
        .await;
    assert_eq!(ids(&locations), vec![location_id.as_str()]);

    // 3. Template container (racks-client.tsx: flight case with wheels,
    // empty weight and rear rails).
    let template = o
        .ok(
            "POST",
            RACKS,
            Some(json!({
                "name": "Flight 12U",
                "rackType": "FLIGHT_CASE_CLASSIC",
                "isRackable": true,
                "totalU": 12,
                "depthMm": 600,
                "hasWheels": true,
                "emptyWeightKg": 18.5,
                "rearInteriorGapMm": 50,
            })),
            StatusCode::CREATED,
        )
        .await;
    let template_rack = id_of(&template);
    assert_eq!(template["rackType"], "FLIGHT_CASE_CLASSIC");
    assert_eq!(template["hasWheels"], true);
    assert_eq!(template["emptyWeightKg"], 18.5);
    assert_eq!(template["rearInteriorGapMm"], 50);

    // 4. Panel (new-panel-wizard.tsx defaults) with three slots placed by
    // the panel editor (handlePlaceConnectors).
    let panel = o
        .ok(
            "POST",
            PANELS,
            Some(json!({
                "name": "Patch SDI",
                "heightU": 1,
                "slotsPerU": 8,
                "rearCableDepthMm": 80,
                "notes": "Face avant",
            })),
            StatusCode::CREATED,
        )
        .await;
    let panel_id = id_of(&panel);
    let connectors = o
        .ok(
            "GET",
            "/api/tenant/catalogue/connectors",
            None,
            StatusCode::OK,
        )
        .await;
    let connectors = ids(&connectors);
    assert!(connectors.len() >= 2, "{connectors:?}");
    let (left, right) = (connectors[0].to_string(), connectors[1].to_string());
    for position in 1..=3 {
        let slot = o
            .ok(
                "POST",
                &format!("{PANELS}/{panel_id}/slots"),
                Some(json!({
                    "position": position,
                    "connectorTypeId": left,
                    "sizeSlots": 1,
                    "mountD": false,
                    "familyLabel": null,
                })),
                StatusCode::CREATED,
            )
            .await;
        assert_eq!(slot["position"], position);
        assert_eq!(slot["connectorTypeId"], left.as_str());
        assert_eq!(slot["connectorType"]["id"], left.as_str());
    }
    let detail = o
        .ok("GET", &format!("{PANELS}/{panel_id}"), None, StatusCode::OK)
        .await;
    let mut positions: Vec<i64> = detail["slots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["position"].as_i64().unwrap())
        .collect();
    positions.sort_unstable();
    assert_eq!(positions, vec![1, 2, 3]);
    let panels = o.ok("GET", PANELS, None, StatusCode::OK).await;
    assert_eq!(ids(&panels), vec![panel_id.as_str()]);

    // 5. Rig (arkyo rigs-client.tsx body), then the rig page links the
    // template container (rig-detail-client.tsx).
    let rig = o
        .ok(
            "POST",
            RIGS,
            Some(json!({ "name": "Régie OB", "type": "FLIGHT_CASE", "notes": "" })),
            StatusCode::CREATED,
        )
        .await;
    let rig_id = id_of(&rig);
    assert_eq!(rig["projectId"], Value::Null);
    let link = o
        .ok(
            "POST",
            &format!("{RIGS}/{rig_id}/racks"),
            Some(json!({ "rackId": template_rack })),
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(link["rackId"], template_rack.as_str());
    assert_eq!(link["rigConfigId"], rig_id.as_str());
    let detail = o
        .ok("GET", &format!("{RIGS}/{rig_id}"), None, StatusCode::OK)
        .await;
    let linked: Vec<&str> = detail["rigRacks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|rr| rr["rackId"].as_str().unwrap())
        .collect();
    assert_eq!(linked, vec![template_rack.as_str()]);

    // 6. Catalogue equipment (brand + equipment editor payloads, as in
    // phase2_smoke.rs), placed in the template container and in the project
    // container, plus the panel in the template container.
    let brand = o
        .ok(
            "POST",
            BRANDS,
            Some(json!({ "name": "Marque Phase 3", "website": null, "logoUrl": null })),
            StatusCode::CREATED,
        )
        .await;
    let equipment = o
        .ok(
            "POST",
            EQUIPMENT,
            Some(json!({
                "name": "Mélangeur Vidéo",
                "reference": "MV-300",
                "category": null,
                "brandId": brand["id"],
                "isRackable": true,
                "heightU": 2,
                "depthMm": 450,
                "rearCableDepthMm": null,
                "widthFraction": "FULL",
                "dimLmm": null, "dimWmm": null, "dimHmm": null,
                "weight": 7.5, "powerW": 120, "heatBtuH": 409.5,
                "connectors": [{
                    "id": "port-in-1", "face": "REAR", "connectorTypeId": right,
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
            })),
            StatusCode::CREATED,
        )
        .await;
    let equipment_id = id_of(&equipment);
    for (slot, rack, column, target, start) in [
        (
            "slot-tpl-eq",
            &template_rack,
            "catalogEquipmentId",
            &equipment_id,
            1,
        ),
        ("slot-tpl-panel", &template_rack, "panelId", &panel_id, 4),
        (
            "slot-prj-eq",
            &project_rack,
            "catalogEquipmentId",
            &equipment_id,
            1,
        ),
    ] {
        sqlx::query(&format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","{column}","startU","heightU","createdAt","updatedAt")
               VALUES (?, ?, ?, ?, 1, ?, ?)"#
        ))
        .bind(slot)
        .bind(rack)
        .bind(target)
        .bind(start)
        .bind(NOW)
        .bind(NOW)
        .execute(&e.pool)
        .await
        .unwrap();
    }
    let path = format!("{EQUIPMENT}/{equipment_id}");
    let r = o.req("DELETE", &path, None).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(
        r.body,
        json!({"error": "Utilisé dans 2 projet(s) — suppression impossible", "usageCount": 2})
    );
    o.ok("GET", &path, None, StatusCode::OK).await;

    // 7. Project deletion: its rig, its location's virtual container and
    // its own container go; the template container (linked to a rig of no
    // project) and its slots stay.
    let r = o
        .ok("DELETE", &format!("{PROJECTS}/{pid}"), None, StatusCode::OK)
        .await;
    assert_eq!(r, json!({ "ok": true }));
    let r = o.req("GET", &format!("{PROJECTS}/{pid}"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "{:?}", r.body);
    let list = o.ok("GET", PROJECTS, None, StatusCode::OK).await;
    assert!(!list.to_string().contains(&pid), "{list}");
    assert_eq!(
        count(
            &e.pool,
            r#"SELECT COUNT(*) FROM "RigConfig" WHERE "projectId" = ?"#,
            &pid
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &e.pool,
            r#"SELECT COUNT(*) FROM "RackSlot" WHERE "rackId" = ?"#,
            &project_rack
        )
        .await,
        0
    );
    // The equipment is still used by the template container only.
    let r = o.req("DELETE", &path, None).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(r.body["usageCount"], 1);

    // 8. Container library: the template container only, with its rig
    // and its two slots. No project or virtual container is left at all.
    let library = o
        .ok(
            "GET",
            &format!("{RACKS}?templates=true"),
            None,
            StatusCode::OK,
        )
        .await;
    assert_eq!(ids(&library), vec![template_rack.as_str()]);
    let rack = &library[0];
    assert_eq!(rack["rigs"][0]["rigConfigId"], rig_id.as_str());
    assert_eq!(
        rack["rigs"][0]["rigConfig"],
        json!({ "id": rig_id, "name": "Régie OB" })
    );
    let slots = rack["slots"].as_array().unwrap();
    assert_eq!(slots.len(), 2, "{slots:?}");
    let eq_slot = slots.iter().find(|s| s["id"] == "slot-tpl-eq").unwrap();
    assert_eq!(eq_slot["equipment"]["name"], "Mélangeur Vidéo");
    let panel_slot = slots.iter().find(|s| s["id"] == "slot-tpl-panel").unwrap();
    assert_eq!(panel_slot["panel"]["id"], panel_id.as_str());
    assert_eq!(panel_slot["panel"]["slots"].as_array().unwrap().len(), 3);
    let all = o.ok("GET", RACKS, None, StatusCode::OK).await;
    let all = ids(&all);
    assert_eq!(all, vec![template_rack.as_str()]);
    assert!(!all.contains(&virtual_rack.as_str()));
    assert!(!all.contains(&project_rack.as_str()));
    let rigs = o.ok("GET", RIGS, None, StatusCode::OK).await;
    assert_eq!(ids(&rigs), vec![rig_id.as_str()]);

    // 9. Phase-2 catalogue backup: the export still works and contains our
    // equipment; purge then restore (both modes) gives back the same
    // export, and the container slot still resolves the equipment.
    let before = o.backup().await;
    assert_eq!(before["meta"]["format"], "arkyo-backup");
    assert!(before["data"]["equipment"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x["id"] == equipment_id.as_str()));
    let file = o.ok("GET", BACKUP, None, StatusCode::OK).await;
    for mode in ["merge", "replace"] {
        let r = o
            .ok(
                "POST",
                "/api/admin/purge",
                Some(json!({ "target": "all" })),
                StatusCode::OK,
            )
            .await;
        assert_eq!(r, json!({ "ok": true }));
        let r = o.req("GET", &path, None).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{mode}: {:?}", r.body);
        let modes = json!({ "equipment": mode, "cables": mode,
                            "adapters": mode, "settings": mode });
        let r = o
            .ok(
                "POST",
                "/api/tenant/parametres/backup/restore",
                Some(json!({ "modes": modes, "backup": file })),
                StatusCode::OK,
            )
            .await;
        assert_eq!(r["report"]["equipment"]["created"], 1, "{mode}: {r:?}");
        assert_eq!(o.backup().await, before, "{mode}: export differs");
        let library = o
            .ok(
                "GET",
                &format!("{RACKS}?templates=true"),
                None,
                StatusCode::OK,
            )
            .await;
        let slot = library[0]["slots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == "slot-tpl-eq")
            .unwrap()
            .clone();
        assert_eq!(slot["equipment"]["id"], equipment_id.as_str(), "{mode}");
        let r = o.req("DELETE", &path, None).await;
        assert_eq!(r.status, StatusCode::CONFLICT, "{mode}: {:?}", r.body);
    }
}
