//! Phase 4c, Task 4: cable numbering. `compute_cable_label` against the
//! fixtures shared with Vitest (`tests/fixtures/cable-numbering.json`, read
//! by `web/src/lib/services/cable-numbering.test.ts` too), and
//! `POST /api/racks/:id/renumber` (arkyo:app/api/racks/[id]/renumber/route.ts).
mod common;
use std::net::SocketAddr;
use std::time::Duration;

use arkyo_server::events::RackSubscription;
use arkyo_server::numbering::{compute_cable_label, CableLabelInput};
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
const FIXTURES: &str = include_str!("fixtures/cable-numbering.json");

// ── computeCableLabel ──────────────────────────────────────────────────────

#[test]
fn labels_match_shared_fixtures() {
    let doc: Value = serde_json::from_str(FIXTURES).unwrap();
    let cases = doc["cases"].as_array().unwrap();
    assert!(cases.len() >= 17, "17 cas d'arkyo au moins");
    let mut failures = Vec::new();
    for case in cases {
        let input = &case["input"];
        let input = CableLabelInput {
            zone_code: input["zoneCode"].as_str(),
            rack_code: input["rackCode"].as_str(),
            signal_prefix: input["signalPrefix"].as_str().unwrap(),
            signal_suffix: input["signalSuffix"].as_str().unwrap(),
            dir_digit: input["dirDigit"].as_str().unwrap(),
            seq: input["seq"].as_f64().unwrap(),
            config: input["config"].as_object().unwrap(),
        };
        let got = compute_cable_label(&input);
        let expected = case["expected"].as_str().unwrap();
        if got != expected {
            failures.push(format!("{}: {got:?} au lieu de {expected:?}", case["name"]));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

// ── fixture ────────────────────────────────────────────────────────────────

struct Ctx {
    e: Env,
    tok: String,
    rack: String,
}

/// A project with racks « Baie A » (`rack`) and « Baie B ».
///
/// Catalogue: function `fv` (prefix `V`, suffix `HD`); signals `Z-SDI`
/// (prefix ` S `, trimmed), `Z-AES` (no prefix, blank suffix: both from `fv`), `Z-ETH`
/// (prefix `E`, no function). Equipment `e1`: ports 0-1 `Z-SDI` out, 2
/// `Z-AES` in, 3 `Z-ETH` bidi, 4 unknown signal.
///
/// Rack A: slots `s1`, `s2` (`e1`), adapter `a1`; connections, in creation
/// order, `c1` s1#0→s2#0 (SDI), `c2` s1#1→s2#1 (SDI), `c3` s1#2→s2#2 (AES),
/// `c4` s1#3→s2#3 (ETH, BIDI), `c5` s1#4→s2#4 (unknown signal), `c6` from
/// `a1` (adapter: no signal), `c7` from `sb`#0 (slot of rack B: not read,
/// as in arkyo) to `s2` without port.
async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let c0 = Ctx {
        e,
        tok,
        rack: String::new(),
    };
    let r = c0
        .send(
            "POST",
            LIST,
            Some(json!({"name": "Match", "interventionType": "PRESTATION"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let project = r.body["id"].as_str().unwrap().to_string();
    let r = c0
        .send(
            "POST",
            &format!("{LIST}/{project}/locations"),
            Some(json!({"name": "Plateau"})),
        )
        .await;
    let loc = r.body["id"].as_str().unwrap().to_string();
    let r = c0
        .send(
            "POST",
            &format!("{LIST}/{project}/racks"),
            Some(json!({"racks": [
                {"name": "Baie A", "locationId": loc},
                {"name": "Baie B", "locationId": loc}
            ]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let rack = r.body["racks"][0]["id"].as_str().unwrap().to_string();
    let other = r.body["racks"][1]["id"].as_str().unwrap().to_string();
    let c = Ctx { rack, ..c0 };

    let pool = &c.e.pool;
    exec(
        pool,
        r#"INSERT INTO "TenantFunction" ("id","key","label","cablePrefix","cableSuffix","createdAt","updatedAt")
           VALUES ('fv','ZZ_VIDEO','Vidéo test','V','HD',?,?)"#,
    )
    .await;
    exec(
        pool,
        r#"INSERT INTO "TenantSignalType" ("id","name","functionId","cablePrefix","cableSuffix","createdAt","updatedAt") VALUES
           ('g1','Z-SDI',NULL,' S ',NULL,?,?),
           ('g2','Z-AES','fv',NULL,'  ',?,?),
           ('g3','Z-ETH',NULL,'E',NULL,?,?)"#,
    )
    .await;
    let connectors = json!([
        {"signalName": "Z-SDI", "direction": "out", "quantity": 2},
        {"signalName": "Z-AES", "direction": "in"},
        {"signalName": "Z-ETH", "direction": "bidi", "quantity": 1},
        {"signalName": "Inconnu", "direction": "out"}
    ]);
    sqlx::query(
        r#"INSERT INTO "TenantEquipment" ("id","name","connectors","createdById","createdAt","updatedAt")
           VALUES ('e1','Grille',?,'u',?,?)"#,
    )
    .bind(connectors.to_string())
    .bind(NOW)
    .bind(NOW)
    .execute(pool)
    .await
    .unwrap();
    for (id, rack) in [("s1", &c.rack), ("s2", &c.rack), ("sb", &other)] {
        exec(
            pool,
            &format!(
                r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('{id}','{rack}','e1',?,?)"#
            ),
        )
        .await;
    }
    exec(
        pool,
        &format!(
            r#"INSERT INTO "SynopticAdapter" ("id","rackId","x","y","createdAt","updatedAt") VALUES ('a1','{}',0,0,?,?)"#,
            c.rack
        ),
    )
    .await;
    for (n, from, from_port, to, to_port) in [
        (1, "'s1'", "0", "'s2'", "0"),
        (2, "'s1'", "1", "'s2'", "1"),
        (3, "'s1'", "2", "'s2'", "2"),
        (4, "'s1'", "3", "'s2'", "3"),
        (5, "'s1'", "4", "'s2'", "4"),
        (6, "NULL", "NULL", "'s2'", "NULL"),
        (7, "'sb'", "0", "'s2'", "NULL"),
    ] {
        let adapter = if n == 6 { "'a1'" } else { "NULL" };
        exec(
            pool,
            &format!(
                r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","fromAdapterId","toSlotId","toConnectorIndex","createdAt")
                   VALUES ('c{n}','{}',{from},{from_port},{adapter},{to},{to_port},'2026-11-07T10:00:0{n}.000Z')"#,
                c.rack
            ),
        )
        .await;
    }
    c
}

impl Ctx {
    async fn send(&self, method: &str, uri: &str, body: Option<Value>) -> Reply {
        send_as(&self.e, Some(&self.tok), method, uri, body).await
    }

    fn url(&self) -> String {
        format!("/api/racks/{}/renumber", self.rack)
    }

    async fn renumber(&self, body: Value) -> Value {
        let r = self.send("POST", &self.url(), Some(body.clone())).await;
        assert_eq!(r.status, StatusCode::OK, "{body} → {:?}", r.body);
        r.body
    }

    /// `id → label` of the rack's connections, in creation order.
    async fn labels(&self) -> Vec<(String, Option<String>)> {
        sqlx::query_as(
            r#"SELECT "id", "label" FROM "RackConnection" WHERE "rackId" = ? ORDER BY "createdAt", rowid"#,
        )
        .bind(&self.rack)
        .fetch_all(&self.e.pool)
        .await
        .unwrap()
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

async fn set_config(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES (?,?,?,?)
           ON CONFLICT("key") DO UPDATE SET "value" = excluded."value""#,
    )
    .bind(format!("cfg-{key}"))
    .bind(key)
    .bind(value)
    .bind(NOW)
    .execute(pool)
    .await
    .unwrap();
}

async fn next_app(rx: &mut Receiver<String>) -> Value {
    let s = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("évènement app attendu")
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

fn no_app_event(rx: &mut Receiver<String>) {
    assert!(
        matches!(rx.try_recv(), Err(TryRecvError::Empty)),
        "aucun évènement app attendu"
    );
}

async fn no_rack_event(rx: &mut RackSubscription) {
    assert!(
        tokio::time::timeout(Duration::from_millis(50), rx.recv())
            .await
            .is_err(),
        "aucun évènement rack attendu"
    );
}

/// arkyo's only event: app `rackConnection updated`, id = rackId.
fn renumber_event(rack: &str) -> Value {
    json!({"type": "update", "entity": "rackConnection", "action": "updated", "id": rack,
           "rackId": rack, "clientId": CLIENT})
}

async fn last_audit(pool: &SqlitePool) -> (String, String, String, Option<String>) {
    sqlx::query_as(
        r#"SELECT "action", "entityType", "entityId", "after" FROM "AuditLog" ORDER BY rowid DESC LIMIT 1"#,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

fn all_ids() -> Value {
    json!(["c1", "c2", "c3", "c4", "c5", "c6", "c7"])
}

fn pairs(list: &[(&str, &str)]) -> Vec<(String, Option<String>)> {
    list.iter()
        .map(|(id, l)| (id.to_string(), (!l.is_empty()).then(|| l.to_string())))
        .collect()
}

// ── renumber ───────────────────────────────────────────────────────────────

/// The renumbering of the synoptic (`onlyUnlabelled` on by default) keeps
/// the labels already set: a second run changes nothing, a new cable takes
/// the next free number.
#[tokio::test]
async fn renumber_is_stable_on_second_run() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);
    let body = json!({
        "orderedIds": all_ids(),
        "sideMap": {"c2": "right", "c4": "right"},
        "onlyUnlabelled": true,
    });

    // Defaults: pad 5, sep1 "-", sep2 "", rack segment from the name
    // (`cableCode` empty: 4 first alphanumerics of « Baie A »).
    let first = c.renumber(body.clone()).await;
    let expected = pairs(&[
        ("c1", "BAIE-S10001"),
        ("c2", "BAIE-S20001"),
        ("c3", "BAIE-V10001HD"),
        ("c4", "BAIE-E30001"),
        ("c5", "BAIE-10001"),
        ("c6", "BAIE-10002"),
        ("c7", "BAIE-10003"),
    ]);
    assert_eq!(c.labels().await, expected);
    // The response: every connection of the rack (row form of the GET).
    let listed = c
        .send("GET", &format!("/api/racks/{}/connections", c.rack), None)
        .await;
    assert_eq!(first, listed.body);
    assert_eq!(next_app(&mut app).await, renumber_event(&c.rack));
    no_rack_event(&mut rack).await;
    assert_eq!(
        last_audit(pool).await,
        (
            "rackConnection.renumber".into(),
            "Rack".into(),
            c.rack.clone(),
            None
        )
    );

    // Second run: nothing changes.
    let second = c.renumber(body.clone()).await;
    assert_eq!(c.labels().await, expected);
    assert_eq!(second, first);
    assert_eq!(next_app(&mut app).await, renumber_event(&c.rack));
    no_rack_event(&mut rack).await;

    // A new cable: the next number of its key, the others are kept.
    exec(
        pool,
        &format!(
            r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toSlotId","toConnectorIndex","createdAt")
               VALUES ('c8','{}','s2','0','s1','1','2026-11-07T10:00:08.000Z')"#,
            c.rack
        ),
    )
    .await;
    let mut ordered = all_ids();
    ordered.as_array_mut().unwrap().insert(0, json!("c8"));
    c.renumber(json!({"orderedIds": ordered, "onlyUnlabelled": true}))
        .await;
    let mut with_new = expected.clone();
    with_new.push(("c8".into(), Some("BAIE-S10002".into())));
    assert_eq!(c.labels().await, with_new);

    // Same labels on a third run, with the full order.
    c.renumber(json!({"orderedIds": ordered, "sideMap": {"c2": "right", "c4": "right"}, "onlyUnlabelled": true}))
        .await;
    assert_eq!(c.labels().await, with_new);
}

/// Parity: without `onlyUnlabelled`, the labels currently held by the
/// renumbered cables count as taken (`allExistingLabels`), so the numbers
/// move on (arkyo:renumber/route.ts:369-373, inventory annex A §1.18).
#[tokio::test]
async fn full_rerun_skips_labels_already_taken() {
    let c = ctx().await;
    let body = json!({"orderedIds": ["c1", "c2"]});
    c.renumber(body.clone()).await;
    assert_eq!(
        c.labels().await[..2],
        pairs(&[("c1", "BAIE-S10001"), ("c2", "BAIE-S10002")])
    );
    c.renumber(body).await;
    assert_eq!(
        c.labels().await[..2],
        pairs(&[("c1", "BAIE-S10003"), ("c2", "BAIE-S10004")])
    );
}

/// Configuration: admin keys < `Rack.numberingOverride` < body `override`;
/// rack segment from `cableCode` (5 characters), else from the name (4).
#[tokio::test]
async fn renumber_respects_override_and_cable_code() {
    let c = ctx().await;
    let pool = &c.e.pool;
    // Admin: pad 4, legacy `cable_separator` (no `cable_sep1`), sep2 "/".
    set_config(pool, "cable_pad", "4").await;
    set_config(pool, "cable_separator", ".").await;
    set_config(pool, "cable_sep2", "/").await;
    // Not read by the route (legacy name of the settings page).
    set_config(pool, "cable_numbering_pad", "9").await;
    let ids = json!(["c1", "c3"]);

    c.renumber(json!({"orderedIds": ids})).await;
    assert_eq!(
        c.labels().await[..3],
        pairs(&[("c1", "BAIE.S1001"), ("c2", ""), ("c3", "BAIE.V1001/HD")])
    );

    // `cableCode` normalised: uppercase, [A-Z0-9] only, 5 characters.
    // Rack override: sep2 "_" and pad 3; body override: pad 6.
    sqlx::query(
        r#"UPDATE "Rack" SET "cableCode" = 'rg-a1-x', "numberingOverride" = ? WHERE "id" = ?"#,
    )
    .bind(json!({"sep2": "_", "pad": 3}).to_string())
    .bind(&c.rack)
    .execute(pool)
    .await
    .unwrap();
    c.renumber(json!({"orderedIds": ids, "override": {"pad": 6}}))
        .await;
    assert_eq!(
        c.labels().await[..3],
        pairs(&[
            ("c1", "RGA1X.S100001"),
            ("c2", ""),
            ("c3", "RGA1X.V100001_HD")
        ])
    );

    // Rack override alone (pad 3), includeRack off by the body.
    c.renumber(json!({"orderedIds": ids, "override": {"includeRack": false}}))
        .await;
    assert_eq!(
        c.labels().await[..3],
        pairs(&[("c1", "S101"), ("c2", ""), ("c3", "V101_HD")])
    );

    // Admin template ({sep2} is written even without suffix); a `cableCode`
    // without alphanumerics falls back on the name. The rack override has no
    // template key: the admin one applies.
    set_config(pool, "cable_template_enabled", "true").await;
    set_config(
        pool,
        "cable_template",
        "{zone}{rack}:{prefix}{dir}-{seq}{sep2}{suffix}",
    )
    .await;
    sqlx::query(r#"UPDATE "Rack" SET "cableCode" = '--' WHERE "id" = ?"#)
        .bind(&c.rack)
        .execute(pool)
        .await
        .unwrap();
    c.renumber(json!({"orderedIds": ids, "sideMap": {"c3": "right"}}))
        .await;
    assert_eq!(
        c.labels().await[..3],
        pairs(&[("c1", "BAIE:S1-001_"), ("c2", ""), ("c3", "BAIE:V2-001_HD")])
    );

    // `cable_include_rack` = "false" and a non-numeric pad (NaN: no
    // padding); `templateEnabled` off by the body.
    set_config(pool, "cable_include_rack", "false").await;
    set_config(pool, "cable_pad", "abc").await;
    sqlx::query(r#"UPDATE "Rack" SET "numberingOverride" = NULL WHERE "id" = ?"#)
        .bind(&c.rack)
        .execute(pool)
        .await
        .unwrap();
    c.renumber(json!({"orderedIds": ids, "override": {"templateEnabled": false}}))
        .await;
    assert_eq!(
        c.labels().await[..3],
        pairs(&[("c1", "S11"), ("c2", ""), ("c3", "V11/HD")])
    );
}

/// `partial`: counters start after the labels outside the selection (the
/// last digits, minus the first one: the direction).
#[tokio::test]
async fn partial_seeds_counters_from_other_labels() {
    let c = ctx().await;
    c.renumber(json!({"manualLabels": [
        {"id": "c1", "label": "X-S10041-HD"},
        {"id": "c6", "label": "BAIE-10007"},
        {"id": "c5", "label": "BAIE-10002"}
    ]}))
    .await;
    c.renumber(json!({"orderedIds": ["c2", "c5", "c7"], "partial": true}))
        .await;
    assert_eq!(
        c.labels().await,
        pairs(&[
            ("c1", "X-S10041-HD"),
            ("c2", "BAIE-S10042"),
            ("c3", ""),
            ("c4", ""),
            ("c5", "BAIE-10008"),
            ("c6", "BAIE-10007"),
            ("c7", "BAIE-10009"),
        ])
    );
}

#[tokio::test]
async fn clear_and_manual_modes() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    // manualLabels: the updated connections only.
    let r = c
        .renumber(json!({"manualLabels": [
            {"id": "c2", "label": "B"},
            {"id": "c1", "label": "A"},
            {"id": "c3", "label": ""}
        ]}))
        .await;
    let got: Vec<&str> = r
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap())
        .collect();
    assert_eq!(got, ["c1", "c2", "c3"]);
    assert_eq!(r[0]["label"], "A");
    assert_eq!(r[2]["label"], "");
    assert_eq!(next_app(&mut app).await, renumber_event(&c.rack));
    assert_eq!(last_audit(pool).await.0, "rackConnection.manualNumber");

    // An unknown (or other rack's) id: 404, nothing written.
    let before = c.labels().await;
    let audits = int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await;
    let r = c
        .send(
            "POST",
            &c.url(),
            Some(
                json!({"manualLabels": [{"id": "c4", "label": "Z"}, {"id": "nope", "label": "Y"}]}),
            ),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::NOT_FOUND,
            json!({"error": "Connexion introuvable"})
        )
    );
    assert_eq!(c.labels().await, before);
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await,
        audits
    );
    no_app_event(&mut app);

    // clearIds: `{ok: true}`.
    let r = c.renumber(json!({"clearIds": ["c1", "nope"]})).await;
    assert_eq!(r, json!({"ok": true}));
    assert_eq!(c.labels().await[..2], pairs(&[("c1", ""), ("c2", "B")]));
    assert_eq!(next_app(&mut app).await, renumber_event(&c.rack));
    assert_eq!(last_audit(pool).await.0, "rackConnection.clearLabels");

    // clearOnly wins over the other keys (first variant of the union).
    let r = c
        .renumber(json!({"clearOnly": true, "orderedIds": ["c1"]}))
        .await;
    assert_eq!(r, json!({"ok": true}));
    assert!(c.labels().await.iter().all(|(_, l)| l.is_none()));
    assert_eq!(next_app(&mut app).await, renumber_event(&c.rack));
    assert_eq!(last_audit(pool).await.0, "rackConnection.clearLabels");
    no_rack_event(&mut rack).await;
}

#[tokio::test]
async fn validation_and_guards() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let mut app = c.e.events.subscribe();
    let audits = || int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#);
    let before = audits().await;

    // Zod union errors: no variant → « Invalid input » form error; a single
    // variant failing only on checks → its errors.
    let invalid = json!({"error": {"formErrors": ["Invalid input"], "fieldErrors": {}}});
    for (body, expected) in [
        (json!({}), invalid.clone()),
        (json!(null), invalid.clone()),
        (json!({"clearOnly": false}), invalid.clone()),
        (json!({"clearIds": [1]}), invalid.clone()),
        (
            json!({"orderedIds": ["c1"], "sideMap": {"c1": "up"}}),
            invalid.clone(),
        ),
        (
            json!({"orderedIds": ["c1"], "override": {"pad": 3.5}}),
            invalid.clone(),
        ),
        (
            json!({"orderedIds": ["c1"], "override": null}),
            invalid.clone(),
        ),
        (
            json!({"manualLabels": []}),
            json!({"error": {"formErrors": [], "fieldErrors": {
                "manualLabels": ["Too small: expected array to have >=1 items"]}}}),
        ),
        (
            json!({"manualLabels": [{"id": "", "label": "a"}]}),
            json!({"error": {"formErrors": [], "fieldErrors": {
                "manualLabels": ["Too small: expected string to have >=1 characters"]}}}),
        ),
        (
            json!({"orderedIds": ["c1"], "override": {"pad": 11, "sep1": "abcdef"}}),
            json!({"error": {"formErrors": [], "fieldErrors": {"override": [
                "Too big: expected number to be <=10",
                "Too big: expected string to have <=5 characters"]}}}),
        ),
    ] {
        let r = c.send("POST", &c.url(), Some(body.clone())).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::BAD_REQUEST, expected),
            "{body}"
        );
    }
    assert!(c.labels().await.iter().all(|(_, l)| l.is_none()));

    // Empty `orderedIds`: `{ok: true}` before any read (unknown rack too),
    // no audit, no event.
    for rack in [c.rack.as_str(), "nope"] {
        let r = c
            .send(
                "POST",
                &format!("/api/racks/{rack}/renumber"),
                Some(json!({"orderedIds": [], "override": {"extra": 1}})),
            )
            .await;
        assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    }
    assert_eq!(audits().await, before);
    no_app_event(&mut app);

    // Unknown rack: arkyo's 404.
    for body in [
        json!({"orderedIds": ["c1"]}),
        json!({"clearOnly": true}),
        json!({"clearIds": ["c1"]}),
        json!({"manualLabels": [{"id": "c1", "label": "A"}]}),
    ] {
        let r = c
            .send("POST", "/api/racks/nope/renumber", Some(body.clone()))
            .await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": "Rack not found"})),
            "{body}"
        );
    }

    // design:write; no session: 401.
    add_user(pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let body = json!({"orderedIds": ["c1"]});
    let r = send_as(&c.e, Some(&ct), "POST", &c.url(), Some(body.clone())).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"}))
    );
    let r = send_as(&c.e, None, "POST", &c.url(), Some(body)).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert!(c.labels().await.iter().all(|(_, l)| l.is_none()));
    assert_eq!(audits().await, before);
    no_app_event(&mut app);
}
