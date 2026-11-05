//! `POST /api/upload` and `POST /api/upload/from-url`
//! (arkyo:app/api/upload/route.ts and from-url/route.ts).
//!
//! Files land in `<data>/uploads/<folder>/<uuid>.<ext>`; the extension comes
//! from the validated MIME type, never from the client file name.
//!
//! Differences from arkyo, on purpose:
//! - SVG files are rebuilt from an allow-list of elements and attributes
//!   (DOMPurify-like) and rejected only when they are not valid XML; served
//!   SVG also carries a sandbox CSP;
//! - `from-url` does not block private addresses (LAN application) and its
//!   timeout is 15 s instead of 10 s.

use std::io::Read;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use super::{error, server_error, AppState, CurrentUser};

const MB: usize = 1024 * 1024;
const MAX_IMAGE: usize = 5 * MB;
const MAX_PDF: usize = 10 * MB;
/// Request body cap for `/api/upload`: the PDF limit plus multipart framing.
pub const MAX_BODY: usize = MAX_PDF + MB;
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

const SVG: &str = "image/svg+xml";

fn ext_for(mime: &str) -> Option<&'static str> {
    Some(match mime {
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/webp" => ".webp",
        SVG => ".svg",
        "image/gif" => ".gif",
        "application/pdf" => ".pdf",
        _ => return None,
    })
}

fn bad(msg: &str) -> Response {
    error(StatusCode::BAD_REQUEST, msg)
}

fn too_big(limit: usize) -> Response {
    bad(&format!("Fichier trop lourd (max {} Mo)", limit / MB))
}

/// arkyo `sanitizeFolder`: keeps `[A-Za-z0-9_-]` only (`brands/logos` becomes
/// `brandslogos`), `default` when nothing is left. Never rejects.
fn sanitize_folder(raw: Option<&str>, default: &str) -> String {
    let mut f = raw.unwrap_or("").to_string();
    f.retain(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if f.is_empty() {
        default.to_string()
    } else {
        f
    }
}

const SVG_NS: &str = "http://www.w3.org/2000/svg";
const XLINK_NS: &str = "http://www.w3.org/1999/xlink";
const XML_NS: &str = "http://www.w3.org/XML/1998/namespace";

/// SVG elements kept by the sanitizer. Everything else (script, foreignObject,
/// set/animate*, image, unknown) is dropped with its subtree.
const ALLOWED_ELEMENTS: &[&str] = &[
    "svg",
    "a",
    "g",
    "defs",
    "symbol",
    "use",
    "switch",
    "view",
    "title",
    "desc",
    "style",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "linearGradient",
    "radialGradient",
    "stop",
    "pattern",
    "clipPath",
    "mask",
    "marker",
    "filter",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
];

/// CSS/attribute value check: no `@import`, `expression(`, `javascript:`,
/// escapes, and every `url(...)` must point to a `#fragment`.
fn css_safe(v: &str) -> bool {
    let l = v.to_ascii_lowercase();
    if l.contains("@import")
        || l.contains("expression(")
        || l.contains("javascript:")
        || l.contains("behavior")
        || l.contains('\\')
    {
        return false;
    }
    let mut rest = l.as_str();
    while let Some(i) = rest.find("url(") {
        rest = &rest[i + 4..];
        let arg = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '"' || c == '\'');
        if !arg.starts_with('#') {
            return false;
        }
    }
    true
}

fn escape(s: &str, out: &mut String) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
}

