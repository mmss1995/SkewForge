import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_RETENTION } from '@skewforge/core'
import { createGateway, type Gateway } from '@skewforge/server/app'
import { run } from './cli'
import { scanBuild } from './manifest'

const TOKEN = 'cli-test-token-1234'
let root: string
let gateway: Gateway
let adminServer: Server
let edgeServer: Server
let adminUrl: string
let edgeUrl: string

async function listen(app: Gateway['edge']): Promise<[Server, string]> {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  return [server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`]
}

async function writeBuild(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(root, name)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  return dir
}

async function cli(...argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line), env: { SKEWFORGE_SERVER: adminUrl, SKEWFORGE_TOKEN: TOKEN } })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'skewforge-cli-'))
  gateway = await createGateway({
    port: 0,
    adminPort: 0,
    host: '127.0.0.1',
    dataDir: join(root, 'data'),
    adminToken: TOKEN,
    retention: DEFAULT_RETENTION,
    gcIntervalMs: 0,
    sessionTtlMs: 60_000,
    spaFallback: true,
    maxBlobBytes: 1024 * 1024,
    dashboardDir: null,
  })
  ;[adminServer, adminUrl] = await listen(gateway.admin)
  ;[edgeServer, edgeUrl] = await listen(gateway.edge)
})

afterAll(async () => {
  gateway.close()
  adminServer.close()
  edgeServer.close()
  await rm(root, { recursive: true, force: true })
})

const shared = { 'assets/vendor-SHARED00.js': 'export const react = 19' }

describe('skewforge CLI against a live gateway', () => {
  it('deploys a build and serves it', async () => {
    const dir = await writeBuild('v1', { 'index.html': '<html><head></head></html>', 'assets/index-AAAA1111.js': 'v1', ...shared, '.DS_Store': 'junk' })
    const result = await cli('deploy', dir, '--id', 'v1', '--promote', '--message', 'first')
    expect(result.code).toBe(0)
    expect(result.out).toContain('3 files, 3 uploaded, 0 reused')
    expect(result.out).toContain('v1 is now live')
    expect(await (await fetch(`${edgeUrl}/`)).text()).toContain('content="v1"')
    expect(gateway.service.get('v1').meta.message).toBe('first')
  })

  it('uploads only what changed and keeps the old chunks reachable', async () => {
    const dir = await writeBuild('v2', { 'index.html': '<html><head></head><body>2</body></html>', 'assets/index-BBBB2222.js': 'v2', ...shared })
    const result = await cli('deploy', dir, '--id', 'v2', '--promote', '--json')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.out)).toMatchObject({ files: 3, uploadedBlobs: 2, skippedBlobs: 1, deployment: { id: 'v2', current: true } })
    expect((await fetch(`${edgeUrl}/assets/index-AAAA1111.js`)).status).toBe(200)
  })

  it('reads the deployment id the Vite plugin wrote', async () => {
    const dir = await writeBuild('v3', { 'index.html': '<html></html>', '.skewforge.json': JSON.stringify({ deploymentId: 'from-plugin' }) })
    const result = await cli('deploy', dir)
    expect(result.code).toBe(0)
    expect(result.out).toContain('staged')
    expect(gateway.service.get('from-plugin').fileCount).toBe(1)
  })

  it('lists, promotes, rolls back and plans gc', async () => {
    expect((await cli('list')).out.split('\n')[0]).toMatch(/^◌ +from-plugin/)
    expect((await cli('promote', 'from-plugin', '--mandatory')).out).toContain('mandatory')
    expect((await cli('rollback')).out).toContain('v2 is live again')
    expect(gateway.service.get('from-plugin').revoked).toBe(true)
    const gc = await cli('gc', '--dry-run')
    expect(gc.out).toContain('keep    v2  (current)')
  })

  it('publishes asset-only builds under a prefix', async () => {
    const dir = await writeBuild('next-static', { 'chunks/page-4f3c1a2b.js': 'page', 'BUILD123/_buildManifest.js': 'manifest' })
    const files = await scanBuild(dir, { prefix: '_next/static', immutable: ['_next/static'] })
    expect(files.map((file) => [file.path, file.immutable])).toEqual([
      ['_next/static/BUILD123/_buildManifest.js', true],
      ['_next/static/chunks/page-4f3c1a2b.js', true],
    ])
    const result = await cli('deploy', dir, '--id', 'next-1', '--prefix', '_next/static', '--immutable', '_next/static', '--no-entry', '--json')
    expect(JSON.parse(result.out).deployment).toMatchObject({ entry: null })
  })

  it('fails helpfully', async () => {
    expect(await cli()).toMatchObject({ code: 2 })
    expect(await cli('nope')).toMatchObject({ code: 2, err: expect.stringContaining('unknown command') })
    expect(await cli('deploy', join(root, 'v1'), '--id', 'v1')).toMatchObject({ code: 1, err: expect.stringContaining('already exists') })
    expect(await cli('deploy', join(root, 'v1'), '--id=-bad')).toMatchObject({ code: 1, err: expect.stringContaining('invalid deployment id') })
    expect(await cli('promote', 'ghost')).toMatchObject({ code: 1, err: expect.stringContaining('does not exist') })
    const noToken = await run(['list'], { out: () => {}, err: () => {}, env: {} })
    expect(noToken).toBe(2)
  })
})
