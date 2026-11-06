//! In-memory event bus feeding `GET /api/events`
//! (arkyo:lib/app-events.ts, `publishAppUpdate`).
//!
//! Payloads are `{"type":"update","entity":..,"action":..,"id":..}` plus the
//! optional metadata of arkyo's `AppUpdateMeta` (`projectId`, `rackId`,
//! `itemId`, `clientId`, `data`); absent fields are omitted. Single site: no
//! tenant tag, no Redis.

use serde_json::{json, Map, Value};
use tokio::sync::broadcast;

const CAPACITY: usize = 256;

/// Optional metadata of an update (arkyo:lib/app-events.ts:47-60), serialized
/// in camelCase. `None` fields are omitted; so are empty ids, like arkyo's
/// truthy checks (`if (meta?.projectId)`). `data` is kept whenever it is
/// `Some`, `null` included (arkyo: `meta?.data !== undefined`).
#[derive(Debug, Clone, Default)]
pub struct EventMeta {
    pub project_id: Option<String>,
    pub rack_id: Option<String>,
    pub item_id: Option<String>,
    pub client_id: Option<String>,
    pub data: Option<Value>,
}

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
        self.publish_meta(entity, action, id, EventMeta::default());
    }

    /// [`Self::publish`] with arkyo's metadata (`publishAppUpdate(entity,
    /// action, id, meta)`).
    pub fn publish_meta(&self, entity: &str, action: &str, id: Option<&str>, meta: EventMeta) {
        let mut m = Map::new();
        m.insert("type".into(), json!("update"));
        m.insert("entity".into(), json!(entity));
        m.insert("action".into(), json!(action));
        if let Some(id) = id {
            m.insert("id".into(), json!(id));
        }
        for (key, value) in [
            ("projectId", meta.project_id),
            ("rackId", meta.rack_id),
            ("itemId", meta.item_id),
            ("clientId", meta.client_id),
        ] {
            if let Some(v) = value.filter(|v| !v.is_empty()) {
                m.insert(key.into(), Value::String(v));
            }
        }
        if let Some(data) = meta.data {
            m.insert("data".into(), data);
        }
        let _ = self.tx.send(Value::Object(m).to_string());
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }
}
