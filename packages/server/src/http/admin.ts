import { timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express, { type RequestHandler } from 'express'
import { z } from 'zod'
import { blobHashSchema, promoteInputSchema, rollbackInputSchema, RUNTIME_PREFIX } from '@skewforge/core'
import type { Config } from '../config'
import { errorHandler, HttpError } from '../errors'
import type { DeploymentService } from '../service'
import type { SessionTracker } from '../sessions'
import type { BlobStore } from '../storage/blobs'
import type { Telemetry } from '../telemetry'
import { previewSignature } from './edge'

export interface AdminDeps {
  config: Pick<Config, 'adminToken' | 'maxBlobBytes' | 'dashboardDir' | 'publicUrl'>
  service: DeploymentService
  blobs: BlobStore
  sessions: SessionTracker
  telemetry: Telemetry
  /** Number of browser tabs holding a version stream open, for the dashboard. */
  streams: () => number
}

const missingInputSchema = z.object({ hashes: z.array(blobHashSchema).max(20_000) }).strict()
const patchInputSchema = z.object({ mandatory: z.boolean().optional(), revoked: z.boolean().optional() }).strict()

function bearer(token: string): RequestHandler {
  const expected = Buffer.from(token)
  return (req, _res, next) => {
    const header = req.get('authorization') ?? ''
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'missing or invalid admin token')
    next()
  }
}

export function createAdminApp({ config, service, blobs, sessions, telemetry, streams }: AdminDeps) {
  const app = express()
  app.disable('x-powered-by')

  app.get('/health', (_req, res) => {
    res.json({ ok: true, current: service.current() })
  })

  const api = express.Router()
  api.use(bearer(config.adminToken))
  api.use(express.json({ limit: '8mb' }))

  const previewUrl = (id: string) => `${config.publicUrl ?? ''}${RUNTIME_PREFIX}/preview/${encodeURIComponent(id)}?sig=${previewSignature(config.adminToken, id)}`

  api.get('/overview', (_req, res) => {
    const counts = sessions.counts()
    res.json({
      current: service.current(),
      publicUrl: config.publicUrl,
      deployments: service.list().map((deployment) => ({ ...deployment, activeSessions: counts.get(deployment.id) ?? 0 })),
      promotions: service.promotions().slice(0, 50),
      retention: service.retention,
      gcPlan: service.planGc(),
      storage: service.storedBytes(),
      liveStreams: streams(),
      telemetry: telemetry.snapshot(),
    })
  })

  api.get('/deployments', (_req, res) => {
    res.json(service.list())
  })

  api.get('/deployments/:id', (req, res) => {
    const deployment = service.get(req.params.id)
    res.json({ ...deployment, current: deployment.id === service.current(), previewUrl: deployment.entry ? previewUrl(deployment.id) : null })
  })

  api.post('/blobs/missing', async (req, res) => {
    const { hashes } = missingInputSchema.parse(req.body)
    res.json({ missing: await service.missingBlobs(hashes) })
  })

  api.put('/blobs/:hash', async (req, res) => {
    const hash = blobHashSchema.parse(req.params.hash)
    const declared = Number(req.get('content-length'))
    if (Number.isFinite(declared) && declared > config.maxBlobBytes) throw new HttpError(413, `blob exceeds ${config.maxBlobBytes} bytes`)
    if (await blobs.has(hash)) {
      req.resume()
      return void res.status(200).json({ hash, stored: false })
    }
    const size = await blobs.put(hash, req, config.maxBlobBytes)
    res.status(201).json({ hash, size, stored: true })
  })

  api.post('/deployments', async (req, res) => {
    const summary = await service.create(req.body)
    res.status(201).json({ ...summary, previewUrl: summary.entry ? previewUrl(summary.id) : null })
  })

  api.post('/deployments/:id/promote', async (req, res) => {
    res.json(await service.promote(req.params.id, promoteInputSchema.parse(req.body ?? {})))
  })

  api.patch('/deployments/:id', async (req, res) => {
    res.json(await service.update(req.params.id, patchInputSchema.parse(req.body)))
  })

  api.delete('/deployments/:id', async (req, res) => {
    await service.remove(req.params.id)
    res.status(204).end()
  })

  api.post('/rollback', async (req, res) => {
    res.json(await service.rollback(rollbackInputSchema.parse(req.body ?? {})))
  })

  api.post('/gc', async (req, res) => {
    res.json(await service.gc(req.query.dryRun === '1' || req.query.dryRun === 'true'))
  })

  app.use('/api', api)

  // The dashboard is a static SPA served by the admin listener, same origin as its API.
  const dashboardDir = config.dashboardDir
  if (dashboardDir && existsSync(join(dashboardDir, 'index.html'))) {
    app.use(express.static(dashboardDir, { index: false, maxAge: '1y', immutable: true }))
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('cache-control', 'no-cache')
      res.sendFile(join(dashboardDir, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
