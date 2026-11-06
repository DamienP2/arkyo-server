//! Phase 3, Task 3: locations and racks of a project
//! (`/api/tenant/projects/:id/locations`, `/api/tenant/projects/:id/racks`).
mod common;
use arkyo_server::projects::cable_code;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const LIST: &str = "/api/tenant/projects";
const NOW: &str = "2026-11-06T10:00:00.000Z";

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

    async fn project(&self, name: &str, rig_type: Option<&str>) -> String {
        let mut body = json!({"name": name, "interventionType": "PRESTATION"});
        if let Some(t) = rig_type {
            body["rigType"] = json!(t);
        }
        let r = self.req("POST", LIST, Some(body)).await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body["id"].as_str().unwrap().to_string()
    }

    async fn location(&self, project: &str, name: &str) -> Value {
        let r = self
            .req(
                "POST",
                &format!("{LIST}/{project}/locations"),
                Some(json!({ "name": name })),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body
    }
}

async fn next_event(rx: &mut tokio::sync::broadcast::Receiver<String>) -> Value {
    serde_json::from_str(&rx.recv().await.unwrap()).unwrap()
}

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sql)
        .bind(NOW)
        .bind(NOW)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

async fn int(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn first_location_creates_rig_and_virtual_rack() {
    let c = ctx().await;
    let id = c.project("Match", Some("CAR")).await;
    let path = format!("{LIST}/{id}/locations");
    let mut rx = c.e.events.subscribe();

    let r = c
        .req("POST", &path, Some(json!({"name": "  Plateau 1 ", "x": 1})))
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let loc = r.body.clone();
    let loc_id = loc["id"].as_str().unwrap().to_string();
    assert_eq!(loc_id.len(), 25);
    assert_eq!(loc["projectId"], id.as_str());
    assert_eq!(loc["name"], "Plateau 1");
    assert_eq!(loc["cableCode"], "PLATE");
    assert_eq!(loc["sortOrder"], 0);
    assert_eq!(loc["canvasX"], Value::Null);
    assert_eq!(loc["containerCount"], 0);
    assert!(loc["createdAt"].as_str().unwrap().ends_with('Z'));
    assert!(loc.get("x").is_none());
    let vr = loc["virtualRackId"].as_str().unwrap().to_string();

    // the project's rig, created on the fly
    let (rig_id, rig_name, rig_type, created_by): (String, String, String, String) =
        sqlx::query_as(&format!(
            r#"SELECT "id","name","type","createdById" FROM "RigConfig" WHERE "projectId" = '{id}'"#
        ))
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(rig_name, "Match — Régie principale");
    assert_eq!(rig_type, "CAR");
    assert_eq!(created_by, c.owner);

    // the virtual rack, linked to the rig
    let (name, code, virt, lid): (String, Option<String>, i64, Option<String>) =
        sqlx::query_as(&format!(
            r#"SELECT "name","cableCode","isVirtual","locationId" FROM "Rack" WHERE "id" = '{vr}'"#
        ))
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(
        (name.as_str(), code.as_deref(), virt, lid.as_deref()),
        ("Plateau 1", Some("PLATE"), 1, Some(loc_id.as_str()))
    );
    let (pos, rr_rig): (i64, String) = sqlx::query_as(&format!(
        r#"SELECT "position","rigConfigId" FROM "RigRack" WHERE "rackId" = '{vr}'"#
    ))
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!((pos, rr_rig.as_str()), (0, rig_id.as_str()));

    // audit create_location / Location, event location created
    let (uid, eid, pid, after): (String, String, Option<String>, String) = sqlx::query_as(
        r#"SELECT "userId","entityId","projectId","after" FROM "AuditLog" WHERE "action" = 'create_location' AND "entityType" = 'Location'"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(uid, c.owner);
    assert_eq!(eid, loc_id);
    assert_eq!(pid.as_deref(), Some(id.as_str()));
    assert_eq!(
        serde_json::from_str::<Value>(&after).unwrap(),
        json!({"name": "Plateau 1", "cableCode": "PLATE"})
    );
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type":"update","entity":"location","action":"created","id":loc_id,"projectId":id})
    );

    // second location: same rig, next position and sort order, own cableCode
    let r = c
        .req(
            "POST",
            &path,
            Some(json!({"name": "Régie", "cableCode": "r-é2"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["cableCode"], "R2");
    assert_eq!(r.body["sortOrder"], 1);
    let vr2 = r.body["virtualRackId"].as_str().unwrap().to_string();
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RigConfig""#).await,
        1
    );
    assert_eq!(
        int(
            &c.e.pool,
            &format!(r#"SELECT "position" FROM "RigRack" WHERE "rackId" = '{vr2}'"#)
        )
        .await,
        1
    );
    // a name without letters or digits gives no cable code
    let r = c.req("POST", &path, Some(json!({"name": "éé"}))).await;
    assert_eq!(r.status, StatusCode::CREATED);
    assert_eq!(r.body["cableCode"], Value::Null);

    // GET: sortOrder order, virtualRackId and non-virtual container count
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('c1','Baie','{loc_id}',?,?)"#
        ),
    )
    .await;
    let r = c.req("GET", &path, None).await;
    assert_eq!(r.status, StatusCode::OK);
    let list = r.body.as_array().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0]["id"], loc_id.as_str());
    assert_eq!(list[0]["virtualRackId"], vr.as_str());
    assert_eq!(list[0]["containerCount"], 1);
    assert_eq!(list[1]["name"], "Régie");
    assert_eq!(list[1]["containerCount"], 0);
    assert_eq!(list[2]["sortOrder"], 2);

    // errors
    let r = c.req("POST", &path, Some(json!({}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": "Validation invalide", "issues": [
            {"path": ["name"], "message": "Invalid input: expected string, received undefined"}
        ]})
    );
    let r = c
        .req(
            "POST",
            &path,
            Some(json!({"name": "", "cableCode": "ABCDEF"})),
        )
        .await;
    assert_eq!(
        r.body["issues"],
        json!([
            {"path": ["name"], "message": "Too small: expected string to have >=1 characters"},
            {"path": ["cableCode"], "message": "Too big: expected string to have <=5 characters"}
        ])
    );
    for (method, body) in [("POST", Some(json!({"name": "X"}))), ("GET", None)] {
        let r = c.req(method, &format!("{LIST}/nope/locations"), body).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{method}");
        assert_eq!(r.body, json!({"error": "Not found"}));
    }
}

