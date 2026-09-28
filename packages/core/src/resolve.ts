import type { FileEntry } from './schema'
import type { Deployment, Registry } from './types'

/**
 * Which deployments contain each path, newest first. Built once per registry change so a request
 * costs a map lookup, not a scan over every retained deployment.
 */
export class AssetIndex {
  readonly current: Deployment | null
  private readonly byId = new Map<string, Deployment>()
  private readonly byPath = new Map<string, Deployment[]>()

  constructor(registry: Registry) {
    for (const deployment of [...registry.deployments].reverse()) {
      this.byId.set(deployment.id, deployment)
      for (const path of Object.keys(deployment.files)) {
        const holders = this.byPath.get(path)
        if (holders) holders.push(deployment)
        else this.byPath.set(path, [deployment])
      }
    }
    this.current = registry.current ? (this.byId.get(registry.current) ?? null) : null
  }

  deployment(id: string): Deployment | undefined {
    return this.byId.get(id)
  }

  holders(path: string): readonly Deployment[] {
    return this.byPath.get(path) ?? []
  }
}

/** How the gateway decided which deployment answers a request. */
export type ResolutionVia = 'pinned' | 'referer' | 'current' | 'fallback'

export interface AssetRequest {
  /** Normalized manifest path of the requested file. */
  path: string
  /** A deployment the client asked for explicitly: `?dpl=`, the `x-skewforge-deployment` header or a preview cookie. */
  pinned?: string | null
  /** Normalized path of the Referer when it is same-origin, and the `dpl` it carried if any. */
  referer?: { path: string; dpl: string | null } | null
  /**
   * Deployments this request may see. The gateway hides staged builds (never promoted) from
   * everyone but a browser holding a signed preview cookie for them.
   */
  visible?: (deployment: Deployment) => boolean
}

export interface AssetResolution {
  deployment: Deployment
  file: FileEntry
  via: ResolutionVia
  /** Served by a deployment other than the current one. */
  skewed: boolean
  /**
   * The current deployment does not have this file at all: a plain static server would have
   * answered 404 and the client would have crashed. This is the number the dashboard leads with.
   */
  rescued: boolean
}

function answer(index: AssetIndex, path: string, deployment: Deployment, via: ResolutionVia): AssetResolution {
  const current = index.current
  const skewed = deployment !== current
  return {
    deployment,
    file: deployment.files[path]!,
    via,
    skewed,
    rescued: skewed && !(current && path in current.files),
  }
}

/**
 * Picks the deployment that serves a static file, most specific signal first:
 *
 * 1. an explicit pin, when that deployment has the file;
 * 2. the Referer: a module importing `./chunk.js` sends its own URL, so the chunk comes from the
 *    deployment that built the importer. When the importer is shared by several deployments
 *    (an unchanged vendor chunk), the current one wins among them, then the newest;
 * 3. the current deployment;
 * 4. the newest retained deployment that still has the file — the rescue path for tabs opened
 *    before the last deploy.
 */
export function resolveAsset(index: AssetIndex, request: AssetRequest): AssetResolution | null {
  const visible = request.visible ?? (() => true)
  const holders = index.holders(request.path).filter(visible)
  if (holders.length === 0) return null

  if (request.pinned) {
    const pinned = index.deployment(request.pinned)
    if (pinned && visible(pinned) && request.path in pinned.files) return answer(index, request.path, pinned, 'pinned')
  }

  if (request.referer) {
    const { path: refererPath, dpl } = request.referer
    const fromDpl = dpl ? index.deployment(dpl) : undefined
    if (fromDpl && visible(fromDpl) && request.path in fromDpl.files) return answer(index, request.path, fromDpl, 'referer')

    const importers = index.holders(refererPath)
    if (importers.length > 0) {
      const candidates = holders.filter((deployment) => importers.includes(deployment))
      const preferred = candidates.find((deployment) => deployment === index.current) ?? candidates[0]
      if (preferred) return answer(index, request.path, preferred, 'referer')
    }
  }

  if (index.current && request.path in index.current.files) {
    return answer(index, request.path, index.current, 'current')
  }
  return answer(index, request.path, holders[0]!, 'fallback')
}

/**
 * The deployment whose HTML answers a page route: the pinned one (preview) if it has an entry,
 * otherwise the current one. Asset-only deployments never answer documents.
 */
export function resolveDocument(index: AssetIndex, pinned: string | null): Deployment | null {
  if (pinned) {
    const deployment = index.deployment(pinned)
    if (deployment?.entry) return deployment
  }
  return index.current?.entry ? index.current : null
}
