import type { NextFunction, Request, Response } from 'express'
import type { z } from 'zod'
import { Errors } from '../lib/errors.js'

type Part = 'body' | 'query' | 'params'

/** Validates and replaces req[part] with the parsed (typed, stripped) value. Unknown keys are dropped. */
export const validate =
  <S extends z.ZodType>(schema: S, part: Part = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part])
    if (!result.success) {
      return next(Errors.validation(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))))
    }
    if (part === 'query') Object.defineProperty(req, 'query', { value: result.data, writable: true })
    else (req as unknown as Record<Part, unknown>)[part] = result.data
    next()
  }

/** Typed accessor for data already validated by `validate`. */
export const input = <T>(req: Request, part: Part = 'body') => req[part] as T
