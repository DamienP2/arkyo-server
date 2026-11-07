//! End-to-end path of phase 4c (Task 14), over HTTP on a fresh database:
//! owner setup, a catalogue (a camera, a monitor, an adapter, a cable
//! model), a project with two locations (« Plateau »: containers R1 and R2
//! plus free equipment in its virtual rack; « Régie »: container R3), the
//! synoptic objects (zone, label, adapter, external port, bundle), the
//! cabling (intra-rack, batch, through the adapter, inter-location
//! project cable), the renumbering run twice without any change, the audit
//! reads, then the deletion of the adapter and of R1 without any orphan,
//! and the cable-model guard (409).
//!
//! Request bodies are the ones the front sends:
//! - setup, project, locations, containers, inventory and placement: as in
//!   `phase4b_smoke.rs`; the free equipment is the inventory of the
//!   location's virtual rack (`inventaire-scope.tsx`, drop on a location);
//! - `web/src/components/synoptique/synoptic-view.tsx`: `createZoneApi`,
//!   `createLabelApi`, `insertAdapterAtPort`, the external-port marker,
//!   « Créer un faisceau », the cable drawing (`cabling.createOne` with
//!   `devirtualizeEndpoint`), the cable-model assignment
//!   (`patchOne {catalogCableModelId}`) and the renumbering
//!   (`{orderedIds, sideMap, onlyUnlabelled: true}`, the default);
//! - `web/src/app/(fullscreen)/project/[id]/synoptique/_components/`:
//!   `location-canvas.tsx` (routing of the location view: rack routes per
//!   container, then `POST …/synoptic/connections/renumber` with `{}`) and
//!   `general-canvas.tsx` (`doCreate` of a project cable, `{from, to,
//!   color, cableStyle}`);
//! - `components/synoptique/components/audit-panel.tsx` (`?limit=150`);
//! - `container-properties-panel.tsx` (container `DELETE`) and the
//!   parametres cabling page (cable model `POST` / `DELETE`).
mod common;
use std::collections::{BTreeMap, BTreeSet};

use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const PROJECTS: &str = "/api/tenant/projects";
const EQUIPMENT: &str = "/api/tenant/catalogue/equipment";
const ADAPTERS: &str = "/api/tenant/catalogue/adapters";
const CABLE_MODELS: &str = "/api/tenant/parametres/cabling";
const BRANDS: &str = "/api/tenant/parametres/brands";
const SAME_LOCATION: &str = "Les deux extrémités sont dans le même emplacement — tirez un câble direct dans la vue de l'emplacement.";

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

