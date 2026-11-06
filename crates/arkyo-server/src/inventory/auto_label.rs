//! arkyo:lib/services/auto-label.ts: `#XXXX` slot labels.
//!
//! 32 characters without the ambiguous O/0/I/1, so 32⁴ ≈ 1M combinations;
//! after 100 colliding draws, arkyo's fallback: `#` and the last 4 base-36
//! digits of the millisecond clock, upper case (not checked against `used`,
//! as in arkyo).
//!
//! Uniqueness only holds against the labels the caller passes: the ghost
//! slot sync reads them inside its `BEGIN IMMEDIATE` transaction, so two
//! concurrent adds on the same rack see each other's labels.

use std::collections::HashSet;

const CHARS: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// `generateUniqueLabel(used)`.
pub fn generate_unique_label(used: &HashSet<String>) -> String {
    for _ in 0..100 {
        // A v4 UUID is 122 random bits from the OS generator; its first four
        // bytes are fully random, and 256 is a multiple of 32 (no bias).
        let bytes = uuid::Uuid::new_v4().into_bytes();
        let code: String = bytes[..4]
            .iter()
            .map(|b| CHARS[usize::from(*b) % CHARS.len()] as char)
            .collect();
        let label = format!("#{code}");
        if !used.contains(&label) {
            return label;
        }
    }
    let millis = jiff::Timestamp::now().as_millisecond().unsigned_abs();
    let b36 = base36(millis);
    format!("#{}", &b36[b36.len().saturating_sub(4)..])
}

/// `n.toString(36).toUpperCase()`.
fn base36(mut n: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut out = Vec::new();
    loop {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).expect("ASCII digits")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base36_like_javascript() {
        assert_eq!(base36(0), "0");
        assert_eq!(base36(35), "Z");
        assert_eq!(base36(36), "10");
        // (1762423200000).toString(36).toUpperCase()
        assert_eq!(base36(1_762_423_200_000), "MHN99OG0");
    }
}
