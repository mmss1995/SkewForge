import type { Registry, VersionStatus } from './types'

/**
 * What a client running `running` should do given the registry:
 *
 * - running the current deployment → nothing;
 * - running a deployment the registry no longer has → reload now: its files are gone;
 * - running a revoked deployment (rolled back as broken) → reload now;
 * - any deployment promoted after `running` was last current is mandatory → reload now;
 * - otherwise an update is available and the client picks a convenient moment;
 * - running a deployment that was never promoted → it is a preview, leave it alone.
 */
export function versionStatus(registry: Registry, running: string | null): VersionStatus {
  const current = registry.current
  const base = { current, running }
  if (!current) return { ...base, updateAvailable: false, mandatory: false, reason: 'none' }
  if (!running || running === current) return { ...base, updateAvailable: false, mandatory: false, reason: 'up-to-date' }

  const deployment = registry.deployments.find((candidate) => candidate.id === running)
  if (!deployment) return { ...base, updateAvailable: true, mandatory: true, reason: 'unknown' }
  if (deployment.revoked) return { ...base, updateAvailable: true, mandatory: true, reason: 'revoked' }

  let lastCurrent = -1
  for (let index = registry.promotions.length - 1; index >= 0; index--) {
    if (registry.promotions[index]!.id === running) {
      lastCurrent = index
      break
    }
  }
  if (lastCurrent === -1) return { ...base, updateAvailable: false, mandatory: false, reason: 'preview' }

  const mandatoryIds = new Set(registry.deployments.filter((candidate) => candidate.mandatory).map((candidate) => candidate.id))
  const mandatory = registry.promotions.slice(lastCurrent + 1).some((promotion) => mandatoryIds.has(promotion.id))
  return { ...base, updateAvailable: true, mandatory, reason: mandatory ? 'mandatory' : 'update' }
}
