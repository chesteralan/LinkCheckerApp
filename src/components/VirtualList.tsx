import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'

/** Viewport height assumed before the scroll container has been measured (or without ResizeObserver). */
const FALLBACK_VIEWPORT = 800

interface VirtualRange {
  start: number
  end: number
  /** Space above the first rendered item. */
  padTop: number
  /** Space below the last rendered item. */
  padBottom: number
  /** Ref callback that measures a rendered item. The element needs `data-vkey`. */
  measure: (el: HTMLElement | null) => void | (() => void)
}

/**
 * Windowing with measured, variable item heights (A-20). Heights are cached by
 * key, so filtering the list does not lose measurements; unmeasured items use
 * `estimate`.
 */
function useVirtualRange(
  scrollRef: RefObject<HTMLElement | null>,
  keys: string[],
  estimate: number,
  overscan: number,
): VirtualRange {
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) setViewport(entry.contentRect.height)
      })
      observer.observe(el)
    }
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [scrollRef])

  const itemObserver = useMemo(() => {
    if (typeof ResizeObserver === 'undefined') return null
    return new ResizeObserver((entries) => {
      const measured: [string, number][] = []
      for (const entry of entries) {
        const target = entry.target as HTMLElement
        const key = target.dataset.vkey
        const h = target.getBoundingClientRect().height
        if (key != null && h > 0) measured.push([key, h])
      }
      if (measured.length === 0) return
      setHeights((prev) => {
        if (measured.every(([k, h]) => prev.get(k) === h)) return prev
        const next = new Map(prev)
        for (const [k, h] of measured) next.set(k, h)
        return next
      })
    })
  }, [])

  useEffect(() => () => itemObserver?.disconnect(), [itemObserver])

  const measure = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !itemObserver) return
      itemObserver.observe(el)
      return () => itemObserver.unobserve(el)
    },
    [itemObserver],
  )

  const offsets = useMemo(() => {
    const out = new Array<number>(keys.length + 1)
    out[0] = 0
    for (let i = 0; i < keys.length; i++) {
      out[i + 1] = out[i] + (heights.get(keys[i]) ?? estimate)
    }
    return out
  }, [keys, estimate, heights])

  const total = offsets[keys.length]
  const height = viewport > 0 ? viewport : FALLBACK_VIEWPORT
  // First item whose bottom edge is below scrollTop.
  let lo = 0
  let hi = keys.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= scrollTop) lo = mid + 1
    else hi = mid
  }
  const start = Math.max(0, lo - overscan)
  let last = lo
  while (last < keys.length && offsets[last] < scrollTop + height) last++
  const end = Math.min(keys.length, last + overscan)

  return { start, end, padTop: offsets[start], padBottom: total - offsets[end], measure }
}

interface ListProps<T> {
  items: T[]
  /** Stable, unique key per item. */
  getKey: (item: T, index: number) => string
  /** Height used before an item has been measured. */
  estimateHeight: number
  overscan?: number
  renderItem: (item: T, index: number) => ReactNode
  /** Classes for the scroll container. Give it a bounded height (e.g. `max-h-[70vh]`). */
  className?: string
  /** Classes for each item wrapper; use padding (not margin) for gaps so it is measured. */
  itemClassName?: string
}

/** A vertically scrolling list that renders only the visible items, which may vary in height. */
export function VirtualList<T>({
  items,
  getKey,
  estimateHeight,
  overscan = 5,
  renderItem,
  className = 'max-h-[70vh] overflow-y-auto',
  itemClassName,
}: ListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const keys = useMemo(() => items.map(getKey), [items, getKey])
  const { start, end, padTop, padBottom, measure } = useVirtualRange(scrollRef, keys, estimateHeight, overscan)

  return (
    <div ref={scrollRef} className={className}>
      <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
        {items.slice(start, end).map((item, i) => (
          <div key={keys[start + i]} data-vkey={keys[start + i]} ref={measure} className={itemClassName}>
            {renderItem(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  )
}

interface TableProps<T> {
  items: T[]
  getKey: (item: T, index: number) => string
  estimateRowHeight: number
  overscan?: number
  /** Number of columns, for the spacer rows. */
  colSpan: number
  /** The table's `<thead>`. It is made sticky inside the scroll area. */
  header: ReactNode
  /** Renders one `<tr>`. Spread `rowProps` onto it so the row can be measured. */
  renderRow: (item: T, index: number, rowProps: { 'data-vkey': string; ref: VirtualRange['measure'] }) => ReactNode
  /** Rendered as the body when `items` is empty. */
  empty?: ReactNode
  /** Classes for the scroll container. Give it a bounded height. */
  className?: string
  tableClassName?: string
  tableStyle?: CSSProperties
  tbodyClassName?: string
}

/**
 * A table whose body is windowed with spacer rows, so the markup stays valid
 * (`tbody > tr`) and columns keep lining up with the header.
 */
export function VirtualTable<T>({
  items,
  getKey,
  estimateRowHeight,
  overscan = 10,
  colSpan,
  header,
  renderRow,
  empty,
  className = 'max-h-[70vh] overflow-auto',
  tableClassName,
  tableStyle,
  tbodyClassName,
}: TableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const keys = useMemo(() => items.map(getKey), [items, getKey])
  const { start, end, padTop, padBottom, measure } = useVirtualRange(scrollRef, keys, estimateRowHeight, overscan)
  const spacerCell: CSSProperties = { padding: 0, border: 0 }

  return (
    <div ref={scrollRef} className={className}>
      <table className={tableClassName} style={tableStyle}>
        {header}
        <tbody className={tbodyClassName}>
          {items.length === 0
            ? empty
            : [
                padTop > 0 && (
                  <tr key="__top" aria-hidden="true" style={{ height: padTop }}>
                    <td colSpan={colSpan} style={spacerCell} />
                  </tr>
                ),
                ...items
                  .slice(start, end)
                  .map((item, i) => renderRow(item, start + i, { 'data-vkey': keys[start + i], ref: measure })),
                padBottom > 0 && (
                  <tr key="__bottom" aria-hidden="true" style={{ height: padBottom }}>
                    <td colSpan={colSpan} style={spacerCell} />
                  </tr>
                ),
              ]}
        </tbody>
      </table>
    </div>
  )
}
