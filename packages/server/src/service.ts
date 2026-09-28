import { EventEmitter } from 'node:events'
import {
  AssetIndex,
  deploymentInputSchema,
  planRetention,
  referencedBlobs,
  summarize,
  versionStatus,
  type Deployment,
  type DeploymentInput,
  type DeploymentSummary,
  type PromotionReason,
  type Registry,
  type RetentionDecision,
  type RetentionPolicy,
  type VersionStatus,
} from '@skewforge/core'
import { HttpError } from './errors'
import type { SessionTracker } from './sessions'
import type { BlobStore } from './storage/blobs'
import type { RegistryPersistence } from './storage/registry-file'

export interface GcResult {
  dryRun: boolean
  decisions: RetentionDecision[]
  removedDeployments: string[]
  removedBlobs: number
  freedBytes: number
}

export interface ServiceOptions {
  blobs: BlobStore
  persistence: RegistryPersistence
  sessions: SessionTracker
  retention: RetentionPolicy
  now?: () => number
  /** Unreferenced blobs younger than this survive GC: they may belong to a deploy still uploading. */
  orphanGraceMs?: number
}

/** Emits `change` after every committed registry mutation. */
export class DeploymentService extends EventEmitter<{ change: [] }> {
  private registry!: Registry
  private assetIndex!: AssetIndex
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => number
  private readonly orphanGraceMs: number

  constructor(private readonly options: ServiceOptions) {
    super()
    this.now = options.now ?? Date.now
    this.orphanGraceMs = options.orphanGraceMs ?? 60 * 60 * 1000
  }

  async init(): Promise<void> {
    this.commitInMemory(await this.options.persistence.load())
  }

  get index(): AssetIndex {
    return this.assetIndex
  }

  get retention(): RetentionPolicy {
    return this.options.retention
  }

  current(): string | null {
    return this.registry.current
  }

  status(running: string | null): VersionStatus {
    return versionStatus(this.registry, running)
  }

  list(): DeploymentSummary[] {
    return [...this.registry.deployments].reverse().map((deployment) => summarize(deployment, this.registry.current))
  }

  get(id: string): Deployment {
    const deployment = this.registry.deployments.find((candidate) => candidate.id === id)
    if (!deployment) throw new HttpError(404, `deployment "${id}" does not exist`)
    return deployment
  }

  promotions() {
    return [...this.registry.promotions].reverse()
  }

  /** Unique bytes referenced by all retained deployments. */
  storedBytes(): { blobs: number; bytes: number } {
    const sizes = new Map<string, number>()
    for (const deployment of this.registry.deployments) {
      for (const file of Object.values(deployment.files)) sizes.set(file.hash, file.size)
    }
    let bytes = 0
    for (const size of sizes.values()) bytes += size
    return { blobs: sizes.size, bytes }
  }

  async missingBlobs(hashes: string[]): Promise<string[]> {
    const unique = [...new Set(hashes)]
    const present = await Promise.all(unique.map((hash) => this.options.blobs.has(hash)))
    return unique.filter((_, index) => !present[index])
  }

  create(raw: DeploymentInput | unknown): Promise<DeploymentSummary> {
    const input = deploymentInputSchema.parse(raw)
    return this.mutate(async (registry) => {
      if (registry.deployments.some((deployment) => deployment.id === input.id)) {
        throw new HttpError(409, `deployment "${input.id}" already exists; deployment ids must be unique per build`)
      }
      const files = Object.values(input.files)
      const missing = await this.missingBlobs(files.map((file) => file.hash))
      if (missing.length > 0) throw new HttpError(422, `${missing.length} blob(s) have not been uploaded`, { missing })

      const known = new Set<string>()
      for (const deployment of registry.deployments) for (const file of Object.values(deployment.files)) known.add(file.hash)
      const counted = new Set<string>()
      let totalBytes = 0
      let newBytes = 0
      for (const file of files) {
        totalBytes += file.size
        if (!known.has(file.hash) && !counted.has(file.hash)) newBytes += file.size
        counted.add(file.hash)
      }

      const deployment: Deployment = {
        id: input.id,
        createdAt: this.now(),
        entry: input.entry,
        files: input.files,
        meta: input.meta,
        mandatory: input.mandatory,
        revoked: false,
        promotedAt: null,
        retiredAt: null,
        fileCount: files.length,
        totalBytes,
        newBytes,
      }
      registry.deployments.push(deployment)
      if (input.promote) this.setCurrent(registry, deployment.id, 'deploy')
      return summarize(deployment, registry.current)
    })
  }

  promote(id: string, options: { mandatory?: boolean | undefined } = {}): Promise<DeploymentSummary> {
    return this.mutate(async (registry) => {
      const deployment = this.find(registry, id)
      if (options.mandatory !== undefined) deployment.mandatory = options.mandatory
      deployment.revoked = false
      if (registry.current !== id) this.setCurrent(registry, id, 'promote')
      return summarize(deployment, registry.current)
    })
  }

