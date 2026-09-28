import { describe, expect, it } from 'vitest'
import { fakeDeployment, fakeHistory } from './testing'
import { emptyRegistry } from './types'
import { versionStatus } from './version'

const d = (id: string, overrides = {}) => fakeDeployment(id, ['index.html'], overrides)

describe('versionStatus', () => {
  it('has nothing to say before the first deploy', () => {
    expect(versionStatus(emptyRegistry(), 'v1')).toMatchObject({ updateAvailable: false, reason: 'none' })
  })

  it('reports up to date for the current deployment and unknown callers', () => {
    const registry = fakeHistory(d('v1'), d('v2'))
    expect(versionStatus(registry, 'v2')).toMatchObject({ updateAvailable: false, reason: 'up-to-date' })
    expect(versionStatus(registry, null)).toMatchObject({ updateAvailable: false, reason: 'up-to-date' })
  })

  it('offers an optional update to older clients', () => {
    expect(versionStatus(fakeHistory(d('v1'), d('v2')), 'v1')).toEqual({ current: 'v2', running: 'v1', updateAvailable: true, mandatory: false, reason: 'update' })
  })

  it('forces a reload when a later deployment is mandatory, even if not current', () => {
    const registry = fakeHistory(d('v1'), d('v2', { mandatory: true }), d('v3'))
    expect(versionStatus(registry, 'v1')).toMatchObject({ mandatory: true, reason: 'mandatory' })
    expect(versionStatus(registry, 'v2')).toMatchObject({ mandatory: false, reason: 'update' })
  })

  it('forces a reload for revoked and garbage-collected deployments', () => {
    const registry = fakeHistory(d('v1'), d('v2', { revoked: true }), d('v3'))
    expect(versionStatus(registry, 'v2')).toMatchObject({ mandatory: true, reason: 'revoked' })
    expect(versionStatus(registry, 'v0')).toMatchObject({ mandatory: true, reason: 'unknown' })
  })

  it('leaves preview sessions alone', () => {
    const registry = fakeHistory(d('v1'))
    registry.deployments.push(d('v2-staged', { createdAt: 5000 }))
    expect(versionStatus(registry, 'v2-staged')).toMatchObject({ updateAvailable: false, reason: 'preview' })
  })

  it('measures mandatory updates from the last time the client was current', () => {
    // v1 → v2 (mandatory) → rollback to v1 → v3: a v1 client only missed v3.
    const registry = fakeHistory(d('v1'), d('v2', { mandatory: true }), d('v3'))
    registry.promotions.splice(2, 0, { id: 'v1', at: 2500, reason: 'rollback' })
    expect(versionStatus(registry, 'v1')).toMatchObject({ mandatory: false, reason: 'update' })
  })
})
