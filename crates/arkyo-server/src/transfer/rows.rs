//! Raw row access for the transfer: the columns of a table (`PRAGMA
//! table_info`) and its rows as stored values ([`Row`]).

use serde_json::{Number, Value};
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Row as _, SqliteConnection, TypeInfo, ValueRef};

use super::{Row, TransferError};

/// One column of `PRAGMA table_info`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnInfo {
    pub name: String,
    pub notnull: bool,
    /// The default as written in the schema (an SQL expression), if any.
    pub dflt_value: Option<String>,
    /// Position in the primary key (0 = not in it).
    pub pk: i64,
}

/// Table names come from the schema or from an imported file: only plain
/// identifiers are ever put in SQL.
fn check_ident(name: &str) -> Result<(), TransferError> {
    let mut chars = name.chars();
    let ok = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(())
    } else {
        Err(TransferError::Invalid(format!(
            "Nom de table invalide : « {name} »."
        )))
    }
}

/// The columns of `table`, in the schema's order (empty if the table does
/// not exist here).
pub async fn columns(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<ColumnInfo>, TransferError> {
    check_ident(table)?;
    let rows: Vec<(String, i64, Option<String>, i64)> = sqlx::query_as(&format!(
        r#"SELECT "name", "notnull", "dflt_value", "pk" FROM pragma_table_info('{table}')"#
    ))
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(name, notnull, dflt_value, pk)| ColumnInfo {
            name,
            notnull: notnull != 0,
            dflt_value,
            pk,
        })
        .collect())
}

/// `SELECT * FROM "<table>" WHERE <where_sql>` in insertion order (`rowid`),
/// each `?` of `where_sql` bound to the next of `binds`.
pub async fn select_rows(
    conn: &mut SqliteConnection,
    table: &str,
    where_sql: &str,
    binds: &[&str],
) -> Result<Vec<Row>, TransferError> {
    check_ident(table)?;
    let sql = format!(r#"SELECT * FROM "{table}" WHERE {where_sql} ORDER BY rowid"#);
    let mut q = sqlx::query(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    let rows = q.fetch_all(&mut *conn).await?;
    rows.iter().map(|r| raw_row(table, r)).collect()
}

/// A row as stored, by the storage class of each value.
fn raw_row(table: &str, row: &SqliteRow) -> Result<Row, TransferError> {
    let mut out = Row::new();
    for (i, col) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(i)?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            match raw.type_info().name() {
                "INTEGER" => Value::from(row.try_get::<i64, _>(i)?),
                "REAL" => {
                    Number::from_f64(row.try_get::<f64, _>(i)?).map_or(Value::Null, Value::Number)
                }
                "TEXT" => Value::from(row.try_get::<String, _>(i)?),
                other => {
                    return Err(TransferError::Invalid(format!(
                        "Valeur {other} non prise en charge dans « {table}.{} ».",
                        col.name()
                    )))
                }
            }
        };
        out.insert(col.name().to_string(), value);
    }
    Ok(out)
}
