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
] as const

export const HOTKEY_NAV: Record<string, string> = {
  '1': '/check-templates',
  '2': '/target-lists',
  '3': '/audits',
  '4': '/history',
  '5': '/link-checker',
}
