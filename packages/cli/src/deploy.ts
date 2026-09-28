import { deploymentIdSchema, type DeploymentMeta } from '@skewforge/core'
import type { AdminClient, CreatedDeployment } from './client'
import { readBuildInfo, scanBuild, type ScanOptions } from './manifest'

export interface DeployOptions extends ScanOptions {
  dir: string
  id?: string | undefined
  /** Serve this file for page routes; null for asset-only deployments. */
  entry?: string | null
  promote: boolean
  mandatory: boolean
  meta: DeploymentMeta
  concurrency: number
  onProgress?: (event: DeployProgress) => void
}

export type DeployProgress =
  | { type: 'scanned'; files: number; bytes: number }
  | { type: 'missing'; blobs: number; bytes: number }
  | { type: 'uploaded'; path: string; done: number; total: number }

export interface DeployResult {
  deployment: CreatedDeployment
  files: number
  uploadedBlobs: number
  uploadedBytes: number
  skippedBlobs: number
}

async function pool<T>(items: T[], size: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await task(item)
  })
  await Promise.all(workers)
}

/**
 * Scans a build, uploads only the blobs the gateway does not have yet, then registers the
 * deployment. Unchanged chunks from earlier builds cost one hash lookup, not an upload.
 */
export async function deploy(client: AdminClient, options: DeployOptions): Promise<DeployResult> {
  const info = await readBuildInfo(options.dir)
  const rawId = options.id ?? info.deploymentId
  if (!rawId) throw new Error('no deployment id: pass --id, set SKEWFORGE_DEPLOYMENT_ID, or build with @skewforge/vite')
  const parsedId = deploymentIdSchema.safeParse(rawId)
  if (!parsedId.success) throw new Error(`invalid deployment id "${rawId}": ${parsedId.error.issues[0]?.message}`)
  const id = parsedId.data

  const files = await scanBuild(options.dir, options)
  if (files.length === 0) throw new Error(`${options.dir} contains no files`)
  options.onProgress?.({ type: 'scanned', files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) })

  const unique = new Map(files.map((file) => [file.hash, file]))
  const { missing } = await client.missing([...unique.keys()])
  const toUpload = missing.map((hash) => unique.get(hash)!)
  options.onProgress?.({ type: 'missing', blobs: toUpload.length, bytes: toUpload.reduce((sum, file) => sum + file.size, 0) })

  let done = 0
  await pool(toUpload, options.concurrency, async (file) => {
    await client.upload(file.hash, file.absolute, file.size)
    options.onProgress?.({ type: 'uploaded', path: file.path, done: ++done, total: toUpload.length })
  })

  const entry = options.entry === undefined ? (files.some((file) => file.path === 'index.html') ? 'index.html' : null) : options.entry
  const deployment = await client.createDeployment({
    id,
    entry,
    files: Object.fromEntries(files.map(({ path, hash, size, type, immutable }) => [path, { hash, size, type, immutable }])),
    meta: options.meta,
    promote: options.promote,
    mandatory: options.mandatory,
  })
  return {
    deployment,
    files: files.length,
    uploadedBlobs: toUpload.length,
    uploadedBytes: toUpload.reduce((sum, file) => sum + file.size, 0),
    skippedBlobs: unique.size - toUpload.length,
  }
}
