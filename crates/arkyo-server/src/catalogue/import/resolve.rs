//! Resolution of text references (brands, categories) to existing items
//! (arkyo:lib/services/import/resolve-refs.ts). Pure.
//!
//! The brand / category columns hold names: each distinct value is matched
//! exactly (normalized), then fuzzily (Levenshtein), against the existing
//! items; the caller then links or creates.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::detect::{normalize_token, similarity};
use super::{js_trim, round4};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RefItem {
    pub id: String,
    pub name: String,
    /// `"tenant"` (every item of the single catalogue).
    pub source: &'static str,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RefMatch {
    pub value: String,
    #[serde(rename = "match")]
    pub matched: Option<RefItem>,
    pub score: f64,
    pub exact: bool,
}

const FUZZY_THRESHOLD: f64 = 0.82;

/// `distinctValues`: non-empty values, first spelling kept, deduplicated
/// on the normalized form.
pub fn distinct_values<'a>(values: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for v in values {
        let t = js_trim(v);
        if t.is_empty() {
            continue;
        }
        let key = normalize_token(t);
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        out.push(t.to_string());
    }
    out
}

/// `resolveRefs`: exact (normalized) first, then the best fuzzy match
/// above the threshold.
pub fn resolve_refs(values: &[String], existing: &[RefItem]) -> Vec<RefMatch> {
    let mut exact: HashMap<String, &RefItem> = HashMap::new();
    for item in existing {
        exact.entry(normalize_token(&item.name)).or_insert(item);
    }
    values
        .iter()
        .map(|value| {
            let key = normalize_token(value);
            if let Some(hit) = exact.get(&key) {
                return RefMatch {
                    value: value.clone(),
                    matched: Some((*hit).clone()),
                    score: 1.0,
                    exact: true,
                };
            }
            let mut best: Option<&RefItem> = None;
            let mut best_score = 0.0;
            for item in existing {
                let s = similarity(&key, &normalize_token(&item.name));
                if s > best_score {
                    best_score = s;
                    best = Some(item);
                }
            }
            RefMatch {
                value: value.clone(),
                matched: best.filter(|_| best_score >= FUZZY_THRESHOLD).cloned(),
                score: round4(best_score),
                exact: false,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, name: &str) -> RefItem {
        RefItem {
            id: id.into(),
            name: name.into(),
            source: "tenant",
        }
    }

    #[test]
    fn distinct_values_keeps_first_spelling() {
        assert_eq!(
            distinct_values(["Sony", " sony ", "", "SONY!", "Blackmagic"]),
            ["Sony", "Blackmagic"]
        );
    }

    #[test]
    fn resolve_exact_then_fuzzy() {
        let existing = [item("1", "Blackmagic Design"), item("2", "Sony")];
        let r = resolve_refs(
            &["SONY".into(), "Blackmagic Desing".into(), "Inconnu".into()],
            &existing,
        );
        assert!(r[0].exact && r[0].matched.as_ref().unwrap().id == "2");
        assert!(!r[1].exact && r[1].matched.as_ref().unwrap().id == "1");
        assert!(r[1].score >= FUZZY_THRESHOLD);
        assert!(r[2].matched.is_none());
    }
}
