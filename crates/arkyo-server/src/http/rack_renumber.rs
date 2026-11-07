//! Cable renumbering of a rack: arkyo:app/api/racks/[id]/renumber/route.ts
//! (`POST`, phase-4 inventory, annex A §1.18).
//!
//! The body is a Zod union, the first valid variant wins:
//! - `{clearOnly: true}`: every label of the rack is cleared, `{ok: true}`;
//! - `{clearIds: string[]}`: the labels of these connections (of this rack)
//!   are cleared, `{ok: true}`;
//! - `{manualLabels: [{id, label}] (1..500)}`: labels set as given; the
//!   response is these connections;
//! - `{orderedIds, sideMap?, onlyUnlabelled?, partial?, override?}`: the
//!   automatic numbering, in the client's order. The response is every
//!   connection of the rack.
//!
//! Automatic numbering, as arkyo:
//! - configuration = admin keys of `AppConfig` (`cable_pad`, `cable_sep1`,
//!   `cable_sep2`, legacy `cable_separator` / `cable_suffix_separator`,
//!   `cable_include_rack`, `cable_template`, `cable_template_enabled`) <
//!   `Rack.numberingOverride` (free JSON object) < body `override`;
//! - rack segment = `normZoneOrRack(cableCode, 5) ?? normZoneOrRack(name, 4)`;
//! - signal of a cable: the connector entry at the port index of its `from`
//!   slot, else of its `to` slot (`getConnectorInfo`: entries flattened by
//!   `quantity`). The slots of this rack are read, and (arkyo-server:
//!   correction d'un défaut d'arkyo) those of other racks referenced by
//!   its cables (cable of a location's virtual rack between two of its
//!   containers); adapters and components give nothing. Prefix and suffix: the signal type's
//!   (trimmed), else its function's, else `""`;
//! - direction digit: `3` when either end is `BIDI`, else `sideMap[id]`
//!   (`left` → `1`, default; `right` → `2`);
//! - one counter per `prefix:dirDigit`. `partial` seeds the counters from
//!   the labels outside `orderedIds`, `onlyUnlabelled` keeps the labelled
//!   cables and seeds from them (last digits of the label minus the first
//!   one, the direction). A label already held by any cable of the rack
//!   (including the renumbered ones themselves) or given in this pass is
//!   skipped (up to 10,000 tries);
//! - the zone of a slot (geometric lookup in arkyo) is not computed: arkyo
//!   passes it to `computeCableLabel`, which ignores it.
//!
//! Audit `rackConnection.clearLabels|manualNumber|renumber` / `Rack` /
//! rackId. Event: app `rackConnection updated`, id = rackId, `{rackId,
//! clientId}`; no rack-bus event (inventory §6). An empty `orderedIds`
//! answers `{ok: true}` with neither audit nor event.
//!
//! arkyo-server:
//! - mode fantôme SaaS retiré (`assertNotGhost`, 403 « Mode lecture seule ») ;
//! - garde serveur `design:write` (arkyo : session seule) ;
//! - catalogue local (`TenantSignalType`, `TenantFunction`,
//!   `TenantEquipment.connectors`) au lieu de `mainDb` : le catalogue perso
//!   compte (arkyo l'ignorait, inventaire §4.2) ;
//! - une transaction `BEGIN IMMEDIATE` par écriture, lectures et audit
//!   compris ;
//! - 400 « Corps de requête invalide » pour un corps illisible (arkyo :
//!   `req.json()`, 500) ; 404 « Rack not found » pour un rack inconnu dans
//!   tous les modes (arkyo : seulement en numérotation automatique) ; 404
//!   « Connexion introuvable » pour un `manualLabels` qui vise une
//!   connexion absente ou d'un autre rack (arkyo : P2025, 500), rien
//!   n'est écrit ;
//! - une entrée de connecteur qui n'est pas un objet compte comme `{}`, un
//!   `template` qui n'est pas une chaîne est ignoré (arkyo : exception).

#![allow(clippy::result_large_err)]

use std::collections::{BTreeMap, HashMap, HashSet};

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Map, Value};
use sqlx::SqliteConnection;

