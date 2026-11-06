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
        | Kind::Url
        | Kind::Asset
        | Kind::UpperKey { .. } => "string",
        Kind::NumNonNeg
        | Kind::NumPos
        | Kind::NumPosMsg(_)
        | Kind::Int
        | Kind::Num
        | Kind::IntMin(_)
        | Kind::IntRange(..)
        | Kind::IntPos => "number",
        Kind::Bool => "boolean",
        Kind::StrArr | Kind::NumArr | Kind::AnyArr | Kind::IdArr { .. } | Kind::Slots => "array",
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
        (Kind::IntMin(min), Value::Number(n)) => {
            if n.as_f64().is_some_and(|f| f.fract() != 0.0) {
                errs.push("Invalid input: expected int, received number".into());
            } else if n.as_f64().is_some_and(|f| f < *min as f64) {
                errs.push(format!("Too small: expected number to be >={min}"));
            }
        }
        // Zod stops at the failed `int()` check.
        (Kind::IntRange(min, max), Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(0.0);
            if f.fract() != 0.0 {
                errs.push("Invalid input: expected int, received number".into());
            } else {
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
            if f.fract() != 0.0 {
                errs.push("Invalid input: expected int, received number".into());
            } else if f <= 0.0 {
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
            if n.as_f64().is_some_and(|f| f.fract() != 0.0) {
                errs.push("Invalid input: expected int, received number".into());
            }
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
                    out.insert(f.name.into(), v.clone());
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
