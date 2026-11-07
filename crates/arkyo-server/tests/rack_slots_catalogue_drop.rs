//! Interface Strata, lot 3 (bibliothèque glissable) : un équipement du
//! catalogue déposé sur un U libre passe par le même `POST
//! /api/racks/:id/slots` que le canvas d'arkyo. Absent de la nomenclature du
//! rack, il doit y créer sa ligne (spec interface Strata, §9).
mod common;

use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};

const LIST: &str = "/api/tenant/projects";
const NOW: &str = "2026-11-07T10:00:00.000Z";

async fn send(e: &Env, tok: &str, method: &str, uri: &str, body: Option<Value>) -> Reply {
    call(&e.app, method, uri, LOCAL, Some(tok), body).await
}

#[tokio::test]
async fn drop_catalogue_equipment_not_in_bom_creates_bom_line() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;

    let r = send(
        &e,
        &tok,
        "POST",
        LIST,
        Some(json!({"name": "Match", "interventionType": "PRESTATION"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let project = r.body["id"].as_str().unwrap().to_string();
    let r = send(
        &e,
        &tok,
        "POST",
        &format!("{LIST}/{project}/locations"),
        Some(json!({"name": "Plateau"})),
    )
    .await;
    let loc = r.body["id"].as_str().unwrap().to_string();
    let r = send(
        &e,
        &tok,
        "POST",
        &format!("{LIST}/{project}/racks"),
        Some(json!({"racks": [{"name": "Baie A", "locationId": loc}]})),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let rack = r.body["racks"][0]["id"].as_str().unwrap().to_string();

    // Deux équipements du catalogue, aucun dans la nomenclature du rack.
    for sql in [
        r#"INSERT INTO "TenantEquipment" ("id","name","heightU","widthFraction","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM 2 M/E',2,'FULL','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","heightU","createdById","createdAt","updatedAt")
           VALUES ('eq2','Routeur',1,'u',?,?)"#,
    ] {
        sqlx::query(sql)
            .bind(NOW)
            .bind(NOW)
            .execute(&e.pool)
            .await
            .unwrap();
    }
    let inventory = format!("{LIST}/{project}/racks/{rack}/inventory");
    let r = send(&e, &tok, "GET", &inventory, None).await;
    assert_eq!(r.body, json!({"items": []}));

    // Le corps exact envoyé par `placeEquipment` du canvas (clé héritée
    // `equipmentId`), puis la clé actuelle `catalogEquipmentId`.
    let slots = format!("/api/racks/{rack}/slots");
    let r = send(
        &e,
        &tok,
        "POST",
        &slots,
        Some(json!({
            "equipmentId": "eq1", "view": "FRONT", "startU": 12, "heightU": 2,
            "widthFraction": "FULL", "column": 0
        })),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["startU"], 12);
    let r = send(
        &e,
        &tok,
        "POST",
        &slots,
        Some(json!({"catalogEquipmentId": "eq2", "view": "FRONT", "startU": 20})),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);

    let r = send(&e, &tok, "GET", &inventory, None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let items = r.body["items"].as_array().unwrap();
    let line = |id: &str| {
        items
            .iter()
            .find(|i| i["refId"] == id)
            .unwrap_or_else(|| panic!("ligne de nomenclature {id} absente : {items:?}"))
            .clone()
    };
    assert_eq!(items.len(), 2, "{items:?}");
    assert_eq!(line("eq1")["quantity"], 1);
    assert_eq!(line("eq2")["quantity"], 1);
}
