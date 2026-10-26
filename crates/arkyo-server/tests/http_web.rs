mod common;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

async fn get(
    env: &common::Env,
    uri: &str,
    accept_gzip: bool,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut b = Request::builder().uri(uri);
    if accept_gzip {
        b = b.header(header::ACCEPT_ENCODING, "gzip");
    }
    let mut req = b.body(Body::empty()).unwrap();
    req.extensions_mut().insert(ConnectInfo(
        common::LOCAL.parse::<std::net::SocketAddr>().unwrap(),
    ));
    let res = env.app.clone().oneshot(req).await.unwrap();
    let (status, headers) = (res.status(), res.headers().clone());
    let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, headers, body)
}

fn ctype(h: &axum::http::HeaderMap) -> String {
    h.get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default()
}

#[tokio::test]
async fn deep_link_serves_index() {
    let env = common::env().await;
    let (s, h, _) = get(&env, "/project/abc/synoptique", false).await;
    assert_eq!(s, StatusCode::OK);
    assert!(ctype(&h).starts_with("text/html"));
}

#[tokio::test]
async fn api_not_swallowed_by_spa() {
    let env = common::env().await;
    let (s, h, _) = get(&env, "/api/inconnu", false).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(ctype(&h).starts_with("application/json"));
}

#[tokio::test]
async fn uploads_served_and_traversal_blocked() {
    let env = common::env().await;
    let dir = env._dir.path();
    std::fs::create_dir_all(dir.join("uploads/a")).unwrap();
    std::fs::write(dir.join("uploads/a/x.png"), b"PNGDATA").unwrap();
    let (s, h, body) = get(&env, "/uploads/a/x.png", false).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(ctype(&h), "image/png");
    assert_eq!(
        h.get(header::CACHE_CONTROL).unwrap(),
        "public, max-age=3600"
    );
    assert_eq!(body, b"PNGDATA");
    for uri in [
        "/uploads/../arkyo.db",
        "/uploads/%2e%2e/arkyo.db",
        "/uploads/a/%2e%2e/%2e%2e/arkyo.db",
        "/uploads/nope.png",
        "/uploads/a",
    ] {
        let (s, _, _) = get(&env, uri, false).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{uri}");
    }
}

#[tokio::test]
async fn uploads_missing_dir_is_404() {
    let env = common::env().await;
    let (s, _, _) = get(&env, "/uploads/a/x.png", false).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn gzip_variant_when_accepted() {
    let env = common::env().await;
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/dist");
    let mut found = None;
    if let Ok(rd) = std::fs::read_dir(dist.join("assets")) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "js")
                && std::fs::metadata(&p)
                    .map(|m| m.len() > 512)
                    .unwrap_or(false)
            {
                found = Some(format!(
                    "/assets/{}",
                    p.file_name().unwrap().to_string_lossy()
                ));
            }
        }
    }
    let Some(uri) = found else {
        println!("skipped: no eligible .js asset embedded in web/dist");
        return;
    };
    let (s, h, _) = get(&env, &uri, true).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(h.get(header::CONTENT_ENCODING).unwrap(), "gzip");
}

#[tokio::test]
async fn missing_asset_is_404_not_index() {
    let env = common::env().await;
    for uri in ["/assets/index-0ld8u1ld.js", "/assets/style-gone.css"] {
        let (s, h, _) = get(&env, uri, true).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{uri}");
        assert!(!ctype(&h).starts_with("text/html"), "{uri}");
    }
}
