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

## Phase 5 — Polish ⬜
- [x] RunHistoryPage — past runs
- [x] URL normalisation (auto-add https://)
- [x] Clean up unused Vite scaffold assets
- [x] Update README.md
- [x] CSV export
- [x] File import for URLs (txt/csv)
- [x] Keyboard shortcuts (Escape, Cmd+Enter, Cmd+R, 1-4 nav)
