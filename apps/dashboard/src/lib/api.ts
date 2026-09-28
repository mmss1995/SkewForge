import type { Deployment, DeploymentSummary, Promotion, RetentionDecision, RetentionPolicy } from '@skewforge/core'

export type { Deployment, DeploymentSummary, Promotion, RetentionDecision }

export interface Overview {
  current: string | null
  publicUrl: string | null
  deployments: (DeploymentSummary & { activeSessions: number })[]
  promotions: Promotion[]
  retention: RetentionPolicy
  gcPlan: RetentionDecision[]
  storage: { blobs: number; bytes: number }
  liveStreams: number
  telemetry: {
    since: number
    totals: { requests: number; skewed: number; rescued: number; misses: number }
    byDeployment: Record<string, { requests: number; skewed: number; rescued: number }>
    timeline: { minute: number; requests: number; rescued: number; misses: number }[]
    recentRescues: { at: number; path: string; deployment: string; via: string }[]
    recentMisses: { at: number; path: string }[]
  }
}

export type DeploymentDetail = Deployment & { current: boolean; previewUrl: string | null }

export interface GcResult {
  dryRun: boolean
  decisions: RetentionDecision[]
  removedDeployments: string[]
  removedBlobs: number
  freedBytes: number
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Typed client for the admin API, bound to one token. */
export function createApi(token: string) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 204) return undefined as T
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText)
    return data as T
  }

  return {
    overview: () => request<Overview>('GET', '/overview'),
    deployment: (id: string) => request<DeploymentDetail>('GET', `/deployments/${encodeURIComponent(id)}`),
    promote: (id: string) => request<DeploymentSummary>('POST', `/deployments/${encodeURIComponent(id)}/promote`, {}),
    update: (id: string, patch: { mandatory?: boolean; revoked?: boolean }) => request<DeploymentSummary>('PATCH', `/deployments/${encodeURIComponent(id)}`, patch),
    remove: (id: string) => request<void>('DELETE', `/deployments/${encodeURIComponent(id)}`),
    rollback: () => request<DeploymentSummary>('POST', '/rollback', {}),
    gc: (dryRun: boolean) => request<GcResult>('POST', `/gc${dryRun ? '?dryRun=1' : ''}`),
  }
}

export type Api = ReturnType<typeof createApi>
