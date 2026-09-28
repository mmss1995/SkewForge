import type { VersionStatus } from '@skewforge/core'

/** Minimal EventSource double: tests push `version` events and errors by hand. */
export class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []
  static reset() {
    FakeEventSource.instances = []
  }
  readyState = 0
  closed = false
  constructor(readonly url: string) {
    super()
    FakeEventSource.instances.push(this)
  }
  push(status: VersionStatus) {
    this.readyState = 1
    this.dispatchEvent(Object.assign(new Event('version'), { data: JSON.stringify(status) }))
  }
  fail(readyState: 0 | 2) {
    this.readyState = readyState
    this.dispatchEvent(new Event('error'))
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
}

export const status = (overrides: Partial<VersionStatus> = {}): VersionStatus => ({
  current: 'v2',
  running: 'v1',
  updateAvailable: true,
  mandatory: false,
  reason: 'update',
  ...overrides,
})
