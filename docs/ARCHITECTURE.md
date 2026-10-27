# Architecture

## Components

| Component | Responsibility |
|-----------|----------------|
| **React SPA** (`client/`) | UI, routing, optimistic form previews. Holds no business truth: every rule is re-checked by the server. |
| **Routes** (`server/src/routes`) | HTTP concerns only: auth middleware, Zod validation, mapping results to status codes. |
| **Services** (`server/src/services`) | Business rules. Two kinds: **pure modules** (`splits.js`, `ledger.js`) with no I/O, unit-tested directly; **transactional services** (`groups`, `expenses`, `settlements`) that wrap each use case in one DB transaction. |
| **PostgreSQL** | Source of truth. Constraints (CHECKs, FKs, partial unique indexes) back up application validation. |
| **Claude API** (optional) | Extracts structured fields from a free-text expense description. Never writes data directly. |

## Data model

```
users ─┬─< group_members >─┬─ groups
       │   (role, left_at) │   (currency, invite_code, archived_at)
       │                   │
       ├─< expenses ───────┤   (amount_minor, paid_by, split_type, version,
       │      │            │    idempotency_key, deleted_at)
       │      └─< expense_splits (user_id, share_minor, input_value)
       │                   │
       ├─< settlements ────┤   (from_user, to_user, amount_minor, idempotency_key, deleted_at)
       └─< activity ───────┘   (type, payload jsonb)
```

- **Money is `BIGINT` minor units.** No floats anywhere in storage or ledger maths.
- **Balances are derived, never stored.** `net = paid − owed + sent − received` is computed from the ledger on read, so there is no second copy that can drift out of sync.
- **Soft deletes** (`deleted_at`) on expenses and settlements keep history and the audit trail intact.
- **Membership has `left_at`** instead of being deleted, because old expenses still reference people who left.
- `expense_splits.input_value` stores what the user typed (percent / shares / exact), so an edit form can show the original intent, not just the computed paise.

## Key design decisions

### 1. Exact splitting (largest remainder)
`computeSplits` converts every split type into proportional weights and uses the largest-remainder method: floor each exact share, then hand the leftover paise to the largest fractional parts (ties by participant order). Shares always sum exactly to the total, and recomputing gives the same result. A property test checks this on 500 random inputs.

### 2. Debt simplification
`simplifyDebts` repeatedly matches the largest creditor with the largest debtor and transfers `min(credit, debt)`. Each step zeroes at least one person, so there are at most *n − 1* transfers, and nobody already at zero is routed through. (A true minimum is NP-hard in general; greedy is optimal or near-optimal for the group sizes this app targets, and easy to explain.)

### 3. Settlement validation under a lock
A settlement must not exceed `min(payer's debt, receiver's credit)`, otherwise it would create a new loan instead of repaying one. Validation reads balances and then inserts, so two concurrent requests could both pass against the same stale balance. Every balance-changing transaction therefore starts with `SELECT … FROM groups … FOR UPDATE`, which serializes writes per group. The test suite fires two settlements at once and asserts exactly one succeeds.

### 4. Idempotency keys
Forms generate a UUID when opened and send it with the create request. A partial unique index `(group_id, idempotency_key)` plus a lookup inside the transaction means a double-click or network retry returns the original record (`200`, `duplicate: true`) instead of creating a second one.

### 5. Optimistic concurrency on edits
Expenses carry a `version`. `PUT` must send the version it loaded; on a mismatch the server returns `409 VERSION_CONFLICT` and the UI offers to reload, so two people editing the same expense can't silently overwrite each other.

### 6. Authorization model
- Every `/api/groups/:id/*` route loads the caller's **active** membership first. Non-members get **404** (not 403), so group ids can't be probed.
- Expense edit/delete: the creator or the group owner. Settlement record: the payer, the receiver, or the owner. Settlement undo: whoever recorded it, or the owner.
- Owner-only: remove member, transfer ownership, reset invite code, archive.
- Lifecycle invariants: you can't leave or be removed with a non-zero balance; an owner with other members must transfer ownership first; archiving requires everyone settled; archived groups reject writes (`409 GROUP_ARCHIVED`).

### 7. AI quick add: the model proposes, the server decides
```
text ─► Claude (JSON-schema structured output, effort=low, 12s timeout, 1 retry)
     └► on missing key / API error / refusal ─► deterministic rule parser
                         │
                         ▼
                 normalize(): resolve names → member ids (ambiguity = warning),
                 validate amount/date/category, run computeSplits, fall back to an
                 equal split if the model's numbers don't add up, collect warnings
                         │
                         ▼
                 draft ─► shown in the normal form ─► user edits/confirms ─► normal POST
```
- The user's text is wrapped as data and the prompt says so; output is constrained by a JSON schema and then treated as untrusted input.
- Nothing is saved without the user's confirmation, and the save goes through the same validation as a manual entry.
- AI requests are rate-limited per user (30 per 10 minutes) to bound cost.
- The response says whether Claude or the rules produced the draft, and why it fell back.

### 8. Sessions
JWT signed with `JWT_SECRET`, stored in an `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookie, valid for 7 days. Login and register are rate-limited, and login compares against a dummy hash when the email doesn't exist, so response timing doesn't reveal which emails are registered.

## Error handling strategy

- Services throw `AppError(status, code, message, details)`. A single Express error handler turns every failure into `{ error: { code, message, details? } }`.
- Validation errors (`400`) include `details.fields` so the UI can show messages next to inputs.
- Stable codes the client branches on: `VERSION_CONFLICT`, `SETTLEMENT_EXCEEDS_DEBT` (with `details.max`, which drives a "use the maximum" button), `ALREADY_MEMBER` (redirect into the group), `UNSETTLED_BALANCE`, `GROUP_ARCHIVED`, `RATE_LIMITED`, `EMAIL_TAKEN`.
- Postgres errors are mapped: unique violations become domain conflicts, invalid UUID syntax becomes 404. Unknown errors become a generic 500 (logged server-side; no stack traces sent to clients).
- Client: network failures become `ApiError('NETWORK')` with a friendly message; any 401 mid-session returns the user to the login screen; every data view has loading, empty and error-with-retry states; stale requests are aborted when filters change.
- External API failure (Claude) never blocks the workflow: it degrades to the rule parser and tells the user.

## Testing

| Suite | What it covers |
|-------|----------------|
| `ledger.unit.test.js` | Split maths for all modes, rounding property test, balance derivation, debt simplification |
| `quickAdd.unit.test.js` | Rule parser, name resolution and ambiguity, normalize() rejecting bad model output |
| `api.test.js` | Auth flows, 404-for-non-members, duplicate join, full expense → balance → edit conflict → settle → leave → archive workflow, idempotency, concurrent settlement race, search/filters, insights, CSV injection, quick-add endpoint |

Integration tests run against a real Postgres database (separate `splitledger_test` database), locally via docker-compose and in GitHub Actions.
