import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const openUrl = vi.fn((_url: string) => Promise.resolve())
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (u: string) => openUrl(u) }))

import { A11yIssuesList } from '@/components/A11yIssuesList'
import { a11yReportToHtml, safeHref } from '@/lib/a11yReportHtml'
import type { A11yIssue, A11yReport } from '@/types'

const issue = (over: Partial<A11yIssue> = {}): A11yIssue => ({
  issueType: 'image-alt',
  element: '<img>',
  selector: 'img',
  message: 'Image has no alt',
  severity: 'critical',
  wcag: '1.1.1',
  standards: ['wcag'],
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
  ...over,
})

describe('safeHref', () => {
  it('allows http and https URLs', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHref('http://example.com')).toBe('http://example.com/')
    expect(safeHref('  https://x.test  ')).toBe('https://x.test/')
  })

  it('rejects other schemes, relative and empty values', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref(' JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<script>1</script>')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
    expect(safeHref('/relative')).toBeNull()
    expect(safeHref('')).toBeNull()
    expect(safeHref(null)).toBeNull()
    expect(safeHref(undefined)).toBeNull()
  })
})

describe('A11yIssuesList', () => {
  beforeEach(() => openUrl.mockClear())

  it('gives the help button an accessible name and opens safe URLs', async () => {
    const user = userEvent.setup()
    render(<A11yIssuesList issues={[issue()]} />)
    await user.click(screen.getByRole('button', { name: /guidance for image-alt/i }))
    expect(openUrl).toHaveBeenCalledWith('https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html')
  })

  it('hides the help button for unsafe URLs', () => {
    render(<A11yIssuesList issues={[issue({ helpUrl: 'javascript:alert(1)' })]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('a11yReportToHtml', () => {
  const report = (issues: A11yIssue[], url = 'https://site.test/'): A11yReport => ({
    id: 'r1234567890',
    auditId: 'a1',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    status: 'completed',
    results: [
      { url, pageTitle: null, status: 200, statusText: 'OK', responseTimeMs: 5, error: null, issues, truncated: true },
    ],
    summary: { totalPages: 1, pagesWithIssues: 1, errored: 0, critical: 1, serious: 0, moderate: 0, minor: 0 },
    standards: ['wcag21aa'],
    engine: 'axe-core',
  })

  it('drops non-http(s) hrefs and includes a CSP meta tag', () => {
    const html = a11yReportToHtml(report([issue({ helpUrl: 'javascript:alert(1)' })], 'javascript:alert(2)'), 'Audit')
    expect(html).not.toMatch(/href="javascript:/i)
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('javascript:alert(2)') // still shown, escaped, as text
  })

  it('links safe URLs and notes truncation and engine', () => {
    const html = a11yReportToHtml(report([issue()]), 'Audit')
    expect(html).toContain('href="https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html"')
    expect(html).toContain('href="https://site.test/"')
    expect(html).toContain('truncated')
    expect(html).toContain('Engine: axe-core')
  })
})
