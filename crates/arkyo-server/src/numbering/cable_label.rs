//! `computeCableLabel` (arkyo:lib/services/cable-numbering.ts:541-580).
//!
//! Format: `[rack][sep1][prefix][dirDigit + seq][sep2][suffix]`, or the
//! custom template (`{rack} {sep1} {prefix} {dir} {seq} {sep2} {suffix}
//! {zone}`) when `templateEnabled` and `template` is not blank.
//!
//! The configuration is the merged JSON object of the route (admin
//! defaults < `Rack.numberingOverride` < body `override`): the rack override
//! is free JSON, so every field is read with JavaScript semantics (`??`,
//! truthiness, `Number`, `String`). The labels must be byte-identical to
//! arkyo's: shared fixtures `tests/fixtures/cable-numbering.json`, also read
//! by `web/src/lib/services/cable-numbering.test.ts`.

use serde_json::{Map, Value};

use crate::catalogue::import::{js_number_string, js_trim};

/// `CableLabelInput`. `zone_code` is accepted and ignored, as in arkyo (the
/// zone was removed from the convention).
#[derive(Debug, Clone)]
pub struct CableLabelInput<'a> {
    pub zone_code: Option<&'a str>,
    pub rack_code: Option<&'a str>,
    pub signal_prefix: &'a str,
    pub signal_suffix: &'a str,
    /// `"1"` (IN), `"2"` (OUT) or `"3"` (BIDI).
    pub dir_digit: &'a str,
    pub seq: f64,
    pub config: &'a Map<String, Value>,
}

/// The placeholders of the template regex
/// `/\{(rack|sep1|prefix|dir|seq|sep2|suffix|zone)\}/g`.
const PLACEHOLDERS: [&str; 8] = [
    "rack", "sep1", "prefix", "dir", "seq", "sep2", "suffix", "zone",
];

pub fn compute_cable_label(input: &CableLabelInput) -> String {
    let config = input.config;
    let get = |k: &str| config.get(k).filter(|v| !v.is_null());
    let include_rack = truthy(config.get("includeRack"));
    // `config.sep1 ?? config.separator ?? ""`, then string concatenation.
    let s1 = get("sep1")
        .or_else(|| get("separator"))
        .map(js_string)
        .unwrap_or_default();
    let s2 = get("sep2")
        .or_else(|| get("suffixSeparator"))
        .map(js_string)
        .unwrap_or_default();

    // `Math.max(3, Math.min(10, Math.trunc(pad)))`: NaN propagates.
    let safe_pad = js_max(3.0, js_min(10.0, to_number(config.get("pad")).trunc()));
    let safe_seq = js_max(1.0, input.seq.trunc());
    let seq_text = js_number_string(safe_seq);
    let num_block = format!(
        "{}{}",
        input.dir_digit,
        pad_start(&seq_text, js_max(1.0, safe_pad - 1.0))
    );
    let rack = input.rack_code.filter(|r| include_rack && !r.is_empty());

    // ── Custom template ─────────────────────────────────────────────────────
    if truthy(config.get("templateEnabled")) {
        // `config.template && config.template.trim().length > 0`; a
        // non-string template made arkyo throw, it is ignored here.
        if let Some(Value::String(template)) = config.get("template") {
            if !js_trim(template).is_empty() {
                let seq_only = pad_start(&seq_text, safe_pad);
                let var = |k: &str| -> String {
                    match k {
                        "rack" => rack.unwrap_or_default().to_string(),
                        "sep1" => s1.clone(),
                        "prefix" => input.signal_prefix.to_string(),
                        "dir" => input.dir_digit.to_string(),
                        "seq" => seq_only.clone(),
                        "sep2" => s2.clone(),
                        "suffix" => input.signal_suffix.to_string(),
                        // Legacy `{zone}`.
                        _ => String::new(),
                    }
                };
                return replace_placeholders(template, var);
            }
        }
    }

    // ── Global convention ───────────────────────────────────────────────────
    let mut label = String::new();
    if let Some(r) = rack {
        label.push_str(r);
        label.push_str(&s1);
    }
    label.push_str(input.signal_prefix);
    label.push_str(&num_block);
    if !input.signal_suffix.is_empty() {
        label.push_str(&s2);
        label.push_str(input.signal_suffix);
    }
    label
}

