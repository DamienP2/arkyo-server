//! Identifier and timestamp helpers shared by all tables.

/// A cuid v1 (25 characters, starts with `c`).
pub fn new_id() -> String {
    cuid::cuid1().expect("cuid generation")
}

/// Current UTC time as ISO 8601 with milliseconds, e.g. `2026-10-26T10:00:00.000Z`.
pub fn now_iso() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_format() {
        assert!(new_id().starts_with('c') && new_id().len() == 25);
        let t = now_iso();
        assert_eq!(t.len(), 24);
        assert!(t.ends_with('Z') && t.as_bytes()[19] == b'.');
    }
}
