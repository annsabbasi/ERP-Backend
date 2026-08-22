-- ============================================================================
-- F8 — Posting invariants, enforced by the database
--
-- The roadmap never states the most important rule in an accounting system: a
-- posted journal entry is immutable. The service layer already enforces this,
-- but the audit's own testing note is the point — application code enforces a
-- rule perfectly right up until one endpoint forgets. These triggers make the
-- invariants hold for any writer: a script, a psql session, a future module.
--
--   1. A POSTED entry cannot be edited. Corrections happen by reversal.
--   2. A POSTED entry cannot be deleted.
--   3. Lines of a posted entry cannot be edited or deleted.
--   4. Nothing may post into a period that is closed or locked.
--
-- Deliberately NOT enforced here: the debit = credit balance check. It cannot
-- be evaluated per-row while lines are still being inserted inside the same
-- transaction. That check stays in the service, which sees the whole entry.
-- ============================================================================

CREATE OR REPLACE FUNCTION erp_journal_entry_guard() RETURNS trigger AS $$
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

  IF TG_OP = 'UPDATE' AND OLD.status = 'POSTED' THEN
    -- The only legal transition out of POSTED is to REVERSED, which is how a
    -- reversal marks the entry it neutralizes.
    IF NEW.status = 'REVERSED' AND NEW.number = OLD.number
       AND NEW."totalDebit" = OLD."totalDebit"
       AND NEW."totalCredit" = OLD."totalCredit"
       AND NEW.date = OLD.date THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'Journal entry % is posted and immutable. Corrections are made by reversal, not by editing.',
      OLD.number
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Posting into a closed or locked period is rejected regardless of writer.
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entry_guard ON journal_entries;
CREATE TRIGGER journal_entry_guard
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION erp_journal_entry_guard();

DROP TRIGGER IF EXISTS journal_entry_post_guard ON journal_entries;
CREATE TRIGGER journal_entry_post_guard
  BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION erp_journal_entry_guard();

-- Lines of a posted entry are equally immutable; editing them would change the
-- entry's meaning without touching the entry row itself.
CREATE OR REPLACE FUNCTION erp_journal_line_guard() RETURNS trigger AS $$
DECLARE
  entry_status text;
  entry_number text;
BEGIN
  SELECT je.status::text, je.number INTO entry_status, entry_number
    FROM journal_entries je
   WHERE je.id = COALESCE(NEW."entryId", OLD."entryId");

  IF entry_status IN ('POSTED','REVERSED') THEN
    RAISE EXCEPTION
      'Journal entry % is %; its lines cannot be changed.', entry_number, lower(entry_status)
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_line_guard ON journal_lines;
CREATE TRIGGER journal_line_guard
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION erp_journal_line_guard();
