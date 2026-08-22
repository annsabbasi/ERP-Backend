-- ============================================================================
-- V1-V4 — Close the gaps QA found in the posting invariants and the GL view
--
-- All four were reproduced against the live database before being fixed.
-- ============================================================================

-- ── V1: the general ledger view counted DRAFT entries ───────────────────────
-- The status filter sat in a LEFT JOIN's ON clause. On a LEFT JOIN that does
-- not remove rows — it only nulls the right-hand side — so the journal_lines
-- row survived and SUM(jl.debit) summed every line regardless of entry status.
-- Draft entries appeared in the trial balance, balance sheet and P&L.
--
-- Reproduced: adding a 1000/1000 DRAFT entry moved the cash balance from 500
-- to 1500. The earlier test only checked that the trial balance still balanced,
-- and it did — a draft entry is itself balanced, so it adds equally to both
-- sides. Balancing is not evidence of correctness.
--
-- Filtering now happens inside a subquery, before aggregation, so accounts
-- with no lines still appear in the result.
CREATE OR REPLACE VIEW v_gl_account_balances AS
SELECT
  a."companyId", a.id AS account_id, a.code, a.name, a.type, a.subtype,
  COALESCE(SUM(l.debit), 0)  AS total_debit,
  COALESCE(SUM(l.credit), 0) AS total_credit,
  COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS raw_balance,
  CASE WHEN a.type IN ('ASSET','EXPENSE')
       THEN COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)
       ELSE COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0)
  END AS natural_balance
FROM accounts a
LEFT JOIN (
  SELECT jl."accountId", jl.debit, jl.credit
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl."entryId"
  WHERE je.status IN ('POSTED','REVERSED')
) l ON l."accountId" = a.id
GROUP BY a."companyId", a.id, a.code, a.name, a.type, a.subtype;

-- ── V3: a REVERSED entry was fully mutable ──────────────────────────────────
-- The UPDATE branch only guarded OLD.status = 'POSTED', so a reversed entry
-- could be edited freely and, worse, set back to DRAFT — after which the line
-- guard read it as a draft and permitted full line editing. Two statements and
-- immutability was gone. The DELETE branch already handled both statuses, so
-- this was an oversight rather than a decision.
CREATE OR REPLACE FUNCTION erp_journal_entry_guard() RETURNS trigger AS $fn$
DECLARE
  period_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED','REVERSED') THEN
      RAISE EXCEPTION
        'Journal entry % is % and cannot be deleted. Post a reversing entry instead.',
        OLD.number, lower(OLD.status)
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED','REVERSED') THEN
    -- The single legal transition: POSTED -> REVERSED, with the entry's
    -- identity and amounts untouched. That is how a reversal marks the entry
    -- it neutralizes. Everything else, REVERSED -> anything included, is
    -- refused.
    IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
       AND NEW.number        = OLD.number
       AND NEW."totalDebit"  = OLD."totalDebit"
       AND NEW."totalCredit" = OLD."totalCredit"
       AND NEW.date          = OLD.date
       AND NEW."periodId"    = OLD."periodId" THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'Journal entry % is % and immutable. Corrections are made by reversal, not by editing.',
      OLD.number, lower(OLD.status)
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'POSTED' AND (TG_OP = 'INSERT' OR OLD.status <> 'POSTED') THEN
    SELECT fp.status::text INTO period_status
      FROM fiscal_periods fp WHERE fp.id = NEW."periodId";
    IF period_status IN ('CLOSED','LOCKED') THEN
      RAISE EXCEPTION
        'Cannot post journal entry % into a % period.', NEW.number, lower(period_status)
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- ── V4: a line could be moved OFF a posted entry ────────────────────────────
-- The guard resolved the entry with COALESCE(NEW."entryId", OLD."entryId"). On
-- UPDATE, NEW is never null, so only the DESTINATION was checked: re-pointing
-- a line from a posted entry onto a draft one passed, silently removing value
-- from the posted entry. Both sides are evaluated now.
CREATE OR REPLACE FUNCTION erp_journal_line_guard() RETURNS trigger AS $fn$
DECLARE
  s text; n text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT je.status::text, je.number INTO s, n
      FROM journal_entries je WHERE je.id = OLD."entryId";
    IF s IN ('POSTED','REVERSED') THEN
      RAISE EXCEPTION 'Journal entry % is %; its lines cannot be changed or removed.',
        n, lower(s) USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT je.status::text, je.number INTO s, n
      FROM journal_entries je WHERE je.id = NEW."entryId";
    IF s IN ('POSTED','REVERSED') THEN
      RAISE EXCEPTION 'Journal entry % is %; lines cannot be moved onto it.',
        n, lower(s) USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_line_guard ON journal_lines;
CREATE TRIGGER journal_line_guard
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION erp_journal_line_guard();

-- ── V2: lines could be INSERTED into a posted entry ─────────────────────────
-- A plain BEFORE INSERT guard cannot be used here. Posting writes the entry
-- and its lines in one transaction, so at the moment the lines are inserted
-- the entry is already POSTED — an immediate guard would reject every
-- legitimate posting.
--
-- The real invariant is not "no inserts" but "a posted entry's lines must
-- equal its header". A DEFERRED constraint trigger checks that at COMMIT: the
-- mid-transaction state of a legitimate post is allowed, while a stray line
-- added to an already-posted entry breaks the sum and is refused. This also
-- catches the harm the entry-level guard could never see — the header saying
-- one thing while the ledger says another.
CREATE OR REPLACE FUNCTION erp_posted_entry_balance_guard() RETURNS trigger AS $fn$
DECLARE
  e RECORD; sum_dr numeric; sum_cr numeric;
BEGIN
  SELECT je.id, je.number, je.status, je."totalDebit", je."totalCredit"
    INTO e FROM journal_entries je
   WHERE je.id = COALESCE(NEW."entryId", OLD."entryId");

  -- The entry may have been removed in the same transaction (a draft being
  -- discarded), leaving nothing to check.
  IF e.id IS NULL OR e.status NOT IN ('POSTED','REVERSED') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO sum_dr, sum_cr
    FROM journal_lines WHERE "entryId" = e.id;

  IF sum_dr <> e."totalDebit" OR sum_cr <> e."totalCredit" THEN
    RAISE EXCEPTION
      'Journal entry % is posted; its lines (Dr %, Cr %) no longer match its header (Dr %, Cr %).',
      e.number, sum_dr, sum_cr, e."totalDebit", e."totalCredit"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF sum_dr <> sum_cr THEN
    RAISE EXCEPTION 'Journal entry % is out of balance: Dr % vs Cr %.',
      e.number, sum_dr, sum_cr USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_line_balance_guard ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_line_balance_guard
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION erp_posted_entry_balance_guard();
