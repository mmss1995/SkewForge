import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { DeploymentInput, DeploymentSummary, RetentionDecision } from '@skewforge/core'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message)
  }
}

export type CreatedDeployment = DeploymentSummary & { previewUrl: string | null }

export interface GcResult {
  dryRun: boolean
  decisions: RetentionDecision[]
  removedDeployments: string[]
  removedBlobs: number
  freedBytes: number
}

/** Thin typed wrapper over the gateway's admin API. */
export class AdminClient {
  private readonly base: string

  constructor(
    server: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = server.replace(/\/+$/, '')
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { authorization: `Bearer ${this.token}` } }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
      init.headers = { ...init.headers, 'content-type': 'application/json' }
    }
    const res = await this.fetchImpl(`${this.base}${path}`, init)
    const text = await res.text()
    const parsed: unknown = text ? JSON.parse(text) : undefined
    if (!res.ok) {
      const message = (parsed as { error?: string } | undefined)?.error ?? res.statusText
      throw new ApiError(res.status, `${method} ${path} → ${res.status}: ${message}`, parsed)
    }
    return parsed as T
  }

  missing(hashes: string[]): Promise<{ missing: string[] }> {
    return this.call('POST', '/api/blobs/missing', { hashes })
  }

  async upload(hash: string, absolute: string, size: number): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/api/blobs/${hash}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/octet-stream', 'content-length': String(size) },
      body: Readable.toWeb(createReadStream(absolute)) as ReadableStream,
      duplex: 'half',
    } as RequestInit)
    if (!res.ok) throw new ApiError(res.status, `upload of ${hash} failed: ${res.status} ${await res.text()}`, null)
  }

  createDeployment(input: DeploymentInput): Promise<CreatedDeployment> {
    return this.call('POST', '/api/deployments', input)
  }

  list(): Promise<DeploymentSummary[]> {
    return this.call('GET', '/api/deployments')
  }

  promote(id: string, mandatory?: boolean): Promise<DeploymentSummary> {
    return this.call('POST', `/api/deployments/${encodeURIComponent(id)}/promote`, mandatory === undefined ? {} : { mandatory })
  }

  rollback(to: string | undefined, revoke: boolean): Promise<DeploymentSummary> {
    return this.call('POST', '/api/rollback', to ? { to, revoke } : { revoke })
  }

  remove(id: string): Promise<void> {
    return this.call('DELETE', `/api/deployments/${encodeURIComponent(id)}`)
  }

  gc(dryRun: boolean): Promise<GcResult> {
    return this.call('POST', `/api/gc${dryRun ? '?dryRun=1' : ''}`)
  }
}
