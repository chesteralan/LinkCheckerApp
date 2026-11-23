import { openUrl } from '@tauri-apps/plugin-opener'
import { safeHref } from '@/lib/a11yReportHtml'

/**
 * Open a URL in the system browser, but only when it is an absolute http(s) URL.
 *
 * Page URLs and help links come from audited pages, so anything else (`javascript:`, `file:`,
 * `data:`...) is ignored rather than handed to the OS opener.
 */
export function openExternal(url: string | null | undefined): void {
  const href = safeHref(url)
  if (!href) return
  openUrl(href).catch(() => {})
}
