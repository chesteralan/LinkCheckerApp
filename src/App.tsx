import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { Modal } from '@/components/Modal'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TargetListsPage } from '@/pages/TargetListsPage'
import { CheckTemplatesPage } from '@/pages/CheckTemplatesPage'
import { CheckTemplateDetailPage } from '@/pages/CheckTemplateDetailPage'
import { AuditsPage } from '@/pages/AuditsPage'
import { AuditDetailPage } from '@/pages/AuditDetailPage'
import { RunHistoryPage } from '@/pages/RunHistoryPage'
import { RunDetailPage } from '@/pages/RunDetailPage'
import { RunDiffPage } from '@/pages/RunDiffPage'
import { QuickAuditPage } from '@/pages/QuickAuditPage'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRun } from '@/hooks/useRun'
import { useTheme } from '@/hooks/ThemeContext'
import { getDataPath, openDataFolder } from '@/lib/tauri'
import { HOTKEY_NAV } from '@/utils/constants'

declare const __APP_VERSION__: string

const SHORTCUTS = [
  { key: '1', action: 'Navigate to Check Templates' },
  { key: '2', action: 'Navigate to Target Lists' },
  { key: '3', action: 'Navigate to Audits' },
  { key: '4', action: 'Navigate to Run History' },
  { key: 'Escape', action: 'Close modal / Cancel' },
  { key: 'Cmd+Enter', action: 'Submit form' },
  { key: '?', action: 'Toggle this shortcut reference' },
  { key: '⌘K', action: 'Focus global search' },
]

function App() {
  const navigate = useNavigate()
  const [dataPath, setDataPath] = useState('')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const { running, runPagePath, progress, cancel } = useRun()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    getDataPath()
      .then(setDataPath)
      .catch(() => {})
  }, [])

  useHotkeys({
    ...Object.fromEntries(Object.entries(HOTKEY_NAV).map(([key, path]) => [key, () => navigate(path)])),
    '?': () => setShowShortcuts((s) => !s),
  })

  const cycleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')
  }

  const themeIcon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '⚙'

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-border px-6 py-3 bg-background shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          Link Checker
          <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md font-mono">
            v{__APP_VERSION__}
          </span>
        </h1>
        {running ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (runPagePath) navigate(runPagePath)
              }}
              disabled={!runPagePath}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none"
              title={runPagePath ? 'View running audit' : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span>
                Running{progress ? `: ${progress.checked}/${progress.total} checked` : '...'}
              </span>
              <span className="w-20 h-1.5 bg-muted rounded-full overflow-hidden inline-block">
                {progress && (
                  <span
                    className="block h-full bg-primary rounded-full transition-all"
                    style={{ width: `${(progress.checked / progress.total) * 100}%` }}
                  />
                )}
              </span>
            </button>
            <button
              onClick={cancel}
              className="text-xs px-2 py-0.5 bg-destructive text-destructive-foreground rounded font-medium hover:opacity-90 transition-opacity"
            >
              Cancel
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">? for shortcuts</span>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={cycleTheme}
            className="text-sm px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors"
            title={`Theme: ${theme}`}
          >
            {themeIcon}
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors font-mono"
            title="Keyboard shortcuts"
          >
            ?
          </button>
        </div>
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
              <Route path="/history/diff/:runIdA/:runIdB" element={<RunDiffPage />} />
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

      <Modal open={showShortcuts} onClose={() => setShowShortcuts(false)} title="Keyboard Shortcuts">
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.action}</span>
              <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono border border-border">{s.key}</kbd>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

export default App
