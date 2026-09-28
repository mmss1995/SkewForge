interface Session {
  deployment: string
  lastSeen: number
}

/**
 * Browser tabs report which deployment they run every minute or so (`POST /__skewforge/beacon`).
 * This is what lets garbage collection keep a deployment alive while someone still has it open,
 * and what the dashboard shows as "live sessions per deployment". In memory only: after a
 * restart it refills within one beacon interval.
 */
export class SessionTracker {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxSessions = 100_000,
  ) {}

  touch(session: string, deployment: string, now = Date.now()): void {
    if (!this.sessions.has(session) && this.sessions.size >= this.maxSessions) this.prune(now)
    if (!this.sessions.has(session) && this.sessions.size >= this.maxSessions) return
    this.sessions.set(session, { deployment, lastSeen: now })
  }

  end(session: string): void {
    this.sessions.delete(session)
  }

  /** Live session count per deployment id. */
  counts(now = Date.now()): Map<string, number> {
    this.prune(now)
    const counts = new Map<string, number>()
    for (const { deployment } of this.sessions.values()) counts.set(deployment, (counts.get(deployment) ?? 0) + 1)
    return counts
  }

  private prune(now: number): void {
    for (const [id, session] of this.sessions) {
      if (now - session.lastSeen > this.ttlMs) this.sessions.delete(id)
    }
  }
}
