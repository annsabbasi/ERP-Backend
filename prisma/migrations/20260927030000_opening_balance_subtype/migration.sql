-- QA D11: the equity account opening balances are credited to.
-- A migration of its own: Postgres refuses to use an enum value in the same
-- transaction that added it, and 20260927030600 creates accounts carrying it.
ALTER TYPE "AccountSubtype" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE_EQUITY';
