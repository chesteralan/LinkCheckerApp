import { describe, it, expect } from 'vitest'
import { DEFAULTS, MODE_LABELS, NAV_ITEMS, HOTKEY_NAV, A11Y_CATEGORIES, toggleA11yCategory } from '@/utils/constants'

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

  it('NAV_ITEMS has well-formed, unique routes', () => {
    expect(NAV_ITEMS.length).toBeGreaterThan(0)
    NAV_ITEMS.forEach((item) => {
      expect(item.to).toMatch(/^\//)
      expect(item.label).toBeTruthy()
    })
    const routes = NAV_ITEMS.map((item) => item.to)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('HOTKEY_NAV maps 1..NAV_ITEMS.length to the nav routes in order', () => {
    const expectedKeys = NAV_ITEMS.map((_, i) => String(i + 1))
    expect(Object.keys(HOTKEY_NAV)).toEqual(expectedKeys)
    NAV_ITEMS.forEach((item, i) => {
      expect(HOTKEY_NAV[String(i + 1)]).toBe(item.to)
    })
  })
})

describe('toggleA11yCategory (A-64)', () => {
  it('unchecking one category from "all" selects every other category explicitly', () => {
    const next = toggleA11yCategory([], 'aria', false)
    expect(next).not.toBeNull()
    expect(next).not.toContain('aria')
    expect(next).toHaveLength(A11Y_CATEGORIES.length - 1)
  })

  it('refuses to uncheck the last selected category', () => {
    expect(toggleA11yCategory(['forms'], 'forms', false)).toBeNull()
  })

  it('collapses back to [] when every category is selected', () => {
    const allButOne = A11Y_CATEGORIES.map((c) => c.value).filter((v) => v !== 'media')
    expect(toggleA11yCategory(allButOne, 'media', true)).toEqual([])
  })

  it('keeps canonical order when adding a category', () => {
    expect(toggleA11yCategory(['forms'], 'document', true)).toEqual(['document', 'forms'])
  })
})
