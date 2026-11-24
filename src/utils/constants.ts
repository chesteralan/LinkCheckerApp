export const DEFAULTS = {
  batchSize: 5,
  timeoutSecs: 10,
  mode: 'batch' as const,
}

export const MODE_LABELS = {
  sequential: 'Sequential (1 at a time)',
  batch: 'Batch (configurable concurrency)',
} as const

export const NAV_ITEMS = [
  { to: '/check-templates', label: 'Check Templates' },
  { to: '/target-lists', label: 'Target Lists' },
  { to: '/audits', label: 'Audits' },
  { to: '/history', label: 'Run History' },
  { to: '/link-checker', label: 'Link Checker' },
  { to: '/accessibility', label: 'Accessibility' },
] as const

export const HOTKEY_NAV: Record<string, string> = {
  '1': '/check-templates',
  '2': '/target-lists',
  '3': '/audits',
  '4': '/history',
  '5': '/link-checker',
  '6': '/accessibility',
}

/** Accessibility rule categories (backend `a11yConfig.categories`; an empty list means all). */
export const A11Y_CATEGORIES: { value: string; label: string }[] = [
  { value: 'document', label: 'Document' },
  { value: 'headings', label: 'Headings' },
  { value: 'landmarks', label: 'Landmarks' },
  { value: 'aria', label: 'ARIA' },
  { value: 'interactive', label: 'Interactive' },
  { value: 'media', label: 'Media' },
  { value: 'tables', label: 'Tables' },
  { value: 'forms', label: 'Forms' },
]

/** Accessibility standards (backend `a11yConfig.standards`; an empty list means all). */
export const A11Y_STANDARDS: { value: string; label: string }[] = [
  { value: 'wcag20', label: 'WCAG 2.0' },
  { value: 'wcag21', label: 'WCAG 2.1' },
  { value: 'wcag22', label: 'WCAG 2.2' },
  { value: 'section508', label: 'Section 508' },
  { value: 'en301549', label: 'EN 301 549' },
  { value: 'bestpractice', label: 'Best practices' },
]

/** Minimum severity options for accessibility checks. */
export const A11Y_SEVERITIES = [
  { value: 'minor', label: 'All issues' },
  { value: 'moderate', label: 'Moderate and above' },
  { value: 'serious', label: 'Serious and above' },
  { value: 'critical', label: 'Critical only' },
] as const

/**
 * Toggle one category in an `a11yConfig.categories` list where `[]` means "all".
 *
 * Returns the new list, or null when the change would leave no category selected (which would
 * silently mean "all" again). Selecting every category collapses back to `[]`.
 */
export function toggleA11yCategory(categories: string[], value: string, checked: boolean): string[] | null {
  const all = A11Y_CATEGORIES.map((c) => c.value)
  const base = categories.length === 0 ? all : categories
  const next = checked ? all.filter((c) => c === value || base.includes(c)) : base.filter((c) => c !== value)
  if (next.length === 0) return null
  return next.length === all.length ? [] : next
}
