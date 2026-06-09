import type { TargetList, CheckTemplate } from '@/types'

export function findDuplicateLists(lists: TargetList[]): Map<string, string[]> {
  const byUrls = new Map<string, string[]>()
  for (const list of lists) {
    const key = [...list.urls].sort().join('\x00')
    if (!byUrls.has(key)) byUrls.set(key, [])
    byUrls.get(key)!.push(list.id)
  }
  const dupes = new Map<string, string[]>()
  for (const [, ids] of byUrls) {
    if (ids.length > 1) {
      for (const id of ids) dupes.set(id, ids.filter((i) => i !== id))
    }
  }
  return dupes
}

function checkKey(c: { selector: string; label: string; checkType: string; pattern?: string; attributeName?: string; attributeValue?: string; expectedStatus?: number }): string {
  return [c.selector, c.label, c.checkType, c.pattern ?? '', c.attributeName ?? '', c.attributeValue ?? '', c.expectedStatus ?? ''].join('\x00')
}

export function findDuplicateTemplates(templates: CheckTemplate[]): Map<string, string[]> {
  const byChecks = new Map<string, string[]>()
  for (const t of templates) {
    const key = [...t.checks].sort((a, b) => a.selector.localeCompare(b.selector)).map(checkKey).join('\x00')
    if (!byChecks.has(key)) byChecks.set(key, [])
    byChecks.get(key)!.push(t.id)
  }
  const dupes = new Map<string, string[]>()
  for (const [, ids] of byChecks) {
    if (ids.length > 1) {
      for (const id of ids) dupes.set(id, ids.filter((i) => i !== id))
    }
  }
  return dupes
}
