import { useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { TargetListsPage } from '@/pages/TargetListsPage'
import { CheckTemplatesPage } from '@/pages/CheckTemplatesPage'
import { AuditsPage } from '@/pages/AuditsPage'
import { RunHistoryPage } from '@/pages/RunHistoryPage'
import { useHotkeys } from '@/hooks/useHotkeys'

export type Page = 'target-lists' | 'check-templates' | 'audits' | 'history'

function App() {
  const [activePage, setActivePage] = useState<Page>('target-lists')

  useHotkeys({
    '1': () => setActivePage('target-lists'),
    '2': () => setActivePage('check-templates'),
    '3': () => setActivePage('audits'),
    '4': () => setActivePage('history'),
  })

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-border px-6 py-3 bg-background shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Link Checker</h1>
        <span className="text-xs text-muted-foreground">1-4 to navigate</span>
      </header>
      <div className="flex flex-1 min-h-0">
        <Sidebar active={activePage} onNavigate={setActivePage} />
        <main className="flex-1 overflow-y-auto p-6">
          {activePage === 'target-lists' && <TargetListsPage />}
          {activePage === 'check-templates' && <CheckTemplatesPage />}
          {activePage === 'audits' && <AuditsPage />}
          {activePage === 'history' && <RunHistoryPage />}
        </main>
      </div>
    </div>
  )
}

export default App