use super::parametres::{begin, db_error, failure, parse_body, row_map, Flat, Obj};
use super::rack_connections::CONN;
use super::{client_id, error, require, AppState, CurrentUser};
use crate::audit;
use crate::events::EventMeta;
use crate::numbering::cable_label::{js_max, js_min, string_to_number, to_number};
use crate::numbering::{compute_cable_label, CableLabelInput};
use crate::users::User;

pub fn router() -> Router<AppState> {
    Router::new().route("/racks/{id}/renumber", post(renumber))
}

const ENTITY: &str = "rackConnection";
const RACK_404: &str = "Rack not found";
const CONN_404: &str = "Connexion introuvable";

/// `ADMIN_CONFIG_KEYS` (route.ts:51-60; the project renumbering has the
/// same keys, connections/renumber/route.ts:38-47).
const ADMIN_CONFIG_KEYS: [&str; 8] = [
    "cable_pad",
    "cable_sep1",
    "cable_sep2",
    "cable_separator",
    "cable_suffix_separator",
    "cable_include_rack",
    "cable_template",
    "cable_template_enabled",
];

// ── body ────────────────────────────────────────────────────────────────────

enum Input {
    ClearOnly,
    ClearIds(Vec<String>),
    Manual(Vec<(String, String)>),
    Auto(Auto),
}

#[derive(Default)]
struct Auto {
    ordered_ids: Vec<String>,
    side_map: HashMap<String, String>,
    only_unlabelled: bool,
    partial: bool,
    override_: Map<String, Value>,
}

/// The issues of one variant of the union, and whether one of them aborts
/// (Zod 4: type errors abort, size checks continue).
#[derive(Default)]
struct Issues {
    aborted: bool,
    by_field: BTreeMap<String, Vec<String>>,
}

impl Issues {
    fn abort(&mut self) {
        self.aborted = true;
    }

    fn push(&mut self, field: &str, msg: String) {
        self.by_field.entry(field.into()).or_default().push(msg);
    }

    fn is_empty(&self) -> bool {
        !self.aborted && self.by_field.is_empty()
    }
}

fn as_strings(v: Option<&Value>) -> Option<Vec<String>> {
    v?.as_array()?
        .iter()
        .map(|x| x.as_str().map(str::to_string))
        .collect()
}

/// `z.boolean().optional()`: absent is fine, anything but a boolean aborts.
fn opt_bool(obj: &Obj, key: &str, issues: &mut Issues) -> Option<bool> {
    match obj.get(key) {
        None => None,
        Some(Value::Bool(b)) => Some(*b),
        Some(_) => {
            issues.abort();
            None
        }
    }
}

fn parse_manual(obj: &Obj) -> Result<Vec<(String, String)>, Issues> {
    let mut issues = Issues::default();
    let Some(Value::Array(items)) = obj.get("manualLabels") else {
        issues.abort();
        return Err(issues);
    };
    let mut out = Vec::with_capacity(items.len());
    for it in items {
        let (Some(Value::String(id)), Some(Value::String(label))) = (it.get("id"), it.get("label"))
        else {
            issues.abort();
            continue;
        };
        if id.is_empty() {
            issues.push(
                "manualLabels",
                "Too small: expected string to have >=1 characters".into(),
            );
        }
        out.push((id.clone(), label.clone()));
    }
    if items.is_empty() {
        issues.push(
            "manualLabels",
            "Too small: expected array to have >=1 items".into(),
        );
    }
    // Zod 4 reports « Invalid input » for 501 items: the check aborts.
    if items.len() > 500 {
        issues.abort();
    }
    if issues.is_empty() {
        Ok(out)
    } else {
        Err(issues)
    }
}

