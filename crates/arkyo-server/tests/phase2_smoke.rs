//! End-to-end path of phase 2 (Task 13), over HTTP on a fresh database:
//! owner setup, brand, equipment with two ports, duplicate, cable, backup
//! export, purge of every referential, restore, then the catalogue must be
//! identical. Request bodies are the ones the front sends
//! (`web/src/app/(app)/admin/**`, `web/src/app/auth/setup-page.tsx`).
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};

const EQUIPMENT: &str = "/api/tenant/catalogue/equipment";
const CABLES: &str = "/api/tenant/catalogue/cables";
const ADAPTERS: &str = "/api/tenant/catalogue/adapters";
const BRANDS: &str = "/api/tenant/parametres/brands";
/// Every section, like the default selection of `backup-card.tsx`.
const BACKUP: &str = "/api/tenant/parametres/backup?sections=equipment,cables,adapters,settings";

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

    /// Everything the catalogue screens read (the lists, active items or
    /// not, and the detail of each item we created) plus the full backup
    /// export, which covers every table the purge empties and the restore
    /// rewrites (adapters and every settings referential included).
    async fn snapshot(&self, ids: &Ids) -> Value {
        let ok = StatusCode::OK;
        let mut eq = self.ok("GET", EQUIPMENT, None, ok).await;
        let mut eq_off = self
            .ok("GET", &format!("{EQUIPMENT}?isActive=false"), None, ok)
            .await;
        let mut cables = self.ok("GET", CABLES, None, ok).await;
        let mut adapters = self.ok("GET", ADAPTERS, None, ok).await;
        let mut brands = self.ok("GET", BRANDS, None, ok).await;
        for list in [
            &mut eq,
            &mut eq_off,
            &mut cables,
            &mut adapters,
            &mut brands,
        ] {
            for key in ["arkyo", "personal"] {
                sort_by_id(&mut list[key]);
            }
        }
        let mut details = serde_json::Map::new();
        for id in [&ids.equipment, &ids.copy] {
            let d = self.ok("GET", &format!("{EQUIPMENT}/{id}"), None, ok).await;
            details.insert(format!("equipment/{id}"), d);
        }
        let d = self
            .ok("GET", &format!("{CABLES}/{}", ids.cable), None, ok)
            .await;
        details.insert(format!("cables/{}", ids.cable), d);
        let d = self
            .ok("GET", &format!("{ADAPTERS}/{}", ids.adapter), None, ok)
            .await;
        details.insert(format!("adapters/{}", ids.adapter), d);
        let mut backup = self.ok("GET", BACKUP, None, ok).await;
        // The export time is the only field that changes between two exports
        // of the same catalogue.
        backup["meta"].as_object_mut().unwrap().remove("exportedAt");
        // AppConfig rows are upserted by key with their value only, so the
        // restore stamps `updatedAt` with the restore time (arkyo
        // `restoreAppConfig`: `upsert({ update: { value } })` and Prisma's
        // `@updatedAt`). Key, value and id are still compared.
        for row in backup["data"]["settings"]["appConfig"]
            .as_array_mut()
            .unwrap()
        {
            row.as_object_mut().unwrap().remove("updatedAt");
        }
        json!({
            "equipment": eq,
            "equipmentInactive": eq_off,
            "cables": cables,
            "adapters": adapters,
            "brands": brands,
            "details": details,
            "backup": backup,
        })
    }
}

struct Ids {
    equipment: String,
    copy: String,
    cable: String,
    adapter: String,
}

/// JSON paths where `a` and `b` differ (readable failure message).
fn diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let keys: std::collections::BTreeSet<&String> = x.keys().chain(y.keys()).collect();
            for k in keys {
                let (va, vb) = (
                    x.get(k).unwrap_or(&Value::Null),
                    y.get(k).unwrap_or(&Value::Null),
                );
                if x.contains_key(k) != y.contains_key(k) {
                    out.push(format!(
                        "{path}.{k}: present {} / {}",
                        x.contains_key(k),
                        y.contains_key(k)
                    ));
                } else {
                    diff(&format!("{path}.{k}"), va, vb, out);
                }
            }
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            for (i, (va, vb)) in x.iter().zip(y).enumerate() {
                let id = va["id"].as_str().map_or(i.to_string(), str::to_string);
                diff(&format!("{path}[{id}]"), va, vb, out);
            }
        }
        _ if a != b => out.push(format!("{path}: {a} != {b}")),
        _ => {}
    }
}

fn sort_by_id(v: &mut Value) {
    if let Some(a) = v.as_array_mut() {
        a.sort_by(|x, y| x["id"].as_str().cmp(&y["id"].as_str()));
    }
}

