import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, V1, V2, type Harness } from '../test/harness'
import { injectDeploymentMeta } from './edge'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.cleanup())

describe('documents', () => {
  it('answers 503 until something is live', async () => {
    const res = await h.edge().get('/').set('accept', 'text/html')
    expect(res.status).toBe(503)
  })

  it('serves the current entry with the deployment id injected, for any route', async () => {
    await h.deploy('v1', V1)
    for (const path of ['/', '/index.html', '/products/42']) {
      const res = await h.edge().get(path).set('accept', 'text/html')
      expect(res.status).toBe(200)
      expect(res.text).toContain('<meta name="skewforge-deployment" content="v1">')
      expect(res.headers['cache-control']).toBe('no-cache')
      expect(res.headers['x-skewforge-served-by']).toBe('v1')
    }
  })

  it('does not fall back to HTML for missing files or JSON requests', async () => {
    await h.deploy('v1', V1)
    expect((await h.edge().get('/assets/gone-ZZZZ9999.js')).status).toBe(404)
    expect((await h.edge().get('/api/users').set('accept', 'application/json')).status).toBe(404)
  })

  it('rejects traversal attempts', async () => {
    await h.deploy('v1', V1)
    expect((await h.edge().get('/assets/%2e%2e/%2e%2e/registry.json')).status).toBe(400)
  })
})

describe('version skew', () => {
  it('keeps serving the chunks an old tab asks for after a new deploy', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2)

    const old = await h.edge().get('/assets/About-AAAA1111.js')
    expect(old.status).toBe(200)
    expect(old.text).toBe('export default "about v1"')
    expect(old.headers['x-skewforge-served-by']).toBe('v1')
    expect(old.headers['x-skewforge-resolution']).toBe('fallback')
    expect(old.headers['cache-control']).toContain('immutable')

    const fresh = await h.edge().get('/')
    expect(fresh.text).toContain('content="v2"')

    const telemetry = h.gateway.telemetry.snapshot()
    expect(telemetry.totals.rescued).toBe(1)
    expect(telemetry.recentRescues[0]).toMatchObject({ path: 'assets/About-AAAA1111.js', deployment: 'v1' })
  })

  it('resolves non-fingerprinted files from the importing module', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2)
    const host = '127.0.0.1'
    const fromOld = await h.edge().get('/remoteEntry.js').set('host', host).set('referer', `http://${host}/assets/index-AAAA1111.js`)
    expect(fromOld.text).toBe('export const version = 1')
    expect(fromOld.headers['cache-control']).toBe('no-cache')

    const fromNew = await h.edge().get('/remoteEntry.js').set('host', host).set('referer', `http://${host}/assets/index-BBBB2222.js`)
    expect(fromNew.text).toBe('export const version = 2')

    const crossSite = await h.edge().get('/remoteEntry.js').set('host', host).set('referer', 'https://evil.example/assets/index-AAAA1111.js')
    expect(crossSite.text).toBe('export const version = 2')
  })

  it('honours ?dpl= and the deployment header', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2)
    expect((await h.edge().get('/remoteEntry.js?dpl=v1')).text).toBe('export const version = 1')
    expect((await h.edge().get('/remoteEntry.js').set('x-skewforge-deployment', 'v1')).text).toBe('export const version = 1')
  })

  it('answers conditional requests with 304', async () => {
    await h.deploy('v1', V1)
    const first = await h.edge().get('/remoteEntry.js')
    const second = await h.edge().get('/remoteEntry.js').set('if-none-match', first.headers.etag!)
    expect(second.status).toBe(304)
  })

  it('counts files nobody can serve any more', async () => {
    await h.deploy('v1', V1)
    await h.edge().get('/assets/About-00000000.js')
    expect(h.gateway.telemetry.snapshot().totals.misses).toBe(1)
  })
})

describe('staged deployments and previews', () => {
  it('hides staged builds from the public, even when pinned', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2, { promote: false })
    expect((await h.edge().get('/assets/About-BBBB2222.js')).status).toBe(404)
    expect((await h.edge().get('/remoteEntry.js?dpl=v2')).text).toBe('export const version = 1')
    expect((await h.edge().get('/')).text).toContain('content="v1"')
  })

  it('shows a staged build to a browser that opened its signed preview link', async () => {
    await h.deploy('v1', V1)
    const created = await h.deploy('v2', V2, { promote: false })
    const previewUrl: string = created.body.previewUrl
    expect(previewUrl).toMatch(/^\/__skewforge\/preview\/v2\?sig=/)

    expect((await h.edge().get('/__skewforge/preview/v2?sig=forged')).status).toBe(403)

    const agent = (await import('supertest')).default.agent(h.gateway.edge)
    const entered = await agent.get(previewUrl)
    expect(entered.status).toBe(302)
    const page = await agent.get('/')
    expect(page.text).toContain('content="v2"')
    expect(page.headers['cache-control']).toBe('private, no-store')
    expect((await agent.get('/remoteEntry.js')).text).toBe('export const version = 2')

    await agent.get('/__skewforge/exit-preview')
    expect((await agent.get('/')).text).toContain('content="v1"')
  })
})

describe('runtime endpoints', () => {
  it('reports version status for the running deployment', async () => {
    await h.deploy('v1', V1)
    await h.deploy('v2', V2)
    const res = await h.edge().get('/__skewforge/version?running=v1')
    expect(res.body).toEqual({ current: 'v2', running: 'v1', updateAvailable: true, mandatory: false, reason: 'update' })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('records beacons for known deployments only', async () => {
    await h.deploy('v1', V1)
    await h.edge().post('/__skewforge/beacon').set('content-type', 'text/plain').send(JSON.stringify({ session: 'tab-aaaaaaaa', deployment: 'v1' }))
    await h.edge().post('/__skewforge/beacon').send({ session: 'tab-bbbbbbbb', deployment: 'nope' })
    expect(Object.fromEntries(h.gateway.sessions.counts())).toEqual({ v1: 1 })
    await h.edge().post('/__skewforge/beacon/end').send({ session: 'tab-aaaaaaaa' })
    expect(h.gateway.sessions.counts().size).toBe(0)
  })

  it('rejects malformed beacons', async () => {
    const res = await h.edge().post('/__skewforge/beacon').send({ session: 'x', deployment: 'v1' })
    expect(res.status).toBe(400)
  })
})

describe('injectDeploymentMeta', () => {
  it('adds the tag after <head>, rewrites an existing one, or prepends', () => {
    expect(injectDeploymentMeta('<html><head lang="en"><title/></head>', 'a')).toBe('<html><head lang="en"><meta name="skewforge-deployment" content="a"><title/></head>')
    expect(injectDeploymentMeta('<head><meta name="skewforge-deployment" content="old"></head>', 'b')).toBe('<head><meta name="skewforge-deployment" content="b"></head>')
    expect(injectDeploymentMeta('<p>hi</p>', 'c')).toBe('<meta name="skewforge-deployment" content="c"><p>hi</p>')
  })
})