/// `overrideSchema` (route.ts:14-27), unknown keys stripped.
fn parse_override(v: &Value, issues: &mut Issues) -> Map<String, Value> {
    let Value::Object(o) = v else {
        issues.abort();
        return Map::new();
    };
    let mut out = Map::new();
    for key in [
        "includeRack",
        "pad",
        "sep1",
        "sep2",
        "template",
        "templateEnabled",
        "includeZone",
        "separator",
        "suffixSeparator",
    ] {
        let Some(value) = o.get(key) else { continue };
        match (key, value) {
            ("includeRack" | "templateEnabled" | "includeZone", Value::Bool(_)) => {}
            ("pad", Value::Number(n)) => {
                let f = n.as_f64().unwrap_or(f64::NAN);
                // `.int()`: a safe integer, else the issue aborts.
                if f.fract() != 0.0 || f.abs() > 9_007_199_254_740_991.0 {
                    issues.abort();
                    continue;
                }
                if f < 1.0 {
                    issues.push("override", "Too small: expected number to be >=1".into());
                }
                if f > 10.0 {
                    issues.push("override", "Too big: expected number to be <=10".into());
                }
            }
            ("sep1" | "sep2" | "template", Value::String(s)) => {
                let max = if key == "template" { 500 } else { 5 };
                // Zod counts UTF-16 code units.
                if s.encode_utf16().count() > max {
                    issues.push(
                        "override",
                        format!("Too big: expected string to have <={max} characters"),
                    );
                }
            }
            ("separator" | "suffixSeparator", Value::String(_)) => {}
            _ => {
                issues.abort();
                continue;
            }
        }
        out.insert(key.into(), value.clone());
    }
    out
}

fn parse_auto(obj: &Obj) -> Result<Auto, Issues> {
    let mut issues = Issues::default();
    let mut auto = Auto::default();
    match as_strings(obj.get("orderedIds")) {
        Some(ids) => auto.ordered_ids = ids,
        None => issues.abort(),
    }
    match obj.get("sideMap") {
        None => {}
        Some(Value::Object(m)) => {
            for (k, v) in m {
                match v.as_str() {
                    Some(s @ ("left" | "right")) => {
                        auto.side_map.insert(k.clone(), s.to_string());
                    }
                    _ => issues.abort(),
                }
            }
        }
        Some(_) => issues.abort(),
    }
    auto.only_unlabelled = opt_bool(obj, "onlyUnlabelled", &mut issues).unwrap_or(false);
    auto.partial = opt_bool(obj, "partial", &mut issues).unwrap_or(false);
    if let Some(v) = obj.get("override") {
        auto.override_ = parse_override(v, &mut issues);
    }
    if issues.is_empty() {
        Ok(auto)
    } else {
        Err(issues)
    }
}

/// `renumberSchema.safeParse(body)` (route.ts:29-47) with Zod 4's union
/// rules: the first variant that passes wins; otherwise, when exactly one
/// variant failed without aborting, its issues are reported (by first path
/// key, as `flatten()`), else a form error « Invalid input ».
fn parse_input(body: &Value) -> Result<Input, Flat> {
    let invalid = || (vec!["Invalid input".to_string()], BTreeMap::new());
    let Value::Object(obj) = body else {
        return Err(invalid());
    };
    if obj.get("clearOnly") == Some(&Value::Bool(true)) {
        return Ok(Input::ClearOnly);
    }
    if let Some(ids) = as_strings(obj.get("clearIds")) {
        return Ok(Input::ClearIds(ids));
    }
    let manual = parse_manual(obj);
    let manual = match manual {
        Ok(m) => return Ok(Input::Manual(m)),
        Err(i) => i,
    };
    let auto = match parse_auto(obj) {
        Ok(a) => return Ok(Input::Auto(a)),
        Err(i) => i,
    };
    // `clearOnly` and `clearIds` failed on their type: aborted.
    match (manual.aborted, auto.aborted) {
        (false, true) => Err((vec![], manual.by_field)),
        (true, false) => Err((vec![], auto.by_field)),
        _ => Err(invalid()),
    }
}

// ── handler ─────────────────────────────────────────────────────────────────

