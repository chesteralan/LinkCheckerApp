# Feature Brainstorm

Ideas for future improvements, organized by theme.

---

## Reporting & Export

- **CSV/JSON export per run** — Download results as CSV or JSON from the run detail view
- **HTML report** — Self-contained HTML report with pass/fail summaries and per-page breakdowns
- **Scheduled email reports** — Email run results to a configured address on completion
- **Dashboard view** — High-level overview of the latest run for each audit, with trend sparklines

---

## Run Comparison & Diff

- **Side-by-side run diff** — Compare two runs and highlight regressions (new fails, slower pages, missing selectors)
- **Trend tracking** — Track pass/fail/response-time over time per audit, display as charts
- **Regression alerts** — Mark a run as a "baseline" and warn when subsequent runs deviate beyond a threshold

---

## Check Capabilities

- **Regex / text content checks** — Assert that a page contains or excludes a regex pattern (not just CSS selectors)
- **Attribute checks** — Verify an element has a specific attribute or attribute value (e.g., `href`, `alt`)
- **Broken link crawling** — Follow all `<a href>` on a page and report 4xx/5xx (recursive depth limit)
- **Page status checks** — Assert expected HTTP status code or range (e.g., must be 2xx)
- **Custom HTTP headers** — Per-audit request headers (e.g., `Authorization`, `Accept-Language`)
- **Cookie / session support** — Set cookies or run a login flow before executing checks
- **JavaScript evaluation** — Run a JS snippet in a headless context and assert the result
- **Accessibility checks** — Scan for missing alt text, low contrast, missing ARIA labels (via axe-core or similar)

---

## Structure & Organization

- **Folders / tags** — Group audits, templates, and target lists into folders or tag them for filtering
- **Search** — Global search across audits, templates, target lists, and run history
- **Favorites / pins** — Pin frequently used templates and audits to the top
- **Bulk operations** — Multi-select and delete/duplicate/export templates, lists, or audits
- **Templates from run** — Create a check template from selectors discovered during a scrape

---

## Automation & Scheduling

- **Recurring audits** — Schedule an audit on a cron-like interval (daily, hourly, custom)
- **Webhook notifications** — POST results to a webhook URL on completion (e.g., Slack, Discord)
- **Desktop notifications** — Native macOS notifications when a run finishes (system tray)
- **GitHub Actions / CLI mode** — Run audits headlessly from CI via CLI flags
- **Auto-retry on failure** — Retry failed URLs up to N times with configurable backoff

---

## UX & Quality of Life

- **Theme toggle** — Light/dark/system toggle (currently dark-only)
- **Keyboard shortcut reference** — Press `?` to show a modal listing all shortcuts
- **Undo / confirm on delete** — Soft-delete or undo toast for accidental deletions
- **Inline URL validator** — Validate URL syntax as the user types in target list editor
- **Drag-and-drop reorder** — Reorder checks within a template via drag-and-drop
- **Resizable columns** — Resizable columns in the run detail table view
- **Virtual scrolling** — Virtualize large result sets (1000s of URLs) for performance

---

## Performance & Scale

- **Pagination / lazy-load** — Load run history in pages instead of all at once
- **Result pruning** — Configurable retention policy (auto-delete runs older than N days)
- **Large-file streaming** — Stream run results to disk instead of holding all in memory
- **Concurrent URL scrape** — Scrape selectors from multiple pages at once (currently one-at-a-time)
- **Incremental data save** — Save results incrementally during a run (recovery on crash)

---

## Infrastructure

- **Proxy support** — Route all HTTP checks through a configurable proxy (HTTP, SOCKS)
- **Multi-profile** — Switch between independent sets of audits/templates (work vs personal)
- **Self-update** — In-app check for new versions via Tauri updater
- **Encrypted storage** — Encrypt saved run data at rest
- **Data migration framework** — Versioned migrations for the on-disk JSON schema

---

## Future Architectural Ideas

- **Headless CLI binary** — Strip the GUI and ship a CLI-only binary for CI
- **Plugin system** — Load custom check types from WASM plugins
- **Remote agent** — Run checks from a separate machine and report back
- **Collaboration** — Share audits / results via a server (multi-user)
- **Tauri mobile** — Companion mobile app for viewing run results on the go
