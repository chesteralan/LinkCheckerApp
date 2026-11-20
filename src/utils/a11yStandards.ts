const LABELS: Record<string, string> = {
  wcag20: 'WCAG 2.0',
  wcag21: 'WCAG 2.1',
  wcag22: 'WCAG 2.2',
  section508: 'Section 508',
  en301549: 'EN 301 549',
  bestpractice: 'Best practices',
}

export function standardLabel(value: string): string {
  return LABELS[value] ?? value
}

export function standardsLabel(standards: string[] | undefined): string {
  if (!standards || standards.length === 0) return 'All standards'
  return standards.map(standardLabel).join(', ')
}
