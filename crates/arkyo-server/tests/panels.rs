//! Phase 3, Task 5: panels (`/api/panels/**`).
mod common;

use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const PANELS: &str = "/api/panels";
const NOW: &str = "2026-11-06T10:00:00.000Z";
const DENSE: &str = "Panneau trop dense pour un module Neutrik D (max 16 par U).";
const NO_D: &str = "Ce connecteur n'existe pas en version Neutrik D.";

struct Ctx {
    e: Env,
    tok: String,
    owner: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    let o = add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    Ctx {
        e,
        tok,
        owner: o.id,
    }
}

impl Ctx {
    async fn req(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, path, LOCAL, Some(&self.tok), body).await
    }

    async fn panel(&self, body: Value) -> Value {
        let r = self.req("POST", PANELS, Some(body)).await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body
    }

    async fn slot(&self, panel: &str, body: Value) -> Value {
        let r = self
            .req("POST", &format!("{PANELS}/{panel}/slots"), Some(body))
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body
    }
}

async fn next_event(rx: &mut tokio::sync::broadcast::Receiver<String>) -> Value {
    serde_json::from_str(&rx.recv().await.unwrap()).unwrap()
}

/// A local connector type: `xlr3` exists in Neutrik D, `sdi` does not.
async fn connector(pool: &SqlitePool, id: &str, name: &str, icon: &str) {
    sqlx::query(
        r#"INSERT INTO "TenantConnectorType" ("id","name","versions","iconId","color","createdAt","updatedAt")
           VALUES (?, ?, '["M","F"]', ?, '#123456', ?, ?)"#,
    )
    .bind(id)
    .bind(name)
    .bind(icon)
    .bind(NOW)
    .bind(NOW)
    .execute(pool)
    .await
    .unwrap();
}

async fn slot_count(pool: &SqlitePool, panel: &str) -> i64 {
    sqlx::query_scalar(r#"SELECT COUNT(*) FROM "PanelSlot" WHERE "panelId" = ?"#)
        .bind(panel)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn ids(list: &Value) -> Vec<&str> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn create_panel_requires_name() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    for body in [json!({}), json!({"name": "   "}), json!({"name": 3})] {
        let r = c.req("POST", PANELS, Some(body)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST);
        assert_eq!(r.body, json!({"error": "Nom requis"}));
    }

    let p = c.panel(json!({"name": "  Patch 1 ", "junk": 1})).await;
    let id = p["id"].as_str().unwrap().to_string();
    assert_eq!(p["name"], "Patch 1");
    assert_eq!(p["panelType"], "PATCH");
    assert_eq!(p["accessoryType"], Value::Null);
    assert_eq!(p["plateType"], Value::Null);
    assert_eq!(p["heightU"], 1);
    assert_eq!(p["slotsPerU"], 8);
    assert_eq!(p["depthMm"], Value::Null);
    assert_eq!(p["rearCableDepthMm"], 80);
    assert_eq!(p["notes"], Value::Null);
    assert_eq!(p["private"], false);
    assert_eq!(p["createdById"], c.owner.as_str());
    assert_eq!(p["slots"], json!([]));
    assert!(p["createdAt"].as_str().unwrap().ends_with('Z'));
    assert!(p.get("junk").is_none());
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "panel", "action": "create", "id": id})
    );

    // Every field of the wizard, and `?? default` for null.
    let p = c
        .panel(
            json!({"name": "Plaque", "panelType": "ACCESSORY", "accessoryType": "BLANK",
                      "plateType": "D", "heightU": 2, "slotsPerU": 12, "depthMm": 40,
                      "rearCableDepthMm": null, "notes": "n", "private": true}),
        )
        .await;
    assert_eq!(p["panelType"], "ACCESSORY");
    assert_eq!(p["accessoryType"], "BLANK");
    assert_eq!(p["plateType"], "D");
    assert_eq!(p["heightU"], 2);
    assert_eq!(p["slotsPerU"], 12);
    assert_eq!(p["depthMm"], 40);
    assert_eq!(p["rearCableDepthMm"], 80);
    assert_eq!(p["notes"], "n");
    assert_eq!(p["private"], true);

    // `private: body.private === true`.
    let p = c.panel(json!({"name": "P", "private": "yes"})).await;
    assert_eq!(p["private"], false);

    // A value Prisma refuses is a 400, not a 500.
    let r = c
        .req("POST", PANELS, Some(json!({"name": "P", "heightU": "2"})))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body, json!({"error": "Corps de requête invalide"}));

    let r = c.req("GET", &format!("{PANELS}/{id}"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["name"], "Patch 1");
    let r = c.req("GET", &format!("{PANELS}/nope"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));
}

