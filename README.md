# Link Checker

A desktop tool that checks web pages against user-defined CSS selector assertions. Create **Target Lists** (collections of URLs) and **Check Templates** (CSS selectors to verify), then bind them into an **Audit** to run sequential or batch checks on all pages.

Built with [Tauri](https://tauri.app) + [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org) + [Tailwind CSS v4](https://tailwindcss.com).

## Quick start

```bash
npm install
npm run tauri dev
```

## How it works

1. **Target Lists** — named collections of URLs (one per line, protocol optional)
2. **Check Templates** — named collections of CSS selectors with labels (e.g. `.login-form` → "Login form exists")
3. **Audits** — bind a Target List + Check Template, configure mode (sequential or batch), then run

Results show per-URL: HTTP status, response time, page title, and whether each selector matched (with count and text content).

## Development

```bash
npm run dev          # Vite dev server
npm run tauri dev    # Full Tauri app with hot reload
npm run build        # TypeScript check + Vite build
npm run tauri build  # Production bundle
```

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
