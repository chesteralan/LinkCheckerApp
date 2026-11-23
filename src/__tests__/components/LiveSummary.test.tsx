import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveSummary } from '@/components/LiveSummary'
import type { PageResult } from '@/types'

const page = (over: Partial<PageResult>): PageResult => ({
  url: 'https://x.test',
  pageTitle: null,
  status: 200,
  statusText: 'OK',
  responseTimeMs: 100,
  error: null,
  checks: [],
  ...over,
})

describe('LiveSummary', () => {
  it('marks the active filter with aria-pressed', () => {
    render(<LiveSummary results={[page({})]} filter="failed" onFilterChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /failed/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /passed/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('excludes errored pages from the average response time', () => {
    render(<LiveSummary results={[page({ responseTimeMs: 100 }), page({ error: 'timeout', responseTimeMs: 30000 })]} />)
    expect(screen.getByText('avg 100ms')).toBeInTheDocument()
  })
})
