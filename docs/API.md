# API reference

Base path `/api`. JSON in and out. Authentication is the `sl_session` httpOnly cookie set by register/login.
Errors are always `{ "error": { "code": "...", "message": "...", "details": {...}? } }`.
Money fields in requests are decimal strings or numbers (`"1234.50"`); in responses they are integer minor units (`123450`).

## Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` | 201, sets cookie. 409 `EMAIL_TAKEN` |
| POST | `/auth/login` | `{ email, password }` | 401 on bad credentials. Rate limited |
| POST | `/auth/logout` | | 204, clears cookie |
| GET | `/auth/me` | | Current user or 401 |

## Groups
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/groups` | | Your groups, each with `my_net` |
| POST | `/groups` | `{ name, currency }` | 201 |
| POST | `/groups/join` | `{ code }` | 201. 404 bad code, 409 `ALREADY_MEMBER` |
| GET | `/groups/:id` | | Group, members, `balances[]`, simplified `transfers[]` |
| POST | `/groups/:id/leave` | | 409 `UNSETTLED_BALANCE` / `OWNER_MUST_TRANSFER` |
| DELETE | `/groups/:id/members/:userId` | | Owner only. Member must be settled |
| POST | `/groups/:id/transfer-ownership` | `{ userId }` | Owner only |
| POST | `/groups/:id/invite-code` | | Owner only. Returns new code |
| POST | `/groups/:id/archive` | `{ archived: boolean }` | Owner only. Archiving requires everyone settled |

## Expenses
| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/groups/:id/expenses` | `?q&category&paidBy&from&to&involvesMe&limit&offset` | `{ items[], total, totalAmount }`; items include `myShare` |
| GET | `/groups/:id/expenses/:eid` | | Includes `splits[]` |
| POST | `/groups/:id/expenses` | `{ description, amount, paidBy, category, splitType, expenseDate?, participants: [{ userId, value? }], idempotencyKey? }` | 201 created, or 200 with `duplicate: true` for a repeated key |
| PUT | `/groups/:id/expenses/:eid` | same + `version` | 409 `VERSION_CONFLICT` if stale. Creator or owner |
| DELETE | `/groups/:id/expenses/:eid` | | Soft delete. Creator or owner |
| POST | `/groups/:id/expenses/draft` | `{ text }` | Quick add. `{ draft, source: 'ai' or 'rules', fallbackReason? }`. Saves nothing |

`participants[].value` means: `exact` → amount, `percent` → percentage (total 100), `shares` → weight. Omit it for `equal`.

## Settlements
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/groups/:id/settlements` | | Latest 100 |
| POST | `/groups/:id/settlements` | `{ fromUser, toUser, amount, note?, idempotencyKey? }` | 409 `SETTLEMENT_EXCEEDS_DEBT` (`details.max`), `NOTHING_OWED` |
| DELETE | `/groups/:id/settlements/:sid` | | Undo. Recorder or owner |

## Other
| Method | Path | Notes |
|---|---|---|
| GET | `/groups/:id/activity?before=` | Cursor-paginated audit log |
| GET | `/groups/:id/insights` | `byMonth` (6 months, total vs mine), `byCategory`, `byPayer`, `myShare`, `groupTotal` |
| GET | `/groups/:id/export.csv` | Full ledger as CSV |
| GET | `/health` | `{ status: 'ok' }` or 503 if the database is unreachable |