#[test]
fn derive_cable_code_like_arkyo() {
    // name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || null
    assert_eq!(cable_code::derive("Plateau").as_deref(), Some("PLATE"));
    assert_eq!(cable_code::derive("régie 2").as_deref(), Some("RGIE2"));
    assert_eq!(cable_code::derive("a-b c_d").as_deref(), Some("ABCD"));
    assert_eq!(cable_code::derive("Car 1").as_deref(), Some("CAR1"));
    assert_eq!(cable_code::derive("12345678").as_deref(), Some("12345"));
    assert_eq!(cable_code::derive("Straße").as_deref(), Some("STRAS"));
    assert_eq!(cable_code::derive("éàü"), None);
    assert_eq!(cable_code::derive(""), None);
    assert_eq!(cable_code::derive("  "), None);
}

#[tokio::test]
async fn add_racks_names_unique_per_project() {
    let c = ctx().await;
    let id = c.project("Match", None).await;
    let loc = c.location(&id, "Plateau").await;
    let loc_id = loc["id"].as_str().unwrap();
    let path = format!("{LIST}/{id}/racks");
    // another project's "Rack" does not count
    let other = c.project("Autre", None).await;
    let other_loc = c.location(&other, "Ailleurs").await;
    let r = c
        .req(
            "POST",
            &format!("{LIST}/{other}/racks"),
            Some(json!({"racks": [{"name": "Rack", "locationId": other_loc["id"]}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let mut rx = c.e.events.subscribe();

    let r = c
        .req(
            "POST",
            &path,
            Some(json!({"racks": [
                {"name": " Rack ", "locationId": loc_id},
                {"name": "rack", "locationId": loc_id, "rackType": "PELICAN", "totalU": 12,
                 "depthMm": 450, "widthMm": 500, "hasWheels": true, "isRackable": false,
                 "emptyWeightKg": 8.5, "rearInteriorGapMm": 40},
            ]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let rig_id: String = sqlx::query_scalar(&format!(
        r#"SELECT "id" FROM "RigConfig" WHERE "projectId" = '{id}'"#
    ))
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(r.body["rigConfigId"], rig_id.as_str());
    let racks = r.body["racks"].as_array().unwrap();
    assert_eq!(racks.len(), 2);
    assert_eq!(racks[0]["name"], "Rack");
    assert_eq!(racks[0]["rackType"], "STANDARD");
    assert_eq!(racks[1]["name"], "rack 2");
    assert_eq!(racks[1]["rackType"], "PELICAN");
    assert_eq!(racks[0].as_object().unwrap().len(), 3);
    let r0 = racks[0]["id"].as_str().unwrap();
    let r1 = racks[1]["id"].as_str().unwrap();

    // defaults and sent fields
    type Dims = (
        i64,
        i64,
        i64,
        Option<i64>,
        i64,
        Option<f64>,
        Option<i64>,
        i64,
        String,
    );
    let q = r#"SELECT "totalU","depthMm","isRackable","widthMm","hasWheels","emptyWeightKg","rearInteriorGapMm","isVirtual","locationId" FROM "Rack" WHERE "id" = ?"#;
    let d0: Dims = sqlx::query_as(q)
        .bind(r0)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(d0, (42, 600, 1, None, 0, None, None, 0, loc_id.to_string()));
    let d1: Dims = sqlx::query_as(q)
        .bind(r1)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(
        d1,
        (
            12,
            450,
            0,
            Some(500),
            1,
            Some(8.5),
            Some(40),
            0,
            loc_id.to_string()
        )
    );
    // positions after the location's virtual rack
    let positions: Vec<(String, i64)> = sqlx::query_as(&format!(
        r#"SELECT "rackId","position" FROM "RigRack" WHERE "rigConfigId" = '{rig_id}' ORDER BY "position""#
    ))
    .fetch_all(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(positions.len(), 3);
    assert_eq!(positions[0].0, loc["virtualRackId"].as_str().unwrap());
    assert_eq!((positions[1].0.as_str(), positions[1].1), (r0, 1));
    assert_eq!((positions[2].0.as_str(), positions[2].1), (r1, 2));

    // a third one goes to "Rack 3"
    let r = c
        .req(
            "POST",
            &path,
            Some(json!({"racks": [{"name": "Rack", "locationId": loc_id}]})),
        )
        .await;
    assert_eq!(r.body["racks"][0]["name"], "Rack 3");

    // audit add_rack / Project, event rig updated
    let (eid, pid, after): (String, Option<String>, String) = sqlx::query_as(&format!(
        r#"SELECT "entityId","projectId","after" FROM "AuditLog" WHERE "action" = 'add_rack' AND "entityType" = 'Project' AND "entityId" = '{id}' ORDER BY "createdAt", rowid LIMIT 1"#
    ))
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(eid, id);
    assert_eq!(pid.as_deref(), Some(id.as_str()));
    assert_eq!(
        serde_json::from_str::<Value>(&after).unwrap(),
        json!({"racks": [
            {"id": r0, "name": "Rack", "rackType": "STANDARD"},
            {"id": r1, "name": "rack 2", "rackType": "PELICAN"},
        ]})
    );
    assert_eq!(
        next_event(&mut rx).await,
        json!({"type":"update","entity":"rig","action":"updated","id":rig_id,"projectId":id})
    );

    // a project without rig gets one on its first rack
    let bare = c.project("Nu", Some("FIXED_INSTALL")).await;
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('lb','{bare}','Salle',?,?)"#
        ),
    )
    .await;
    let r = c
        .req(
            "POST",
            &format!("{LIST}/{bare}/racks"),
            Some(json!({"racks": [{"name": "Baie", "locationId": "lb"}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let (name, ty): (String, String) = sqlx::query_as(&format!(
        r#"SELECT "name","type" FROM "RigConfig" WHERE "projectId" = '{bare}'"#
    ))
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        (name.as_str(), ty.as_str()),
        ("Nu — Régie principale", "FIXED_INSTALL")
    );

    // validation: Zod issues with array paths
    let r = c.req("POST", &path, Some(json!({"racks": []}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": "Validation invalide", "issues": [
            {"path": ["racks"], "message": "Too small: expected array to have >=1 items"}
        ]})
    );
    let r = c
        .req(
            "POST",
            &path,
            Some(
                json!({"racks": [1, {"name": "", "locationId": 3, "rackType": "X",
                "totalU": 0.5, "depthMm": -1, "heightMm": 0, "emptyWeightKg": -1,
                "rearInteriorGapMm": null, "isRackable": "y"},
                {"name": "A", "locationId": "l", "totalU": 57}]}),
            ),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["issues"],
        json!([
            {"path": ["racks", 0], "message": "Invalid input: expected object, received number"},
            {"path": ["racks", 1, "name"], "message": "Too small: expected string to have >=1 characters"},
            {"path": ["racks", 1, "locationId"], "message": "Invalid input: expected string, received number"},
            {"path": ["racks", 1, "rackType"], "message": r#"Invalid option: expected one of "STANDARD"|"FLIGHT_CASE_CLASSIC"|"FLIGHT_CASE_SKB"|"PELICAN"|"CAP""#},
            {"path": ["racks", 1, "isRackable"], "message": "Invalid input: expected boolean, received string"},
            {"path": ["racks", 1, "totalU"], "message": "Invalid input: expected int, received number"},
            {"path": ["racks", 1, "depthMm"], "message": "Too small: expected number to be >0"},
            {"path": ["racks", 1, "heightMm"], "message": "Too small: expected number to be >0"},
            {"path": ["racks", 1, "emptyWeightKg"], "message": "Too small: expected number to be >=0"},
            {"path": ["racks", 2, "totalU"], "message": "Too big: expected number to be <=56"},
        ])
    );
    let r = c.req("POST", &path, Some(json!(null))).await;
    assert_eq!(
        r.body["issues"],
        json!([{"path": ["root"], "message": "Invalid input: expected object, received null"}])
    );
    let r = c
        .req(
            "POST",
            &format!("{LIST}/nope/racks"),
            Some(json!({"racks": [{"name": "A", "locationId": "l"}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));
}

#[tokio::test]
async fn unknown_location_is_400() {
    let c = ctx().await;
    let id = c.project("Match", None).await;
    let loc = c.location(&id, "Plateau").await;
    let other = c.project("Autre", None).await;
    let foreign = c.location(&other, "Ailleurs").await;
    let before = int(&c.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await;

    for bad in ["nope", foreign["id"].as_str().unwrap()] {
        let r = c
            .req(
                "POST",
                &format!("{LIST}/{id}/racks"),
                Some(json!({"racks": [
                    {"name": "A", "locationId": loc["id"]},
                    {"name": "B", "locationId": bad},
                ]})),
            )
            .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(r.body, json!({"error": "Emplacement introuvable"}));
    }
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await,
        before
    );
}

#[tokio::test]
async fn from_template_clones_slots_and_inventory() {
    let c = ctx().await;
    let id = c.project("Match", None).await;
    let loc = c.location(&id, "Plateau").await;
    let loc_id = loc["id"].as_str().unwrap();
    for sql in [
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('gt','Modèle',1,'u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","createdById","createdAt","updatedAt") VALUES ('gn','Pas un modèle','u',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","totalU","depthMm","maxWeightKg","maxPowerW","emptyWeightKg","notes","rackType","hasWheels","isRackable","widthMm","cableCode","createdAt","updatedAt")
           VALUES ('rt','Baie modèle',16,500,80.5,1200,12,'note','FLIGHT_CASE_SKB',1,0,480,'BM',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","notes","createdAt","updatedAt") VALUES ('it','rt','eq1',2,'stock',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","view","startU","heightU","widthFraction","column","label","notes","patchNotes","createdAt","updatedAt")
           VALUES ('s1','rt','eq1','it','REAR',3,1.5,'HALF',1,'Mixeur','{"a":1}','pn',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","heightU","createdAt","updatedAt")
           VALUES ('s2','rt','eq1','it',5,1,?,?)"#,
    ] {
        exec(&c.e.pool, sql).await;
    }
    sqlx::query(
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('t1','gt','rt',0)"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();

    let path = format!("{LIST}/{id}/racks");
    let r = c
        .req(
            "POST",
            &path,
            Some(json!({"racks": [{"name": "Baie", "locationId": loc_id, "fromTemplateId": "gt", "totalU": 4}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let racks = r.body["racks"].as_array().unwrap();
    assert_eq!(racks.len(), 1);
    assert_eq!(racks[0]["name"], "Baie");
    assert_eq!(racks[0]["rackType"], "FLIGHT_CASE_SKB");
    let nr = racks[0]["id"].as_str().unwrap().to_string();
    assert_ne!(nr, "rt");

    // rack fields copied as arkyo does (the body's totalU is ignored)
    type Copied = (
        i64,
        i64,
        Option<f64>,
        Option<f64>,
        Option<f64>,
        Option<String>,
        String,
        i64,
    );
    let copied: Copied = sqlx::query_as(
        r#"SELECT "totalU","depthMm","maxWeightKg","maxPowerW","emptyWeightKg","notes","rackType","hasWheels" FROM "Rack" WHERE "id" = ?"#,
    )
    .bind(&nr)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        copied,
        (
            16,
            500,
            Some(80.5),
            Some(1200.0),
            Some(12.0),
            Some("note".into()),
            "FLIGHT_CASE_SKB".into(),
            1
        )
    );
    // not copied by arkyo: defaults; the location is the body's
    type Rest = (i64, Option<i64>, Option<String>, String, i64);
    let rest: Rest = sqlx::query_as(
        r#"SELECT "isRackable","widthMm","cableCode","locationId","isVirtual" FROM "Rack" WHERE "id" = ?"#,
    )
    .bind(&nr)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(rest, (1, None, None, loc_id.to_string(), 0));

    // one inventory item per catalogue reference, counted from the slots
    let items: Vec<(String, Option<String>, i64, Option<String>)> = sqlx::query_as(
        r#"SELECT "id","catalogEquipmentId","quantity","notes" FROM "RackInventoryItem" WHERE "rackId" = ?"#,
    )
    .bind(&nr)
    .fetch_all(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(items.len(), 1);
    let (inv, eq, qty, notes) = &items[0];
    assert_ne!(inv, "it");
    assert_eq!(
        (eq.as_deref(), *qty, notes.as_deref()),
        (Some("eq1"), 2, None)
    );

    // slots cloned with new ids, bound to the new inventory item
    type Slot = (
        String,
        Option<String>,
        Option<String>,
        String,
        Option<i64>,
        Option<f64>,
        String,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let slots: Vec<Slot> = sqlx::query_as(
        r#"SELECT "id","catalogEquipmentId","inventoryItemId","view","startU","heightU","widthFraction","column","label","notes","patchNotes" FROM "RackSlot" WHERE "rackId" = ? ORDER BY "startU""#,
    )
    .bind(&nr)
    .fetch_all(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(slots.len(), 2);
    for s in &slots {
        assert!(s.0 != "s1" && s.0 != "s2");
        assert_eq!(s.2.as_deref(), Some(inv.as_str()));
    }
    let s = &slots[0];
    assert_eq!(
        (
            s.1.as_deref(),
            s.3.as_str(),
            s.4,
            s.5,
            s.6.as_str(),
            s.7,
            s.8.as_deref(),
            s.9.as_deref(),
            s.10.as_deref()
        ),
        (
            Some("eq1"),
            "REAR",
            Some(3),
            Some(1.5),
            "HALF",
            1,
            Some("Mixeur"),
            Some(r#"{"a":1}"#),
            None
        )
    );

    // the template is untouched
    assert_eq!(
        int(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "RackSlot" WHERE "rackId" = 'rt' AND "inventoryItemId" = 'it'"#
        )
        .await,
        2
    );
    assert_eq!(
        int(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "RigRack" WHERE "rigConfigId" = 'gt'"#
        )
        .await,
        1
    );
    // the clone is linked to the project's rig, after the virtual rack
    assert_eq!(
        int(
            &c.e.pool,
            &format!(
                r#"SELECT "position" FROM "RigRack" rr JOIN "RigConfig" g ON g."id" = rr."rigConfigId" WHERE rr."rackId" = '{nr}' AND g."projectId" = '{id}'"#
            )
        )
        .await,
        1
    );

    // a second clone with the same name is suffixed
    let r = c
        .req(
            "POST",
            &path,
            Some(
                json!({"racks": [{"name": "baie", "locationId": loc_id, "fromTemplateId": "gt"}]}),
            ),
        )
        .await;
    assert_eq!(r.body["racks"][0]["name"], "baie 2");

    // unknown template, or a rig that is not a template: 404, nothing written
    let racks_before = int(&c.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await;
    for tpl in ["nope", "gn"] {
        let r = c
            .req(
                "POST",
                &path,
                Some(json!({"racks": [
                    {"name": "Avant", "locationId": loc_id},
                    {"name": "Baie", "locationId": loc_id, "fromTemplateId": tpl},
                ]})),
            )
            .await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{tpl}");
        assert_eq!(
            r.body,
            json!({"error": format!("Template introuvable : {tpl}")})
        );
    }
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await,
        racks_before
    );
}

#[tokio::test]
async fn consultation_role_cannot_write_locations_or_racks() {
    let c = ctx().await;
    let id = c.project("Match", None).await;
    let loc = c.location(&id, "Plateau").await;
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ro = login(&c.e.app, "c@b.fr").await;
    let locs = format!("{LIST}/{id}/locations");
    let racks = format!("{LIST}/{id}/racks");
    for (path, body) in [
        (&locs, json!({"name": "X"})),
        (
            &racks,
            json!({"racks": [{"name": "A", "locationId": loc["id"]}]}),
        ),
    ] {
        let r = call(&c.e.app, "POST", path, LOCAL, Some(&ro), Some(body)).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(r.body, json!({"error": "Accès refusé"}));
    }
    let r = call(&c.e.app, "GET", &locs, LOCAL, Some(&ro), None).await;
    assert_eq!(r.status, StatusCode::OK);
}

#[tokio::test]
async fn unsafe_integer_is_400() {
    let c = ctx().await;
    let id = c.project("Match", None).await;
    let loc = c.location(&id, "Plateau").await;
    let r = c
        .req(
            "POST",
            &format!("{LIST}/{id}/racks"),
            Some(json!({"racks": [{"name": "A", "locationId": loc["id"], "depthMm": 1e20}]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{:?}", r.body);
    assert_eq!(
        r.body,
        json!({"error": "Validation invalide", "issues": [
            {"path": ["racks", 0, "depthMm"], "message": "Too big: expected int to be <=9007199254740991"}
        ]})
    );
    assert_eq!(
        int(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "Rack" WHERE "isVirtual" = 0"#
        )
        .await,
        0
    );
}
