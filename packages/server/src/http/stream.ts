import type { Response } from 'express'
import type { VersionStatus } from '@skewforge/core'
import type { DeploymentService } from '../service'

interface Listener {
  res: Response
  running: string | null
  last: string
}

/**
 * Server-Sent Events for browser tabs. Each tab says which deployment it runs; after every
 * registry change it gets its own `versionStatus`, but only when that status actually changed,
 * so a promotion wakes every tab once and a metadata edit wakes nobody.
 */
export class VersionStreamHub {
  private readonly listeners = new Set<Listener>()
  private readonly heartbeat: NodeJS.Timeout

  constructor(
    private readonly service: DeploymentService,
    heartbeatMs = 25_000,
  ) {
    service.on('change', () => this.broadcast())
    this.heartbeat = setInterval(() => {
      for (const listener of this.listeners) listener.res.write(': ping\n\n')
    }, heartbeatMs)
    this.heartbeat.unref()
  }

  get size(): number {
    return this.listeners.size
  }

  attach(res: Response, running: string | null): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx buffers proxied responses unless told otherwise.
      'x-accel-buffering': 'no',
    })
    const status = this.service.status(running)
    const listener: Listener = { res, running, last: JSON.stringify(status) }
    this.listeners.add(listener)
    res.write('retry: 5000\n\n')
    this.send(listener, status)
    res.on('close', () => this.listeners.delete(listener))
  }

  close(): void {
    clearInterval(this.heartbeat)
    for (const listener of this.listeners) listener.res.end()
    this.listeners.clear()
  }

  private broadcast(): void {
    const byRunning = new Map<string | null, VersionStatus>()
    for (const listener of this.listeners) {
      let status = byRunning.get(listener.running)
      if (!status) {
        status = this.service.status(listener.running)
        byRunning.set(listener.running, status)
      }
      const serialized = JSON.stringify(status)
      if (serialized === listener.last) continue
      listener.last = serialized
      this.send(listener, status)
    }
  }

  private send(listener: Listener, status: VersionStatus): void {
    listener.res.write(`event: version\ndata: ${JSON.stringify(status)}\n\n`)
  }
}
