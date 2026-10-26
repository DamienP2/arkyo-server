//! `GET /api/events`: the app-wide SSE stream (arkyo:app/api/events/route.ts).
//!
//! Sends `connected` at once, then a `ping` every 25 s. Phase 1 publishes no
//! domain events yet; the stream keeps the shell's `AppSync` connected.
//!
//! Streams end on [`close_all`] (server shutdown): graceful shutdown waits for
//! open connections, and an endless stream would hold it forever.

use std::convert::Infallible;
use std::sync::LazyLock;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use futures_util::stream::{self, StreamExt};
use tokio::sync::watch;

use super::CurrentUser;

const CONNECTED: &[u8] = b"data: {\"type\":\"connected\"}\n\n";
const PING: &[u8] = b"data: {\"type\":\"ping\"}\n\n";
const PING_EVERY: Duration = Duration::from_secs(25);

static SHUTDOWN: LazyLock<watch::Sender<bool>> = LazyLock::new(|| watch::channel(false).0);

/// Ends every open event stream (and any opened afterwards).
pub fn close_all() {
    SHUTDOWN.send_replace(true);
}

async fn closed() {
    let mut rx = SHUTDOWN.subscribe();
    let _ = rx.wait_for(|closed| *closed).await;
}

pub async fn stream(_: CurrentUser) -> Response {
    let connected = stream::once(async { Ok::<_, Infallible>(Bytes::from_static(CONNECTED)) });
    let pings = stream::unfold((), |()| async {
        tokio::time::sleep(PING_EVERY).await;
        Some((Ok::<_, Infallible>(Bytes::from_static(PING)), ()))
    });
    (
        [
            (header::CONTENT_TYPE, "text/event-stream"),
            (header::CACHE_CONTROL, "no-cache, no-transform"),
            (header::CONNECTION, "keep-alive"),
            (header::HeaderName::from_static("x-accel-buffering"), "no"),
        ],
        Body::from_stream(connected.chain(pings).take_until(closed())),
    )
        .into_response()
}
