//! arkyo:app/api/tenant/parametres/numbering/route.ts: cable numbering keys
//! of `AppConfig` (the allow-list is arkyo's).

use arkyo_core::permissions::Level;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::Response;

use super::application::{patch_map, read_map};
use crate::http::{AppState, CurrentUser};

/// Also the `AppConfig` keys of the backup (`BACKUP_APP_CONFIG_KEYS`).
pub(super) const NUMBERING_KEYS: [&str; 15] = [
    "cable_numbering_convention",
    "cable_pad",
    "cable_sep1",
    "cable_sep2",
    "cable_separator",
    "cable_suffix_separator",
    "cable_include_rack",
    "cable_template",
    "cable_template_enabled",
    // legacy names
    "cable_numbering_pad",
    "cable_numbering_sep1",
    "cable_numbering_sep2",
    "cable_numbering_include_rack",
    "cable_numbering_template",
    "cable_numbering_template_enabled",
];

pub async fn get(State(st): State<AppState>, _u: CurrentUser) -> Response {
    read_map(&st.pool, Some(&NUMBERING_KEYS)).await
}

pub async fn patch(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    patch_map(&st, &u, Level::Write, Some(&NUMBERING_KEYS), body).await
}
