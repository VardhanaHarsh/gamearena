import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } })
}

/** Central error handler: known AppErrors are returned as-is; everything else is logged and masked. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
    return
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body.' } })
    return
  }
  logger.error({ err, path: req.path, method: req.method }, 'unhandled error')
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } })
}
