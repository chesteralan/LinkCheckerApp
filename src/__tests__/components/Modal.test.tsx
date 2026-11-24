import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '@/components/Modal'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}}>
        content
      </Modal>,
    )
    expect(container.textContent).toBe('')
  })

  it('renders children when open', () => {
    render(
      <Modal open={true} onClose={() => {}}>
        modal content
      </Modal>,
    )
    expect(screen.getByText('modal content')).toBeInTheDocument()
  })

  it('renders title when provided', () => {
    render(
      <Modal open={true} onClose={() => {}} title="Test Title">
        content
      </Modal>,
    )
    expect(screen.getByText('Test Title')).toBeInTheDocument()
  })

  it('is an accessible modal dialog named by its title', () => {
    render(
      <Modal open={true} onClose={() => {}} title="Edit list">
        content
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit list' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('uses ariaLabel when there is no title', () => {
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="Details">
        content
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeInTheDocument()
  })

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <Modal open={true} onClose={onClose}>
        content
      </Modal>,
    )

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the dialog and traps Tab', async () => {
    const user = userEvent.setup()
    render(
      <Modal open={true} onClose={() => {}} title="T">
        <button>first</button>
        <button>last</button>
      </Modal>,
    )
    // Initial focus skips the close button and lands on the first content control.
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
  })

  it('restores focus to the opener when closed', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <Modal open={open} onClose={() => setOpen(false)} title="T">
            <button>inside</button>
          </Modal>
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'open' })
    await user.click(opener)
    expect(screen.getByRole('button', { name: 'inside' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('Escape closes only the topmost of stacked modals', async () => {
    const user = userEvent.setup()
    const outerClose = vi.fn()
    const innerClose = vi.fn()
    function Harness() {
      const [inner, setInner] = useState(false)
      return (
        <Modal open={true} onClose={outerClose} title="Outer">
          <button onClick={() => setInner(true)}>more</button>
          <Modal
            open={inner}
            onClose={() => {
              innerClose()
              setInner(false)
            }}
            title="Inner"
          >
            <button>inner button</button>
          </Modal>
        </Modal>
      )
    }
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'more' }))
    expect(screen.getByRole('dialog', { name: 'Inner' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(innerClose).toHaveBeenCalledTimes(1)
    expect(outerClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument()
  })

  it('stops key events from reaching global hotkey listeners', async () => {
    const user = userEvent.setup()
    const globalKey = vi.fn()
    document.addEventListener('keydown', globalKey)
    try {
      render(
        <Modal open={true} onClose={() => {}} title="T">
          <button>inside</button>
        </Modal>,
      )
      await user.keyboard('1')
      expect(globalKey).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', globalKey)
    }
  })
})