  /** Moves `current` back to `to`, or to whatever was current before the current deployment. */
  rollback(options: { to?: string | undefined; revoke: boolean }): Promise<DeploymentSummary> {
    return this.mutate(async (registry) => {
      const from = registry.current
      if (!from) throw new HttpError(409, 'nothing is live, there is nothing to roll back')
      const target = options.to ?? this.previousCurrent(registry, from)
      if (!target) throw new HttpError(409, 'no earlier deployment to roll back to')
      if (target === from) throw new HttpError(409, `"${target}" is already current`)
      const deployment = this.find(registry, target)
      if (!deployment.entry && this.find(registry, from).entry) {
        throw new HttpError(409, `"${target}" is asset-only and cannot serve pages`)
      }
      deployment.revoked = false
      this.setCurrent(registry, target, 'rollback')
      if (options.revoke) this.find(registry, from).revoked = true
      return summarize(deployment, registry.current)
    })
  }

  update(id: string, patch: { mandatory?: boolean | undefined; revoked?: boolean | undefined }): Promise<DeploymentSummary> {
    return this.mutate(async (registry) => {
      const deployment = this.find(registry, id)
      if (patch.revoked && registry.current === id) throw new HttpError(409, 'the current deployment cannot be revoked; roll back instead')
      if (patch.mandatory !== undefined) deployment.mandatory = patch.mandatory
      if (patch.revoked !== undefined) deployment.revoked = patch.revoked
      return summarize(deployment, registry.current)
    })
  }

  async remove(id: string): Promise<void> {
    await this.mutate(async (registry) => {
      this.find(registry, id)
      if (registry.current === id) throw new HttpError(409, 'the current deployment cannot be deleted; promote another one first')
      registry.deployments = registry.deployments.filter((deployment) => deployment.id !== id)
    })
    await this.sweepBlobs()
  }

  planGc(): RetentionDecision[] {
    return planRetention(this.registry, this.options.sessions.counts(this.now()), this.options.retention, this.now())
  }

  async gc(dryRun: boolean): Promise<GcResult> {
    if (dryRun) {
      const decisions = this.planGc()
      return { dryRun, decisions, removedDeployments: decisions.filter((decision) => !decision.keep).map((decision) => decision.id), removedBlobs: 0, freedBytes: 0 }
    }
    let decisions: RetentionDecision[] = []
    const removedDeployments = await this.mutate(async (registry) => {
      decisions = planRetention(registry, this.options.sessions.counts(this.now()), this.options.retention, this.now())
      const doomed = new Set(decisions.filter((decision) => !decision.keep).map((decision) => decision.id))
      registry.deployments = registry.deployments.filter((deployment) => !doomed.has(deployment.id))
      return [...doomed]
    })
    const swept = await this.sweepBlobs()
    return { dryRun, decisions, removedDeployments, ...swept }
  }

  /** Deletes blobs no retained deployment references (and that are not a fresh upload). */
  private async sweepBlobs(): Promise<{ removedBlobs: number; freedBytes: number }> {
    const keep = referencedBlobs(this.registry, new Set(this.registry.deployments.map((deployment) => deployment.id)))
    let removedBlobs = 0
    let freedBytes = 0
    for (const blob of await this.options.blobs.list()) {
      if (keep.has(blob.hash) || this.now() - blob.modifiedAt < this.orphanGraceMs) continue
      // Re-check under the lock: a deploy may have started referencing it since the listing.
      const deleted = await this.serialize(async () => {
        if (referencedBlobs(this.registry, new Set(this.registry.deployments.map((deployment) => deployment.id))).has(blob.hash)) return false
        await this.options.blobs.delete(blob.hash)
        return true
      })
      if (deleted) {
        removedBlobs++
        freedBytes += blob.size
      }
    }
    return { removedBlobs, freedBytes }
  }

  private find(registry: Registry, id: string): Deployment {
    const deployment = registry.deployments.find((candidate) => candidate.id === id)
    if (!deployment) throw new HttpError(404, `deployment "${id}" does not exist`)
    return deployment
  }

  private previousCurrent(registry: Registry, from: string): string | null {
    for (let index = registry.promotions.length - 1; index >= 0; index--) {
      const { id } = registry.promotions[index]!
      if (id !== from && registry.deployments.some((deployment) => deployment.id === id)) return id
    }
    return null
  }

  private setCurrent(registry: Registry, id: string, reason: PromotionReason): void {
    const now = this.now()
    const previous = registry.current ? registry.deployments.find((deployment) => deployment.id === registry.current) : undefined
    if (previous) previous.retiredAt = now
    const next = this.find(registry, id)
    next.promotedAt = now
    next.retiredAt = null
    registry.current = id
    registry.promotions.push({ id, at: now, reason })
    // The promotion log only needs to outlive the deployments it mentions.
    if (registry.promotions.length > 500) registry.promotions.splice(0, registry.promotions.length - 500)
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Mutations run one at a time on a copy; the copy is persisted, then swapped in, then announced. */
  private mutate<T>(change: (registry: Registry) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const draft = structuredClone(this.registry)
      const result = await change(draft)
      await this.options.persistence.save(draft)
      this.commitInMemory(draft)
      this.emit('change')
      return result
    })
  }

  private commitInMemory(registry: Registry): void {
    this.registry = registry
    this.assetIndex = new AssetIndex(registry)
  }
}
