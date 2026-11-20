# Accessibility Audit — Implementation Plan

## Context

A `CheckType::Accessibility` already exists in the Rust backend
(`run_accessibility_check` in `checker.rs`) covering 4 static rules —
missing `alt`, empty links, unlabeled buttons, unlabeled inputs — but it is
**not exposed in the UI** (`CHECK_TYPE_OPTIONS` omits it), and its results
are only visible as a cramped popover in `RunDetailPage`.

This plan finishes that feature and expands it into a real WCAG audit:

1. **Phase A — Static rule engine** (pure Rust, `scraper` only, no new deps) ✅
2. **Phase B — Check-template integration + results UI** ✅
3. **Phase C — Standalone Accessibility Audit page** ✅
4. **Phase D — Headless browser + axe-core** ✅

The engine is designed so Phase D plugs in behind the same interface.

---

## Phase A — Static WCAG Rule Engine

### Model changes (`src-tauri/src/models.rs`)

Extend `A11yIssue`:

```rust
pub struct A11yIssue {
    pub issue_type: String,      // existing rule id, e.g. "missing-alt"
    pub element: String,
    pub selector: String,
    pub message: String,
    pub severity: String,        // "critical" | "serious" | "moderate" | "minor"
    pub wcag: String,            // criterion, e.g. "1.1.1"
    pub help_url: Option<String> // WCAG understanding-doc link
}
```

`#[serde(default)]` on new fields keeps old run JSON loadable — add a
migration fallback in `storage.rs` if needed (missing fields deserialize
as `None`/`""`).

Add optional config on `SelectorCheck`:

```rust
pub a11y_config: Option<A11yCheckConfig>,

pub struct A11yCheckConfig {
    pub min_severity: String,        // default "minor" (report all)
    pub categories: Vec<String>,     // empty = all
    // categories: "document", "headings", "landmarks", "aria",
    //             "interactive", "media", "tables", "forms"
}
```

### Rule engine (`src-tauri/src/checker.rs` or new `a11y.rs`)

Refactor `run_accessibility_check` into a module with one function per
category. Each returns `Vec<A11yIssue>`; a shared helper builds a stable
CSS-path selector for the offending element (tag + `#id` + first few
classes) for display.

Rules per category (all parseable from static HTML):

| Category | Rules |
|---|---|
| document | `lang` missing/invalid, `<title>` missing/empty, `viewport` with `user-scalable=no` or `maximum-scale<2`, `<meta charset>` missing |
| headings | skipped levels (h1→h3), multiple h1, page with no h1 |
| landmarks | no `<main>`/role=main, no skip-nav link, duplicate `id` values |
| aria | `aria-labelledby`/`aria-describedby` referencing missing ids, invalid `role` tokens |
| interactive | `href="#"`-only or `javascript:` links, `tabindex>0`, `autofocus`, `<a>` without href used as button, images inside links without alt |
| media | `<video>`/`<audio>` without `<track kind="captions">`, `<iframe>` without `title` |
| tables | `<th>` without `scope`, layout tables heuristic |
| forms | extend existing label check to `select`, `textarea`; `placeholder` used as sole label |

Keep the existing 4 rules (fold them into `interactive`/`forms`) —
they map cleanly onto the new categories.

Severity mapping follows axe-core conventions:

- **critical**: missing alt on content images, missing form labels, empty links
- **serious**: missing lang, skipped heading levels, missing main landmark, iframe without title
- **moderate**: duplicate ids, invalid ARIA refs, tabindex>0, missing captions
- **minor**: missing h1, viewport zoom restriction, autofocus

Result semantics stay consistent with other check types: `found = true`
when zero issues at/above the configured severity threshold, `count` =
issue count, `a11y_issues` = the issue list (severity-filtered).

---

## Phase B — Check-Template Integration + Results UI

### Template editor (`CheckTemplateDetailPage.tsx`)

- Add `{ value: 'accessibility', label: 'Accessibility (WCAG)' }` to
  `CHECK_TYPE_OPTIONS` (also add `'javascript'` while there — it exists in
  the backend but is equally unreachable today).
- When `checkType === 'accessibility'`, render a config panel instead of
  selector/pattern inputs:
  - severity threshold dropdown (All / Moderate+ / Serious+ / Critical only)
  - category checkboxes (default all on)
  - a short description of what runs

`SelectorCheck` fields for a11y checks: `selector`/`label` still apply
(`label` = "WCAG Audit"); new optional `a11yConfig` field added to the TS
`SelectorCheck` interface in `src/types/index.ts`.

### Results UI (`RunDetailPage.tsx`)

Replace the `<details>` popover with a proper expandable issues panel:

- Click the "N issues" chip → expands an inline panel (not absolute
  popover, which breaks in the virtualized table)
