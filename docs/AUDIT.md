# LinkCheckerApp: Project Audit

| | |
|---|---|
| **Date** | 2026-11-23 |
| **Branch** | `feat/a11y-rerun-errors` (head `d287dea`) |
| **Version** | 0.1.5 |
| **Scope** | Rust backend (`src-tauri/src`), React frontend (`src/`), tooling, CI and docs |
| **Audience** | The maintainer, to decide what to fix and in what order |

---

## 1. Executive summary

**Overall health: fair. The core works, but there are data-integrity risks and the CI pipeline is broken.**

The architecture is sound. A Tauri v2 shell keeps the Rust engines (selector checker, link crawler, static a11y rules, headless axe-core) separate from a typed React UI. Storage is one file per run, lookups by ID are safe from path traversal, the Rust core logic has 52 passing unit tests, and the TypeScript config is strict. The problems are concentrated in four places:

1. **Silent data loss.** If `data.json` fails to parse, the app falls back to empty data without telling anyone, and the next save erases every Target List, Check Template and Audit. All writes are non-atomic, so a crash in the middle of a write can cause exactly that parse failure.
2. **Frontend/backend contract drift.** The `javascript` check type never reaches disk. Check IDs are regenerated on every template save, so the result columns show `—` until the app restarts. Optimistic updates swallow backend errors.
3. **Run lifecycle.** Cancelling leaves tasks running, and they can overwrite the final "cancelled" record. A `batch_size` of 0 hangs the run. A failed run start leaves the UI stuck on "Running". The axe engine reports every page as HTTP 200 and leaks tabs when a page times out.
4. **Tooling.** CI still uses npm after the move to bun, so the frontend job fails at setup. If it ran, it would still fail: clippy has 3 errors, lint has 3 errors, 2 unit tests fail, and 27 files fail the prettier check. Rust tests never run in CI.

Security exposure is defence-in-depth rather than an exploit that works today. `read_file`/`write_file` accept any path, `csp` is `null`, devtools are enabled in release builds, and CSV exports allow formula injection. The app's own UI has several WCAG failures, which matters because it is an accessibility auditing tool.

### Findings by severity

| Severity | Count |
|---|---|
| High | 4 |
| Medium | 32 |
| Low | 39 |
| **Total** | **75** |

The auditors reported 84 raw findings. Duplicates found by more than one area were merged into the 75 above, and each merged entry keeps the higher severity. All findings were confirmed in verification, so none is marked *unverified*.

---

## 2. Top priorities (ordered fix list)

