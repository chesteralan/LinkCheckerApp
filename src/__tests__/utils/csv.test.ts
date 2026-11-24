import { describe, it, expect } from 'vitest'
import { csvEscape, toCsv, toCsvRow } from '@/utils/csv'

describe('csvEscape', () => {
  it('returns simple strings unchanged', () => {
    expect(csvEscape('hello')).toBe('hello')
    expect(csvEscape('simple text')).toBe('simple text')
  })

  it('wraps strings containing commas in quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })

  it('wraps strings containing quotes in quotes and escapes them', () => {
    expect(csvEscape('say "hello"')).toBe('"say ""hello"""')
  })

  it('wraps strings containing newlines in quotes', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })

  it('wraps strings containing carriage returns in quotes', () => {
    expect(csvEscape('line1\rline2')).toBe('"line1\rline2"')
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('handles mixed special characters', () => {
    expect(csvEscape('a,b,"c"')).toBe('"a,b,""c"""')
  })

  it('handles empty string, null and undefined', () => {
    expect(csvEscape('')).toBe('')
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
  })

  it('neutralises spreadsheet formula prefixes', () => {
    expect(csvEscape('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvEscape('=1+1')).toBe("'=1+1")
    expect(csvEscape('+cmd')).toBe("'+cmd")
    expect(csvEscape('-2+3')).toBe("'-2+3")
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvEscape('\tx')).toBe("'\tx")
    expect(csvEscape('\rx')).toBe(`"'\rx"`)
  })

  it('leaves numbers and booleans numeric', () => {
    expect(csvEscape(42)).toBe('42')
    expect(csvEscape(-5)).toBe('-5')
    expect(csvEscape(0)).toBe('0')
    expect(csvEscape(true)).toBe('true')
  })

  it('does not touch formula characters in the middle of a value', () => {
    expect(csvEscape('a=b')).toBe('a=b')
    expect(csvEscape('https://x.test/?a=-1')).toBe('https://x.test/?a=-1')
  })
})

describe('toCsvRow / toCsv', () => {
  it('escapes every cell', () => {
    expect(toCsvRow(['a', 'b,c', null, 3, '=x'])).toBe(`a,"b,c",,3,'=x`)
  })

  it('escapes the header too', () => {
    expect(toCsv(['URL', 'Check, "1"'], [['https://a', 'ok']])).toBe('URL,"Check, ""1"""\nhttps://a,ok')
  })

  it('returns only the header for no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b')
  })
})
