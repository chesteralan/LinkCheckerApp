# Accessibility Auditing

This document describes the accessibility (a11y) auditing feature **as implemented**. The original design is in [`a11y-plan.md`](./a11y-plan.md). Where the code and the plan disagree, the code is described here and the differences are listed in [Differences from the plan](#differences-from-the-plan).

## Overview

Accessibility checks run in three places. All three use the same static rule engine (`run_a11y_scan` in `src-tauri/src/a11y.rs`):

| Entry point | Where | Engine | Config |
|---|---|---|---|
| **Accessibility audits** (sidebar → Accessibility, `/accessibility`) | `src-tauri/src/commands/a11y.rs`, `a11y_runner.rs`, `a11y_browser.rs` | `static` or `axe-core` | Per audit: `A11yAudit.a11y_config` + `AuditConfig` |
| **Check-template check type** `accessibility` | `run_accessibility_check` in `src-tauri/src/checker.rs` | static only | `SelectorCheck.a11y_config` (defaults when absent) |
| **Link scan** "include accessibility" option | `scan_a11y` in `src-tauri/src/commands/runs.rs` | static only | Always `A11yCheckConfig::default()` |

The rest of this document covers the standalone audits unless it says otherwise.

### Data model (`src-tauri/src/models.rs`, mirrored in `src/types/index.ts`)

- **`A11yCheckConfig`**: `min_severity` (default `"minor"`), `categories: Vec<String>` (empty means all), `standards: Vec<String>` (empty means all).
- **`A11yAudit`**: `id`, `name`, `target_list_id`, `engine` (`"static"` | `"axe-core"`, default `"static"`), `a11y_config`, `config: AuditConfig` (mode, batch size, timeout, headers, cookies), `origin_override`, `url_postfix`, `created_at`, `pinned`, `folder`.
- **`A11yIssue`**: `issue_type` (rule id), `element` (tag name), `selector`, `message`, `severity` (`critical` | `serious` | `moderate` | `minor`), `wcag` (criterion such as `"1.1.1"`, or `""`), `standards: Vec<String>`, `help_url`.
- **`A11yPageResult`**: `url`, `page_title`, `status`, `status_text`, `response_time_ms`, `error`, `issues`.
- **`A11yReport`**: `id`, `audit_id`, `started_at`, `completed_at`, `status` (`running` | `completed` | `cancelled` | `error`), `results`, `summary: A11ySummary`, `standards` (a copy of the audit's selected standards at run time).
- **`A11ySummary`**: `total_pages`, `pages_with_issues`, `errored`, `critical`, `serious`, `moderate`, `minor`. Errored pages count toward `errored` only. Their issues are not counted, and they cannot have any.

### Tauri commands (`src-tauri/src/commands/a11y.rs`, wrappers in `src/lib/tauri.ts`)

| Command | Purpose |
|---|---|
| `list_a11y_audits` / `create_a11y_audit` / `update_a11y_audit` / `delete_a11y_audit` | Audit CRUD. Deleting an audit also deletes all of its reports. |
| `run_a11y_audit { auditId }` | Runs the audit through `AppState.a11y_runner` and saves the final report |
| `cancel_a11y_run` | Sets the shared cancel flag |
| `list_a11y_reports` / `get_a11y_report` / `delete_a11y_report` | Report history |
| `rerun_a11y_pages { reportId, urls? }` | Re-scans errored pages (or the given URLs) and merges the results into the report. See [Re-running errored pages](#re-running-errored-pages). |

Events emitted during a run: `a11y:progress` `{checked, total}`, `a11y:result` (one `A11yPageResult`), `a11y:complete` (the final report), `a11y:cancelled`, `a11y:error` `{message}`. The page that listens for them is `src/pages/AccessibilityPage.tsx`.

### Storage (`src-tauri/src/storage.rs`)

- Audits are stored with the rest of the app data, in `AppData.a11y_audits`.
- Each report is one JSON file: `<data dir>/a11y-history/a11y-<started_at formatted>-<report id>.json`. Lookup by id matches the filename suffix `-<id>.json`.
- `list_a11y_reports` sorts by file **creation time**, newest first. For each file it reads the JSON twice, once for `audit_id` and once for `started_at`.
- Both engines save a partial report with `status: "running"` after **every** page, so a crash keeps the results gathered so far. If the app dies mid-run, the report stays in `running` permanently.

---

## Engine 1: Static Rust rule engine (`src-tauri/src/a11y.rs`)

The engine parses the raw HTTP response body with the `scraper` crate. It does not run JavaScript, apply CSS or compute layout, so it cannot check things like color contrast, focus visibility or content rendered by client-side code.

### Pipeline (`run_a11y_scan`)

1. Parse the HTML and run each enabled category checker: `check_document`, `check_headings`, `check_landmarks`, `check_aria`, `check_interactive`, `check_media`, `check_tables`, `check_forms`. If `categories` is empty, all eight run.
2. **Severity filter**: keep issues where `rank(severity) >= rank(min_severity)`, with critical=4, serious=3, moderate=2, minor=1.
3. **Standards filter** (only when `standards` is non-empty): each criterion is mapped to a WCAG version by `wcag_criterion_version`, using hard-coded lists of 2.1 and 2.2 criteria. Anything not on those lists counts as 2.0. An issue is kept if its version is allowed by any selected standard (`standard_wcag_versions`):

   | Standard | WCAG versions allowed |
   |---|---|
   | `wcag20` | 2.0 |
   | `wcag21` | 2.0, 2.1 |
   | `wcag22` | 2.0, 2.1, 2.2 |
   | `section508` | 2.0 |
   | `en301549` | 2.0, 2.1 |
   | `bestpractice` | none, but issues with an empty `wcag` are allowed |

   Every static rule has a WCAG criterion, so selecting **only** `bestpractice` returns **zero** static issues. The audit form says this: "Best practices only apply to the axe-core engine."

Every static issue has `standards: ["wcag"]` and `help_url = https://www.w3.org/WAI/WCAG21/Understanding/<criterion>`. The `selector` is a short display path rather than a unique selector: `tag#id`, or else `tag.class1.class2` (first two classes), or else `tag` (`css_path`). Rules that apply to the whole document use the literal `body`, `head`, `document` or `#<id>` as the selector.

### Rule reference

The tables have 49 rows covering 48 distinct rule ids. `missing-label` appears twice, with different triggers and severities: once for buttons and once for form fields. The 18 unit tests are at the bottom of `a11y.rs`.

#### document

| Rule id | Impact | WCAG | Trigger |
|---|---|---|---|
| `missing-lang` | serious | 3.1.1 | `<html>` has no `lang`, or `lang` is shorter than 2 characters |
| `invalid-lang` | minor | 3.1.1 | `lang` is not a BCP-47-like tag: alphanumeric parts separated by `-` |
| `missing-title` | serious | 2.4.2 | No `<title>`, or an empty one |
| `viewport-zoom` | moderate | 1.4.4 | `meta[name=viewport]` contains `user-scalable=no` or `maximum-scale` < 2 |
| `missing-charset` | minor | 4.1.1 | No `<meta charset>` |
| `meta-refresh` | moderate | 2.2.1 | Any `<meta http-equiv="refresh">` |
| `abbr-no-title` | minor | 3.1.4 | `<abbr>` without a non-empty `title` |

#### headings

| Rule id | Impact | WCAG | Trigger |
|---|---|---|---|
| `no-headings` | minor | 1.3.1 | No `h1`–`h6` at all |
| `missing-h1` | minor | 1.3.1 | Headings exist but there is no `h1` |
| `multiple-h1` | minor | 1.3.1 | More than one `h1` |
| `empty-heading` | minor | 1.3.1 | Heading with no text |
| `heading-skip` | moderate | 1.3.1 | Level jumps by more than one (for example h2 to h4). Reported only for the first skip on a page. |

#### landmarks

| Rule id | Impact | WCAG | Trigger |
|---|---|---|---|
| `missing-main` | moderate | 1.3.1 | No `<main>` or `[role=main]` |
| `missing-skip-link` | moderate | 2.4.1 | No `a[href^="#"]` (longer than `#`) whose text contains "skip" |
| `missing-navigation` | minor | 1.3.1 | No `<nav>` or `[role=navigation]` |
| `missing-contentinfo` | minor | 1.3.1 | No footer or contentinfo landmark |
| `unnamed-duplicate-landmark` | moderate | 1.3.1 | More than one nav landmark, and this one has no `aria-label`, `aria-labelledby` or `title` |
| `duplicate-id` | moderate | 4.1.1 | An `id` value is used more than once (one issue per id) |

#### aria

| Rule id | Impact | WCAG | Trigger |
|---|---|---|---|
| `broken-aria-ref` | serious | 4.1.2 | `aria-labelledby`, `-describedby`, `-controls`, `-owns`, `-details` or `-errormessage` points to an id that does not exist |
| `invalid-role` | moderate | 4.1.2 | A `role` token is not in `VALID_ROLES` |
| `aria-hidden-focusable` | serious | 4.1.2 | `[aria-hidden=true]` is focusable or contains focusable content |
| `presentation-focusable` | serious | 4.1.2 | `role=presentation` or `role=none` is focusable or contains focusable content |
| `aria-expanded-no-controls` | minor | 4.1.2 | `aria-expanded` without `aria-controls` (heuristic) |
| `aria-live-invalid` | moderate | 4.1.2 | `aria-live` is not `off`, `polite` or `assertive` |
| `aria-label-generic` | minor | 4.1.2 | `aria-label` on a role-less `div`, `span`, `p`, `ul`, `ol`, `li`, `td`, `tr`, `table`, `br` or `section` |

#### interactive

| Rule id | Impact | WCAG | Trigger |
|---|---|---|---|
| `missing-alt` | critical | 1.1.1 | `<img>` without `alt`; also `input[type=image]` or `area[href]` without `alt` |
| `empty-alt` | minor | 1.1.1 | `<img alt="">`, which is reported as informational because it is fine for decorative images |
| `empty-link` | serious | 2.4.4 | `<a>` with no `href` or an empty one. Link **text** is not checked. |
| `placeholder-link` | moderate | 2.4.4 | `href="#"` or `javascript:…` |
| `missing-label` | serious | 4.1.2 | `<button>` with no accessible name (see `accessible_name`) |
| `positive-tabindex` | moderate | 2.4.3 | `tabindex` > 0 |
| `autofocus` | minor | 3.2.1 | Any `[autofocus]` |
| `nested-interactive` | serious | 4.1.2 | `a` or `button` that contains `a[href]` or `button` |
| `target-blank-noopener` | minor | 3.2.5 | `target=_blank` without `rel~=noopener` |
| `onclick-noninteractive` | moderate | 2.1.1 | `[onclick]` on a non-interactive element that has no `role` and no `tabindex` |
| `tabindex-neg-focusable` | moderate | 2.1.1 | A naturally focusable element with `tabindex="-1"` |
| `widget-no-tabindex` | moderate | 2.1.1 | A widget role (`button`, `link`, `tab`, `checkbox`, and others) on a non-native element without `tabindex` |
| `redundant-role` | minor | 4.1.2 | A role that duplicates the element's implicit role (for example `nav[role=navigation]` or `button[role=button]`) |

#### media

| Rule id | Impact | WCAG | Trigger |
|---|---|---|---|
| `missing-captions` | serious | 1.2.2 | `<video>` or `<audio>` without a `<track kind=captions\|subtitles>` |
| `media-autoplay-no-controls` | moderate | 2.2.2 | `autoplay` media without `controls` |
| `marquee-blink` | moderate | 2.2.2 | `<marquee>` or `<blink>` |
| `iframe-no-title` | serious | 4.1.2 | `<iframe>` without a non-empty `title` or `aria-label` |

#### tables

| Rule id | Impact | WCAG | Trigger |
|---|---|---|---|
| `table-no-headers` | moderate | 1.3.1 | `<table>` that has data cells but no `<th>` |
| `th-no-scope` | minor | 1.3.1 | `<th>` without `scope`, `headers` or `id` |

#### forms

| Rule id | Impact | WCAG | Trigger |
|---|---|---|---|
| `missing-label` | critical | 3.3.2 | A labelable `input` (not hidden, submit, button, image or reset), `select` or `textarea` that has no accessible name, no `label[for]` and no wrapping `<label>` |
| `placeholder-label` | serious | 3.3.2 | The same check, but the field has a `placeholder`, so the placeholder is its only label |
| `missing-autocomplete` | minor | 1.3.5 | `input[type=email\|tel\|url]` without `autocomplete` |
| `fieldset-no-legend` | moderate | 1.3.1 | `<fieldset>` without `<legend>` |
| `radio-no-legend` | minor | 1.3.1 | A radio group (two or more radios sharing a `name`) with no `<fieldset>` ancestor |

`accessible_name` uses `aria-label`, then `title`, then any non-empty `aria-labelledby` value, then text content. It does **not** check that the ids in `aria-labelledby` exist. That check belongs to `broken-aria-ref`.

### Static audit runner (`src-tauri/src/a11y_runner.rs`)

`A11yRunner::run` handles both engines. When `audit.engine == "axe-core"` it hands the run to the browser engine. Otherwise it does the following:

- Transforms URLs with `apply_a11y_origin_override`, which swaps scheme and host and keeps the path and query, and then `apply_a11y_url_postfix`, which appends a string.
- Concurrency comes from a `tokio::sync::Semaphore`: one permit in `sequential` mode, otherwise `config.batch_size` permits.
- `build_a11y_client` builds a `reqwest` client with the `timeout_secs` timeout, at most 10 redirects, and the custom headers and cookies from the audit's `AuditConfig`. Cookies are sent as a single `Cookie` header.
- `scan_url` runs a GET and then `run_a11y_scan` on the body. The page title comes from `<title>`. A transport error or a failure to read the body becomes a page result with `error` set.
- **Cancel**: the flag is checked before each request. Pages that have not started yet are still recorded, as results with `error: "cancelled before request"`. They count as errored and can be re-run.

---

## Engine 2: Headless browser + axe-core (`src-tauri/src/a11y_browser.rs`)

### Finding the browser (`find_browser_executable`)

No browser is bundled. The engine looks for a system browser in this order:

1. The `A11Y_CHROME_PATH` environment variable, if the path exists.
2. Fixed paths: macOS Chrome, Chromium, Edge, Brave (`/Applications/...`), `/opt/homebrew/bin/chromium`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`.
3. `which chromium | google-chrome | google-chrome-stable | chrome`.

No Windows paths are checked, so on Windows the only option is `A11Y_CHROME_PATH`.

### Launch

- `chromiumoxide` drives the browser over CDP. It uses `BrowserConfig` with `.new_headless_mode()`, `.hide()` and a fresh profile directory: `$TMP/a11y-profile-<report id>` for full runs, or `$TMP/a11y-profile-rerun-<uuid>` for re-runs. The directory is deleted when the run finishes.
- One browser instance per run. Each URL gets a new tab (`new_page("about:blank")` → `goto(url)`), which is closed afterwards.
- Pages are scanned **one at a time**. `mode` and `batch_size` are ignored.

### Injecting and running axe

- axe-core **4.14.1** is stored in the repo at `src-tauri/assets/axe.min.js` and compiled into the binary with `include_str!` (`AXE_SOURCE`). No network fetch is needed.
- After navigation, the engine calls `page.evaluate(AXE_SOURCE)` and then `axe.run({ runOnly: { type: 'tag', values: <tags> }, resultTypes: ['violations'] })`, and gets the violations back as a JSON string.
- There is no explicit wait for network idle or a selector. axe runs as soon as `goto` resolves.

### Timeouts

The timeout for each page is `max(audit.config.timeout_secs, 15)` seconds and covers navigation, injection and the axe run (`tokio::time::timeout`). When it expires, the page result gets `error: "page timed out after Ns"`.

### Mapping violations to `A11yIssue` (`violations_to_issues`)

| axe field | `A11yIssue` field |
|---|---|
| `id` | `issue_type` (axe rule id, e.g. `color-contrast`) |
| `impact` | `severity` (defaults to `moderate` when null) |
| `help` | `message` (falls back to the rule id) |
| `helpUrl` | `help_url` (Deque University link) |
| first `wcagNNN` criterion tag | `wcag` (`wcag111` → `1.1.1`, `wcag2411` → `2.4.11`). Level tags such as `wcag2aa` are skipped. |
| tags starting `section508`, `en-301`, or equal to `act`, `best-practice`, `experimental` | `standards` |
| node `target` (joined with spaces) | `selector` |
| first tag name in node `html` | `element` |

Each violation produces at most **25 nodes** (`MAX_NODES_PER_VIOLATION`). Mapping stops after **1000 issues per page** (`MAX_TOTAL_ISSUES`). That cap is only checked inside the node loop, so violations with no nodes can push the total past it. After mapping, issues are filtered by `min_severity`. `categories` has **no effect** on this engine.

### Standards → axe tags (`axe_tags_for_standards`)

| Selection | `runOnly` tags |
|---|---|
| *(none)* | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`, `best-practice` |
| `wcag20` | `wcag2a`, `wcag2aa` |
| `wcag21` | the above plus `wcag21a`, `wcag21aa` |
| `wcag22` | the above plus `wcag22a`, `wcag22aa` |
| `section508` | `section508`, `wcag2a`, `wcag2aa` |
| `en301549` | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, **`EN-301-549`** (axe's own tag) |
| `bestpractice` | `best-practice` |

Tags are combined and deduplicated. Level AAA tags (`wcag2aaa`, and so on) are never requested.

### Page results

- `status` is always `Some(200)` and `status_text` is `"OK"` for any page that loads. The real HTTP status is **not** captured, so a 404 or 500 page is reported as 200 and audited.
- `response_time_ms` is the whole time spent on the page: navigation, injection and the axe run.
- The audit's custom headers and cookies are **not** sent by the browser engine. Origin override and URL postfix **are** applied.

### Failure and fallback behavior

- **Browser not found, or launch failed**: `run_axe_audit` returns `Err`. `A11yRunner::run` emits `a11y:error {message}` and returns a report with `status: "error"`, no results and an empty summary. `run_a11y_audit` **saves** that report, so the failed run shows up in history. The UI shows the message. There is **no automatic fallback to the static engine**.
- **Errors on a single page** (navigation, injection, `axe.run`, timeout) become a page result with `error` set, and the run continues.
- If the violations JSON cannot be parsed, the page gets an empty violation list (`unwrap_or_default`) rather than an error.

### Tests

`axe_tags_for_standards_mapping` is a unit test. `smoke_axe_scan_real_page` is `#[ignore]`d: it needs a local browser and accepts an `A11Y_TEST_URL` override.

```sh
cd src-tauri && cargo test smoke_axe_scan_real_page -- --ignored --nocapture
```

---

## Audit standards (`src/utils/a11yStandards.ts`)

The UI ids and labels are defined in `A11Y_STANDARDS` in `src/pages/AccessibilityPage.tsx`, and `standardLabel` and `standardsLabel` turn ids into display labels:

| id | Label | Static engine meaning | axe engine meaning |
|---|---|---|---|
| `wcag20` | WCAG 2.0 | criteria from 2.0 | `wcag2a/aa` |
| `wcag21` | WCAG 2.1 | 2.0 + 2.1 | + `wcag21a/aa` |
| `wcag22` | WCAG 2.2 | 2.0 + 2.1 + 2.2 | + `wcag22a/aa` |
| `section508` | Section 508 | treated as WCAG 2.0 | `section508` + `wcag2a/aa` |
| `en301549` | EN 301 549 | treated as WCAG 2.1 | WCAG 2.1 A/AA + native `EN-301-549` tag |
| `bestpractice` | Best practices | only issues without a WCAG criterion (none exist) | `best-practice` |

`standardsLabel([])` returns `"All standards"`. The selected standards are copied onto every report (`A11yReport.standards`) so that exports describe themselves.

---

## Scoring (`src/utils/a11yScore.ts`)

Scores are computed only in the frontend and are never stored.

- Weight per issue: critical **10**, serious **5**, moderate **2**, minor **1**. An unknown severity counts as 1.
- `pageScore(issues) = max(0, 100 − Σ weights)`.
- `reportScore(report)` is the rounded mean of `pageScore` over pages with no `error` and a non-null `status`. It returns `null` when no page was scanned successfully.
- `scoreColor`: 90 or above is green, 70 or above yellow, 40 or above orange, otherwise red.

The score drops quickly: 10 critical issues on a page bring it to 0. The axe engine can report up to 25 nodes per rule, so its pages tend to score lower than static-engine pages.

---

## Reports UI

### Report page (`src/pages/A11yReportPage.tsx`, route `/accessibility/reports/:reportId`)

- Summary cards and the score.
- A **score trend** chart covering the 8 most recent reports of the same audit (Recharts). Each report in the chart is loaded in full so its score can be computed.
- Issues-by-type counts.
- A per-page list with a severity filter and free-text search. The search matches against each page result serialized as JSON. The page list is rendered with `src/components/A11yIssuesList.tsx`.
- Exports go through the Tauri save dialog and `writeFile`:
  - **HTML**: see below.
  - **JSON**: the raw `A11yReport`.
  - **CSV**: one row per issue, with columns `URL, Page Title, Status, Response Time (ms), Error, Severity, WCAG, Element, Selector, Message`. A page with no issues still gets one row with empty issue columns.
- **Compare**: opens a modal listing other reports of the same audit, and navigates to the diff page.

### Re-running errored pages

- The **"Re-run failed (N)"** button appears when any page has `error`. It calls `rerun_a11y_pages(reportId)`. A **Retry** button on each errored page calls it with `[url]`.
- On the backend (`rerun_a11y_pages` in `commands/a11y.rs`):
  1. Load the report and its audit. The audit's **current** engine and `a11y_config` are used, not the settings in effect when the report was made.
  2. The targets are the `urls` passed in, or, when none are given, every result that has an `error`. If there are no targets, the report is returned unchanged.
  3. The URLs stored on the report have already been transformed, so origin override and postfix are **not** applied again.
  4. `scan_urls_static`: sequential, using the same HTTP client settings. `scan_urls_axe`: sequential, in a fresh browser.
  5. `merge_rerun_results` replaces each result whose `url` matches, and appends any URL it does not find.
  6. The summary is recomputed and `completed_at` is set to now. `status` and `standards` are left as they were. The report is saved over the same file.
- Progress is reported through `a11y:progress` and `a11y:result`. No `a11y:complete` event is sent; the command returns the updated report instead.
- The re-run calls `A11yRunner::reset()` and shares the runner's cancel flag with full audits.

### Report diff (`src/pages/A11yReportDiffPage.tsx`, route `/accessibility/reports/diff/:idA/:idB`)

`diffReports(a, b)` matches pages by URL:

- A URL found only in B is **added**; one found only in A is **removed**.
- For each URL in both, issues are counted per `issue_type`. For every type, the excess in B counts as **new** issues and the excess in A counts as **resolved**. For example, a type going from 3 to 1 means 2 resolved. Matching is by count only, not by selector or element.
- A page with any new issue is a **regression**. A page with only resolved issues is an **improvement**. Otherwise it is **unchanged**.
- The page shows both reports' scores and each page's score before and after.

A is always the report you are viewing and B is the one you picked in the Compare modal, which can be **older**. "Regression" means B has more issues than A. When B is an older report, the labels are effectively reversed.

Errored pages have no issues, so a page that errored in A and has issues in B shows up as a regression.

### HTML export (`src/lib/a11yReportHtml.ts`)

`a11yReportToHtml(report, auditName)` builds one self-contained HTML file with inline CSS and no scripts:

- A header showing the start and end times, the status, the standards label and a short report id.
- Cards for the score (colored by the same thresholds as `scoreColor`), pages, pages with issues, and counts per severity.
- An "Issues by type" table sorted by count.
- One section per page with a table of severity badge, rule, WCAG, standards, element selector, message and help link. The standards column leaves out the generic `"wcag"` tag, so it is empty for static-engine issues. Errored pages show their error text instead.
- A footer explaining how the score is calculated. Print styles keep each page section together.
- Every value is escaped with `esc()`.

---

## Running and configuring an audit (`src/pages/AccessibilityPage.tsx`)

The form fields are name, target list, engine (`Static HTML (fast)` or `axe-core (headless browser)`), minimum severity, mode (batch or sequential), batch size (1–20), timeout (1–120 s, default 10), rule categories and standards.

- If every category checkbox is unchecked, `categories` becomes `[]`, which the engine treats as **all** categories.
- The category checkboxes are still shown when the axe engine is selected, even though that engine ignores them.

While a run is in progress, the page shows a progress bar and live results driven by the events above.

---

## Differences from the plan

Compared with [`a11y-plan.md`](./a11y-plan.md):

- **Storage**: the plan describes separate `a11y_audits/` and `a11y_reports/` directories. In the code, audits are stored in the main app data and reports in `a11y-history/`. There is no retention policy.
- **Score**: the plan puts a `score` field on `A11yPageResult`. The code has no such field; the score is calculated in the frontend (`a11yScore.ts`).
- **Severities**: these differ from the plan's "Severity mapping" section:

  | Rule | Plan | Code |
  |---|---|---|
  | empty links | critical | serious |
  | skipped heading levels | serious | moderate |
  | missing main | serious | moderate |
  | broken ARIA refs | moderate | serious |
  | missing captions | moderate | serious |
  | viewport zoom | minor | moderate |

- **Rules planned but not built**: the "layout tables heuristic" and "`<a>` without href used as button" rules. The planned check for images inside links without alt is handled by the general `missing-alt` rule. The plan also said empty links would be checked; the code only checks for a missing or empty `href`.
- **Phase D text**: it says `axe.run` is "scoped to WCAG 2.x A/AA tags". With no standards selected, the run now also includes `wcag22*` and `best-practice`.
- **"1000 issues/page" cap**: this is in the code but is not strictly enforced, as described in [Mapping violations](#mapping-violations-to-a11yissue-violations_to_issues).
- **Unbuilt items**: the plan's "Remaining gaps" are still unbuilt: no viewport emulation, no waiting for network idle or a selector, and the axe engine scans one page at a time. Report diffing, which that list also includes, has since been built.
- **Run events**: the plan suggested reusing `run:*` events. The code uses a separate `a11y:*` namespace.
- **Commands**: the plan's verification section uses `npm run …`. The project now uses **bun**.

## Known limitations and gotchas

- **Help links**: static-engine `help_url`s have the form `…/WCAG21/Understanding/<criterion>` (for example `/1.1.1`). W3C's Understanding pages use slug URLs (for example `non-text-content.html`), so these links probably do not resolve. axe help links are fine.
- **Success criterion 4.1.1**: `missing-charset` and `duplicate-id` are mapped to 4.1.1 (Parsing), which WCAG 2.2 marks as obsolete.
- **Static engine**: it only sees the server-rendered HTML. Pages built by an SPA will produce false positives such as `no-headings` or `missing-main`.
- **axe engine HTTP status**: the real status is not captured; see [Page results](#page-results).
- **Re-run with changed settings**: if the audit's engine or settings changed after the report was made, a re-run can mix results from different configurations in one report.
