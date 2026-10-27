import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { moneyInput, parse, toMinor, uuid } from '../lib/validate.js';
import { requireAuth } from '../lib/auth.js';
import * as groups from '../services/groups.js';
import * as expenses from '../services/expenses.js';
import * as settlements from '../services/settlements.js';
import { listActivity } from '../services/activity.js';
import { groupInsights } from '../services/insights.js';
import { groupLedgerCsv } from '../services/exportCsv.js';
import { draftFromText } from '../services/quickAdd.js';

const router = Router();
router.use(requireAuth);

// Every :groupId must be a UUID; anything else is treated as "not found" rather than a 500.
router.param('groupId', (req, _res, next, id) => {
  if (!uuid.safeParse(id).success) return next(notFound('Group'));
  next();
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/* ---------------------------- groups ---------------------------- */

const groupSchema = z.object({
  name: z.string().trim().min(2, 'Group name must be at least 2 characters').max(60),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']).default('INR'),
});

router.get('/', asyncHandler(async (req, res) => {
  res.json({ groups: await groups.listGroups(req.userId) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const group = await groups.createGroup(req.userId, parse(groupSchema, req.body));
  res.status(201).json({ group });
}));

router.post('/join', asyncHandler(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(4).max(16) }), req.body);
  const group = await groups.joinByCode(req.userId, code);
  res.status(201).json({ group: { id: group.id, name: group.name } });
}));

router.get('/:groupId', asyncHandler(async (req, res) => {
  const g = await groups.getMembership(req.params.groupId, req.userId);
  const ledger = await groups.computeGroupLedger(g.id);
  res.json({
    group: {
      id: g.id, name: g.name, currency: g.currency, archivedAt: g.archived_at, createdAt: g.created_at,
      myRole: g.role, inviteCode: g.invite_code,
    },
    members: ledger.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, active: !m.left_at })),
    balances: ledger.balances,
    transfers: ledger.transfers,
  });
}));

router.post('/:groupId/leave', asyncHandler(async (req, res) => {
  await groups.leaveGroup(req.userId, req.params.groupId);
  res.status(204).end();
}));

router.delete('/:groupId/members/:userId', asyncHandler(async (req, res) => {
  await groups.removeMember(req.userId, req.params.groupId, parse(uuid, req.params.userId));
  res.status(204).end();
}));

router.post('/:groupId/transfer-ownership', asyncHandler(async (req, res) => {
  const { userId } = parse(z.object({ userId: uuid }), req.body);
  await groups.transferOwnership(req.userId, req.params.groupId, userId);
  res.status(204).end();
}));

router.post('/:groupId/invite-code', asyncHandler(async (req, res) => {
  res.json({ inviteCode: await groups.regenerateInvite(req.userId, req.params.groupId) });
}));

router.post('/:groupId/archive', asyncHandler(async (req, res) => {
  const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
  await groups.setArchived(req.userId, req.params.groupId, archived);
  res.status(204).end();
}));

/* --------------------------- expenses --------------------------- */

const expenseSchema = z.object({
  description: z.string().trim().min(1, 'Add a description').max(120),
  amount: moneyInput,
  paidBy: uuid,
  category: z.enum(expenses.CATEGORIES).default('other'),
  splitType: z.enum(['equal', 'exact', 'percent', 'shares']),
  expenseDate: date.optional(),
  participants: z.array(z.object({ userId: uuid, value: z.union([z.number(), z.string()]).optional().nullable() })).min(1, 'Choose at least one person').max(50),
  idempotencyKey: uuid.optional(),
  source: z.enum(['manual', 'ai', 'rules']).optional(),
  version: z.number().int().positive().optional(),
});

/** Exact split values arrive as decimal money; convert them to minor units. Other types stay numeric. */
function normalizeParticipants(body) {
  body.participants = body.participants.map((p) => {
    if (body.splitType === 'equal') return { userId: p.userId };
    if (p.value === null || p.value === undefined || p.value === '') {
      throw badRequest('Enter a value for every person in the split');
    }
    return { userId: p.userId, value: body.splitType === 'exact' ? toMinor(p.value) : Number(p.value) };
  });
  return body;
}

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(expenses.CATEGORIES).optional(),
  paidBy: uuid.optional(),
  from: date.optional(),
  to: date.optional(),
  involvesMe: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/:groupId/expenses', asyncHandler(async (req, res) => {
  await groups.getMembership(req.params.groupId, req.userId);
  res.json(await expenses.listExpenses(req.userId, req.params.groupId, parse(listSchema, req.query)));
}));

