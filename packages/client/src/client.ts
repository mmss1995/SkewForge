import { DEPLOYMENT_HEADER, DEPLOYMENT_META, RUNTIME_PREFIX } from '@skewforge/core/protocol'
import type { VersionReason, VersionStatus } from '@skewforge/core'
import { isChunkLoadError, reloadOnce } from './chunk-errors'

export type Connection = 'connecting' | 'live' | 'polling' | 'offline' | 'disabled'

export interface SkewState {
  /** Deployment this tab is running, from the `<meta>` tag the gateway injects. */
  running: string | null
  current: string | null
  updateAvailable: boolean
  mandatory: boolean
  reason: VersionReason | null
  connection: Connection
  lastCheckedAt: number | null
}

/** What to do when the gateway says this tab must update (revoked or mandatory deployment). */
export type MandatoryStrategy = 'reload' | 'next-navigation' | 'manual'

export interface SkewClientOptions {
  /** Where the gateway's runtime endpoints live. */
  endpoint?: string
  /** Overrides the id read from `<meta name="skewforge-deployment">`. */
  deploymentId?: string | null
  /** `auto` streams over SSE and falls back to polling when streaming is unavailable. */
  transport?: 'auto' | 'poll'
  pollIntervalMs?: number
  /** Report this tab to the gateway so GC keeps its deployment; `false` disables. */
  beaconIntervalMs?: number | false
  /**
   * When an update is available, let the next same-origin link click (and back/forward) do a
   * full page load instead of a client-side transition. The user lands on the new version
   * exactly when they were leaving the page anyway, which is what Next.js does on Vercel.
   */
  hardNavigationOnUpdate?: boolean
  /** Reload once when a lazy chunk fails to load despite the gateway (e.g. it was GC'd). */
  recoverChunkErrors?: boolean
  onMandatory?: MandatoryStrategy
  /** Test seams. */
  fetch?: typeof fetch
  EventSource?: typeof EventSource | null
  window?: Window
  reload?: () => void
  navigate?: (href: string) => void
}

type Listener = (state: SkewState) => void

function readMetaDeployment(doc: Document | undefined): string | null {
  const content = doc?.querySelector(`meta[name="${DEPLOYMENT_META}"]`)?.getAttribute('content')
  if (content) return content
  const injected = (globalThis as { __SKEWFORGE_DEPLOYMENT__?: unknown }).__SKEWFORGE_DEPLOYMENT__
  return typeof injected === 'string' && injected !== '' ? injected : null
}

