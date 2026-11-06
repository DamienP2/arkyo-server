//! Phase 3, Task 4: containers and rigs (`/api/racks/**`, `/api/rigs/**`).
mod common;
use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

const RACKS: &str = "/api/racks";
const RIGS: &str = "/api/rigs";
const NOW: &str = "2026-11-06T10:00:00.000Z";
const TEMPLATE_MSG: &str = "Un objet lié à un projet ne peut pas devenir un template. Utilisez « Sauver comme template » pour cloner.";

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

    /// [`Ctx::req`] with the `x-client-id` header of the browser tab.
    async fn req_client(
        &self,
        method: &str,
        path: &str,
        client: &str,
        body: Option<Value>,
    ) -> Reply {
        let b = Request::builder()
            .method(method)
            .uri(path)
            .header(header::COOKIE, format!("arkyo_session={}", self.tok))
            .header("x-client-id", client);
        let req = match body {
            Some(v) => b
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(v.to_string())),
            None => b.body(Body::empty()),
        };
        let mut req = req.unwrap();
        req.extensions_mut()
            .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
        let res = self.e.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        Reply {
            status,
            cookie: None,
            body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        }
    }

    async fn rack(&self, body: Value) -> Value {
        let r = self.req("POST", RACKS, Some(body)).await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body
    }

    async fn rig(&self, body: Value) -> Value {
        let r = self.req("POST", RIGS, Some(body)).await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body
    }

    async fn link(&self, rig: &str, rack: &str) -> Reply {
        self.req(
            "POST",
            &format!("{RIGS}/{rig}/racks"),
            Some(json!({ "rackId": rack })),
        )
        .await
    }

    /// A project with one location: returns (projectId, its rig, the
    /// location's virtual rack).
    async fn project_with_location(&self, name: &str) -> (String, String, String) {
        let r = self
            .req(
                "POST",
                "/api/tenant/projects",
                Some(json!({"name": name, "interventionType": "PRESTATION"})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        let pid = r.body["id"].as_str().unwrap().to_string();
        let r = self
            .req(
                "POST",
                &format!("/api/tenant/projects/{pid}/locations"),
                Some(json!({"name": "Plateau"})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        let vr = r.body["virtualRackId"].as_str().unwrap().to_string();
        let rig: String =
            sqlx::query_scalar(r#"SELECT "id" FROM "RigConfig" WHERE "projectId" = ?"#)
                .bind(&pid)
                .fetch_one(&self.e.pool)
                .await
                .unwrap();
        (pid, rig, vr)
    }
}

async fn next_event(rx: &mut tokio::sync::broadcast::Receiver<String>) -> Value {
    serde_json::from_str(&rx.recv().await.unwrap()).unwrap()
}

async fn exec(pool: &SqlitePool, sql: &str) {
    let q = sqlx::query(sql);
    let n = sql.matches('?').count();
    let mut q = q;
    for _ in 0..n {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

fn ids(list: &Value) -> Vec<&str> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect()
}

async fn audit_count(pool: &SqlitePool, action: &str, entity: &str) -> i64 {
    sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "AuditLog" WHERE "action" = ? AND "entityType" = 'Rack' AND "entityId" = ?"#,
    )
    .bind(action)
    .bind(entity)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn create_rack_allocates_cable_id() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();

    let first = c.rack(json!({"name": "Baie A", "x": 1})).await;
    let id = first["id"].as_str().unwrap();
    assert_eq!(id.len(), 25);
    assert_eq!(first["name"], "Baie A");
    assert_eq!(first["cableId"], 1);
    assert_eq!(first["totalU"], 42);
    assert_eq!(first["depthMm"], 600);
    assert_eq!(first["rackType"], "STANDARD");
    assert_eq!(first["isRackable"], true);
    assert_eq!(first["hasWheels"], false);
    assert_eq!(first["isVirtual"], false);
    assert_eq!(first["templateStatus"], "BROUILLON");
    assert_eq!(first["constructionChecks"], json!([]));
    assert_eq!(first["numberingOverride"], Value::Null);
    assert_eq!(first["cableNextNum"], 1);
    assert_eq!(first["slots"], json!([]));
    assert_eq!(first["rigs"], json!([]));
    assert!(first.get("x").is_none());
    assert!(first["createdAt"].as_str().unwrap().ends_with('Z'));

    let ev = next_event(&mut rx).await;
    assert_eq!(
        ev,
        json!({"type": "update", "entity": "rack", "action": "created", "id": id})
    );
    assert_eq!(audit_count(&c.e.pool, "rack.create", id).await, 1);

    // The fields of createSchema are stored.
    let full = c
        .rack(json!({
            "name": "Flight", "totalU": 12, "depthMm": 450, "rearInteriorGapMm": 0,
            "maxWeightKg": 80.5, "maxPowerW": 1500, "emptyWeightKg": 12.5, "notes": "n",
            "rackType": "FLIGHT_CASE_CLASSIC", "hasWheels": true, "isRackable": false,
            "widthMm": 600, "heightMm": 800
        }))
        .await;
    assert_eq!(full["cableId"], 2);
    for (k, v) in [
        ("totalU", json!(12)),
        ("depthMm", json!(450)),
        ("rearInteriorGapMm", json!(0)),
        ("maxWeightKg", json!(80.5)),
        ("maxPowerW", json!(1500.0)),
        ("emptyWeightKg", json!(12.5)),
        ("notes", json!("n")),
        ("rackType", json!("FLIGHT_CASE_CLASSIC")),
        ("hasWheels", json!(true)),
        ("isRackable", json!(false)),
        ("widthMm", json!(600)),
        ("heightMm", json!(800)),
    ] {
        assert_eq!(full[k], v, "{k}");
    }

    // 1..9 then 0; a freed number is reused first.
    let mut got = vec![1, 2];
    for i in 3..=10 {
        let r = c.rack(json!({ "name": format!("R{i}") })).await;
        got.push(r["cableId"].as_i64().unwrap());
    }
    assert_eq!(got, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    // All ten taken: arkyo falls back to 0 (`.find(...) ?? 0`).
    let eleventh = c.rack(json!({"name": "R11"})).await;
    assert_eq!(eleventh["cableId"], 0);

    let r = c.req("DELETE", &format!("{RACKS}/{id}"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    let reused = c.rack(json!({"name": "R12"})).await;
    assert_eq!(reused["cableId"], 1);
}

#[tokio::test]
async fn rack_validation_uses_flatten() {
    let c = ctx().await;
    let r = c
        .req("POST", RACKS, Some(json!({"name": "A", "totalU": 99})))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": {"formErrors": [], "fieldErrors": {
            "totalU": ["Too big: expected number to be <=56"]
        }}})
    );

    let r = c
        .req(
            "POST",
            RACKS,
            Some(json!({"totalU": 1.5, "depthMm": 0, "rackType": "X"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let fe = &r.body["error"]["fieldErrors"];
    assert_eq!(
        fe["name"],
        json!(["Invalid input: expected string, received undefined"])
    );
    assert_eq!(
        fe["totalU"],
        json!(["Invalid input: expected int, received number"])
    );
    assert_eq!(
        fe["depthMm"],
        json!(["Too small: expected number to be >0"])
    );
    assert!(fe["rackType"][0]
        .as_str()
        .unwrap()
        .starts_with("Invalid option"));

    let r = c.req("POST", RACKS, Some(json!([1]))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["error"]["formErrors"],
        json!(["Invalid input: expected object, received array"])
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(r#"SELECT COUNT(*) FROM "Rack""#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap(),
        0
    );

    // PATCH: the nested numberingOverride errors land on its key.
    let rack = c.rack(json!({"name": "A"})).await;
    let path = format!("{RACKS}/{}", rack["id"].as_str().unwrap());
    let r = c
        .req(
            "PATCH",
            &path,
            Some(json!({"numberingOverride": {"pad": 2, "sep1": "abcdef"}, "cableCode": "ABCDEF", "templateStatus": "X"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let fe = &r.body["error"]["fieldErrors"];
    assert_eq!(
        fe["numberingOverride"],
        json!([
            "Too small: expected number to be >=3",
            "Too big: expected string to have <=5 characters"
        ])
    );
    assert_eq!(
        fe["cableCode"],
        json!(["Too big: expected string to have <=5 characters"])
    );
    assert!(fe["templateStatus"][0]
        .as_str()
        .unwrap()
        .starts_with("Invalid option"));
    let r = c
        .req("PATCH", &path, Some(json!({"numberingOverride": "x"})))
        .await;
    assert_eq!(
        r.body["error"]["fieldErrors"]["numberingOverride"],
        json!(["Invalid input: expected object, received string"])
    );

    // Rigs answer flatten() too.
    let r = c.req("POST", RIGS, Some(json!({"type": "BUS"}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let fe = &r.body["error"]["fieldErrors"];
    assert_eq!(
        fe["name"],
        json!(["Invalid input: expected string, received undefined"])
    );
    assert_eq!(
        fe["type"],
        json!([r#"Invalid option: expected one of "FLIGHT_CASE"|"CAR"|"MIXED""#])
    );
    let rig = c.rig(json!({"name": "Régie"})).await;
    let r = c
        .req(
            "POST",
            &format!("{RIGS}/{}/racks", rig["id"].as_str().unwrap()),
            Some(json!({"name": "", "totalU": 0})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": {"formErrors": [], "fieldErrors": {
            "name": ["Too small: expected string to have >=1 characters"],
            "totalU": ["Too small: expected number to be >=1"]
        }}})
    );
}

#[tokio::test]
async fn templates_filter_excludes_project_racks() {
    let c = ctx().await;
    let (pid, project_rig, virtual_rack) = c.project_with_location("Match").await;
    let r = c
        .req(
            "POST",
            &format!("/api/tenant/projects/{pid}/racks"),
            Some(json!({"racks": [{"name": "Baie projet", "locationId": sqlx::query_scalar::<_, String>(r#"SELECT "id" FROM "Location""#).fetch_one(&c.e.pool).await.unwrap()}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let project_rack = r.body["racks"][0]["id"].as_str().unwrap().to_string();

    let free = c.rack(json!({"name": "Libre"})).await;
    let free = free["id"].as_str().unwrap().to_string();
    let in_template = c.rack(json!({"name": "Dans un modèle"})).await;
    let in_template = in_template["id"].as_str().unwrap().to_string();
    let template_rig = c.rig(json!({"name": "Modèle", "isTemplate": true})).await;
    let template_rig = template_rig["id"].as_str().unwrap().to_string();
    assert_eq!(
        c.link(&template_rig, &in_template).await.status,
        StatusCode::CREATED
    );
    // A template rack also used by a project rig is in a project.
    let shared = c.rack(json!({"name": "Partagé"})).await;
    let shared = shared["id"].as_str().unwrap().to_string();
    assert_eq!(
        c.link(&template_rig, &shared).await.status,
        StatusCode::CREATED
    );
    assert_eq!(
        c.link(&project_rig, &shared).await.status,
        StatusCode::CREATED
    );

    let r = c.req("GET", &format!("{RACKS}?templates=true"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    let mut got = ids(&r.body);
    got.sort_unstable();
    let mut want = vec![free.as_str(), in_template.as_str()];
    want.sort_unstable();
    assert_eq!(got, want);
    for rack in r.body.as_array().unwrap() {
        assert!(rack["slots"].is_array());
        assert!(rack["rigs"].is_array());
    }
    let linked = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == in_template.as_str())
        .unwrap();
    assert_eq!(linked["rigs"][0]["rigConfigId"], template_rig.as_str());
    assert_eq!(
        linked["rigs"][0]["rigConfig"],
        json!({"id": template_rig, "name": "Modèle"})
    );

    // Without a filter: every rack.
    let r = c.req("GET", RACKS, None).await;
    assert_eq!(r.body.as_array().unwrap().len(), 5);
    // unassigned: no rig at all.
    let r = c
        .req("GET", &format!("{RACKS}?unassigned=true"), None)
        .await;
    assert_eq!(ids(&r.body), vec![free.as_str()]);
    // unassigned + rigConfigId: not in that rig (the rig page's list).
    let r = c
        .req(
            "GET",
            &format!("{RACKS}?unassigned=true&rigConfigId={template_rig}"),
            None,
        )
        .await;
    let mut got = ids(&r.body);
    got.sort_unstable();
    let mut want = vec![free.as_str(), virtual_rack.as_str(), project_rack.as_str()];
    want.sort_unstable();
    assert_eq!(got, want);
}

#[tokio::test]
async fn patch_rack_normalizes_cable_code_and_publishes_client_id() {
    let c = ctx().await;
    let rack = c.rack(json!({"name": "A"})).await;
    let id = rack["id"].as_str().unwrap().to_string();
    let path = format!("{RACKS}/{id}");
    let mut rx = c.e.events.subscribe();
    // An old `updatedAt`: the POST and the PATCH may fall in the same
    // millisecond, so the bump is checked against a known earlier date.
    const OLD: &str = "2000-01-01T00:00:00.000Z";
    sqlx::query(r#"UPDATE "Rack" SET "updatedAt" = ? WHERE "id" = ?"#)
        .bind(OLD)
        .bind(&id)
        .execute(&c.e.pool)
        .await
        .unwrap();

    let r = c
        .req_client(
            "PATCH",
            &path,
            "tab-1",
            Some(json!({
                "cableCode": "a-b 1",
                "numberingOverride": {"pad": 4, "includeRack": true, "junk": 1},
                "templateStatus": "ACTIF",
                "name": "Baie B",
                "maxWeightKg": null,
                "rearInteriorGapMm": 120,
                "x": 1
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["cableCode"], "AB1");
    assert_eq!(
        r.body["numberingOverride"],
        json!({"pad": 4, "includeRack": true})
    );
    assert_eq!(r.body["templateStatus"], "ACTIF");
    assert_eq!(r.body["name"], "Baie B");
    assert_eq!(r.body["rearInteriorGapMm"], 120);
    assert_eq!(r.body["slots"], json!([]));
    assert_eq!(r.body["rigs"], json!([]));
    assert!(r.body.get("x").is_none());
    assert!(r.body["updatedAt"].as_str().unwrap() > OLD);
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rack", "action": "updated", "id": id,
               "rackId": id, "clientId": "tab-1"})
    );
    assert_eq!(audit_count(&c.e.pool, "rack.update", &id).await, 1);

    // Only symbols: null; long input cut to 5 after the cleanup.
    let r = c
        .req("PATCH", &path, Some(json!({"cableCode": "-_ -"})))
        .await;
    assert_eq!(r.body["cableCode"], Value::Null);
    assert_eq!(r.body["templateStatus"], "ACTIF");
    let r = c
        .req("PATCH", &path, Some(json!({"cableCode": "ß-é1"})))
        .await;
    assert_eq!(r.body["cableCode"], "SS1");
    let r = c
        .req(
            "PATCH",
            &path,
            Some(json!({"cableCode": null, "numberingOverride": null})),
        )
        .await;
    assert_eq!(r.body["cableCode"], Value::Null);
    assert_eq!(r.body["numberingOverride"], Value::Null);
    let stored: Option<String> =
        sqlx::query_scalar(r#"SELECT "numberingOverride" FROM "Rack" WHERE "id" = ?"#)
            .bind(&id)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(stored, None);
    // Without the header: no clientId in the event.
    let ev = loop {
        let ev = next_event(&mut rx).await;
        if rx.is_empty() {
            break ev;
        }
    };
    assert!(ev.get("clientId").is_none());

    let r = c
        .req(
            "PATCH",
            &format!("{RACKS}/nope"),
            Some(json!({"name": "X"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));

    let r = c.req_client("DELETE", &path, "tab-2", None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rack", "action": "deleted", "id": id,
               "rackId": id, "clientId": "tab-2"})
    );
    assert_eq!(audit_count(&c.e.pool, "rack.delete", &id).await, 1);
    let r = c.req("DELETE", &path, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn slots_are_enriched() {
    let c = ctx().await;
    let rack = c.rack(json!({"name": "A"})).await;
    let rid = rack["id"].as_str().unwrap().to_string();
    for sql in [
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Blackmagic',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","reference","brandId","heightU","weight","powerW","connectors","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM 2 M/E','SWATEMPSW2ME','b1',2,6.5,250,'[{"name":"SDI"}]','u',?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","versions","iconId","color","createdAt","updatedAt")
           VALUES ('ct1','XLR 3 test','["M","F"]','xlr3','#123456',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","heightU","slotsPerU","createdById","createdAt","updatedAt") VALUES ('pn1','Patch audio',1,16,'u',?,?)"#,
    ] {
        exec(&c.e.pool, sql).await;
    }
    sqlx::query(
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","catalogConnectorTypeId","mountD","label") VALUES
           ('ps2','pn1',2,NULL,0,'vide'), ('ps1','pn1',1,'ct1',1,'XLR')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    for sql in [
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","startU","heightU","createdAt","updatedAt") VALUES ('s1','{rid}','eq1',10,2,?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","panelId","startU","heightU","createdAt","updatedAt") VALUES ('s2','{rid}','pn1',1,1,?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('s3','{rid}','gone',?,?)"#
        ),
    ] {
        exec(&c.e.pool, &sql).await;
    }

    let r = c.req("GET", RACKS, None).await;
    assert_eq!(r.status, StatusCode::OK);
    let slots = r.body[0]["slots"].as_array().unwrap();
    let by = |id: &str| slots.iter().find(|s| s["id"] == id).unwrap().clone();
    let s1 = by("s1");
    assert_eq!(s1["equipmentId"], "eq1");
    assert_eq!(s1["catalogEquipmentId"], "eq1");
    assert_eq!(s1["panel"], Value::Null);
    let eq = &s1["equipment"];
    assert_eq!(eq["name"], "ATEM 2 M/E");
    assert_eq!(eq["reference"], "SWATEMPSW2ME");
    assert_eq!(eq["brand"], json!({"id": "b1", "name": "Blackmagic"}));
    assert_eq!(eq["source"], "PERSONAL");
    assert_eq!(eq["category"], Value::Null);
    assert_eq!(eq["isRackable"], true);
    assert_eq!(eq["weight"], 6.5);
    assert_eq!(eq["powerW"], 250);
    assert_eq!(eq["connectors"], json!([{"name": "SDI"}]));
    assert!(eq.get("createdById").is_none(), "lite shape: {eq}");
    assert_eq!(by("s3")["equipment"], Value::Null);

    let s2 = by("s2");
    assert_eq!(s2["equipmentId"], Value::Null);
    assert_eq!(s2["equipment"], Value::Null);
    let panel = &s2["panel"];
    assert_eq!(panel["id"], "pn1");
    assert_eq!(panel["name"], "Patch audio");
    assert_eq!(panel["heightU"], 1);
    assert_eq!(panel["slotsPerU"], 16);
    assert_eq!(panel["rearCableDepthMm"], 80);
    assert!(panel.get("createdById").is_none());
    let ps = panel["slots"].as_array().unwrap();
    assert_eq!(ps.len(), 2);
    let p1 = ps.iter().find(|p| p["position"] == 1).unwrap();
    assert_eq!(
        p1.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["connectorType", "connectorTypeId", "mountD", "position"]
    );
    assert_eq!(p1["mountD"], true);
    assert_eq!(p1["connectorTypeId"], "ct1");
    assert_eq!(
        p1["connectorType"],
        json!({"id": "ct1", "name": "XLR 3 test", "versions": ["M", "F"], "iconId": "xlr3",
               "color": "#123456", "category": null, "hasNeutrikD": true, "dTypeSvgUrl": null})
    );
    let p2 = ps.iter().find(|p| p["position"] == 2).unwrap();
    assert_eq!(p2["connectorType"], Value::Null);
    assert_eq!(p2["mountD"], false);

    // Rigs: the list enriches like /api/racks; the detail only adds
    // `equipment`, slots by startU (unplaced last).
    let rig = c.rig(json!({"name": "Régie"})).await;
    let rig_id = rig["id"].as_str().unwrap().to_string();
    assert_eq!(rig["rigRacks"], json!([]));
    let r = c.link(&rig_id, &rid).await;
    assert_eq!(r.status, StatusCode::CREATED);
    let linked = r.body["rack"]["slots"].as_array().unwrap();
    assert!(linked
        .iter()
        .any(|s| s["panel"]["slots"].as_array().is_some_and(|p| p.len() == 2)));
    assert!(r.body["rack"].get("rigs").is_none());

    let r = c.req("GET", RIGS, None).await;
    let s = r.body[0]["rigRacks"][0]["rack"]["slots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == "s1")
        .unwrap()
        .clone();
    assert_eq!(s["equipment"]["name"], "ATEM 2 M/E");
    assert_eq!(s["equipmentId"], "eq1");

    let r = c.req("GET", &format!("{RIGS}/{rig_id}"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["project"], Value::Null);
    let slots = r.body["rigRacks"][0]["rack"]["slots"].as_array().unwrap();
    assert_eq!(
        slots
            .iter()
            .map(|s| s["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["s2", "s1", "s3"]
    );
    assert_eq!(slots[1]["equipment"]["brand"]["name"], "Blackmagic");
    assert!(slots[0].get("panel").is_none());
    assert!(slots[0].get("equipmentId").is_none());
    assert_eq!(slots[0]["panelId"], "pn1");
}

#[tokio::test]
async fn rig_linked_to_project_cannot_become_template() {
    let c = ctx().await;
    let (pid, project_rig, _) = c.project_with_location("Match").await;
    let r = c
        .req(
            "PATCH",
            &format!("{RIGS}/{project_rig}"),
            Some(json!({"isTemplate": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body, json!({"error": TEMPLATE_MSG}));
    let t: i64 = sqlx::query_scalar(r#"SELECT "isTemplate" FROM "RigConfig" WHERE "id" = ?"#)
        .bind(&project_rig)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(t, 0);
    // Other fields of a project rig can change.
    let r = c
        .req(
            "PATCH",
            &format!("{RIGS}/{project_rig}"),
            Some(json!({"notes": "ok", "isTemplate": false})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["notes"], "ok");

    let mut rx = c.e.events.subscribe();
    let free = c
        .rig(json!({"name": "Car 1", "type": "CAR", "prestationType": "sport", "x": 1}))
        .await;
    let fid = free["id"].as_str().unwrap().to_string();
    assert_eq!(free["type"], "CAR");
    assert_eq!(free["isTemplate"], false);
    assert_eq!(free["projectId"], Value::Null);
    assert_eq!(free["createdById"], c.owner.as_str());
    assert!(free.get("x").is_none());
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rig", "action": "created", "id": fid})
    );
    let r = c
        .req(
            "PATCH",
            &format!("{RIGS}/{fid}"),
            Some(json!({"isTemplate": true, "name": "Modèle car"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["isTemplate"], true);
    assert_eq!(r.body["name"], "Modèle car");
    assert!(r.body.get("rigRacks").is_none());
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rig", "action": "updated", "id": fid})
    );

    // ?templates=true: template and no project; ?projectId=.
    let r = c.req("GET", &format!("{RIGS}?templates=true"), None).await;
    assert_eq!(ids(&r.body), vec![fid.as_str()]);
    let r = c.req("GET", &format!("{RIGS}?projectId={pid}"), None).await;
    assert_eq!(ids(&r.body), vec![project_rig.as_str()]);
    assert_eq!(
        r.body[0]["rigRacks"][0]["rack"]["isVirtual"], true,
        "{:?}",
        r.body
    );
    let r = c.req("GET", &format!("{RIGS}/{project_rig}"), None).await;
    assert_eq!(r.body["project"], json!({"id": pid, "name": "Match"}));

    // Unknown rig.
    for (m, body) in [
        ("GET", None),
        ("PATCH", Some(json!({"name": "x"}))),
        ("DELETE", None),
    ] {
        let r = c.req(m, &format!("{RIGS}/nope"), body).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{m}");
        assert_eq!(r.body, json!({"error": "Not found"}));
    }

    let r = c.req("DELETE", &format!("{RIGS}/{fid}"), None).await;
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rig", "action": "deleted", "id": fid})
    );
}

#[tokio::test]
async fn link_unlink_rack() {
    let c = ctx().await;
    let rig = c.rig(json!({"name": "Régie"})).await;
    let rig_id = rig["id"].as_str().unwrap().to_string();
    let rack = c.rack(json!({"name": "A"})).await;
    let rack_id = rack["id"].as_str().unwrap().to_string();
    let mut rx = c.e.events.subscribe();

    let r = c.link(&rig_id, &rack_id).await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["rigConfigId"], rig_id.as_str());
    assert_eq!(r.body["rackId"], rack_id.as_str());
    assert_eq!(r.body["position"], 0);
    assert_eq!(r.body["rack"]["name"], "A");
    assert_eq!(r.body["rack"]["slots"], json!([]));
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rack", "action": "linked", "id": rack_id})
    );

    let r = c.link(&rig_id, &rack_id).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    assert_eq!(r.body, json!({"error": "Rack already linked to this rig"}));
    let r = c.link(&rig_id, "nope").await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Rack not found"}));
    let r = c.link("nope", &rack_id).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Rig not found"}));

    // Create-then-link branch.
    let r = c
        .req(
            "POST",
            &format!("{RIGS}/{rig_id}/racks"),
            Some(json!({"name": "Nouvelle", "totalU": 12, "notes": "n"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["position"], 1);
    assert_eq!(r.body["rack"]["name"], "Nouvelle");
    assert_eq!(r.body["rack"]["totalU"], 12);
    assert_eq!(r.body["rack"]["depthMm"], 600);
    assert_eq!(r.body["rack"]["notes"], "n");
    assert_eq!(r.body["rack"]["cableId"], Value::Null);
    let created = r.body["rackId"].as_str().unwrap().to_string();
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rack", "action": "created", "id": created})
    );

    let r = c.req("GET", &format!("{RIGS}/{rig_id}"), None).await;
    let order: Vec<&str> = r.body["rigRacks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|rr| rr["rackId"].as_str().unwrap())
        .collect();
    assert_eq!(order, vec![rack_id.as_str(), created.as_str()]);

    let path = format!("{RIGS}/{rig_id}/racks/{rack_id}");
    let r = c.req("DELETE", &path, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!({"ok": true}));
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type": "update", "entity": "rack", "action": "unlinked", "id": rack_id})
    );
    // The rack itself is kept.
    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Rack" WHERE "id" = ?"#)
        .bind(&rack_id)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
    let r = c.req("DELETE", &path, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Link not found"}));

    // Deleting the rig drops its links, not its racks.
    let r = c.req("DELETE", &format!("{RIGS}/{rig_id}"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    let (links, racks): (i64, i64) =
        sqlx::query_as(r#"SELECT (SELECT COUNT(*) FROM "RigRack"), (SELECT COUNT(*) FROM "Rack")"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!((links, racks), (0, 2));
}

#[tokio::test]
async fn consultation_role_cannot_write_racks_or_rigs() {
    let c = ctx().await;
    let rack = c.rack(json!({"name": "A"})).await;
    let rack_id = rack["id"].as_str().unwrap().to_string();
    let rig = c.rig(json!({"name": "Régie"})).await;
    let rig_id = rig["id"].as_str().unwrap().to_string();
    assert_eq!(c.link(&rig_id, &rack_id).await.status, StatusCode::CREATED);

    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ro = login(&c.e.app, "c@b.fr").await;
    let writes = [
        ("POST", RACKS.to_string(), Some(json!({"name": "X"}))),
        (
            "PATCH",
            format!("{RACKS}/{rack_id}"),
            Some(json!({"name": "X"})),
        ),
        ("DELETE", format!("{RACKS}/{rack_id}"), None),
        ("POST", RIGS.to_string(), Some(json!({"name": "X"}))),
        (
            "PATCH",
            format!("{RIGS}/{rig_id}"),
            Some(json!({"name": "X"})),
        ),
        ("DELETE", format!("{RIGS}/{rig_id}"), None),
        (
            "POST",
            format!("{RIGS}/{rig_id}/racks"),
            Some(json!({"rackId": rack_id})),
        ),
        ("DELETE", format!("{RIGS}/{rig_id}/racks/{rack_id}"), None),
    ];
    for (m, path, body) in &writes {
        let r = call(&c.e.app, m, path, LOCAL, Some(&ro), body.clone()).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{m} {path}");
        assert_eq!(r.body, json!({"error": "Accès refusé"}));
    }
    for path in [
        RACKS.to_string(),
        format!("{RACKS}?templates=true"),
        format!("{RACKS}?unassigned=true&rigConfigId={rig_id}"),
        RIGS.to_string(),
        format!("{RIGS}/{rig_id}"),
    ] {
        let r = call(&c.e.app, "GET", &path, LOCAL, Some(&ro), None).await;
        assert_eq!(r.status, StatusCode::OK, "{path}");
    }
    let r = call(&c.e.app, "GET", RACKS, LOCAL, None, None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);

    // design:write is not enough to delete a rack or a rig (design:admin).
    add_user(&c.e.pool, "t@b.fr", "technicien", false).await;
    let tech = login(&c.e.app, "t@b.fr").await;
    for path in [format!("{RACKS}/{rack_id}"), format!("{RIGS}/{rig_id}")] {
        let r = call(&c.e.app, "DELETE", &path, LOCAL, Some(&tech), None).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{path}");
    }
    let r = call(
        &c.e.app,
        "PATCH",
        &format!("{RACKS}/{rack_id}"),
        LOCAL,
        Some(&tech),
        Some(json!({"name": "B"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
}
