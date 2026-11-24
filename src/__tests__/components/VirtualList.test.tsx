import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VirtualList, VirtualTable } from '@/components/VirtualList'

const items = Array.from({ length: 1000 }, (_, i) => `item-${i}`)
const getKey = (s: string) => s

describe('VirtualTable', () => {
  it('renders only a window of rows, each a direct <tr> child of <tbody>', () => {
    const { container } = render(
      <VirtualTable<string>
        items={items}
        getKey={getKey}
        estimateRowHeight={40}
        colSpan={1}
        header={
          <thead>
            <tr>
              <th>Name</th>
            </tr>
          </thead>
        }
        renderRow={(item, _i, rowProps) => (
          <tr key={item} {...rowProps}>
            <td>{item}</td>
          </tr>
        )}
      />,
    )
    const tbody = container.querySelector('tbody')!
    for (const child of Array.from(tbody.children)) {
      expect(child.tagName).toBe('TR')
    }
    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.queryByText('item-999')).toBeNull()
    expect(tbody.querySelectorAll('tr[data-vkey]').length).toBeLessThan(100)
    // A bottom spacer keeps the scroll height for the rows that are not rendered.
    expect(tbody.querySelector('tr[aria-hidden="true"]')).not.toBeNull()
  })

  it('renders the empty slot when there are no items', () => {
    render(
      <VirtualTable<string>
        items={[]}
        getKey={getKey}
        estimateRowHeight={40}
        colSpan={1}
        header={<thead />}
        renderRow={() => null}
        empty={
          <tr>
            <td>Nothing here</td>
          </tr>
        }
      />,
    )
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})

describe('VirtualList', () => {
  it('renders only a window of items', () => {
    render(
      <VirtualList<string> items={items} getKey={getKey} estimateHeight={100} renderItem={(item) => <p>{item}</p>} />,
    )
    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.queryByText('item-500')).toBeNull()
  })
})
