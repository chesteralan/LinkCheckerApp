import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '@/utils/constants'
import { useStore } from '@/hooks/useStore'

export function Sidebar() {
  const navigate = useNavigate()
  const { targetLists, checkTemplates, audits } = useStore()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const q = query.toLowerCase().trim()

  const filteredNav = q
    ? NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q))
    : NAV_ITEMS

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
            placeholder="Search… (⌘K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 200)}
            className="w-full px-2 py-1.5 border border-border rounded-md text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {focused && q && results.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-background border border-border rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.to + r.label}
                  onMouseDown={() => {
                    navigate(r.to)
                    setQuery('')
                    setFocused(false)
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2"
                >
                  <span className="text-[10px] uppercase text-muted-foreground shrink-0 w-12">{r.type}</span>
                  <span className="truncate">{r.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-1">
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
