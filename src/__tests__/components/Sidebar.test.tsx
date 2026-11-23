import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.mock('@/hooks/useStore', () => ({
  useStore: () => ({
    targetLists: [{ id: 'tl1', name: 'Alpha list', urls: ['https://alpha.test'] }],
    checkTemplates: [{ id: 'ct1', name: 'Alpha template', checks: [] }],
    audits: [{ id: 'au1', name: 'Alpha audit' }],
  }),
}))

import { Sidebar } from '@/components/Sidebar'

function Location() {
  return <div data-testid="loc">{useLocation().pathname}</div>
}

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar />
      <Routes>
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Sidebar search', () => {
  it('exposes a combobox with a listbox of results', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await user.type(input, 'alpha')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('navigates with arrow keys and Enter', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const input = screen.getByRole('combobox')
    await user.type(input, 'alpha')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    const options = screen.getAllByRole('option')
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[2].id)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('loc')).toHaveTextContent('/audits/au1')
    expect(input).toHaveValue('')
  })

  it('ArrowUp wraps to the last result', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const input = screen.getByRole('combobox')
    await user.type(input, 'alpha')
    await user.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
  })

  it('selects a result with a mouse click', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.type(screen.getByRole('combobox'), 'template')
    await user.click(screen.getByRole('option', { name: /Alpha template/ }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/check-templates/ct1')
  })

  it('Escape clears the query', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const input = screen.getByRole('combobox')
    await user.type(input, 'alpha')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