/// First two connector types of the catalogue (`GET /connectors`, what the
/// equipment editor loads).
async fn two_connectors(o: &Owner<'_>) -> (String, String) {
    let list = o
        .ok(
            "GET",
            "/api/tenant/catalogue/connectors",
            None,
            StatusCode::OK,
        )
        .await;
    let ids: Vec<String> = list
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["id"].as_str().map(str::to_string))
        .collect();
    assert!(ids.len() >= 2, "{list:?}");
    (ids[0].clone(), ids[1].clone())
}

/// Equipment editor payload (`buildSavePayload`, tenant mode: classification
/// shown, distribution hidden).
fn equipment_body(brand: &str, left: &str, right: &str) -> Value {
    json!({
        "name": "Mélangeur Vidéo",
        "reference": "MV-200",
        "category": null,
        "brandId": brand,
        "isRackable": true,
        "heightU": 2,
        "depthMm": 450,
        "rearCableDepthMm": null,
        "widthFraction": "FULL",
        "dimLmm": null,
        "dimWmm": null,
        "dimHmm": null,
        "weight": 7.5,
        "powerW": 120,
        "heatBtuH": 409.5,
        "connectors": [
            {
                "id": "port-in-1", "face": "REAR", "connectorTypeId": left,
                "version": "75Ω", "signalName": "SDI", "quantity": 4,
                "label": "SDI IN", "direction": "IN", "gender": "FEMALE"
            },
            {
                "id": "port-out-1", "face": "FRONT", "connectorTypeId": right,
                "signalName": "", "quantity": 1, "label": "Réseau",
                "direction": "BOTH", "gender": "FEMALE", "networkRole": "endpoint"
            }
        ],
        "signalCapacities": [{ "signalName": "SDI", "in": 4, "out": 0 }],
        "is2110": false,
        "ip2110Mode": null,
        "imageUrl": null,
        "iconUrl": null,
        "rackSymbolUrl": null,
        "rackSymbolRearUrl": null,
        "rackPhotoFrontUrl": null,
        "rackPhotoRearUrl": null,
        "notes": "Deux ports",
        "documents": [],
        "tags": null,
        "isActive": true,
        "isLightingFixture": false,
        "dmxChannelsDefault": null,
        "dmxModes": [],
        "isComponentHost": false,
        "hostSlotCount": null,
        "isComponent": false,
        "componentSlotSpan": 1,
        "typeId": null,
        "functionIds": []
    })
}

/// Cable editor payload (`buildPayload` of `cable-editor.tsx`).
fn cable_body(brand: &str, left: &str, right: &str) -> Value {
    json!({
        "name": "Cordon Test",
        "reference": "CT-1",
        "leftConnectorId": left,
        "leftGender": "MALE",
        "rightConnectorId": right,
        "rightGender": "FEMALE",
        "functionId": null,
        "brandId": brand,
        "model": "Modèle X",
        "useCases": [],
        "availableLengths": [0.5, 1, 2],
        "customMinLength": null,
        "customMaxLength": null,
        "notes": "cordon de test",
        "imageUrl": null
    })
}

