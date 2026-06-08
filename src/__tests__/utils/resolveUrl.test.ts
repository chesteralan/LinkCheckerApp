import { describe, it, expect } from 'vitest'
import { resolveUrl } from '@/utils/resolveUrl'

describe('resolveUrl', () => {
  it('returns absolute URLs unchanged', () => {
    expect(resolveUrl('https://example.com/page', 'https://example.com')).toBe('https://example.com/page')
    expect(resolveUrl('http://other.com', 'https://example.com')).toBe('http://other.com')
  })

  it('resolves relative URLs against source', () => {
    expect(resolveUrl('/path', 'https://example.com')).toBe('https://example.com/path')
    expect(resolveUrl('relative', 'https://example.com/base')).toBe('https://example.com/relative')
  })

  it('handles invalid source URLs gracefully', () => {
    expect(resolveUrl('/path', 'not-a-url')).toBe('/path')
  })

  it('handles empty href', () => {
    expect(resolveUrl('', 'https://example.com')).toBe('https://example.com/')
  })
})
