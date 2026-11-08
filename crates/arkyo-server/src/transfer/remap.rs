//! Helpers of the import (spec 2026-11-07-sauvegardes-design §4): the rows
//! of each root of a file (a file may hold several), and the renewal of ids
//! of a *Copy*.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde_json::Value;

use super::graph::{owned_tables_in_insert_order, PROJECT_TABLES, RACK_TABLES};
use super::{Bundle, RootKind, Row};

// ── Partition of a file by root ─────────────────────────────────────────────

/// Rows of a bundle, by table, as indices into `Bundle::tables`.
pub(super) type Part = BTreeMap<String, BTreeSet<usize>>;

pub(super) fn text<'a>(row: &'a Row, col: &str) -> Option<&'a str> {
    row.get(col).and_then(Value::as_str)
}

/// The owned rows of one root in a bundle, by the rules of `graph.rs`
/// applied to the file's rows (a file may hold several roots).
pub(super) struct Parter<'a> {
    b: &'a Bundle,
    pub(super) part: Part,
}

impl<'a> Parter<'a> {
    pub(super) fn new(b: &'a Bundle) -> Self {
        Parter {
            b,
            part: Part::new(),
        }
    }

    fn pick(&mut self, table: &str, pred: impl Fn(&Row) -> bool) {
        let Some(rows) = self.b.tables.get(table) else {
            return;
        };
        for (i, r) in rows.iter().enumerate() {
            if pred(r) {
                self.part.entry(table.to_string()).or_default().insert(i);
            }
        }
    }

    /// `col` of the rows picked in `table`.
    fn values(&self, table: &str, col: &str) -> HashSet<String> {
        let (Some(rows), Some(picked)) = (self.b.tables.get(table), self.part.get(table)) else {
            return HashSet::new();
        };
        picked
            .iter()
            .filter_map(|i| text(&rows[*i], col))
            .map(str::to_string)
            .collect()
    }

    fn in_set(row: &Row, col: &str, set: &HashSet<String>) -> bool {
        text(row, col).is_some_and(|v| set.contains(v))
    }

    pub(super) fn racks(&mut self, racks: &HashSet<String>) {
        if racks.is_empty() {
            return;
        }
        self.pick("Rack", |r| Self::in_set(r, "id", racks));
        for t in RACK_TABLES {
            self.pick(t, |r| Self::in_set(r, "rackId", racks));
        }
        let slots = self.values("RackSlot", "id");
        self.pick("RackSlotPanelRow", |r| Self::in_set(r, "slotId", &slots));
        let conns = self.values("RackConnection", "id");
        self.pick("AuditLog", |r| match text(r, "entityType") {
            Some("Rack") => Self::in_set(r, "entityId", racks),
            Some("RackConnection") => Self::in_set(r, "entityId", &conns),
            _ => false,
        });
    }

    fn root(mut self, kind: RootKind, id: &str) -> Part {
        let is = |r: &Row, col: &str| text(r, col) == Some(id);
        match kind {
            RootKind::Project => {
                self.pick("Project", |r| is(r, "id"));
                for t in PROJECT_TABLES {
                    self.pick(t, |r| is(r, "projectId"));
                }
                let rigs = self.values("RigConfig", "id");
                let locations = self.values("Location", "id");
                self.pick("RigRack", |r| Self::in_set(r, "rigConfigId", &rigs));
                let mut racks = self.values("RigRack", "rackId");
                if let Some(rows) = self.b.tables.get("Rack") {
                    racks.extend(
                        rows.iter()
                            .filter(|r| Self::in_set(r, "locationId", &locations))
                            .filter_map(|r| text(r, "id"))
                            .map(str::to_string),
                    );
                }
                self.racks(&racks);
                let conns = self.values("ProjectConnection", "id");
                self.pick("AuditLog", |r| match text(r, "entityType") {
                    Some("Project") => is(r, "entityId"),
                    Some("ProjectConnection") => Self::in_set(r, "entityId", &conns),
                    _ => false,
                });
            }
            RootKind::Rack => {
                self.racks(&HashSet::from([id.to_string()]));
            }
            RootKind::Rig => {
                self.pick("RigConfig", |r| is(r, "id"));
                self.pick("RigRack", |r| is(r, "rigConfigId"));
                let racks = self.values("RigRack", "rackId");
                self.racks(&racks);
            }
            RootKind::Panel => {
                self.pick("Panel", |r| is(r, "id"));
                self.pick("PanelSlot", |r| is(r, "panelId"));
            }
        }
        self.part
    }
}

