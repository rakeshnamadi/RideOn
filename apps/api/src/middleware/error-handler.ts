import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}`, requestId: req.requestId } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId;
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, requestId }, err.message);
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these details already exists', requestId } });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found', requestId } });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({ error: { code: 'REFERENCE_CONFLICT', message: 'A referenced record does not exist or is in use', requestId } });
    }
  }
  if (err instanceof MulterError) {
    return res.status(400).json({ error: { code: 'UPLOAD_REJECTED', message: err.message, requestId } });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body', requestId } });
  }
  logger.error({ err, requestId }, 'Unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId } });
}