#[tokio::test]
async fn private_panels_hidden_unless_inventaire_scope() {
    let c = ctx().await;
    let public = c.panel(json!({"name": "Public"})).await;
    let private = c.panel(json!({"name": "Privé", "private": true})).await;
    let later = c.panel(json!({"name": "Public 2"})).await;
    let (pu, pr, la) = (
        public["id"].as_str().unwrap(),
        private["id"].as_str().unwrap(),
        later["id"].as_str().unwrap(),
    );

    let r = c.req("GET", PANELS, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(ids(&r.body), vec![la, pu]);
    let r = c
        .req("GET", &format!("{PANELS}?scope=inventaire"), None)
        .await;
    assert_eq!(ids(&r.body), vec![la, pr, pu]);
    let r = c.req("GET", &format!("{PANELS}?scope=autre"), None).await;
    assert_eq!(ids(&r.body), vec![la, pu]);

    // A private panel is still readable by id.
    let r = c.req("GET", &format!("{PANELS}/{pr}"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["private"], true);
}

#[tokio::test]
async fn resizing_panel_clears_slots() {
    let c = ctx().await;
    let p = c
        .panel(json!({"name": "Patch", "heightU": 1, "slotsPerU": 8}))
        .await;
    let id = p["id"].as_str().unwrap().to_string();
    let path = format!("{PANELS}/{id}");
    c.slot(&id, json!({"position": 2})).await;
    c.slot(&id, json!({"position": 1})).await;
    let mut rx = c.e.events.subscribe();

    // Name only, or the same dimensions: the slots stay.
    let r = c
        .req(
            "PATCH",
            &path,
            Some(json!({"name": "Patch B", "heightU": 1, "slotsPerU": 8,
                        "rearCableDepthMm": 100, "notes": "x", "panelType": "ACCESSORY"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["name"], "Patch B");
    assert_eq!(r.body["rearCableDepthMm"], 100);
    assert_eq!(r.body["notes"], "x");
    // Not among arkyo's PATCH fields.
    assert_eq!(r.body["panelType"], "PATCH");
    assert_ne!(r.body["updatedAt"], p["updatedAt"]);
    let slots = r.body["slots"].as_array().unwrap();
    assert_eq!(
        slots
            .iter()
            .map(|s| s["position"].clone())
            .collect::<Vec<_>>(),
        vec![json!(1), json!(2)]
    );
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "panel", "action": "update", "id": id})
    );

    let r = c.req("PATCH", &path, Some(json!({"notes": null}))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["notes"], Value::Null);
    assert_eq!(slot_count(&c.e.pool, &id).await, 2);

    let r = c.req("PATCH", &path, Some(json!({"slotsPerU": 12}))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["slotsPerU"], 12);
    assert_eq!(r.body["slots"], json!([]));
    assert_eq!(slot_count(&c.e.pool, &id).await, 0);

    c.slot(&id, json!({"position": 1})).await;
    let r = c.req("PATCH", &path, Some(json!({"heightU": 2}))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["heightU"], 2);
    assert_eq!(slot_count(&c.e.pool, &id).await, 0);

    // A value Prisma refuses: 400, nothing cleared.
    c.slot(&id, json!({"position": 1})).await;
    for body in [
        json!({"heightU": "3"}),
        json!({"name": null}),
        json!({"slotsPerU": 1.5}),
    ] {
        let r = c.req("PATCH", &path, Some(body)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST);
        assert_eq!(r.body, json!({"error": "Corps de requête invalide"}));
    }
    assert_eq!(slot_count(&c.e.pool, &id).await, 1);

    let r = c
        .req(
            "PATCH",
            &format!("{PANELS}/nope"),
            Some(json!({"name": "X"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));

    // DELETE: the panel and its slots.
    let r = c.req("DELETE", &path, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(slot_count(&c.e.pool, &id).await, 0);
    let mut last = next_event(&mut rx).await;
    while last["entity"] != "panel" || last["action"] != "delete" {
        last = next_event(&mut rx).await;
    }
    assert_eq!(
        last,
        json!({"type": "update", "entity": "panel", "action": "delete", "id": id})
    );
    let r = c.req("DELETE", &path, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

/// arkyo-server: écart assumé (4a M-1), comme la garde de l'adaptateur. arkyo
/// supprimait un panel posé dans un contenant : son slot restait dessiné
/// « — » dans l'élévation, ineffaçable (son DELETE le rend fantôme), et la
/// ligne d'inventaire sans référence n'apparaissait plus nulle part.
#[tokio::test]
async fn delete_panel_in_use_refused() {
    let c = ctx().await;
    let p = &c.e.pool;
    let id = c
        .panel(json!({"name": "Patch 24", "panelType": "PATCH", "heightU": 1}))
        .await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let path = format!("{PANELS}/{id}");
    for sql in [
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('r1','Baie 1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('r2','Baie 2',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","panelId","quantity","createdAt","updatedAt") VALUES ('i1','r1',?,1,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","inventoryItemId","startU","createdAt","updatedAt") VALUES ('s1','r1',?,'i1',3,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","startU","createdAt","updatedAt") VALUES ('s2','r2',?,4,?,?)"#,
    ] {
        let mut q = sqlx::query(sql);
        if sql.contains("panelId") {
            q = q.bind(&id);
        }
        q.bind(NOW).bind(NOW).execute(p).await.unwrap();
    }
    let used =
        json!({"error": "Utilisé dans 2 contenant(s) — suppression impossible", "usageCount": 2});

    // Inventory line and placed slots in two containers: 409, nothing deleted.
    let r = c.req("DELETE", &path, None).await;
    assert_eq!((r.status, r.body), (StatusCode::CONFLICT, used));
    let panels: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Panel" WHERE "id" = ?"#)
        .bind(&id)
        .fetch_one(p)
        .await
        .unwrap();
    assert_eq!(panels, 1);
    // A slot alone (no inventory line) is a use too.
    sqlx::query(r#"DELETE FROM "RackSlot" WHERE "id" = 's1'"#)
        .execute(p)
        .await
        .unwrap();
    sqlx::query(r#"DELETE FROM "RackInventoryItem""#)
        .execute(p)
        .await
        .unwrap();
    let r = c.req("DELETE", &path, None).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({"error": "Utilisé dans 1 contenant(s) — suppression impossible", "usageCount": 1})
        )
    );
    // No longer used: deleted.
    sqlx::query(r#"DELETE FROM "RackSlot""#)
        .execute(p)
        .await
        .unwrap();
    let r = c.req("DELETE", &path, None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
}

#[tokio::test]
async fn neutrik_d_rules() {
    let c = ctx().await;
    connector(&c.e.pool, "ct-xlr", "XLR 3 test", "xlr3").await;
    connector(&c.e.pool, "ct-sdi", "SDI test", "sdi").await;
    let p = c.panel(json!({"name": "Patch", "slotsPerU": 16})).await;
    let id = p["id"].as_str().unwrap().to_string();
    let slots = format!("{PANELS}/{id}/slots");

    // POST: connector without a D version, or no connector at all.
    for body in [
        json!({"position": 1, "connectorTypeId": "ct-sdi", "mountD": true}),
        json!({"position": 1, "mountD": true}),
        json!({"position": 1, "connectorTypeId": "inconnu", "mountD": true}),
    ] {
        let r = c.req("POST", &slots, Some(body)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST);
        assert_eq!(r.body, json!({"error": NO_D}));
    }
    let s = c
        .slot(
            &id,
            json!({"position": 1, "connectorTypeId": "ct-xlr", "mountD": true}),
        )
        .await;
    assert_eq!(s["mountD"], true);
    // mountD false needs no check.
    c.slot(
        &id,
        json!({"position": 2, "connectorTypeId": "ct-sdi", "mountD": false}),
    )
    .await;

    // More than 16 per U.
    let dense = c.panel(json!({"name": "Dense", "slotsPerU": 24})).await;
    let dense_id = dense["id"].as_str().unwrap();
    let r = c
        .req(
            "POST",
            &format!("{PANELS}/{dense_id}/slots"),
            Some(json!({"position": 1, "connectorTypeId": "ct-xlr", "mountD": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body, json!({"error": DENSE}));
    // arkyo: a missing panel fails the same guard.
    let r = c
        .req(
            "POST",
            &format!("{PANELS}/nope/slots"),
            Some(json!({"position": 1, "connectorTypeId": "ct-xlr", "mountD": true})),
        )
        .await;
    assert_eq!(r.body, json!({"error": DENSE}));
    let s_dense = c.slot(dense_id, json!({"position": 1})).await;
    let r = c
        .req(
            "PATCH",
            &format!(
                "{PANELS}/{dense_id}/slots/{}",
                s_dense["id"].as_str().unwrap()
            ),
            Some(json!({"connectorTypeId": "ct-xlr", "mountD": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body, json!({"error": DENSE}));

    // PATCH: an explicit mountD is refused; a connector change alone on a
    // D slot resets mountD silently.
    let sid = s["id"].as_str().unwrap();
    let spath = format!("{slots}/{sid}");
    let r = c
        .req(
            "PATCH",
            &spath,
            Some(json!({"connectorTypeId": "ct-sdi", "mountD": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body, json!({"error": NO_D}));
    let r = c
        .req("PATCH", &spath, Some(json!({"connectorTypeId": "ct-sdi"})))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["mountD"], false);
    assert_eq!(r.body["connectorTypeId"], "ct-sdi");
    assert_eq!(r.body["connectorType"]["hasNeutrikD"], false);
    // A label-only PATCH never re-checks.
    sqlx::query(r#"UPDATE "PanelSlot" SET "mountD" = 1 WHERE "id" = ?"#)
        .bind(sid)
        .execute(&c.e.pool)
        .await
        .unwrap();
    let r = c.req("PATCH", &spath, Some(json!({"label": "L"}))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["mountD"], true);
    // Back to a D connector with mountD.
    let r = c
        .req(
            "PATCH",
            &spath,
            Some(json!({"connectorTypeId": "ct-xlr", "mountD": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["mountD"], true);
    assert_eq!(r.body["connectorType"]["hasNeutrikD"], true);
}

#[tokio::test]
async fn slot_crud_and_enrichment() {
    let c = ctx().await;
    connector(&c.e.pool, "ct-xlr", "XLR 3 test", "xlr3").await;
    let p = c.panel(json!({"name": "Patch"})).await;
    let id = p["id"].as_str().unwrap().to_string();
    let slots = format!("{PANELS}/{id}/slots");
    let mut rx = c.e.events.subscribe();

    let s = c
        .slot(
            &id,
            json!({"position": 3, "connectorTypeId": "ct-xlr", "label": "In 3",
                   "familyLabel": "Audio", "junk": 1}),
        )
        .await;
    let sid = s["id"].as_str().unwrap().to_string();
    assert_eq!(
        s.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec![
            "catalogConnectorTypeId",
            "connectorType",
            "connectorTypeId",
            "familyLabel",
            "id",
            "label",
            "mountD",
            "notes",
            "panelId",
            "position",
            "sizeSlots"
        ]
    );
    assert_eq!(s["panelId"], id.as_str());
    assert_eq!(s["position"], 3);
    assert_eq!(s["sizeSlots"], 1);
    assert_eq!(s["label"], "In 3");
    assert_eq!(s["notes"], Value::Null);
    assert_eq!(s["mountD"], false);
    assert_eq!(s["familyLabel"], "Audio");
    assert_eq!(s["catalogConnectorTypeId"], "ct-xlr");
    assert_eq!(s["connectorTypeId"], "ct-xlr");
    assert_eq!(
        s["connectorType"],
        json!({"id": "ct-xlr", "name": "XLR 3 test", "versions": ["M", "F"], "iconId": "xlr3",
               "color": "#123456", "category": null, "hasNeutrikD": true, "dTypeSvgUrl": null})
    );
    // `panel_slot create` carries the panel id, as arkyo.
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "panel_slot", "action": "create", "id": id})
    );

    let s2 = c
        .slot(&id, json!({"position": 1, "connectorTypeId": "gone"}))
        .await;
    assert_eq!(s2["connectorTypeId"], "gone");
    assert_eq!(s2["connectorType"], Value::Null);
    let _ = next_event(&mut rx).await;

    // Validation: Zod flatten().
    let r = c
        .req(
            "POST",
            &slots,
            Some(json!({"position": 0, "mountD": "oui"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body["error"]["formErrors"], json!([]));
    let fe = r.body["error"]["fieldErrors"].as_object().unwrap();
    assert_eq!(fe.keys().collect::<Vec<_>>(), vec!["mountD", "position"]);
    let r = c.req("POST", &slots, Some(json!({}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.body["error"]["fieldErrors"]["position"].is_array());
    // Unknown panel (FK): 404.
    let r = c
        .req(
            "POST",
            &format!("{PANELS}/nope/slots"),
            Some(json!({"position": 1})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);

    // GET: slots by position, enriched.
    let r = c.req("GET", &format!("{PANELS}/{id}"), None).await;
    let got = r.body["slots"].as_array().unwrap();
    assert_eq!(got.len(), 2);
    assert_eq!(got[0]["position"], 1);
    assert_eq!(got[1]["connectorType"]["name"], "XLR 3 test");
    let r = c.req("GET", PANELS, None).await;
    assert_eq!(r.body[0]["slots"].as_array().unwrap().len(), 2);
    assert!(r.body[0]["slots"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["connectorType"]["hasNeutrikD"] == true));

    // PATCH.
    let spath = format!("{slots}/{sid}");
    let r = c
        .req(
            "PATCH",
            &spath,
            Some(
                json!({"label": null, "notes": "n", "position": 4, "sizeSlots": 2,
                        "familyLabel": null, "connectorTypeId": null}),
            ),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["label"], Value::Null);
    assert_eq!(r.body["notes"], "n");
    assert_eq!(r.body["position"], 4);
    assert_eq!(r.body["sizeSlots"], 2);
    assert_eq!(r.body["familyLabel"], Value::Null);
    assert_eq!(r.body["connectorTypeId"], Value::Null);
    assert_eq!(r.body["connectorType"], Value::Null);
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "panel_slot", "action": "update", "id": sid})
    );
    let r = c.req("PATCH", &spath, Some(json!({"position": "4"}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.body["error"]["fieldErrors"]["position"].is_array());
    let r = c
        .req(
            "PATCH",
            &format!("{slots}/inconnu"),
            Some(json!({"label": "x"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Slot introuvable"}));

    // DELETE one slot.
    let r = c.req("DELETE", &spath, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "panel_slot", "action": "delete", "id": sid})
    );
    assert_eq!(slot_count(&c.e.pool, &id).await, 1);
    let r = c.req("DELETE", &spath, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Slot introuvable"}));

    // DELETE /slots: the panel is emptied.
    c.slot(&id, json!({"position": 2})).await;
    let _ = next_event(&mut rx).await;
    let r = c.req("DELETE", &slots, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(slot_count(&c.e.pool, &id).await, 0);
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "panel", "action": "update", "id": id})
    );
    let r = c.req("GET", &format!("{PANELS}/{id}"), None).await;
    assert_eq!(r.body["slots"], json!([]));
}

#[tokio::test]
async fn panel_routes_require_session_and_design_rights() {
    let c = ctx().await;
    let p = c.panel(json!({"name": "Patch"})).await;
    let id = p["id"].as_str().unwrap().to_string();
    let s = c.slot(&id, json!({"position": 1})).await;
    let sid = s["id"].as_str().unwrap().to_string();

    // Decision 6: arkyo's GETs needed no session.
    for path in [PANELS.to_string(), format!("{PANELS}/{id}")] {
        let r = call(&c.e.app, "GET", &path, LOCAL, None, None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{path}");
    }

    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ro = login(&c.e.app, "c@b.fr").await;
    let writes = [
        ("POST", PANELS.to_string(), Some(json!({"name": "X"}))),
        (
            "PATCH",
            format!("{PANELS}/{id}"),
            Some(json!({"name": "X"})),
        ),
        ("DELETE", format!("{PANELS}/{id}"), None),
        (
            "POST",
            format!("{PANELS}/{id}/slots"),
            Some(json!({"position": 2})),
        ),
        ("DELETE", format!("{PANELS}/{id}/slots"), None),
        (
            "PATCH",
            format!("{PANELS}/{id}/slots/{sid}"),
            Some(json!({"label": "X"})),
        ),
        ("DELETE", format!("{PANELS}/{id}/slots/{sid}"), None),
    ];
    for (m, path, body) in &writes {
        let r = call(&c.e.app, m, path, LOCAL, Some(&ro), body.clone()).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{m} {path}");
        assert_eq!(r.body, json!({"error": "Accès refusé"}));
        let r = call(&c.e.app, m, path, LOCAL, None, body.clone()).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{m} {path}");
    }
    for path in [
        PANELS.to_string(),
        format!("{PANELS}?scope=inventaire"),
        format!("{PANELS}/{id}"),
    ] {
        let r = call(&c.e.app, "GET", &path, LOCAL, Some(&ro), None).await;
        assert_eq!(r.status, StatusCode::OK, "{path}");
    }
    assert_eq!(slot_count(&c.e.pool, &id).await, 1);

    // design:write writes, but does not delete a panel (design:admin).
    add_user(&c.e.pool, "t@b.fr", "technicien", false).await;
    let tech = login(&c.e.app, "t@b.fr").await;
    let r = call(
        &c.e.app,
        "PATCH",
        &format!("{PANELS}/{id}"),
        LOCAL,
        Some(&tech),
        Some(json!({"name": "B"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let r = call(
        &c.e.app,
        "DELETE",
        &format!("{PANELS}/{id}/slots/{sid}"),
        LOCAL,
        Some(&tech),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let r = call(
        &c.e.app,
        "DELETE",
        &format!("{PANELS}/{id}"),
        LOCAL,
        Some(&tech),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
}
