//! Originating browser tab of a mutation (arkyo:lib/client-id.ts,
//! `readClientIdFromRequest`): the front sends `X-Client-Id` on every request
//! and the routes forward it to the event (`EventMeta::client_id`) so the tab
//! can ignore its own echo.

use axum::http::HeaderMap;

/// Header read by arkyo (`h.get("x-client-id")`).
pub const HEADER: &str = "x-client-id";

/// Longest id kept. arkyo only refuses an empty value; the front sends a
/// UUID (36 characters). arkyo-server: bound added so an arbitrary header is
/// never echoed into every event stream.
pub const MAX_LEN: usize = 128;

/// The client id of the request: `None` when the header is absent, empty,
/// longer than [`MAX_LEN`] or not visible ASCII.
pub fn read(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(HEADER)?.to_str().ok()?;
    (!v.is_empty() && v.len() <= MAX_LEN).then(|| v.to_string())
}
