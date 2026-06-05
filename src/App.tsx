import { useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { TargetListsPage } from '@/pages/TargetListsPage'
import { CheckTemplatesPage } from '@/pages/CheckTemplatesPage'
import { AuditsPage } from '@/pages/AuditsPage'
import { RunHistoryPage } from '@/pages/RunHistoryPage'
import { QuickAuditPage } from '@/pages/QuickAuditPage'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useStore } from '@/hooks/useStore'
import type { CheckTemplate } from '@/types'

declare const __APP_VERSION__: string

export type Page = 'target-lists' | 'check-templates' | 'audits' | 'history'

function App() {
  const { checkTemplates } = useStore()
  const [activePage, setActivePage] = useState<Page>('target-lists')
  const [quickAuditTemplateId, setQuickAuditTemplateId] = useState<string | null>(null)

  useHotkeys({
    '1': () => { setQuickAuditTemplateId(null); setActivePage('check-templates') },
    '2': () => { setQuickAuditTemplateId(null); setActivePage('target-lists') },
    '3': () => { setQuickAuditTemplateId(null); setActivePage('audits') },
    '4': () => { setQuickAuditTemplateId(null); setActivePage('history') },
  })

  function handleNavigate(page: Page) {
    setQuickAuditTemplateId(null)
    setActivePage(page)
  }

  function handleQuickAudit(templateId: string) {
    setQuickAuditTemplateId(templateId)
    setActivePage('check-templates')
  }

  const quickAuditTemplate: CheckTemplate | null = quickAuditTemplateId
    ? checkTemplates.find((ct) => ct.id === quickAuditTemplateId) ?? null
    : null

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-border px-6 py-3 bg-background shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          Link Checker
          <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md font-mono">v{__APP_VERSION__}</span>
        </h1>
        <span className="text-xs text-muted-foreground">1-4 to navigate</span>
      </header>
      <div className="flex flex-1 min-h-0">
        <Sidebar active={activePage} onNavigate={handleNavigate} />
        <main className="flex-1 overflow-y-auto p-6">
          {quickAuditTemplate ? (
            <QuickAuditPage template={quickAuditTemplate} onBack={() => setQuickAuditTemplateId(null)} />
          ) : activePage === 'target-lists' ? (
            <TargetListsPage />
          ) : activePage === 'check-templates' ? (
            <CheckTemplatesPage onQuickAudit={handleQuickAudit} />
          ) : activePage === 'audits' ? (
            <AuditsPage />
          ) : activePage === 'history' ? (
            <RunHistoryPage />
          ) : null}
        </main>
      </div>
    </div>
  )
}

export default App
