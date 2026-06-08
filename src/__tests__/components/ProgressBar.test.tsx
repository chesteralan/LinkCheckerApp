import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from '@/components/ProgressBar'

describe('ProgressBar', () => {
  it('renders progress text and percentage', () => {
    render(<ProgressBar checked={3} total={10} />)
    expect(screen.getByText(/3.*10/)).toBeInTheDocument()
    expect(screen.getByText(/30/)).toBeInTheDocument()
  })

  it('shows 0% when nothing checked', () => {
    render(<ProgressBar checked={0} total={10} />)
    expect(screen.getByText(/0%/)).toBeInTheDocument()
  })

  it('shows 100% when all checked', () => {
    render(<ProgressBar checked={10} total={10} />)
    expect(screen.getByText(/100%/)).toBeInTheDocument()
  })
})
