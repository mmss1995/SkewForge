import type { FileEntry } from './schema'
import type { Deployment, Registry } from './types'

/** Test helper: a deployment whose files are given as `path` or `path=content-marker`. */
export function fakeDeployment(id: string, paths: string[], overrides: Partial<Deployment> = {}): Deployment {
  const files: Record<string, FileEntry> = {}
  for (const spec of paths) {
    const [path, marker = spec] = spec.split('=') as [string, string?]
    files[path] = { hash: marker.padEnd(64, '0').replace(/[^a-f0-9]/g, 'a').slice(0, 64), size: 10, type: 'text/plain', immutable: false }
  }
  return {
    id,
    createdAt: 0,
    entry: 'index.html' in files ? 'index.html' : null,
    files,
    meta: {},
    mandatory: false,
    revoked: false,
    promotedAt: null,
    retiredAt: null,
    fileCount: paths.length,
    totalBytes: paths.length * 10,
    newBytes: 0,
    ...overrides,
  }
}

/** Test helper: deployments created one second apart, each promoted in order, the last current. */
export function fakeHistory(...deployments: Deployment[]): Registry {
  const stamped = deployments.map((deployment, index) => ({
    ...deployment,
    createdAt: deployment.createdAt || (index + 1) * 1000,
  }))
  return {
    current: stamped.at(-1)?.id ?? null,
    deployments: stamped,
    promotions: stamped.map((deployment) => ({ id: deployment.id, at: deployment.createdAt, reason: 'deploy' as const })),
  }
}
