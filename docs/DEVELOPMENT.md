# Development Guide

How to set up, run, test and release LinkCheckerApp. For what the app does, see [README.md](../README.md) and [FEATURES.md](FEATURES.md).

LinkCheckerApp is a Tauri v2 desktop app:

- **Backend:** Rust, in `src-tauri/src/`. It fetches pages (`reqwest`), parses HTML (`scraper`), runs JavaScript checks (`boa_engine`), runs static accessibility rules, and drives a headless Chromium (`chromiumoxide`) for axe-core scans.
- **Frontend:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4, in `src/`.

---

## Prerequisites

| Tool | Version / source | Notes |
|---|---|---|
| Bun | `bun@1.3.12` (`packageManager` in `package.json`) | Package manager and script runner. The lockfile is `bun.lock`. |
| Rust toolchain | `rust-version = "1.77.2"` minimum (`src-tauri/Cargo.toml`) | Install with [rustup](https://rustup.rs). `clippy` is needed to match CI. |
| Tauri platform deps | See [Tauri prerequisites](https://tauri.app/start/prerequisites/) | macOS: Xcode Command Line Tools. Windows: WebView2 + MSVC build tools. |
| Chromium-based browser | Chrome, Chromium, Edge or Brave | **Only needed for the `axe-core` accessibility engine** (see below). |

### Linux system libraries

These come from the `rust` job in `.github/workflows/ci.yml`:

```bash
sudo apt-get update && sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev patchelf
```

### Browser for axe-core mode

An accessibility audit whose `engine` is `"axe-core"` (`src-tauri/src/a11y_runner.rs`) launches a headless Chromium through `chromiumoxide` and injects the bundled `src-tauri/assets/axe.min.js` (axe v4.14.1, embedded with `include_str!`). `find_browser_executable()` in `src-tauri/src/a11y_browser.rs` looks for a browser in this order:

1. The `A11Y_CHROME_PATH` environment variable, if that path exists.
2. Fixed paths: `/Applications/{Google Chrome,Chromium,Microsoft Edge,Brave Browser}.app/...`, `/opt/homebrew/bin/chromium`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`.
3. `which chromium | google-chrome | google-chrome-stable | chrome`.

If none is found, the run fails with `No Chromium-based browser found. Install Chrome/Chromium or set A11Y_CHROME_PATH.` On Windows, only `A11Y_CHROME_PATH` or `which` lookups apply, because there are no Windows paths in the candidate list. The static Rust rule engine (`src-tauri/src/a11y.rs`) does not need a browser.

---

## Setup

```bash
bun install          # JS deps (also installs @tauri-apps/cli)
bun tauri dev        # first run compiles the Rust crate; this takes a while
```

No environment variables are required (`.env.example`). Vite exposes only variables prefixed `VITE_` or `TAURI_` (`envPrefix` in `vite.config.ts`).

---

## package.json scripts

| Script | Command | What it does |
|---|---|---|
| `dev` | `vite` | Vite dev server on port **5173** (`strictPort: true`). This is the frontend only; `invoke` calls fail outside Tauri. |
| `build` | `tsc -b && vite build` | Type-checks all TS projects, then builds the frontend into **`build/`** (`build.outDir` in `vite.config.ts`). |
| `lint` | `eslint .` | ESLint flat config (`eslint.config.js`). |
| `format` | `prettier --write "src/**/*.{ts,tsx,css}"` | Formats the frontend sources. |
| `format:check` | `prettier --check "src/**/*.{ts,tsx,css}"` | Checks formatting without writing. |
| `typecheck` | `tsc -b --noEmit` | Type-checks without emitting files. |
| `test` | `vitest` | Vitest in watch mode. |
| `test:run` | `vitest run` | Runs Vitest once. |
| `test:coverage` | `vitest run --coverage` | Coverage with the v8 provider. See the caveat under Testing. |
| `preview` | `vite preview` | Serves the built frontend. |
| `tauri` | `tauri` | Tauri CLI passthrough (`bun tauri dev`, `bun tauri build`, `bun tauri icon`, …). |
| `build:tauri` | `bun run build && bun tauri build` | Builds the frontend, then the bundle. `tauri build` already runs `beforeBuildCommand` (`bun run build`), so the frontend is built twice. |

---

## Running in development

```bash
bun tauri dev
```

`src-tauri/tauri.conf.json` sets `beforeDevCommand: "bun run dev"` and `devUrl: http://localhost:5173`, so the Vite server starts automatically. Frontend changes hot-reload. Rust changes trigger a rebuild and an app restart.

- In debug builds, `tauri-plugin-log` is registered at `Info` level (`src-tauri/src/lib.rs`).
- The `devtools` Tauri feature is enabled (`Cargo.toml`), so the webview inspector is available.
- The app version shown in the sidebar comes from `__APP_VERSION__`. `vite.config.ts` injects it from `package.json`, and `src/App.tsx` reads it.

---

## Testing

### Frontend (Vitest)

The config is in `vitest.config.ts`, which is separate from `vite.config.ts` but uses the same plugins and the same `@` → `src` alias:

- `environment: 'jsdom'`, `globals: true` (`describe`/`it`/`expect` without imports).
- Setup file: `src/__tests__/setup.ts`, which imports `@testing-library/jest-dom/vitest`.
- Test files must match `src/**/*.{test,spec}.{ts,tsx}`.
- Coverage thresholds: statements 80, branches 75, functions 80, lines 80. `src/main.tsx`, `src/types/**` and test files are excluded.

Existing tests live under `src/__tests__/`:

```
src/__tests__/
├── setup.ts
├── components/  ErrorBoundary, Modal, ProgressBar
├── hooks/       useHotkeys
└── utils/       constants, csv, resolveUrl
```

```bash
bun run test:run                                    # all tests once
bun run test                                        # watch mode
bunx vitest run src/__tests__/utils/csv.test.ts     # one file
bunx vitest run -t "resolveUrl"                     # by test name pattern
```

> **Caveat:** `test:coverage` needs `@vitest/coverage-v8`, which is not in `devDependencies`. Install it (`bun add -d @vitest/coverage-v8`) before running coverage. `happy-dom` is installed but unused; the configured environment is `jsdom`.

### Rust (`cargo test`)

Unit tests are inline `#[cfg(test)] mod tests` blocks in:

- `src-tauri/src/checker.rs`
- `src-tauri/src/a11y.rs`
- `src-tauri/src/a11y_browser.rs`
- `src-tauri/src/storage.rs`
- `src-tauri/src/commands/target_lists.rs`
- `src-tauri/src/commands/a11y.rs`

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml normalize_url      # filter by name
```

`a11y_browser::tests::smoke_axe_scan_real_page` is `#[ignore]`d. It needs a real browser and network access. Run it with:

```bash
A11Y_TEST_URL=https://example.com \
  cargo test --manifest-path src-tauri/Cargo.toml smoke_axe -- --ignored --nocapture
```

---

## Lint, format, typecheck

```bash
bun run lint            # ESLint: js recommended + typescript-eslint + react-hooks + react-refresh
bun run typecheck       # tsc -b --noEmit (tsconfig.app.json for src/, tsconfig.node.json for vite.config.ts)
bun run format:check    # Prettier
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings   # same as CI
```

- **Prettier** (`.prettierrc`): no semicolons, single quotes, trailing commas, `printWidth: 120`, 2-space indent.
- **ESLint** (`eslint.config.js`) ignores `dist`, `build` and `src-tauri/target`. Unused args are allowed only with a leading `_`.
- **TypeScript** (`tsconfig.app.json`): `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (use `import type`), `erasableSyntaxOnly` (no `enum`s or parameter properties).

---

## CI (`.github/workflows/ci.yml`)

CI runs on pushes to `main` and `v*`, and on PRs to `main`. It has two jobs, both on `ubuntu-latest`.

| Job | Steps |
|---|---|
| `quality` | `actions/setup-node@v4` (Node 22, `cache: npm`) → `npm ci` → `npm run lint` → `npm run typecheck` → `npm run test -- --run` → `npm run build` |
| `rust` | `setup-rust-toolchain` → apt Tauri deps → `cargo check` → `cargo clippy -- -D warnings` |

Known gaps:

- **CI still uses npm**, even after the bun migration (commit `632471e`). The repo has no `package-lock.json`, only `bun.lock`, so `npm ci` will fail. The `quality` job needs to switch to `oven-sh/setup-bun` with `bun install --frozen-lockfile` and `bun run …`.
- `cargo test` is not run in CI. Only `check` and `clippy` are.
- `format:check` and `cargo fmt --check` are not run in CI.
- CI does not build or publish release bundles.

---

## Release / build

```bash
bun tauri build
```

This runs `beforeBuildCommand` (`bun run build` → `build/`), compiles the Rust crate in release mode and bundles for the host platform (`bundle.targets: "all"`). Artifacts go to `src-tauri/target/release/bundle/` (for example `dmg/` and `macos/` on macOS). Release builds use the Windows GUI subsystem (`src-tauri/src/main.rs`).

### Version bump checklist

The version is duplicated in several places, and nothing syncs them automatically:

| File | Field |
|---|---|
| `package.json` | `"version"` (also feeds `__APP_VERSION__` in the UI) |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `app.windows[0].title`, which is hardcoded as `"Link Checker v0.1.5"` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | the `app` package version; it updates on the next `cargo` build/check |

A previously built DMG is committed at `download/LinkCheckerApp_0.1.4_aarch64.dmg`. No code signing or notarization config is present in `tauri.conf.json`.

---

## Runtime data

`Storage` (`src-tauri/src/storage.rs`) writes JSON files under Tauri's `app_data_dir()`. The path depends on the bundle identifier `com.alchietagudin.linkcheckerapp`:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/com.alchietagudin.linkcheckerapp/` |
| Linux | `~/.local/share/com.alchietagudin.linkcheckerapp/` |
| Windows | `%APPDATA%\com.alchietagudin.linkcheckerapp\` |

```
<app_data_dir>/
├── data.json          # AppData: target lists, check templates, audits, a11y audits, settings
├── history/           # run-<YYYY-MM-DD_HH-MM-SS>-<id>.json        (AuditRun)
├── a11y-history/      # a11y-<timestamp>-<id>.json                 (A11yReport)
└── link-checks/       # linkcheck-<timestamp>-<id>.json            (LinkCheckScan)
```

- A legacy `history.json` is migrated into `history/` at startup (`Storage::migrate_old_history`).
- From the UI, `get_data_path` and `open_data_folder` expose this folder. `clear_history`, `prune_history` and `set_history_retention` manage it.
- axe scans create temporary Chromium profiles under the OS temp dir (for example `a11y-profile-rerun-<uuid>`) and remove them afterwards.
- The frontend stores only the theme preference in `localStorage` (`src/hooks/ThemeContext.tsx`).

---

## Project structure

```
.
├── .github/workflows/ci.yml
├── docs/                      # plan.md, a11y-plan.md, checklist.md, FEATURES.md, ARCHITECTURE.md, LINK_CHECKING.md, ACCESSIBILITY.md, DEVELOPMENT.md
├── public/                    # favicon.svg, icons.svg
├── download/                  # committed release DMG
├── index.html
├── vite.config.ts             # dev server, @ alias, __APP_VERSION__, outDir=build
├── vitest.config.ts
├── eslint.config.js  .prettierrc  tsconfig*.json  bun.lock  package.json
├── src/
│   ├── main.tsx  App.tsx  index.css     # App.tsx holds the react-router routes
│   ├── components/   # A11yIssuesList, ConfirmDialog, ErrorBoundary, LinkScanResults, LiveSummary,
│   │                 # Modal, ProgressBar, ResultsTable, Sidebar, TrendsChart, VirtualList
│   ├── hooks/        # RunContext, StoreContext, StoreProvider, ThemeContext, useHotkeys, useRun, useStore
│   ├── lib/          # tauri.ts (typed invoke wrappers), a11yReportHtml.ts (HTML report export)
│   ├── pages/        # TargetLists, CheckTemplates(+Detail), Audits, AuditDetail, QuickAudit,
│   │                 # RunHistory, RunDetail, RunDiff, LinkChecker, LinkCheckHistory, LinkCheckScan,
│   │                 # Accessibility, A11yReport, A11yReportDiff
│   ├── types/        # index.ts: TS mirrors of Rust models
│   ├── utils/        # a11yScore, a11yStandards, constants, csv, detectDuplicates, resolveUrl
│   └── __tests__/    # Vitest tests + setup.ts
└── src-tauri/
    ├── Cargo.toml  build.rs  tauri.conf.json
    ├── capabilities/default.json   # core, dialog (open/save/message), opener (url/path)
    ├── assets/axe.min.js           # bundled axe-core, embedded at compile time
    ├── icons/
    └── src/
        ├── main.rs          # calls app_lib::run()
        ├── lib.rs           # AppState, plugin setup, invoke_handler registration
        ├── models.rs        # serde models (camelCase)
        ├── storage.rs       # JSON persistence
        ├── checker.rs       # HTTP fetch + selector/status/regex/attribute/a11y/JS checks; run events
        ├── a11y.rs          # static accessibility rules
        ├── a11y_runner.rs   # a11y audit orchestration (static engine; dispatches axe-core)
        ├── a11y_browser.rs  # headless Chromium + axe-core
        └── commands/        # target_lists, check_templates, audits, runs, a11y
```

Generated or ignored: `build/` (Vite output), `dist/` (stale, ignored), `src-tauri/target/`, `src-tauri/gen/schemas`.

---

## Conventions

- **serde camelCase.** Rust structs and enums that cross the IPC boundary use `#[serde(rename_all = "camelCase")]` (`src-tauri/src/models.rs`). The TS interfaces in `src/types/index.ts` mirror them field for field. When you change a model, update both sides. Use `#[serde(default)]` on new fields so that existing `data.json` and history files still deserialize.
- **Typed invoke wrappers.** Components never call `invoke` directly. Every command has a wrapper in `src/lib/tauri.ts` (for example `invoke<TargetList[]>('list_target_lists')`), and arguments are passed in camelCase.
- **Adding a command:** write a `#[tauri::command]` fn in `src-tauri/src/commands/<area>.rs` → register it in `generate_handler![…]` in `src-tauri/src/lib.rs` → add a wrapper in `src/lib/tauri.ts` → add types in `src/types/index.ts`. If it needs a new plugin permission, add it to `capabilities/default.json`.
- **Errors.** Commands return `Result<T, String>` (`.map_err(|e| e.to_string())`). The frontend sees a rejected promise carrying the message.
- **Shared state.** `AppState` (`lib.rs`) holds `Mutex<AppData>`, `Storage`, `Checker` and `A11yRunner`. Mutations update the in-memory `AppData` and then persist it with `storage.save`.
- **Progress events.** Long runs stream through `app.emit`: `run:progress`, `run:result`, `run:complete` and `run:cancelled` (`checker.rs`); `a11y:progress`, `a11y:result`, `a11y:complete`, `a11y:cancelled` and `a11y:error` (`a11y_runner.rs`, `a11y_browser.rs`); and `linkcheck:*` (`commands/runs.rs`). The frontend subscribes with `listen` (`src/hooks/RunContext.tsx`, `src/pages/AccessibilityPage.tsx`, `src/pages/LinkCheckerPage.tsx`) and must call the returned unlisten functions.
- **Cancellation** uses a shared `Arc<AtomicBool>` that `cancel_run` and `cancel_a11y_run` set.
- **Imports** use the `@/` alias for `src/`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 5173 is already in use` | `strictPort` is on. Stop the other Vite process, or change both `server.port` in `vite.config.ts` and `build.devUrl` in `tauri.conf.json`. |
| `invoke` errors / `window.__TAURI_INTERNALS__` undefined | You opened `bun run dev` in a normal browser. Use `bun tauri dev`. |
| axe-core audit fails: "No Chromium-based browser found" | Install Chrome or Chromium, or `export A11Y_CHROME_PATH=/path/to/chrome` before `bun tauri dev`. |
| Linux build fails on `webkit2gtk` / `javascriptcoregtk` / `libsoup` | Install the apt packages listed in [Linux system libraries](#linux-system-libraries). |
| `vitest run --coverage` fails: missing dependency | `bun add -d @vitest/coverage-v8`. |
| CI `quality` job fails at `npm ci` | There is no `package-lock.json`. Migrate the job to bun (see [CI](#ci-githubworkflowsciyml)). |
| `tsc -b` uses stale incremental results | Delete `node_modules/.tmp/*.tsbuildinfo`. |
| Old data fails to load after a model change | A new non-optional field is missing `#[serde(default)]`. Note that `load_all_runs` and the history listings skip files that fail to parse without reporting it. |
| Window title shows the old version | Update `app.windows[0].title` in `tauri.conf.json`. |