pub(super) fn partition(b: &Bundle, kind: RootKind, id: &str) -> Part {
    Parter::new(b).root(kind, id)
}

/// The tables of a root's graph, parents first.
pub(super) fn root_tables(kind: RootKind) -> &'static [&'static str] {
    match kind {
        RootKind::Panel => &["Panel", "PanelSlot"],
        _ => owned_tables_in_insert_order(),
    }
}

/// The ids of a part, by table.
pub(super) fn part_ids(b: &Bundle, part: &Part) -> HashMap<String, HashSet<String>> {
    part.iter()
        .map(|(t, idx)| {
            let rows = &b.tables[t];
            (
                t.clone(),
                idx.iter()
                    .filter_map(|i| text(&rows[*i], "id"))
                    .map(str::to_string)
                    .collect(),
            )
        })
        .collect()
}

// ── Copy: new ids ───────────────────────────────────────────────────────────

fn id_char(b: u8) -> bool {
    b.is_ascii_lowercase() || b.is_ascii_digit()
}

/// `s` with every old id replaced by its new one: the whole value, or each
/// cuid (`c[a-z0-9]{24}`, a maximal run of `[a-z0-9]`) found inside it (ids
/// kept in JSON text). `None` when nothing changes.
pub(super) fn remap_text(s: &str, map: &HashMap<String, String>) -> Option<String> {
    if let Some(new) = map.get(s) {
        return Some(new.clone());
    }
    let bytes = s.as_bytes();
    let mut out: Option<String> = None;
    let mut last = 0;
    let mut i = 0;
    while i < bytes.len() {
        if !id_char(bytes[i]) {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && id_char(bytes[i]) {
            i += 1;
        }
        if i - start == 25 && bytes[start] == b'c' {
            if let Some(new) = map.get(&s[start..i]) {
                let o = out.get_or_insert_with(|| String::with_capacity(s.len()));
                o.push_str(&s[last..start]);
                o.push_str(new);
                last = i;
            }
        }
    }
    out.map(|mut o| {
        o.push_str(&s[last..]);
        o
    })
}

pub(super) fn remap_row(row: &mut Row, map: &HashMap<String, String>) {
    for v in row.values_mut() {
        if let Value::String(s) = v {
            if let Some(new) = remap_text(s, map) {
                *s = new;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remap_replaces_whole_values_and_cuids_in_text() {
        let a = "ckabcdefghijklmnopqrstuvw".to_string();
        let b = "cz00000000000000000000001".to_string();
        assert_eq!((a.len(), b.len()), (25, 25));
        let map: HashMap<String, String> = [
            (a.clone(), "cnew0000000000000000000001".to_string()),
            ("p1".to_string(), "np1".to_string()),
        ]
        .into();
        assert_eq!(remap_text("p1", &map).as_deref(), Some("np1"));
        assert_eq!(
            remap_text(&format!(r#"[{{"slotId":"{a}"}},"{a}x","é{a}"]"#), &map).as_deref(),
            Some(
                r#"[{"slotId":"cnew0000000000000000000001"},"ckabcdefghijklmnopqrstuvwx","écnew0000000000000000000001"]"#
            )
        );
        assert_eq!(remap_text(&b, &map), None);
        assert_eq!(remap_text("rien", &map), None);
    }
}
