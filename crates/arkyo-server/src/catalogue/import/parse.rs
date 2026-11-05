//! A spreadsheet as a `{ headers, rows }` matrix
//! (arkyo:lib/services/import/parse-tabular.ts, and the server-side XLSX
//! reading of arkyo:lib/xlsx-server.ts).
//!
//! - CSV: `;` / `,` / tab detected like arkyo, UTF-8 BOM removed, quoted
//!   fields with `""` escapes and line breaks, `\n` / `\r\n` / `\r` (the
//!   `csv` crate).
//! - XLSX: first sheet read with `calamine`, cells as SheetJS
//!   `sheet_to_json({ header: 1, raw: true, defval: "", blankrows: false })`
//!   gives them (numbers raw, dates as serial numbers, errors empty), then
//!   stringified like the JSON matrix of the client-side path.
//!
//! The first non-empty row is the header row; data rows are padded or cut to
//! its width; rows whose cells are all blank are dropped.

use std::io::Cursor;

use calamine::{Data, Reader, Xlsx};
use serde::Serialize;
use serde_json::Value;

use super::{js_number_string, js_trim};

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabularMatrix {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet_names: Option<Vec<String>>,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

const CANDIDATE_DELIMITERS: [char; 3] = [';', ',', '\t'];

fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

/// Occurrences of `delim` per line, outside quotes (a quote toggles).
fn count_per_line(text: &str, delim: char) -> Vec<usize> {
    let mut counts = Vec::new();
    let mut in_quotes = false;
    let mut current = 0;
    for ch in text.chars() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == '\n' && !in_quotes {
            counts.push(current);
            current = 0;
        } else if ch == delim && !in_quotes {
            current += 1;
        }
    }
    counts.push(current);
    counts
}

/// `detectDelimiter`: over the first 20 lines, the candidate with the most
/// occurrences (+5 when every line has the same count) wins; `;` on ties.
pub fn detect_delimiter(text: &str) -> char {
    let sample = strip_bom(text)
        .split("\r\n")
        .flat_map(|l| l.split(['\r', '\n']))
        .take(20)
        .collect::<Vec<_>>()
        .join("\n");
    let mut best = ',';
    let mut best_score: i64 = -1;
    for delim in CANDIDATE_DELIMITERS {
        let counts = count_per_line(&sample, delim);
        let total: usize = counts.iter().sum();
        if total == 0 {
            continue;
        }
        let regular = counts.iter().max() == counts.iter().min();
        let score = total as i64 + if regular { 5 } else { 0 };
        if score > best_score {
            best_score = score;
            best = delim;
        }
    }
    best
}

fn blank(row: &[String]) -> bool {
    row.iter().all(|c| js_trim(c).is_empty())
}

fn fit(mut row: Vec<String>, width: usize) -> Vec<String> {
    row.resize(width, String::new());
    row
}

/// First non-blank row as headers (trimmed), the others fitted to its width.
fn to_matrix(raw: Vec<Vec<String>>, sheet_names: Option<Vec<String>>) -> TabularMatrix {
    let mut rows = raw.into_iter().filter(|r| !blank(r));
    let Some(first) = rows.next() else {
        return TabularMatrix {
            sheet_names,
            ..Default::default()
        };
    };
    let headers: Vec<String> = first.iter().map(|h| js_trim(h).to_string()).collect();
    let width = headers.len();
    TabularMatrix {
        sheet_names,
        headers,
        rows: rows.map(|r| fit(r, width)).collect(),
    }
}

/// `parseCsv(text)`.
pub fn parse_csv(text: &str) -> TabularMatrix {
    let clean = strip_bom(text);
    let delim = detect_delimiter(clean);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delim as u8)
        .from_reader(clean.as_bytes());
    let raw: Vec<Vec<String>> = reader
        .byte_records()
        .filter_map(Result::ok)
        .map(|rec| {
            rec.iter()
                .map(|f| String::from_utf8_lossy(f).into_owned())
                .collect()
        })
        .collect();
    to_matrix(raw, None)
}

