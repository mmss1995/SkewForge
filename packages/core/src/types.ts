import type { DeploymentMeta, FileEntry } from './schema'

export interface Deployment {
  id: string
  createdAt: number
  entry: string | null
  files: Record<string, FileEntry>
  meta: DeploymentMeta
  mandatory: boolean
  /** Set when a rollback moved away from this deployment: its clients are told to reload. */
  revoked: boolean
  /** Last time this deployment became current, null if it never was (a staged or preview build). */
  promotedAt: number | null
  /** When it stopped being current; retention grace periods count from here. */
  retiredAt: number | null
  fileCount: number
  totalBytes: number
  /** Bytes whose blobs no earlier deployment had, i.e. what this deploy actually added to storage. */
  newBytes: number
}

export type PromotionReason = 'deploy' | 'promote' | 'rollback'

export interface Promotion {
  id: string
  at: number
  reason: PromotionReason
}

export interface Registry {
  current: string | null
  /** Ordered oldest first. */
  deployments: Deployment[]
  /** Every change of `current`, oldest first. Rollback and "mandatory since" both read it. */
  promotions: Promotion[]
}

export type VersionReason = 'up-to-date' | 'update' | 'mandatory' | 'revoked' | 'unknown' | 'preview' | 'none'

/** What a running client should do, as computed by `versionStatus`. */
export interface VersionStatus {
  current: string | null
  running: string | null
  updateAvailable: boolean
  /** The client should reload now rather than at a convenient moment. */
  mandatory: boolean
  reason: VersionReason
}

/** A deployment as the admin API and dashboard see it: no file list. */
export type DeploymentSummary = Omit<Deployment, 'files'> & { current: boolean }

export function summarize(deployment: Deployment, current: string | null): DeploymentSummary {
  const { files: _files, ...rest } = deployment
  return { ...rest, current: deployment.id === current }
}

export function emptyRegistry(): Registry {
  return { current: null, deployments: [], promotions: [] }
}
