import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

import { updateAudit, updateTargetList, updateCheckTemplate } from '@/lib/tauri'

describe('update wrappers send clears as empty strings', () => {
  beforeEach(() => invoke.mockReset().mockResolvedValue({}))

  it('maps null baselineRunId/folder/originOverride to "" and leaves omitted keys out', async () => {
    await updateAudit({ id: 'a', baselineRunId: null, folder: null, originOverride: null })
    expect(invoke).toHaveBeenCalledWith('update_audit', {
      id: 'a',
      baselineRunId: '',
      folder: '',
      originOverride: '',
    })
  })

  it('keeps real values unchanged', async () => {
    await updateTargetList({ id: 't', folder: 'Marketing' })
    expect(invoke).toHaveBeenCalledWith('update_target_list', { id: 't', folder: 'Marketing' })
  })

  it('clears a check template folder', async () => {
    await updateCheckTemplate({ id: 'c', folder: null })
    expect(invoke).toHaveBeenCalledWith('update_check_template', { id: 'c', folder: '' })
  })
})
