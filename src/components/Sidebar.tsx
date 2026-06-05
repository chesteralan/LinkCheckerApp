import type { Page } from '@/App'

const nav: { id: Page; label: string }[] = [
  { id: 'check-templates', label: 'Check Templates' },
  { id: 'target-lists', label: 'Target Lists' },
  { id: 'audits', label: 'Audits' },
  { id: 'history', label: 'Run History' },
]

interface Props {
  active: Page
  onNavigate: (page: Page) => void
}

export function Sidebar({ active, onNavigate }: Props) {
  return (
    <aside className="w-56 border-r border-border bg-muted/30 flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Navigation
        </h2>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {nav.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              active === item.id
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
