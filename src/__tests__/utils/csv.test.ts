import { describe, it, expect } from 'vitest'
import { csvEscape } from '@/utils/csv'

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

  it('handles mixed special characters', () => {
    expect(csvEscape('a,b,"c"')).toBe('"a,b,""c"""')
  })

  it('handles empty string', () => {
    expect(csvEscape('')).toBe('')
  })
})