router.get('/:groupId/expenses/:expenseId', asyncHandler(async (req, res) => {
  await groups.getMembership(req.params.groupId, req.userId);
  const e = await expenses.getExpense(parse(uuid, req.params.expenseId));
  if (e.groupId !== req.params.groupId) throw notFound('Expense');
  res.json({ expense: e });
}));

router.post('/:groupId/expenses', asyncHandler(async (req, res) => {
  const body = normalizeParticipants(parse(expenseSchema, req.body));
  const expense = await expenses.createExpense(req.userId, req.params.groupId, body);
  res.status(expense.duplicate ? 200 : 201).json({ expense });
}));

router.put('/:groupId/expenses/:expenseId', asyncHandler(async (req, res) => {
  const body = normalizeParticipants(parse(expenseSchema.required({ version: true }), req.body));
  const expense = await expenses.updateExpense(req.userId, req.params.groupId, parse(uuid, req.params.expenseId), body);
  res.json({ expense });
}));

router.delete('/:groupId/expenses/:expenseId', asyncHandler(async (req, res) => {
  await expenses.deleteExpense(req.userId, req.params.groupId, parse(uuid, req.params.expenseId));
  res.status(204).end();
}));

// AI calls cost money and time: cap them per user.
const quickAddLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 30, keyGenerator: (req) => req.userId, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Quick add limit reached, try again in a few minutes or add it manually' } },
});

router.post('/:groupId/expenses/draft', quickAddLimiter, asyncHandler(async (req, res) => {
  const { text } = parse(z.object({ text: z.string().trim().min(3, 'Describe the expense').max(500) }), req.body);
  const g = await groups.getMembership(req.params.groupId, req.userId);
  groups.assertWritable(g);
  const members = (await groups.listMembers(g.id)).filter((m) => !m.left_at);
  const me = members.find((m) => m.id === req.userId);
  res.json(await draftFromText(text, members, me));
}));

/* -------------------------- settlements ------------------------- */

const settlementSchema = z.object({
  fromUser: uuid,
  toUser: uuid,
  amount: moneyInput,
  note: z.string().trim().max(120).optional(),
  idempotencyKey: uuid.optional(),
});

router.get('/:groupId/settlements', asyncHandler(async (req, res) => {
  await groups.getMembership(req.params.groupId, req.userId);
  res.json({ settlements: await settlements.listSettlements(req.params.groupId) });
}));

router.post('/:groupId/settlements', asyncHandler(async (req, res) => {
  const s = await settlements.createSettlement(req.userId, req.params.groupId, parse(settlementSchema, req.body));
  res.status(s.duplicate ? 200 : 201).json({ settlement: s });
}));

router.delete('/:groupId/settlements/:settlementId', asyncHandler(async (req, res) => {
  await settlements.deleteSettlement(req.userId, req.params.groupId, parse(uuid, req.params.settlementId));
  res.status(204).end();
}));

/* ----------------------- activity & insights --------------------- */

router.get('/:groupId/activity', asyncHandler(async (req, res) => {
  await groups.getMembership(req.params.groupId, req.userId);
  const { before } = parse(z.object({ before: z.coerce.number().int().positive().optional() }), req.query);
  res.json(await listActivity(req.params.groupId, { before }));
}));

router.get('/:groupId/insights', asyncHandler(async (req, res) => {
  await groups.getMembership(req.params.groupId, req.userId);
  res.json(await groupInsights(req.params.groupId, req.userId));
}));

router.get('/:groupId/export.csv', asyncHandler(async (req, res) => {
  const g = await groups.getMembership(req.params.groupId, req.userId);
  const safeName = g.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'group';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-ledger.csv"`);
  res.send(await groupLedgerCsv(g.id));
}));

export default router;
