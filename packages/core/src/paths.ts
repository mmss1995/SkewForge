/**
 * Turns a URL pathname into the key a deployment manifest uses: percent-decoded, no leading or
 * trailing slash, no empty segments. Returns null for anything that could escape the deployment
 * (`..`, `.`, backslashes, NUL bytes) so callers can answer 400 without touching storage.
 */
export function normalizeAssetPath(pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const segments = decoded.split('/').filter((segment) => segment !== '')
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  return segments.join('/')
}

/** Extension of a manifest path, lower-cased and without the dot ('' when there is none). */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  pdf: 'application/pdf',
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? 'application/octet-stream'
}

// `index-B3kq1_Za.js`, `app.4f3c1a2b.css`, `page-4f3c1a2b9d0e.js`: a separator, then 8+ hash
// characters, then the extension.
const FINGERPRINT = /[.-]([A-Za-z0-9_-]{8,})\.[A-Za-z0-9]+$/

/**
 * Whether a file name carries a content hash, which makes it safe to cache forever. A plain word
 * such as `registry` is not a hash, so the segment must contain a digit or an upper-case letter.
 */
export function isFingerprinted(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const match = FINGERPRINT.exec(name)
  if (!match?.[1]) return false
  return /[0-9A-Z]/.test(match[1])
}

/** True for paths that look like page routes rather than files (`about`, `users/42`). */
export function looksLikeRoute(path: string): boolean {
  return extensionOf(path) === '' || extensionOf(path) === 'html' || extensionOf(path) === 'htm'
}
