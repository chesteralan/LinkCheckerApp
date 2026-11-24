/** A value that can be written into one CSV cell. */
export type CsvCell = string | number | boolean | null | undefined

/**
 * Characters that make Excel, Numbers, LibreOffice or Google Sheets treat a
 * cell as a formula (or a DDE command) when it is the first character.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

/**
 * Escape one CSV cell (RFC 4180) and neutralise spreadsheet formulas.
 *
 * - `null`/`undefined` become an empty cell.
 * - Text starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`, so a
 *   page-controlled value such as `=HYPERLINK(...)` stays inert text.
 *   Finite numbers are left alone, so negative numbers stay numeric.
 * - The cell is quoted when it contains `,`, `"`, `\n` or `\r`, and inner quotes
 *   are doubled.
 */
export function csvEscape(val: CsvCell): string {
  if (val == null) return ''
  let s = String(val)
  if (typeof val !== 'number' && FORMULA_PREFIX.test(s)) {
    s = `'${s}`
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Escape every cell and join them into one CSV line. */
export function toCsvRow(cells: readonly CsvCell[]): string {
  return cells.map(csvEscape).join(',')
}

/** Build a whole CSV document: a header row followed by data rows (CRLF-free, `\n` separated). */
export function toCsv(header: readonly CsvCell[], rows: readonly (readonly CsvCell[])[]): string {
  return [toCsvRow(header), ...rows.map(toCsvRow)].join('\n')
}
