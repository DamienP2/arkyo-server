//! In-memory event bus feeding `GET /api/events`
//! (arkyo:lib/app-events.ts, `publishAppUpdate`).
//!
//! Payloads are `{"type":"update","entity":..,"action":..,"id":..}` (`id`
//! omitted when absent). Single site: no tenant tag, no Redis.

use serde_json::{json, Value};
use tokio::sync::broadcast;

const CAPACITY: usize = 256;

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<String>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            tx: broadcast::channel(CAPACITY).0,
        }
    }

    /// Publishes an update to every open stream. Never blocks and never
    /// fails: with no subscriber the event is simply dropped.
    pub fn publish(&self, entity: &str, action: &str, id: Option<&str>) {
        let mut payload = json!({ "type": "update", "entity": entity, "action": action });
        if let (Some(id), Value::Object(m)) = (id, &mut payload) {
            m.insert("id".into(), Value::String(id.into()));
        }
        let _ = self.tx.send(payload.to_string());
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }
}