pub async fn renumber(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run(&st, &me, &rack, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run(
    st: &AppState,
    me: &User,
    rack: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let input = parse_input(&parse_body(&body)?).map_err(failure)?;
    if let Input::Auto(a) = &input {
        if a.ordered_ids.is_empty() {
            return Ok(Json(json!({ "ok": true })).into_response());
        }
    }

    let mut tx = begin(&st.pool).await?;
    let found: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT "name", "cableCode", "numberingOverride" FROM "Rack" WHERE "id" = ?"#,
    )
    .bind(rack)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?;
    let Some(rack_row) = found else {
        return Err(error(StatusCode::NOT_FOUND, RACK_404));
    };

    let (action, response) = match input {
        Input::ClearOnly => {
            sqlx::query(r#"UPDATE "RackConnection" SET "label" = NULL WHERE "rackId" = ?"#)
                .bind(rack)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            ("rackConnection.clearLabels", json!({ "ok": true }))
        }
        Input::ClearIds(ids) => {
            for id in &ids {
                sqlx::query(
                    r#"UPDATE "RackConnection" SET "label" = NULL WHERE "rackId" = ? AND "id" = ?"#,
                )
                .bind(rack)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            }
            ("rackConnection.clearLabels", json!({ "ok": true }))
        }
        Input::Manual(labels) => {
            for (id, label) in &labels {
                let done = sqlx::query(
                    r#"UPDATE "RackConnection" SET "label" = ? WHERE "id" = ? AND "rackId" = ?"#,
                )
                .bind(label)
                .bind(id)
                .bind(rack)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
                if done.rows_affected() == 0 {
                    return Err(error(StatusCode::NOT_FOUND, CONN_404));
                }
            }
            let ids: Vec<&str> = labels.iter().map(|(id, _)| id.as_str()).collect();
            let rows = connections(&mut tx, rack, Some(&ids)).await?;
            ("rackConnection.manualNumber", rows)
        }
        Input::Auto(auto) => {
            let updates = numbering(&mut tx, rack, &rack_row, &auto).await?;
            for (id, label) in &updates {
                sqlx::query(
                    r#"UPDATE "RackConnection" SET "label" = ? WHERE "id" = ? AND "rackId" = ?"#,
                )
                .bind(label)
                .bind(id)
                .bind(rack)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            }
            let rows = connections(&mut tx, rack, None).await?;
            ("rackConnection.renumber", rows)
        }
    };
    audit::log(&mut tx, &me.id, action, "Rack", rack, None, None, None)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    st.events.publish_meta(
        ENTITY,
        "updated",
        Some(rack),
        EventMeta {
            rack_id: Some(rack.to_string()),
            client_id: client,
            ..EventMeta::default()
        },
    );
    Ok(Json(response).into_response())
}

/// The rack's connections (or these ones), in creation order.
async fn connections(
    conn: &mut SqliteConnection,
    rack: &str,
    only: Option<&[&str]>,
) -> Result<Value, Response> {
    let filter = only.map_or(String::new(), |ids| {
        format!(r#" AND "id" IN ({})"#, vec!["?"; ids.len()].join(", "))
    });
    let sql = format!(
        r#"SELECT * FROM "RackConnection" WHERE "rackId" = ?{filter} ORDER BY "createdAt" ASC, rowid ASC"#
    );
    let mut q = sqlx::query(&sql).bind(rack);
    for id in only.unwrap_or_default() {
        q = q.bind(*id);
    }
    let rows = q.fetch_all(&mut *conn).await.map_err(db_error)?;
    Ok(Value::Array(
        rows.iter()
            .map(|r| Value::Object(row_map(r, &CONN)))
            .collect(),
    ))
}

// ── automatic numbering ─────────────────────────────────────────────────────

/// `normZoneOrRack` (route.ts:62-69, `normCode` of the project route):
/// uppercase, `[A-Z0-9]` only, at most `max` characters, `None` when empty.
pub(crate) fn norm_code(raw: Option<&str>, max: usize) -> Option<String> {
    let raw = raw.filter(|r| !r.is_empty())?;
    let s: String = raw
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        .take(max)
        .collect();
    (!s.is_empty()).then_some(s)
}

/// `{signalName, direction}` of a connector entry (`getConnectorInfo`).
#[derive(Default, Clone)]
pub(crate) struct PortInfo {
    pub(crate) signal: Option<Value>,
    pub(crate) direction: Option<String>,
}

/// `getConnectorInfo(connectors, portIndex)` (route.ts:285-303, identical
/// in the project route): the entries flattened by `quantity` (`?? 1`).
pub(crate) fn connector_info(connectors: Option<&Value>, port: i64) -> PortInfo {
    let Some(Value::Array(entries)) = connectors else {
        return PortInfo::default();
    };
    let port = port as f64;
    let mut flat = 0.0;
    for entry in entries {
        let qty = match entry.get("quantity") {
            None | Some(Value::Null) => 1.0,
            q => to_number(q),
        };
        if port < flat + qty {
            return PortInfo {
                signal: entry.get("signalName").filter(|v| !v.is_null()).cloned(),
                direction: entry
                    .get("direction")
                    .and_then(Value::as_str)
                    .map(str::to_uppercase),
            };
        }
        flat += qty;
    }
    PortInfo::default()
}

/// `conn.label.match(/(\d{1,10})(?:[^\d]*)?$/)` then
/// `parseInt(m[1].slice(1), 10)`: the last (up to 10) digits of the last
/// digit run, without the first one (the direction digit).
fn label_number(label: &str) -> Option<i64> {
    let bytes = label.as_bytes();
    let end = bytes.iter().rposition(u8::is_ascii_digit)? + 1;
    let start = bytes[..end]
        .iter()
        .rposition(|b| !b.is_ascii_digit())
        .map_or(0, |i| i + 1)
        .max(end.saturating_sub(10));
    label[start + 1..end].parse().ok()
}

/// The non-empty label of a cable (`if (conn.label)`).
fn labelled(c: &Conn) -> Option<&str> {
    c.label.as_deref().filter(|l| !l.is_empty())
}

/// `name`, `cablePrefix`, `cableSuffix` of a signal type, then those of
/// its function.
type SignalRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// `id`, `label`, `fromSlotId`, `toSlotId`, `fromConnectorIndex`,
/// `toConnectorIndex`.
type ConnRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<i64>,
);

struct Conn {
    id: String,
    label: Option<String>,
    from_slot: Option<String>,
    to_slot: Option<String>,
    from_port: Option<i64>,
    to_port: Option<i64>,
}

/// The labels to write, in order (route.ts:160-447).
async fn numbering(
    tx: &mut SqliteConnection,
    rack: &str,
    rack_row: &(String, Option<String>, Option<String>),
    auto: &Auto,
) -> Result<Vec<(String, String)>, Response> {
    let (name, cable_code, numbering_override) = rack_row;

    // ── configuration: body.override > rack.numberingOverride > admin ───────
    let mut config = admin_config(tx).await.map_err(db_error)?;
    apply_override(&mut config, numbering_override.as_deref());
    config.extend(auto.override_.clone());

    let rack_code = norm_code(cable_code.as_deref(), 5).or_else(|| norm_code(Some(name), 4));

    // ── catalogue: connectors of the rack's slots, signal types ─────────────
    // arkyo-server: correction d'un défaut d'arkyo — les slots d'un autre
    // rack visés par les câbles du rack (câble du rack virtuel d'un lieu
    // entre deux contenants) sont lus aussi : sinon ni signal ni préfixe.
    let slots: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT s."id", e."connectors" FROM "RackSlot" s
           LEFT JOIN "TenantEquipment" e ON e."id" = s."catalogEquipmentId"
           WHERE s."rackId" = ?
              OR s."id" IN (SELECT "fromSlotId" FROM "RackConnection" WHERE "rackId" = ?
                            UNION SELECT "toSlotId" FROM "RackConnection" WHERE "rackId" = ?)"#,
    )
    .bind(rack)
    .bind(rack)
    .bind(rack)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_error)?;
    let slot_connectors: HashMap<String, Value> = slots
        .into_iter()
        .filter_map(|(id, c)| Some((id, serde_json::from_str(&c?).ok()?)))
        .collect();
    let sig_map = signal_affixes(tx).await.map_err(db_error)?;

    // ── connections ─────────────────────────────────────────────────────────
    let rows: Vec<ConnRow> = sqlx::query_as(
        r#"SELECT "id", "label", "fromSlotId", "toSlotId", "fromConnectorIndex", "toConnectorIndex"
           FROM "RackConnection" WHERE "rackId" = ? ORDER BY "createdAt" ASC, rowid ASC"#,
    )
    .bind(rack)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_error)?;
    let conns: Vec<Conn> = rows
        .into_iter()
        .map(|(id, label, from_slot, to_slot, from_port, to_port)| Conn {
            id,
            label,
            from_slot,
            to_slot,
            from_port,
            to_port,
        })
        .collect();
    let by_id: HashMap<&str, &Conn> = conns.iter().map(|c| (c.id.as_str(), c)).collect();

    let info = |slot: &Option<String>, port: Option<i64>| -> PortInfo {
        match port {
            Some(p) => connector_info(slot.as_ref().and_then(|s| slot_connectors.get(s)), p),
            None => PortInfo::default(),
        }
    };
    // Prefix, suffix and counter key of a cable.
    let resolve = |c: &Conn| -> (String, String, &'static str) {
        let from = info(&c.from_slot, c.from_port);
        let to = info(&c.to_slot, c.to_port);
        let signal = from.signal.or(to.signal);
        let (prefix, suffix) = signal
            .as_ref()
            .and_then(Value::as_str)
            .filter(|n| !n.is_empty())
            .and_then(|n| sig_map.get(n))
            .cloned()
            .unwrap_or_default();
        let bidi =
            from.direction.as_deref() == Some("BIDI") || to.direction.as_deref() == Some("BIDI");
        let dir = if bidi {
            "3"
        } else if auto.side_map.get(&c.id).map_or("left", String::as_str) == "left" {
            "1"
        } else {
            "2"
        };
        (prefix, suffix, dir)
    };

    let mut counters: HashMap<String, i64> = HashMap::new();
    let seed = |counters: &mut HashMap<String, i64>, key: String, label: &str| {
        if let Some(n) = label_number(label) {
            let current = counters.entry(key).or_insert(0);
            if n > *current {
                *current = n;
            }
        }
    };

    // `partial`: counters from the labels outside the selection.
    if auto.partial {
        let ordered: HashSet<&str> = auto.ordered_ids.iter().map(String::as_str).collect();
        for c in &conns {
            let Some(label) = labelled(c) else { continue };
            if ordered.contains(c.id.as_str()) {
                continue;
            }
            let (prefix, _, dir) = resolve(c);
            seed(&mut counters, counter_key(&prefix, dir), label);
        }
    }

    let existing: HashSet<&str> = conns.iter().filter_map(labelled).collect();
    let mut given: HashSet<String> = HashSet::new();
    let mut done: HashSet<&str> = HashSet::new();
    let mut updates = Vec::new();

    for id in &auto.ordered_ids {
        let Some(c) = by_id.get(id.as_str()) else {
            continue;
        };
        if done.contains(id.as_str()) {
            continue;
        }
        let (prefix, suffix, dir) = resolve(c);
        let key = counter_key(&prefix, dir);

        // `onlyUnlabelled`: kept, its number advances the counter.
        if auto.only_unlabelled {
            if let Some(label) = labelled(c) {
                seed(&mut counters, key, label);
                continue;
            }
        }

        let mut num = counters.get(&key).copied().unwrap_or(0) + 1;
        let mut guard = 0;
        let label = loop {
            counters.insert(key.clone(), num);
            let label = compute_cable_label(&CableLabelInput {
                zone_code: None,
                rack_code: rack_code.as_deref(),
                signal_prefix: &prefix,
                signal_suffix: &suffix,
                dir_digit: dir,
                seq: num as f64,
                config: &config,
            });
            if existing.contains(label.as_str()) || given.contains(&label) {
                num += 1;
                guard += 1;
                if guard >= 10_000 {
                    break label;
                }
            } else {
                break label;
            }
        };
        given.insert(label.clone());
        updates.push((id.clone(), label));
        done.insert(id.as_str());
    }
    Ok(updates)
}

