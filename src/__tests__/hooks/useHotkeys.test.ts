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

describe('useHotkeys modifier handling (A-61)', () => {
  it('does not trigger a bare-key binding when Cmd/Ctrl is held', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ '1': handler }))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not trigger a bare-key binding from inside an input even with Cmd held', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ '1': handler }))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true }))
    expect(handler).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('still triggers explicit modifier combos inside an input', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ 'Cmd+Enter': handler }))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    document.body.removeChild(input)
  })

  it('allows the bare-key fallback with Shift (e.g. "?")', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ '?': handler }))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('ignores composing and already-handled events', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ a: handler }))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', isComposing: true }))
    const handled = new KeyboardEvent('keydown', { key: 'a', cancelable: true })
    handled.preventDefault()
    document.dispatchEvent(handled)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('useHotkeys Mod+ and modal guard', () => {
  it('matches Mod+Enter with either Cmd or Ctrl', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ 'Mod+Enter': handler }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))
    expect(handler).toHaveBeenCalledTimes(2)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('does not fire while a modal dialog is open', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys({ a: handler }))
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(handler).not.toHaveBeenCalled()
    document.body.removeChild(dialog)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
