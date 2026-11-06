//! arkyo:lib/services/rack-inventory.ts `validateInventoryRef` (:208-303):
//! the body of an inventory write names exactly one catalogue reference,
//! plus the catalogue check arkyo lacked.
//!
//! [`parse_inventory_ref`] is arkyo's function, message for message (its 24
//! Vitest cases are ported in `tests/inventory_services.rs`). The route
//! normalises the legacy fields first (`catalogEquipmentId ?? equipmentId`,
//! `catalogAdapterId ?? adapterId`), as `resolveInventoryRef` does.
//!
//! [`validate_inventory_ref`] then checks the referenced item before anything
//! is written. arkyo wrote the row first and answered 500 « Référence
//! catalogue introuvable après création. » when the item did not resolve
//! (and a panel foreign key error was an unhandled 500). Here an unknown
//! item is a 404 with that same message, and an inactive equipment or
//! adapter (hidden from the inventory catalogue panel) a 400; nothing is
//! written (phase 4 decision 5: no implicit 500).

use axum::http::StatusCode;
use sqlx::SqliteConnection;

/// `AccessoryType`.
pub const ACCESSORY_TYPES: [&str; 3] = ["plaque", "etagere", "tiroir"];
/// `PlaqueVariant`.
pub const PLAQUE_VARIANTS: [&str; 3] = ["plein", "pass-cable", "aere"];
/// `AccessoryHeightU`: 1 to 8.
pub const ACCESSORY_HEIGHTS_U: std::ops::RangeInclusive<i64> = 1..=8;

/// The reference fields of the body; `None` is arkyo's `null` / `undefined`.
#[derive(Debug, Clone, Default)]
pub struct RefInput {
    pub equipment_id: Option<String>,
    pub panel_id: Option<String>,
    pub adapter_id: Option<String>,
    pub accessory_type: Option<String>,
    pub accessory_height_u: Option<i64>,
    pub accessory_variant: Option<String>,
    pub accessory_depth_mm: Option<i64>,
}

/// arkyo's `InventoryRef`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InventoryRef {
    Equipment(String),
    Panel(String),
    Adapter(String),
    /// `variant` only for a plaque, `depth_mm` only for a shelf or drawer.
    Accessory {
        accessory_type: String,
        height_u: i64,
        variant: Option<String>,
        depth_mm: Option<i64>,
    },
}

impl InventoryRef {
    /// `ref.kind`: `equipment`, `panel`, `adapter` or `accessory`.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Equipment(_) => "equipment",
            Self::Panel(_) => "panel",
            Self::Adapter(_) => "adapter",
            Self::Accessory { .. } => "accessory",
        }
    }

    /// `ref.refId` of a catalogue reference, `None` for an accessory.
    pub fn ref_id(&self) -> Option<&str> {
        match self {
            Self::Equipment(id) | Self::Panel(id) | Self::Adapter(id) => Some(id),
            Self::Accessory { .. } => None,
        }
    }
}

/// Why a reference is refused.
#[derive(Debug)]
pub enum RefError {
    /// arkyo's `validateInventoryRef` message (400).
    Invalid(&'static str),
    /// The equipment, panel or adapter does not exist (404).
    Unknown,
    /// The equipment or adapter is inactive (400).
    Inactive,
    Db(sqlx::Error),
}

/// The message of [`RefError::Unknown`]: arkyo's, kept for parity.
pub const UNKNOWN_MSG: &str = "Référence catalogue introuvable après création.";
/// The message of [`RefError::Inactive`] (no equivalent in arkyo).
pub const INACTIVE_MSG: &str = "Référence catalogue inactive";

impl RefError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::Invalid(_) | Self::Inactive => StatusCode::BAD_REQUEST,
            Self::Unknown => StatusCode::NOT_FOUND,
            Self::Db(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// The `error` of the JSON answer.
    pub fn message(&self) -> &str {
        match self {
            Self::Invalid(m) => m,
            Self::Unknown => UNKNOWN_MSG,
            Self::Inactive => INACTIVE_MSG,
            Self::Db(_) => "Erreur interne",
        }
    }
}

impl From<sqlx::Error> for RefError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(e)
    }
}