function randomSession(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Framework-agnostic runtime. Knows which deployment this tab runs, learns about new ones over
 * SSE (or polling), moves the user onto them at a safe moment, and reloads once if a chunk
 * still goes missing. `subscribe`/`getSnapshot` fit React's `useSyncExternalStore` directly.
 */
export class SkewClient {
  private state: SkewState
  private readonly listeners = new Set<Listener>()
  private readonly endpoint: string
  private readonly win: Window | undefined
  private readonly fetchImpl: typeof fetch
  private readonly EventSourceImpl: typeof EventSource | null
  private readonly session = randomSession()
  private readonly cleanups: (() => void)[] = []
  private source: EventSource | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private destroyed = false

  constructor(private readonly options: SkewClientOptions = {}) {
    this.win = options.window ?? (typeof window === 'undefined' ? undefined : window)
    this.endpoint = (options.endpoint ?? RUNTIME_PREFIX).replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args))
    this.EventSourceImpl = options.EventSource === undefined ? (typeof EventSource === 'undefined' ? null : EventSource) : options.EventSource
    const running = options.deploymentId === undefined ? readMetaDeployment(this.win?.document) : options.deploymentId
    this.state = { running, current: null, updateAvailable: false, mandatory: false, reason: null, connection: 'connecting', lastCheckedAt: null }
  }

  /** Starts watching. Separate from the constructor so SSR code can create a client safely. */
  start(): this {
    if (!this.win || this.destroyed) return this
    if (this.options.transport !== 'poll' && this.EventSourceImpl) this.openStream()
    else this.startPolling()
    this.installVisibility()
    if (this.options.beaconIntervalMs !== false && this.state.running) this.installBeacon(this.options.beaconIntervalMs ?? 60_000)
    if (this.options.hardNavigationOnUpdate !== false) this.installNavigationInterception()
    if (this.options.recoverChunkErrors !== false) this.installChunkRecovery()
    return this
  }

  getSnapshot = (): SkewState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Asks the gateway now. Resolves to null when it cannot be reached. */
  async check(): Promise<VersionStatus | null> {
    const running = this.state.running ? `?running=${encodeURIComponent(this.state.running)}` : ''
    try {
      const res = await this.fetchImpl(`${this.endpoint}/version${running}`, { cache: 'no-store' })
      if (res.status === 404) {
        // No gateway in front of this page (a Vite dev server, a plain static host): stay quiet.
        this.stopPolling()
        this.set({ connection: 'disabled' })
        return null
      }
      if (!res.ok) throw new Error(String(res.status))
      const status = (await res.json()) as VersionStatus
      this.apply(status, this.source ? 'live' : this.pollTimer ? 'polling' : this.state.connection)
      return status
    } catch {
      if (this.state.connection !== 'disabled') this.set({ connection: 'offline' })
      return null
    }
  }

  /** Full page load onto the current deployment. */
  reload(): void {
    ;(this.options.reload ?? (() => this.win?.location.reload()))()
  }

  /**
   * For programmatic navigation (router guards): if an update is waiting, performs a full
   * navigation to `href` and returns true, so the caller should cancel its client-side one.
   */
  hardNavigateIfUpdated(href: string): boolean {
    if (!this.state.updateAvailable || this.destroyed) return false
    ;(this.options.navigate ?? ((target: string) => this.win?.location.assign(target)))(href)
    return true
  }

  /** Headers that pin a `fetch` for a non-fingerprinted asset to this tab's deployment. */
  deploymentHeaders(): Record<string, string> {
    return this.state.running ? { [DEPLOYMENT_HEADER]: this.state.running } : {}
  }

  destroy(): void {
    this.destroyed = true
    this.source?.close()
    this.source = null
    this.stopPolling()
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.listeners.clear()
  }

  private set(patch: Partial<SkewState>): void {
    const next = { ...this.state, ...patch }
    if ((Object.keys(patch) as (keyof SkewState)[]).every((key) => next[key] === this.state[key])) return
    this.state = next
    for (const listener of this.listeners) listener(next)
  }

  private apply(status: VersionStatus, connection: Connection): void {
    const wasMandatory = this.state.mandatory
    this.set({
      current: status.current,
      updateAvailable: status.updateAvailable,
      mandatory: status.mandatory,
      reason: status.reason,
      connection,
      lastCheckedAt: Date.now(),
    })
    if (status.mandatory && !wasMandatory && (this.options.onMandatory ?? 'reload') === 'reload') this.reload()
  }

  private openStream(): void {
    const running = this.state.running ? `?running=${encodeURIComponent(this.state.running)}` : ''
    const source = new this.EventSourceImpl!(`${this.endpoint}/stream${running}`)
    this.source = source
    source.addEventListener('version', (event) => {
      this.apply(JSON.parse((event as MessageEvent<string>).data) as VersionStatus, 'live')
    })
    source.addEventListener('error', () => {
      // CLOSED means the server refused the stream (404, wrong content type): EventSource will not
      // retry on its own, so switch to polling. CONNECTING is a transient drop it will retry.
      if (source.readyState === 2) {
        source.close()
        if (this.source === source) this.source = null
        this.startPolling()
      } else {
        this.set({ connection: 'offline' })
      }
    })
  }

  private startPolling(): void {
    if (this.pollTimer || this.destroyed) return
    this.set({ connection: 'polling' })
    this.pollTimer = setInterval(() => void this.check(), this.options.pollIntervalMs ?? 60_000)
    void this.check()
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private listen<K extends keyof WindowEventMap>(target: Window | Document, type: K | string, handler: (event: Event) => void, capture = false) {
    target.addEventListener(type, handler, capture)
    this.cleanups.push(() => target.removeEventListener(type, handler, capture))
  }

  private installVisibility(): void {
    const doc = this.win!.document
    // Laptops wake from sleep with a dead stream and a stale answer; ask again on return.
    this.listen(doc, 'visibilitychange', () => {
      if (doc.visibilityState === 'visible' && this.state.connection !== 'disabled') void this.check()
    })
  }

  private installBeacon(intervalMs: number): void {
    const win = this.win!
    const send = (path: string, body: object) => {
      const url = `${this.endpoint}${path}`
      const payload = JSON.stringify(body)
      if (win.navigator.sendBeacon?.(url, payload)) return
      void this.fetchImpl(url, { method: 'POST', body: payload, headers: { 'content-type': 'text/plain' }, keepalive: true }).catch(() => undefined)
    }
    const beat = () => {
      if (win.document.visibilityState !== 'hidden' && this.state.connection !== 'disabled') {
        send('/beacon', { session: this.session, deployment: this.state.running })
      }
    }
    beat()
    const timer = setInterval(beat, intervalMs)
    this.cleanups.push(() => clearInterval(timer))
    this.listen(win, 'pagehide', () => send('/beacon/end', { session: this.session }))
  }

  private installNavigationInterception(): void {
    const win = this.win!
    this.listen(
      win,
      'click',
      (event) => {
        const click = event as MouseEvent
        if (!this.state.updateAvailable || click.defaultPrevented || click.button !== 0) return
        if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return
        const anchor = (click.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
        if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
        const url = new URL(anchor.href, win.location.href)
        if (url.origin !== win.location.origin) return
        if (url.pathname === win.location.pathname && url.search === win.location.search && url.hash) return
        // Capture phase on window runs before any router's delegated handler: stopping here
        // leaves the browser's default action, a real navigation, to load the new deployment.
        event.stopImmediatePropagation()
      },
      true,
    )
    this.listen(win, 'popstate', () => {
      if (this.state.updateAvailable) this.reload()
    })
  }

  private installChunkRecovery(): void {
    const win = this.win!
    const storage = (() => {
      try {
        return win.sessionStorage
      } catch {
        return null
      }
    })()
    const recover = (event: Event) => {
      if (reloadOnce(() => this.reload(), storage)) event.preventDefault()
    }
    // Vite fires this before rejecting a dynamic import whose preload failed. Preventing it would
    // make the import resolve to undefined, so let the rejection through and just reload.
    this.listen(win, 'vite:preloadError', () => void reloadOnce(() => this.reload(), storage))
    this.listen(win, 'unhandledrejection', (event) => {
      if (isChunkLoadError((event as PromiseRejectionEvent).reason)) recover(event)
    })
    this.listen(win, 'error', (event) => {
      if (isChunkLoadError((event as ErrorEvent).error ?? (event as ErrorEvent).message)) recover(event)
    })
  }
}

export function createSkewClient(options?: SkewClientOptions): SkewClient {
  return new SkewClient(options).start()
}
