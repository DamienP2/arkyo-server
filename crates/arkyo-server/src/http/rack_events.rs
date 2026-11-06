//! `GET /api/racks/:id/events`: the SSE stream of one rack
//! (arkyo:app/api/racks/[id]/events/route.ts), fed by
//! [`EventBus::publish_rack`](crate::events::EventBus::publish_rack).
//!
//! Same protocol as arkyo, which differs from `/api/events`:
//! - `401 Unauthorized` / `404 Not found` in plain text;
//! - a `: connected` SSE comment first, then `data: <payload>` frames;
//! - no heartbeat, no `clientId` filtering (the sender gets its own events).
//!
//! Streams end on server shutdown, like `/api/events`.

use std::convert::Infallible;

use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::stream::{self, StreamExt};

use super::{AppState, CurrentUser};

const CONNECTED: &[u8] = b": connected\n\n";

pub async fn stream(
    State(st): State<AppState>,
    user: Result<CurrentUser, Response>,
    Path(rack_id): Path<String>,
) -> Response {
    // arkyo: `requireTenantDb()` failure → plain-text 401, no permission check.
    if user.is_err() {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let rack: Result<Option<(String,)>, _> =
        sqlx::query_as(r#"SELECT "id" FROM "Rack" WHERE "id" = ?"#)
            .bind(&rack_id)
            .fetch_optional(&st.pool)
            .await;
    match rack {
        Ok(Some(_)) => {}
        Ok(None) => return (StatusCode::NOT_FOUND, "Not found").into_response(),
        Err(_) => return super::server_error(),
    }

    // Subscribed before the response goes out, as arkyo (`subscribeRack`
    // precedes the `: connected` enqueue).
    let sub = st.events.subscribe_rack(&rack_id);
    let connected = stream::once(async { Ok::<_, Infallible>(Bytes::from_static(CONNECTED)) });
    let live = stream::unfold(sub, |mut sub| async move {
        let data = sub.recv().await?;
        let frame = format!("data: {data}\n\n");
        Some((Ok::<_, Infallible>(Bytes::from(frame)), sub))
    });
    (
        [
            (header::CONTENT_TYPE, "text/event-stream"),
            (header::CACHE_CONTROL, "no-cache"),
            (header::CONNECTION, "keep-alive"),
        ],
        Body::from_stream(connected.chain(live).take_until(super::events::closed())),
    )
        .into_response()
}
