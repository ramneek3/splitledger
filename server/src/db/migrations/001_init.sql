-- SplitLedger initial schema.
-- All money is stored as BIGINT minor units (paise / cents) to avoid floating point drift.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  currency    CHAR(3) NOT NULL DEFAULT 'INR',
  invite_code TEXT NOT NULL UNIQUE,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  paid_by         UUID NOT NULL REFERENCES users(id),
  category        TEXT NOT NULL DEFAULT 'other',
  split_type      TEXT NOT NULL CHECK (split_type IN ('equal', 'exact', 'percent', 'shares')),
  expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by      UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX expenses_group_date_idx ON expenses (group_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX expenses_idem_idx ON expenses (group_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE expense_splits (
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  share_minor BIGINT NOT NULL CHECK (share_minor >= 0),
  input_value NUMERIC,           -- the raw value the user typed (percent, shares, exact amount)
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user       UUID NOT NULL REFERENCES users(id),
  to_user         UUID NOT NULL REFERENCES users(id),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  note            TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CHECK (from_user <> to_user)
);
CREATE INDEX settlements_group_idx ON settlements (group_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX settlements_idem_idx ON settlements (group_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE activity (
  id         BIGSERIAL PRIMARY KEY,
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id   UUID NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_group_idx ON activity (group_id, id DESC);
