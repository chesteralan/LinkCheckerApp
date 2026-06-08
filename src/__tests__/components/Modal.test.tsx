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
})
