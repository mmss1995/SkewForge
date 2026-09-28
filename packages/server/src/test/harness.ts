import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { contentTypeFor, DEFAULT_RETENTION, isFingerprinted, type DeploymentInput } from '@skewforge/core'
import type { Config } from '../config'
import { createGateway, type Gateway } from '../main'

export const TOKEN = 'test-admin-token-123'

export interface Harness {
  gateway: Gateway
  dataDir: string
  clock: { now: number }
  admin: () => ReturnType<typeof request.agent>
  edge: () => ReturnType<typeof request>
  /** Uploads `files` (path → content) as blobs and creates a deployment through the admin API. */
  deploy(id: string, files: Record<string, string>, options?: Partial<DeploymentInput>): Promise<request.Response>
  cleanup(): Promise<void>
}

export const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

export async function createHarness(overrides: Partial<Config> = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'skewforge-test-'))
  const clock = { now: Date.now() }
  const config: Config = {
    port: 0,
    adminPort: 0,
    host: '127.0.0.1',
    dataDir,
    adminToken: TOKEN,
    retention: DEFAULT_RETENTION,
    gcIntervalMs: 0,
    sessionTtlMs: 180_000,
    spaFallback: true,
    maxBlobBytes: 1024 * 1024,
    dashboardDir: null,
    ...overrides,
  }
  const gateway = await createGateway(config, { now: () => clock.now })
  const admin = () => request.agent(gateway.admin).set('authorization', `Bearer ${TOKEN}`)

  return {
    gateway,
    dataDir,
    clock,
    admin,
    edge: () => request(gateway.edge),
    async deploy(id, files, options = {}) {
      const manifest: DeploymentInput['files'] = {}
      for (const [path, content] of Object.entries(files)) {
        const hash = sha256(content)
        manifest[path] = { hash, size: Buffer.byteLength(content), type: contentTypeFor(path), immutable: isFingerprinted(path) }
        await admin().put(`/api/blobs/${hash}`).set('content-type', 'application/octet-stream').send(Buffer.from(content))
      }
      clock.now += 1000
      return admin().post('/api/deployments').send({ id, files: manifest, promote: true, ...options })
    },
    async cleanup() {
      gateway.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

/** Two builds of the same SPA: the entry and the About route chunk changed, the vendor chunk did not. */
export const V1 = {
  'index.html': '<!doctype html><html><head><title>v1</title></head><body><script type="module" src="/assets/index-AAAA1111.js"></script></body></html>',
  'assets/index-AAAA1111.js': 'import("./About-AAAA1111.js")',
  'assets/About-AAAA1111.js': 'export default "about v1"',
  'assets/vendor-SHARED00.js': 'export const react = 19',
  'remoteEntry.js': 'export const version = 1',
}

export const V2 = {
  'index.html': '<!doctype html><html><head><title>v2</title></head><body><script type="module" src="/assets/index-BBBB2222.js"></script></body></html>',
  'assets/index-BBBB2222.js': 'import("./About-BBBB2222.js")',
  'assets/About-BBBB2222.js': 'export default "about v2"',
  'assets/vendor-SHARED00.js': 'export const react = 19',
  'remoteEntry.js': 'export const version = 2',
}
