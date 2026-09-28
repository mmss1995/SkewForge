import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SkewClient } from '@skewforge/client'
import { SkewProvider, UpdateBanner, useSkew } from './index'

class FakeEventSource extends EventTarget {
  static last: FakeEventSource | null = null
  readyState = 0
  constructor(readonly url: string) {
    super()
    FakeEventSource.last = this
  }
  push(data: object) {
    this.dispatchEvent(Object.assign(new Event('version'), { data: JSON.stringify(data) }))
  }
  close() {}
}

function makeClient(reload = vi.fn<() => void>()) {
  return new SkewClient({
    deploymentId: 'v1',
    EventSource: FakeEventSource as unknown as typeof EventSource,
    fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })),
    beaconIntervalMs: false,
    reload,
  }).start()
}

const update = { current: 'v2', running: 'v1', updateAvailable: true, mandatory: false, reason: 'update' }

function Status() {
  const { running, current, connection } = useSkew()
  return <p>{`${running}→${current ?? '?'} (${connection})`}</p>
}

describe('React bindings', () => {
  it('re-renders on status changes and shows the banner only when an update is waiting', () => {
    const reload = vi.fn<() => void>()
    const client = makeClient(reload)
    render(
      <SkewProvider client={client}>
        <Status />
        <UpdateBanner className="banner" />
      </SkewProvider>,
    )
    expect(screen.getByText('v1→? (connecting)')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()

    act(() => FakeEventSource.last!.push(update))
    expect(screen.getByText('v1→v2 (live)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    client.destroy()
  })

  it('supports a render function for custom banners', () => {
    const client = makeClient()
    render(
      <SkewProvider client={client}>
        <UpdateBanner>{(skew) => <strong>{`Version ${skew.current} is out`}</strong>}</UpdateBanner>
      </SkewProvider>,
    )
    act(() => FakeEventSource.last!.push(update))
    expect(screen.getByText('Version v2 is out')).toBeTruthy()
    client.destroy()
  })

  it('creates, starts and destroys its own client from options', () => {
    const { unmount } = render(
      <SkewProvider options={{ deploymentId: 'v9', EventSource: FakeEventSource as unknown as typeof EventSource, beaconIntervalMs: false }}>
        <Status />
      </SkewProvider>,
    )
    expect(FakeEventSource.last!.url).toBe('/__skewforge/stream?running=v9')
    unmount()
  })

  it('explains a missing provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Status />)).toThrow(/inside <SkewProvider>/)
  })
})
