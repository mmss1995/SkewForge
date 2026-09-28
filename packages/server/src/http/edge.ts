import { createHmac, timingSafeEqual } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import {
  DEPLOYMENT_HEADER,
  DEPLOYMENT_META,
  DEPLOYMENT_QUERY,
  PREVIEW_COOKIE,
  RESOLUTION_HEADER,
  RUNTIME_PREFIX,
  SERVED_BY_HEADER,
  beaconSchema,
  looksLikeRoute,
  normalizeAssetPath,
  resolveAsset,
  resolveDocument,
  type Deployment,
} from '@skewforge/core'
import type { Config } from '../config'
import { errorHandler, HttpError } from '../errors'
import type { DeploymentService } from '../service'
import type { SessionTracker } from '../sessions'
import type { BlobStore } from '../storage/blobs'
import type { Telemetry } from '../telemetry'
import { VersionStreamHub } from './stream'

export interface EdgeDeps {
  config: Pick<Config, 'adminToken' | 'spaFallback'>
  service: DeploymentService
  blobs: BlobStore
  sessions: SessionTracker
  telemetry: Telemetry
}

/** Signed so that knowing a staged deployment's id is not enough to see it. */
export function previewSignature(secret: string, id: string): string {
  return createHmac('sha256', secret).update(`preview:${id}`).digest('base64url').slice(0, 32)
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return null
}

/** Injects (or rewrites) `<meta name="skewforge-deployment">` so the client knows what it runs. */
export function injectDeploymentMeta(html: string, id: string): string {
  const tag = `<meta name="${DEPLOYMENT_META}" content="${id}">`
  const existing = new RegExp(`<meta\\s+name=["']${DEPLOYMENT_META}["'][^>]*>`, 'i')
  if (existing.test(html)) return html.replace(existing, tag)
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (!head) return tag + html
  const end = head.index + head[0].length
  return html.slice(0, end) + tag + html.slice(end)
}

export function createEdgeApp({ config, service, blobs, sessions, telemetry }: EdgeDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)
  const hub = new VersionStreamHub(service)
  const htmlCache = new Map<string, string>()

  function previewOf(req: Request): string | null {
    const cookie = readCookie(req, PREVIEW_COOKIE)
    if (!cookie) return null
    const dot = cookie.lastIndexOf('.')
    const id = cookie.slice(0, dot)
    const expected = Buffer.from(previewSignature(config.adminToken, id))
    const actual = Buffer.from(cookie.slice(dot + 1))
    return dot > 0 && expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null
  }

  function runningOf(req: Request): string | null {
    const running = req.query.running
    return typeof running === 'string' && running !== '' ? running : null
  }

  // ─── Runtime endpoints the browser client talks to ───
  const runtime = express.Router()
  runtime.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store')
    next()
  })
  runtime.get('/version', (req, res) => {
    res.json(service.status(runningOf(req)))
  })
  runtime.get('/stream', (req, res) => {
    hub.attach(res, runningOf(req))
  })
  // sendBeacon posts text/plain to dodge CORS preflights; accept both.
  runtime.post('/beacon', express.json({ limit: '1kb', type: ['application/json', 'text/plain'] }), (req, res) => {
    const beacon = beaconSchema.parse(req.body)
    if (service.index.deployment(beacon.deployment)) sessions.touch(beacon.session, beacon.deployment)
    res.status(204).end()
  })
  runtime.post('/beacon/end', express.json({ limit: '1kb', type: ['application/json', 'text/plain'] }), (req, res) => {
    const session = (req.body as { session?: unknown } | undefined)?.session
    if (typeof session === 'string') sessions.end(session)
    res.status(204).end()
  })
  runtime.get('/preview/:id', (req, res) => {
    const { id } = req.params
    if (req.query.sig !== previewSignature(config.adminToken, id)) throw new HttpError(403, 'invalid preview signature')
    const deployment = service.index.deployment(id)
    if (!deployment?.entry) throw new HttpError(404, `deployment "${id}" has no page to preview`)
    res.cookie(PREVIEW_COOKIE, `${id}.${req.query.sig}`, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60 * 1000 })
    res.redirect(302, '/')
  })
  runtime.get('/exit-preview', (_req, res) => {
    res.clearCookie(PREVIEW_COOKIE, { path: '/' })
    res.redirect(302, '/')
  })
  app.use(RUNTIME_PREFIX, runtime)

  // ─── Everything else: static files from whichever deployment should answer ───
  async function sendDocument(res: Response, deployment: Deployment, preview: boolean): Promise<void> {
    const entry = deployment.files[deployment.entry!]!
    const cacheKey = `${deployment.id}:${entry.hash}`
    let html = htmlCache.get(cacheKey)
    if (html === undefined) {
      html = injectDeploymentMeta(await blobs.readText(entry.hash), deployment.id)
      htmlCache.set(cacheKey, html)
      if (htmlCache.size > 50) htmlCache.delete(htmlCache.keys().next().value!)
    }
    res.setHeader('content-type', entry.type)
    // Documents must always be revalidated: they are what points a tab at a deployment.
    res.setHeader('cache-control', preview ? 'private, no-store' : 'no-cache')
    res.setHeader(SERVED_BY_HEADER, deployment.id)
    res.send(html)
  }

  function refererOf(req: Request) {
    const header = req.get('referer')
    if (!header) return null
    try {
      const url = new URL(header)
      if (url.host !== req.get('host')) return null
      const path = normalizeAssetPath(url.pathname)
      return path === null ? null : { path, dpl: url.searchParams.get(DEPLOYMENT_QUERY) }
    } catch {
      return null
    }
  }

  app.use(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    const path = normalizeAssetPath(req.path)
    if (path === null) throw new HttpError(400, 'invalid path')

    const preview = previewOf(req)
    const visible = (deployment: Deployment) => deployment.promotedAt !== null || deployment.id === preview
    const query = req.query[DEPLOYMENT_QUERY]
    const pinned = (typeof query === 'string' ? query : null) ?? req.get(DEPLOYMENT_HEADER) ?? preview

    const index = service.index
    const resolution = resolveAsset(index, { path, pinned, referer: refererOf(req), visible })
    if (resolution) {
      const { deployment, file, via, skewed, rescued } = resolution
      telemetry.served(path, deployment.id, via, skewed, rescued)
      if (path === deployment.entry) return sendDocument(res, deployment, preview !== null)

      const etag = `"${file.hash}"`
      res.setHeader('content-type', file.type)
      res.setHeader('etag', etag)
      res.setHeader('cache-control', file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      res.setHeader(SERVED_BY_HEADER, deployment.id)
      res.setHeader(RESOLUTION_HEADER, via)
      if (req.get('if-none-match') === etag) return void res.status(304).end()
      res.setHeader('content-length', String(file.size))
      if (req.method === 'HEAD') return void res.end()
      const stream = blobs.read(file.hash)
      stream.on('error', next)
      stream.pipe(res)
      return
    }

    if (config.spaFallback && looksLikeRoute(path) && req.accepts(['html', 'json']) === 'html') {
      const document = resolveDocument(index, preview)
      if (document) {
        telemetry.served(path, document.id, preview ? 'pinned' : 'current', false, false)
        return sendDocument(res, document, preview !== null)
      }
      res.status(503).setHeader('retry-after', '10').type('text/plain').send('No deployment is live yet.\n')
      return
    }

    telemetry.missed(path)
    res.status(404).setHeader('cache-control', 'no-cache').type('text/plain').send('Not found\n')
  })

  app.use(errorHandler)
  return { app, hub }
}
