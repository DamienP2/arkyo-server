//! Spreadsheet import of equipment (Task 7 of phase 2,
//! arkyo:app/api/tenant/parametres/import/{analyze,preview,commit}).
mod common;
use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

const ANALYZE: &str = "/api/tenant/parametres/import/analyze";
const PREVIEW: &str = "/api/tenant/parametres/import/preview";
const COMMIT: &str = "/api/tenant/parametres/import/commit";
const EQUIPMENT: &str = "/api/tenant/catalogue/equipment";

struct Ctx {
    e: Env,
    tok: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    Ctx { e, tok }
}

impl Ctx {
    async fn req(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, path, LOCAL, Some(&self.tok), body).await
    }

    /// POST analyze as `multipart/form-data` with one `file` part.
    async fn upload(&self, filename: &str, mime: &str, bytes: &[u8]) -> Reply {
        let boundary = "----arkyoTestBoundary";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let mut req = Request::builder()
            .method("POST")
            .uri(ANALYZE)
            .header(header::COOKIE, format!("arkyo_session={}", self.tok))
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .unwrap();
        req.extensions_mut().insert(axum::extract::ConnectInfo(
            LOCAL.parse::<std::net::SocketAddr>().unwrap(),
        ));
        let res = self.e.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        Reply {
            status,
            cookie: None,
            body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        }
    }

    async fn create(&self, body: Value) -> String {
        let r = self.req("POST", EQUIPMENT, Some(body)).await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body["id"].as_str().unwrap().to_string()
    }
}

async fn scalar(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

fn field_of(analysis: &Value, header: &str) -> Value {
    analysis["mapping"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["header"] == header)
        .unwrap_or_else(|| panic!("{header} absent"))["suggestedField"]
        .clone()
}

/// `columns` of preview/commit from the suggested mapping.
fn columns_of(analysis: &Value) -> Value {
    Value::Array(
        analysis["mapping"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| !m["suggestedField"].is_null())
            .map(|m| json!({ "index": m["index"], "field": m["suggestedField"] }))
            .collect(),
    )
}

// ── analyze ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn import_detects_columns_by_synonyms() {
    let c = ctx().await;
    let csv = "\u{feff}Désignation;Marque;Référence;U;Profondeur (mm);Poids kg;ST 2110\r\n\
               Caméra HD;Sony;HXC-100;2;450;6,5;oui\r\n\
               Grille SDI;Blackmagic;GX-12;1;300;3,2;non\r\n\
               Caméra HD bis;sony;HXC-101;2;450;6,5;oui\r\n";
    let r = c.req("POST", ANALYZE, Some(json!({ "csv": csv }))).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["entity"], "equipment");
    assert!(r.body.get("sheetNames").is_none());
    assert_eq!(r.body["headers"][0], "Désignation");
    assert_eq!(r.body["totalRows"], 3);
    assert_eq!(r.body["sampleRows"][1][1], "Blackmagic");
    for (h, f) in [
        ("Désignation", "name"),
        ("Marque", "brand"),
        ("Référence", "reference"),
        ("U", "heightU"),
        ("Profondeur (mm)", "depthMm"),
        ("Poids kg", "weight"),
        ("ST 2110", "is2110"),
    ] {
        assert_eq!(field_of(&r.body, h), f, "{h}");
    }
    let m0 = &r.body["mapping"][0];
    assert_eq!(m0["index"], 0);
    assert!(m0["score"].as_f64().unwrap() > 0.7);
    assert!(m0["alternatives"].is_array());
    // Distinct brand values, first spelling kept.
    assert_eq!(r.body["refValues"]["brands"], json!(["Sony", "Blackmagic"]));
    assert_eq!(r.body["refValues"]["categories"], json!([]));
    // Existing referentials: the seeded brands, as the tenant's own.
    let brands = r.body["existing"]["brands"].as_array().unwrap();
    assert!(!brands.is_empty());
    assert!(brands
        .iter()
        .all(|b| b["source"] == "tenant" && b["id"].is_string()));
    assert!(r.body["existing"]["categories"].is_array());

    // Matrix (client-side XLSX path) and comma CSV give the same mapping.
    let m = c
        .req(
            "POST",
            ANALYZE,
            Some(
                json!({ "matrix": [["Name", "Brand", "Model"], ["Switch", "Cisco", 12.5]],
                         "sheetNames": ["A", "B"] }),
            ),
        )
        .await;
    assert_eq!(m.status, StatusCode::OK, "{:?}", m.body);
    assert_eq!(m.body["sheetNames"], json!(["A", "B"]));
    assert_eq!(m.body["sampleRows"], json!([["Switch", "Cisco", "12.5"]]));
    assert_eq!(field_of(&m.body, "Model"), "reference");
    let comma = c
        .req(
            "POST",
            ANALYZE,
            Some(json!({ "csv": "Name,Brand,Model\n\"Switch, 24p\",Cisco,\"A\"\"B\"\n" })),
        )
        .await;
    assert_eq!(
        comma.body["sampleRows"],
        json!([["Switch, 24p", "Cisco", "A\"B"]])
    );
}

