import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppError } from './lib/errors.js';
import { query } from './db/pool.js';
import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway proxy: needed for secure cookies + rate-limit IPs
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] },
    },
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'API route not found')));

  // Serve the built React app (single deployable service, same-origin cookies).
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Central error handler: every failure becomes { error: { code, message, details? } }.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request is too large' } });
    }
    if (err.code === '22P02') { // invalid uuid / number syntax from Postgres
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    const status = err instanceof AppError || (err.status && err.code) ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: {
        code: status >= 500 ? 'INTERNAL' : err.code,
        message: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
        ...(status < 500 && err.details && { details: err.details }),
      },
    });
  });

  return app;
}
