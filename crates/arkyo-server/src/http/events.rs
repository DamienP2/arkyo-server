//! `GET /api/events`: the app-wide SSE stream (arkyo:app/api/events/route.ts).
//!
//! Sends `connected` at once, then the events of the [`EventBus`](crate::events::EventBus)
//! as they are published, and a `ping` every 25 s.
//!
//! Streams end on [`close_all`] (server shutdown): graceful shutdown waits for
//! open connections, and an endless stream would hold it forever. The per-rack
//! streams (`rack_events.rs`) end on it too.

use std::convert::Infallible;
use std::sync::LazyLock;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use futures_util::stream::{self, StreamExt};
use tokio::sync::{broadcast, watch};

use super::{AppState, CurrentUser};

const CONNECTED: &[u8] = b"data: {\"type\":\"connected\"}\n\n";
const PING: &[u8] = b"data: {\"type\":\"ping\"}\n\n";
const PING_EVERY: Duration = Duration::from_secs(25);

static SHUTDOWN: LazyLock<watch::Sender<bool>> = LazyLock::new(|| watch::channel(false).0);

/// Ends every open event stream (and any opened afterwards).
pub fn close_all() {
    SHUTDOWN.send_replace(true);
}

/// Resolves once [`close_all`] has been called.
pub(super) async fn closed() {
    let mut rx = SHUTDOWN.subscribe();
    let _ = rx.wait_for(|closed| *closed).await;
}

pub async fn stream(State(st): State<AppState>, _: CurrentUser) -> Response {
    let rx = st.events.subscribe();
    let connected = stream::once(async { Ok::<_, Infallible>(Bytes::from_static(CONNECTED)) });
    // Events and pings share one stream: a ping is due 25 s after the last frame.
    let live = stream::unfold(rx, |mut rx| async move {
        loop {
            match tokio::time::timeout(PING_EVERY, rx.recv()).await {
                Ok(Ok(data)) => {
                    let frame = format!("data: {data}\n\n");
                    return Some((Ok::<_, Infallible>(Bytes::from(frame)), rx));
                }
                // A slow client missed some events: keep going with the newest.
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(broadcast::error::RecvError::Closed)) => return None,
                Err(_) => return Some((Ok(Bytes::from_static(PING)), rx)),
            }
        }
    });
    (
        [
            (header::CONTENT_TYPE, "text/event-stream"),
            (header::CACHE_CONTROL, "no-cache, no-transform"),
            (header::CONNECTION, "keep-alive"),
            (header::HeaderName::from_static("x-accel-buffering"), "no"),
        ],
        Body::from_stream(connected.chain(live).take_until(closed())),
    )
        .into_response()
}
