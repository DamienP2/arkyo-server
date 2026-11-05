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
//!
//! Size guards (arkyo-server: the single process hosts the whole site, so
//! the work is bounded before any dense allocation): at most [`MAX_COLS`]
//! header columns (otherwise [`ParseError::TooManyColumns`]), at most
//! [`MAX_ROWS`] data rows kept (the rest is not even read), and an XLSX
//! archive decompresses to at most [`MAX_XLSX_UNCOMPRESSED`] bytes.

use std::collections::BTreeMap;
use std::io::{self, Cursor, Read};

use calamine::{Data, DataRef, Reader, Xlsx, XlsxError};
use serde::Serialize;
use serde_json::Value;

use super::{js_number_string, js_trim};

/// Data rows kept (arkyo `MAX_ROWS`, `boundMatrix`).
pub const MAX_ROWS: usize = 5000;
/// Header columns accepted (arkyo-server).
pub const MAX_COLS: usize = 200;
/// Total decompressed size of an XLSX archive (arkyo-server).
pub const MAX_XLSX_UNCOMPRESSED: u64 = 100 * 1024 * 1024;
/// Non-empty XLSX cells read (a full 5001 × 200 sheet).
const MAX_XLSX_CELLS: usize = (MAX_ROWS + 1) * MAX_COLS;

/// Why a spreadsheet is refused.
#[derive(Debug, PartialEq)]
pub enum ParseError {
    /// More than [`MAX_COLS`] columns.
    TooManyColumns,
    /// XLSX decompressing beyond [`MAX_XLSX_UNCOMPRESSED`], or too many cells.
    TooLarge,
    /// Not a readable XLSX.
    Unreadable(String),
}

/// `400` message of [`ParseError::TooManyColumns`].
pub fn too_many_columns_message() -> String {
    format!("Trop de colonnes (max {MAX_COLS})")
}

fn unreadable(e: impl std::fmt::Display) -> ParseError {
    ParseError::Unreadable(e.to_string())
}

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

/// First non-blank row as headers (trimmed, at most [`MAX_COLS`]), the next
/// [`MAX_ROWS`] non-blank rows cut or padded to its width. Rows are pulled
/// lazily: nothing past the kept rows is read, and a row is never stretched
/// beyond the header width.
fn to_matrix<R, C>(
    raw: impl IntoIterator<Item = R>,
    cell: impl Fn(&C) -> String,
    sheet_names: Option<Vec<String>>,
) -> Result<TabularMatrix, ParseError>
where
    R: AsRef<[C]>,
{
    let mut rows = raw
        .into_iter()
        .filter(|r| !r.as_ref().iter().all(|c| js_trim(&cell(c)).is_empty()));
    let Some(first) = rows.next() else {
        return Ok(TabularMatrix {
            sheet_names,
            ..Default::default()
        });
    };
    let first = first.as_ref();
    if first.len() > MAX_COLS {
        return Err(ParseError::TooManyColumns);
    }
    let headers: Vec<String> = first
        .iter()
        .map(|h| js_trim(&cell(h)).to_string())
        .collect();
    let width = headers.len();
    let rows = rows
        .take(MAX_ROWS)
        .map(|r| {
            let mut row: Vec<String> = r.as_ref().iter().take(width).map(&cell).collect();
            row.resize(width, String::new());
            row
        })
        .collect();
    Ok(TabularMatrix {
        sheet_names,
        headers,
        rows,
    })
}

