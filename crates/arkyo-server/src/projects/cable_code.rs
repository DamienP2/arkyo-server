//! `deriveCableCode` of arkyo:app/api/tenant/projects/[id]/locations/route.ts:13-16.

/// Short cable code of a location: `name.toUpperCase()`, keeping only
/// `A-Z0-9`, at most 5 characters; `None` when nothing is left (arkyo's
/// `code || null`). The upper casing is Unicode, like JavaScript's
/// (`ß` gives `SS`, `é` gives `É`, which is then dropped).
pub fn derive(name: &str) -> Option<String> {
    let code: String = name
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        .take(5)
        .collect();
    (!code.is_empty()).then_some(code)
}
