# Link Checker App — Architecture & Plan

## Overview

A desktop tool that checks web pages against user-defined assertions. Users create **Target Lists** (collections of URLs) and **Check Templates** (collections of CSS selector assertions), then bind them together into an **Audit** — a run that fetches each page, parses the DOM, and reports which selectors matched and what content they found.

### Key Concepts

| Term | What it is | Examples |
|---|---|---|
| **Target List** | A named collection of URLs | "Production Sites", "Staging Sites", "Client A" |
| **Check Template** | A named collection of CSS selectors with expected conditions | "Has Login Form", "Footer Links", "Header SEO Tags" |
| **Audit** | A binding of one Target List + one Check Template, plus run config | Run "Production Sites" against "Has Login Form" with batch=5 |
| **Audit Run** | A single execution of an Audit (saved results) | Results from March 15 run |

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri** | Tiny binary, Rust backend for fast I/O |
| Frontend | **React + TypeScript** | Component model, type safety |
| Bundler | **Vite** | Fast dev server, Tauri plugin support |
| Styling | **Tailwind CSS** | Utility-first, rapid UI |
| HTTP client (Rust) | **reqwest** | Async, TLS, redirect handling |
| HTML parser (Rust) | **scraper** | CSS selector query support, built on html5ever |
| Async runtime | **tokio** (Tauri default) | Concurrency for batch checks |
| Serialization | **serde + serde_json** | Persisting data as JSON files |

---

## Data Model

```typescript
// ─── Core Entities ───

interface TargetList {
  id: string;
  name: string;
  urls: string[];
  createdAt: string;
  updatedAt: string;
}

interface CheckTemplate {
  id: string;
  name: string;
  checks: SelectorCheck[];
  createdAt: string;
  updatedAt: string;
}

interface SelectorCheck {
  id: string;
  selector: string;        // CSS selector
  label: string;           // human-readable label, e.g. "Login form exists"
  // All of the above: existence + count + text content will be reported
}

interface Audit {
  id: string;
  name: string;
  targetListId: string;
  checkTemplateId: string;
  config: AuditConfig;
  createdAt: string;
}

interface AuditConfig {
  mode: "sequential" | "batch";
  batchSize: number;        // default 5
  timeoutSecs: number;      // default 10
}

// ─── Results ───

interface AuditRun {
  id: string;
  auditId: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "cancelled" | "error";
  results: PageResult[];
  summary: RunSummary;
}

interface PageResult {
  url: string;
  pageTitle: string | null;
  status: number | null;
  statusText: string;
  responseTimeMs: number | null;
  error: string | null;
  checks: SelectorResult[];
}

interface SelectorResult {
  selectorCheckId: string;
  selector: string;
  label: string;
  found: boolean;
  count: number;
  textContent: string | null;  // first match's textContent
}

interface RunSummary {
  total: number;
  passed: number;        // all selectors matched
  failed: number;        // at least one selector missing
  errored: number;       // page unreachable
  avgResponseTimeMs: number;
}
```

```rust
// Rust structs mirror these exactly with #[derive(Serialize, Deserialize)]
// Storage: AppState holds Vec<TargetList>, Vec<CheckTemplate>, Vec<Audit>
// Persisted as JSON files in a data directory.
```

---

## Architecture Flow

```
┌──────────────────────────────────────────────────────────┐
│  React Frontend                                           │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ Library View  │  │ Template View│  │ Audit View      │ │
│  │ (manage       │  │ (create/     │  │ (bind + run +   │ │
│  │  TargetLists) │  │  edit Checks)│  │  view results)  │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬─────────┘ │
│         │                 │                   │           │
│  ┌──────▼─────────────────▼───────────────────▼─────────┐ │
│  │                   React Hook Layer                    │ │
│  │  useStore()     — CRUD via Tauri invoke               │ │
│  │  useAuditRunner() — run + stream results + cancel     │ │
│  └──────────────────────┬───────────────────────────────┘ │
└─────────────────────────┼─────────────────────────────────┘
                          │ Tauri IPC
┌─────────────────────────┼─────────────────────────────────┐
│  Tauri Rust Backend     │                                 │
│  ┌──────────────────────▼───────────────────────────────┐ │
│  │  Commands                                            │ │
│  │  • create_target_list / update_target_list / delete  │ │
│  │  • create_check_template / update / delete           │ │
│  │  • create_audit / update / delete                    │ │
│  │  • run_audit — streams results via events            │ │
│  │  • cancel_run                                        │ │
│  │  • get_audit_runs / get_run_results                  │ │
│  │  • persist — save all data to JSON files             │ │
│  └──────────────────────┬───────────────────────────────┘ │
│  ┌──────────────────────▼───────────────────────────────┐ │
│  │  Core Logic                                          │ │
│  │  ┌─────────────────┐  ┌──────────────────────────┐  │ │
│  │  │ checker.rs      │  │ storage.rs               │  │ │
│  │  │ - fetch page    │  │ - read/write JSON files  │  │ │
│  │  │ - parse HTML    │  │ - data dir management   │  │ │
│  │  │ - run selectors │  │                          │  │ │
│  │  │ - semaphore     │  └──────────────────────────┘  │ │
│  │  │ - cancel flag   │                                │ │
│  │  └─────────────────┘                                │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### HTTP Method

Since we need to check DOM content, we must use **GET** (not HEAD) to download the full HTML. `reqwest` with `response.text()` gives us the body, which `scraper` parses.

### Concurrency

- **Sequential**: URLs checked one at a time. Good for rate-limited targets.
- **Batch**: Uses `tokio::sync::Semaphore` to limit in-flight requests (default 5).
- **Cancellation**: `AtomicBool` flag checked between tasks.

---

## Storage — JSON Files on Disk

All data lives under a configurable directory (default: Tauri's app data dir).

```
~/.link-checker/
├── target-lists/
│   ├── prod-sites.json
│   └── staging-sites.json
├── check-templates/
│   ├── login-form.json
│   └── footer-links.json
├── audits/
│   ├── weekly-check.json
│   └── seo-audit.json
└── runs/
    ├── run-20260315-0930.json
    └── run-20260315-0945.json
