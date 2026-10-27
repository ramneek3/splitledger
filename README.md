# SplitLedger

**Shared-expense ledger for flatmates, trips and student groups. Tracks who paid what, splits it fairly to the paisa, and works out the fewest payments needed to settle everyone up.**

- **Live app:** `<DEPLOYMENT_URL>` (demo login: `demo@splitledger.app` / `demo12345`)
- **Demo video:** `<DEMO_VIDEO_URL>`
- **Docs:** [Architecture](docs/ARCHITECTURE.md) · [API reference](docs/API.md)

---

## Problem statement

People who share costs (flatmates splitting rent and Wi-Fi, friends on a trip, a hostel floor ordering food) usually track them in a WhatsApp chat or a spreadsheet. This breaks down in predictable ways:

- **Uneven splits are error-prone.** "Aman had two drinks", "Riya pays 40% because she has the bigger room", or ₹100 split three ways (₹33.33 + ₹33.33 + ₹33.34). Hand calculations drift and someone loses a few rupees every time.
- **Nobody knows the real balance.** After 30 expenses paid by different people, working out who owes whom takes manual netting.
- **Settling up takes too many transfers.** If A owes B and B owes C, the naive approach is two UPI payments when one (A → C) is enough.
- **Edits and disputes leave no trail.** In a spreadsheet anyone can overwrite anything silently.

## Target users

- Students and young professionals sharing a flat or PG (recurring rent, utilities, groceries)
- Friend groups on trips (many expenses over a few days, settled once at the end)
- Clubs and hostel groups pooling money for events

## Solution

