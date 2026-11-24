import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const saveTextFile = vi.fn((_args: { defaultName: string; content: string }) => Promise.resolve('/tmp/x.csv'))
vi.mock('@/lib/tauri', () => ({ saveTextFile: (a: { defaultName: string; content: string }) => saveTextFile(a) }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }))
vi.mock('@/hooks/useStore', () => ({ useStore: () => ({ createTargetList: vi.fn() }) }))

import { LinkScanResults } from '@/components/LinkScanResults'
import type { LinkCheckResult } from '@/types'

const row: LinkCheckResult = {
  url: 'https://site.test/a',
  sourceUrl: 'https://site.test/',
  status: 200,
  statusText: '=HYPERLINK("http://evil","x")',
  error: null,
  depth: 1,
  a11yIssues: [],
}

describe('LinkScanResults export', () => {
  it('exports CSV through saveTextFile with formula cells neutralised', async () => {
    const user = userEvent.setup()
    render(<LinkScanResults results={[row]} exportName="scan" />)
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(saveTextFile).toHaveBeenCalledTimes(1)
    const args = saveTextFile.mock.calls[0][0]
    expect(args.defaultName).toMatch(/^scan-\d+\.csv$/)
    const lines = args.content.split('\n')
    expect(lines[0]).toBe('URL,Source URL,Depth,Status,Status Text,Error,A11y Issues')
    expect(lines[1]).toBe(`https://site.test/a,https://site.test/,1,200,"'=HYPERLINK(""http://evil"",""x"")",,0`)
  })

  it('shows an error when saving fails', async () => {
    saveTextFile.mockRejectedValueOnce('disk full')
    const user = userEvent.setup()
    render(<LinkScanResults results={[row]} />)
    await user.click(screen.getByRole('button', { name: 'Export JSON' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
  })
})
