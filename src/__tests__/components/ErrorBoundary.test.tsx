import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>safe content</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('safe content')).toBeInTheDocument()
  })

  it('catches errors and shows error UI', () => {
    const ThrowingComponent = () => {
      throw new Error('test error')
    }

    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })
})

describe('ErrorBoundary resetKey', () => {
  it('clears the error when resetKey changes', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    const Maybe = () => {
      if (shouldThrow) throw new Error('boom')
      return <div>recovered</div>
    }
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Maybe />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
    shouldThrow = false
    rerender(
      <ErrorBoundary resetKey="/b">
        <Maybe />
      </ErrorBoundary>,
    )
    expect(screen.getByText('recovered')).toBeInTheDocument()
    errorSpy.mockRestore()
  })
})
