import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { asyncHandler, conflict, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { clearSession, issueSession, requireAuth } from '../lib/auth.js';

const router = Router();

// Slow down credential stuffing / brute force on the two unauthenticated endpoints.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please wait a few minutes' } } });

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password').max(128) });

// Compared against when the email doesn't exist so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const body = parse(registerSchema, req.body);
  const hash = await bcrypt.hash(body.password, 10);
  try {
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email`,
      [body.name, body.email, hash],
    );
    issueSession(res, rows[0]);
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
    if (err.code === '23505') throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    throw err;
  }
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const body = parse(loginSchema, req.body);
  const { rows } = await query(`SELECT * FROM users WHERE lower(email) = $1`, [body.email]);
  const user = rows[0];
  const ok = await bcrypt.compare(body.password, user?.password_hash || DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  issueSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT id, name, email FROM users WHERE id = $1`, [req.userId]);
  if (!rows[0]) {
    clearSession(res);
    throw unauthorized();
  }
  res.json({ user: rows[0] });
}));

export default router;
