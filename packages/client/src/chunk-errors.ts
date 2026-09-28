// What each bundler and browser says when a lazily loaded chunk is gone.
const PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium + Vite/Rollup
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite CSS preload
  /Loading (CSS )?chunk [\w-]+ failed/i, // webpack / Next.js
  /Failed to load chunk/i, // Turbopack
]

/** True when `error` means "the file this code asked for no longer exists on the server". */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && 'name' in error && (error as { name: unknown }).name === 'ChunkLoadError') return true
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? '')
  return PATTERNS.some((pattern) => pattern.test(message))
}

const GUARD_KEY = 'skewforge:recovered-at'

/**
 * Reloads the page once to pick up the current deployment, unless we already did so moments
 * ago: a chunk that is missing right after a fresh load is a real outage, and reloading again
 * would loop forever. Returns whether a reload was triggered.
 */
export function reloadOnce(reload: () => void, storage: Pick<Storage, 'getItem' | 'setItem'> | null, now = Date.now(), windowMs = 10_000): boolean {
  try {
    const last = Number(storage?.getItem(GUARD_KEY) ?? 0)
    if (now - last < windowMs) return false
    storage?.setItem(GUARD_KEY, String(now))
  } catch {
    // Storage can throw (privacy modes); recovering without a guard is still better than crashing.
  }
  reload()
  return true
}