/// The ghost slot of an inventory item (free equipment, never placed).
async fn ghost_of(pool: &SqlitePool, item: &str) -> String {
    sqlx::query_scalar(r#"SELECT "id" FROM "RackSlot" WHERE "inventoryItemId" = ?"#)
        .bind(item)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// The equipment editor's payload (as in `phase4b_smoke.rs`), with one
/// SDI connector line of `quantity` ports in `direction`.
fn equipment_body(name: &str, brand: &str, connector: &str, direction: &str) -> Value {
    json!({
        "name": name,
        "reference": null,
        "category": null,
        "brandId": brand,
        "isRackable": true,
        "heightU": 1,
        "depthMm": 450,
        "rearCableDepthMm": null,
        "widthFraction": "FULL",
        "dimLmm": null, "dimWmm": null, "dimHmm": null,
        "weight": 4, "powerW": 60, "heatBtuH": 204.7,
        "connectors": [{
            "id": "port-1", "face": "REAR", "connectorTypeId": connector,
            "signalName": "SDI", "quantity": 2, "label": "SDI",
            "direction": direction, "gender": "FEMALE"
        }],
        "signalCapacities": [],
        "is2110": false, "ip2110Mode": null,
        "imageUrl": null, "iconUrl": null,
        "rackSymbolUrl": null, "rackSymbolRearUrl": null,
        "rackPhotoFrontUrl": null, "rackPhotoRearUrl": null,
        "notes": null, "documents": [], "tags": null, "isActive": true,
        "isLightingFixture": false, "dmxChannelsDefault": null, "dmxModes": [],
        "isComponentHost": false, "hostSlotCount": null,
        "isComponent": false, "componentSlotSpan": 1,
        "typeId": null, "functionIds": []
    })
}

/// `devirtualizeEndpoint` of a real slot port (`connection-devirt.ts`).
fn slot_end(prefix: &str, slot: &str, index: i64) -> Value {
    json!({
        format!("{prefix}SlotId"): slot,
        format!("{prefix}ConnectorIndex"): index,
        format!("{prefix}AdapterId"): null,
        format!("{prefix}AdapterSide"): null,
        format!("{prefix}AdapterPortIndex"): null,
        format!("{prefix}ComponentItemId"): null,
    })
}

/// `devirtualizeEndpoint` of an adapter port.
fn adapter_end(prefix: &str, adapter: &str, side: &str, index: i64) -> Value {
    json!({
        format!("{prefix}SlotId"): null,
        format!("{prefix}ConnectorIndex"): null,
        format!("{prefix}AdapterId"): adapter,
        format!("{prefix}AdapterSide"): side,
        format!("{prefix}AdapterPortIndex"): index,
        format!("{prefix}ComponentItemId"): null,
    })
}

/// The `cabling.createOne` payload of the cable drawing.
fn cable(from: Value, to: Value) -> Value {
    let mut body = json!({ "color": "#3b82f6", "cableStyle": "ortho", "waypoints": null });
    for end in [from, to] {
        for (k, v) in end.as_object().unwrap() {
            body[k] = v.clone();
        }
    }
    body
}

/// `{id: label}` of the cables of a synoptic payload (location: rack
/// cables, then project cables; general: project cables).
fn labels(payload: &Value) -> BTreeMap<String, Option<String>> {
    let mut out = BTreeMap::new();
    for key in ["connections", "projectConnections"] {
        for c in payload[key].as_array().into_iter().flatten() {
            out.insert(id_of(c), c["label"].as_str().map(str::to_string));
        }
    }
    out
}

#[tokio::test]
async fn phase4c_synoptic_end_to_end() {
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
            Some(json!({ "name": "Marque Phase 4c", "website": null, "logoUrl": null })),
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
    let camera = o
        .ok(
            "POST",
            EQUIPMENT,
            Some(equipment_body("Caméra", &brand, &bnc, "OUT")),
            StatusCode::CREATED,
        )
        .await;
    let camera = id_of(&camera);
    let monitor = o
        .ok(
            "POST",
            EQUIPMENT,
            Some(equipment_body("Moniteur", &brand, &bnc, "IN")),
            StatusCode::CREATED,
        )
        .await;
    let monitor = id_of(&monitor);
    let catalog_adapter = o
        .ok(
            "POST",
            ADAPTERS,
            Some(json!({
                "name": "Coupleur BNC", "reference": "AD-4C", "functionId": null,
                "inputs": [{ "connectorTypeId": bnc, "gender": "FEMALE", "quantity": 1, "label": "Entrée" }],
                "outputs": [{ "connectorTypeId": bnc, "gender": "FEMALE", "quantity": 1, "label": "Sortie" }],
                "notes": null, "imageUrl": null
            })),
            StatusCode::CREATED,
        )
        .await;
    let catalog_adapter = id_of(&catalog_adapter);
    let model = o
        .ok(
            "POST",
            CABLE_MODELS,
            Some(json!({ "name": "Coax HD-SDI", "reference": "CX-4C" })),
            StatusCode::CREATED,
        )
        .await;
    let model = id_of(&model);

    // ── 1. Project, 2 locations, 3 filled containers ────────────────────
    let project = o
        .ok(
            "POST",
            PROJECTS,
            Some(json!({
                "name": "Finale Synoptique",
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
    let mut locations = Vec::new();
    for name in ["Plateau", "Régie"] {
        let loc = o
            .ok(
                "POST",
                &format!("{base}/locations"),
                Some(json!({ "name": name })),
                StatusCode::CREATED,
            )
            .await;
        locations.push((
            id_of(&loc),
            loc["virtualRackId"].as_str().unwrap().to_string(),
        ));
    }
    let (plateau, v_plateau) = locations[0].clone();
    let (regie, _) = locations[1].clone();
    let mut racks = Vec::new();
    for (name, loc) in [("R1", &plateau), ("R2", &plateau), ("R3", &regie)] {
        let created = o
            .ok(
                "POST",
                &format!("{base}/racks"),
                Some(json!({ "racks": [{
                    "name": name,
                    "rackType": "STANDARD",
                    "isRackable": true,
                    "depthMm": 600,
                    "totalU": 12,
                    "locationId": loc,
                }] })),
                StatusCode::CREATED,
            )
            .await;
        racks.push(id_of(&created["racks"][0]));
    }
    let (r1, r2, r3) = (racks[0].clone(), racks[1].clone(), racks[2].clone());
    // Each container: a camera (1U) and a monitor (2U), placed in FRONT.
    let mut cams = Vec::new();
    let mut mons = Vec::new();
    for rack in [&r1, &r2, &r3] {
        let inv = format!("{base}/racks/{rack}/inventory");
        let slots = format!("/api/racks/{rack}/slots");
        for (eq, start_u, out) in [(&camera, 1, &mut cams), (&monitor, 2, &mut mons)] {
            o.ok(
                "POST",
                &inv,
                Some(json!({ "equipmentId": eq, "quantity": 1 })),
                StatusCode::CREATED,
            )
            .await;
            let slot = o
                .ok(
                    "POST",
                    &slots,
                    Some(json!({
                        "equipmentId": eq, "view": "FRONT", "startU": start_u, "heightU": 1,
                        "widthFraction": "FULL", "column": 0,
                    })),
                    StatusCode::CREATED,
                )
                .await;
            out.push(id_of(&slot));
        }
    }
    // Free equipment of « Plateau »: the inventory of its virtual rack.
    let v_inv = format!("{base}/racks/{v_plateau}/inventory");
    let mut free = Vec::new();
    for eq in [&camera, &monitor] {
        let r = o
            .ok(
                "POST",
                &v_inv,
                Some(json!({ "equipmentId": eq, "quantity": 1 })),
                StatusCode::CREATED,
            )
            .await;
        free.push(ghost_of(pool, &id_of(&r["item"])).await);
    }
    let (free_cam, free_mon) = (free[0].clone(), free[1].clone());

    let location_url = format!("{base}/synoptic/location/{plateau}");
    let general_url = format!("{base}/synoptic/general");
    let payload = o.ok("GET", &location_url, None, StatusCode::OK).await;
    let slot_ids: BTreeSet<String> = payload["slots"]
        .as_array()
        .unwrap()
        .iter()
        .map(id_of)
        .collect();
    for s in [&cams[0], &mons[0], &cams[1], &mons[1], &free_cam, &free_mon] {
        assert!(slot_ids.contains(s), "{s} absent de la vue du lieu");
    }
    assert!(
        !slot_ids.contains(&cams[2]),
        "R3 n'est pas dans « Plateau »"
    );

    // ── 2. Zone, label, adapter, external port (location view) ──────────
    // Decor (zones, labels, bundles) lives on the pivot: the virtual rack.
    let zone = o
        .ok(
            "POST",
            &format!("/api/racks/{v_plateau}/zones"),
            Some(json!({
                "label": "Zone", "labelPosition": "top-left", "color": "#3b82f6",
                "x": 40, "y": 40, "w": 400, "h": 240,
            })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(zone["rackId"], v_plateau.as_str());
    let label = o
        .ok(
            "POST",
            &format!("/api/racks/{v_plateau}/labels"),
            Some(json!({
                "text": "Plateau principal", "x": 60, "y": 20, "fontSize": 14,
                "color": "#111827", "fontWeight": "normal", "fontFamily": "Inter",
                "pill": false,
            })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(label["text"], "Plateau principal");
    // insertAdapterAtPort: on R1's camera, second port, right side.
    let adapter = o
        .ok(
            "POST",
            &format!("/api/racks/{r1}/adapters"),
            Some(json!({
                "adapterId": catalog_adapter, "x": 300, "y": 80,
                "attachedSlotId": cams[0], "attachedSide": "right", "attachedPortIndex": 1,
            })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(adapter["adapterId"], catalog_adapter.as_str());
    assert_eq!(adapter["label"], "#ADP1");
    let adapter = id_of(&adapter);
    // The external-port marker, on R1's monitor second port.
    let external = o
        .ok(
            "POST",
            &format!("/api/racks/{r1}/external-ports"),
            Some(json!({ "slotId": mons[0], "portIndex": 1, "labelX": 520, "labelY": 140 })),
            StatusCode::OK,
        )
        .await;
    assert_eq!(external["kind"], "INTER_LIEU");
    let r = o
        .req(
            "POST",
            &format!("/api/racks/{r1}/external-ports"),
            Some(json!({ "slotId": mons[0], "portIndex": 1, "labelX": 0, "labelY": 0 })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);

    // ── 3. Cabling ──────────────────────────────────────────────────────
    // Intra-rack (R1), then through the adapter (right side → monitor).
    let r1_conns = format!("/api/racks/{r1}/connections");
    let c_r1 = o
        .ok(
            "POST",
            &r1_conns,
            Some(cable(
                slot_end("from", &cams[0], 0),
                slot_end("to", &mons[0], 0),
            )),
            StatusCode::OK,
        )
        .await;
    assert_eq!(c_r1["rackId"], r1.as_str());
    let c_r1 = id_of(&c_r1);
    let c_adapter = o
        .ok(
            "POST",
            &r1_conns,
            Some(cable(
                adapter_end("from", &adapter, "right", 0),
                slot_end("to", &mons[0], 1),
            )),
            StatusCode::OK,
        )
        .await;
    assert_eq!(c_adapter["fromAdapterId"], adapter.as_str());
    let c_adapter = id_of(&c_adapter);
    // A batch (multi-cable between two nodes) in R2.
    let batch = o
        .ok(
            "POST",
            &format!("/api/racks/{r2}/connections"),
            Some(json!({ "connections": [
                cable(slot_end("from", &cams[1], 0), slot_end("to", &mons[1], 0)),
                cable(slot_end("from", &cams[1], 1), slot_end("to", &mons[1], 1)),
            ] })),
            StatusCode::OK,
        )
        .await;
    let r2_cables: Vec<String> = batch.as_array().unwrap().iter().map(id_of).collect();
    assert_eq!(r2_cables.len(), 2);
    // Between two free equipments: a cable of the virtual rack.
    let c_free = o
        .ok(
            "POST",
            &format!("/api/racks/{v_plateau}/connections"),
            Some(cable(
                slot_end("from", &free_cam, 0),
                slot_end("to", &free_mon, 0),
            )),
            StatusCode::OK,
        )
        .await;
    let c_free = id_of(&c_free);
    // A cable between two containers of the same location: the location
    // view routes it to the project route (`createInProject`), which
    // refuses it, as in arkyo (both sides copied unchanged).
    let r = o
        .req(
            "POST",
            &format!("{base}/synoptic/connections"),
            Some(json!({
                "from": { "rackId": r1, "slotId": cams[0], "connectorIndex": 0 },
                "to": { "rackId": r2, "slotId": mons[1], "connectorIndex": 0 },
                "color": "#3b82f6", "cableStyle": "ortho",
            })),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::BAD_REQUEST, json!({ "error": SAME_LOCATION }))
    );
    // Inter-location (general view, `doCreate`): R2 → R3.
    let pc = o
        .ok(
            "POST",
            &format!("{base}/synoptic/connections"),
            Some(json!({
                "from": { "rackId": r2, "slotId": cams[1], "connectorIndex": 1 },
                "to": { "rackId": r3, "slotId": mons[2], "connectorIndex": 0 },
                "color": "#3b82f6", "cableStyle": "ortho",
            })),
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(
        (pc["fromRackId"].clone(), pc["toRackId"].clone()),
        (json!(r2), json!(r3))
    );
    let pc = id_of(&pc);
    // A second one from R1 (deleted with its container at step 6).
    let pc_r1 = o
        .ok(
            "POST",
            &format!("{base}/synoptic/connections"),
            Some(json!({
                "from": { "rackId": r1, "slotId": cams[0], "connectorIndex": 1 },
                "to": { "rackId": r3, "slotId": mons[2], "connectorIndex": 1 },
                "color": "#3b82f6", "cableStyle": "ortho",
            })),
            StatusCode::CREATED,
        )
        .await;
    let pc_r1 = id_of(&pc_r1);
    // Cable models (cable properties panel): on an R1 cable and an R2 one.
    for (rack, id) in [(&r1, &c_r1), (&r2, &r2_cables[0])] {
        let r = o
            .ok(
                "PATCH",
                &format!("/api/racks/{rack}/connections/{id}"),
                Some(json!({ "catalogCableModelId": model })),
                StatusCode::OK,
            )
            .await;
        assert_eq!(r["catalogCableModelId"], model.as_str());
    }

    // ── 2bis. Bundle (« Créer un faisceau », on the pivot) ──────────────
    // The location view posts the selected ids to the pivot's route: only
    // the pivot's own cables join (arkyo: `updateMany where {rackId}`).
    let bundle = o
        .ok(
            "POST",
            &format!("/api/racks/{v_plateau}/bundles"),
            Some(json!({ "name": "Faisceau", "cableIds": [c_free, c_r1] })),
            StatusCode::OK,
        )
        .await;
    let bundle = id_of(&bundle);
    let members: Vec<String> =
        sqlx::query_scalar(r#"SELECT "id" FROM "RackConnection" WHERE "bundleId" = ?"#)
            .bind(&bundle)
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(members, vec![c_free.clone()]);

    let payload = o.ok("GET", &location_url, None, StatusCode::OK).await;
    let ids = |key: &str| -> BTreeSet<String> {
        payload[key].as_array().unwrap().iter().map(id_of).collect()
    };
    assert_eq!(
        ids("connections"),
        BTreeSet::from([
            c_r1.clone(),
            c_adapter.clone(),
            r2_cables[0].clone(),
            r2_cables[1].clone(),
            c_free.clone(),
        ])
    );
    // Both project cables leave « Plateau »: none is listed here.
    assert_eq!(ids("projectConnections"), BTreeSet::new());
    assert_eq!(ids("zones"), BTreeSet::from([id_of(&zone)]));
    assert_eq!(ids("labels"), BTreeSet::from([id_of(&label)]));
    assert_eq!(ids("adapters"), BTreeSet::from([adapter.clone()]));
    assert_eq!(ids("externalPorts"), BTreeSet::from([id_of(&external)]));
    let general = o.ok("GET", &general_url, None, StatusCode::OK).await;
    assert_eq!(
        labels(&general).into_keys().collect::<BTreeSet<_>>(),
        BTreeSet::from([pc.clone(), pc_r1.clone()])
    );

    // ── 4. Renumbering, twice, without any change ───────────────────────
    // Location view (`location-canvas.tsx` `renumber`): one pass per
    // container on its own cables, then the project pass with `{}`.
    let renumber_location = async |payload: &Value| {
        let rack_of: BTreeMap<String, String> = payload["connections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| (id_of(c), c["rackId"].as_str().unwrap().to_string()))
            .collect();
        for rack in payload["racks"].as_array().unwrap() {
            let rid = id_of(rack);
            let ordered: Vec<&String> = rack_of
                .iter()
                .filter(|(_, r)| **r == rid)
                .map(|(id, _)| id)
                .collect();
            if ordered.is_empty() {
                continue;
            }
            let side_map: serde_json::Map<String, Value> = ordered
                .iter()
                .enumerate()
                .map(|(i, id)| {
                    let side = if i % 2 == 0 { "left" } else { "right" };
                    (id.to_string(), json!(side))
                })
                .collect();
            o.ok(
                "POST",
                &format!("/api/racks/{rid}/renumber"),
                Some(json!({
                    "orderedIds": ordered, "sideMap": side_map, "onlyUnlabelled": true,
                })),
                StatusCode::OK,
            )
            .await;
        }
        o.ok(
            "POST",
            &format!("{base}/synoptic/connections/renumber"),
            Some(json!({})),
            StatusCode::OK,
        )
        .await;
    };
    renumber_location(&payload).await;
    let first = labels(&o.ok("GET", &location_url, None, StatusCode::OK).await);
    assert_eq!(first.len(), 5);
    assert!(first.values().all(Option::is_some), "{first:?}");
    // One counter per rack: labels are unique within a rack.
    for rack in [&r1, &r2, &v_plateau] {
        let n = count_by(
            pool,
            r#"SELECT COUNT(DISTINCT "label") - COUNT(*) FROM "RackConnection" WHERE "rackId" = ?"#,
            rack,
        )
        .await;
        assert_eq!(n, 0, "{rack}");
    }
    let general_first = labels(&o.ok("GET", &general_url, None, StatusCode::OK).await);
    assert!(
        general_first.values().all(Option::is_some),
        "{general_first:?}"
    );
    // One counter per `prefix:dirDigit` for the whole project, rack
    // segment of the `from` rack. arkyo's project pass does not read the
    // rack cables' labels: `pc` gets « R2-20001 », as R2's second cable
    // (parity, reported in the phase 4c follow-up).
    assert_eq!(
        (
            general_first[&pc].as_deref(),
            general_first[&pc_r1].as_deref()
        ),
        (Some("R2-20001"), Some("R1-20002"))
    );
    assert_eq!(
        (
            first[&c_r1].as_deref(),
            first[&c_adapter].as_deref(),
            first[&r2_cables[0]].as_deref(),
            first[&r2_cables[1]].as_deref(),
            first[&c_free].as_deref(),
        ),
        (
            Some("R1-10001"),
            Some("R1-20001"),
            Some("R2-10001"),
            Some("R2-20001"),
            Some("PLATE-10001")
        )
    );
    // Second run, location view then general view (`{}`): nothing moves.
    let payload = o.ok("GET", &location_url, None, StatusCode::OK).await;
    renumber_location(&payload).await;
    assert_eq!(
        labels(&o.ok("GET", &location_url, None, StatusCode::OK).await),
        first
    );
    o.ok(
        "POST",
        &format!("{base}/synoptic/connections/renumber"),
        Some(json!({})),
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        labels(&o.ok("GET", &general_url, None, StatusCode::OK).await),
        general_first
    );

    // ── 5. The audit holds the operations ───────────────────────────────
    let audit = o
        .ok(
            "GET",
            &format!("{base}/audit?limit=150"),
            None,
            StatusCode::OK,
        )
        .await;
    let actions: BTreeSet<(String, String)> = audit
        .as_array()
        .unwrap()
        .iter()
        .map(|a| {
            (
                a["action"].as_str().unwrap().to_string(),
                a["entityId"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    for (action, entity) in [
        ("rackConnection.create", &c_r1),
        ("rackConnection.create", &c_adapter),
        ("rackConnection.createMany", &r2),
        ("rackConnection.create", &c_free),
        ("create_project_connection", &pc),
        ("create_project_connection", &pc_r1),
        ("rackConnection.renumber", &r1),
        ("rackConnection.renumber", &r2),
        ("rackConnection.renumber", &v_plateau),
        ("project_connection.renumber", &pid),
    ] {
        assert!(
            actions.contains(&(action.to_string(), entity.clone())),
            "{action} {entity} absent de {actions:?}"
        );
    }
    // The cable-model assignments are `rackConnection.update` entries.
    assert!(actions.contains(&("rackConnection.update".to_string(), c_r1.clone())));
    // Newest first.
    let dates: Vec<&str> = audit
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["createdAt"].as_str().unwrap())
        .collect();
    assert!(dates.windows(2).all(|w| w[0] >= w[1]), "{dates:?}");
    let rack_audit = o
        .ok(
            "GET",
            &format!("/api/racks/{r1}/audit?limit=150"),
            None,
            StatusCode::OK,
        )
        .await;
    let rack_actions: BTreeSet<&str> = rack_audit
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["action"].as_str().unwrap())
        .collect();
    for action in [
        "rackConnection.create",
        "rackConnection.update",
        "rackConnection.renumber",
    ] {
        assert!(rack_actions.contains(action), "{action}: {rack_actions:?}");
    }

    // ── 6. Adapter, then container R1, deleted without any orphan ───────
    let r = o
        .ok(
            "DELETE",
            &format!("/api/racks/{r1}/adapters/{adapter}"),
            None,
            StatusCode::OK,
        )
        .await;
    assert_eq!(r, json!({ "ok": true }));
    // Its cable went with it; the other R1 cable stays.
    for (id, n) in [(&c_adapter, 0), (&c_r1, 1)] {
        assert_eq!(
            count_by(
                pool,
                r#"SELECT COUNT(*) FROM "RackConnection" WHERE "id" = ?"#,
                id
            )
            .await,
            n,
            "{id}"
        );
    }
    // Before R1 goes, the model is held by two cables.
    let r = o
        .req("DELETE", &format!("{CABLE_MODELS}/{model}"), None)
        .await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(r.body["count"], 2);

    let r = o
        .ok(
            "DELETE",
            &format!("{base}/racks/{r1}"),
            None,
            StatusCode::OK,
        )
        .await;
    assert_eq!(r, json!({ "ok": true }));
    for table in [
        "RackSlot",
        "RackConnection",
        "SynopticAdapter",
        "ExternalPort",
        "RackZone",
        "RackLabel",
        "CableBundle",
        "RigRack",
    ] {
        assert_eq!(
            count_by(
                pool,
                &format!(r#"SELECT COUNT(*) FROM "{table}" WHERE "rackId" = ?"#),
                &r1
            )
            .await,
            0,
            "{table}"
        );
    }
    for sql in [
        // No cable points at a gone slot, adapter, component or bundle.
        r#"SELECT COUNT(*) FROM "RackConnection" WHERE
             ("fromSlotId" IS NOT NULL AND "fromSlotId" NOT IN (SELECT "id" FROM "RackSlot"))
          OR ("toSlotId" IS NOT NULL AND "toSlotId" NOT IN (SELECT "id" FROM "RackSlot"))
          OR ("fromAdapterId" IS NOT NULL AND "fromAdapterId" NOT IN (SELECT "id" FROM "SynopticAdapter"))
          OR ("toAdapterId" IS NOT NULL AND "toAdapterId" NOT IN (SELECT "id" FROM "SynopticAdapter"))
          OR ("bundleId" IS NOT NULL AND "bundleId" NOT IN (SELECT "id" FROM "CableBundle"))"#,
        r#"SELECT COUNT(*) FROM "ProjectConnection" WHERE
             "fromRackId" NOT IN (SELECT "id" FROM "Rack")
          OR "toRackId" NOT IN (SELECT "id" FROM "Rack")
          OR ("fromSlotId" IS NOT NULL AND "fromSlotId" NOT IN (SELECT "id" FROM "RackSlot"))
          OR ("toSlotId" IS NOT NULL AND "toSlotId" NOT IN (SELECT "id" FROM "RackSlot"))"#,
        r#"SELECT COUNT(*) FROM "ExternalPort" WHERE "slotId" NOT IN (SELECT "id" FROM "RackSlot")"#,
        r#"SELECT COUNT(*) FROM "SynopticAdapter" WHERE
             "attachedSlotId" IS NOT NULL AND "attachedSlotId" NOT IN (SELECT "id" FROM "RackSlot")"#,
        r#"SELECT COUNT(*) FROM "RackSlotPanelRow" WHERE "slotId" NOT IN (SELECT "id" FROM "RackSlot")"#,
    ] {
        assert_eq!(count(pool, sql).await, 0, "{sql}");
    }
    let fk = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(fk.len(), 0, "foreign_key_check");
    // R1's project cable is gone, R2's stays; the decor of the pivot stays.
    let general = labels(&o.ok("GET", &general_url, None, StatusCode::OK).await);
    assert_eq!(general.into_keys().collect::<Vec<_>>(), vec![pc.clone()]);
    let payload = o.ok("GET", &location_url, None, StatusCode::OK).await;
    assert_eq!(
        labels(&payload).into_keys().collect::<BTreeSet<_>>(),
        BTreeSet::from([r2_cables[0].clone(), r2_cables[1].clone(), c_free.clone()])
    );
    assert_eq!(payload["zones"].as_array().unwrap().len(), 1);
    assert_eq!(payload["labels"].as_array().unwrap().len(), 1);
    assert_eq!(payload["adapters"], json!([]));
    assert_eq!(payload["externalPorts"], json!([]));
    assert_eq!(
        count_by(
            pool,
            r#"SELECT COUNT(*) FROM "RackConnection" WHERE "bundleId" = ?"#,
            &bundle
        )
        .await,
        1
    );

    // ── 7. The cable-model guard (409) ──────────────────────────────────
    let r = o
        .req("DELETE", &format!("{CABLE_MODELS}/{model}"), None)
        .await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(
        r.body,
        json!({
            "error": "Ce modèle de câble est utilisé par 1 connexion(s) et ne peut pas être supprimé.",
            "count": 1,
            "breakdown": { "rackConnections": 1, "projectConnections": 0 }
        })
    );
    assert_eq!(
        count_by(
            pool,
            r#"SELECT COUNT(*) FROM "TenantCableModel" WHERE "id" = ?"#,
            &model
        )
        .await,
        1
    );
    // Once the cable lets it go, the model can be deleted.
    o.ok(
        "PATCH",
        &format!("/api/racks/{r2}/connections/{}", r2_cables[0]),
        Some(json!({ "catalogCableModelId": null })),
        StatusCode::OK,
    )
    .await;
    o.ok(
        "DELETE",
        &format!("{CABLE_MODELS}/{model}"),
        None,
        StatusCode::OK,
    )
    .await;
}
