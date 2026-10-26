//! Embedded web app (`web/dist`), SPA fallback and `/uploads` files.

use std::path::{Path, PathBuf};

use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rust_embed::RustEmbed;

use crate::http::AppState;

#[derive(RustEmbed)]
#[folder = "../../web/dist"]
struct WebApp;

const NOT_BUILT: &str = "<!doctype html><meta charset=utf-8><title>Strata Arkyo</title>\
<body style=\"font:15px system-ui;padding:40px\">\
<h2>Web app not built</h2><p>Run <code>cd web &amp;&amp; npm install &amp;&amp; npm run build</code> \
then rebuild the server.</p>";

/// Gzipped copies of the text files of the web app (made by build.rs).
const GZIPPED: &[(&str, &[u8])] = include!(concat!(env!("OUT_DIR"), "/web_gz.rs"));

fn gzipped(path: &str) -> Option<&'static [u8]> {
    GZIPPED.iter().find(|(p, _)| *p == path).map(|(_, d)| *d)
}

/// Whether the client takes gzip (`Accept-Encoding`, not refused by `q=0`).
fn takes_gzip(headers: &HeaderMap) -> bool {
    headers
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .any(|item| {
            let mut parts = item.split(';');
            let name = parts.next().unwrap_or("").trim();
            let refused = parts.any(|p| {
                p.trim()
                    .strip_prefix("q=")
                    .and_then(|q| q.trim().parse::<f32>().ok())
                    .is_some_and(|q| q <= 0.0)
            });
            (name.eq_ignore_ascii_case("gzip") || name == "*") && !refused
        })
}

/// Embedded files, falling back to `index.html` for client routes.
async fn embedded(uri: Uri, headers: HeaderMap) -> Response {
    let raw = uri.path().trim_start_matches('/');
    let path = match WebApp::get(raw).filter(|_| !raw.is_empty()) {
        Some(_) => raw,
        // A bundle of another build (a tab opened before an update) fails
        // cleanly instead of receiving the HTML page as a script.
        None if raw.starts_with("assets/") => return not_found(),
        None => "index.html",
    };
    let Some(file) = WebApp::get(path) else {
        return (StatusCode::OK, Html(NOT_BUILT)).into_response();
    };
    let cache = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let kind = file.metadata.mimetype().to_string();
    let mut res = match gzipped(path).filter(|_| takes_gzip(&headers)) {
        Some(gz) => (
            [
                (header::CONTENT_TYPE, kind),
                (header::CONTENT_ENCODING, "gzip".to_string()),
            ],
            gz,
        )
            .into_response(),
        None => ([(header::CONTENT_TYPE, kind)], file.data).into_response(),
    };
    let h = res.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    if gzipped(path).is_some() {
        h.insert(header::VARY, HeaderValue::from_static("accept-encoding"));
    }
    res
}

fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

/// `GET /uploads/*` from `<data_dir>/uploads`, never leaving that folder.
async fn uploads(State(st): State<AppState>, uri: Uri) -> Response {
    let raw = uri.path().strip_prefix("/uploads/").unwrap_or("");
    let Ok(decoded) = percent_encoding::percent_decode_str(raw).decode_utf8() else {
        return not_found();
    };
    if decoded.is_empty()
        || decoded.contains('\0')
        || decoded.contains('\\')
        || decoded.split('/').any(|s| s == "..")
    {
        return not_found();
    }
    let root: PathBuf = st.data_dir.join("uploads");
    let Ok(root) = tokio::fs::canonicalize(&root).await else {
        return not_found();
    };
    let Ok(file) = tokio::fs::canonicalize(root.join(decoded.as_ref())).await else {
        return not_found();
    };
    if !file.starts_with(&root) {
        return not_found();
    }
    match tokio::fs::metadata(&file).await {
        Ok(m) if m.is_file() => {}
        _ => return not_found(),
    }
    let Ok(data) = tokio::fs::read(&file).await else {
        return not_found();
    };
    let kind = mime_guess::from_path(&file).first_or_octet_stream();
    (
        [
            (header::CONTENT_TYPE, kind.essence_str().to_string()),
            (header::CACHE_CONTROL, "public, max-age=3600".to_string()),
        ],
        data,
    )
        .into_response()
}

/// Everything outside `/api`: uploads, embedded files, SPA fallback.
pub fn routes(_data_dir: &Path) -> Router<AppState> {
    Router::new()
        .route("/uploads/{*path}", get(uploads))
        .fallback(embedded)
}
