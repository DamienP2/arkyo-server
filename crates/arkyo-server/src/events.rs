//! In-memory event bus feeding `GET /api/events`
//! (arkyo:lib/app-events.ts, `publishAppUpdate`).
//!
//! Payloads are `{"type":"update","entity":..,"action":..,"id":..}` plus the
//! optional metadata of arkyo's `AppUpdateMeta` (`projectId`, `rackId`,
//! `itemId`, `clientId`, `data`); absent fields are omitted. Single site: no
//! tenant tag, no Redis.
//!
//! The same [`EventBus`] also carries the per-rack bus feeding
//! `GET /api/racks/:id/events` (arkyo:lib/rack-events.ts, `publishRackUpdate`
//! / `subscribeRack`), a separate set of listeners keyed by rack id: app
//! updates never reach a rack stream, and rack events never reach
//! `/api/events`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Map, Value};
use tokio::sync::{broadcast, mpsc};

/// Events an `/api/events` subscriber may fall behind before it is dropped
/// (its stream ends and the browser's `EventSource` reconnects).
///
/// arkyo-server: files bornées ; arkyo empilait sans limite dans le
/// `ReadableStream` de chaque abonné, un client lent faisait grossir la
/// mémoire du serveur.
pub const APP_QUEUE: usize = 4096;

/// Events queued for each per-rack subscriber; a full queue drops the
/// subscriber, like [`APP_QUEUE`].
pub const RACK_QUEUE: usize = 4096;

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

/// Listeners of each rack (arkyo:lib/event-bus.ts, `rackListeners`:
/// `Map<rackId, Set<Listener>>`).
type RackListeners = HashMap<String, HashMap<u64, mpsc::Sender<Arc<str>>>>;

#[derive(Default)]
struct RackBus {
    listeners: Mutex<RackListeners>,
    next_id: AtomicU64,
}

impl RackBus {
    /// A listener never panics while holding the lock, but stay usable anyway.
    fn lock(&self) -> std::sync::MutexGuard<'_, RackListeners> {
        self.listeners.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<String>,
    racks: Arc<RackBus>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            tx: broadcast::channel(APP_QUEUE).0,
            racks: Arc::default(),
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

    /// Publishes `payload` (`{"type": "slot_added", ...}`, annexe A §3.3 of
    /// the phase 4 inventory) to the open streams of `rack_id`, as arkyo's
    /// `publishRackUpdate(rackId, payload)`: serialized once, sent as is (no
    /// envelope, no `clientId` filtering). Never blocks and never fails: with
    /// no subscriber the event is simply dropped.
    pub fn publish_rack(&self, rack_id: &str, payload: Value) {
        let mut listeners = self.racks.lock();
        // arkyo: `if (!shouldPublishRack(rackId)) return;` (no serialization).
        let Some(subs) = listeners.get_mut(rack_id) else {
            return;
        };
        let data: Arc<str> = payload.to_string().into();
        // A closed stream unsubscribes (arkyo: `enqueue` failure → `unsub()`).
        // arkyo-server: une file pleine aussi : l'émetteur retiré, le flux
        // se termine après les évènements en file et le client se reconnecte.
        subs.retain(|_, tx| tx.try_send(data.clone()).is_ok());
        if subs.is_empty() {
            listeners.remove(rack_id);
        }
    }

    /// Subscribes to the events of `rack_id` (arkyo: `subscribeRack`). Every
    /// event is delivered, in order, until [`RACK_QUEUE`] are pending (the
    /// subscription then ends); dropping the subscription unsubscribes.
    pub fn subscribe_rack(&self, rack_id: &str) -> RackSubscription {
        let (tx, rx) = mpsc::channel(RACK_QUEUE);
        let id = self.racks.next_id.fetch_add(1, Ordering::Relaxed);
        self.racks
            .lock()
            .entry(rack_id.to_string())
            .or_default()
            .insert(id, tx);
        RackSubscription {
            bus: self.racks.clone(),
            rack_id: rack_id.to_string(),
            id,
            rx,
        }
    }
}

/// A listener of one rack, from [`EventBus::subscribe_rack`]. Receives the
/// serialized payloads; unsubscribes on drop.
pub struct RackSubscription {
    bus: Arc<RackBus>,
    rack_id: String,
    id: u64,
    rx: mpsc::Receiver<Arc<str>>,
}

impl RackSubscription {
    /// The next payload. Pending forever when nothing is published: the
    /// stream ends on shutdown, when the client leaves, or (`None`) after a
    /// full queue dropped this subscriber.
    pub async fn recv(&mut self) -> Option<Arc<str>> {
        self.rx.recv().await
    }
}

impl Drop for RackSubscription {
    fn drop(&mut self) {
        let mut listeners = self.bus.lock();
        if let Some(subs) = listeners.get_mut(&self.rack_id) {
            subs.remove(&self.id);
            if subs.is_empty() {
                listeners.remove(&self.rack_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// A subscriber that does not read is dropped once its queue is full:
    /// it gets what was queued, then the end of the stream (the client
    /// reconnects), and the rack has no listener left.
    #[tokio::test]
    async fn full_rack_queue_drops_the_subscriber() {
        let bus = EventBus::new();
        let mut slow = bus.subscribe_rack("r");
        for i in 0..=RACK_QUEUE {
            bus.publish_rack("r", json!({ "i": i }));
        }
        assert!(!bus.racks.lock().contains_key("r"));
        for i in 0..RACK_QUEUE {
            let got = slow.recv().await.expect("payload en file");
            assert_eq!(&*got, json!({ "i": i }).to_string());
        }
        let end = tokio::time::timeout(Duration::from_secs(1), slow.recv()).await;
        assert_eq!(end.expect("fin du flux attendue"), None);

        // A new subscriber of the same rack is served normally.
        let mut fresh = bus.subscribe_rack("r");
        bus.publish_rack("r", json!({ "type": "rack_cleared" }));
        assert_eq!(&*fresh.recv().await.unwrap(), r#"{"type":"rack_cleared"}"#);
    }

    /// The last unsubscription removes the rack's entry.
    #[tokio::test]
    async fn last_unsubscription_removes_the_rack_entry() {
        let bus = EventBus::new();
        let a = bus.subscribe_rack("r");
        let b = bus.subscribe_rack("r");
        drop(a);
        assert_eq!(bus.racks.lock().get("r").map(HashMap::len), Some(1));
        drop(b);
        assert!(bus.racks.lock().is_empty());
    }
}
