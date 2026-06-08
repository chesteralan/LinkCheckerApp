import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHotkeys } from '@/hooks/useHotkeys'

describe('useHotkeys', () => {
  it('calls handler on matching keypress', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ a: handler }))

    const event = new KeyboardEvent('keydown', { key: 'a' })
    document.dispatchEvent(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not call handler for non-matching key', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ a: handler }))

    const event = new KeyboardEvent('keydown', { key: 'b' })
    document.dispatchEvent(event)
    expect(handler).not.toHaveBeenCalled()
  })

  it('calls handler on Cmd+key combo', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ 'Cmd+r': handler }))

    const event = new KeyboardEvent('keydown', { key: 'r', metaKey: true })
    document.dispatchEvent(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('skips handler when focused on input (without modifier)', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ a: handler }))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    input.dispatchEvent(event)
    expect(handler).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })
})
