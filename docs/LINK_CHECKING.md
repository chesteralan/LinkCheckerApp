# Selector Audits and Link Scans

This document explains how the two HTTP-based checking features in LinkCheckerApp work from end to end:

1. **Selector audits.** A *Target List* (URLs) plus a *Check Template* (assertions) makes an *Audit*. Each execution of an audit is a *Run*.
2. **Link scans.** The Link Checker page crawls outgoing `<a href>` links from one page and reports broken ones.

Accessibility audits (the separate headless-browser/axe-core pipeline) are out of scope here. See `docs/a11y-plan.md`. The static a11y rule engine (`src-tauri/src/a11y.rs`) appears below only where selector audits and link scans call it.

All behaviour described here was read from the code at the time of writing. File paths are relative to the repo root.

---

## Part 1: How to use it

### Run a selector audit

1. **Check Templates** (`/check-templates`): create a template and add checks. Each check has a label and a type (see [Check types](#check-types)).
2. **Target Lists** (`/target-lists`): create a list of URLs. You can paste them, import a `.txt`/`.csv` file, or scrape them from a live page. Bare hosts like `example.com` get `https://` added in front.
3. **Audits** (`/audits`): create an audit that pairs one list with one template. Choose the mode (`sequential` or `batch`), the batch size (default 5), the timeout in seconds (default 10), and any optional headers and cookies.
4. Open the audit (`/audits/:id`) and press **Run** (or `Cmd/Ctrl+R`). You can enter an **Origin Override** and a **URL Postfix** for this run only. Results stream into the Results tab. **Export CSV** saves the live run.
5. Past runs are listed under **Run History** (`/history`). Tick exactly two rows and press **Compare Selected** to diff them.
6. The audit's **Trends** chart shows pass, fail and error counts and the average response time per day, once at least 2 runs exist.

**Quick Audit** (`/check-templates/:id/quick-audit`) runs a template against URLs you paste, without saving a list or audit first. After a run finishes, **Save as Audit** saves the URLs as a new target list and creates an audit from them.

### Run a link scan

1. Go to **Link Checker** (`/link-checker`). Enter a page URL and choose:
   - **Max Depth**: Page only (0), 1, 2 or 3 levels.
   - **Same origin only** (on by default): links to other origins are **neither crawled nor checked**.
   - **Include accessibility**: runs the static WCAG rules on every page that is fetched. This is slower because it downloads full HTML.
2. Press **Check Links**. While the scan runs, the page shows which URLs are in flight and which are queued.
3. In the results you can export JSON or CSV, open a page's a11y issues, or use **Add to Target Lists** to turn every working link into a new target list.
4. Saved scans are listed at **History** (`/link-checker/history`). Open one at `/link-checker/history/:scanId`, where you can view or delete it.

A link scan cannot be cancelled after it starts, and its request timeout is fixed at 10 s by the UI.

---

## Part 2: Selector audits (developer reference)

### Data model

The model is defined in `src-tauri/src/models.rs`, and the TypeScript mirror is in `src/types/index.ts`. Everything is persisted in `<app_data_dir>/data.json` (`src-tauri/src/storage.rs`).

| Struct | Key fields |
|---|---|
| `TargetList` | `urls: Vec<String>` |
| `CheckTemplate` | `checks: Vec<SelectorCheck>` |
| `SelectorCheck` | `id`, `selector`, `label`, `check_type`, `expected_status`, `pattern`, `attribute_name`, `attribute_value`, `a11y_config` |
| `Audit` | `target_list_id`, `check_template_id`, `config: AuditConfig`, `origin_override`, `url_postfix`, `baseline_run_id` |
| `AuditConfig` | `mode` (`"sequential"` or anything else, which means batch), `batch_size` (default 5), `timeout_secs` (default 10), `headers`, `cookies` |
| `AuditRun` | `id`, `audit_id`, `started_at`, `completed_at`, `status` (`running`/`completed`/`cancelled`), `results: Vec<PageResult>`, `summary: RunSummary` |
| `PageResult` | `url`, `page_title`, `status`, `status_text`, `response_time_ms`, `error`, `checks: Vec<SelectorResult>` |
| `SelectorResult` | `selector_check_id`, `selector`, `label`, `found`, `count`, `text_content`, `check_type`, `a11y_issues` |

`create_check_template` and `update_check_template` (`src-tauri/src/commands/check_templates.rs`) **give every check a new UUID on each save**. Because of this, a `selector_check_id` from an older run will not match the current template's check ids.

### Check types

Dispatch happens in `run_checks()` in `src-tauri/src/checker.rs`. Every check produces a `SelectorResult`, and **`found == true` means the check passed**. All HTML-based checks work on the raw response body. No JavaScript runs on the page, so content that is rendered on the client side is invisible to them.

| `CheckType` | Inputs | Pass condition (`found`) | `count` | `text_content` |
|---|---|---|---|---|
| `selector` (default) | `selector` | ≥1 element matches (via the `scraper` crate) | number of matches | text of the first match, with its text nodes joined by `" "`, or `None` if empty |
| `status` | `expected_status` (default 200) | final HTTP status (after redirects) **equals** the expected value exactly | 1 or 0 | `"HTTP <code>"` |
| `regex` | `pattern` | ≥1 match against the **raw HTML** (Rust `regex` crate syntax) | number of matches | first match; `"invalid regex: …"` on a compile error |
| `attribute` | `selector`, `attribute_name`, optional `attribute_value` | no value given: some matched element has the attribute. Value given: some matched element's attribute **equals** it exactly | matched elements that have the attribute, whatever its value | `attr=value` pairs, comma-joined (only exact matches when a value is given) |
| `accessibility` | `a11y_config` (`min_severity` default `minor`, `categories`, `standards`) | the static rule engine `a11y::run_a11y_scan` returns **zero** issues after filtering | number of issues | `"Found N accessibility issues"` / `"No issues found"`; the issues themselves are in `a11y_issues` |
| `javaScript` | `pattern` (JS source) | the snippet evaluates to the boolean `true` (truthy non-booleans fail) | 1 or 0 | the result converted to a string, or `"JS error: …"` |

Notes:

- An invalid CSS selector, or an empty `pattern`/`attribute_name`, fails the check without raising an error.
- The JS check runs in `boa_engine`, a pure-Rust interpreter. It has **no DOM and no network access**. Its only globals are `pageText` (all text nodes of the document concatenated), `pageUrl`, and `pageTitle` (a string or `null`).
- Each check that needs HTML parses the document again, so there are N parses per page for N checks.

### How a page is classified

`compute_summary()` in `src-tauri/src/checker.rs` uses the same logic as the UI (`LiveSummary.tsx`, `RunDetailPage.tsx`):

- **errored**: `PageResult.error` is set. This covers transport errors, body-read errors and cancelled pages.
- **passed**: no error, and **every** check has `found == true`. A page with zero checks counts as passed.
- **failed**: otherwise.

The HTTP status does **not** affect pass or fail unless the template contains a `status` check. A 404 page whose selectors all match counts as passed.

`avg_response_time_ms` adds up the response times of non-errored pages but divides by **all** pages, errored ones included.

### Run execution

The entry points are Tauri commands in `src-tauri/src/commands/runs.rs`:

- `run_audit(auditId, originOverride?, urlPostfix?)` loads the audit, its target list and its template from `AppState.data`. A non-empty `originOverride`/`urlPostfix` passed here **replaces** the values saved on the audit for this run only. Empty strings fall back to the saved values.
- `quick_run(urls, checks, config, originOverride?, urlPostfix?)` builds a temporary `Audit`, `TargetList` and `CheckTemplate` in memory. The audit gets a **fresh random `id`** that matches no saved audit.

Both commands call `Checker::run()` (`src-tauri/src/checker.rs`) and then `storage.save_run(&run)`.

`Checker::run()` works as follows:

1. **HTTP client.** It builds one `reqwest` client with `timeout_secs` as the total per-request timeout, follows at most 10 redirects, and sends the audit's `headers` as default headers. Header names or values that are invalid are skipped silently. Cookies are joined into a single `Cookie: k=v; k2=v2` header.
2. **URL rewriting.** Each target URL goes through two steps in this order:
   - `apply_origin_override(url, origin_override)` keeps everything from the first `/` after `scheme://` (the path, query and fragment) and puts the override in front of it. A trailing `/` on the override is trimmed. A URL with no path becomes `<override>/`, and a URL with no `://` is left unchanged. Example: `https://old.com/path?q=1` with override `https://new.com/` becomes `https://new.com/path?q=1`.
   - `apply_url_postfix(url, postfix)` is plain string concatenation. It does not merge query strings: `https://x/a?b=1` plus `?preview=true` gives `https://x/a?b=1?preview=true`.
3. **Concurrency.** `mode == "sequential"` uses a `tokio::Semaphore` with 1 permit. Any other mode uses `batch_size` permits. The loop waits for a permit before spawning each URL's task, so at most N requests are in flight at once. Results are appended **in completion order**, not list order.
4. **Per URL** (`check_url`): one `GET` request. If it succeeds, the body is read as text and `run_checks()` runs. `page_title` is the trimmed `<title>`. `response_time_ms` measures the time until the response headers arrive (body download is not included).
5. **Events and incremental saves.** After every page the task emits `run:progress` `{checked, total}` and `run:result` (`PageResult`), then writes the whole partial run to disk with `status: "running"`.
6. **Finish.** The run emits `run:complete` with the final `AuditRun`, and also `run:cancelled` if it was cancelled. The caller then saves the final run.

**Cancellation.** `cancel_run` sets an `AtomicBool`.
- Tasks that start after the flag is set return straight away with `status_text: "cancelled"` and `error: "cancelled before request"`, so they count as **errored**.
- Requests already in flight are not aborted.
- `run()` stops waiting on spawned tasks and returns with status `cancelled` and whatever results have been collected. Tasks that are still running can finish later and overwrite the history file with a `"running"` partial snapshot, because the file name is the same.
- The flag is reset when the next run starts. There is one shared `Checker`, so only one selector run is active at a time. `RunContext.start()` cancels any active run before starting a new one.

**URL normalization.** The run itself does none. Normalization happens earlier:
- `create_target_list` (`src-tauri/src/commands/target_lists.rs`, `normalize_url`) trims each URL, adds `https://` if it doesn't start with `http://` or `https://` (case-sensitive check), and drops empty entries. `update_target_list` stores URLs **as given**, but the UI also normalizes before saving (`TargetListsPage.tsx`).
- The frontend `normalizeUrl()` (`src/lib/tauri.ts`) does the same with a case-insensitive scheme check. Quick Audit uses it on run.
- The "Scrape links" helpers (`scrape_links` command; `src/utils/resolveUrl.ts`) return raw `href`s that are sorted and de-duplicated. `resolveUrl` makes them absolute in a simple way: absolute `http(s)` links are kept, and anything else is attached to the source page's **origin** (with `/` added if missing). Relative paths like `../x` are therefore *not* resolved against the source page's directory. Fragments, `mailto:` and similar links are not filtered out.

### Frontend run state

`src/hooks/RunContext.tsx` (`RunProvider`, used through `useRun`) subscribes to `run:result`, `run:progress`, `run:complete`, `run:cancelled` and `run:error` (the backend never emits `run:error`). It collects the live `AuditRun` in React state, so a run keeps going if you navigate away from the page. `AuditDetailPage.tsx` shows it with `LiveSummary` and `ResultsTable`.

### Run history

Storage code is in `src-tauri/src/storage.rs`.

- Each run is saved as `<app_data_dir>/history/run-<YYYY-MM-DD_HH-MM-SS>-<runId>.json`. The timestamp comes from `started_at` in UTC.
- A legacy `history.json` is split into per-run files at startup (`migrate_old_history`).
- `list_run_files` drives `RunHistoryPage.tsx`. It sorts by **file system creation time**, newest first, and takes the date shown from that creation time. The `id` it returns is the text after the *last* `-` in the file name, which is only the last group of the UUID. This still works because `load_run`/`get_run_results` find files by the suffix `-<id>.json`.
- `list_audit_runs(auditId)` reads the 500 newest files by file name, keeps the runs for that audit, and drops `results` (summaries only). The trends chart uses it.
- `RunHistoryPage` labels every row "Quick Audit" no matter where the run came from, and shows 20 rows per page.
- **Prune Old** calls `prune_history`. It deletes runs whose `started_at` is older than `max_history_days` (default 90, stored in `data.json`). Pruning only happens when a user clicks this button; there is no automatic pruning. `set_history_retention` exists but no UI calls it. **Clear All** (`clear_history`) deletes every file in `history/`.
- **Baseline.** `RunDetailPage` → **Set as Baseline** writes `audit.baselineRunId`. `AuditDetailPage` shows the baseline and lets you clear it. Nothing compares a run against the baseline automatically.

### Run diff (`src/pages/RunDiffPage.tsx`)

The route is `/history/diff/:runIdA/:runIdB`. Run A is the first row ticked in history. Ticking a third row drops the oldest selection.

- Pages are matched by **`pathname + search + hash`**. Origins are ignored, so runs made with an origin override line up with each other. If the same path appears twice in one run, the last result wins.
- For each key the diff decides:
  - only in B: **added**; only in A: **removed**.
  - in both, with "passed" defined as `!error && every check found`:
    - passed in A and not passed in B: **regression**
    - not passed in A and passed in B: **improvement**
    - otherwise **unchanged**. This includes pages that fail in both runs, even if different checks failed.
- Only regressions and improvements are shown as cards. Each card shows the response time in A and B and the found/not-found state of each check. Added, removed and unchanged pages appear only as counts.
- The diff does not detect slower pages, changed status codes or check-level changes inside a page that failed in both runs.

### Trends (`src/components/TrendsChart.tsx`)

The chart appears on `AuditDetailPage` → Trends.

- It uses `list_audit_runs(auditId)` and keeps runs with `status == "completed"`. Each run goes into a bucket for its **UTC day** (`completedAt.slice(0, 10)`).
- For each day it shows:
  - stacked bars of the summed `passed`, `failed` and `errored` page counts across that day's runs
  - a line for the average response time, weighted by each run's `summary.total`
- With fewer than 2 runs (counted before filtering) it shows a placeholder instead of the chart.

### CSV and JSON export (selector runs)

There are two different CSV formats.

**1. Live run, wide format.** In `AuditDetailPage.tsx` the Export CSV button calls `exportCsv`. It writes one row per page:

```
URL,Status,Response Time (ms),Error,Page Title,<check label 1>,<check label 2>,…
```

Each check cell is `✓` or `✗`, followed by ` (<text_content>)` when there is text. It is `—` when the page has no result for that check id, which is the case for every errored page. `URL`, `Error` and `Page Title` are escaped with `csvEscape` (`src/utils/csv.ts`), which quotes a value only when it contains `,`, `"` or a newline. **Header labels and check cells are not escaped**, so a label or text content that contains a comma breaks the column layout. The default file name is `<audit name>-<YYYY-MM-DD>.csv`.

**2. Saved run, long format.** In `RunDetailPage.tsx` the Export menu offers CSV and JSON. The CSV has one row per (page, check):

```
URL,Page Title,Status,Status Text,Response Time (ms),Error,Check Label,Check Type,Found,Count
```

Every value is quoted. A page with no checks, for example an errored page, gets one row with the check columns empty. JSON export writes the whole `AuditRun`. The default file name is `<audit name or "run">-<runId>.<ext>`.

All files are written with the `write_file` command after a native save dialog (`@tauri-apps/plugin-dialog`).

---

## Part 3: Link scans (developer reference)

### Backend: `check_links` (`src-tauri/src/commands/runs.rs`)

```ts
checkLinks(url, { maxDepth, timeoutSecs, sameOriginOnly, includeAccessibility })  // src/lib/tauri.ts
```

The option defaults on the Rust side (`CheckLinksOptions`) are: `max_depth` 1, `timeout_secs` 10, `same_origin_only` true, `include_accessibility` false.

**Limits and client settings**
- `max_depth` is capped at **5** on the backend; the UI offers 0 to 3.
- Concurrency is fixed at **10** (a semaphore).
- No more than **500** links are checked after the seed page (`MAX_LINK_CHECKS`).
- Each fetched body is truncated to 2,000,000 **chars** (`MAX_A11Y_HTML_BYTES`). Link extraction also uses the truncated body.
- The client follows at most 10 redirects. It sends **no custom headers or cookies**.

**Crawl algorithm** (level by level, breadth-first)

1. The seed URL must parse (`reqwest::Url`), otherwise the command returns `"Invalid URL"`. The seed is always fetched with `GET` and recorded with `depth: 0` and `source_url == url`.
2. `extract_links_from_html(html, base)` collects every `a[href]`:
   - It trims the href and skips empty values and values starting with `#`, `javascript:` or `mailto:`.
   - It resolves the rest with `Url::join` against the page they came from. This is proper relative resolution.
   - It keeps only results whose string starts with `http`, which drops `tel:` and similar schemes.
   - The results are sorted and de-duplicated. Fragments are kept, so `/a#x` and `/a#y` are different links.
3. **Same-origin filter.** When `same_origin_only` is set, any link whose origin (scheme, host and port) differs from the seed's is dropped before it is checked. External links are never requested in this mode.
4. **Visited set.** A shared `visited` set starts with the seed string exactly as typed and grows across all depths. Each URL is checked once, attributed to the first page that linked to it. The seed is stored as typed, so a resolved link that differs only cosmetically (for example a trailing `/`) is checked again.
5. **Fetching each depth.** Every link in the current frontier is fetched:
   - with `GET` when the body is needed, either because `depth < max_depth` (the page can be expanded) or because accessibility is on;
   - with `HEAD` otherwise. Servers that reject `HEAD` (for example with 405) will show those links as broken.
6. **Expanding.** A link is expanded into the next frontier only if `depth < max_depth` and its status is `< 400`. Discovery stops once 500 links have been checked.
7. **Accessibility.** If accessibility is on, each fetched body, the seed included, goes through `a11y::run_a11y_scan` with `A11yCheckConfig::default()`: minimum severity `minor`, all categories, no standards filter. A `HEAD` response has no body, so it gets no issues.

**Events**

| Event | Payload | When |
|---|---|---|
| `linkcheck:discovered` | `{url, depth, sourceUrl}` | a new link is added to the next frontier |
| `linkcheck:checking` | `{url, depth, sourceUrl}` | a fetch starts |
| `linkcheck:result` | `LinkCheckResult` | a fetch finishes |

**Saving.** At the end the command saves a `LinkCheckScan` to `<app_data_dir>/link-checks/linkcheck-<timestamp>-<scanId>.json` and returns `Vec<LinkCheckResult>`. A failed save is ignored. There is no cancel command for link scans.

`LinkCheckResult` has the fields `url`, `source_url`, `status`, `status_text`, `error`, `depth` and `a11y_issues`. Results are in completion order.

### History commands

- `list_link_check_scans` returns `LinkCheckScanInfo` sorted by file creation time, newest first. It parses every scan file to compute three totals:
  - `total_links`
  - `broken`: `status >= 400 || error.is_some()`
  - `a11y_issues`
- As with runs, the `id` is only the last UUID group, and lookups use the file-name suffix.
- `get_link_check_scan(scanId)` and `delete_link_check_scan(scanId)` load and delete one scan.

### Frontend

- **`src/pages/LinkCheckerPage.tsx`** holds the form state. It subscribes to the three `linkcheck:*` events to keep the lists of live results, in-flight URLs and queued URLs (showing at most 50 of each, de-duplicated by URL), plus an elapsed-time counter. When `checkLinks` resolves, the page replaces its results with the returned array. Errors are only logged to the console.
- **`src/pages/LinkCheckHistoryPage.tsx`** lists saved scans: date, URL, link count, broken count, a11y count, and View/Delete buttons.
- **`src/pages/LinkCheckScanPage.tsx`** shows one saved scan's metadata (depth, origin mode, whether a11y was on) and lets you delete it.
- **`src/components/LinkScanResults.tsx`** is the results table shared by the live and saved views:
  - Counts. These overlap: a result with both a status and an error counts as ok or broken *and* as errored.
    - **ok**: `status < 400` and no error
    - **broken**: `status >= 400`
    - **errored**: `error` is set
  - The A11y column appears when the scan had accessibility on or any result has issues. Clicking it opens `A11yIssuesList` in a modal.
  - **Add to Target Lists** creates a new target list from the unique URLs of the **ok** results. Its default name is `Link check — <host> — <date>`.
  - **Export JSON** writes the result array.
  - **Export CSV** writes these columns, with every value quoted:

    ```
    URL,Source URL,Depth,Status,Status Text,Error,A11y Issues
    ```

    `A11y Issues` is the issue count. The default file name is `<exportName>-<epochMs>.<ext>`, where `exportName` is `link-check` for a live scan, or `link-check-<sanitised url, 40 chars>` for a saved scan.

---

## Known discrepancies and caveats

These were found while writing this document and are listed so they can be fixed or the docs adjusted.

- **JavaScript check type serialization mismatch.** In Rust, `CheckType::JavaScript` uses `#[serde(rename_all = "camelCase")]`, so it serializes as `"javaScript"`. The frontend (`src/types/index.ts`, `CheckTemplateDetailPage.tsx`) sends `"javascript"`. With no serde alias, saving a template (`create_check_template`/`update_check_template`) or quick-running one that contains a JavaScript check should fail to deserialize.
- **Broken baseline link.** The baseline link in `AuditDetailPage.tsx` goes to `/runs/:id`, but no such route exists in `src/App.tsx`. The run detail route is `/history/:runId`.
- **Unescaped CSV cells.** The live-run CSV (`AuditDetailPage.exportCsv`) does not escape header labels or check cells (see above).
- **`docs/FEATURES.md` / `docs/checklist.md` overstate several items:**
  - The run diff does not detect "slower pages" or "missing selectors" beyond pass/fail flips.
  - "Regression alerts … beyond a threshold" amounts to marking a baseline; there are no alerts and no threshold.
  - Status checks match one exact code, not a range like "2xx".
  - "Cookie / session support … or run a login flow": only static cookies are supported.
  - `FEATURES.md` says JS runs "in a headless context". It actually runs in `boa_engine` with no DOM. `checklist.md` describes this correctly.
- **Wrong "Type" column.** `RunHistoryPage` shows "Quick Audit" in the Type column for every run.
- **Quick runs don't link to an audit.** Quick runs are saved with a random `audit_id`, so `RunDetailPage` cannot connect them to any audit, and they never appear in an audit's trends.
- **Truncated IDs and file-system dates in listings.** History listings (`list_run_files`, `list_a11y_reports`, `list_link_check_scans`) return truncated ids and use file creation time instead of `started_at`.