```

Each file is a single JSON object — simple, portable, human-editable.

---

## Frontend Component Tree & Route Design

```
App
├── Sidebar (navigation)
│   ├── Target Lists
│   ├── Check Templates
│   ├── Audits
│   └── Run History
│
├── TargetListsPage
│   ├── TargetListList
│   ├── TargetListDetail
│   │   ├── UrlEditor (textarea + import)
│   │   └── UrlStatusBadge (last known status, optional)
│   └── TargetListForm (create/edit name)
│
├── CheckTemplatesPage
│   ├── CheckTemplateList
│   ├── CheckTemplateDetail
│   │   └── SelectorCheckEditor
│   │       ├── SelectorInput + LiveLabelInput
│   │       └── AddSelectorButton
│   └── CheckTemplateForm
│
├── AuditsPage
│   ├── AuditList
│   ├── AuditDetail
│   │   ├── AuditConfigPanel (mode, batch, timeout)
│   │   ├── RunButton / CancelButton
│   │   ├── ProgressBar
│   │   └── ResultsTable
│   │       ├── Row: URL → PageResult (expandable)
│   │       │   ├── Status + response time
│   │       │   ├── Page title
│   │       │   └── Per-selector: found? count? text?
│   │       └── Row: summary stats
│   ├── AuditForm (bind TargetList + CheckTemplate)
│   └── ExportButton (CSV)
│
└── RunHistoryPage
    └── PastRunList (date, audit name, summary)
```

---

## Tauri Commands & Events

### CRUD Commands

| Command | Purpose |
|---|---|
| `list_target_lists` | Returns all Target Lists |
| `create_target_list` | Creates + returns new list |
| `update_target_list` | Updates name or URLs |
| `delete_target_list` | Deletes and removes from any audits |
| `list_check_templates` | Returns all Check Templates |
| `create_check_template` | Creates + returns new template |
| `update_check_template` | Updates name or selectors |
| `delete_check_template` | Deletes and removes from any audits |
| `list_audits` | Returns all Audit definitions |
| `create_audit` | Creates an Audit binding |
| `update_audit` | Updates binding or config |
| `delete_audit` | Deletes Audit + its run history |
| `list_audit_runs` | Returns past runs for an Audit |
| `get_run_results` | Returns full results for a run |

### Run Commands

| Command | Payload | Notes |
|---|---|---|
| `run_audit` | `{ audit_id: string }` | Starts run, emits events per page |
| `cancel_run` | — | Sets cancel flag |

### Events

| Event | Payload | Frequency |
|---|---|---|
| `run:progress` | `{ checked: number, total: number }` | After each URL |
| `run:result` | `PageResult` | After each URL |
| `run:complete` | `{ summary: RunSummary }` | Once, when done |
| `run:cancelled` | — | On cancel |
| `run:error` | `{ message: string }` | On fatal error |

---

## Development Plan

### Phase 1 — Scaffold
1. `npm create tauri-app` with React + TS + Vite
2. Install + configure Tailwind CSS
3. Verify `npm run tauri dev` opens the window

### Phase 2 — Rust Backend: CRUD + Storage
1. Define data models (`models.rs`)
2. `storage.rs` — read/write JSON files in app data dir
3. CRUD commands for Target Lists, Check Templates, Audits
4. Wire into Tauri builder

### Phase 3 — Rust Backend: Audit Runner
1. `checker.rs` — fetch URL with `reqwest`, parse HTML with `scraper`, run selectors
2. Sequential mode
3. Batch mode with semaphore
4. Cancellation with `AtomicBool`
5. Event emission per page result

### Phase 4 — Frontend: Pages
1. Routing setup (react-router or simple state-based)
2. TargetListsPage (list, create, edit, delete)
3. CheckTemplatesPage (list, create, edit selectors)
4. AuditsPage (bind lists + templates, start run, show results)

### Phase 5 — Polish
1. URL normalisation (auto-add `https://`)
2. CSV export
3. Drag-and-drop file import for URLs
4. Run history view
5. Keyboard shortcuts

---

## File Structure

```
link-checker-app/
├── docs/
│   └── plan.md
├── src/                           # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── ProgressBar.tsx
│   │   ├── ResultsTable.tsx
│   │   ├── SelectorCheckEditor.tsx
│   │   └── UrlEditor.tsx
│   ├── pages/
│   │   ├── TargetListsPage.tsx
│   │   ├── CheckTemplatesPage.tsx
│   │   ├── AuditsPage.tsx
│   │   └── RunHistoryPage.tsx
│   ├── hooks/
│   │   ├── useStore.ts
│   │   └── useAuditRunner.ts
│   ├── types/
│   │   └── index.ts
│   └── lib/
│       └── tauri.ts               # invoke wrappers
├── src-tauri/                     # Rust backend
│   ├── src/
│   │   ├── lib.rs                 # Tauri builder
│   │   ├── main.rs                # Entry point
│   │   ├── commands/              # Tauri commands
│   │   │   ├── mod.rs
│   │   │   ├── target_lists.rs
│   │   │   ├── check_templates.rs
│   │   │   ├── audits.rs
│   │   │   └── runs.rs
│   │   ├── models.rs              # Shared data types
│   │   ├── checker.rs             # Page fetching + selector logic
│   │   └── storage.rs             # JSON file persistence
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```
