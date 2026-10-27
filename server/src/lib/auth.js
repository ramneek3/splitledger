import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized } from './errors.js';

export const COOKIE_NAME = 'sl_session';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: `${config.sessionDays}d` });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // not readable from JS -> XSS cannot steal the session
    sameSite: 'lax', // blocks cross-site POSTs (CSRF) while allowing normal navigation
    secure: config.isProd,
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Express middleware: requires a valid session cookie and sets req.userId. */
export function requireAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.sub;
    next();
  } catch {
    next(unauthorized('Your session has expired, please sign in again'));
  }
}