fn clean_node(node: roxmltree::Node, out: &mut String) {
    use roxmltree::NodeType;
    match node.node_type() {
        NodeType::Text => escape(node.text().unwrap_or(""), out),
        NodeType::Element => {
            let t = node.tag_name();
            if t.namespace() != Some(SVG_NS) || !ALLOWED_ELEMENTS.contains(&t.name()) {
                return;
            }
            let name = t.name();
            if name == "style" {
                let css: String = node.children().filter_map(|c| c.text()).collect();
                if !css_safe(&css) {
                    return;
                }
            }
            out.push('<');
            out.push_str(name);
            if node
                .parent()
                .is_some_and(|p| p.node_type() == NodeType::Root)
            {
                out.push_str(" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"");
            }
            for a in node.attributes() {
                let n = a.name();
                let qname = match a.namespace() {
                    None => n.to_string(),
                    Some(XLINK_NS) if n == "href" => "xlink:href".to_string(),
                    Some(XML_NS) if n == "space" => "xml:space".to_string(),
                    Some(_) => continue,
                };
                let v = a.value();
                if n.is_empty()
                    || !n
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                    || n.to_ascii_lowercase().starts_with("on")
                    || n == "xmlns"
                {
                    continue;
                }
                if n == "href" && !v.trim().starts_with('#') {
                    continue;
                }
                if !css_safe(v) {
                    continue;
                }
                out.push(' ');
                out.push_str(&qname);
                out.push_str("=\"");
                escape(v, out);
                out.push('"');
            }
            out.push('>');
            for c in node.children() {
                clean_node(c, out);
            }
            out.push_str("</");
            out.push_str(name);
            out.push('>');
        }
        _ => {}
    }
}

/// Rebuilds the SVG keeping only allow-listed elements and safe attributes
/// (no event handlers, links only to `#fragments`, no external `url()`).
/// `None` when the document is not valid XML or its root is not `<svg>`.
fn sanitize_svg(data: &[u8]) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(data).ok()?;
    let doc = roxmltree::Document::parse(text).ok()?;
    let root = doc.root_element();
    if root.tag_name().namespace() != Some(SVG_NS) || root.tag_name().name() != "svg" {
        return None;
    }
    let mut out = String::new();
    clean_node(root, &mut out);
    Some(out.into_bytes())
}

const SVG_REJECTED: &str =
    "Le fichier SVG est invalide ou a été entièrement rejeté par le filtre de sécurité";

#[allow(clippy::result_large_err)]
async fn store(st: &AppState, folder: &str, ext: &str, data: &[u8]) -> Result<String, Response> {
    let dir = st.data_dir.join("uploads").join(folder);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        tracing::error!("upload mkdir: {e}");
        server_error()
    })?;
    let name = format!("{}{ext}", uuid::Uuid::new_v4());
    tokio::fs::write(dir.join(&name), data).await.map_err(|e| {
        tracing::error!("upload write: {e}");
        server_error()
    })?;
    Ok(format!("/uploads/{folder}/{name}"))
}

pub async fn upload(State(st): State<AppState>, _: CurrentUser, mut mp: Multipart) -> Response {
    let mut folder_raw: Option<String> = None;
    let mut file: Option<(String, Bytes)> = None;
    loop {
        let field = match mp.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => return too_big(MAX_PDF),
            Err(_) => return bad("Aucun fichier"),
        };
        match field.name() {
            Some("folder") => folder_raw = field.text().await.ok(),
            Some("file") if file.is_none() && field.file_name().is_some() => {
                let ctype = field.content_type().unwrap_or("").to_string();
                match field.bytes().await {
                    Ok(b) => file = Some((ctype, b)),
                    Err(e) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => {
                        return too_big(MAX_PDF)
                    }
                    Err(_) => return bad("Aucun fichier"),
                }
            }
            _ => {}
        }
    }
    let folder = sanitize_folder(folder_raw.as_deref(), "misc");
    let Some((ctype, data)) = file else {
        return bad("Aucun fichier");
    };
    let Some(ext) = ext_for(&ctype) else {
        return bad("Type non supporté (JPEG, PNG, WebP, SVG, GIF, PDF)");
    };
    let limit = if ctype == "application/pdf" {
        MAX_PDF
    } else {
        MAX_IMAGE
    };
    if data.len() > limit {
        return too_big(limit);
    }
    let data = if ctype == SVG {
        match sanitize_svg(&data) {
            Some(clean) => Bytes::from(clean),
            None => return bad(SVG_REJECTED),
        }
    } else {
        data
    };
    match store(&st, &folder, ext, &data).await {
        Ok(url) => Json(json!({ "url": url })).into_response(),
        Err(r) => r,
    }
}

