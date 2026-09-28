import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { BlobError } from './storage/blobs'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, ...error.details })
    return
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'invalid request', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) })
    return
  }
  if (error instanceof BlobError) {
    res.status(error.code === 'too-large' ? 413 : 400).json({ error: error.message })
    return
  }
  const status = (error as { status?: number }).status
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: (error as Error).message })
    return
  }
  console.error(error)
  res.status(500).json({ error: 'internal error' })
}