- Issues grouped by category, each row: severity badge, WCAG tag, element,
  selector (mono), message
- Sort by severity (critical first)
- Also show in the table view: the a11y check cell gets an issue-count
  badge that opens the same panel

---

## Phase C — Standalone Accessibility Audit Page

New sidebar entry: **Accessibility** (`/accessibility`).

### Data model

New entity, separate from `Audit`/`AuditRun` (different shape — no check
template binding, engine choice instead):

```rust
pub struct A11yAudit {
    pub id: String,
    pub name: String,
    pub target_list_id: String,
    pub engine: String,              // "static" | "axe-core"
    pub config: A11yConfig,          // severity threshold, categories,
                                     // viewport emulation, wait time
    pub created_at: String,
}

pub struct A11yPageResult {
    pub url: String,
    pub page_title: Option<String>,
    pub status: Option<u16>,
    pub response_time_ms: Option<u64>,
    pub error: Option<String>,
    pub issues: Vec<A11yIssue>,
    pub score: Option<f64>,          // axe-style 0–100, Phase D
}

pub struct A11yReport {
    pub id: String,
    pub audit_id: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: String,
    pub results: Vec<A11yPageResult>,
    pub summary: A11ySummary,        // total/critical/serious/moderate/minor per page
}
```

Storage: new `a11y_audits/` and `a11y_reports/` JSON dirs alongside the
existing ones in `storage.rs`. Report files use the same incremental-save
pattern as `runs.rs` so a crash mid-run keeps partial results.

### Backend commands

| Command | Purpose |
|---|---|
| `list_a11y_audits` / `create_a11y_audit` / `update_a11y_audit` / `delete_a11y_audit` | CRUD |
| `run_a11y_audit` | `{ audit_id }` → reuses `Checker`'s semaphore/cancel/event machinery, but each URL produces `A11yPageResult` instead of `PageResult` |
| `cancel_a11y_run` | shares the existing cancel flag |
| `list_a11y_reports` / `get_a11y_report` / `delete_a11y_report` | history |

Implementation note: extract the rule engine into `a11y.rs` with a
function `run_a11y_scan(html: &str, config: &A11yConfig) -> Vec<A11yIssue>`
so both `checker.rs` (check-type path) and the new a11y-audit path call
the same code. The audit runner can be a sibling of `Checker` reusing the
same fetch/semaphore/cancel scaffolding — factor that out rather than
duplicating ~100 lines.

### Frontend page

`AccessibilityPage.tsx` + `A11yReportPage.tsx`:

- Audit list (create/edit/delete, pin, folder — same patterns as
  AuditsPage)