#[tokio::test]
async fn import_analyze_errors_and_limits() {
    let c = ctx().await;
    let r = c.req("POST", ANALYZE, Some(json!({}))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body["error"],
        "Fournir `file` (multipart), `csv` ou `matrix`."
    );
    let r = c.req("POST", ANALYZE, Some(json!({ "csv": "\n\n" }))).await;
    assert_eq!(r.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        r.body["error"],
        "Le tableur ne contient aucune colonne exploitable."
    );
    let r = c.req("POST", ANALYZE, Some(json!({ "matrix": "x" }))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.body["error"]["fieldErrors"]["matrix"].is_array());
    let big: Vec<Value> = (0..5002).map(|i| json!([format!("r{i}")])).collect();
    let r = c.req("POST", ANALYZE, Some(json!({ "matrix": big }))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    // 5000 data rows at most (silently bounded, like arkyo).
    let mut csv = String::from("Nom\n");
    for i in 0..5100 {
        csv.push_str(&format!("Item {i}\n"));
    }
    let r = c.upload("liste.csv", "text/csv", csv.as_bytes()).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["totalRows"], 5000);
    assert_eq!(r.body["sampleRows"].as_array().unwrap().len(), 50);

    let r = c
        .upload("gros.csv", "text/csv", &vec![b'a'; 12 * 1024 * 1024 + 1])
        .await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(r.body["error"], "Fichier trop volumineux");

    let r = c
        .upload(
            "casse.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            b"pas un zip",
        )
        .await;
    assert_eq!(r.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(r.body["error"]
        .as_str()
        .unwrap()
        .starts_with("Impossible de lire le fichier XLSX"));

    // catalog:write required: arkyo's 403 body.
    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r1','lecteur','Lecteur','{"catalog":"read"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    add_user(&c.e.pool, "l@b.fr", "lecteur", false).await;
    let tok = login(&c.e.app, "l@b.fr").await;
    let r = call(
        &c.e.app,
        "POST",
        ANALYZE,
        LOCAL,
        Some(&tok),
        Some(json!({ "csv": "Nom\nA" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.body["code"], "INSUFFICIENT_PERMISSION");
}

/// Size guards before any dense allocation (final review, Important 1):
/// a sheet, a JSON matrix or a CSV wider than 200 columns is refused with
/// arkyo-style French errors, and a sparse XLSX whose used range spans the
/// whole sheet (A1 + XFD1048576) is refused quickly, without allocating
/// the dense range.
#[tokio::test]
async fn import_rejects_too_many_columns() {
    use rust_xlsxwriter::Workbook;
    const XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    let c = ctx().await;
    let too_many = |r: &Reply| {
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{:?}", r.body["error"]);
        assert_eq!(r.body["error"], "Trop de colonnes (max 200)");
    };

    // JSON matrix: a 100 000-cell header row and short data rows.
    let header: Vec<Value> = (0..100_000).map(|_| json!("a")).collect();
    let mut matrix = vec![Value::Array(header)];
    matrix.extend((0..5000).map(|_| json!(["x"])));
    too_many(
        &c.req("POST", ANALYZE, Some(json!({ "matrix": matrix })))
            .await,
    );
    // 200 columns stay accepted.
    let header: Vec<Value> = (0..200).map(|i| json!(format!("C{i}"))).collect();
    let ok = c
        .req("POST", ANALYZE, Some(json!({ "matrix": [header, ["x"]] })))
        .await;
    assert_eq!(ok.status, StatusCode::OK, "{:?}", ok.body);
    assert_eq!(ok.body["headers"].as_array().unwrap().len(), 200);

    // CSV, JSON and multipart.
    let csv = format!("{}\nx\n", vec!["a"; 201].join(";"));
    too_many(&c.req("POST", ANALYZE, Some(json!({ "csv": csv }))).await);
    too_many(&c.upload("large.csv", "text/csv", csv.as_bytes()).await);

    // XLSX 201 columns wide.
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.write_string(0, 0, "Nom").unwrap();
    ws.write_string(0, 200, "Fin").unwrap();
    too_many(
        &c.upload("large.xlsx", XLSX, &wb.save_to_buffer().unwrap())
            .await,
    );
}

/// A1 + XFD1048576: a < 10 Ko file whose dense range would be 1.7e10 cells.
/// Not run against the unguarded code (it would exhaust the machine).
#[tokio::test]
async fn import_rejects_sparse_xlsx_without_allocating() {
    use rust_xlsxwriter::Workbook;
    let c = ctx().await;
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.write_string(0, 0, "Nom").unwrap();
    ws.write_string(1_048_575, 16_383, "x").unwrap();
    let bytes = wb.save_to_buffer().unwrap();
    assert!(bytes.len() < 10_000);
    let start = std::time::Instant::now();
    let r = c
        .upload(
            "bombe.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            &bytes,
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{:?}", r.body);
    assert_eq!(r.body["error"], "Trop de colonnes (max 200)");
    assert!(start.elapsed() < std::time::Duration::from_secs(5));
}

#[tokio::test]
async fn import_xlsx_same_as_csv() {
    use rust_xlsxwriter::Workbook;
    let c = ctx().await;
    let header = [
        "Nom",
        "Fabricant",
        "Hauteur (U)",
        "Poids (kg)",
        "Double alimentation",
    ];
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet().set_name("Équipements").unwrap();
    for (i, h) in header.iter().enumerate() {
        ws.write_string(0, i as u16, *h).unwrap();
    }
    ws.write_string(1, 0, "Caméra").unwrap();
    ws.write_string(1, 1, "Sony").unwrap();
    ws.write_number(1, 2, 2).unwrap();
    ws.write_number(1, 3, 6.5).unwrap();
    ws.write_string(1, 4, "Oui").unwrap();
    // Blank row: dropped like SheetJS `blankrows: false`.
    ws.write_string(3, 0, "Grille").unwrap();
    ws.write_number(3, 3, 3).unwrap();
    ws.write_string(3, 4, "Non").unwrap();
    wb.add_worksheet().set_name("Autre").unwrap();
    let bytes = wb.save_to_buffer().unwrap();

    let x = c
        .upload(
            "catalogue.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            &bytes,
        )
        .await;
    assert_eq!(x.status, StatusCode::OK, "{:?}", x.body);
    assert_eq!(x.body["sheetNames"], json!(["Équipements", "Autre"]));

    let csv = "Nom;Fabricant;Hauteur (U);Poids (kg);Double alimentation\r\n\
               Caméra;Sony;2;6.5;Oui\r\n\r\nGrille;;;3;Non\r\n";
    let t = c.upload("catalogue.csv", "text/csv", csv.as_bytes()).await;
    assert_eq!(t.status, StatusCode::OK, "{:?}", t.body);
    for k in [
        "headers",
        "totalRows",
        "sampleRows",
        "mapping",
        "refValues",
        "existing",
    ] {
        assert_eq!(x.body[k], t.body[k], "{k}");
    }
    assert_eq!(
        x.body["sampleRows"],
        json!([
            ["Caméra", "Sony", "2", "6.5", "Oui"],
            ["Grille", "", "", "3", "Non"]
        ])
    );
}

// ── preview ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn import_preview_flags_duplicates_in_file_and_db() {
    let c = ctx().await;
    let base = c
        .create(json!({ "name": "Ampli Crown", "reference": "CRN-123" }))
        .await;
    let rows = json!([
        ["Ampli Crown", "CRN-123", ""],
        ["Micro Shure", "SHR-1", "abc"],
        ["", "SANS-NOM", ""],
        ["micro shure", "", ""],
        ["  AMPLI crown ", "", ""]
    ]);
    let cols = json!([
        { "index": 0, "field": "name" },
        { "index": 1, "field": "reference" },
        { "index": 2, "field": "weight" }
    ]);
    let r = c
        .req(
            "POST",
            PREVIEW,
            Some(json!({ "columns": cols, "rows": rows })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let st: Vec<&str> = r.body["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["status"].as_str().unwrap())
        .collect();
    assert_eq!(
        st,
        ["duplicate", "new", "invalid", "duplicate", "duplicate"]
    );
    assert_eq!(
        r.body["summary"],
        json!({ "new": 1, "duplicate": 3, "invalid": 1 })
    );
    let rs = &r.body["rows"];
    assert_eq!(
        rs[0]["match"],
        json!({ "id": base, "name": "Ampli Crown", "reference": "CRN-123" })
    );
    assert!(rs[0].get("matchRow").is_none());
    assert_eq!(rs[1]["cellIssues"][0]["field"], "weight");
    assert_eq!(rs[1]["cellIssues"][0]["value"], "abc");
    assert_eq!(
        rs[1]["cellIssues"][0]["message"],
        "\"abc\" n'est pas un nombre valide"
    );
    assert_eq!(rs[2]["reason"], "Nom manquant");
    assert!(rs[3].get("match").is_none());
    assert_eq!(rs[3]["matchRow"], 1);
    assert_eq!(rs[4]["match"]["id"], base.as_str());
    assert_eq!(rs[4]["matchRow"], 0);

    let r = c
        .req(
            "POST",
            PREVIEW,
            Some(json!({ "columns": [{ "index": 0, "field": "bogus" }], "rows": [] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.body["error"]["fieldErrors"]["columns"].is_array());
    let r = c
        .req("POST", PREVIEW, Some(json!({ "columns": [], "rows": [] })))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

// ── commit ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn import_commit_creates_brands_on_decision() {
    let c = ctx().await;
    let existing_brand: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "TenantBrand" ORDER BY "name" LIMIT 1"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    let dup = c
        .create(json!({ "name": "Switch", "reference": "SW-1", "weight": 1.0 }))
        .await;
    let mut rx = c.e.events.subscribe();
    let body = json!({
        "columns": [
            { "index": 0, "field": "name" }, { "index": 1, "field": "reference" },
            { "index": 2, "field": "brand" }, { "index": 3, "field": "category" },
            { "index": 4, "field": "heightU" }, { "index": 5, "field": "tags" },
            { "index": 6, "field": "widthFraction" }
        ],
        "rows": [
            ["Caméra", "CAM-1", "Nouvelle Marque", "Nouvelle Cat", "2U", "hd, sdi ; ip", "demi"],
            ["Grille", "", "  nouvelle   marque ", "", "1", "", ""],
            ["Switch", "SW-1", "Liée", "", "1", "", ""],
            ["Routeur", "", "Liée", "", "abc", "", ""],
            ["", "VIDE", "", "", "", "", ""],
            ["Ignorée", "", "", "", "", "", ""]
        ],
        "refDecisions": {
            "brands": {
                "Nouvelle Marque": { "action": "create" },
                "Liée": { "action": "link", "id": existing_brand }
            },
            "categories": { "Nouvelle Cat": { "action": "create" } }
        },
        "dedupPolicy": "update",
        "perRowOverrides": { "5": { "skip": true } }
    });
    let r = c.req("POST", COMMIT, Some(body)).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["created"], 3);
    assert_eq!(r.body["updated"], 1);
    assert_eq!(r.body["skipped"], 1);
    assert_eq!(
        r.body["failed"],
        json!([{ "row": 4, "reason": "Nom manquant" }])
    );
    let new_brand: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "TenantBrand" WHERE "name"='Nouvelle Marque'"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(
        r.body["createdRefs"]["brands"],
        json!([{ "value": "Nouvelle Marque", "id": new_brand }])
    );
    assert_eq!(
        r.body["createdRefs"]["categories"][0]["value"],
        "Nouvelle Cat"
    );

    let row = |name: &'static str| {
        let pool = c.e.pool.clone();
        async move {
            sqlx::query_as::<
                _,
                (
                    Option<String>,
                    Option<String>,
                    Option<i64>,
                    String,
                    String,
                    Option<f64>,
                ),
            >(
                r#"SELECT "brandId","categoryId","heightU","tags","widthFraction","weight"
                   FROM "TenantEquipment" WHERE "name" = ?"#,
            )
            .bind(name)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let cam = row("Caméra").await;
    assert_eq!(cam.0.as_deref(), Some(new_brand.as_str()));
    assert!(cam.1.is_some());
    assert_eq!(cam.2, Some(2));
    assert_eq!(
        serde_json::from_str::<Value>(&cam.3).unwrap(),
        json!(["hd", "sdi", "ip"])
    );
    assert_eq!(cam.4, "HALF");
    // Brand value matched on its normalized form.
    assert_eq!(row("Grille").await.0.as_deref(), Some(new_brand.as_str()));
    // Duplicate by reference updated in place (weight untouched: not mapped).
    let sw = row("Switch").await;
    assert_eq!(sw.0.as_deref(), Some(existing_brand.as_str()));
    assert_eq!(sw.5, Some(1.0));
    assert_eq!(
        scalar(
            &c.e.pool,
            r#"SELECT COUNT(*) FROM "TenantEquipment" WHERE "name"='Switch'"#
        )
        .await,
        1
    );
    // Invalid cell: imported with a null value.
    assert_eq!(row("Routeur").await.2, None);
    let created_by: String =
        sqlx::query_scalar(r#"SELECT "createdById" FROM "TenantEquipment" WHERE "name"='Caméra'"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert!(!created_by.is_empty());

    let ev: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(ev["entity"], "tenant_catalogue");
    assert_eq!(ev["action"], "imported");
    assert!(ev["id"].is_string());
    let after: String = sqlx::query_scalar(
        r#"SELECT "after" FROM "AuditLog" WHERE "action"='IMPORT' AND "entityType"='TenantEquipment'"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&after).unwrap(),
        json!({ "created": 3, "updated": 1, "skipped": 1, "failed": 1,
                "createdBrands": 1, "createdCategories": 1 })
    );
    let _ = dup;

    // dedup "skip" (default) and per-row "duplicate".
    let r = c
        .req(
            "POST",
            COMMIT,
            Some(json!({
                "columns": [{ "index": 0, "field": "name" }],
                "rows": [["Switch"], ["switch"]],
                "perRowOverrides": { "1": { "dedup": "duplicate" } }
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(
        (r.body["created"].as_i64(), r.body["skipped"].as_i64()),
        (Some(1), Some(1))
    );

    let r = c
        .req(
            "POST",
            COMMIT,
            Some(json!({
                "columns": [{ "index": 0, "field": "name" }], "rows": [],
                "refDecisions": { "brands": { "X": { "action": "link" } } }
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.body["error"]["fieldErrors"]["refDecisions"].is_array());
}

// ── round trip with the export of the application ───────────────────────────

/// `FIELD_LABEL` order (`ALL_TARGET_FIELDS`) of arkyo's export card.
const EXPORT_COLUMNS: [(&str, &str); 20] = [
    ("name", "Nom"),
    ("reference", "Référence"),
    ("brand", "Fabricant"),
    ("category", "Classification"),
    ("type", "Type"),
    ("heightU", "Hauteur (U)"),
    ("widthFraction", "Largeur"),
    ("depthMm", "Profondeur (mm)"),
    ("dimLmm", "Longueur (mm)"),
    ("dimWmm", "Largeur (mm)"),
    ("dimHmm", "Hauteur (mm)"),
    ("weight", "Poids (kg)"),
    ("powerW", "Puissance (W)"),
    ("heatBtuH", "Dissipation (BTU/h)"),
    ("hasDualPsu", "Double alimentation"),
    ("is2110", "ST 2110"),
    ("isLightingFixture", "Éclairage"),
    ("dmxChannelsDefault", "Canaux DMX"),
    ("notes", "Notes"),
    ("tags", "Étiquettes"),
];

/// JS `String(n)` for the numbers of the fixtures.
fn js_num(v: &Value) -> String {
    let f = v.as_f64().unwrap();
    if f.fract() == 0.0 {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    }
}

/// arkyo:lib/export/catalogue-export.ts `equipmentCellValue` + `csvEscape`.
fn export_cell(item: &Value, field: &str) -> String {
    let raw = match field {
        "name" => item["name"].as_str().unwrap_or("").to_string(),
        "brand" => item["brand"]["name"].as_str().unwrap_or("").to_string(),
        "category" => item["equipmentCategory"]["name"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        "type" => item["type"]["name"].as_str().unwrap_or("").to_string(),
        "reference" | "widthFraction" | "notes" => item[field].as_str().unwrap_or("").to_string(),
        "tags" => item["tags"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|t| t.as_str().unwrap().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default(),
        "hasDualPsu" | "is2110" | "isLightingFixture" => {
            if item[field] == true { "Oui" } else { "Non" }.to_string()
        }
        _ => {
            if item[field].is_number() {
                js_num(&item[field])
            } else {
                String::new()
            }
        }
    };
    if raw.contains(['"', ';', '\n', '\r']) {
        format!("\"{}\"", raw.replace('"', "\"\""))
    } else {
        raw
    }
}

/// `buildCsvText`: BOM, `;`, CRLF.
fn export_csv(items: &[Value]) -> String {
    let mut lines = vec![EXPORT_COLUMNS
        .iter()
        .map(|(_, l)| (*l).to_string())
        .collect::<Vec<_>>()
        .join(";")];
    for it in items {
        lines.push(
            EXPORT_COLUMNS
                .iter()
                .map(|(f, _)| export_cell(it, f))
                .collect::<Vec<_>>()
                .join(";"),
        );
    }
    format!("\u{feff}{}", lines.join("\r\n"))
}

/// The fields arkyo's import writes (`toWriteData`), for comparison.
const MANAGED: [&str; 19] = [
    "name",
    "reference",
    "brandId",
    "categoryId",
    "heightU",
    "widthFraction",
    "depthMm",
    "dimLmm",
    "dimWmm",
    "dimHmm",
    "weight",
    "powerW",
    "heatBtuH",
    "hasDualPsu",
    "is2110",
    "isLightingFixture",
    "dmxChannelsDefault",
    "notes",
    "tags",
];

/// Review Focus 4: a file exported by the application (CSV of
/// `catalogue-export.ts`) re-imports without losing a field the import
/// manages, and every row is flagged as a duplicate of its original.
#[tokio::test]
async fn import_reimports_exported_csv() {
    let c = ctx().await;
    let brand: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "TenantBrand" ORDER BY "name" LIMIT 1"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    let cat = c
        .req(
            "POST",
            "/api/tenant/parametres/categories/category",
            Some(json!({ "name": "Vidéo; régie" })),
        )
        .await;
    assert_eq!(cat.status, StatusCode::CREATED, "{:?}", cat.body);
    let cat = cat.body["id"].as_str().unwrap().to_string();
    c.create(json!({
        "name": "Caméra \"studio\"", "reference": "CAM-01", "brandId": brand, "categoryId": cat,
        "heightU": 2, "widthFraction": "HALF", "depthMm": 450, "dimLmm": 480, "dimWmm": 220,
        "dimHmm": 90, "weight": 6.5, "powerW": 120, "heatBtuH": 409.5, "hasDualPsu": true,
        "is2110": true, "isLightingFixture": false, "dmxChannelsDefault": 12,
        "notes": "ligne 1\nligne 2; fin", "tags": ["hd", "sdi"]
    }))
    .await;
    c.create(
        json!({ "name": "Projecteur", "isLightingFixture": true, "dmxChannelsDefault": 24,
                     "widthFraction": "QUARTER" }),
    )
    .await;
    c.create(json!({ "name": "Nu" })).await;

    let list = c.req("GET", EQUIPMENT, None).await;
    let originals = list.body["personal"].as_array().unwrap().clone();
    assert_eq!(originals.len(), 3);
    let csv = export_csv(&originals);
    assert!(csv.starts_with(
        "\u{feff}Nom;Référence;Fabricant;Classification;Type;Hauteur (U);Largeur;Profondeur (mm);"
    ));

    let a = c
        .upload(
            "catalogue-equipements-2026-11-05.csv",
            "text/csv",
            csv.as_bytes(),
        )
        .await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    // Every exported column but `Type` (not stored by the import) is mapped
    // back to its field.
    for (i, (field, label)) in EXPORT_COLUMNS.iter().enumerate() {
        assert_eq!(a.body["mapping"][i]["header"], *label);
        assert_eq!(a.body["mapping"][i]["suggestedField"], *field, "{label}");
    }
    let columns = columns_of(&a.body);
    let csv_rows = {
        // Rows of the file itself, as the wizard sends them back.
        let r = c.req("POST", ANALYZE, Some(json!({ "csv": csv }))).await;
        r.body["sampleRows"].clone()
    };
    assert_eq!(csv_rows, a.body["sampleRows"]);

    let p = c
        .req(
            "POST",
            PREVIEW,
            Some(json!({ "columns": columns, "rows": csv_rows })),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK, "{:?}", p.body);
    assert_eq!(
        p.body["summary"],
        json!({ "new": 0, "duplicate": 3, "invalid": 0 })
    );
    for (i, r) in p.body["rows"].as_array().unwrap().iter().enumerate() {
        assert_eq!(r["match"]["id"], originals[i]["id"]);
        assert_eq!(r["cellIssues"], json!([]), "row {i}");
    }

    // Import as copies: link the referentials to the existing entries.
    let link = |values: &Value, id: &str| -> Value {
        Value::Object(
            values
                .as_array()
                .unwrap()
                .iter()
                .map(|v| {
                    (
                        v.as_str().unwrap().to_string(),
                        json!({ "action": "link", "id": id }),
                    )
                })
                .collect(),
        )
    };
    assert_eq!(a.body["refValues"]["brands"].as_array().unwrap().len(), 1);
    let r = c
        .req(
            "POST",
            COMMIT,
            Some(json!({
                "columns": columns, "rows": csv_rows, "dedupPolicy": "duplicate",
                "refDecisions": {
                    "brands": link(&a.body["refValues"]["brands"], &brand),
                    "categories": link(&a.body["refValues"]["categories"], &cat)
                }
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["created"], 3);
    assert_eq!(r.body["failed"], json!([]));

    let all = c.req("GET", EQUIPMENT, None).await;
    let all = all.body["personal"].as_array().unwrap();
    assert_eq!(all.len(), 6);
    for orig in &originals {
        let copy = all
            .iter()
            .find(|x| x["name"] == orig["name"] && x["id"] != orig["id"])
            .unwrap_or_else(|| panic!("copie de {} absente", orig["name"]));
        for f in MANAGED {
            let (o, n) = (&orig[f], &copy[f]);
            if o.is_number() {
                assert_eq!(o.as_f64(), n.as_f64(), "{} {f}", orig["name"]);
            } else {
                assert_eq!(o, n, "{} {f}", orig["name"]);
            }
        }
    }
}
