import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TargetListsPage } from '@/pages/TargetListsPage'
import { CheckTemplatesPage } from '@/pages/CheckTemplatesPage'
import { CheckTemplateDetailPage } from '@/pages/CheckTemplateDetailPage'
import { AuditsPage } from '@/pages/AuditsPage'
import { AuditDetailPage } from '@/pages/AuditDetailPage'
import { RunHistoryPage } from '@/pages/RunHistoryPage'
import { RunDetailPage } from '@/pages/RunDetailPage'
import { QuickAuditPage } from '@/pages/QuickAuditPage'
import { useHotkeys } from '@/hooks/useHotkeys'
import { getDataPath, openDataFolder } from '@/lib/tauri'
import { HOTKEY_NAV } from '@/utils/constants'

declare const __APP_VERSION__: string

function App() {
  const navigate = useNavigate()
  const [dataPath, setDataPath] = useState('')

  useEffect(() => {
    getDataPath()
      .then(setDataPath)
      .catch(() => {})
  }, [])

  useHotkeys(Object.fromEntries(Object.entries(HOTKEY_NAV).map(([key, path]) => [key, () => navigate(path)])))

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-border px-6 py-3 bg-background shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          Link Checker
          <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md font-mono">
            v{__APP_VERSION__}
          </span>
        </h1>
        <span className="text-xs text-muted-foreground">1-4 to navigate</span>
      </header>
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/check-templates" replace />} />
              <Route path="/target-lists" element={<TargetListsPage />} />
              <Route path="/check-templates" element={<CheckTemplatesPage />} />
              <Route path="/check-templates/:id" element={<CheckTemplateDetailPage />} />
              <Route path="/check-templates/:id/quick-audit" element={<QuickAuditPage />} />
              <Route path="/audits" element={<AuditsPage />} />
              <Route path="/audits/:id" element={<AuditDetailPage />} />
              <Route path="/history" element={<RunHistoryPage />} />
              <Route path="/history/:runId" element={<RunDetailPage />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
      <footer className="border-t border-border px-6 py-2 bg-background shrink-0 text-xs text-muted-foreground flex items-center gap-2">
        <span>Data Folder:</span>
        <button
          onClick={openDataFolder}
          className="text-[11px] font-mono text-primary hover:underline text-left"
          title="Open data folder"
        >
          {dataPath || '...'}
        </button>
      </footer>
    </div>
  )
}

export default App
