//! Phase 3, Task 2: projects API (`/api/tenant/projects/**`, `/api/projects`).
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const LIST: &str = "/api/tenant/projects";
const LEGACY: &str = "/api/projects";
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

    async fn create(&self, name: &str) -> String {
        let r = self
            .req(
                "POST",
                LIST,
                Some(json!({"name": name, "interventionType": "PRESTATION"})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body["id"].as_str().unwrap().to_string()
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

fn issue(path: &str, message: &str) -> Value {
    json!({ "path": [path], "message": message })
}

#[tokio::test]
async fn create_project_like_arkyo() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    let r = c
        .req(
            "POST",
            LIST,
            Some(json!({
                "name": "  Tournage A ",
                "interventionType": "PRESTATION",
                "shootingDate": "2026-11-10",
                "planningStart": "2026-11-01T08:30:00.000Z",
                "planningEnd": "",
                "clientName": "France TV",
                "unknown": "ignoré",
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(id.len(), 25);
    assert_eq!(r.body["name"], "Tournage A");
    assert_eq!(r.body["status"], "EN_PREPARATION");
    assert_eq!(r.body["interventionType"], "PRESTATION");
    assert_eq!(r.body["rigType"], Value::Null);
    assert_eq!(r.body["clientName"], "France TV");
    assert_eq!(r.body["shootingDate"], "2026-11-10T00:00:00.000Z");
    assert_eq!(r.body["planningStart"], "2026-11-01T08:30:00.000Z");
    assert_eq!(r.body["planningEnd"], Value::Null);
    assert_eq!(r.body["createdById"], c.owner.as_str());
    assert_eq!(r.body["ipMapPositions"], Value::Null);
    assert!(r.body.get("unknown").is_none());
    assert!(r.body["createdAt"].as_str().unwrap().ends_with('Z'));

    // TechnicalSheet created with the project
    let sheets = int(
        &c.e.pool,
        &format!(r#"SELECT COUNT(*) FROM "TechnicalSheet" WHERE "projectId" = '{id}'"#),
    )
    .await;
    assert_eq!(sheets, 1);

    // audit create / Project with projectId
    let (action, et, eid, pid, uid): (String, String, String, Option<String>, String) =
        sqlx::query_as(
            r#"SELECT "action","entityType","entityId","projectId","userId" FROM "AuditLog""#,
        )
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(
        (action.as_str(), et.as_str(), eid.as_str()),
        ("create", "Project", id.as_str())
    );
    assert_eq!(pid.as_deref(), Some(id.as_str()));
    assert_eq!(uid, c.owner);

    let ev = next_event(&mut rx).await;
    assert_eq!(
        ev,
        json!({"type":"update","entity":"project","action":"created","id":id,"projectId":id})
    );
}

#[tokio::test]
async fn duplicate_name_is_409_case_and_accent_insensitive() {
    let c = ctx().await;
    c.create("Régie Nord").await;
    let expected = json!({
        "error": "Validation invalide",
        "issues": [issue("name", "Un projet porte déjà ce nom dans cet espace.")],
    });
    for dup in ["regie nord", "  RÉGIE NORD ", "Re\u{301}gie Nord"] {
        let r = c
            .req(
                "POST",
                LIST,
                Some(json!({"name": dup, "interventionType": "INTEGRATION"})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CONFLICT, "{dup}");
        assert_eq!(r.body, expected, "{dup}");
    }
    // blank after trimming
    let r = c
        .req(
            "POST",
            LIST,
            Some(json!({"name": "   ", "interventionType": "PRESTATION"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": "Validation invalide", "issues": [issue("name", "Nom requis")]})
    );
    assert_eq!(int(&c.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await, 1);
    // another name is fine
    c.create("Régie Sud").await;
}

#[tokio::test]
async fn invalid_body_returns_issues() {
    let c = ctx().await;
    let r = c
        .req(
            "POST",
            LIST,
            Some(json!({"name": "A", "interventionType": "X"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({
            "error": "Validation invalide",
            "issues": [issue(
                "interventionType",
                r#"Invalid option: expected one of "PRESTATION"|"INTEGRATION""#
            )],
        })
    );
    // schema order: name before interventionType, then rigType
    let r = c
        .req(
            "POST",
            LIST,
            Some(json!({"interventionType": 3, "rigType": "BUS", "clientName": 4})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["issues"],
        json!([
            issue("name", "Invalid input: expected string, received undefined"),
            issue(
                "interventionType",
                r#"Invalid option: expected one of "PRESTATION"|"INTEGRATION""#
            ),
            issue(
                "rigType",
                r#"Invalid option: expected one of "FLIGHT_CASE"|"CAR"|"FIXED_INSTALL"|"MIXED""#
            ),
            issue(
                "clientName",
                "Invalid input: expected string, received number"
            ),
        ])
    );
    let r = c
        .req(
            "POST",
            LIST,
            Some(json!({"name": "", "interventionType": "PRESTATION"})),
        )
        .await;
    assert_eq!(
        r.body["issues"],
        json!([issue(
            "name",
            "Too small: expected string to have >=1 characters"
        )])
    );
    // not an object
    let r = c.req("POST", LIST, Some(json!([1]))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["issues"],
        json!([{"path": ["root"], "message": "Invalid input: expected object, received array"}])
    );
    // a date JavaScript cannot read
    let r = c
        .req(
            "POST",
            LIST,
            Some(json!({"name": "A", "interventionType": "PRESTATION", "shootingDate": "demain"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body["error"], "Validation invalide");
    assert_eq!(r.body["issues"][0]["path"], json!(["shootingDate"]));
    assert_eq!(int(&c.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await, 0);
}

#[tokio::test]
async fn list_has_page_fields() {
    let c = ctx().await;
    let a = c.create("Ancien").await;
    let b = c.create("Récent").await;
    sqlx::query(r#"UPDATE "Project" SET "updatedAt" = ?, "description" = 'Finale' WHERE "id" = ?"#)
        .bind("2030-01-01T00:00:00.000Z")
        .bind(&a)
        .execute(&c.e.pool)
        .await
        .unwrap();
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('g1','Régie','{a}','u',?,?)"#
        ),
    )
    .await;

    let r = c.req("GET", LIST, None).await;
    assert_eq!(r.status, StatusCode::OK);
    let projects = r.body["projects"].as_array().unwrap();
    assert_eq!(projects.len(), 2);
    // ordered by updatedAt desc
    assert_eq!(projects[0]["id"], a.as_str());
    assert_eq!(projects[1]["id"], b.as_str());
    let p = &projects[0];
    assert_eq!(p["description"], "Finale");
    assert_eq!(p["documentsCount"], 0);
    assert_eq!(p["rigConfigsCount"], 1);
    assert_eq!(projects[1]["rigConfigsCount"], 0);
    assert_eq!(projects[1]["description"], Value::Null);
    let mut keys: Vec<&str> = p.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut expected = vec![
        "id",
        "name",
        "status",
        "interventionType",
        "rigType",
        "clientName",
        "shootingDate",
        "shootingEndDate",
        "planningStart",
        "planningEnd",
        "commissioningDate",
        "location",
        "prestationType",
        "description",
        "updatedAt",
        "createdAt",
        "documentsCount",
        "rigConfigsCount",
    ];
    expected.sort_unstable();
    assert_eq!(keys, expected);

    // session required
    let anon = call(&c.e.app, "GET", LIST, LOCAL, None, None).await;
    assert_eq!(anon.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn patch_and_get_detail() {
    let c = ctx().await;
    let id = c.create("Tournage").await;
    let path = format!("{LIST}/{id}");
    let mut rx = c.e.events.subscribe();

    let r = c
        .req(
            "PATCH",
            &path,
            Some(json!({
                "status": "PRET",
                "clientName": "Canal",
                "shootingDate": "2026-12-01",
                "rigType": "CAR",
                "description": null,
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["status"], "PRET");
    assert_eq!(r.body["clientName"], "Canal");
    assert_eq!(r.body["shootingDate"], "2026-12-01T00:00:00.000Z");
    assert_eq!(r.body["rigType"], "CAR");
    assert_eq!(r.body["name"], "Tournage");
    let ev = next_event(&mut rx).await;
    assert_eq!(
        ev,
        json!({"type":"update","entity":"project","action":"updated","id":id,"projectId":id})
    );
    let (pid, before, after): (Option<String>, String, String) = sqlx::query_as(
        r#"SELECT "projectId","before","after" FROM "AuditLog" WHERE "action" = 'update' AND "entityType" = 'Project'"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(pid.as_deref(), Some(id.as_str()));
    let before: Value = serde_json::from_str(&before).unwrap();
    let after: Value = serde_json::from_str(&after).unwrap();
    assert_eq!(before["status"], "EN_PREPARATION");
    assert_eq!(after["status"], "PRET");

    // clearing a date with null or ""
    let r = c
        .req(
            "PATCH",
            &path,
            Some(json!({"shootingDate": "", "rigType": null})),
        )
        .await;
    assert_eq!(r.body["shootingDate"], Value::Null);
    assert_eq!(r.body["rigType"], Value::Null);
    assert_eq!(r.body["status"], "PRET");

    // a rig with a rack, read through the include
    for sql in [
        format!(
            r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('g1','Régie','{id}','u',?,?)"#
        ),
        r#"INSERT INTO "Rack" ("id","name","isVirtual","createdAt","updatedAt") VALUES ('r1','Baie A',1,?,?)"#.into(),
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('r2','Baie B',?,?)"#.into(),
    ] {
        exec(&c.e.pool, &sql).await;
    }
    sqlx::query(
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr2','g1','r2',1), ('rr1','g1','r1',0)"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();

    let r = c.req("GET", &path, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["id"], id.as_str());
    assert_eq!(r.body["status"], "PRET");
    assert_eq!(
        r.body["_count"],
        json!({"tasks": 0, "messages": 0, "documents": 0})
    );
    assert_eq!(r.body["documents"], json!([]));
    let rigs = r.body["rigConfigs"].as_array().unwrap();
    assert_eq!(rigs.len(), 1);
    assert_eq!(rigs[0]["isTemplate"], false);
    let rr = rigs[0]["rigRacks"].as_array().unwrap();
    assert_eq!(rr[0]["position"], 0);
    assert_eq!(rr[0]["rack"]["name"], "Baie A");
    assert_eq!(rr[0]["rack"]["isVirtual"], true);
    assert_eq!(rr[0]["rack"]["constructionChecks"], json!([]));
    assert_eq!(rr[1]["rack"]["id"], "r2");

    // a project without rigs
    let other = c.create("Autre").await;
    let r = c.req("GET", &format!("{LIST}/{other}"), None).await;
    assert_eq!(r.body["rigConfigs"], json!([]));

    // unknown id, bad body
    let r = c.req("GET", &format!("{LIST}/nope"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));
    let r = c
        .req("PATCH", &format!("{LIST}/nope"), Some(json!({"name": "X"})))
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));
    let r = c
        .req("PATCH", &path, Some(json!({"status": "FINI", "name": ""})))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({
            "error": "Validation invalide",
            "issues": [
                issue("name", "Too small: expected string to have >=1 characters"),
                issue(
                    "status",
                    r#"Invalid option: expected one of "EN_PREPARATION"|"PRET"|"EN_COURS"|"TERMINE"|"ANNULE""#
                ),
            ],
        })
    );
}

#[tokio::test]
async fn delete_project_leaves_no_template_ghosts() {
    let c = ctx().await;
    let id = c.create("Match").await;
    let keep = c.create("Autre projet").await;
    for sql in [
        // the project's rig, location, virtual rack and own rack
        format!(
            r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('gp','Match — Régie principale','{id}','u',?,?)"#
        ),
        format!(
            r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('l1','{id}','Plateau',?,?)"#
        ),
        r#"INSERT INTO "Rack" ("id","name","locationId","isVirtual","createdAt","updatedAt") VALUES ('rv','Plateau','l1',1,?,?)"#.into(),
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('ro','Baie A','l1',?,?)"#.into(),
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('s1','ro',?,?)"#.into(),
        // a template rig sharing one rack with the project
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('gt','Modèle',1,'u',?,?)"#.into(),
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('rs','Baie modèle',?,?)"#.into(),
        // a free rack and another project's rig and rack
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('rf','Libre',?,?)"#.into(),
        format!(
            r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('gk','Autre','{keep}','u',?,?)"#
        ),
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('rk','Baie autre',?,?)"#.into(),
    ] {
        exec(&c.e.pool, &sql).await;
    }
    sqlx::query(
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES
           ('a','gp','rv',0), ('b','gp','ro',1), ('c','gp','rs',2), ('d','gt','rs',0), ('e','gk','rk',0)"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    let mut rx = c.e.events.subscribe();

    let r = c.req("DELETE", &format!("{LIST}/{id}"), None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body, json!({"ok": true}));

    let racks: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "Rack" ORDER BY "id""#)
        .fetch_all(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(racks, ["rf", "rk", "rs"]);
    let rigs: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "RigConfig" ORDER BY "id""#)
        .fetch_all(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(rigs, ["gk", "gt"]);
    let links: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "RigRack" ORDER BY "id""#)
        .fetch_all(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(links, ["d", "e"]);
    for t in ["Location", "RackSlot"] {
        assert_eq!(
            int(&c.e.pool, &format!(r#"SELECT COUNT(*) FROM "{t}""#)).await,
            0,
            "{t}"
        );
    }
    assert_eq!(
        int(
            &c.e.pool,
            &format!(r#"SELECT COUNT(*) FROM "Project" WHERE "id" = '{id}'"#)
        )
        .await,
        0
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "TechnicalSheet""#).await,
        1
    );

    // AuditLog: the project's rows are kept with projectId NULL
    assert_eq!(
        int(
            &c.e.pool,
            &format!(r#"SELECT COUNT(*) FROM "AuditLog" WHERE "projectId" = '{id}'"#)
        )
        .await,
        0
    );
    assert_eq!(
        int(
            &c.e.pool,
            &format!(r#"SELECT COUNT(*) FROM "AuditLog" WHERE "entityId" = '{id}'"#)
        )
        .await,
        2
    );
    assert_eq!(
        int(
            &c.e.pool,
            &format!(r#"SELECT COUNT(*) FROM "AuditLog" WHERE "projectId" = '{keep}'"#)
        )
        .await,
        1
    );
    let (pid, before): (Option<String>, String) = sqlx::query_as(
        r#"SELECT "projectId","before" FROM "AuditLog" WHERE "action" = 'delete' AND "entityType" = 'Project'"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(pid, None);
    let before: Value = serde_json::from_str(&before).unwrap();
    assert_eq!(before["name"], "Match");

    let ev = next_event(&mut rx).await;
    assert_eq!(
        ev,
        json!({"type":"update","entity":"project","action":"deleted","id":id,"projectId":id})
    );

    let r = c.req("DELETE", &format!("{LIST}/{id}"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));
}

#[tokio::test]
async fn dashboard_routes() {
    let c = ctx().await;
    let id = c.create("Tournage").await;
    sqlx::query(r#"UPDATE "TechnicalSheet" SET "completionPercent" = 42.5"#)
        .execute(&c.e.pool)
        .await
        .unwrap();

    let r = c.req("GET", LEGACY, None).await;
    assert_eq!(r.status, StatusCode::OK);
    let list = r.body.as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["id"], id.as_str());
    assert_eq!(list[0]["status"], "EN_PREPARATION");
    assert_eq!(
        list[0]["technicalSheet"],
        json!({"completionPercent": 42.5})
    );
    assert_eq!(list[0]["_count"], json!({"tasks": 0}));

    let r = c.req("GET", &format!("{LEGACY}?stats=tasks"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, json!([]));

    for (tid, status) in [("t1", "A_FAIRE"), ("t2", "A_FAIRE"), ("t3", "VALIDE")] {
        exec(
            &c.e.pool,
            &format!(
                r#"INSERT INTO "Task" ("id","projectId","title","status","createdAt","updatedAt") VALUES ('{tid}','{id}','T','{status}',?,?)"#
            ),
        )
        .await;
    }
    let r = c.req("GET", &format!("{LEGACY}?stats=tasks"), None).await;
    let mut stats = r.body.as_array().unwrap().clone();
    stats.sort_by_key(|s| s["status"].as_str().unwrap().to_string());
    assert_eq!(
        stats,
        [
            json!({"status": "A_FAIRE", "_count": 2}),
            json!({"status": "VALIDE", "_count": 1})
        ]
    );
    let r = c.req("GET", LEGACY, None).await;
    assert_eq!(r.body[0]["_count"]["tasks"], 3);

    // legacy POST: flatten() errors, sheet included, no duplicate check
    let mut rx = c.e.events.subscribe();
    let r = c
        .req(
            "POST",
            LEGACY,
            Some(json!({"name": "Tournage", "shootingDate": "2026-11-20"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let new_id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["status"], "EN_PREPARATION");
    assert_eq!(r.body["interventionType"], "PRESTATION");
    assert_eq!(r.body["shootingDate"], "2026-11-20T00:00:00.000Z");
    assert_eq!(r.body["technicalSheet"]["projectId"], new_id.as_str());
    assert_eq!(r.body["technicalSheet"]["blocks"], json!([]));
    assert_eq!(r.body["technicalSheet"]["completionPercent"], 0.0);
    let ev = next_event(&mut rx).await;
    assert_eq!(
        ev,
        json!({"type":"update","entity":"project","action":"created","id":new_id})
    );
    assert_eq!(
        int(
            &c.e.pool,
            &format!(
                r#"SELECT COUNT(*) FROM "AuditLog" WHERE "action" = 'project.create' AND "projectId" = '{new_id}'"#
            )
        )
        .await,
        1
    );
    let r = c.req("POST", LEGACY, Some(json!({"name": ""}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": {"formErrors": [], "fieldErrors": {
            "name": ["Too small: expected string to have >=1 characters"]
        }}})
    );
}

#[tokio::test]
async fn consultation_role_cannot_write() {
    let c = ctx().await;
    let id = c.create("Tournage").await;
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    add_user(&c.e.pool, "chef@b.fr", "chef-projet", false).await;
    let ro = login(&c.e.app, "c@b.fr").await;
    let chef = login(&c.e.app, "chef@b.fr").await;
    let one = format!("{LIST}/{id}");
    let body = json!({"name": "Nouveau", "interventionType": "PRESTATION"});

    for (method, path, b) in [
        ("POST", LIST, Some(body.clone())),
        ("PATCH", one.as_str(), Some(json!({"status": "PRET"}))),
        ("DELETE", one.as_str(), None),
        ("POST", LEGACY, Some(json!({"name": "X"}))),
    ] {
        let r = call(&c.e.app, method, path, LOCAL, Some(&ro), b).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{method} {path}");
        assert_eq!(r.body, json!({"error": "Accès refusé"}));
    }
    for path in [LIST, one.as_str(), LEGACY] {
        let r = call(&c.e.app, "GET", path, LOCAL, Some(&ro), None).await;
        assert_eq!(r.status, StatusCode::OK, "GET {path}");
    }

    // projects:write may create and edit, deleting needs projects:admin
    let r = call(&c.e.app, "POST", LIST, LOCAL, Some(&chef), Some(body)).await;
    assert_eq!(r.status, StatusCode::CREATED);
    let r = call(
        &c.e.app,
        "PATCH",
        &one,
        LOCAL,
        Some(&chef),
        Some(json!({"status": "PRET"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let r = call(&c.e.app, "DELETE", &one, LOCAL, Some(&chef), None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(int(&c.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await, 2);
}
