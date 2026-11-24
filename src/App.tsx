import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
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
import { LinkCheckerPage } from '@/pages/LinkCheckerPage'
import { LinkCheckHistoryPage } from '@/pages/LinkCheckHistoryPage'
import { LinkCheckScanPage } from '@/pages/LinkCheckScanPage'
import { AccessibilityPage } from '@/pages/AccessibilityPage'
import { A11yReportPage } from '@/pages/A11yReportPage'
import { A11yReportDiffPage } from '@/pages/A11yReportDiffPage'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRun } from '@/hooks/useRun'
import { useStore } from '@/hooks/useStore'
import { useTheme } from '@/hooks/ThemeContext'
import { getDataPath, openDataFolder } from '@/lib/tauri'
import { HOTKEY_NAV } from '@/utils/constants'

declare const __APP_VERSION__: string

const SHORTCUTS = [
  { key: '1', action: 'Navigate to Check Templates' },
  { key: '2', action: 'Navigate to Target Lists' },
  { key: '3', action: 'Navigate to Audits' },
  { key: '4', action: 'Navigate to Run History' },
  { key: '5', action: 'Navigate to Link Checker' },
  { key: '6', action: 'Navigate to Accessibility' },
  { key: 'Escape', action: 'Close modal / Cancel' },
  { key: '⌘/Ctrl+Enter', action: 'Submit form' },
  { key: '?', action: 'Toggle this shortcut reference' },
  { key: '⌘K', action: 'Focus global search' },
]

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [dataPath, setDataPath] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const { running, runPagePath, progress, cancel, error: runError, clearError: clearRunError } = useRun()
  const { storageWarnings, dismissStorageWarnings, saveError, clearSaveError, loadError, reload } = useStore()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    getDataPath()
      .then(setDataPath)
      .catch((e) => console.error('Failed to get data path', e))
  }, [])

  const revealDataFolder = () => {
    setFolderError(null)
    openDataFolder().catch((e) => setFolderError(`Could not open the data folder: ${String(e)}`))
  }

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
              <span>Running{progress ? `: ${progress.checked}/${progress.total} checked` : '...'}</span>
              <span className="w-20 h-1.5 bg-muted rounded-full overflow-hidden inline-block">
                {progress && (
                  <span
                    className="block h-full bg-primary rounded-full transition-all"
                    style={{ width: `${progress.total > 0 ? (progress.checked / progress.total) * 100 : 0}%` }}
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
            aria-label={`Theme: ${theme}. Click to change.`}
          >
            <span aria-hidden="true">{themeIcon}</span>
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors font-mono"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
          >
            ?
          </button>
        </div>
      </header>
      {storageWarnings.length > 0 && (
        <div role="alert" className="border-b border-destructive/40 bg-destructive/10 px-6 py-2 text-sm shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-destructive">There was a problem loading your saved data</p>
              <ul className="mt-1 list-disc pl-5 text-foreground">
                {storageWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                Any damaged file was kept in the data folder shown at the bottom of the window.
              </p>
            </div>
            <button
              onClick={dismissStorageWarnings}
              className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {loadError && (
        <ErrorBanner
          message={loadError}
          actionLabel="Retry"
          onAction={() => {
            reload()
          }}
        />
      )}
      {saveError && <ErrorBanner message={saveError} actionLabel="Dismiss" onAction={clearSaveError} />}
      {runError && (
        <ErrorBanner message={`The run failed: ${runError}`} actionLabel="Dismiss" onAction={clearRunError} />
      )}
      {folderError && <ErrorBanner message={folderError} actionLabel="Dismiss" onAction={() => setFolderError(null)} />}
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          {/* Keyed by path so a crash on one page does not stick to every route (A-21). */}
          <ErrorBoundary key={location.pathname}>
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
              <Route path="/link-checker" element={<LinkCheckerPage />} />
              <Route path="/link-checker/history" element={<LinkCheckHistoryPage />} />
              <Route path="/link-checker/history/:scanId" element={<LinkCheckScanPage />} />
              <Route path="/accessibility" element={<AccessibilityPage />} />
              <Route path="/accessibility/reports/diff/:idA/:idB" element={<A11yReportDiffPage />} />
              <Route path="/accessibility/reports/:reportId" element={<A11yReportPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
      <footer className="border-t border-border px-6 py-2 bg-background shrink-0 text-xs text-muted-foreground flex items-center gap-2">
        <span>Data Folder:</span>
        <button
          onClick={revealDataFolder}
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

function NotFound() {
  return (
    <div className="max-w-md space-y-3">
      <h2 className="text-xl font-semibold">Page not found</h2>
      <p className="text-sm text-muted-foreground">This page does not exist, or the item it pointed to was deleted.</p>
      <Link to="/" className="text-sm text-primary hover:underline">
        Go to the start page
      </Link>
    </div>
  )
}

function ErrorBanner({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div
      role="alert"
      className="border-b border-destructive/40 bg-destructive/10 px-6 py-2 text-sm shrink-0 flex items-center justify-between gap-4"
    >
      <p className="text-destructive">{message}</p>
      <button
        onClick={onAction}
        className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors shrink-0"
      >
        {actionLabel}
      </button>
    </div>
  )
}

export default App
