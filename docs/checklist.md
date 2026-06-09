# Project Checklist

## Phase 1 — Scaffold ✅
- [x] Rust installed (rustup)
- [x] Vite + React + TypeScript scaffolded
- [x] Tauri initialized and configured
- [x] Tailwind CSS v4 installed and configured
- [x] Vite dev server verified
- [x] Rust backend compiles clean
- [x] TypeScript compiles clean

## Phase 2 — Rust Backend: CRUD + Storage ✅
- [x] Data models defined (models.rs)
- [x] JSON file persistence (storage.rs)
- [x] Target Lists CRUD commands
- [x] Check Templates CRUD commands
- [x] Audits CRUD commands
- [x] All commands registered in lib.rs

## Phase 3 — Rust Backend: Audit Runner ✅
- [x] reqwest HTTP client configured
- [x] scraper-based HTML parsing + CSS selector queries
- [x] Sequential mode
- [x] Batch mode with tokio semaphore
- [x] Cancellation via AtomicBool
- [x] Tauri event emission (run:result, run:progress, run:complete)

## Phase 4 — Frontend: Pages ✅
- [x] Sidebar navigation layout
- [x] TargetListsPage — list, create, edit, delete
- [x] CheckTemplatesPage — list, create, edit selectors
- [x] AuditsPage — bind lists + templates, run config
- [x] Run button + progress display
- [x] Results table with per-selector details
- [x] ProgressBar component

## Phase 5 — Polish ✅
- [x] RunHistoryPage — past runs
- [x] URL normalisation (auto-add https://)
- [x] Clean up unused Vite scaffold assets
- [x] Update README.md
- [x] CSV export
- [x] File import for URLs (txt/csv)
- [x] Keyboard shortcuts (Escape, Cmd+Enter, Cmd+R, 1-4 nav)

## Phase 6 — UX & Quality of Life ✅
- [x] **Theme toggle** — Light/dark/system toggle (currently dark-only)
- [x] **Keyboard shortcut reference** — Press `?` to show a modal listing all shortcuts
- [x] **Confirm on delete** — Confirm dialog before deleting templates and target lists
- [x] **Inline URL validator** — Validate URL syntax as the user types in target list editor
- [x] **Drag-and-drop reorder** — Reorder checks within a template via drag-and-drop
- [x] **Resizable columns** — Resizable columns in the run detail table view
- [x] **Virtual scrolling** — Virtualize large result sets (1000s of URLs) for performance

## Phase 7 — Performance & Scale ✅
- [x] **Pagination / lazy-load** — Load run history in pages instead of all at once
- [x] **Result pruning** — Configurable retention policy (auto-delete runs older than N days)
- [x] **Large-file streaming** — List commands strip results; `load_recent_runs` limits to 100/500 runs in memory
- [x] **Concurrent URL scrape** — Scrape selectors from multiple pages at once
- [x] **Incremental data save** — Save results incrementally during a run (recovery on crash)

## Phase 8 — Run Comparison & Diff ✅
- [x] **Side-by-side run diff** — Compare two runs and highlight regressions (new fails, slower pages, missing selectors)
- [x] **Trend tracking** — Track pass/fail/response-time over time per audit, display as charts (recharts)
- [x] **Regression alerts** — Mark a run as a "baseline" and warn when subsequent runs deviate beyond a threshold

## Phase 9 — Check Capabilities ✅
- [x] **Regex / text content checks** — Assert that a page contains or excludes a regex pattern (not just CSS selectors)
- [x] **Attribute checks** — Verify an element has a specific attribute or attribute value (e.g., `href`, `alt`)
- [x] **Broken link crawling** — Follow all `<a href>` on a page and report 4xx/5xx (recursive depth limit)
- [x] **Page status checks** — Assert expected HTTP status code or range (e.g., must be 2xx)
- [x] **Custom HTTP headers** — Per-audit request headers (e.g., `Authorization`, `Accept-Language`)
- [x] **Cookie / session support** — Set cookies via key-value editor, applied as `Cookie` header in checker
- [x] **JavaScript evaluation** — Run a JS snippet in `boa_engine` (pure Rust JS interpreter); receives `pageText`, `pageUrl`, `pageTitle`
- [x] **Accessibility checks** — Scan for missing alt text, empty links, unlabeled buttons, unlabeled inputs

## Phase 10 — Structure & Organization ✅
- [x] **Folders / tags** — Group audits, templates, and target lists into folders or tag them for filtering
- [x] **Search** — Global search across audits, templates, target lists, and run history
- [x] **Favorites / pins** — Pin frequently used templates and audits to the top
- [x] **Bulk operations** — Multi-select and delete/duplicate/export templates, lists, or audits
- [x] **Templates from run** — Create a check template from selectors discovered during a scrape
