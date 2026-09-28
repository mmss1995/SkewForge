import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkewClient, type SkewClientOptions } from './client'
import { isChunkLoadError } from './chunk-errors'
import { FakeEventSource, status } from './testing'

let client: SkewClient | undefined
const reload = vi.fn<() => void>()
const navigate = vi.fn<(href: string) => void>()

function make(options: SkewClientOptions = {}) {
  client = new SkewClient({
    EventSource: FakeEventSource as unknown as typeof EventSource,
    fetch: vi.fn<typeof fetch>(async () => new Response('{}', { status: 404 })),
    reload,
    navigate,
    beaconIntervalMs: false,
    ...options,
  }).start()
  return client
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="skewforge-deployment" content="v1">'
  document.body.innerHTML = ''
  sessionStorage.clear()
  FakeEventSource.reset()
  reload.mockReset()
  navigate.mockReset()
})
afterEach(() => client?.destroy())

describe('state', () => {
  it('reads the running deployment from the injected meta tag and opens a stream for it', () => {
    make()
    expect(client!.getSnapshot()).toMatchObject({ running: 'v1', connection: 'connecting', updateAvailable: false })
    expect(FakeEventSource.instances[0]!.url).toBe('/__skewforge/stream?running=v1')
  })

  it('applies streamed status and notifies subscribers once per change', () => {
    make()
    const listener = vi.fn()
    client!.subscribe(listener)
    FakeEventSource.instances[0]!.push(status())
    FakeEventSource.instances[0]!.push(status())
    expect(listener).toHaveBeenCalledTimes(1)
    expect(client!.getSnapshot()).toMatchObject({ current: 'v2', updateAvailable: true, connection: 'live', reason: 'update' })
  })

  it('reloads on a mandatory update unless told to wait', () => {
    make()
    FakeEventSource.instances[0]!.push(status({ mandatory: true, reason: 'revoked' }))
    expect(reload).toHaveBeenCalledTimes(1)
    client!.destroy()
    reload.mockReset()
    make({ onMandatory: 'manual' })
    FakeEventSource.instances[0]!.push(status({ mandatory: true }))
    expect(reload).not.toHaveBeenCalled()
  })

  it('falls back to polling when the stream is refused, and goes quiet without a gateway', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(status()))
    make({ fetch: fetchMock })
    FakeEventSource.instances[0]!.fail(2)
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
    await vi.waitFor(() => expect(client!.getSnapshot()).toMatchObject({ connection: 'polling', updateAvailable: true }))
    expect(fetchMock).toHaveBeenCalledWith('/__skewforge/version?running=v1', { cache: 'no-store' })

    client!.destroy()
    make({ transport: 'poll' })
    await vi.waitFor(() => expect(client!.getSnapshot().connection).toBe('disabled'))
  })

  it('marks transient stream drops as offline', () => {
    make()
    FakeEventSource.instances[0]!.fail(0)
    expect(client!.getSnapshot().connection).toBe('offline')
  })

  it('pins fetches to the running deployment', () => {
    expect(make().deploymentHeaders()).toEqual({ 'x-skewforge-deployment': 'v1' })
  })
})

describe('navigation', () => {
  function link(href: string, attrs: Record<string, string> = {}) {
    const anchor = document.createElement('a')
    anchor.href = href
    for (const [key, value] of Object.entries(attrs)) anchor.setAttribute(key, value)
    document.body.append(anchor)
    return anchor
  }

  function routerSpy() {
    // Stands in for React Router / Vue Router: a delegated click handler that prevents the default.
    const handled = vi.fn((event: Event) => event.preventDefault())
    document.addEventListener('click', handled)
    return { handled, dispose: () => document.removeEventListener('click', handled) }
  }

  it('lets the router handle clicks while up to date', () => {
    make()
    const router = routerSpy()
    link('/about').click()
    expect(router.handled).toHaveBeenCalledTimes(1)
    router.dispose()
  })

  it('turns the next same-origin link click into a full navigation once an update is waiting', () => {
    make()
    FakeEventSource.instances[0]!.push(status())
    const router = routerSpy()
    link('/about').click()
    expect(router.handled).not.toHaveBeenCalled()

    link('https://elsewhere.example/').click()
    link('/about', { target: '_blank' }).click()
    link('/file.pdf', { download: '' }).click()
    link('#section').click()
    link('/about').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    expect(router.handled).toHaveBeenCalledTimes(5)
    router.dispose()
  })

  it('reloads on back/forward once an update is waiting', () => {
    make()
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(reload).not.toHaveBeenCalled()
    FakeEventSource.instances[0]!.push(status())
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('offers a guard for programmatic navigation', () => {
    make()
    expect(client!.hardNavigateIfUpdated('/cart')).toBe(false)
    FakeEventSource.instances[0]!.push(status())
    expect(client!.hardNavigateIfUpdated('/cart')).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/cart')
  })

  it('stops intercepting after destroy', () => {
    make()
    FakeEventSource.instances[0]!.push(status())
    client!.destroy()
    const router = routerSpy()
    link('/about').click()
    expect(router.handled).toHaveBeenCalledTimes(1)
    router.dispose()
  })
})

describe('chunk error recovery', () => {
  function rejection(reason: unknown) {
    const event = new Event('unhandledrejection', { cancelable: true })
    Object.defineProperty(event, 'reason', { value: reason })
    window.dispatchEvent(event)
    return event
  }

  it('reloads once on a missing chunk, never in a loop', () => {
    make()
    const first = rejection(new TypeError('Failed to fetch dynamically imported module: https://app/assets/About-x.js'))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(first.defaultPrevented).toBe(true)
    rejection(new TypeError('Failed to fetch dynamically imported module: https://app/assets/About-x.js'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('handles vite:preloadError and ignores unrelated rejections', () => {
    make()
    rejection(new Error('network down'))
    expect(reload).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it.each([
    'Failed to fetch dynamically imported module: /a.js',
    'error loading dynamically imported module: /a.js',
    'Importing a module script failed.',
    'Loading chunk 123 failed.',
    'Loading CSS chunk app-about failed.',
    'Unable to preload CSS for /assets/a.css',
    'Failed to load chunk /_next/static/chunks/a.js from module 1',
  ])('recognises "%s"', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true)
  })

  it('recognises webpack ChunkLoadError by name and rejects the rest', () => {
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('beacon', () => {
  it('reports the running deployment and ends the session on pagehide', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    make({ fetch: fetchMock, beaconIntervalMs: 60_000 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/__skewforge/beacon')
    expect(JSON.parse(String(init!.body))).toMatchObject({ deployment: 'v1', session: expect.stringMatching(/^[a-f0-9]{24}$/) })
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/__skewforge/beacon/end')
  })
})