SplitLedger gives each group a shared, append-only ledger. Every expense is split precisely in integer paise, balances are always derived from the ledger (never stored separately, so they can't drift), and a debt-simplification algorithm turns those balances into the minimum practical set of "X pays Y" transfers. Payments recorded against that plan are validated so a group can never get into an inconsistent state. To make entry fast, a **quick-add** box turns a sentence such as *"Riya paid 1500 for pizza with Aman"* into a pre-filled form (Claude-powered, with a rule-based fallback) that the user reviews before saving.

## Core workflows

| # | Workflow | What happens |
|---|----------|--------------|
| 1 | **Sign up and form a group** | Register → create group (currency) → share invite link/code → friends join. Owner/member roles. |
| 2 | **Record an expense** | Choose payer, people and split mode (equal / exact / percent / shares) → live preview of every share → server re-validates and stores exact paise. Edit/delete with permission checks and conflict detection. |
| 3 | **Quick add (AI)** | Type a sentence → Claude extracts structured fields (JSON-schema constrained) → server resolves names to members, validates amounts, dates and split maths, attaches warnings → user confirms → normal save path. |
| 4 | **See balances and settle up** | Net balance per member → simplified transfer plan → "Record" a payment → server checks it doesn't exceed what's owed (under a row lock) → balances update; undo available. |
| 5 | **Review and close out** | Search/filter expenses, monthly and category insights, full activity log, CSV export; once everyone is settled the owner can archive the group (read-only). |

## Key features

- **Accurate money maths:** all amounts in integer minor units; largest-remainder rounding so shares always sum exactly to the total
- **Four split modes** with client-side live preview and server-side authoritative validation
- **Debt simplification:** greedy creditor/debtor matching, at most *n − 1* transfers
- **Settlement guardrails:** payer must owe, receiver must be owed, amount ≤ outstanding; concurrent submissions serialized with `SELECT … FOR UPDATE`
- **Idempotent writes:** every create form sends an idempotency key, so double-clicks and retries don't duplicate expenses or payments
- **Optimistic concurrency:** edits carry a `version`; stale edits get `409 VERSION_CONFLICT` instead of silently overwriting
- **Authorization:** membership checked on every group route (non-members get 404, not 403, so group ids can't be probed); only the creator or owner can edit/delete an expense; owner-only member management, invite reset, archive
- **Lifecycle rules:** you can't leave or be removed with a non-zero balance; the owner must transfer ownership before leaving; archived groups are read-only
- **AI quick add with fallback:** Claude (`claude-opus-5-5`, structured output, low effort, timeout + 1 retry, per-user rate limit) → automatic fallback to a deterministic parser when no key is set or the API fails
- **Audit trail:** every change is written to an activity log in the same transaction as the change
- **Insights:** 6-month spend vs your share, by-category and by-payer breakdowns
- **CSV export** with spreadsheet formula-injection protection
- **UX states:** loading, empty, error-with-retry, success toasts, inline field errors, responsive layout, light/dark themes

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React 18, React Router, Vite, plain CSS | Small SPA; no UI kit needed |
| Backend | Node 22, Express 4 | Simple, well understood, easy to deploy |
| Database | PostgreSQL 16 (`pg`) | Relational data, transactions, row locks, partial unique indexes for idempotency |
| Validation | Zod | One schema per endpoint, field-level error messages |
| Auth | bcrypt + JWT in an httpOnly, SameSite=Lax cookie | No token in JS (XSS), Lax blocks cross-site POST (CSRF) |
| AI | Anthropic SDK (`@anthropic-ai/sdk`), Claude structured outputs | Reliable JSON extraction; output is still re-validated |
| Security middleware | helmet (CSP etc.), express-rate-limit | Headers, brute-force and AI-cost protection |
| Tests | `node:test` + supertest against real Postgres | Exercises real SQL, locks and constraints |
| Deploy | Render Blueprint (web + Postgres), Dockerfile, GitHub Actions CI | One-click deploy; portable image |

## Architecture

```
Browser (React SPA)
   │  fetch /api/* (same-origin, httpOnly session cookie)
   ▼
Express app ──► routes/ (HTTP: auth, zod validation, status codes)
                  │
                  ▼
               services/ (business rules, transactions)
                 ├─ splits.js      pure split calculator
                 ├─ ledger.js      pure balances + debt simplification
                 ├─ groups.js      membership, roles, lifecycle rules
                 ├─ expenses.js    create/edit/delete, idempotency, versioning
                 ├─ settlements.js validated repayments under row lock
                 ├─ quickAdd.js    Claude / rules → normalize → draft
                 └─ insights.js, exportCsv.js, activity.js
                  │
                  ▼
               PostgreSQL (users, groups, group_members, expenses,
                           expense_splits, settlements, activity)
```

In production the same Express process serves the built React app, so it is a single deployable service with same-origin cookies. See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the data model, key design decisions and the error-handling strategy.

## Local setup

Prerequisites: Node 20+ and Docker (for Postgres).

```bash
git clone <REPO_URL> splitledger && cd splitledger
cp .env.example .env            # then set JWT_SECRET (openssl rand -hex 32)
docker compose up -d db         # Postgres on localhost:5433 (+ a test database)
npm install
npm run seed                    # optional: demo account + sample data
npm run dev                     # API on :4000, React dev server on :5173
```

Open http://localhost:5173. Migrations run automatically when the server starts (`npm run migrate` runs them by hand).

Run the tests (needs the Docker database running):

```bash
npm test
```

Production-style run (API serves the built client on :4000):

```bash
npm run build && npm start
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes (prod) | Postgres connection string |
| `DATABASE_SSL` | no | `true` for hosted Postgres that needs TLS from outside its network (e.g. Neon) |
| `JWT_SECRET` | yes (prod) | Long random string used to sign session tokens |
| `ANTHROPIC_API_KEY` | no | Enables Claude-powered quick add. Without it the rule-based parser is used |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5-5` |
| `AI_TIMEOUT_MS` | no | Claude request timeout, default `12000` |
| `SEED_DEMO` | no | `true` creates the demo account on startup (skipped if it already exists) |
| `PORT` | no | Default `4000` |

`.env` is git-ignored; `.env.example` documents the variables without secrets. In development the server falls back to safe local defaults; in production a missing `DATABASE_URL` or `JWT_SECRET` stops the server from starting.

## Deployment

**Render (recommended, free tier):**
1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → select the repo. `render.yaml` provisions a Postgres database and the web service, generates `JWT_SECRET`, and seeds the demo account.
3. Optionally add `ANTHROPIC_API_KEY` under the service's Environment tab.
4. The app is served at `https://<service>.onrender.com`; `/api/health` reports database connectivity.

**Docker (any host):**
```bash
docker build -t splitledger .
docker run -p 4000:4000 -e NODE_ENV=production -e DATABASE_URL=... -e JWT_SECRET=... splitledger
```

CI (`.github/workflows/ci.yml`) runs the full test suite against Postgres and builds the client on every push.

## Project structure

```
client/                 React SPA (Vite)
  src/pages/            Auth, Dashboard, Group (+ tabs), Join
  src/components/       ExpenseForm, SettleForm, shared UI
  src/api.js            fetch wrapper → typed ApiError
server/
  src/routes/           HTTP layer (validation, status codes)
  src/services/         business logic (pure maths + transactional services)
  src/db/               pool, migrations, seed
  test/                 unit + API integration tests
docs/                   architecture and API reference
render.yaml, Dockerfile, docker-compose.yml, .github/workflows/ci.yml
```

## Known limitations / next steps

- Single currency per group (no FX conversion between groups)
- No email notifications or payment-provider integration; payments are recorded, not executed
- Members who have left still appear in history but cannot be added to new expenses or kept in an edited one

## AI usage

Built with AI assistance (Claude) as an engineering tool for scaffolding and review. Design decisions, the domain rules, and the test suite were reviewed and verified by running them. The in-app quick-add feature calls the Claude API at runtime.
