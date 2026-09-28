import type { Registry } from './types'

export interface RetentionPolicy {
  /** The newest N deployments are always kept, whatever their age. */
  keepLast: number
  /** A retired deployment is kept at least this long after it stopped being current. */
  minAgeMs: number
  /** Keep any deployment that still has live browser sessions reporting in. */
  protectActiveSessions: boolean
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  keepLast: 5,
  minAgeMs: 7 * 24 * 60 * 60 * 1000,
  protectActiveSessions: true,
}

export type KeepReason = 'current' | 'recent' | 'grace-period' | 'active-sessions'

export interface RetentionDecision {
  id: string
  keep: boolean
  reason: KeepReason | 'expired'
  activeSessions: number
}

/**
 * Decides which deployments garbage collection may delete. Deletion is what turns a skewed tab
 * into a crashed one, so every rule errs on the side of keeping: the current deployment, the
 * newest `keepLast`, anything retired less than `minAgeMs` ago, and anything with live sessions.
 */
export function planRetention(
  registry: Registry,
  activeSessions: ReadonlyMap<string, number>,
  policy: RetentionPolicy,
  now: number,
): RetentionDecision[] {
  const newestFirst = [...registry.deployments].sort((a, b) => b.createdAt - a.createdAt)
  return newestFirst.map((deployment, rank): RetentionDecision => {
    const sessions = activeSessions.get(deployment.id) ?? 0
    const decide = (keep: boolean, reason: RetentionDecision['reason']) => ({ id: deployment.id, keep, reason, activeSessions: sessions })
    if (deployment.id === registry.current) return decide(true, 'current')
    if (rank < policy.keepLast) return decide(true, 'recent')
    const since = deployment.retiredAt ?? deployment.createdAt
    if (now - since < policy.minAgeMs) return decide(true, 'grace-period')
    if (policy.protectActiveSessions && sessions > 0) return decide(true, 'active-sessions')
    return decide(false, 'expired')
  })
}

/** Blob hashes still referenced by the deployments that survive. */
export function referencedBlobs(registry: Registry, keep: ReadonlySet<string>): Set<string> {
  const hashes = new Set<string>()
  for (const deployment of registry.deployments) {
    if (!keep.has(deployment.id)) continue
    for (const file of Object.values(deployment.files)) hashes.add(file.hash)
  }
  return hashes
}
