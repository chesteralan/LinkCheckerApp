import { useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { TargetListsPage } from '@/pages/TargetListsPage'
import { CheckTemplatesPage } from '@/pages/CheckTemplatesPage'
import { AuditsPage } from '@/pages/AuditsPage'

export type Page = 'target-lists' | 'check-templates' | 'audits'

function App() {
  const [activePage, setActivePage] = useState<Page>('target-lists')

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-border px-6 py-3 bg-background shrink-0">
        <h1 className="text-lg font-semibold">Link Checker</h1>
      </header>
      <div className="flex flex-1 min-h-0">
        <Sidebar active={activePage} onNavigate={setActivePage} />
        <main className="flex-1 overflow-y-auto p-6">
          {activePage === 'target-lists' && <TargetListsPage />}
          {activePage === 'check-templates' && <CheckTemplatesPage />}
          {activePage === 'audits' && <AuditsPage />}
        </main>
      </div>
    </div>
  )
}

export default App
