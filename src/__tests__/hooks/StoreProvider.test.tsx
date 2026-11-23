import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CheckTemplate, SelectorCheck } from '@/types'

vi.mock('@/lib/tauri', () => ({
  listTargetLists: vi.fn(),
  listCheckTemplates: vi.fn(),
  listAudits: vi.fn(),
  getStorageWarnings: vi.fn(),
  updateCheckTemplate: vi.fn(),
}))

import * as api from '@/lib/tauri'
import { StoreProvider } from '@/hooks/StoreProvider'
import { useStore } from '@/hooks/StoreContext'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const check = (id: string, selector: string): SelectorCheck => ({
  id,
  selector,
  label: selector,
  checkType: 'selector',
})

const template: CheckTemplate = {
  id: 't1',
  name: 'Template',
  checks: [check('c1', '.a')],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  pinned: false,
  folder: null,
}

const wrapper = ({ children }: { children: ReactNode }) => <StoreProvider>{children}</StoreProvider>

describe('StoreProvider', () => {
  beforeEach(() => {
    mocked.listTargetLists.mockResolvedValue([])
    mocked.listCheckTemplates.mockResolvedValue([template])
    mocked.listAudits.mockResolvedValue([])
    mocked.getStorageWarnings.mockResolvedValue([])
    mocked.updateCheckTemplate.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes storage warnings from the backend (A-01)', async () => {
    mocked.getStorageWarnings.mockResolvedValue(['data.json was corrupt and moved aside'])
    const { result } = renderHook(() => useStore(), { wrapper })
    await waitFor(() => expect(result.current.storageWarnings).toEqual(['data.json was corrupt and moved aside']))
    act(() => result.current.dismissStorageWarnings())
    expect(result.current.storageWarnings).toEqual([])
  })

  it('surfaces load failures instead of swallowing them', async () => {
    mocked.listAudits.mockRejectedValue('disk on fire')
    const { result } = renderHook(() => useStore(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toContain('disk on fire')
  })

  it('patchCheckTemplate debounces, sends check ids and adopts the saved template (A-03)', async () => {
    const saved: CheckTemplate = {
      ...template,
      checks: [check('c1', '.a'), check('c2', '.b')],
      updatedAt: '2026-02-02T00:00:00Z',
    }
    mocked.updateCheckTemplate.mockResolvedValue(saved)
    const { result } = renderHook(() => useStore(), { wrapper })
    await waitFor(() => expect(result.current.checkTemplates).toHaveLength(1))

    act(() => result.current.patchCheckTemplate('t1', { checks: [check('c1', '.a'), check('c2', '.x')] }))
    act(() => result.current.patchCheckTemplate('t1', { checks: [check('c1', '.a'), check('c2', '.b')] }))
    // Optimistic update keeps the ids the page supplied.
    expect(result.current.checkTemplates[0].checks.map((c) => c.id)).toEqual(['c1', 'c2'])

    await waitFor(() => expect(mocked.updateCheckTemplate).toHaveBeenCalledTimes(1))
    expect(mocked.updateCheckTemplate).toHaveBeenCalledWith({
      id: 't1',
      checks: [check('c1', '.a'), check('c2', '.b')],
    })
    await waitFor(() => expect(result.current.checkTemplates[0].updatedAt).toBe('2026-02-02T00:00:00Z'))
    expect(result.current.saveError).toBeNull()
  })

  it('patchCheckTemplate rolls back and reports the error when the save fails (A-02/A-03)', async () => {
    mocked.updateCheckTemplate.mockRejectedValue('unknown variant `foo`')
    const { result } = renderHook(() => useStore(), { wrapper })
    await waitFor(() => expect(result.current.checkTemplates).toHaveLength(1))

    act(() => result.current.patchCheckTemplate('t1', { checks: [check('c1', '.a'), check('c9', '.z')] }))
    expect(result.current.checkTemplates[0].checks).toHaveLength(2)

    await waitFor(() => expect(result.current.saveError).toContain('unknown variant'))
    expect(result.current.checkTemplates[0].checks).toEqual(template.checks)

    act(() => result.current.clearSaveError())
    expect(result.current.saveError).toBeNull()
  })
})
