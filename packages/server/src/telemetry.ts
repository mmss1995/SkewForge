import type { ResolutionVia } from '@skewforge/core'

export interface DeploymentCounters {
  requests: number
  /** Served by this deployment while another one was current. */
  skewed: number
  /** Would have been a 404 on a plain static server. */
  rescued: number
}

export interface RescueEvent {
  at: number
  path: string
  deployment: string
  via: ResolutionVia
}

export interface MissEvent {
  at: number
  path: string
}

export interface TelemetrySnapshot {
  since: number
  totals: DeploymentCounters & { misses: number }
  byDeployment: Record<string, DeploymentCounters>
  /** One bucket per minute for the last hour, oldest first. */
  timeline: { minute: number; requests: number; rescued: number; misses: number }[]
  recentRescues: RescueEvent[]
  recentMisses: MissEvent[]
}

const MINUTE = 60_000
const TIMELINE_MINUTES = 60
const RECENT = 25

/** In-process request counters for the dashboard. Nothing here affects what gets served. */
export class Telemetry {
  private readonly since = Date.now()
  private readonly byDeployment = new Map<string, DeploymentCounters>()
  private readonly buckets = new Map<number, { requests: number; rescued: number; misses: number }>()
  private readonly rescues: RescueEvent[] = []
  private readonly misses: MissEvent[] = []
  private missCount = 0

  private bucket(now: number) {
    const minute = Math.floor(now / MINUTE) * MINUTE
    let bucket = this.buckets.get(minute)
    if (!bucket) {
      bucket = { requests: 0, rescued: 0, misses: 0 }
      this.buckets.set(minute, bucket)
      for (const key of this.buckets.keys()) if (key <= minute - TIMELINE_MINUTES * MINUTE) this.buckets.delete(key)
    }
    return bucket
  }

  served(path: string, deployment: string, via: ResolutionVia, skewed: boolean, rescued: boolean, now = Date.now()): void {
    let counters = this.byDeployment.get(deployment)
    if (!counters) {
      counters = { requests: 0, skewed: 0, rescued: 0 }
      this.byDeployment.set(deployment, counters)
    }
    counters.requests++
    if (skewed) counters.skewed++
    const bucket = this.bucket(now)
    bucket.requests++
    if (rescued) {
      counters.rescued++
      bucket.rescued++
      this.rescues.unshift({ at: now, path, deployment, via })
      this.rescues.length = Math.min(this.rescues.length, RECENT)
    }
  }

  /** A file request no retained deployment could answer. */
  missed(path: string, now = Date.now()): void {
    this.missCount++
    this.bucket(now).misses++
    this.misses.unshift({ at: now, path })
    this.misses.length = Math.min(this.misses.length, RECENT)
  }

  snapshot(now = Date.now()): TelemetrySnapshot {
    const totals = { requests: 0, skewed: 0, rescued: 0, misses: this.missCount }
    const byDeployment: Record<string, DeploymentCounters> = {}
    for (const [id, counters] of this.byDeployment) {
      byDeployment[id] = { ...counters }
      totals.requests += counters.requests
      totals.skewed += counters.skewed
      totals.rescued += counters.rescued
    }
    const latest = Math.floor(now / MINUTE) * MINUTE
    const timeline = Array.from({ length: TIMELINE_MINUTES }, (_, index) => {
      const minute = latest - (TIMELINE_MINUTES - 1 - index) * MINUTE
      return { minute, ...(this.buckets.get(minute) ?? { requests: 0, rescued: 0, misses: 0 }) }
    })
    return { since: this.since, totals, byDeployment, timeline, recentRescues: [...this.rescues], recentMisses: [...this.misses] }
  }
}
