# Link Checker

A desktop app that checks web pages against CSS selector assertions. Create **Target Lists** (URL collections), define **Check Templates** (CSS selectors to verify), then bind them into an **Audit** to run checks across all pages — sequentially or in batches.

Built with [Tauri v2](https://tauri.app) + [React 19](https://react.dev) + [TypeScript 6](https://www.typescriptlang.org) + [Tailwind CSS v4](https://tailwindcss.com).

## Features

- **Target Lists** — named URL collections, import from `.txt`/`.csv`, scrape links from a live page
- **Check Templates** — named collections of CSS selector assertions (existence, count, text content)
- **Audits** — bind a Target List + Check Template, configure mode (sequential or batch), batch size, and timeout
- **Quick Audit** — ephemeral run against any Check Template with ad-hoc URLs (no need to save a Target List)
- **Origin Override** — rewrite domains for a run (e.g. test staging URLs against production selectors)
- **URL Postfix** — append a suffix to every URL before checking (e.g. `?preview=true`)
- **Live Results** — see progress and per-URL selector results incrementally as the audit runs
- **Run History** — browse past runs with collapsible per-run details
- **CSV Export** — download audit results as CSV
- **Keyboard Shortcuts** — `Cmd+Enter` to submit, `Cmd+R` to run, `1-4` for page navigation (skipped when typing)

## Getting started

```bash
npm install
npm run tauri dev       # dev with hot reload
npm run build:tauri     # full production build
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | TypeScript check + Vite build |
| `npm run tauri dev` | Tauri dev (hot reload) |
| `npm run tauri build` | Production Tauri bundle |
| `npm run build:tauri` | Frontend build + Tauri build |

## How it works

1. **Target List** — a named list of URLs (one per line, protocol is auto-prepended if missing)
2. **Check Template** — a named set of CSS selector checks, each with a label and selector
3. **Audit / Quick Audit** — picks a Check Template, sets URLs (from a Target List or ad-hoc), configures mode/batch size/timeout, then runs

The Rust backend fetches every URL with `reqwest`, parses the HTML with `scraper`, and checks each selector for existence, count, and text content. Results stream back to the frontend via Tauri events.

## Tech Stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri v2 |
| Frontend | React 19, TypeScript 6 |
| Bundler | Vite 8 |
| Styling | Tailwind CSS v4 |
| HTTP client | reqwest (Rust) |
| HTML parser | scraper (Rust) |
| Persistence | JSON files in app data dir |
| Dialogs | tauri-plugin-dialog |
| URL opener | tauri-plugin-opener |

## Project structure

```
src/
├── components/     # Shared UI (Modal, ProgressBar, ResultsTable, Sidebar)
├── hooks/          # useStore, useAuditRunner, useHotkeys
├── lib/            # tauri.ts (typed invoke wrappers)
├── pages/          # TargetListsPage, CheckTemplatesPage, AuditsPage, QuickAuditPage, RunHistoryPage
└── types/          # TypeScript interfaces
src-tauri/
└── src/
    ├── commands/   # Rust command handlers (CRUD + runs)
    ├── checker.rs  # HTTP fetch + DOM parse + selector checks
    ├── models.rs   # Shared structs with serde camelCase
    ├── storage.rs  # JSON file persistence
    └── lib.rs      # AppState + command registration
```