/// `parseCsv(text)`.
pub fn parse_csv(text: &str) -> Result<TabularMatrix, ParseError> {
    let clean = strip_bom(text);
    let delim = detect_delimiter(clean);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delim as u8)
        .from_reader(clean.as_bytes());
    let raw = reader.byte_records().filter_map(Result::ok).map(|rec| {
        rec.iter()
            .map(|f| String::from_utf8_lossy(f).into_owned())
            .collect::<Vec<_>>()
    });
    to_matrix(raw, String::clone, None)
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
pub fn normalize_matrix<R: AsRef<[Value]>>(
    matrix: impl IntoIterator<Item = R>,
    sheet_names: Option<Vec<String>>,
) -> Result<TabularMatrix, ParseError> {
    to_matrix(matrix, json_cell, sheet_names)
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

/// Refuses an archive whose entries decompress to more than `limit` bytes in
/// all. The entries are actually inflated (into a sink): the sizes declared
/// by the zip directory can lie.
fn check_uncompressed(bytes: &[u8], limit: u64) -> Result<(), ParseError> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(unreadable)?;
    let mut total: u64 = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(unreadable)?;
        if entry.size() > limit - total {
            return Err(ParseError::TooLarge);
        }
        let read = io::copy(&mut (&mut entry).take(limit - total + 1), &mut io::sink())
            .map_err(unreadable)?;
        total += read;
        if total > limit {
            return Err(ParseError::TooLarge);
        }
    }
    Ok(())
}

