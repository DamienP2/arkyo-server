//! Cable numbering (arkyo:lib/services/cable-numbering.ts).
//!
//! Only `computeCableLabel` is used by the server (the two `renumber`
//! routes); the rest of the module (format, parse, validate, next number)
//! stays on the client.

pub mod cable_label;

pub use cable_label::{compute_cable_label, CableLabelInput};
