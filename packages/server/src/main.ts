import { join } from 'node:path'
import type { Config } from './config'
import { createAdminApp } from './http/admin'
import { createEdgeApp } from './http/edge'
import { DeploymentService } from './service'
import { SessionTracker } from './sessions'
import { FsBlobStore, type BlobStore } from './storage/blobs'
import { RegistryFile, type RegistryPersistence } from './storage/registry-file'
import { Telemetry } from './telemetry'

export interface Gateway {
  edge: ReturnType<typeof createEdgeApp>['app']
  admin: ReturnType<typeof createAdminApp>
  service: DeploymentService
  sessions: SessionTracker
  telemetry: Telemetry
  close(): void
}

/** Wires storage, service and both HTTP apps without listening, so tests can drive them. */
export async function createGateway(
  config: Config,
  overrides: { blobs?: BlobStore; persistence?: RegistryPersistence; now?: () => number } = {},
): Promise<Gateway> {
  let blobs = overrides.blobs
  if (!blobs) {
    const fsBlobs = new FsBlobStore(join(config.dataDir, 'blobs'))
    await fsBlobs.init()
    blobs = fsBlobs
  }
  const persistence = overrides.persistence ?? new RegistryFile(join(config.dataDir, 'registry.json'))
  const sessions = new SessionTracker(config.sessionTtlMs)
  const telemetry = new Telemetry()
  const service = new DeploymentService({ blobs, persistence, sessions, retention: config.retention, ...(overrides.now ? { now: overrides.now } : {}) })
  await service.init()

  const { app: edge, hub } = createEdgeApp({ config, service, blobs, sessions, telemetry })
  const admin = createAdminApp({ config, service, blobs, sessions, telemetry, streams: () => hub.size })
  return { edge, admin, service, sessions, telemetry, close: () => hub.close() }
}
