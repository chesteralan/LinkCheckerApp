import { describe, it, expect } from 'vitest'
import { DEFAULTS, MODE_LABELS, NAV_ITEMS, HOTKEY_NAV } from '@/utils/constants'

describe('constants', () => {
  it('DEFAULTS has expected shape', () => {
    expect(DEFAULTS.batchSize).toBeGreaterThan(0)
    expect(DEFAULTS.timeoutSecs).toBeGreaterThan(0)
    expect(['sequential', 'batch']).toContain(DEFAULTS.mode)
  })

  it('MODE_LABELS contains all modes', () => {
    expect(MODE_LABELS.sequential).toBeTruthy()
    expect(MODE_LABELS.batch).toBeTruthy()
  })

  it('NAV_ITEMS has all routes', () => {
    expect(NAV_ITEMS).toHaveLength(5)
    NAV_ITEMS.forEach((item) => {
      expect(item.to).toMatch(/^\//)
      expect(item.label).toBeTruthy()
    })
  })

  it('HOTKEY_NAV maps 1-5 to routes', () => {
    expect(Object.keys(HOTKEY_NAV)).toEqual(['1', '2', '3', '4', '5'])
    Object.values(HOTKEY_NAV).forEach((path) => {
      expect(path).toMatch(/^\//)
    })
  })
})