// ── shared with the project renumbering ─────────────────────────────────────

/// The admin numbering configuration (route.ts:189-201,
/// connections/renumber/route.ts:194-203): the `AppConfig` keys, with
/// arkyo's defaults.
pub(crate) async fn admin_config(
    conn: &mut SqliteConnection,
) -> Result<Map<String, Value>, sqlx::Error> {
    let marks = vec!["?"; ADMIN_CONFIG_KEYS.len()].join(", ");
    let sql = format!(r#"SELECT "key", "value" FROM "AppConfig" WHERE "key" IN ({marks})"#);
    let mut q = sqlx::query_as::<_, (String, String)>(&sql);
    for k in ADMIN_CONFIG_KEYS {
        q = q.bind(k);
    }
    let cfg: HashMap<String, String> = q.fetch_all(&mut *conn).await?.into_iter().collect();
    let get = |k: &str| cfg.get(k).map(String::as_str);
    let pad = js_max(
        3.0,
        js_min(10.0, get("cable_pad").map_or(5.0, string_to_number)),
    );
    let mut config = Map::new();
    // A NaN pad (non-numeric `cable_pad`) has no JSON form: the text "NaN"
    // reads back as NaN (`Number("NaN")`).
    config.insert(
        "pad".into(),
        if pad.is_nan() {
            json!("NaN")
        } else {
            json!(pad)
        },
    );
    config.insert(
        "sep1".into(),
        json!(get("cable_sep1").or(get("cable_separator")).unwrap_or("-")),
    );
    config.insert(
        "sep2".into(),
        json!(get("cable_sep2")
            .or(get("cable_suffix_separator"))
            .unwrap_or("")),
    );
    config.insert(
        "includeRack".into(),
        json!(get("cable_include_rack") != Some("false")),
    );
    config.insert(
        "template".into(),
        json!(get("cable_template").unwrap_or("")),
    );
    config.insert(
        "templateEnabled".into(),
        json!(get("cable_template_enabled") == Some("true")),
    );
    Ok(config)
}

/// `{...config, ...rack.numberingOverride}`: the rack's override (free
/// JSON), when it is an object.
pub(crate) fn apply_override(config: &mut Map<String, Value>, numbering_override: Option<&str>) {
    if let Some(Value::Object(o)) =
        numbering_override.and_then(|s| serde_json::from_str::<Value>(s).ok())
    {
        config.extend(o);
    }
}

/// Signal type name → (prefix, suffix): the signal's own (trimmed), else its
/// function's, else `""` (`resolvePrefixSuffix`).
pub(crate) async fn signal_affixes(
    conn: &mut SqliteConnection,
) -> Result<HashMap<String, (String, String)>, sqlx::Error> {
    let signals: Vec<SignalRow> = sqlx::query_as(
        r#"SELECT s."name", s."cablePrefix", s."cableSuffix", f."cablePrefix", f."cableSuffix"
               FROM "TenantSignalType" s
               LEFT JOIN "TenantFunction" f ON f."id" = s."functionId""#,
    )
    .fetch_all(&mut *conn)
    .await?;
    let pick = |own: &Option<String>, parent: &Option<String>| -> String {
        [own, parent]
            .into_iter()
            .flatten()
            .map(|s| crate::catalogue::import::js_trim(s))
            .find(|s| !s.is_empty())
            .unwrap_or_default()
            .to_string()
    };
    Ok(signals
        .iter()
        .map(|(n, p, s, fp, fs)| (n.clone(), (pick(p, fp), pick(s, fs))))
        .collect())
}

/// The counter key of a cable: `${prefix || "__nosig__"}:${dirDigit}`.
pub(crate) fn counter_key(prefix: &str, dir: &str) -> String {
    format!(
        "{}:{dir}",
        if prefix.is_empty() {
            "__nosig__"
        } else {
            prefix
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_numbers() {
        assert_eq!(label_number("RGA-S10001"), Some(1));
        assert_eq!(label_number("RGA-S10041-HD"), Some(41));
        assert_eq!(label_number("A12B345"), Some(45));
        assert_eq!(label_number("X-123456789012"), Some(456_789_012));
        assert_eq!(label_number("S7"), None);
        assert_eq!(label_number("ABC"), None);
    }

    #[test]
    fn codes() {
        assert_eq!(norm_code(Some("rg-a1-x"), 5).as_deref(), Some("RGA1X"));
        assert_eq!(norm_code(Some("Baie A"), 4).as_deref(), Some("BAIE"));
        assert_eq!(norm_code(Some("straße"), 5).as_deref(), Some("STRAS"));
        assert_eq!(norm_code(Some("--"), 5), None);
        assert_eq!(norm_code(Some(""), 5), None);
        assert_eq!(norm_code(None, 5), None);
    }

    #[test]
    fn connector_entries() {
        let c = json!([
            {"signalName": "A", "direction": "out", "quantity": 2},
            {"signalName": "B", "direction": "bidi"},
            {"quantity": 0, "signalName": "Z"},
            {"signalName": "C"}
        ]);
        let get = |p| {
            let i = connector_info(Some(&c), p);
            (i.signal, i.direction)
        };
        assert_eq!(get(1), (Some(json!("A")), Some("OUT".into())));
        assert_eq!(get(2), (Some(json!("B")), Some("BIDI".into())));
        assert_eq!(get(3), (Some(json!("C")), None));
        assert_eq!(get(4), (None, None));
        assert_eq!(connector_info(Some(&json!({})), 0).signal, None);
    }
}
