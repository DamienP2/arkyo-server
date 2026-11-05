//! Spreadsheet import engine of the equipment catalogue, pure (no database,
//! no HTTP): port of arkyo:lib/services/import/* (`parse-tabular`,
//! `detect-columns`, `coerce`, `resolve-refs`, `build-equipment`,
//! `preview`), one module per file, plus the server-side XLSX reading of
//! arkyo:lib/xlsx-server.ts (`calamine` instead of SheetJS).
//!
//! The JavaScript string and number semantics the engine relies on (`trim`,
//! `\s`, `Math.round`, `String(n)`) are reproduced by the helpers below so
//! that the same file gives the same mapping, values and messages.

pub mod build;
pub mod coerce;
pub mod detect;
pub mod parse;
pub mod preview;
pub mod resolve;

use unicode_normalization::UnicodeNormalization;

/// JavaScript `\s` / `String.prototype.trim` whitespace.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `s.trim()`.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `Math.round(n)`: halves go towards +∞.
pub fn js_round(n: f64) -> f64 {
    let f = n.floor();
    if n - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `Math.round(n * 10000) / 10000`.
pub fn round4(n: f64) -> f64 {
    js_round(n * 10000.0) / 10000.0
}

/// `s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()`.
pub fn strip_accents_lower(s: &str) -> String {
    s.nfd()
        .filter(|c| !('\u{300}'..='\u{36F}').contains(c))
        .collect::<String>()
        .to_lowercase()
}

/// JavaScript `String(n)` for a finite number: integers without a decimal
/// part, shortest round-trip digits, exponent form outside [1e-6, 1e21).
pub fn js_number_string(n: f64) -> String {
    if n == 0.0 {
        return "0".into();
    }
    let abs = n.abs();
    if (1e-6..1e21).contains(&abs) {
        if n.fract() == 0.0 {
            return format!("{n:.0}");
        }
        return format!("{n}");
    }
    // `{:e}` gives the shortest digits too: 1.5e21 → "1.5e21".
    let s = format!("{n:e}");
    match s.split_once('e') {
        Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
        _ => s,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_helpers() {
        assert_eq!(js_trim("\u{feff} a \u{a0}"), "a");
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(2.7), 3.0);
        assert_eq!(round4(0.123_456), 0.1235);
        assert_eq!(strip_accents_lower("ÉCLAIRÂGE"), "eclairage");
        assert_eq!(js_number_string(450.0), "450");
        assert_eq!(js_number_string(6.5), "6.5");
        assert_eq!(js_number_string(-0.25), "-0.25");
        assert_eq!(js_number_string(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(js_number_string(1e21), "1e+21");
        assert_eq!(js_number_string(1.5e-8), "1.5e-8");
    }
}
