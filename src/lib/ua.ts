export function parseDevice(ua: string): string {
  if (/tablet|ipad/i.test(ua)) return 'tablet'
  if (/mobile|iphone|android.*mobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function parseBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return 'Edge'
  if (/chrome|crios/i.test(ua)) return 'Chrome'
  if (/firefox|fxios/i.test(ua)) return 'Firefox'
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari'
  if (/opera|opr\//i.test(ua)) return 'Opera'
  return 'Other'
}

export function parseOS(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows'
  if (/macintosh|mac os/i.test(ua)) return 'macOS'
  if (/linux/i.test(ua) && !/android/i.test(ua)) return 'Linux'
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS'
  return 'Other'
}
