export function resolveUrl(href: string, source: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href
  try {
    const origin = new URL(source).origin
    const joined = href.startsWith('/') ? `${origin}${href}` : `${origin}/${href}`
    return joined
  } catch {
    return href
  }
}