/// Raster types accepted from a remote URL (no SVG).
fn raster_ext(mime: &str) -> Option<&'static str> {
    match mime {
        "image/jpeg" | "image/png" | "image/webp" | "image/gif" => ext_for(mime),
        _ => None,
    }
}

enum Fetched {
    Image(&'static str, Vec<u8>),
    Fail(String),
}

/// Blocking download: 15 s overall timeout, body read capped at the image
/// limit while streaming.
fn fetch(url: &str) -> Fetched {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(FETCH_TIMEOUT))
        .http_status_as_error(false)
        .build()
        .into();
    let mut res = match agent.get(url).call() {
        Ok(r) => r,
        Err(ureq::Error::Timeout(_)) => {
            return Fetched::Fail("Le téléchargement a expiré (15 s)".into())
        }
        Err(_) => return Fetched::Fail("Impossible de joindre cette URL".into()),
    };
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        return Fetched::Fail(format!("Téléchargement impossible (HTTP {status})"));
    }
    let ctype = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let Some(ext) = raster_ext(&ctype) else {
        return Fetched::Fail(
            "Type non supporté. Acceptés : JPEG, PNG, WebP, GIF (SVG interdit par URL)".into(),
        );
    };
    let too_big_msg = format!("Fichier trop lourd (max {} Mo)", MAX_IMAGE / MB);
    let declared = res
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok());
    if declared.is_some_and(|n| n > MAX_IMAGE) {
        return Fetched::Fail(too_big_msg);
    }
    let mut buf = Vec::new();
    let read = res
        .body_mut()
        .as_reader()
        .take(MAX_IMAGE as u64 + 1)
        .read_to_end(&mut buf);
    if let Err(e) = read {
        return Fetched::Fail(if e.kind() == std::io::ErrorKind::TimedOut {
            "Le téléchargement a expiré (15 s)".into()
        } else {
            "Impossible de joindre cette URL".into()
        });
    }
    if buf.len() > MAX_IMAGE {
        return Fetched::Fail(too_big_msg);
    }
    Fetched::Image(ext, buf)
}

/// URL scheme (`[A-Za-z][A-Za-z0-9+.-]*:` prefix), lowercased.
fn scheme_of(url: &str) -> Option<String> {
    let (s, rest) = url.split_once(':')?;
    let mut chars = s.chars();
    let ok = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    (ok && !rest.is_empty()).then(|| s.to_ascii_lowercase())
}

pub async fn from_url(State(st): State<AppState>, _: CurrentUser, body: Bytes) -> Response {
    let invalid = || bad("URL invalide ou paramètres manquants");
    let Ok(Value::Object(m)) = serde_json::from_slice::<Value>(&body) else {
        return invalid();
    };
    let Some(url) = m.get("url").and_then(Value::as_str).map(str::trim) else {
        return invalid();
    };
    let folder_raw = match m.get("folder") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if (1..=64).contains(&s.chars().count()) => Some(s.as_str()),
        Some(_) => return invalid(),
    };
    let Some(scheme) = scheme_of(url) else {
        return invalid();
    };
    if scheme != "http" && scheme != "https" {
        return bad("Seuls les protocoles HTTP et HTTPS sont acceptés");
    }
    if url.parse::<ureq::http::Uri>().is_err() {
        return bad("URL invalide");
    }
    let folder = sanitize_folder(folder_raw, "equipment");
    let owned = url.to_string();
    let fetched = tokio::task::spawn_blocking(move || fetch(&owned)).await;
    match fetched {
        Ok(Fetched::Image(ext, data)) => match store(&st, &folder, ext, &data).await {
            Ok(url) => Json(json!({ "url": url })).into_response(),
            Err(r) => r,
        },
        Ok(Fetched::Fail(msg)) => bad(&msg),
        Err(_) => server_error(),
    }
}