1. **Stop silent data loss.** On a failed parse, back up the corrupt `data.json` and report the error instead of resetting. Add `#[serde(default)]` to the `AppData` collections. Write every file atomically (temp file, fsync, rename). See [A-01](#a-01), [A-14](#a-14).
2. **Fix the `javascript` CheckType wire name** and stop `patchCheckTemplate` from swallowing errors. See [A-02](#a-02).
3. **Keep check IDs stable.** The backend should keep incoming IDs, and the store should adopt the template the backend returns. See [A-03](#a-03).
4. **Repair CI and get it green.** Switch CI to bun. Fix the 3 clippy errors, the 3 ESLint errors and the 2 stale constants tests. Add `cargo test` and `format:check` to CI. See [A-04](#a-04), [A-32](#a-32)–[A-35](#a-35), [A-70](#a-70).
5. **Make failed run starts recoverable.** Wrap `runAudit`/`runQuickAudit` in try/catch, reset state, and show the error. Emit `run:error` or remove its listener. See [A-16](#a-16).
6. **Validate run config on the backend.** Clamp `batch_size >= 1` and `timeout_secs >= 1`. A value of 0 currently hangs both engines. See [A-07](#a-07).
7. **Fix cancellation.** Check the cancel flag in the spawn loops, abort or await the JoinHandles, skip partial saves after cancel, and use a cancel token per run. See [A-05](#a-05), [A-09](#a-09), [A-15](#a-15).
8. **Fix axe-engine correctness.** Record the real HTTP status, always close the page on timeout, and treat axe parse failures as errors. See [A-11](#a-11), [A-12](#a-12), [A-50](#a-50).
9. **Fix the branch feature.** Re-runs should use the report's stored engine and standards, and the diff should not count errored pages as resolved. See [A-10](#a-10), [A-22](#a-22).
10. **Fix AuditDetailPage data-loss paths.** Make Cmd+Enter save, reset cookies in `startEdit`, remount on `:id` change, scope the results tab to its own audit, and add confirmations to destructive actions. See [A-24](#a-24)–[A-27](#a-27), [A-29](#a-29).
11. **Reduce the attack surface.** Restrict `read_file`/`write_file` to paths the user picked in a dialog, set a CSP, gate devtools to debug builds, drop `opener:allow-open-path`, and neutralise CSV formulas. See [A-08](#a-08), [A-17](#a-17), [A-56](#a-56).
12. **Put runtime limits on JS checks** (Boa `RuntimeLimits` plus `spawn_blocking`). See [A-06](#a-06).

---

## 3. Findings

Each finding lists its location as a link relative to `docs/`. Severity is the verified severity.

### 3.1 High

#### Rust backend: persistence

<a id="a-01"></a>
**A-01 · Corrupt or schema-incompatible `data.json` is silently replaced with empty data, and the next save erases all user config**
- **Location:** [src-tauri/src/storage.rs:499](../src-tauri/src/storage.rs#L499) (also [models.rs:260](../src-tauri/src/models.rs#L260))
- **Description:** `Storage::load()` treats any read or deserialize error as "no data" and returns `AppData::empty()`. It does not log, back up or warn. It runs once at startup, and the next CRUD command or `set_history_retention` calls `save()`, which overwrites `data.json` with near-empty state. Possible triggers are a truncated file (see A-14), a hand edit, or a schema change. `AppData.target_lists/check_templates/audits` have no `#[serde(default)]`. Several nested required fields also have no defaults: `A11yAudit.engine`, `a11y_config`, `AuditConfig.mode/batch_size/timeout_secs`, `A11yReport.summary`.
- **Evidence:** `serde_json::from_str(&content).unwrap_or_else(|_| AppData::empty())`
- **Recommendation:** On a parse failure, rename the file to `data.json.corrupt-<ts>` (or keep a `.bak` from the last good save), log the error and show it in the UI. Add `#[serde(default)]` to all `AppData` collections and to every newly added field. Add a schema `version` field.

#### Frontend: core

<a id="a-02"></a>
**A-02 · CheckType `'javascript'` does not match the Rust serde name `'javaScript'`, so JS checks are silently never saved**
- **Location:** [src/types/index.ts:11](../src/types/index.ts#L11) (also [CheckTemplateDetailPage.tsx:15](../src/pages/CheckTemplateDetailPage.tsx#L15), [models.rs:18](../src-tauri/src/models.rs#L18), [StoreProvider.tsx:82](../src/hooks/StoreProvider.tsx#L82))
- **Description:** With `rename_all = "camelCase"`, the variant `JavaScript` serializes as `"javaScript"`, but the frontend sends `'javascript'`. `update_check_template` fails to deserialize it. `patchCheckTemplate` has already updated local state optimistically and discards the rejection with `.catch(() => {})`, so the UI shows the check as saved and it disappears on reload. `quick_run` rejects in the same way, which leaves the run stuck (A-16).
- **Evidence:** `#[serde(rename_all = "camelCase")] pub enum CheckType { ... JavaScript }` vs `'javascript'` in TS.
- **Recommendation:** Add `#[serde(rename = "javascript", alias = "javaScript")]` to the variant, or change the TS literal. Add a serde round-trip test for every CheckType. Surface the error and roll back in `patchCheckTemplate`.

<a id="a-03"></a>
**A-03 · Check IDs are regenerated on every template save while the store keeps the old IDs, so results and CSV show `—` for every check**
- **Location:** [src/hooks/StoreProvider.tsx:74](../src/hooks/StoreProvider.tsx#L74) (also [CheckTemplateDetailPage.tsx:70](../src/pages/CheckTemplateDetailPage.tsx#L70), `src-tauri/src/commands/check_templates.rs:91`, [ResultsTable.tsx:62](../src/components/ResultsTable.tsx#L62), [AuditDetailPage.tsx:137](../src/pages/AuditDetailPage.tsx#L137))
- **Description:** `update_check_template` gives every check a new `Uuid::new_v4()` on each save. `patchCheckTemplate` ignores the returned template and keeps the old IDs by array index. Runs use the persisted IDs, while ResultsTable and the CSV export match on the store's stale IDs, so every check column shows `—` until the app restarts. Reusing IDs by index also gives a deleted or moved check's ID to a different check. Because IDs change on every save, older runs can never be matched against the current template. Every keystroke triggers a save, and save errors are discarded.
- **Evidence:** `id: ct.checks[i]?.id ?? c.id` … `api.updateCheckTemplate({ id, ...data }).catch(() => {})`; backend `id: Uuid::new_v4().to_string()`.
- **Recommendation:** Add `id: Option<String>` to `CheckInput` and keep it when present. Replace the store entry with the template the server returns. Debounce saves and surface failures.
- *Merged from frontend-core and frontend-pages.*

#### Tooling

<a id="a-04"></a>
**A-04 · CI workflow uses npm but the repo has only `bun.lock`, so the quality job fails at setup**
- **Location:** [.github/workflows/ci.yml:17](../.github/workflows/ci.yml#L17)
- **Description:** Commit `632471e` moved the project to bun, but CI still uses `setup-node` with `cache: npm` and runs `npm ci`. Both fail without `package-lock.json`, so lint, typecheck, test and build never run.
- **Evidence:** `cache: npm` / `run: npm ci`; no `package-lock.json` in the repo; `packageManager: bun@1.3.12`.
- **Recommendation:** Use `oven-sh/setup-bun@v2` (bun 1.3.12) with `bun install --frozen-lockfile`, then `bun run lint`, `typecheck`, `test:run`, `format:check` and `build`.

### 3.2 Medium

#### Rust backend: checker and runs

<a id="a-05"></a>
**A-05 · Cancel leaves tasks running, and their partial saves can overwrite the final "cancelled" run file**
- **Location:** [src-tauri/src/checker.rs:133](../src-tauri/src/checker.rs#L133) (also [checker.rs:128](../src-tauri/src/checker.rs#L128), [storage.rs:68](../src-tauri/src/storage.rs#L68), [runs.rs:312](../src-tauri/src/commands/runs.rs#L312))
- **Description:** On cancel, the await loop breaks and drops the JoinHandles, which does not abort the tasks. In-flight requests continue until `timeout_secs`, then emit `run:result` and `run:progress` after `run:complete`, and call `save_run` with a "running" partial. Partial and final saves use the same file path, so a late task can overwrite the cancelled record, leaving it "running" with `completed_at: null` forever. The spawn loop also never checks cancel, so cancel only takes effect once the in-flight requests finish.
- **Evidence:** `for fetch in fetches { if self.cancel_flag.load(..) { break; } let _ = fetch.await; }`
- **Recommendation:** Check cancel in the spawn loop. Use a `JoinSet` or keep the `AbortHandle`s and abort on cancel, or race requests against a `CancellationToken`. Skip partial saves after cancel, or route results through a single writer.
- *Merged from rust-checker and rust-persistence.*

<a id="a-06"></a>
**A-06 · JavaScript checks run user JS on a tokio worker with no time or loop limit**
- **Location:** [src-tauri/src/checker.rs:482](../src-tauri/src/checker.rs#L482)
- **Description:** Boa runs with `Context::default()` and no `RuntimeLimits`, synchronously inside an async task. `while(true){}` blocks a worker thread forever. The run cannot be cancelled, and enough such checks can freeze every async command in the app. The snippets come from the app's own user, but nothing recovers from a hang.
- **Evidence:** `let mut context = Context::default();` … `context.eval(Source::from_bytes(&js_code))`; no `RuntimeLimits` or `spawn_blocking` anywhere.
- **Recommendation:** Set the loop iteration and recursion limits, and run `run_checks` inside `spawn_blocking`. Consider a wall-clock limit as well.

<a id="a-07"></a>
**A-07 · `batch_size` of 0 makes both the checker and the static a11y runner hang forever**
- **Location:** [src-tauri/src/checker.rs:44](../src-tauri/src/checker.rs#L44) (also [a11y_runner.rs:69](../src-tauri/src/a11y_runner.rs#L69), [commands/audits.rs:49](../src-tauri/src/commands/audits.rs#L49))
- **Description:** `Semaphore::new(batch_size)` has no backend guard. HTML `min={1}` does not stop a typed value, and a cleared field gives `Number('') = 0`. `acquire_owned()` then never resolves, and cancel cannot help. `timeout_secs = 0` also passes through to the checker, so every request fails immediately.
- **Evidence:** `_ => Arc::new(Semaphore::new(audit.config.batch_size as usize)),`
- **Recommendation:** Clamp `batch_size` to `1..=50` and `timeout_secs` to `>= 1`, or reject invalid values in create/update/quick_run and the a11y equivalents.
- *Merged from rust-checker and rust-a11y.*

<a id="a-08"></a>
**A-08 · `write_file`/`read_file` give the webview unrestricted filesystem access, CSP is null, and devtools ship in release builds**
- **Location:** [src-tauri/src/commands/runs.rs:324](../src-tauri/src/commands/runs.rs#L324) (also [tauri.conf.json:22](../src-tauri/tauri.conf.json#L22), [Cargo.toml](../src-tauri/Cargo.toml))
- **Description:** These custom commands accept any absolute path and bypass Tauri's fs scoping. The UI renders content scraped from third-party pages. No XSS exists today (there is no `dangerouslySetInnerHTML`), but any future XSS would become arbitrary file read and write (for example overwriting `~/.zshrc`). The `devtools` feature is enabled unconditionally.
- **Evidence:** `pub fn write_file(path: String, content: String) { fs::write(&path, &content) }`; `"csp": null`; `tauri = { features = ["devtools"] }`.
- **Recommendation:** Accept only paths the user picked in a dialog, or use `tauri-plugin-fs` with scopes. Set a restrictive CSP. Enable devtools only in debug builds.
- *Merged from rust-checker and rust-persistence.*

#### Rust backend: accessibility

<a id="a-09"></a>
**A-09 · Static a11y runner: in-flight tasks can overwrite the final cancelled report with a "running" partial**
- **Location:** [src-tauri/src/a11y_runner.rs:132](../src-tauri/src/a11y_runner.rs#L132) (also [commands/a11y.rs:143](../src-tauri/src/commands/a11y.rs#L143))
- **Description:** This is the same pattern as A-05. Tasks keep running after cancel and write "running" partials under the same `report_id` after the final "cancelled" save. The spawn loop also ignores cancel, so every remaining URL is spawned, recorded as "cancelled before request", and written to disk in full.
- **Evidence:** the join loop `break`s on cancel; each task calls `state.storage.save_a11y_report(&partial)` with `status: "running"`.
- **Recommendation:** Await or abort every handle before building the final report, stop spawning after cancel, and skip partial saves once cancel is set.

<a id="a-10"></a>
**A-10 · Re-run uses the audit's current engine and standards, not the report's, so results get mixed**
- **Location:** [src-tauri/src/commands/a11y.rs:208](../src-tauri/src/commands/a11y.rs#L208)
- **Description:** `rerun_a11y_pages` scans with the current `audit` settings (engine, standards, min_severity, categories, timeout) and never reads `report.standards`. If the audit was edited after the run, the re-scanned pages are checked under different rules but merged into a report that still lists the old standards. This affects the feature added on this branch.
- **Evidence:** `if audit.engine == "axe-core" { scan_urls_axe(&app, &audit, ..) } else { scan_urls_static(&app, &audit, ..) }`
- **Recommendation:** Store the engine, min_severity and categories on `A11yReport`, and build the re-run config from the report's values. Otherwise, refuse the re-run when they differ from the audit's current settings.

<a id="a-11"></a>
**A-11 · Axe engine: a page timeout skips `page.close()`, leaking tabs, and cancel does not stop the current page**
- **Location:** [src-tauri/src/a11y_browser.rs:371](../src-tauri/src/a11y_browser.rs#L371)
- **Description:** `tokio::time::timeout` drops the scan future before `page.close()` at L522 runs. The tab stays open in the shared browser until the audit ends. Cancel is checked only between pages. If `Browser::launch` fails, the temporary profile directory is never removed. This affects both `run_axe_audit` and `scan_urls_axe`.
- **Evidence:** `tokio::time::timeout(page_timeout, scan_page_with_browser(..))`; `let _ = page.close().await; // never reached on timeout`
- **Recommendation:** Create the page outside the timeout and always close it afterwards. Race against a cancel `Notify`. Use a scope guard to remove `user_data_dir`.

<a id="a-12"></a>
**A-12 · Axe engine always reports HTTP 200 OK and audits error pages**
- **Location:** [src-tauri/src/a11y_browser.rs:513](../src-tauri/src/a11y_browser.rs#L513)
- **Description:** The navigation status is never read. 404 and 500 responses and login redirects are recorded as 200 with no error, and the error page itself gets audited. These pages do not count as errored, so "Re-run errored pages" skips them.
- **Evidence:** `status: Some(200), status_text: "OK".into(),`
- **Recommendation:** Read the status from `Network.responseReceived` or `performance.getEntriesByType('navigation')[0].responseStatus`, and treat 4xx and 5xx as errors.

<a id="a-13"></a>
**A-13 · The viewport zoom rule never detects `maximum-scale` because it splits on `;` instead of `,`**
- **Location:** [src-tauri/src/a11y.rs:293](../src-tauri/src/a11y.rs#L293)
- **Description:** Viewport content values are separated by commas. With the current split, `maximum-scale` is effectively never detected, so this common WCAG 1.4.4 failure is missed. Only `user-scalable=no` is caught.
- **Evidence:** `c.split(';').find_map(|p| p.strip_prefix("maximum-scale="))`
- **Recommendation:** Split on both `,` and `;`, also treat `user-scalable=0` as locked, and add a test for `width=device-width,maximum-scale=1`.

#### Rust backend: persistence

<a id="a-14"></a>
**A-14 · All persistence uses non-atomic `std::fs::write`, so a crash mid-write corrupts data or history files**
- **Location:** [src-tauri/src/storage.rs:508](../src-tauri/src/storage.rs#L508) (also storage.rs:91, 257, 380)
- **Description:** `save`, `save_run`, `save_a11y_report` and `save_link_check_scan` truncate the file and then write it. A crash leaves a zero-length or truncated file. For `data.json` that leads into A-01. Corrupt history files are skipped without any message. Run files are rewritten after every page (A-37), which widens the window for history files.
- **Evidence:** `std::fs::write(self.data_path(), content)`
- **Recommendation:** Add a `write_atomic` helper (write a temp file in the same directory, `sync_all`, then `rename`) and use it for all four save paths. Optionally keep a `.bak`.

#### Frontend: core

<a id="a-15"></a>
**A-15 · Starting a run soon after another lets the old run's events land in the new run (one shared cancel flag, events carry no run ID)**
- **Location:** [src/hooks/RunContext.tsx:103](../src/hooks/RunContext.tsx#L103) (also [checker.rs:36](../src-tauri/src/checker.rs#L36), `lib.rs:53`, [runs.rs:318](../src-tauri/src/commands/runs.rs#L318))
- **Description:** `cancel()` sets `running:false` immediately, but the backend run is still blocked in `fetch.await`. A new start calls `Checker::run`, which calls `self.reset()` and clears the single shared `cancel_flag`, so the old run usually continues. Its `run:result` events are appended to the new run, and its `run:complete` sets `running:false` and calls `cleanup()`, removing the new run's listeners. On the backend, one cancel also stops every concurrent run, and nothing prevents runs from overlapping.
- **Evidence:** `if (runningRef.current) { await cancelRun(); await cleanup() }`; `self.reset();` at the start of `run()`.
- **Recommendation:** Put a run ID in every event payload and ignore events that do not match. Use a `CancellationToken` per run, keyed by run ID, or reject a new run while one is active. Set `runningRef` synchronously.
- *Merged from frontend-core and rust-checker.*

<a id="a-16"></a>
**A-16 · A rejected `runAudit`/`runQuickAudit` leaves the app stuck in "Running", and the `run:error` listener is dead code**
- **Location:** [src/hooks/RunContext.tsx:112](../src/hooks/RunContext.tsx#L112) (also [AuditDetailPage.tsx:112](../src/pages/AuditDetailPage.tsx#L112), [runs.rs:272](../src-tauri/src/commands/runs.rs#L272))
- **Description:** `run_audit` returns Err before emitting any event when the target list or template is missing, which is easy to cause because deletes do not check references (A-58), or when `save_run` fails. `quick_run` rejects on a `javascript` check (A-02). The frontend has already set `running:true` and has no try/catch. No backend code emits `run:error`. The header shows "Running…" indefinitely, and only the Cancel button gets out of that state.
- **Evidence:** `setState({ running: true, ... }); await setupListeners(auditId); await runAudit(...)`; `grep "run:error" src-tauri/src` returns nothing.
- **Recommendation:** Wrap the call in try/catch, reset state, call `cleanup()`, and show the error on AuditDetailPage and QuickAuditPage. Emit `run:error` or remove the listener.
- *Merged from frontend-core and frontend-pages.*

<a id="a-17"></a>
**A-17 · CSV export allows formula injection from page content, and unescaped textContent and labels corrupt columns**
- **Location:** [src/utils/csv.ts:1](../src/utils/csv.ts#L1) (also [AuditDetailPage.tsx:124](../src/pages/AuditDetailPage.tsx#L124), [LinkScanResults.tsx:10](../src/components/LinkScanResults.tsx#L10))
- **Description:** `csvEscape` does not handle `\r` and does not neutralise a leading `= + - @`. A page title such as `=HYPERLINK(...)` becomes a live formula in Excel or Sheets. In AuditDetailPage, the header labels and the per-check `textContent` cell are not escaped at all. LinkScanResults has its own duplicate escaper with the same formula gap.
- **Evidence:** quotes only when the value contains `,` `"` or `\n`; `cols.push(cr ? \`${...}(${cr.textContent})\` : '—')`.
- **Recommendation:** Use one shared escaper that quotes on `\r`, prefixes `'` on formula characters, and is applied to every cell and header. Add tests.

<a id="a-18"></a>
**A-18 · Modal is not an accessible dialog**
- **Location:** [src/components/Modal.tsx:24](../src/components/Modal.tsx#L24)
- **Description:** The modal has no `role="dialog"`, `aria-modal` or `aria-labelledby`. Focus is not moved in, trapped or restored. The close button `×` has no label. Global hotkeys 1–6 still navigate the page underneath, and each instance's document-level Escape handler closes every stacked modal at once.
- **Evidence:** `<div ref={overlayRef} className="fixed inset-0 ...">` … `<button onClick={onClose}>&times;</button>`
- **Recommendation:** Use a native `<dialog>` with `showModal()`, or add the ARIA attributes, a focus trap and focus restore. Add `aria-label="Close"`. Suppress hotkeys while a modal is open.

<a id="a-19"></a>
**A-19 · Sidebar search results cannot be used from the keyboard**
- **Location:** [src/components/Sidebar.tsx:63](../src/components/Sidebar.tsx#L63)
- **Description:** Result buttons respond only to `onMouseDown`. Tabbing to a result blurs the input, and 200 ms later the dropdown unmounts. Enter and the arrow keys do nothing, and there is no combobox ARIA. The advertised ⌘K search needs a mouse.
- **Evidence:** `onBlur={() => setTimeout(() => setFocused(false), 200)}`; `<button onMouseDown={...}>`
- **Recommendation:** Use `onClick` with `preventDefault` on mousedown, keep the dropdown open while focus is inside it, and add Enter and arrow navigation with combobox/listbox roles.

<a id="a-20"></a>
**A-20 · VirtualList in RunDetailPage renders invalid table markup and virtualizes nothing**
- **Location:** [src/components/VirtualList.tsx:35](../src/components/VirtualList.tsx#L35) (also [RunDetailPage.tsx:346](../src/pages/RunDetailPage.tsx#L346), [RunDetailPage.tsx:12](../src/pages/RunDetailPage.tsx#L12))
- **Description:** In table view, VirtualList puts `div > div > div > tr` inside `<tbody>`, so rows no longer line up with `<thead>`. No className is passed, so the container has no bounded height and every row renders. The detailed view assumes fixed 100 px rows, but the cards vary in height (an expanded issues list can reach 260 px), so they overlap or clip, and its `h-full` container sits under an auto-height parent.
- **Evidence:** `<tbody><VirtualList items={displayedResults} itemHeight={ITEM_HEIGHT_TABLE} renderItem={(r) => <tr>...`
- **Recommendation:** Use spacer `<tr>` rows inside a scroll wrapper with a bounded height, or `@tanstack/react-virtual` with `measureElement`, or paginate.
- *Merged from frontend-core and frontend-pages.*

<a id="a-21"></a>
**A-21 · ErrorBoundary is never reset on navigation**
- **Location:** [src/components/ErrorBoundary.tsx:11](../src/components/ErrorBoundary.tsx#L11) (also [App.tsx:128](../src/App.tsx#L128))
- **Description:** A single boundary wraps all `<Routes>`. After one page throws, every route shows the error until "Try again" is clicked. There is no `componentDidCatch`, so nothing is logged.
- **Evidence:** only `getDerivedStateFromError`; `<ErrorBoundary><Routes>…`
- **Recommendation:** Use `key={location.pathname}` or `resetKeys`, and add `componentDidCatch` logging.

#### Frontend: pages

<a id="a-22"></a>
**A-22 · A11y report diff treats an errored page as "all issues resolved" (or "all new")**
- **Location:** [src/pages/A11yReportDiffPage.tsx:43](../src/pages/A11yReportDiffPage.tsx#L43)
- **Description:** `diffReports` ignores `r.error`. A page that errored in B has 0 issues there, so every issue from A is listed as resolved and `pageScore([])` gives it 100. `reportScore` excludes errored pages, so the per-page rows contradict the header scores. This matters more now that the branch adds re-running of errored pages.
- **Evidence:** `const countsB = typeCounts(rb.issues)` with no error check.
- **Recommendation:** Add an "errored / not comparable" kind and use null scores for errored sides. Move `diffReports` to `src/utils` and unit-test it.

<a id="a-23"></a>
**A-23 · Run/report diff direction depends on click order, not on time**
- **Location:** [src/pages/RunHistoryPage.tsx:64](../src/pages/RunHistoryPage.tsx#L64) (also [A11yReportPage.tsx:378](../src/pages/A11yReportPage.tsx#L378))
- **Description:** The diff pages treat A as "before". RunHistoryPage passes the runs in Set insertion order, and A11yReportPage always passes the current report as A. Comparing the latest report with an older one, which is the natural flow, reverses the regression and improvement labels.
- **Evidence:** `const [a, b] = Array.from(selected)`
- **Recommendation:** Sort by `startedAt` after loading, in both diff pages.

<a id="a-24"></a>
**A-24 · AuditDetailPage keeps the previous audit's state when `:id` changes, so Save can overwrite the wrong audit**
- **Location:** [src/pages/AuditDetailPage.tsx:25](../src/pages/AuditDetailPage.tsx#L25)
- **Description:** All edit and run-option state comes from `useState` initializers, and the route has no `key`. The header's "View running audit" button moves between audits without remounting the page, so edits in progress (and `originOverride`/`urlPostfix`) carry over and Save writes them to the other audit.
- **Evidence:** `useState(audit?.originOverride ?? '')`; `updateAudit(a.id, { name: editName, ... })`
- **Recommendation:** Remount per id (`key={id}`), or reset all local state in an effect keyed on `id`.

<a id="a-25"></a>
**A-25 · Cmd/Ctrl+Enter on the audit edit form closes it without saving**
- **Location:** [src/pages/AuditDetailPage.tsx:57](../src/pages/AuditDetailPage.tsx#L57)
- **Description:** The shortcut is documented as "Submit form" but only sets `editing=false`. Changes to name, mode, batch size, timeout, headers and cookies are discarded without warning.
- **Evidence:** `'Cmd+Enter': () => { ... setEditing(false) }` with no `handleUpdate()`.
- **Recommendation:** Call `handleUpdate()` from both shortcut handlers.

<a id="a-26"></a>
**A-26 · `startEdit` does not reset `editCookies`, so cancelled edits get saved later and cookies can be wiped**
- **Location:** [src/pages/AuditDetailPage.tsx:83](../src/pages/AuditDetailPage.tsx#L83)
- **Description:** `editCookies` is set only at mount. A cookie edit that was cancelled persists into the next Save. On a deep link or reload, the page can mount before the store loads, so `editCookies` starts as `[]` and the first Save erases all of the audit's cookies.
- **Evidence:** `startEdit` resets every field except cookies; `config: { ..., cookies: editCookies }`.
- **Recommendation:** Add `setEditCookies(a.config.cookies ?? [])` to `startEdit` and clear the pending key/value inputs.

<a id="a-27"></a>
**A-27 · Audit results tab shows whichever run is in the global runner, even one from another audit**
- **Location:** [src/pages/AuditDetailPage.tsx:541](../src/pages/AuditDetailPage.tsx#L541)
- **Description:** Nothing checks `runner.run.auditId === a.id`. Opening audit B shows audit A's results against B's columns, B's CSV export writes A's results, and B's Cancel button cancels A. QuickAuditPage has the same problem.
- **Evidence:** `{(runner.run || runner.running) && (` … `exportCsv(runner.run!, ct?.checks ?? [])`
- **Recommendation:** Store the active `auditId` in RunContext and show results only for the matching audit. Otherwise show a link to the active run.

<a id="a-28"></a>
**A-28 · The baseline run link navigates to a route that does not exist**
- **Location:** [src/pages/AuditDetailPage.tsx:502](../src/pages/AuditDetailPage.tsx#L502)
- **Description:** The link goes to `/runs/:id`, but run details live at `/history/:runId` and there is no catch-all route, so the main pane renders empty.
- **Evidence:** ``navigate(`/runs/${a.baselineRunId}`)``
- **Recommendation:** Use `/history/${id}` and add a `*` not-found route.
- *Merged from frontend-pages (medium) and frontend-core (low).*

<a id="a-29"></a>
**A-29 · Destructive actions run without confirmation, and bulk delete includes hidden selections**
- **Location:** [src/pages/RunHistoryPage.tsx:79](../src/pages/RunHistoryPage.tsx#L79) (also [AuditDetailPage.tsx:247](../src/pages/AuditDetailPage.tsx#L247), [TargetListsPage.tsx:108](../src/pages/TargetListsPage.tsx#L108), AuditsPage.tsx:208, CheckTemplatesPage.tsx:94)
- **Description:** Clear All history, audit Delete, and bulk Delete Selected all act on one click. The selection survives folder-filter changes, so items the user can no longer see are deleted. Deleted lists and templates leave orphaned audits (A-58). `ConfirmDialog` already exists and is used on 5 other pages.
- **Evidence:** `async function handleClear() { await clearHistory(); setFiles([]) }`
- **Recommendation:** Route these through `ConfirmDialog` with a count and the list of affected audits, and clear the selection when the filter changes.

<a id="a-30"></a>
**A-30 · "Set as Baseline" bypasses the store, so the UI never shows the new baseline**
- **Location:** [src/pages/RunDetailPage.tsx:137](../src/pages/RunDetailPage.tsx#L137)
- **Description:** The page calls `updateAudit` from `lib/tauri` directly. The backend updates, but the store does not, so the button label and AuditDetailPage stay stale until restart. Rejections are unhandled.
- **Evidence:** `import { getRunResults, updateAudit, writeFile } from '@/lib/tauri'`
- **Recommendation:** Use the store's `updateAudit` from `useStore()` and handle errors.

<a id="a-31"></a>
**A-31 · App accessibility: clickable divs, unlabeled icon buttons, and labels not linked to their inputs**
- **Location:** [src/pages/A11yReportPage.tsx:304](../src/pages/A11yReportPage.tsx#L304) (also [AuditsPage.tsx:258](../src/pages/AuditsPage.tsx#L258), [A11yReportDiffPage.tsx:200](../src/pages/A11yReportDiffPage.tsx#L200), [AuditDetailPage.tsx:280](../src/pages/AuditDetailPage.tsx#L280))
- **Description:** Expandable rows and audit cards are `<div onClick>` with no role, tabIndex or key handler. Icon-only buttons (✕ ▼ ★) have no accessible name and no `aria-expanded` or `aria-pressed`. `<label>`s are not linked to their inputs. These are basic WCAG failures in an accessibility tool. (Modal-specific issues are covered in A-18.)
- **Evidence:** `<div onClick={() => setExpanded(...)} className="... cursor-pointer">`
- **Recommendation:** Use `<button aria-expanded>` for row toggles and links for cards, add `aria-label`s, link labels with `useId`/`htmlFor`, and consider running axe against the app UI in tests.

#### Tooling, testing and docs

<a id="a-32"></a>
**A-32 · Rust `clippy -D warnings` fails with 3 errors**
- **Location:** [src-tauri/src/commands/a11y.rs:56](../src-tauri/src/commands/a11y.rs#L56) (also [a11y_runner.rs:72](../src-tauri/src/a11y_runner.rs#L72), [checker.rs:422](../src-tauri/src/checker.rs#L422))
- **Description:** The errors are `needless_borrow`, `unwrap_or_default`, and `too_many_arguments` (11/7) on `update_a11y_audit`. The CI rust job would fail.
- **Evidence:** `error: could not compile app (lib) due to 3 previous errors`
- **Recommendation:** Pass `audit` without the borrow, use `.unwrap_or_default()`, and take a patch struct (or add `#[allow]`).

<a id="a-33"></a>
**A-33 · Frontend unit tests fail: the constants tests were not updated for the 6th nav item**
- **Location:** [src/\_\_tests\_\_/utils/constants.test.ts:17](../src/__tests__/utils/constants.test.ts#L17)
- **Description:** The tests hard-code 5 nav items, but there are now 6 (Accessibility).
- **Evidence:** `Tests 2 failed | 25 passed (27)`; `expected [ …(6) ] to have a length of 5`.
- **Recommendation:** Assert on the structure (keys `1..NAV_ITEMS.length`, every `to` present) rather than a fixed count.

<a id="a-34"></a>
**A-34 · ESLint fails with 3 `react-hooks/set-state-in-effect` errors**
- **Location:** [src/pages/LinkCheckerPage.tsx:28](../src/pages/LinkCheckerPage.tsx#L28) (also AccessibilityPage.tsx:86, LinkCheckHistoryPage.tsx:19)
- **Description:** `bun run lint` exits 1 with 3 errors and 3 warnings. The warnings are `only-export-components` in A11yIssuesList, RunContext and ThemeContext.
- **Evidence:** `✖ 6 problems (3 errors, 3 warnings)`
- **Recommendation:** Reset the state in event handlers or derive it from a start timestamp. Move non-component exports into their own modules.

<a id="a-35"></a>
**A-35 · CI never runs Rust tests**
- **Location:** [.github/workflows/ci.yml:41](../.github/workflows/ci.yml#L41)
- **Description:** The rust job runs only `cargo check` and `clippy`. The 52 passing tests never run in CI.
- **Evidence:** no `cargo test` step; `cargo test` locally gives `52 passed; 0 failed; 1 ignored`.
- **Recommendation:** Add `cargo test --manifest-path src-tauri/Cargo.toml` and `Swatinem/rust-cache`.

<a id="a-36"></a>
**A-36 · README is out of date**
- **Location:** [README.md:20](../README.md#L20)
- **Description:** The README has no Link Checker or Accessibility features, says hotkeys are "1-4" (they are 1–6), lists a nonexistent `useAuditRunner` hook, lists 5 pages where 15 are routed, omits the a11y Rust modules, and leaves out the lint/typecheck/test/format scripts.
- **Evidence:** `1-4 for page navigation`; `hooks/ # useStore, useAuditRunner, useHotkeys`
- **Recommendation:** Update the features, structure, hotkeys and scripts sections. Document the Chrome, Chromium, Edge or Brave requirement and `A11Y_CHROME_PATH`.

### 3.3 Low

#### Rust backend: checker and runs

<a id="a-37"></a>
**A-37 · The whole run file is rewritten after every page while holding the results lock: O(n²) blocking I/O**
- **Location:** [src-tauri/src/checker.rs:105](../src-tauri/src/checker.rs#L105) (also [storage.rs:90](../src-tauri/src/storage.rs#L90))
- **Description:** The `std::sync::Mutex` guard is held through the clone, `compute_summary`, pretty-printing and `fs::write` on a tokio worker. Total bytes written grow quadratically with page count, and the corruption window for A-14 is widened.
- **Evidence:** `let mut results = results.lock().unwrap(); ... state.storage.save_run(&partial); // guard held`
- **Recommendation:** Drop the guard first, throttle checkpoints, use a single writer task via `spawn_blocking`, and write compact JSON.
- *Merged from rust-checker and rust-persistence.*

<a id="a-38"></a>
**A-38 · Response bodies are read with no size cap**
- **Location:** [src-tauri/src/checker.rs:195](../src-tauri/src/checker.rs#L195) (also [runs.rs:36](../src-tauri/src/commands/runs.rs#L36), runs.rs:134, runs.rs:440)
- **Description:** `response.text()` buffers whole bodies. `get_page` truncates by characters (not bytes), and only after the full download.
- **Evidence:** `match response.text().await {`
- **Recommendation:** Stream with `chunk()` up to a byte cap, and skip non-HTML content types.

<a id="a-39"></a>
**A-39 · URL postfix is appended after the query string or fragment**
- **Location:** [src-tauri/src/checker.rs:524](../src-tauri/src/checker.rs#L524)
- **Description:** `page?a=1` with postfix `.html` becomes `page?a=1.html`.
- **Evidence:** `format!("{}{}", url, p)`
- **Recommendation:** Append to the path via `Url::set_path`, or document the behaviour and add tests.

<a id="a-40"></a>
**A-40 · Origin override drops the query or fragment when there is no path, and can split on `://` inside the query**
- **Location:** [src-tauri/src/checker.rs:535](../src-tauri/src/checker.rs#L535)
- **Description:** `https://old.com?x=1` becomes `<origin>/`. A scheme-less URL whose query contains a URL is split at the wrong point.
- **Evidence:** `return format!("{}/", new_origin);`
- **Recommendation:** Parse with `Url` and copy the scheme, host and port from the override.

<a id="a-41"></a>
**A-41 · Average response time counts errored pages in the divisor**
- **Location:** [src-tauri/src/checker.rs:900](../src-tauri/src/checker.rs#L900)
- **Description:** Errored results are skipped when summing but still counted in the divisor, so the average is understated.
- **Evidence:** `total_time as f64 / total as f64`
- **Recommendation:** Divide by the number of results that have a response time.

<a id="a-42"></a>
**A-42 · The HTML is parsed again for every check and for the title**
- **Location:** [src-tauri/src/checker.rs:257](../src-tauri/src/checker.rs#L257) (also 353, 460, 468, 199, 514)
- **Description:** A template with K checks parses each page K+1 to K+3 times, on async workers.
- **Evidence:** `scraper::Html::parse_document(html)` in each check function.
- **Recommendation:** Parse once and pass `&Html`, inside `spawn_blocking`.

<a id="a-43"></a>
**A-43 · A Status check can never match a 3xx code because redirects are followed**
- **Location:** [src-tauri/src/checker.rs:49](../src-tauri/src/checker.rs#L49)
- **Description:** Only the final status is recorded, and the final URL is not stored.
- **Evidence:** `.redirect(reqwest::redirect::Policy::limited(10));`
- **Recommendation:** Record `response.url()` and the redirect chain, or use `Policy::none()` when a template expects a 3xx.

<a id="a-44"></a>
**A-44 · Link scan cannot be cancelled, its cap can be overshot during expansion, and URLs are not normalised**
- **Location:** [src-tauri/src/commands/runs.rs:599](../src-tauri/src/commands/runs.rs#L599) (also runs.rs:551, 497, 668)
- **Description:** There is no cancel flag. The frontier and the `linkcheck:discovered` events can exceed the 500-page cap. The seed URL is not normalised and fragments are not stripped, so `/a#x` and `/a#y` are fetched as separate pages.
- **Evidence:** `HashSet::from([url.clone()])`; `if checked.load(..) >= MAX_LINK_CHECKS { break; }`
- **Recommendation:** Call `set_fragment(None)`, normalise the seed, bound the frontier, and add a cancel token.

#### Rust backend: accessibility

<a id="a-45"></a>
**A-45 · A11y runs and re-runs share one cancel flag and have no concurrency guard**
- **Location:** [src-tauri/src/commands/a11y.rs:206](../src-tauri/src/commands/a11y.rs#L206) (also [a11y_runner.rs:40](../src-tauri/src/a11y_runner.rs#L40))
- **Description:** Both paths call `reset()` on the same flag and emit the same events. A re-run of a report that is still running races its saves against the original run.
- **Evidence:** `state.a11y_runner.reset(); let cancel = state.a11y_runner.cancel_flag();`
- **Recommendation:** Use a token per job or a running guard, refuse to re-run a "running" report, and add job IDs to events.

<a id="a-46"></a>
**A-46 · Axe engine ignores the audit's custom headers and cookies**
- **Location:** [src-tauri/src/a11y_browser.rs:341](../src-tauri/src/a11y_browser.rs#L341)
- **Description:** The static engine applies headers and cookies, but the browser path does not. This is latent today because the a11y UI always sends empty headers and cookies.
- **Evidence:** `BrowserConfig::builder()...` with no `setExtraHTTPHeaders` or `setCookies`.
- **Recommendation:** Apply them via CDP before `goto`.

<a id="a-47"></a>
**A-47 · `aria-label-generic` flags elements where `aria-label` is valid**
- **Location:** [src-tauri/src/a11y.rs:670](../src-tauri/src/a11y.rs#L670)
- **Description:** `section`, `table`, `ul`, `ol`, `li`, `td` and `tr` have roles that allow naming, so the rule produces false positives.
- **Evidence:** `"div" | "span" | "p" | "ul" | ... | "section"`
- **Recommendation:** Limit the list to generic and naming-prohibited elements.

<a id="a-48"></a>
**A-48 · `VALID_ROLES` is missing ARIA 1.2 and DPUB roles**
- **Location:** [src-tauri/src/a11y.rs:9](../src-tauri/src/a11y.rs#L9)
- **Description:** `generic`, `meter`, `paragraph`, `time` and other ARIA 1.2 roles, and all `doc-*` roles, are flagged as invalid. Only the first token of a fallback role list is checked.
- **Evidence:** `let first = role.split_whitespace().next()`
- **Recommendation:** Add the missing roles, accept `doc-*`, and flag only when no token is valid.

<a id="a-49"></a>
**A-49 · `empty-link` flags `<a>` elements with no href, which are not links**
- **Location:** [src-tauri/src/a11y.rs:755](../src-tauri/src/a11y.rs#L755)
- **Description:** Named anchors are reported as serious 2.4.4 failures.
- **Evidence:** `let href = a.value().attr("href").unwrap_or(""); if href.is_empty() {`
- **Recommendation:** Flag only `href=""`, or a no-href `<a>` that has a link role, onclick or tabindex.

<a id="a-50"></a>
**A-50 · An axe result parse failure is silently treated as zero violations**
- **Location:** [src-tauri/src/a11y_browser.rs:496](../src-tauri/src/a11y_browser.rs#L496)
- **Description:** A deserialize failure produces a clean "OK" page, which is a false negative.
- **Evidence:** `serde_json::from_str(&violations_json).unwrap_or_default();`
- **Recommendation:** Return an error so the page counts as errored and can be re-run.

<a id="a-51"></a>
**A-51 · Best-practice rules are tagged with WCAG criteria, so the standards filter cannot exclude them, and the help URLs are invalid**
- **Location:** [src-tauri/src/a11y.rs:120](../src-tauri/src/a11y.rs#L120)
- **Description:** Every static rule carries a WCAG SC, including heuristics such as `missing-h1`, `target-blank-noopener` and `redundant-role`, and 4.1.1, which WCAG 2.2 removed. Selecting only "bestpractice" returns nothing. `help_url` appends the raw SC number, which does not form a valid Understanding URL.
- **Evidence:** `if i.wcag.is_empty() { return include_non_wcag; }`; `format!("{}/{}", WCAG_DOCS, wcag)`
- **Recommendation:** Flag heuristic rules as best practice, drop 4.1.1 from the WCAG 2.2 selection, and map each SC to its Understanding slug.

<a id="a-52"></a>
**A-52 · The `MAX_TOTAL_ISSUES` cap does not cover node-less violations, and truncation is silent**
- **Location:** [src-tauri/src/a11y_browser.rs:208](../src-tauri/src/a11y_browser.rs#L208)
- **Description:** Node-less violations are pushed without checking the cap. Neither the 25-node limit nor the global cap is recorded in the result.
- **Evidence:** the `if nodes.is_empty() { issues.push(..) }` branch has no cap check.
- **Recommendation:** Check the cap at both push sites and add a `truncated` field.

#### Rust backend: persistence and config

<a id="a-53"></a>
**A-53 · History retention runs only manually, skips a11y-history and link-checks, and accepts days=0**
- **Location:** [src-tauri/src/storage.rs:208](../src-tauri/src/storage.rs#L208)
- **Description:** Pruning runs only from the RunHistoryPage button, scans only `history/`, and fully parses each file. Files whose dates fail to parse are never pruned. `set_history_retention` accepts 0, but nothing in the UI currently calls it.
- **Evidence:** `if let Ok(run) = serde_json::from_str::<AuditRun>(&content) {`
- **Recommendation:** Prune at startup and after each run, cover all history directories, read the date from the filename, and reject 0.

<a id="a-54"></a>
**A-54 · `list_audit_runs` only sees runs within the 500 most recent across all audits, and parses every full file**
- **Location:** [src-tauri/src/storage.rs:120](../src-tauri/src/storage.rs#L120) (also [runs.rs:348](../src-tauri/src/commands/runs.rs#L348))
- **Description:** The limit is applied before the audit filter and before the `.json` extension filter. Once there are more than 500 runs in total, an older audit's history is truncated.
- **Evidence:** `for path in paths.iter().rev().take(limit) {`
- **Recommendation:** Filter by audit first, and deserialize into a header struct that skips results.

<a id="a-55"></a>
**A-55 · `list_a11y_reports` parses each report twice, and listings sort by file creation time**
- **Location:** [src-tauri/src/storage.rs:294](../src-tauri/src/storage.rs#L294)
- **Description:** Each report is parsed once for `audit_id` and again for `started_at`. Sorting uses `metadata.created()` and falls back to the epoch when it is unavailable.
- **Evidence:** two `serde_json::from_str::<A11yReport>` calls per file.
- **Recommendation:** Parse once into a header struct, and sort by the filename timestamp.

<a id="a-56"></a>
**A-56 · `opener:allow-open-path` is granted but unused, and `open_data_folder` works only on macOS**
- **Location:** [src-tauri/capabilities/default.json:14](../src-tauri/capabilities/default.json#L14) (also [runs.rs:366](../src-tauri/src/commands/runs.rs#L366))
- **Description:** The permission adds attack surface with nothing using it. `Command::new("open")` fails on Windows and Linux, but bundle targets are "all".
- **Evidence:** `"opener:allow-open-path"`; `std::process::Command::new("open")`
- **Recommendation:** Remove or scope the permission, use `OpenerExt::open_path` or `reveal_item_in_dir`, and limit `open-url` to http(s).

<a id="a-57"></a>
**A-57 · HTML report puts page-controlled URLs into `href` with no scheme check**
- **Location:** [src/lib/a11yReportHtml.ts:29](../src/lib/a11yReportHtml.ts#L29) (also a11yReportHtml.ts:54, [A11yIssuesList.tsx:58](../src/components/A11yIssuesList.tsx#L58))
- **Description:** An axe `helpUrl` comes from the audited page's own JS context and can be tampered with, so a `javascript:` URL would survive into the exported report. Text content is escaped correctly.
- **Evidence:** `` `<a href="${esc(i.helpUrl)}">WCAG</a>` ``
- **Recommendation:** Add a `safeHref()` helper that allows only http(s), apply it before `openUrl` too, and add a CSP meta tag to exported HTML.

<a id="a-58"></a>
**A-58 · Deleting a Target List or Check Template leaves audits pointing at it**
- **Location:** [src-tauri/src/commands/target_lists.rs:129](../src-tauri/src/commands/target_lists.rs#L129)
- **Description:** No reference check is made. Orphaned audits fail with "Target list not found" (which then triggers A-16). `update_target_list` skips URL normalisation, but the UI normalises the URLs before calling it.
- **Evidence:** `data.target_lists.retain(|l| l.id != id); state.storage.save(&data)`
- **Recommendation:** Block the delete, or return the dependent audits so the UI can confirm a cascade.

<a id="a-59"></a>
**A-59 · Lock poisoning is permanent: one panic disables all CRUD commands until restart**
- **Location:** [src-tauri/src/commands/audits.rs:24](../src-tauri/src/commands/audits.rs#L24) (also [checker.rs:147](../src-tauri/src/checker.rs#L147))
- **Description:** A `PoisonError` is mapped to a string error for the rest of the session. Task-level `.lock().unwrap()` calls cascade a panic to other tasks. This is hypothetical, since no current panic source was found.
- **Evidence:** `state.data.lock().map_err(|e| e.to_string())?`
- **Recommendation:** Use `unwrap_or_else(|e| e.into_inner())` or `parking_lot::Mutex`.

<a id="a-60"></a>
**A-60 · Placeholder crate metadata and heavy dependencies**
- **Location:** [src-tauri/Cargo.toml:2](../src-tauri/Cargo.toml#L2)
- **Description:** The crate still has `name = "app"`, `description = "A Tauri App"`, `authors = ["you"]` and an empty license. `boa_engine` 0.17 is outdated, tokio uses `full`, and reqwest uses native-tls by default.
- **Evidence:** `name = "app"`; `boa_engine = "0.17"`
- **Recommendation:** Fill in the metadata, upgrade boa, run `cargo audit` in CI, trim tokio features, and consider rustls.

#### Frontend: core

<a id="a-61"></a>
**A-61 · Cmd/Ctrl+1–6 navigate even while typing in inputs**
- **Location:** [src/hooks/useHotkeys.ts:33](../src/hooks/useHotkeys.ts#L33)
- **Description:** The lookup falls back to the bare `e.key`, and the input guard is skipped when a modifier is held, so a half-filled form can be left with no prompt.
- **Evidence:** `mapRef.current[key] ?? mapRef.current[e.key]`
- **Recommendation:** Use the bare-key fallback only when no modifier other than Shift is held, and skip events where `isComposing` or `defaultPrevented` is set.

<a id="a-62"></a>
**A-62 · `Option<String>` fields arrive as `null`, but TS declares them optional-undefined**
- **Location:** [src/types/index.ts:8](../src/types/index.ts#L8) (also [models.rs:14](../src-tauri/src/models.rs#L14))
- **Description:** `folder`, `baselineRunId`, `originOverride` and `urlPostfix` serialize as `null`, and `A11yIssue.severity` can be `""`. Nothing breaks today, but this kind of drift is what caused A-02.
- **Evidence:** `folder?: string` vs `pub folder: Option<String>` with no `skip_serializing_if`.
- **Recommendation:** Type the fields as `string | null`, or generate TS types from Rust (ts-rs or specta).

#### Frontend: pages

<a id="a-63"></a>
**A-63 · Accessibility run can stay in "Scanning…" indefinitely**
- **Location:** [src/pages/AccessibilityPage.tsx:169](../src/pages/AccessibilityPage.tsx#L169)
- **Description:** Listeners are registered in an effect after the invoke, so a very fast run can miss `a11y:complete`. The success path never clears `runningId`. Invoke errors go only to `console.error`.
- **Evidence:** `try { await runA11yAudit(audit.id) } catch (e) { console.error(e); setRunningId(null) }`
- **Recommendation:** Register listeners before invoking, run the finish logic after the command resolves, and show errors via `setRunError`.

<a id="a-64"></a>
**A-64 · Unchecking the last a11y category re-selects all categories**
- **Location:** [src/pages/AccessibilityPage.tsx:390](../src/pages/AccessibilityPage.tsx#L390) (also [CheckTemplateDetailPage.tsx:334](../src/pages/CheckTemplateDetailPage.tsx#L334))
- **Description:** An empty array means "all", so the last uncheck appears to do nothing. The behaviour is documented in the label but confusing.
- **Evidence:** `checked={form.categories.length === 0 || form.categories.includes(cat.value)}`
- **Recommendation:** Disable the last checkbox or add an explicit "All" toggle, and share the component between the two pages.

<a id="a-65"></a>
**A-65 · Detail pages show "Loading…" indefinitely when a load fails**
- **Location:** [src/pages/A11yReportPage.tsx:56](../src/pages/A11yReportPage.tsx#L56) (also [RunDetailPage.tsx:42](../src/pages/RunDetailPage.tsx#L42), [RunHistoryPage.tsx:18](../src/pages/RunHistoryPage.tsx#L18))
- **Description:** A failed load sets the data to null, which renders the loading state. RunHistoryPage has no `.catch`.
- **Evidence:** `.catch(() => setReport(null))`; `if (!report) return <div>Loading...</div>`
- **Recommendation:** Track loading and error separately, as LinkCheckScanPage does.

<a id="a-66"></a>
**A-66 · Run detail counters are computed from already-filtered results**
- **Location:** [src/pages/RunDetailPage.tsx:224](../src/pages/RunDetailPage.tsx#L224)
- **Description:** With "passed" selected, failed and errored both show 0.
- **Evidence:** `✗ failed {displayedResults.filter(...).length}`
- **Recommendation:** Count from `run.results`.

<a id="a-67"></a>
**A-67 · Run diff hides added and removed URLs and merges different hosts that share a path**
- **Location:** [src/pages/RunDiffPage.tsx:7](../src/pages/RunDiffPage.tsx#L7)
- **Description:** Keys drop the origin, so the same path on two hosts collides. Added and removed URLs appear only as counts. A page that fails in both runs is "unchanged" whatever changed. `addOrPush` has unused parameters.
- **Evidence:** `return u.pathname + u.search + u.hash`
- **Recommendation:** Key on the full URL when origins match, add a "changed" bucket, list added and removed URLs, and remove dead code.

<a id="a-68"></a>
**A-68 · Cmd+Enter on Target Lists skips validation, and Quick Audit saves unnormalised URLs**
- **Location:** [src/pages/TargetListsPage.tsx:76](../src/pages/TargetListsPage.tsx#L76) (also [QuickAuditPage.tsx:45](../src/pages/QuickAuditPage.tsx#L45))
- **Description:** The shortcut calls `handleSave` even when the button would be disabled. "Save as Audit" only trims the URLs, while Run normalises them.
- **Evidence:** `'Cmd+Enter': () => { if (showForm) handleSave() }`
- **Recommendation:** Put the guard inside `handleSave`, and apply `normalizeUrl` when saving.

<a id="a-69"></a>
**A-69 · Oversized page components with copy-pasted logic, and no tests for the diff logic**
- **Location:** [src/pages/AuditDetailPage.tsx:344](../src/pages/AuditDetailPage.tsx#L344)
- **Description:** AuditDetailPage is 572 lines, and CheckTemplateDetailPage, AccessibilityPage and RunDetailPage are 463–507. Code is duplicated across pages: the header/cookie editor, the a11y constants, the bulk-action bar, inline CSV quoting, and the Cmd and Ctrl hotkey pairs. The diff algorithms are private to page modules and untested.
- **Evidence:** `wc -l`; identical `A11Y_CATEGORIES` in two pages.
- **Recommendation:** Extract shared components and a `useSelection` hook, move the diff and CSV logic into `src/utils` with Vitest tests, and support a `Mod+Enter` hotkey.

#### Tooling, testing and docs

<a id="a-70"></a>
**A-70 · 27 files fail prettier `format:check`, and CI does not run it**
- **Location:** [package.json:11](../package.json#L11)
- **Description:** The formatter is defined, but the code has drifted from it.
- **Evidence:** `Code style issues found in 27 files.`
- **Recommendation:** Run `bun run format` in its own commit, then add `format:check` to CI.

<a id="a-71"></a>
**A-71 · `test:coverage` is broken, and the 80% thresholds are unrealistic**
- **Location:** [vitest.config.ts:17](../vitest.config.ts#L17)
- **Description:** `@vitest/coverage-v8` is not installed. Only 7 frontend test files exist, and nothing covers a11yScore, a11yReportHtml, the stores or the pages.
- **Evidence:** `MISSING DEPENDENCY '@vitest/coverage-v8'`
- **Recommendation:** Install the provider, set thresholds at the current baseline, and test the pure utilities first.

<a id="a-72"></a>
**A-72 · Rust test gaps in run orchestration and CRUD commands**
- **Location:** [src-tauri/src/a11y_runner.rs:72](../src-tauri/src/a11y_runner.rs#L72)
- **Description:** `a11y_runner.rs` (which includes the new re-run feature), `commands/runs.rs`, `audits.rs`, `check_templates.rs` and `models.rs` have no tests.
- **Evidence:** `#[cfg(test)]` appears in only 6 files.
- **Recommendation:** Add serde round-trip tests for models (these would have caught A-02 and A-01) and tests for the re-run merge.

<a id="a-73"></a>
**A-73 · A 12 MB release DMG is committed to git (several times) and is stale (0.1.4 vs 0.1.5)**
- **Location:** [download/LinkCheckerApp_0.1.4_aarch64.dmg](../download/LinkCheckerApp_0.1.4_aarch64.dmg)
- **Description:** Each update adds about 12 MB to history. `icon.xcf` (3 MB) and `1032x1032.png` (1.1 MB) are also tracked. The repository is 73.67 MiB.
- **Evidence:** `git log -- 'download/*'` shows about 5 DMG updates.
- **Recommendation:** Publish builds as GitHub Release assets (tauri-action), and ignore `download/` and `*.dmg`.

<a id="a-74"></a>
**A-74 · `.env.example` says no env vars are needed, but the backend reads `A11Y_CHROME_PATH`**
- **Location:** [.env.example:1](../.env.example#L1)
- **Description:** The browser override (`a11y_browser.rs:39`) and `A11Y_TEST_URL` (used by the ignored smoke test) are undocumented.
- **Evidence:** `# No environment variables are required for local development.`
- **Recommendation:** Document both variables in `.env.example` and the README.

<a id="a-75"></a>
**A-75 · App version is duplicated in 4 places, including a hard-coded window title**
- **Location:** [src-tauri/tauri.conf.json:15](../src-tauri/tauri.conf.json#L15)
- **Description:** The version appears in `package.json`, `tauri.conf.json` (version and title) and `Cargo.toml`. They all agree at 0.1.5 today.
- **Evidence:** `"title": "Link Checker v0.1.5"`
- **Recommendation:** Point `version` at `../package.json`, set the title at runtime, and add a CI check that the versions match.

---

## 4. Strengths

**Rust: checker and link crawler**
- Hrefs are resolved with `Url::join`. `javascript:`, `mailto:` and fragment-only links are skipped, and origins are compared with `Url::origin()`.
- Crawls are bounded: depth at most 5, at most 500 checks, concurrency at most 10, level by level with a shared visited set. HEAD is used when no body is needed.
- Owned semaphore permits move into tasks, so a permit is released even on panic. Every client has a timeout and a limited redirect policy.
- Invalid selectors, regexes, JS errors and headers become failed checks instead of panics. Page data reaches JS checks as JSON literals, so it cannot break out of the setup script.
- Partial results survive crashes. The pure helpers have unit tests.

**Rust: accessibility**
- The axe tag mapping is cumulative, matches axe 4.14 (WCAG 2.0–2.2, native EN-301-549, Section 508, best-practice), and is tested. Two-digit SCs such as `wcag2411` are parsed correctly.
- Each browser run gets an isolated temporary Chrome profile and is closed and reaped cleanly. The axe script is embedded and injected over CDP, so page CSP cannot block it.
- Timeouts per page turn a slow page into an errored result. The static rules are broad and well tested. `merge_rerun_results` is tested.

**Rust: persistence and security**
- Lookups by ID match against directory entries and never join a frontend-supplied ID into a path, so there is no path traversal.
- History is stored as one file per run, report or scan, with a one-time migration from the legacy format.
- CRUD mutations and their saves happen in one locked section. The AppData lock is dropped before any `.await`.
- Many later-added fields already use `#[serde(default)]`. `Option<Option<T>>` correctly separates "unchanged" from "clear".
- URLs are opened through the opener plugin, and there is no `dangerouslySetInnerHTML` or `innerHTML`.

**Frontend**
- The HTML export escapes every interpolated string and double-quotes every attribute.
- Event listeners are tracked and removed on complete, cancel and unmount. Functional `setState` avoids stale closures.
- `useHotkeys` keeps its handler map in a ref and skips plain keys inside inputs. Contexts are cleanly split. ThemeContext uses `useSyncExternalStore`.
- The `lib/tauri.ts` command wrappers are thin and fully typed.
- The A11y report diff matches issues by excess and deficit per type. The new re-run-errored flow has proper rerunning, error and retry state.
- `ConfirmDialog` and LinkCheckScanPage's loading/not-found pattern already exist and can be reused. Design tokens and dark mode are applied consistently.

**Tooling**
- TypeScript is strict (`strict`, `noUnused*`, `verbatimModuleSyntax`, `erasableSyntaxOnly`), and `typecheck` passes.
- There are 52 passing Rust tests. The real-browser smoke test is correctly `#[ignore]`d.
- Both lockfiles are committed, `packageManager` is pinned, build outputs are ignored, and the Vite and Tauri paths and bun commands line up.
- The CI rust job installs the correct Tauri v2 Linux dependencies and enforces clippy `-D warnings`. ESLint includes the react-hooks v7 rules.

---

## 5. Method

Six area auditors reviewed the codebase in parallel: Rust checker/runs, Rust accessibility, Rust persistence/config, frontend core (hooks, components, types, lib), frontend pages, and tooling/CI/docs. Where they could, they ran the real toolchain (`cargo clippy`, `cargo test`, `bun run lint`, `test:run`, `format:check`, `test:coverage`). An adversarial verification pass then re-checked every finding against the source and adjusted severities where needed (several were downgraded). **0 findings were refuted and excluded**, and no finding was left with an "uncertain" verdict, so none is marked *unverified*. The 84 raw findings were merged into 75 where several areas reported the same root cause, and each merged entry keeps the higher severity. Line numbers refer to branch `feat/a11y-rerun-errors` at `d287dea`.
