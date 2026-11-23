import { useState, useRef, useEffect, useId, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '@/utils/constants'
import { useStore } from '@/hooks/useStore'

export function Sidebar() {
  const navigate = useNavigate()
  const { targetLists, checkTemplates, audits } = useStore()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-opt-${i}`
  const q = query.toLowerCase().trim()

  const filteredNav = q ? NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q)) : NAV_ITEMS

  const results = q
    ? [
        ...checkTemplates
          .filter((ct) => ct.name.toLowerCase().includes(q) || ct.checks.some((c) => c.label.toLowerCase().includes(q)))
          .map((ct) => ({ label: ct.name, to: `/check-templates/${ct.id}`, type: 'template' as const })),
        ...targetLists
          .filter((tl) => tl.name.toLowerCase().includes(q) || tl.urls.some((u) => u.toLowerCase().includes(q)))
          .map((tl) => ({ label: tl.name, to: `/target-lists`, type: 'list' as const })),
        ...audits
          .filter((a) => a.name.toLowerCase().includes(q))
          .map((a) => ({ label: a.name, to: `/audits/${a.id}`, type: 'audit' as const })),
      ].slice(0, 10)
    : []

  const open = focused && q.length > 0 && results.length > 0

  function choose(to: string) {
    navigate(to)
    setQuery('')
    setActiveIndex(-1)
    setFocused(false)
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (results.length === 0) return
      e.preventDefault()
      setFocused(true)
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      if (results.length === 0) return
      e.preventDefault()
      setFocused(true)
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const target = results[activeIndex >= 0 ? activeIndex : 0]
      if (target) choose(target.to)
    } else if (e.key === 'Escape') {
      if (query) {
        e.preventDefault()
        setQuery('')
        setActiveIndex(-1)
      } else {
        e.currentTarget.blur()
      }
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <aside className="w-56 border-r border-border bg-muted/30 flex flex-col">
      <div className="p-3 border-b border-border space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Navigation</h2>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search target lists, templates and audits"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            placeholder="Search… (⌘K)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(-1)
              setFocused(true)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false)
              setActiveIndex(-1)
            }}
            onKeyDown={handleKeyDown}
            className="w-full px-2 py-1.5 border border-border rounded-md text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div
            id={listboxId}
            role="listbox"
            aria-label="Search results"
            hidden={!open}
            className="absolute left-0 right-0 top-full mt-1 bg-background border border-border rounded-md shadow-lg z-50 max-h-48 overflow-y-auto"
          >
            {open &&
              results.map((r, i) => (
                <div
                  key={r.to + r.label + i}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  // Keep focus in the input so the list does not close before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(r.to)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full text-left px-3 py-2 text-xs cursor-pointer transition-colors flex items-center gap-2 ${
                    i === activeIndex ? 'bg-muted' : 'hover:bg-muted'
                  }`}
                >
                  <span className="text-[10px] uppercase text-muted-foreground shrink-0 w-12">{r.type}</span>
                  <span className="truncate">{r.label}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 p-2 space-y-1">
        {filteredNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `block w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                isActive ? 'bg-primary text-primary-foreground font-medium' : 'text-foreground hover:bg-muted'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        {q && filteredNav.length === 0 && results.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">No results.</p>
        )}
      </nav>
    </aside>
  )
}
