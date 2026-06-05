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

## Phase 4 — Frontend: Pages ⬜
- [ ] Sidebar navigation layout
- [ ] TargetListsPage — list, create, edit, delete
- [ ] CheckTemplatesPage — list, create, edit selectors
- [ ] AuditsPage — bind lists + templates, run config
- [ ] Run button + progress display
- [ ] Results table with per-selector details
- [ ] RunHistoryPage — past runs

## Phase 5 — Polish ⬜
- [ ] URL normalisation (auto-add https://)
- [ ] CSV export
- [ ] File import for URLs
- [ ] Keyboard shortcuts
- [ ] Persist last-used config