/// `template.replace(/\{(rack|…|zone)\}/g, (_, k) => vars[k])`: a left to
/// right scan, non-overlapping, no `$` substitution (callback replacer).
fn replace_placeholders(template: &str, var: impl Fn(&str) -> String) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(pos) = rest.find('{') {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 1..];
        let hit = PLACEHOLDERS.iter().find(|p| {
            after
                .strip_prefix(**p)
                .is_some_and(|tail| tail.starts_with('}'))
        });
        match hit {
            Some(p) => {
                out.push_str(&var(p));
                rest = &after[p.len() + 1..];
            }
            None => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `String.prototype.padStart(len, "0")`; the length goes through
/// `ToLength` (NaN → 0, fractions truncated).
fn pad_start(s: &str, len: f64) -> String {
    let len = if len.is_nan() || len <= 0.0 {
        0
    } else {
        len.trunc() as usize
    };
    // UTF-16 length: `s` is ASCII digits here.
    let n = s.chars().count();
    if n >= len {
        s.to_string()
    } else {
        format!("{}{s}", "0".repeat(len - n))
    }
}

/// `Math.max(a, b)` (NaN if either is NaN).
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// `Math.min(a, b)` (NaN if either is NaN).
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

/// JavaScript truthiness of a JSON value (`undefined` for `None`).
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// JavaScript `String(v)` of a JSON value.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.as_f64().map(js_number_string).unwrap_or_default(),
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|x| {
                if x.is_null() {
                    String::new()
                } else {
                    js_string(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// JavaScript `Number(v)` of a JSON value (`undefined` → NaN).
pub fn to_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => string_to_number(s),
        Some(Value::Array(a)) => match a.as_slice() {
            [] => 0.0,
            [x] => string_to_number(&js_string(x)),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// `Number(s)` for a string: blank → 0, `0x`/`0o`/`0b` literals,
/// `Infinity`, decimal literals; anything else is NaN.
pub fn string_to_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = t.strip_prefix(prefix) {
            return u128::from_str_radix(digits, radix)
                .ok()
                .filter(|_| !digits.starts_with('+'))
                .map_or(f64::NAN, |n| n as f64);
        }
    }
    let unsigned = t.strip_prefix(['+', '-']).unwrap_or(t);
    if unsigned == "Infinity" {
        return if t.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    if is_decimal_literal(unsigned) {
        t.parse().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `StrUnsignedDecimalLiteral`: `1`, `1.`, `.5`, `1.5e-3` (no sign).
fn is_decimal_literal(s: &str) -> bool {
    let (mantissa, exponent) = match s.find(['e', 'E']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let (int, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = |x: &str| x.bytes().all(|b| b.is_ascii_digit());
    let mantissa_ok = digits(int) && digits(frac) && !(int.is_empty() && frac.is_empty());
    let exponent_ok = exponent.is_none_or(|e| {
        let e = e.strip_prefix(['+', '-']).unwrap_or(e);
        !e.is_empty() && digits(e)
    });
    mantissa_ok && exponent_ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_number_conversion() {
        assert_eq!(string_to_number(" 7 "), 7.0);
        assert_eq!(string_to_number(""), 0.0);
        assert_eq!(string_to_number("0x1A"), 26.0);
        assert_eq!(string_to_number(".5"), 0.5);
        assert_eq!(string_to_number("5."), 5.0);
        assert_eq!(string_to_number("-Infinity"), f64::NEG_INFINITY);
        assert!(string_to_number("inf").is_nan());
        assert!(string_to_number("NaN").is_nan());
        assert!(string_to_number("1e").is_nan());
        assert!(string_to_number(".").is_nan());
        assert!(string_to_number("0x").is_nan());
        assert!(to_number(None).is_nan());
        assert_eq!(to_number(Some(&Value::Null)), 0.0);
    }

    #[test]
    fn placeholders() {
        let out = replace_placeholders("{{rack}}{x}{rack", |k| k.to_uppercase());
        assert_eq!(out, "{RACK}{x}{rack");
    }
}
