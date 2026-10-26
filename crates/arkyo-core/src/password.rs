//! Password policy.

pub const MIN_LEN: usize = 8;

/// At least 8 characters.
pub fn validate(pw: &str) -> Result<(), String> {
    if pw.chars().count() < MIN_LEN {
        return Err("Le mot de passe doit contenir au moins 8 caractères".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn min_length() {
        assert!(validate("1234567").is_err());
        assert!(validate("12345678").is_ok());
        assert!(validate("éééééééé").is_ok());
    }
}