- Create form: name, target list picker, engine picker (Phase A: "Static
  HTML" only; Phase D adds "axe-core (headless)"), severity threshold,
  category toggles
- Run view: progress bar + live issue feed (reuse `run:progress` /
  `run:result` events with an `a11y:` prefix or a `kind` field to
disambiguate), then the report
- Report view: summary cards (pages scanned, issues by severity), a
  sortable/filterable issues table across all pages, per-page expandable
  detail, CSV/JSON export of the report
- Historical reports list with diff vs previous report (regressions =
  new issue types per page) — reuses the RunDiff concept

---

## Phase D — Headless Browser + axe-core ✅ Implemented

**As built** (`src-tauri/src/a11y_browser.rs`):

- `chromiumoxide 0.9.1` (pure-Rust CDP client) drives a **system**
  Chrome/Chromium — no bundled browser. `find_browser_executable()`
  checks `A11Y_CHROME_PATH` env var first, then known macOS/Linux install
  paths, then `which chromium|google-chrome|chrome`.
- axe-core **4.14.1** is vendored at `src-tauri/assets/axe.min.js`
  (`include_str!` — no network dependency) and injected per page via
  `page.evaluate`, followed by `axe.run` scoped to WCAG 2.x A/AA tags.
- Each page gets a fresh tab on one shared browser instance; violations
  map onto `A11yIssue` (`impact`→severity, `helpUrl`→help_url, WCAG tags→
  criterion, target selectors + node HTML→element/selector). Capped at
  25 nodes/violation, 1000 issues/page.
- Fresh temp `--user-data-dir` per report, removed on completion;
  per-page timeout = `max(config.timeout_secs, 15s)`; browser failures
  become per-page `error` results, never crash the run.
- `A11yAudit.engine`: `"static"` (default, `a11y_runner.rs`) or
  `"axe-core"` (`run_axe_audit`, dispatched in `commands/a11y.rs`). The
  audit form has an engine picker; `a11y:error` events surface launch
  failures (e.g. no browser found) in the UI.
- Verification: `smoke_axe_scan_real_page` (ignored test, `A11Y_TEST_URL`
  override) — confirmed 6 violations detected on a fixture page with
  correct severities/WCAG tags; 0 on clean pages.

Remaining gaps vs. original sketch: no viewport emulation, no
wait-for-selector/network-idle, sequential pages only (no parallelism),
and no report diffing.

**Follow-ups shipped after Phase D:** score (severity-weighted 0–100),
score trend chart, report-to-report diffing (`A11yReportDiffPage`), and
self-contained HTML report export.

---

## Phase E — Standards coverage & rule gaps (planned)

### Standards landscape

Nearly all accessibility standards are WCAG-derived, so "support" is
mostly tag/reporting, not new rules:

| Standard | Relationship | Approach |
|---|---|---|
| WCAG 2.0 / 2.1 / 2.2 | The base | Expose level selection; axe `runOnly` gains `wcag22a`/`wcag22aa` |
| Section 508 (US federal) | Harmonized w/ WCAG 2.0 | axe emits `section508` tags — surface on issues |
| EN 301 549 (EU procurement, behind the European Accessibility Act) | WCAG 2.1 AA-aligned | axe emits `EN-301-549` tags — surface on issues |
| ADA (US) | De-facto WCAG 2.0/2.1 AA via case law | Report labeling only |
| RGAA / BITV / Stanca / IS 5568 | National WCAG transpositions | Report labeling only |
| WCAG 3.0 (bronze/silver/gold) | Draft, not finalized | Revisit when published |

Non-WCAG frameworks that add real checks: axe `best-practice` rules
(~30 non-WCAG rules: marquee, meta-refresh, duplicate landmarks),
usability heuristics, SEO-adjacent checks.

### Rule gaps (static engine)

Quick wins shipped: `wcag22*`/`best-practice` axe tags, standards
tags on issues, `nested-interactive`, `aria-hidden-focusable`,
dangling `aria-controls`/`aria-owns`, `missing-autocomplete`,
`marquee`/`blink`, `meta-refresh`, `target-blank-noopener`,
`onclick-noninteractive`, `radio-no-legend`.

Still missing (next batch):

- Landmarks: `banner`/`contentinfo`/`nav`/`search`/`form` coverage,
  implicit-vs-explicit role conflicts
- ARIA: `aria-expanded`/`aria-controls` pairing, live-region misuse,
  `role` on native elements that already carry the semantics
- Interactive: `tabindex="-1"` on naturally focusable elements,
  drag-only interactions (needs browser), focus-visible (needs CSS
  analysis — browser engine)
- WCAG 2.2: target size 2.5.8, focus appearance 2.4.11/13, dragging
  2.5.7, consistent help 3.2.6, redundant entry 3.3.7, accessible
  authentication 3.3.8 — mostly browser-engine territory
- Content: `<abbr>` without expansion, images-of-text heuristic,
  reading-level proxies
- Standards picker on `A11yAudit`: filter by WCAG 2.1 AA / 2.2 AA /
  Section 508 / EN 301 549 (mostly a config + reporting layer since
  underlying checks overlap)

---

## File touch-list (Phases A–C)

**Rust**
- `src-tauri/src/models.rs` — extend `A11yIssue`, add `A11yCheckConfig`,
  `A11yAudit`, `A11yPageResult`, `A11yReport`, `A11ySummary`
- `src-tauri/src/a11y.rs` — **new**: rule engine (`run_a11y_scan`)
- `src-tauri/src/checker.rs` — delegate `CheckType::Accessibility` to
  `a11y.rs`; factor shared fetch/semaphore scaffolding if needed
- `src-tauri/src/commands/a11y.rs` — **new**: audit CRUD + run commands
- `src-tauri/src/commands/mod.rs`, `lib.rs` — register
- `src-tauri/src/storage.rs` — a11y dirs, report save/load, retention

**Frontend**
- `src/types/index.ts` — new interfaces + `a11yConfig` on `SelectorCheck`
- `src/pages/CheckTemplateDetailPage.tsx` — a11y option + config panel
- `src/pages/RunDetailPage.tsx` — issues panel
- `src/pages/AccessibilityPage.tsx` + `A11yReportPage.tsx` — **new**
- `src/App.tsx`, `src/components/Sidebar.tsx` — route + nav
- `src/lib/tauri.ts` — invoke wrappers + event types

**Tests**
- `checker.rs` unit tests already exist — add `a11y.rs` tests: one
  fixture HTML per rule category asserting expected issue types/severities
- Frontend: extend `src/__tests__` for severity filtering helper if
  extracted to `src/utils/`

## Verification

- `cargo test` (Rust unit tests for each rule)
- `npm run build` / `tsc --noEmit` for typecheck
- Manual: `npm run tauri dev`, create an a11y template check, run against
  a fixture page with known violations, verify issue panel and report
  aggregation
