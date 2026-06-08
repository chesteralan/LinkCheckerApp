import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '@/utils/constants'

export function Sidebar() {
  return (
    <aside className="w-56 border-r border-border bg-muted/30 flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Navigation</h2>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV_ITEMS.map((item) => (
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
      </nav>
    </aside>
  )
}