/// `parseXlsxBuffer`: the sheet names and the matrix of the first sheet.
///
/// The cells are streamed (`worksheet_cells_reader`), never as a dense
/// `Range` (whose size is the used range: A1 + XFD1048576 would be 1.7e10
/// cells). The used range is anchored on the first non-empty row and column,
/// as `worksheet_range` does; its width is checked on every cell, reading
/// stops past the rows kept, and only the kept rows are made dense.
pub fn parse_xlsx(bytes: &[u8]) -> Result<TabularMatrix, ParseError> {
    check_uncompressed(bytes, MAX_XLSX_UNCOMPRESSED)?;
    let mut wb: Xlsx<_> = Xlsx::new(Cursor::new(bytes)).map_err(unreadable)?;
    let names = wb.sheet_names();
    let empty = |names| to_matrix(Vec::<Vec<String>>::new(), String::clone, Some(names));
    let Some(first) = names.first().cloned() else {
        return empty(names);
    };
    let mut reader = match wb.worksheet_cells_reader(&first) {
        Ok(r) => r,
        Err(XlsxError::NotAWorksheet(_)) => return empty(names),
        Err(e) => return Err(unreadable(e)),
    };
    // Row -> (column, text) of its non-empty cells.
    let mut by_row: BTreeMap<u32, Vec<(u32, String)>> = BTreeMap::new();
    let (mut min_col, mut max_col) = (u32::MAX, 0u32);
    let mut last_row: Option<u32> = None;
    let mut content_rows = 0usize;
    let mut cells = 0usize;
    while let Some(c) = reader.next_cell().map_err(unreadable)? {
        let value = c.get_value();
        if matches!(value, DataRef::Empty) {
            continue;
        }
        let (row, col) = c.get_position();
        if last_row.is_none_or(|l| row > l) {
            // Rows come in order: past the header and the kept rows, stop.
            if content_rows > MAX_ROWS {
                break;
            }
            last_row = Some(row);
        }
        min_col = min_col.min(col);
        max_col = max_col.max(col);
        if (max_col - min_col) as usize >= MAX_COLS {
            return Err(ParseError::TooManyColumns);
        }
        cells += 1;
        if cells > MAX_XLSX_CELLS {
            return Err(ParseError::TooLarge);
        }
        let text = xlsx_cell(&Data::from(value.clone()));
        let cells_of_row = by_row.entry(row).or_default();
        if !js_trim(&text).is_empty() && cells_of_row.iter().all(|(_, t)| js_trim(t).is_empty()) {
            content_rows += 1;
        }
        cells_of_row.push((col, text));
    }
    let width = if by_row.is_empty() {
        0
    } else {
        (max_col - min_col) as usize + 1
    };
    let dense = by_row.into_values().map(|cells| {
        let mut row = vec![String::new(); width];
        for (col, text) in cells {
            row[(col - min_col) as usize] = text;
        }
        row
    });
    to_matrix(dense, String::clone, Some(names))
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
            parse_csv(text).unwrap(),
            m(
                &["Nom", "Notes", "X"],
                &[&["A;1", "l1\nl2 \"q\"", ""], &["B", "n", "x"]]
            )
        );
        assert_eq!(parse_csv("").unwrap(), m(&[], &[]));
    }

    #[test]
    fn json_matrix_cells() {
        let mx = vec![
            vec![json!(" A "), json!("B"), json!(null)],
            vec![json!(""), json!(null), json!("")],
            vec![json!(2), json!(6.5), json!(true)],
        ];
        assert_eq!(
            normalize_matrix(&mx, Some(vec!["S".into()])).unwrap(),
            TabularMatrix {
                sheet_names: Some(vec!["S".into()]),
                ..m(&["A", "B", ""], &[&["2", "6.5", "true"]])
            }
        );
    }

    #[test]
    fn xlsx_unreadable() {
        assert!(matches!(
            parse_xlsx(b"pas un zip"),
            Err(ParseError::Unreadable(_))
        ));
    }

    /// Zip bomb: the entries are inflated against the limit, whatever the
    /// sizes the directory declares.
    #[test]
    fn xlsx_decompressed_size_is_bounded() {
        use std::io::Write;
        let mut buf = Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("a.xml", o).unwrap();
            z.write_all(&vec![b'0'; 60_000]).unwrap();
            z.start_file("b.xml", o).unwrap();
            z.write_all(&vec![b'0'; 60_000]).unwrap();
            z.finish().unwrap();
        }
        let bytes = buf.into_inner();
        assert!(bytes.len() < 2_000);
        assert_eq!(check_uncompressed(&bytes, 120_000), Ok(()));
        assert_eq!(
            check_uncompressed(&bytes, 100_000),
            Err(ParseError::TooLarge)
        );
    }

    /// Width capped before stretching; rows past `MAX_ROWS` are not kept.
    #[test]
    fn width_and_rows_are_bounded() {
        let wide = format!("{}\nx\n", vec!["a"; MAX_COLS + 1].join(";"));
        assert_eq!(parse_csv(&wide), Err(ParseError::TooManyColumns));
        let mut header = vec![json!("a"); MAX_COLS + 1];
        assert_eq!(
            normalize_matrix([header.clone(), vec![json!("x")]], None),
            Err(ParseError::TooManyColumns)
        );
        header.truncate(MAX_COLS);
        let ok = normalize_matrix([header, vec![json!("x")]], None).unwrap();
        assert_eq!(ok.rows[0].len(), MAX_COLS);
        let mut csv = String::from("Nom\n");
        for i in 0..MAX_ROWS + 10 {
            csv.push_str(&format!("{i};{}\n", vec!["y"; 1000].join(";")));
        }
        let m = parse_csv(&csv).unwrap();
        assert_eq!(m.rows.len(), MAX_ROWS);
        assert!(m.rows.iter().all(|r| r.len() == 1));
    }

    #[test]
    fn xlsx_sparse_used_range_is_refused() {
        use rust_xlsxwriter::Workbook;
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.write_string(0, 0, "Nom").unwrap();
        ws.write_string(1_048_575, 16_383, "x").unwrap();
        let bytes = wb.save_to_buffer().unwrap();
        assert_eq!(parse_xlsx(&bytes), Err(ParseError::TooManyColumns));
        // Anchored on the first used column, like `worksheet_range`.
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.write_string(2, 3, "Nom").unwrap();
        ws.write_string(2, 3 + MAX_COLS as u16 - 1, "Fin").unwrap();
        ws.write_string(4, 3, "A").unwrap();
        let m = parse_xlsx(&wb.save_to_buffer().unwrap()).unwrap();
        assert_eq!(m.headers.len(), MAX_COLS);
        assert_eq!(m.rows.len(), 1);
        assert_eq!(m.rows[0][0], "A");
    }
}