/// `cellToString` of a JSON cell (the client-side XLSX matrix).
fn json_cell(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n
            .as_f64()
            .filter(|f| f.is_finite())
            .map(js_number_string)
            .unwrap_or_default(),
        Value::Bool(b) => b.to_string(),
        // `String([..])` / `String({..})`.
        Value::Array(a) => a
            .iter()
            .map(|x| {
                if x.is_null() {
                    String::new()
                } else {
                    json_cell(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `normalizeMatrix(matrix, sheetNames)`.
pub fn normalize_matrix(matrix: &[Vec<Value>], sheet_names: Option<Vec<String>>) -> TabularMatrix {
    let raw = matrix
        .iter()
        .map(|r| r.iter().map(json_cell).collect())
        .collect();
    to_matrix(raw, sheet_names)
}

/// One XLSX cell as SheetJS (`raw: true`, `defval: ""`) then `cellToString`.
fn xlsx_cell(d: &Data) -> String {
    match d {
        Data::Empty | Data::Error(_) => String::new(),
        Data::String(s) | Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Float(f) => js_number_string(*f),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        // Without `cellDates`, SheetJS keeps the serial number.
        Data::DateTime(dt) => js_number_string(dt.as_f64()),
    }
}

/// `parseXlsxBuffer`: the sheet names and the matrix of the first sheet.
pub fn parse_xlsx(bytes: &[u8]) -> Result<TabularMatrix, String> {
    let mut wb: Xlsx<_> = Xlsx::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let names = wb.sheet_names();
    let Some(first) = names.first().cloned() else {
        return Ok(to_matrix(vec![], Some(names)));
    };
    let range = wb.worksheet_range(&first).map_err(|e| e.to_string())?;
    let raw = range
        .rows()
        .map(|r| r.iter().map(xlsx_cell).collect())
        .collect();
    Ok(to_matrix(raw, Some(names)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn m(headers: &[&str], rows: &[&[&str]]) -> TabularMatrix {
        TabularMatrix {
            sheet_names: None,
            headers: headers.iter().map(|s| s.to_string()).collect(),
            rows: rows
                .iter()
                .map(|r| r.iter().map(|s| s.to_string()).collect())
                .collect(),
        }
    }

    #[test]
    fn delimiter_detection() {
        assert_eq!(detect_delimiter("a;b;c\n1;2;3"), ';');
        assert_eq!(detect_delimiter("a,b,c\n1,2,3"), ',');
        assert_eq!(detect_delimiter("a\tb\n1\t2"), '\t');
        // Commas inside quotes do not count; `;` wins ties.
        assert_eq!(detect_delimiter("\"a,b\";c\n\"d,e\";f"), ';');
        assert_eq!(detect_delimiter("a;b,c"), ';');
        assert_eq!(detect_delimiter("seul"), ',');
    }

    #[test]
    fn csv_bom_quotes_multiline_and_widths() {
        let text = "\u{feff} Nom ;Notes;X\r\n\"A;1\";\"l1\nl2 \"\"q\"\"\"\r\n\r\n;;\rB;n;x;extra\n";
        assert_eq!(
            parse_csv(text),
            m(
                &["Nom", "Notes", "X"],
                &[&["A;1", "l1\nl2 \"q\"", ""], &["B", "n", "x"]]
            )
        );
        assert_eq!(parse_csv(""), m(&[], &[]));
    }

    #[test]
    fn json_matrix_cells() {
        let mx = vec![
            vec![json!(" A "), json!("B"), json!(null)],
            vec![json!(""), json!(null), json!("")],
            vec![json!(2), json!(6.5), json!(true)],
        ];
        assert_eq!(
            normalize_matrix(&mx, Some(vec!["S".into()])),
            TabularMatrix {
                sheet_names: Some(vec!["S".into()]),
                ..m(&["A", "B", ""], &[&["2", "6.5", "true"]])
            }
        );
    }

    #[test]
    fn xlsx_unreadable() {
        assert!(parse_xlsx(b"pas un zip").is_err());
    }
}
