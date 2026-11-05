mod common;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

type Part<'a> = (&'a str, Option<(&'a str, &'a str)>, &'a [u8]);

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake";

async fn setup() -> (Env, String) {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    (e, tok)
}

fn multipart(parts: &[Part<'_>]) -> (String, Vec<u8>) {
    let boundary = "XBOUNDARYX";
    let mut out = Vec::new();
    for (name, file, data) in parts {
        out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        match file {
            Some((fname, ctype)) => out.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{name}\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n"
                )
                .as_bytes(),
            ),
            None => out.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
            ),
        }
        out.extend_from_slice(data);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), out)
}

async fn send(e: &Env, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut req = req;
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    let res = e.app.clone().oneshot(req).await.unwrap();
    let (st, h) = (res.status(), res.headers().clone());
    let b = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (st, h, b)
}

async fn post_upload(e: &Env, tok: Option<&str>, parts: &[Part<'_>]) -> (StatusCode, Value) {
    let (ct, body) = multipart(parts);
    let mut b = Request::builder()
        .method("POST")
        .uri("/api/upload")
        .header(header::CONTENT_TYPE, ct);
    if let Some(t) = tok {
        b = b.header(header::COOKIE, format!("arkyo_session={t}"));
    }
    let (st, _, bytes) = send(e, b.body(Body::from(body)).unwrap()).await;
    (st, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn upload_requires_auth() {
    let e = env().await;
    let (st, _) = post_upload(&e, None, &[("file", Some(("a.png", "image/png")), PNG)]).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn upload_image_then_served_with_nosniff() {
    let (e, tok) = setup().await;
    let (st, v) = post_upload(
        &e,
        Some(&tok),
        &[
            ("folder", None, b"equipment"),
            ("file", Some(("ignored.html", "image/png")), PNG),
        ],
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let url = v["url"].as_str().unwrap();
    assert!(
        url.starts_with("/uploads/equipment/") && url.ends_with(".png"),
        "{url}"
    );
    let stored = e._dir.path().join(url.trim_start_matches('/'));
    assert_eq!(std::fs::read(stored).unwrap(), PNG);

    let (st, h, body) = send(&e, Request::get(url).body(Body::empty()).unwrap()).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(h.get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(h.get(header::CONTENT_TYPE).unwrap(), "image/png");
    assert!(h.get(header::CONTENT_SECURITY_POLICY).is_none());
    assert_eq!(body, PNG);
}

#[tokio::test]
async fn folder_defaults_to_misc_and_svg_is_sandboxed() {
    let (e, tok) = setup().await;
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>"#;
    let (st, v) = post_upload(
        &e,
        Some(&tok),
        &[("file", Some(("a.svg", "image/svg+xml")), svg)],
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let url = v["url"].as_str().unwrap();
    assert!(url.starts_with("/uploads/misc/") && url.ends_with(".svg"));
    let (_, h, _) = send(&e, Request::get(url).body(Body::empty()).unwrap()).await;
    assert_eq!(h.get(header::CONTENT_SECURITY_POLICY).unwrap(), "sandbox");
    assert_eq!(h.get("x-content-type-options").unwrap(), "nosniff");
}

#[tokio::test]
async fn svg_with_script_is_rejected() {
    let (e, tok) = setup().await;
    let svg =
        br#"<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>1</script></svg>"#;
    let (st, v) = post_upload(
        &e,
        Some(&tok),
        &[("file", Some(("a.svg", "image/svg+xml")), svg)],
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(
        v["error"],
        "Le fichier SVG est invalide ou a été entièrement rejeté par le filtre de sécurité"
    );
}

#[tokio::test]
async fn upload_rejects_bad_folder_and_traversal() {
    let (e, tok) = setup().await;
    for bad in ["../etc", "a/b", "a\\b", "..", "x y", "é"] {
        let (st, v) = post_upload(
            &e,
            Some(&tok),
            &[
                ("folder", None, bad.as_bytes()),
                ("file", Some(("a.png", "image/png")), PNG),
            ],
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{bad}: {v}");
        assert_eq!(v["error"], "Dossier invalide", "{bad}");
    }
    assert!(!e._dir.path().join("etc").exists());
}

#[tokio::test]
async fn upload_rejects_too_large_or_wrong_type() {
    let (e, tok) = setup().await;
    let (st, v) = post_upload(&e, Some(&tok), &[("folder", None, b"x")]).await;
    assert_eq!(
        (st, v["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("Aucun fichier"))
    );

    let (st, v) = post_upload(
        &e,
        Some(&tok),
        &[("file", Some(("a.txt", "text/plain")), b"hi")],
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(
        v["error"],
        "Type non supporté (JPEG, PNG, WebP, SVG, GIF, PDF)"
    );

    let big = vec![0u8; 5 * 1024 * 1024 + 1];
    let (st, v) = post_upload(
        &e,
        Some(&tok),
        &[("file", Some(("a.png", "image/png")), &big)],
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"], "Fichier trop lourd (max 5 Mo)");

    // A PDF may reach 10 Mo.
    let pdf = vec![0u8; 6 * 1024 * 1024];
    let (st, v) = post_upload(
        &e,
        Some(&tok),
        &[("file", Some(("a.pdf", "application/pdf")), &pdf)],
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert!(v["url"].as_str().unwrap().ends_with(".pdf"));
    let pdf = vec![0u8; 10 * 1024 * 1024 + 1];
    let (st, v) = post_upload(
        &e,
        Some(&tok),
        &[("file", Some(("a.pdf", "application/pdf")), &pdf)],
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"], "Fichier trop lourd (max 10 Mo)");
}

async fn from_url(e: &Env, tok: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("POST")
        .uri("/api/upload/from-url")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, format!("arkyo_session={tok}"))
        .body(Body::from(body.to_string()))
        .unwrap();
    let (st, _, b) = send(e, req).await;
    (st, serde_json::from_slice(&b).unwrap_or(Value::Null))
}

/// One-shot HTTP server answering with the given content type and body.
fn serve_once(ctype: &'static str, body: Vec<u8>) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut s, _)) = l.accept() {
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = s.write_all(head.as_bytes());
            let _ = s.write_all(&body);
        }
    });
    format!("http://127.0.0.1:{port}/img")
}

#[tokio::test]
async fn from_url_rejects_non_http() {
    let (e, tok) = setup().await;
    for u in [
        "file:///etc/passwd",
        "ftp://x.fr/a.png",
        "data:image/png;base64,AAAA",
    ] {
        let (st, v) = from_url(&e, &tok, json!({"url": u})).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{u}");
        assert_eq!(
            v["error"], "Seuls les protocoles HTTP et HTTPS sont acceptés",
            "{u}"
        );
    }
    let (st, v) = from_url(&e, &tok, json!({"url": "pas une url"})).await;
    assert_eq!(
        (st, v["error"].as_str()),
        (
            StatusCode::BAD_REQUEST,
            Some("URL invalide ou paramètres manquants")
        )
    );
    let (st, v) = from_url(&e, &tok, json!({})).await;
    assert_eq!(
        (st, v["error"].as_str()),
        (
            StatusCode::BAD_REQUEST,
            Some("URL invalide ou paramètres manquants")
        )
    );
    let (st, v) = from_url(
        &e,
        &tok,
        json!({"url": "http://x.fr/a.png", "folder": "../x"}),
    )
    .await;
    assert_eq!(
        (st, v["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("Dossier invalide"))
    );
}

#[tokio::test]
async fn from_url_downloads_image_and_enforces_type_and_size() {
    let (e, tok) = setup().await;
    let url = serve_once("image/png; charset=x", PNG.to_vec());
    let (st, v) = from_url(&e, &tok, json!({"url": url})).await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let u = v["url"].as_str().unwrap();
    assert!(
        u.starts_with("/uploads/equipment/") && u.ends_with(".png"),
        "{u}"
    );
    assert_eq!(
        std::fs::read(e._dir.path().join(u.trim_start_matches('/'))).unwrap(),
        PNG
    );

    let url = serve_once("image/svg+xml", b"<svg/>".to_vec());
    let (st, v) = from_url(&e, &tok, json!({"url": url, "folder": "brands"})).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(
        v["error"],
        "Type non supporté. Acceptés : JPEG, PNG, WebP, GIF (SVG interdit par URL)"
    );

    let url = serve_once("image/png", vec![0u8; 5 * 1024 * 1024 + 1]);
    let (st, v) = from_url(&e, &tok, json!({"url": url})).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"], "Fichier trop lourd (max 5 Mo)");

    let (st, v) = from_url(&e, &tok, json!({"url": "http://127.0.0.1:9/x.png"})).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"], "Impossible de joindre cette URL");
}
