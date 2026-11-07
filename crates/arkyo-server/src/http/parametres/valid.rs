//! Request-body validation mirroring arkyo's Zod 4 schemas.
//!
//! A schema is a list of [`Field`]s. Unknown keys are dropped (Zod strips
//! them), `null` is only accepted on nullable fields, and a failure answers
//! `400 {"error": {"formErrors": [], "fieldErrors": {field: [messages]}}}`,
//! the shape of `parsed.error.flatten()`, with Zod's English default
//! messages where arkyo's schema gives none.

use std::collections::BTreeMap;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use super::Obj;

#[derive(Clone, Copy)]
pub enum Kind {
    /// `z.string()`.
    Str,
    /// `z.string().min(1, min_msg).max(max, max_msg)`, plus the
    /// `^[A-Z0-9_]+$` rule of the function and phase keys when `upper`.
    Bounded {
        min_msg: &'static str,
        max: usize,
        max_msg: &'static str,
        upper: bool,
    },
    /// `z.string().max(n)` (default message).
    MaxLen(usize),
    /// `z.string().min(min).max(max)` (default messages).
    StrLen(usize, usize),
    /// `z.string().url("URL invalide")`.
    Url,
    /// `assetUrlSchema`: absolute http(s) URL or `/relative/path`.
    Asset,
    /// `z.string().min(1)` (default message).
    NonEmpty,
    /// `z.number()`.
    Num,
    /// `z.number().int().min(n)`.
    IntMin(i64),
    /// `z.number().int().min(min).max(max)`.
    IntRange(i64, i64),
    /// `z.number().int().positive()`.
    IntPos,
    /// `z.array(z.string().min(1)).min(min).max(max)`.
    IdArr {
        min: usize,
        max: usize,
    },
    NumNonNeg,
    /// `z.number().min(min).max(max)`.
    NumRange(i64, i64),
    NumPos,
    /// `z.number().positive(msg)`.
    NumPosMsg(&'static str),
    Int,
    Bool,
    StrArr,
    /// `z.array(z.number())`.
    NumArr,
    AnyArr,
    /// `z.enum(values, { message })`.
    Enum(&'static [&'static str], &'static str),
    /// `z.unknown()`: any JSON value.
    Any,
    /// `z.array(slotSchema)` of the print templates (`key`, `label`,
    /// `type` in TEXT/VARIABLE/LOGO, optional `defaultValue`, `sample`).
    Slots,
    /// `z.array(z.object({ x: z.number(), y: z.number() }))` (cable
    /// waypoints); other keys of a point are dropped.
    Points,
    /// `z.array(z.object({ color: z.string().max(16), text:
    /// z.string().max(60) }))` (cable tags); other keys are dropped.
    Tags,
    /// `z.string().min(1, min_msg).max(max, max_msg).regex(^[A-Z0-9_]+$,
    /// regex_msg)` (`max` is `usize::MAX` when there is no upper bound).
    UpperKey {
        min_msg: &'static str,
        max: usize,
        max_msg: &'static str,
        regex_msg: &'static str,
    },
}

/// Value of a field the client did not send (create only).
#[derive(Clone, Copy)]
pub enum Def {
    Null,
    False,
    True,
    Zero,
    EmptyArr,
    Int(i64),
    Str(&'static str),
}

impl Def {
    pub fn value(self) -> Value {
        match self {
            Def::Null => Value::Null,
            Def::False => Value::Bool(false),
            Def::True => Value::Bool(true),
            Def::Zero => Value::from(0),
            Def::EmptyArr => Value::Array(vec![]),
            Def::Int(n) => Value::from(n),
            Def::Str(s) => Value::String(s.to_string()),
        }
    }
}

pub struct Field {
    pub name: &'static str,
    pub kind: Kind,
    pub nullable: bool,
    pub required: bool,
    pub default: Def,
}

impl Field {
    pub const fn new(name: &'static str, kind: Kind) -> Self {
        Self {
            name,
            kind,
            nullable: false,
            required: false,
            default: Def::Null,
        }
    }
    /// `.nullable()`.
    pub const fn nullable(mut self) -> Self {
        self.nullable = true;
        self
    }
    /// Not `.optional()`: must be sent.
    pub const fn required(mut self) -> Self {
        self.required = true;
        self
    }
    /// Value stored when the field is not sent.
    pub const fn or(mut self, d: Def) -> Self {
        self.default = d;
        self
    }
}

/// JavaScript `typeof`-like name of a JSON value, as Zod reports it.
pub fn js_type(v: Option<&Value>) -> &'static str {
    match v {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn expected(kind: &Kind) -> &'static str {
    match kind {
        Kind::Str
        | Kind::NonEmpty
        | Kind::Bounded { .. }
        | Kind::MaxLen(_)
        | Kind::StrLen(..)
        | Kind::Url
        | Kind::Asset
        | Kind::UpperKey { .. } => "string",
        Kind::NumNonNeg
        | Kind::NumRange(..)
        | Kind::NumPos
        | Kind::NumPosMsg(_)
        | Kind::Int
        | Kind::Num
        | Kind::IntMin(_)
        | Kind::IntRange(..)
        | Kind::IntPos => "number",
        Kind::Bool => "boolean",
        Kind::StrArr
        | Kind::NumArr
        | Kind::AnyArr
        | Kind::IdArr { .. }
        | Kind::Slots
        | Kind::Points
        | Kind::Tags => "array",
        Kind::Enum(..) => "string",
        Kind::Any => "unknown",
    }
}

fn type_error(kind: &Kind, got: Option<&Value>) -> String {
    if let Kind::Enum(_, msg) = kind {
        return (*msg).to_string();
    }
    format!(
        "Invalid input: expected {}, received {}",
        expected(kind),
        js_type(got)
    )
}

fn valid_url(s: &str) -> bool {
    let Some((scheme, rest)) = s.split_once("://") else {
        return false;
    };
    !scheme.is_empty()
        && scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        && !rest.is_empty()
        && !rest.starts_with('/')
        && !s.chars().any(char::is_whitespace)
}

/// One element of a print template's `slots` (arkyo `slotSchema`).
fn check_slot(it: &Value, errs: &mut Vec<String>) {
    let Value::Object(o) = it else {
        errs.push(format!(
            "Invalid input: expected object, received {}",
            js_type(Some(it))
        ));
        return;
    };
    for name in ["key", "label"] {
        match o.get(name) {
            Some(Value::String(s)) if s.is_empty() => {
                errs.push("Too small: expected string to have >=1 characters".into());
            }
            Some(Value::String(_)) => {}
            other => errs.push(format!(
                "Invalid input: expected string, received {}",
                js_type(other)
            )),
        }
    }
    match o.get("type") {
        Some(Value::String(s)) if ["TEXT", "VARIABLE", "LOGO"].contains(&s.as_str()) => {}
        _ => errs.push(r#"Invalid option: expected one of "TEXT"|"VARIABLE"|"LOGO""#.into()),
    }
    for name in ["defaultValue", "sample"] {
        match o.get(name) {
            None | Some(Value::String(_)) => {}
            other => errs.push(format!(
                "Invalid input: expected string, received {}",
                js_type(other)
            )),
        }
    }
}

/// One element of a `z.array(z.object(shape))`: each `(key, max)` is a
/// `z.number()` when `max` is `None`, a `z.string().max(n)` otherwise.
fn check_shape(it: &Value, shape: &[(&str, Option<usize>)], errs: &mut Vec<String>) {
    let Value::Object(o) = it else {
        errs.push(format!(
            "Invalid input: expected object, received {}",
            js_type(Some(it))
        ));
        return;
    };
    for (name, max) in shape {
        match (o.get(*name), max) {
            (Some(Value::Number(_)), None) => {}
            (Some(Value::String(s)), Some(max)) => {
                if s.chars().count() > *max {
                    errs.push(format!(
                        "Too big: expected string to have <={max} characters"
                    ));
                }
            }
            (other, max) => errs.push(format!(
                "Invalid input: expected {}, received {}",
                if max.is_some() { "string" } else { "number" },
                js_type(other)
            )),
        }
    }
}

/// The parsed value of a valid field: Zod strips the unknown keys of the
/// objects of [`Kind::Points`] and [`Kind::Tags`].
fn output(kind: &Kind, v: &Value) -> Value {
    let keys: &[&str] = match kind {
        Kind::Points => &["x", "y"],
        Kind::Tags => &["color", "text"],
        _ => return v.clone(),
    };
    match v {
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|it| {
                    Value::Object(
                        keys.iter()
                            .filter_map(|k| it.get(*k).map(|x| ((*k).to_string(), x.clone())))
                            .collect(),
                    )
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

/// `Number.MAX_SAFE_INTEGER`.
const MAX_SAFE_INT: f64 = 9_007_199_254_740_991.0;

/// Zod 4's `int()` check (`$ZodCheckNumberFormat`, format `safeint`): a
/// non-integer fails and stops the chain; an integer outside the safe range
/// gets `too_big` / `too_small` on the `int` origin and lets the next checks
/// run. Returns whether the next checks run.
fn int_check(f: f64, errs: &mut Vec<String>) -> bool {
    if f.fract() != 0.0 {
        errs.push("Invalid input: expected int, received number".into());
        return false;
    }
    if f > MAX_SAFE_INT {
        errs.push("Too big: expected int to be <=9007199254740991".into());
    } else if f < -MAX_SAFE_INT {
        errs.push("Too small: expected int to be >=-9007199254740991".into());
    }
    true
}

/// The messages of every check `v` fails (empty = valid).
fn check(kind: &Kind, v: &Value) -> Vec<String> {
    let mut errs = Vec::new();
    match (kind, v) {
        (Kind::Str, Value::String(_))
        | (Kind::Bool, Value::Bool(_))
        | (Kind::AnyArr, Value::Array(_)) => {}
        (
            Kind::Bounded {
                min_msg,
                max,
                max_msg,
                upper,
            },
            Value::String(s),
        ) => {
            let n = s.chars().count();
            if n < 1 {
                errs.push((*min_msg).to_string());
            }
            if n > *max {
                errs.push((*max_msg).to_string());
            }
            if *upper
                && !(!s.is_empty()
                    && s.chars()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'))
            {
                errs.push(
                    "La clé doit être en majuscules, chiffres et tirets bas uniquement".into(),
                );
            }
        }
        (Kind::NonEmpty, Value::String(s)) => {
            if s.is_empty() {
                errs.push("Too small: expected string to have >=1 characters".into());
            }
        }
        (Kind::Num, Value::Number(_)) => {}
        // Zod stops at the failed `int()` check; the safe-integer issue
        // lets the next checks run.
        (Kind::IntMin(min), Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(0.0);
            if int_check(f, &mut errs) && f < *min as f64 {
                errs.push(format!("Too small: expected number to be >={min}"));
            }
        }
        (Kind::IntRange(min, max), Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(0.0);
            if int_check(f, &mut errs) {
                if f < *min as f64 {
                    errs.push(format!("Too small: expected number to be >={min}"));
                }
                if f > *max as f64 {
                    errs.push(format!("Too big: expected number to be <={max}"));
                }
            }
        }
        (Kind::IntPos, Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(0.0);
            if int_check(f, &mut errs) && f <= 0.0 {
                errs.push("Too small: expected number to be >0".into());
            }
        }
        (Kind::IdArr { min, max }, Value::Array(items)) => {
            if items.len() < *min {
                errs.push(format!("Too small: expected array to have >={min} items"));
            }
            if items.len() > *max {
                errs.push(format!("Too big: expected array to have <={max} items"));
            }
            for it in items {
                match it {
                    Value::String(s) if s.is_empty() => {
                        errs.push("Too small: expected string to have >=1 characters".into());
                    }
                    Value::String(_) => {}
                    other => errs.push(format!(
                        "Invalid input: expected string, received {}",
                        js_type(Some(other))
                    )),
                }
            }
        }
        (Kind::MaxLen(max), Value::String(s)) => {
            if s.chars().count() > *max {
                errs.push(format!(
                    "Too big: expected string to have <={max} characters"
                ));
            }
        }
        (Kind::StrLen(min, max), Value::String(s)) => {
            let n = s.chars().count();
            if n < *min {
                errs.push(format!(
                    "Too small: expected string to have >={min} characters"
                ));
            }
            if n > *max {
                errs.push(format!(
                    "Too big: expected string to have <={max} characters"
                ));
            }
        }
        (Kind::Url, Value::String(s)) => {
            if !valid_url(s) {
                errs.push("URL invalide".into());
            }
        }
        (Kind::Asset, Value::String(s)) => {
            let n = s.chars().count();
            if n < 1 {
                errs.push("Too small: expected string to have >=1 characters".into());
            }
            if n > 2048 {
                errs.push("Too big: expected string to have <=2048 characters".into());
            }
            let lower = s.to_ascii_lowercase();
            if !(s.starts_with('/')
                || lower.starts_with("http://")
                || lower.starts_with("https://"))
            {
                errs.push("URL absolue (https://…) ou chemin relatif (/uploads/…) attendu".into());
            }
        }
        (Kind::NumNonNeg, Value::Number(n)) => {
            if n.as_f64().is_some_and(|f| f < 0.0) {
                errs.push("Too small: expected number to be >=0".into());
            }
        }
        (Kind::NumRange(min, max), Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(0.0);
            if f < *min as f64 {
                errs.push(format!("Too small: expected number to be >={min}"));
            }
            if f > *max as f64 {
                errs.push(format!("Too big: expected number to be <={max}"));
            }
        }
        (Kind::NumPos, Value::Number(n)) => {
            if n.as_f64().is_some_and(|f| f <= 0.0) {
                errs.push("Too small: expected number to be >0".into());
            }
        }
        (Kind::NumPosMsg(msg), Value::Number(n)) => {
            if n.as_f64().is_some_and(|f| f <= 0.0) {
                errs.push((*msg).to_string());
            }
        }
        (Kind::Int, Value::Number(n)) => {
            int_check(n.as_f64().unwrap_or(0.0), &mut errs);
        }
        (Kind::StrArr, Value::Array(items)) => {
            for it in items {
                if !it.is_string() {
                    errs.push(format!(
                        "Invalid input: expected string, received {}",
                        js_type(Some(it))
                    ));
                }
            }
        }
        (Kind::NumArr, Value::Array(items)) => {
            for it in items {
                if !it.is_number() {
                    errs.push(format!(
                        "Invalid input: expected number, received {}",
                        js_type(Some(it))
                    ));
                }
            }
        }
        (Kind::Enum(values, msg), Value::String(s)) => {
            if !values.contains(&s.as_str()) {
                errs.push((*msg).to_string());
            }
        }
        (Kind::Any, _) => {}
        (
            Kind::UpperKey {
                min_msg,
                max,
                max_msg,
                regex_msg,
            },
            Value::String(s),
        ) => {
            let n = s.chars().count();
            if n < 1 {
                errs.push((*min_msg).to_string());
            }
            if n > *max {
                errs.push((*max_msg).to_string());
            }
            if s.is_empty()
                || !s
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            {
                errs.push((*regex_msg).to_string());
            }
        }
        (Kind::Slots, Value::Array(items)) => {
            for it in items {
                check_slot(it, &mut errs);
            }
        }
        (Kind::Points, Value::Array(items)) => {
            for it in items {
                check_shape(it, &[("x", None), ("y", None)], &mut errs);
            }
        }
        (Kind::Tags, Value::Array(items)) => {
            for it in items {
                check_shape(it, &[("color", Some(16)), ("text", Some(60))], &mut errs);
            }
        }
        _ => errs.push(type_error(kind, Some(v))),
    }
    errs
}

/// `parsed.error.flatten()`.
pub type Flat = (Vec<String>, BTreeMap<String, Vec<String>>);

pub fn flat_json(flat: &Flat) -> Value {
    json!({ "formErrors": flat.0, "fieldErrors": flat.1 })
}

/// `400 {"error": flatten()}`.
pub fn failure(flat: Flat) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": flat_json(&flat) })),
    )
        .into_response()
}

/// Validates `body` against `fields`; returns the sent, valid fields.
#[allow(clippy::result_large_err)]
pub fn validate(body: &Value, fields: &[Field]) -> Result<Obj, Response> {
    validate_flat(body, fields).map_err(failure)
}

/// [`validate`] with the raw `flatten()` result, for routes that wrap it in
/// their own error envelope.
pub fn validate_flat(body: &Value, fields: &[Field]) -> Result<Obj, Flat> {
    let Value::Object(obj) = body else {
        return Err((
            vec![format!(
                "Invalid input: expected object, received {}",
                js_type(Some(body))
            )],
            BTreeMap::new(),
        ));
    };
    let mut out = Obj::new();
    let mut errs: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for f in fields {
        match obj.get(f.name) {
            None if f.required => {
                errs.entry(f.name.into())
                    .or_default()
                    .push(type_error(&f.kind, None));
            }
            None => {}
            Some(Value::Null) if f.nullable => {
                out.insert(f.name.into(), Value::Null);
            }
            Some(Value::Null) => {
                errs.entry(f.name.into())
                    .or_default()
                    .push(type_error(&f.kind, Some(&Value::Null)));
            }
            Some(v) => {
                let e = check(&f.kind, v);
                if e.is_empty() {
                    out.insert(f.name.into(), output(&f.kind, v));
                } else {
                    errs.entry(f.name.into()).or_default().extend(e);
                }
            }
        }
    }
    if errs.is_empty() {
        Ok(out)
    } else {
        Err((vec![], errs))
    }
}

/// `z.string().min(1, "Le nom est obligatoire").max(100, …)`.
pub const NAME: Kind = Kind::Bounded {
    min_msg: "Le nom est obligatoire",
    max: 100,
    max_msg: "Le nom ne doit pas dépasser 100 caractères",
    upper: false,
};

/// Function / phase key: 1-50 characters, `^[A-Z0-9_]+$`.
pub const KEY: Kind = Kind::Bounded {
    min_msg: "La clé est obligatoire",
    max: 50,
    max_msg: "La clé ne doit pas dépasser 50 caractères",
    upper: true,
};

/// Function / phase label: 1-100 characters.
pub const LABEL: Kind = Kind::Bounded {
    min_msg: "Le libellé est obligatoire",
    max: 100,
    max_msg: "Le libellé ne doit pas dépasser 100 caractères",
    upper: false,
};

#[cfg(test)]
mod tests {
    use super::*;

    fn errs(kind: Kind, v: Value) -> Vec<String> {
        check(&kind, &v)
    }

    #[test]
    fn str_len_uses_zod_default_messages() {
        assert!(errs(Kind::StrLen(6, 64), json!("abcdef")).is_empty());
        assert_eq!(
            errs(Kind::StrLen(6, 64), json!("abc")),
            ["Too small: expected string to have >=6 characters"]
        );
        assert_eq!(
            errs(Kind::StrLen(1, 3), json!("abcd")),
            ["Too big: expected string to have <=3 characters"]
        );
        assert_eq!(
            errs(Kind::StrLen(1, 3), json!(1)),
            ["Invalid input: expected string, received number"]
        );
    }

    #[test]
    fn ints_stay_in_the_safe_range_like_zod() {
        let big = "Too big: expected int to be <=9007199254740991";
        let small = "Too small: expected int to be >=-9007199254740991";
        assert_eq!(errs(Kind::IntPos, json!(1e20)), vec![big]);
        assert_eq!(
            errs(Kind::IntPos, json!(-1e20)),
            vec![small, "Too small: expected number to be >0"]
        );
        assert_eq!(
            errs(Kind::IntRange(1, 56), json!(1e20)),
            vec![big, "Too big: expected number to be <=56"]
        );
        assert_eq!(errs(Kind::IntMin(0), json!(1e20)), vec![big]);
        assert_eq!(
            errs(Kind::IntMin(0), json!(-1e20)),
            vec![small, "Too small: expected number to be >=0"]
        );
        assert_eq!(errs(Kind::Int, json!(-1e20)), vec![small]);
        // 2^53 is not a safe integer (9007199254740993 reads as 2^53 too).
        assert_eq!(errs(Kind::Int, json!(9_007_199_254_740_992_u64)), vec![big]);
        assert!(errs(Kind::Int, json!(9_007_199_254_740_991_u64)).is_empty());
        assert!(errs(Kind::IntPos, json!(9_007_199_254_740_991_i64)).is_empty());
        assert!(errs(Kind::Int, json!(-9_007_199_254_740_991_i64)).is_empty());
        // A fraction stops the chain, as before.
        assert_eq!(
            errs(Kind::IntRange(1, 56), json!(99.5)),
            vec!["Invalid input: expected int, received number"]
        );
    }
}
