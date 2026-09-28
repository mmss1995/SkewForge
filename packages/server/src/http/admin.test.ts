import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, sha256, V1, V2, type Harness } from '../test/harness'

let h: Harness
beforeEach(async () => {
  h = await createHarness({ retention: { keepLast: 1, minAgeMs: 60_000, protectActiveSessions: true } })
})
afterEach(() => h.cleanup())

const DAY = 86_400_000

describe('auth', () => {
  it('requires the admin token on every API route', async () => {
    expect((await request(h.gateway.admin).get('/api/deployments')).status).toBe(401)
    expect((await request(h.gateway.admin).get('/api/deployments').set('authorization', 'Bearer wrong')).status).toBe(401)
    expect((await request(h.gateway.admin).get('/health')).status).toBe(200)
  })
})

describe('uploads', () => {
  it('stores blobs content-addressed and reports what is missing', async () => {
    const body = 'console.log(1)'
    const hash = sha256(body)
    expect((await h.admin().post('/api/blobs/missing').send({ hashes: [hash, hash] })).body).toEqual({ missing: [hash] })
    expect((await h.admin().put(`/api/blobs/${hash}`).send(Buffer.from(body))).status).toBe(201)
    expect((await h.admin().put(`/api/blobs/${hash}`).send(Buffer.from(body))).body).toMatchObject({ stored: false })
    expect((await h.admin().post('/api/blobs/missing').send({ hashes: [hash] })).body).toEqual({ missing: [] })
  })

  it('rejects content that does not match its hash', async () => {
    const res = await h.admin().put(`/api/blobs/${sha256('a')}`).send(Buffer.from('b'))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/hashes to/)
  })

  it('rejects oversized blobs', async () => {
    const small = await createHarness({ maxBlobBytes: 16 })
    const big = 'x'.repeat(17)
    expect((await small.admin().put(`/api/blobs/${sha256(big)}`).send(Buffer.from(big))).status).toBe(413)
    await small.cleanup()
  })

  it('refuses deployments whose blobs were not uploaded', async () => {
    const res = await h.admin()
      .post('/api/deployments')
      .send({ id: 'v1', files: { 'index.html': { hash: sha256('nope'), size: 4, type: 'text/html', immutable: false } } })
    expect(res.status).toBe(422)
    expect(res.body.missing).toEqual([sha256('nope')])
  })

  it('refuses duplicate deployment ids', async () => {
    await h.deploy('v1', V1)
    expect((await h.deploy('v1', V1)).status).toBe(409)
  })

  it('counts only bytes the deploy actually added', async () => {
    await h.deploy('v1', V1)
    const second = await h.deploy('v2', V2)
    const shared = Buffer.byteLength(V2['assets/vendor-SHARED00.js'])
    const total = Object.values(V2).reduce((sum, content) => sum + Buffer.byteLength(content), 0)
    expect(second.body).toMatchObject({ totalBytes: total, newBytes: total - shared, fileCount: 5 })
  })

  it('persists the registry across restarts', async () => {
    await h.deploy('v1', V1)
    const saved = JSON.parse(await readFile(join(h.dataDir, 'registry.json'), 'utf8'))
    expect(saved.current).toBe('v1')
  })
})

describe('promotion and rollback', () => {
  it('promotes staged deployments and records why', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2, { promote: false })
    expect(h.gateway.service.current()).toBe('v1')
    const res = await h.admin().post('/api/deployments/v2/promote').send({ mandatory: true })
    expect(res.body).toMatchObject({ id: 'v2', current: true, mandatory: true })
    expect(h.gateway.service.promotions().map((promotion) => promotion.reason)).toEqual(['promote', 'deploy'])
    expect((await h.edge().get('/__skewforge/version?running=v1')).body).toMatchObject({ mandatory: true })
  })

  it('rolls back to the previous deployment and revokes the bad one', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2)
    const res = await h.admin().post('/api/rollback').send({})
    expect(res.body).toMatchObject({ id: 'v1', current: true })
    expect((await h.edge().get('/')).text).toContain('content="v1"')
    expect((await h.edge().get('/__skewforge/version?running=v2')).body).toMatchObject({ mandatory: true, reason: 'revoked' })
    // Promoting it again un-revokes it.
    await h.admin().post('/api/deployments/v2/promote').send({})
    expect((await h.edge().get('/__skewforge/version?running=v2')).body).toMatchObject({ reason: 'up-to-date' })
  })

  it('explains why a rollback is impossible', async () => {
    expect((await h.admin().post('/api/rollback').send({})).status).toBe(409)
    await h.deploy('v1', V1)
    expect((await h.admin().post('/api/rollback').send({})).body.error).toMatch(/no earlier deployment/)
  })

  it('will not delete or revoke the current deployment', async () => {
    await h.deploy('v1', V1)
    expect((await h.admin().delete('/api/deployments/v1')).status).toBe(409)
    expect((await h.admin().patch('/api/deployments/v1').send({ revoked: true })).status).toBe(409)
  })
})

describe('garbage collection', () => {
  it('previews, then deletes expired deployments and their unshared blobs', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2)
    h.clock.now += DAY

    const preview = await h.admin().post('/api/gc?dryRun=1')
    expect(preview.body).toMatchObject({ dryRun: true, removedDeployments: ['v1'] })
    expect(h.gateway.service.list()).toHaveLength(2)

    const orphanGrace = 60 * 60 * 1000
    h.clock.now += orphanGrace
    const res = await h.admin().post('/api/gc')
    expect(res.body).toMatchObject({ dryRun: false, removedDeployments: ['v1'], removedBlobs: 4 })

    expect((await h.edge().get('/assets/About-AAAA1111.js')).status).toBe(404)
    // The shared vendor chunk is still referenced by v2.
    expect((await h.edge().get('/assets/vendor-SHARED00.js')).status).toBe(200)
  })

  it('keeps deployments that still have live tabs', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2)
    h.clock.now += DAY
    h.gateway.sessions.touch('tab-aaaaaaaa', 'v1', h.clock.now)
    const res = await h.admin().post('/api/gc')
    expect(res.body.removedDeployments).toEqual([])
    expect(res.body.decisions).toContainEqual({ id: 'v1', keep: true, reason: 'active-sessions', activeSessions: 1 })
  })
})

describe('overview', () => {
  it('aggregates everything the dashboard shows', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2)
    await h.edge().get('/assets/About-AAAA1111.js')
    const res = await h.admin().get('/api/overview')
    expect(res.body).toMatchObject({
      current: 'v2',
      deployments: [{ id: 'v2', current: true }, { id: 'v1', current: false }],
      storage: { blobs: 9 },
      liveStreams: 0,
      telemetry: { totals: { rescued: 1 } },
    })
    expect(res.body.deployments[0].files).toBeUndefined()
    expect(res.body.telemetry.timeline).toHaveLength(60)
  })
})