/// `validateInventoryRef(body)`: exactly one of `equipmentId`, `panelId`,
/// `adapterId` (non-empty strings) or a complete accessory. An accessory
/// field is "present" when not `null`, even empty or invalid, so that it
/// fails loudly instead of being ignored.
pub fn parse_inventory_ref(body: &RefInput) -> Result<InventoryRef, RefError> {
    let mut candidates: Vec<InventoryRef> = Vec::new();
    let present = |v: &Option<String>| v.as_deref().filter(|s| !s.is_empty()).map(str::to_string);
    if let Some(id) = present(&body.equipment_id) {
        candidates.push(InventoryRef::Equipment(id));
    }
    if let Some(id) = present(&body.panel_id) {
        candidates.push(InventoryRef::Panel(id));
    }
    if let Some(id) = present(&body.adapter_id) {
        candidates.push(InventoryRef::Adapter(id));
    }

    match (&body.accessory_type, body.accessory_height_u) {
        (None, None) => {}
        (Some(_), None) | (None, Some(_)) => {
            return Err(RefError::Invalid(
                "Accessoire incomplet : type et hauteur U requis",
            ))
        }
        (Some(t), Some(h)) => {
            if !ACCESSORY_TYPES.contains(&t.as_str()) {
                return Err(RefError::Invalid(
                    "Type d'accessoire invalide : attendu plaque, etagere ou tiroir",
                ));
            }
            if !ACCESSORY_HEIGHTS_U.contains(&h) {
                // arkyo's message, stale since heights go up to 8U.
                return Err(RefError::Invalid(
                    "Hauteur U d'accessoire invalide : attendu 1, 2, 3 ou 4",
                ));
            }
            if t == "plaque" {
                let variant = body
                    .accessory_variant
                    .as_deref()
                    .filter(|v| PLAQUE_VARIANTS.contains(v))
                    .ok_or(RefError::Invalid("Variant requis pour les plaques"))?;
                candidates.push(InventoryRef::Accessory {
                    accessory_type: t.clone(),
                    height_u: h,
                    variant: Some(variant.to_string()),
                    depth_mm: None,
                });
            } else {
                // Shelf / drawer: the variant is ignored, the depth required.
                let depth = body.accessory_depth_mm.ok_or(RefError::Invalid(
                    "Profondeur requise pour les étagères et tiroirs",
                ))?;
                if depth <= 0 {
                    return Err(RefError::Invalid(
                        "Profondeur invalide : valeur en mm > 0 attendue",
                    ));
                }
                candidates.push(InventoryRef::Accessory {
                    accessory_type: t.clone(),
                    height_u: h,
                    variant: None,
                    depth_mm: Some(depth),
                });
            }
        }
    }

    if candidates.is_empty() {
        return Err(RefError::Invalid("Référence catalogue manquante"));
    }
    if candidates.len() > 1 {
        return Err(RefError::Invalid(
            "Plusieurs références catalogue fournies — exactement une attendue",
        ));
    }
    Ok(candidates.remove(0))
}

/// The catalogue check: the equipment (`TenantEquipment`) or adapter
/// (`TenantAdapter`) exists and is active, the panel (`Panel`) exists. An
/// accessory has nothing to check.
pub async fn validate_inventory_ref(
    conn: &mut SqliteConnection,
    r: &InventoryRef,
) -> Result<(), RefError> {
    let (table, has_active) = match r {
        InventoryRef::Equipment(_) => ("TenantEquipment", true),
        InventoryRef::Adapter(_) => ("TenantAdapter", true),
        InventoryRef::Panel(_) => ("Panel", false),
        InventoryRef::Accessory { .. } => return Ok(()),
    };
    let active = if has_active { r#""isActive""# } else { "1" };
    let found: Option<bool> =
        sqlx::query_scalar(&format!(r#"SELECT {active} FROM "{table}" WHERE "id" = ?"#))
            .bind(r.ref_id())
            .fetch_optional(conn)
            .await?;
    match found {
        None => Err(RefError::Unknown),
        Some(false) => Err(RefError::Inactive),
        Some(true) => Ok(()),
    }
}
