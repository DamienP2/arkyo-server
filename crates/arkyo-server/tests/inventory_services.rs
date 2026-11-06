//! Phase 4a, Task 3: inventory services (arkyo:lib/services/rack-inventory.ts
//! `validateInventoryRef`, rack-inventory-sync.ts, auto-label.ts,
//! rack-inventory-api.ts, catalog-merge.ts, catalog-enrich.ts
//! `fetchCatalogAdapterMap`).

use std::collections::HashSet;

use arkyo_server::catalogue::enrich::fetch_catalog_adapter_map;
use arkyo_server::db::begin_immediate;
use arkyo_server::inventory::api::{self, BomMode};
use arkyo_server::inventory::auto_label::generate_unique_label;
use arkyo_server::inventory::catalog;
use arkyo_server::inventory::sync::{self, GhostRef};
use arkyo_server::inventory::validate::{
    parse_inventory_ref, validate_inventory_ref, InventoryRef, RefError, RefInput,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;

const NOW: &str = "2026-11-06T10:00:00.000Z";

// ── validateInventoryRef : les 24 cas de tests/unit/rack-inventory.test.ts ──

fn input() -> RefInput {
    RefInput::default()
}

fn s(v: &str) -> Option<String> {
    Some(v.to_string())
}

fn err(i: &RefInput) -> String {
    match parse_inventory_ref(i) {
        Err(RefError::Invalid(m)) => m.to_string(),
        other => panic!("attendu une erreur de validation, obtenu {other:?}"),
    }
}

fn ok(i: &RefInput) -> InventoryRef {
    parse_inventory_ref(i).unwrap_or_else(|e| panic!("{e:?}"))
}

const MISSING: &str = "Référence catalogue manquante";
const SEVERAL: &str = "Plusieurs références catalogue fournies — exactement une attendue";
const INCOMPLETE: &str = "Accessoire incomplet : type et hauteur U requis";
const VARIANT: &str = "Variant requis pour les plaques";
const BAD_TYPE: &str = "Type d'accessoire invalide : attendu plaque, etagere ou tiroir";
const BAD_HEIGHT: &str = "Hauteur U d'accessoire invalide : attendu 1, 2, 3 ou 4";

fn accessory(t: &str, h: i64, variant: Option<&str>, depth: Option<i64>) -> InventoryRef {
    InventoryRef::Accessory {
        accessory_type: t.to_string(),
        height_u: h,
        variant: variant.map(str::to_string),
        depth_mm: depth,
    }
}

#[test]
fn ref_01_equipment_only() {
    let i = RefInput {
        equipment_id: s("eq-42"),
        ..input()
    };
    assert_eq!(ok(&i), InventoryRef::Equipment("eq-42".into()));
}

#[test]
fn ref_02_panel_only() {
    let i = RefInput {
        panel_id: s("panel-42"),
        ..input()
    };
    assert_eq!(ok(&i), InventoryRef::Panel("panel-42".into()));
}

#[test]
fn ref_03_adapter_only() {
    let i = RefInput {
        adapter_id: s("adapter-42"),
        ..input()
    };
    assert_eq!(ok(&i), InventoryRef::Adapter("adapter-42".into()));
}

#[test]
fn ref_04_empty_body_is_missing() {
    assert_eq!(err(&input()), MISSING);
}

#[test]
fn ref_05_all_null_is_missing() {
    let i = RefInput {
        equipment_id: None,
        panel_id: None,
        adapter_id: None,
        ..input()
    };
    assert_eq!(err(&i), MISSING);
}

#[test]
fn ref_06_empty_string_is_missing() {
    let i = RefInput {
        equipment_id: s(""),
        ..input()
    };
    assert_eq!(err(&i), MISSING);
}

#[test]
fn ref_07_equipment_and_panel() {
    let i = RefInput {
        equipment_id: s("eq-1"),
        panel_id: s("panel-1"),
        ..input()
    };
    assert_eq!(err(&i), SEVERAL);
}

#[test]
fn ref_08_equipment_and_adapter() {
    let i = RefInput {
        equipment_id: s("eq-1"),
        adapter_id: s("adapter-1"),
        ..input()
    };
    assert_eq!(err(&i), SEVERAL);
}

#[test]
fn ref_09_three_refs() {
    let i = RefInput {
        equipment_id: s("eq-1"),
        panel_id: s("panel-1"),
        adapter_id: s("adapter-1"),
        ..input()
    };
    assert_eq!(err(&i), SEVERAL);
}

#[test]
fn ref_10_mixed_nulls_single_value() {
    let i = RefInput {
        panel_id: s("panel-only"),
        ..input()
    };
    assert_eq!(ok(&i), InventoryRef::Panel("panel-only".into()));
    let i = RefInput {
        adapter_id: s("adapter-only"),
        ..input()
    };
    assert_eq!(ok(&i), InventoryRef::Adapter("adapter-only".into()));
    let i = RefInput {
        equipment_id: s("eq-only"),
        ..input()
    };
    assert_eq!(ok(&i), InventoryRef::Equipment("eq-only".into()));
}

#[test]
fn ref_11_empty_strings_ignored_next_to_a_valid_ref() {
    let i = RefInput {
        equipment_id: s(""),
        panel_id: s("panel-real"),
        adapter_id: s(""),
        ..input()
    };
    assert_eq!(ok(&i), InventoryRef::Panel("panel-real".into()));
}

#[test]
fn ref_12_plaque_2u_plein() {
    let i = RefInput {
        accessory_type: s("plaque"),
        accessory_height_u: Some(2),
        accessory_variant: s("plein"),
        ..input()
    };
    assert_eq!(ok(&i), accessory("plaque", 2, Some("plein"), None));
}

#[test]
fn ref_13_type_alone_is_incomplete() {
    let i = RefInput {
        accessory_type: s("plaque"),
        ..input()
    };
    assert_eq!(err(&i), INCOMPLETE);
}

#[test]
fn ref_14_height_alone_is_incomplete() {
    let i = RefInput {
        accessory_height_u: Some(2),
        ..input()
    };
    assert_eq!(err(&i), INCOMPLETE);
}

#[test]
fn ref_15_plaque_without_variant() {
    let i = RefInput {
        accessory_type: s("plaque"),
        accessory_height_u: Some(2),
        ..input()
    };
    assert_eq!(err(&i), VARIANT);
}

#[test]
fn ref_16_plaque_with_invalid_variant() {
    let i = RefInput {
        accessory_type: s("plaque"),
        accessory_height_u: Some(2),
        accessory_variant: s("n-importe-quoi"),
        ..input()
    };
    assert_eq!(err(&i), VARIANT);
}

#[test]
fn ref_17_etagere_with_depth_has_no_variant() {
    let i = RefInput {
        accessory_type: s("etagere"),
        accessory_height_u: Some(2),
        accessory_depth_mm: Some(450),
        ..input()
    };
    assert_eq!(ok(&i), accessory("etagere", 2, None, Some(450)));
}

#[test]
fn ref_18_tiroir_variant_is_dropped() {
    let i = RefInput {
        accessory_type: s("tiroir"),
        accessory_height_u: Some(1),
        accessory_depth_mm: Some(300),
        accessory_variant: s("plein"),
        ..input()
    };
    assert_eq!(ok(&i), accessory("tiroir", 1, None, Some(300)));
}

#[test]
fn ref_19_invalid_accessory_type() {
    let i = RefInput {
        accessory_type: s("invalide"),
        accessory_height_u: Some(2),
        ..input()
    };
    assert_eq!(err(&i), BAD_TYPE);
}

#[test]
fn ref_20_height_5_is_accepted() {
    let i = RefInput {
        accessory_type: s("etagere"),
        accessory_height_u: Some(5),
        accessory_depth_mm: Some(300),
        ..input()
    };
    assert_eq!(ok(&i), accessory("etagere", 5, None, Some(300)));
}

#[test]
fn ref_21_height_9_is_rejected() {
    let i = RefInput {
        accessory_type: s("etagere"),
        accessory_height_u: Some(9),
        accessory_depth_mm: Some(300),
        ..input()
    };
    assert_eq!(err(&i), BAD_HEIGHT);
}

#[test]
fn ref_22_height_0_is_rejected() {
    let i = RefInput {
        accessory_type: s("etagere"),
        accessory_height_u: Some(0),
        ..input()
    };
    assert_eq!(err(&i), BAD_HEIGHT);
}

#[test]
fn ref_23_equipment_and_full_accessory() {
    let i = RefInput {
        equipment_id: s("eq-1"),
        accessory_type: s("plaque"),
        accessory_height_u: Some(2),
        accessory_variant: s("plein"),
        ..input()
    };
    assert_eq!(err(&i), SEVERAL);
}

#[test]
fn ref_24_panel_and_full_accessory() {
    let i = RefInput {
        panel_id: s("p-1"),
        accessory_type: s("tiroir"),
        accessory_height_u: Some(1),
        accessory_depth_mm: Some(300),
        ..input()
    };
    assert_eq!(err(&i), SEVERAL);
}

/// The two depth messages, not covered by arkyo's Vitest cases.
#[test]
fn ref_depth_messages() {
    let i = RefInput {
        accessory_type: s("tiroir"),
        accessory_height_u: Some(1),
        ..input()
    };
    assert_eq!(err(&i), "Profondeur requise pour les étagères et tiroirs");
    let i = RefInput {
        accessory_depth_mm: Some(0),
        ..i
    };
    assert_eq!(err(&i), "Profondeur invalide : valeur en mm > 0 attendue");
}

// ── fixtures ────────────────────────────────────────────────────────────────

struct Db {
    _dir: tempfile::TempDir,
    pool: SqlitePool,
}

async fn db() -> Db {
    let dir = tempfile::tempdir().unwrap();
    let pool = arkyo_server::db::open(dir.path()).await.unwrap();
    Db { _dir: dir, pool }
}

/// Runs `sql`, binding `NOW` to every `?`.
async fn exec(pool: &SqlitePool, sql: &str) {
    let mut q = sqlx::query(sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

/// A rack `r1`, a brand, a category, two functions, two equipments (`eq1`
/// active, `eq-off` inactive), two adapters (`ad1` active, `ad-off`
/// inactive), a host `host-eq` (4 slots) and a component `comp-eq` (span 2),
/// a panel `pa1`.
async fn catalogue_fixture(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('r1','Baie A',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('r2','Baie B',?,?)"#,
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Blackmagic',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","createdAt","updatedAt") VALUES ('cat1','Régie','#112233',?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f-audio','t_audio','Audio','#00aa00',2,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f-video','t_video','Vidéo','#0000aa',1,?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","reference","brandId","categoryId","heightU","depthMm","widthFraction","weight","powerW","imageUrl","functionIds","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM 2 M/E','SWATEMPSW2ME','b1','cat1',2,400,'HALF',4.5,150,'/uploads/atem.png','["f-audio","f-video","f-gone"]','u','2026-11-06T10:00:01.000Z','2026-11-06T10:00:01.000Z')"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","categoryId","isActive","createdById","createdAt","updatedAt") VALUES ('eq-off','Vieux mixeur','cat1',0,'u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isComponentHost","hostSlotCount","isRackable","createdById","createdAt","updatedAt") VALUES ('host-eq','Châssis',1,4,1,'u','2026-11-06T10:00:02.000Z','2026-11-06T10:00:02.000Z')"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isComponent","componentSlotSpan","isRackable","is2110","createdById","createdAt","updatedAt") VALUES ('comp-eq','Carte',1,2,0,1,'u','2026-11-06T10:00:03.000Z','2026-11-06T10:00:03.000Z')"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","reference","functionId","inputs","outputs","notes","imageUrl","createdById","createdAt","updatedAt")
           VALUES ('ad1','XLR F → Jack','AD-1','f-audio','[{"connectorTypeId":"ct1"}]','[]','Note','/uploads/ad.png','u','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","isActive","createdById","createdAt","updatedAt") VALUES ('ad-off','Vieil adaptateur',0,'u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","createdById","createdAt","updatedAt") VALUES ('pa1','Patch 24 XLR','PATCH',1,'u',?,?)"#,
    ] {
        exec(pool, sql).await;
    }
}

async fn insert_item(pool: &SqlitePool, id: &str, rack: &str, col: &str, ref_id: &str, qty: i64) {
    sqlx::query(&format!(
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","{col}","quantity","createdAt","updatedAt") VALUES (?,?,?,?,?,?)"#
    ))
    .bind(id)
    .bind(rack)
    .bind(ref_id)
    .bind(qty)
    .bind(NOW)
    .bind(NOW)
    .execute(pool)
    .await
    .unwrap();
}

async fn set_quantity(pool: &SqlitePool, item: &str, qty: i64) {
    sqlx::query(r#"UPDATE "RackInventoryItem" SET "quantity" = ? WHERE "id" = ?"#)
        .bind(qty)
        .bind(item)
        .execute(pool)
        .await
        .unwrap();
}

/// `(id, startU, label)` of the slots of `item`, oldest first.
async fn slots_of(pool: &SqlitePool, item: &str) -> Vec<(String, Option<i64>, Option<String>)> {
    sqlx::query_as(
        r#"SELECT "id", "startU", "label" FROM "RackSlot" WHERE "inventoryItemId" = ? ORDER BY "createdAt", rowid"#,
    )
    .bind(item)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn sync_item(pool: &SqlitePool, item: &str) -> sync::SyncResult {
    let mut tx = begin_immediate(pool).await.unwrap();
    let r = sync::sync_inventory_slots(&mut tx, item).await.unwrap();
    tx.commit().await.unwrap();
    r
}

fn is_auto_label(l: &str) -> bool {
    const CHARS: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    l.len() == 5 && l.starts_with('#') && l[1..].chars().all(|c| CHARS.contains(c))
}

// ── validate_inventory_ref : existence (actif ou non) ───────────────────────

#[tokio::test]
async fn catalog_refs_must_exist_active_or_not() {
    let d = db().await;
    catalogue_fixture(&d.pool).await;
    let mut conn = d.pool.acquire().await.unwrap();

    for good in [
        InventoryRef::Equipment("eq1".into()),
        InventoryRef::Panel("pa1".into()),
        InventoryRef::Adapter("ad1".into()),
        // An inactive catalogue item is accepted, as in arkyo.
        InventoryRef::Equipment("eq-off".into()),
        InventoryRef::Adapter("ad-off".into()),
        accessory("plaque", 1, Some("aere"), None),
    ] {
        validate_inventory_ref(&mut conn, &good)
            .await
            .unwrap_or_else(|e| panic!("{good:?}: {e:?}"));
    }
    for (bad, status, msg) in [
        (
            InventoryRef::Equipment("nope".into()),
            404,
            "Référence catalogue introuvable après création.",
        ),
        (
            InventoryRef::Adapter("nope".into()),
            404,
            "Référence catalogue introuvable après création.",
        ),
        (
            InventoryRef::Panel("nope".into()),
            404,
            "Référence catalogue introuvable après création.",
        ),
    ] {
        let e = validate_inventory_ref(&mut conn, &bad).await.unwrap_err();
        assert_eq!(e.status().as_u16(), status, "{bad:?}");
        assert_eq!(e.message(), msg, "{bad:?}");
    }
    // The parse errors are 400 with arkyo's message.
    let e = parse_inventory_ref(&input()).unwrap_err();
    assert_eq!((e.status().as_u16(), e.message()), (400, MISSING));
}

// ── slots fantômes ──────────────────────────────────────────────────────────

#[tokio::test]
async fn ghost_slots_follow_inventory() {
    let d = db().await;
    let pool = &d.pool;
    catalogue_fixture(pool).await;
    insert_item(pool, "it-eq", "r1", "catalogEquipmentId", "eq1", 3).await;

    // Growth: three ghosts, unplaced, with arkyo's defaults and a #XXXX label.
    let r = sync_item(pool, "it-eq").await;
    assert_eq!((r.created.len(), r.deleted.len()), (3, 0));
    assert!(r.warnings.is_empty());
    let (view, width, column, eq, panel, height): (String, String, i64, Option<String>, Option<String>, Option<f64>) =
        sqlx::query_as(
            r#"SELECT "view","widthFraction","column","catalogEquipmentId","panelId","heightU" FROM "RackSlot" WHERE "id" = ?"#,
        )
        .bind(&r.created[0])
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(
        (
            view.as_str(),
            width.as_str(),
            column,
            eq.as_deref(),
            panel,
            height
        ),
        ("FRONT", "FULL", 0, Some("eq1"), None, None)
    );
    let slots = slots_of(pool, "it-eq").await;
    assert_eq!(slots.len(), 3);
    let labels: HashSet<String> = slots.iter().map(|s| s.2.clone().unwrap()).collect();
    assert_eq!(labels.len(), 3);
    assert!(labels.iter().all(|l| is_auto_label(l)), "{labels:?}");

    // Already in step: nothing to do.
    let r = sync_item(pool, "it-eq").await;
    assert!(r.created.is_empty() && r.deleted.is_empty());

    // Shrink: priority ghost without connection, ghost with connection,
    // placed without connection, placed with connection.
    let (a, b, c) = (slots[0].0.clone(), slots[1].0.clone(), slots[2].0.clone());
    sqlx::query(r#"UPDATE "RackSlot" SET "startU" = 10 WHERE "id" = ?"#)
        .bind(&a)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","toSlotId","createdAt") VALUES ('cx1','r1',?,?,?)"#,
    )
    .bind(&b)
    .bind(&a)
    .bind(NOW)
    .execute(pool)
    .await
    .unwrap();
    // a: placed + connection, b: ghost + connection, c: ghost alone.
    set_quantity(pool, "it-eq", 2).await;
    let r = sync_item(pool, "it-eq").await;
    assert_eq!(r.deleted, vec![c.clone()]);
    assert!(r.warnings.is_empty());

    set_quantity(pool, "it-eq", 1).await;
    let r = sync_item(pool, "it-eq").await;
    assert_eq!(r.deleted, vec![b.clone()]);
    assert_eq!(
        r.warnings,
        vec![format!("Slot {b} supprimé malgré 1 connexion(s).")]
    );
    // The connection went with the slot (ON DELETE CASCADE).
    let left: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "RackConnection""#)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(left, 0);

    set_quantity(pool, "it-eq", 0).await;
    let r = sync_item(pool, "it-eq").await;
    assert_eq!(r.deleted, vec![a.clone()]);
    assert_eq!(
        r.warnings,
        vec![format!("Slot placé {a} (U10) supprimé — quantité réduite.")]
    );
    assert!(slots_of(pool, "it-eq").await.is_empty());

    // Adapters, accessories and unknown items are left alone.
    insert_item(pool, "it-ad", "r1", "catalogAdapterId", "ad1", 2).await;
    let r = sync_item(pool, "it-ad").await;
    assert!(r.created.is_empty());
    let r = sync_item(pool, "missing").await;
    assert!(r.created.is_empty() && r.deleted.is_empty());

    // Panels get ghosts too.
    insert_item(pool, "it-pa", "r1", "panelId", "pa1", 2).await;
    let r = sync_item(pool, "it-pa").await;
    assert_eq!(r.created.len(), 2);

    // ensureGhostSlotForRef: claims the oldest ghost first...
    let mut tx = begin_immediate(pool).await.unwrap();
    let first = slots_of(pool, "it-pa").await[0].0.clone();
    let g = sync::ensure_ghost_slot_for_ref(&mut tx, "r1", &GhostRef::Panel("pa1".into()))
        .await
        .unwrap();
    assert_eq!(
        (
            g.slot_id.as_str(),
            g.inventory_item_id.as_str(),
            g.quantity_incremented
        ),
        (first.as_str(), "it-pa", false)
    );
    tx.commit().await.unwrap();

    // ...and when every slot is placed, bumps the quantity and makes one.
    sqlx::query(r#"UPDATE "RackSlot" SET "startU" = 1 WHERE "inventoryItemId" = 'it-pa'"#)
        .execute(pool)
        .await
        .unwrap();
    let mut tx = begin_immediate(pool).await.unwrap();
    let g = sync::ensure_ghost_slot_for_panel(&mut tx, "r1", "pa1")
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(g.quantity_incremented);
    assert_eq!(g.inventory_item_id, "it-pa");
    let qty: i64 =
        sqlx::query_scalar(r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "id" = 'it-pa'"#)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(qty, 3);
    let slots = slots_of(pool, "it-pa").await;
    assert_eq!(slots.len(), 3);
    assert_eq!(slots[2].0, g.slot_id);
    assert_eq!(slots[2].1, None);

    // No inventory row for this reference yet: one is created (quantity 1).
    let mut tx = begin_immediate(pool).await.unwrap();
    let g = sync::ensure_ghost_slot_for_equipment(&mut tx, "r2", "host-eq")
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(g.quantity_incremented);
    let (rack, qty): (String, i64) =
        sqlx::query_as(r#"SELECT "rackId", "quantity" FROM "RackInventoryItem" WHERE "id" = ?"#)
            .bind(&g.inventory_item_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!((rack.as_str(), qty), ("r2", 1));
    let claimable = {
        let mut conn = pool.acquire().await.unwrap();
        sync::find_claimable_ghost_slot(&mut conn, "r2", &GhostRef::Equipment("host-eq".into()))
            .await
            .unwrap()
            .unwrap()
    };
    assert_eq!(claimable.id, g.slot_id);
}

/// arkyo's degenerate case: more placed slots than the quantity, so the
/// sync makes no ghost. A typed error with arkyo's message, mapped to 409.
#[tokio::test]
async fn ensure_ghost_without_ghost_is_typed() {
    let d = db().await;
    let pool = &d.pool;
    catalogue_fixture(pool).await;
    insert_item(pool, "it-x", "r2", "catalogEquipmentId", "eq1", 2).await;
    for (i, u) in [1, 3, 5].into_iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","createdAt","updatedAt")
               VALUES (?,'r2','eq1','it-x',?,?,?)"#,
        )
        .bind(format!("s{i}"))
        .bind(u)
        .bind(NOW)
        .bind(NOW)
        .execute(pool)
        .await
        .unwrap();
    }
    let mut tx = begin_immediate(pool).await.unwrap();
    let e = sync::ensure_ghost_slot_for_equipment(&mut tx, "r2", "eq1")
        .await
        .unwrap_err();
    drop(tx);
    match &e {
        sync::GhostError::NoGhost(m) => assert_eq!(
            m,
            "Impossible de créer un slot fantôme pour l'équipement eq1 dans le rack r2."
        ),
        other => panic!("{other:?}"),
    }
    assert_eq!(e.status().as_u16(), 409);
    // Rolled back: the quantity is unchanged.
    let qty: i64 =
        sqlx::query_scalar(r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "id" = 'it-x'"#)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(qty, 2);
}

// ── libellés automatiques ───────────────────────────────────────────────────

#[test]
fn auto_label_format_and_fallback() {
    let mut used = HashSet::new();
    for _ in 0..2000 {
        let l = generate_unique_label(&used);
        assert!(is_auto_label(&l), "{l}");
        assert!(used.insert(l));
    }
    // Every combination taken: arkyo's timestamp fallback, `#` + the last 4
    // base-36 digits of the millisecond clock, upper case.
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut all = HashSet::with_capacity(32usize.pow(4));
    for a in CHARS {
        for b in CHARS {
            for c in CHARS {
                for d in CHARS {
                    all.insert(format!(
                        "#{}{}{}{}",
                        *a as char, *b as char, *c as char, *d as char
                    ));
                }
            }
        }
    }
    let l = generate_unique_label(&all);
    assert_eq!(l.len(), 5);
    assert!(l.starts_with('#'));
    assert!(l[1..]
        .chars()
        .all(|c| c.is_ascii_digit() || c.is_ascii_uppercase()));
}

#[tokio::test]
async fn auto_labels_unique_under_concurrency() {
    let d = db().await;
    catalogue_fixture(&d.pool).await;
    // Ten "adds" on the same container at once, each in its own write
    // transaction: create a row of 5 and sync its ghosts.
    let mut tasks = Vec::new();
    for n in 0..10 {
        let pool = d.pool.clone();
        tasks.push(tokio::spawn(async move {
            let mut tx = begin_immediate(&pool).await?;
            let id = format!("it-{n}");
            sqlx::query(
                r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","createdAt","updatedAt") VALUES (?, 'r1', 'eq1', 5, ?, ?)"#,
            )
            .bind(&id)
            .bind(NOW)
            .bind(NOW)
            .execute(&mut *tx)
            .await?;
            let r = sync::sync_inventory_slots(&mut tx, &id).await?;
            tx.commit().await?;
            Ok::<_, sqlx::Error>(r.created.len())
        }));
    }
    for t in tasks {
        assert_eq!(t.await.unwrap().unwrap(), 5);
    }
    let labels: Vec<String> =
        sqlx::query_scalar(r#"SELECT "label" FROM "RackSlot" WHERE "rackId" = 'r1'"#)
            .fetch_all(&d.pool)
            .await
            .unwrap();
    assert_eq!(labels.len(), 50);
    assert!(labels.iter().all(|l| is_auto_label(l)), "{labels:?}");
    let unique: HashSet<&String> = labels.iter().collect();
    assert_eq!(unique.len(), 50, "{labels:?}");
}

// ── fetchCatalogAdapterMap ──────────────────────────────────────────────────

#[tokio::test]
async fn adapter_map_enriches_like_arkyo() {
    let d = db().await;
    catalogue_fixture(&d.pool).await;
    let mut conn = d.pool.acquire().await.unwrap();

    // Nulls, empty strings, duplicates and unknown ids are dropped; inactive
    // adapters are kept (an item may still reference one).
    let map = fetch_catalog_adapter_map(
        &mut conn,
        [
            Some("ad1"),
            None,
            Some(""),
            Some("ad1"),
            Some("nope"),
            Some("ad-off"),
        ],
    )
    .await
    .unwrap();
    assert_eq!(map.len(), 2);
    assert_eq!(
        map["ad1"],
        json!({
            "id": "ad1",
            "name": "XLR F → Jack",
            "reference": "AD-1",
            "imageUrl": "/uploads/ad.png",
            "inputs": [{"connectorTypeId": "ct1"}],
            "outputs": [],
            "notes": "Note",
            "source": "PERSONAL",
        })
    );
    assert_eq!(map["ad-off"]["inputs"], json!([]));
    assert_eq!(map["ad-off"]["reference"], Value::Null);

    let empty = fetch_catalog_adapter_map(&mut conn, [None, Some("")])
        .await
        .unwrap();
    assert!(empty.is_empty());
}

// ── rack-inventory-api : BomItemDto ─────────────────────────────────────────

#[tokio::test]
async fn bom_items_like_arkyo() {
    let d = db().await;
    let pool = &d.pool;
    catalogue_fixture(pool).await;
    for sql in [
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","createdAt","updatedAt") VALUES ('i1','r1','eq1',2,'2026-11-06T10:00:01.000Z',?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","panelId","quantity","createdAt","updatedAt") VALUES ('i2','r1','pa1',1,'2026-11-06T10:00:02.000Z',?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogAdapterId","quantity","createdAt","updatedAt") VALUES ('i3','r1','ad1',3,'2026-11-06T10:00:03.000Z',?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","accessoryType","accessoryHeightU","accessoryVariant","quantity","createdAt","updatedAt") VALUES ('i4','r1','plaque',2,'pass-cable',1,'2026-11-06T10:00:04.000Z',?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","accessoryType","accessoryHeightU","accessoryDepthMm","quantity","createdAt","updatedAt") VALUES ('i5','r1','etagere',1,450,1,'2026-11-06T10:00:05.000Z',?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","createdAt","updatedAt") VALUES ('i6','r1','gone',1,'2026-11-06T10:00:06.000Z',?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","createdAt","updatedAt") VALUES ('i7','r1','host-eq',1,'2026-11-06T10:00:07.000Z',?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","hostItemId","hostSlotIndex","quantity","createdAt","updatedAt") VALUES ('i8','r1','comp-eq','i7',1,1,'2026-11-06T10:00:08.000Z',?)"#,
    ] {
        exec(pool, sql).await;
    }
    let mut conn = pool.acquire().await.unwrap();
    let rows = api::inventory_rows(&mut conn, "r1").await.unwrap();
    assert_eq!(rows.len(), 8);
    let project = serde_json::to_value(
        api::enrich_rows(&mut conn, &rows, BomMode::Project)
            .await
            .unwrap(),
    )
    .unwrap();
    let template = serde_json::to_value(
        api::enrich_rows(&mut conn, &rows, BomMode::Template)
            .await
            .unwrap(),
    )
    .unwrap();
    // The orphan `i6` is dropped.
    assert_eq!(project.as_array().unwrap().len(), 7);
    assert_eq!(template.as_array().unwrap().len(), 7);

    let base = |extra: Value| {
        let mut v = json!({
            "panelType": null, "weightKg": null, "powerW": null, "depthMm": null,
            "snapshotId": null, "hostItemId": null, "hostSlotIndex": null,
            "isComponentHost": false, "hostSlotCount": null, "isComponent": false,
            "componentSlotSpan": 1, "reference": null, "imageUrl": null,
            "brandName": null, "widthFraction": null,
        });
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        v
    };
    // Project: category = primary function (lowest sortOrder), with colour.
    let eq = base(json!({
        "id": "i1", "kind": "equipment", "refId": "eq1", "quantity": 2,
        "name": "ATEM 2 M/E", "reference": "SWATEMPSW2ME", "imageUrl": "/uploads/atem.png",
        "brandName": "Blackmagic", "heightU": 2, "widthFraction": "HALF",
        "weightKg": 4.5, "powerW": 150, "depthMm": 400, "isRackable": true,
        "category": "Vidéo", "categoryColor": "#0000aa",
    }));
    assert_eq!(project[0], eq);
    // Template: category = the equipment category name, no colour key.
    let mut eq_t = eq.clone();
    eq_t["category"] = json!("Régie");
    eq_t.as_object_mut().unwrap().remove("categoryColor");
    assert_eq!(template[0], eq_t);

    let panel = base(json!({
        "id": "i2", "kind": "panel", "refId": "pa1", "quantity": 1,
        "name": "Patch 24 XLR", "heightU": 1, "panelType": "PATCH",
        "isRackable": true, "category": "Panels de patch", "categoryColor": null,
    }));
    assert_eq!(project[1], panel);

    let adapter = base(json!({
        "id": "i3", "kind": "adapter", "refId": "ad1", "quantity": 3,
        "name": "XLR F → Jack", "reference": "AD-1", "imageUrl": "/uploads/ad.png",
        "heightU": null, "isRackable": false,
        "category": "Audio", "categoryColor": "#00aa00",
    }));
    assert_eq!(project[2], adapter);
    assert_eq!(template[2]["category"], Value::Null);
    assert!(template[2].get("categoryColor").is_none());

    let plaque = base(json!({
        "id": "i4", "kind": "accessory", "accessoryType": "plaque",
        "accessoryHeightU": 2, "accessoryVariant": "pass-cable", "quantity": 1,
        "name": "Plaque pass-câble 2U", "heightU": 2, "isRackable": true,
        "category": "Accessoire rack", "categoryColor": null,
    }));
    assert_eq!(project[3], plaque);
    let shelf = base(json!({
        "id": "i5", "kind": "accessory", "accessoryType": "etagere",
        "accessoryHeightU": 1, "accessoryDepthMm": 450, "quantity": 1,
        "name": "Étagère 1U · 450mm", "heightU": 1, "depthMm": 450, "isRackable": true,
        "category": "Accessoire rack", "categoryColor": null,
    }));
    assert_eq!(project[4], shelf);

    // Host and component fields.
    assert_eq!(project[5]["isComponentHost"], json!(true));
    assert_eq!(project[5]["hostSlotCount"], json!(4));
    assert_eq!(project[5]["category"], Value::Null);
    assert_eq!(project[6]["hostItemId"], json!("i7"));
    assert_eq!(project[6]["hostSlotIndex"], json!(1));
    assert_eq!(project[6]["isComponent"], json!(true));
    assert_eq!(project[6]["componentSlotSpan"], json!(2));
    assert_eq!(project[6]["isRackable"], json!(false));

    // Component helpers.
    let host = api::resolve_component_equipment_fields(&mut conn, "host-eq")
        .await
        .unwrap()
        .unwrap();
    assert!(host.is_component_host && !host.is_component);
    assert_eq!(
        (host.host_slot_count, host.component_slot_span),
        (Some(4), 1)
    );
    assert!(api::resolve_component_equipment_fields(&mut conn, "nope")
        .await
        .unwrap()
        .is_none());
    assert!(api::resolve_is_component_host(&mut conn, "host-eq")
        .await
        .unwrap());
    assert!(!api::resolve_is_component_host(&mut conn, "nope")
        .await
        .unwrap());
    let spans = api::resolve_component_spans_batch(
        &mut conn,
        &["comp-eq".to_string(), "eq1".to_string(), "nope".to_string()],
    )
    .await
    .unwrap();
    assert_eq!(spans.len(), 2);
    assert_eq!((spans["comp-eq"], spans["eq1"]), (2, 1));

    // One row by id.
    let one = api::inventory_row(&mut conn, "i5").await.unwrap().unwrap();
    assert_eq!(one.accessory_depth_mm, Some(450));
    assert!(api::inventory_row(&mut conn, "nope")
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        api::format_accessory_name("tiroir", 3, None, None),
        "Tiroir 3U"
    );
    assert_eq!(
        api::format_accessory_name("plaque", 1, Some("plein"), None),
        "Plaque pleine 1U"
    );
    assert_eq!(
        api::format_accessory_name("plaque", 1, None, None),
        "Plaque 1U"
    );
}

// ── catalog-merge, version mono-source ──────────────────────────────────────

#[tokio::test]
async fn inventaire_catalog_lists_active_personal_items() {
    let d = db().await;
    catalogue_fixture(&d.pool).await;
    let mut conn = d.pool.acquire().await.unwrap();

    let eqs = serde_json::to_value(
        catalog::fetch_inventaire_equipments(&mut conn)
            .await
            .unwrap(),
    )
    .unwrap();
    // Active only, newest first.
    let ids: Vec<&str> = eqs
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["comp-eq", "host-eq", "eq1"]);
    assert_eq!(
        eqs[2],
        json!({
            "id": "eq1", "name": "ATEM 2 M/E", "reference": "SWATEMPSW2ME",
            "brandName": "Blackmagic", "categoryName": "Vidéo", "categoryColor": "#0000aa",
            "imageUrl": "/uploads/atem.png", "heightU": 2, "widthFraction": "HALF",
            "isRackable": true, "powerW": 150, "depthMm": 400, "weightKg": 4.5,
            "isComponentHost": false, "isComponent": false, "is2110": false,
            "isLightingFixture": false, "source": "PERSONAL",
        })
    );
    // No function: the category; none: null.
    assert_eq!(eqs[1]["categoryName"], Value::Null);
    assert_eq!(eqs[0]["is2110"], json!(true));

    let ads =
        serde_json::to_value(catalog::fetch_inventaire_adapters(&mut conn).await.unwrap()).unwrap();
    // The seeded adapters are there too; ours is the oldest, the inactive
    // one is left out.
    let ads = ads.as_array().unwrap();
    assert!(ads.iter().all(|a| a["id"] != "ad-off"));
    assert_eq!(
        ads.last().unwrap(),
        &json!({
            "id": "ad1", "name": "XLR F → Jack", "reference": "AD-1",
            "imageUrl": "/uploads/ad.png", "categoryName": "Audio",
            "categoryColor": "#00aa00", "source": "PERSONAL",
        })
    );
}