#[tokio::test]
async fn phase2_backup_purge_restore_keeps_catalogue() {
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

    // 2. Brand (brand-form-dialog.tsx).
    let brand = o
        .ok(
            "POST",
            BRANDS,
            Some(json!({ "name": "Marque Phase 2", "website": "https://exemple.fr", "logoUrl": null })),
            StatusCode::CREATED,
        )
        .await;
    let brand = brand["id"].as_str().unwrap().to_string();

    // 3. Equipment with two ports.
    let (left, right) = two_connectors(&o).await;
    let created = o
        .ok(
            "POST",
            EQUIPMENT,
            Some(equipment_body(&brand, &left, &right)),
            StatusCode::CREATED,
        )
        .await;
    let equipment = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["connectors"].as_array().unwrap().len(), 2);

    // 4. Duplicate (equipment-list-panel.tsx sends `{}`).
    let copy = o
        .ok(
            "POST",
            &format!("{EQUIPMENT}/{equipment}/duplicate"),
            Some(json!({})),
            StatusCode::CREATED,
        )
        .await;
    let copy_id = copy["id"].as_str().unwrap().to_string();
    assert_ne!(copy_id, equipment);
    assert_eq!(copy["connectors"], created["connectors"]);

    // 5. Cable.
    let cable = o
        .ok(
            "POST",
            CABLES,
            Some(cable_body(&brand, &left, &right)),
            StatusCode::CREATED,
        )
        .await;
    // 5b. Adapter (`buildPayload` of `adapter-editor.tsx`).
    let adapter = o
        .ok(
            "POST",
            ADAPTERS,
            Some(json!({
                "name": "Adaptateur Test",
                "reference": "AD-1",
                "functionId": null,
                "inputs": [{ "connectorTypeId": left, "gender": "MALE", "quantity": 1, "label": "Entrée" }],
                "outputs": [{ "connectorTypeId": right, "gender": "FEMALE", "quantity": 2, "label": "Sorties" }],
                "notes": null,
                "imageUrl": null
            })),
            StatusCode::CREATED,
        )
        .await;
    // 5c. Settings that a purge keeps but a restore rewrites, so the export
    // comparison covers them too: numbering (`numbering-tab.tsx`) and a PDF
    // export model (`export-model-form-dialog.tsx`).
    for update in [json!({ "cable_pad": "3" }), json!({ "cable_sep1": "." })] {
        o.ok("PATCH", "/api/admin/config", Some(update), StatusCode::OK)
            .await;
    }
    o.ok(
        "POST",
        "/api/tenant/parametres/print/export-models",
        Some(json!({ "key": "DOSSIER", "name": "Dossier", "description": null })),
        StatusCode::CREATED,
    )
    .await;

    let ids = Ids {
        equipment,
        copy: copy_id,
        cable: cable["id"].as_str().unwrap().to_string(),
        adapter: adapter["id"].as_str().unwrap().to_string(),
    };

    let before = o.snapshot(&ids).await;
    assert_eq!(before["equipment"]["personal"].as_array().unwrap().len(), 2);
    let ports = &before["details"][format!("equipment/{}", ids.equipment)]["item"]["connectors"];
    assert_eq!(ports.as_array().unwrap().len(), 2, "{ports:?}");
    assert!(before["brands"]["personal"]
        .as_array()
        .unwrap()
        .iter()
        .any(|b| b["id"] == brand.as_str()));
    assert!(before["adapters"]["personal"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["id"] == ids.adapter.as_str()));
    // The export compared below is not vacuous: our rows and every settings
    // referential are in it.
    let data = &before["backup"]["data"];
    for (section, n) in [("equipment", 2), ("cables", 1), ("adapters", 1)] {
        assert!(data[section].as_array().unwrap().len() >= n, "{section}");
    }
    let settings = data["settings"].as_object().unwrap();
    let empty: Vec<&String> = settings
        .iter()
        .filter(|(_, v)| v.as_array().unwrap().is_empty())
        .map(|(k, _)| k)
        .collect();
    // exportTemplates has no screen before phase 6: it stays empty.
    assert_eq!(empty, ["exportTemplates"], "{:?}", settings.keys());

    // 6. Backup, every section (backup-card.tsx default selection).
    let backup = o.ok("GET", BACKUP, None, StatusCode::OK).await;
    assert_eq!(backup["meta"]["format"], "arkyo-backup");

    // 7-9 twice: the front's default mode (merge), then « Remplacer ».
    for mode in ["merge", "replace"] {
        // 7. Purge every referential (espace, « Tout vider »).
        let r = o
            .ok(
                "POST",
                "/api/admin/purge",
                Some(json!({ "target": "all" })),
                StatusCode::OK,
            )
            .await;
        assert_eq!(r, json!({ "ok": true }));
        let purged = o.ok("GET", EQUIPMENT, None, StatusCode::OK).await;
        assert_eq!(purged["personal"], json!([]));
        let r = o.req("GET", &format!("{CABLES}/{}", ids.cable), None).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{:?}", r.body);
        let r = o
            .req("GET", &format!("{EQUIPMENT}/{}", ids.equipment), None)
            .await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{:?}", r.body);
        let r = o
            .req("GET", &format!("{ADAPTERS}/{}", ids.adapter), None)
            .await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{:?}", r.body);
        let brands = o.ok("GET", BRANDS, None, StatusCode::OK).await;
        assert!(
            !brands["personal"]
                .as_array()
                .unwrap()
                .iter()
                .any(|b| b["id"] == brand.as_str()),
            "the purge kept the brand"
        );

        // 8. Restore every section (restore-verify.tsx sends `{modes, backup}`).
        let modes = json!({ "equipment": mode, "cables": mode,
                            "adapters": mode, "settings": mode });
        let r = o
            .ok(
                "POST",
                "/api/tenant/parametres/backup/restore",
                Some(json!({ "modes": modes, "backup": backup })),
                StatusCode::OK,
            )
            .await;
        assert_eq!(r["report"]["equipment"]["created"], 2, "{mode}: {r:?}");

        // 9. Same catalogue: equipment (with ports), cables and brand, in
        // the lists and in the details. No field is excluded: ids, authors
        // and dates all come back from the file.
        let after = o.snapshot(&ids).await;
        let mut diffs = Vec::new();
        diff("", &before, &after, &mut diffs);
        assert!(
            diffs.is_empty(),
            "{mode}: catalogue differs after restore:\n{}",
            diffs.join("\n")
        );
    }
}
