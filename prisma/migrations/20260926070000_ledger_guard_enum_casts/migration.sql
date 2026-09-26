-- Fix the ledger guards' refusal messages (found while testing payroll Round 4).
--
-- erp_journal_entry_guard and erp_journal_line_guard format their refusals
-- with lower(<status>), but the status columns are enums (JournalEntryStatus,
-- FiscalPeriodStatus) and Postgres has no lower(enum). So every time a guard
-- tried to refuse — editing a posted entry, posting into a closed period,
-- touching a posted entry's lines — the RAISE itself failed with 42883
-- "function lower(...) does not exist". The write was still refused, which is
-- why the ledger-invariant tests (that only assert "it was refused") passed,
-- but the caller got an anonymous 500 instead of the rule.
--
-- This recreates both functions exactly as deployed (pg_get_functiondef of the
-- live copy) with only the argument cast to text. Behaviour is otherwise
-- unchanged; the triggers keep pointing at the same function names.

CREATE OR REPLACE FUNCTION public.erp_journal_entry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  period_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED','REVERSED') THEN
      RAISE EXCEPTION
        'Journal entry % is % and cannot be deleted. Post a reversing entry instead.',
        OLD.number, lower((OLD.status)::text)
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
      OLD.number, lower((OLD.status)::text)
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'POSTED' AND (TG_OP = 'INSERT' OR OLD.status <> 'POSTED') THEN
    SELECT fp.status::text INTO period_status
      FROM fiscal_periods fp WHERE fp.id = NEW."periodId";
    IF period_status IN ('CLOSED','LOCKED') THEN
      RAISE EXCEPTION
        'Cannot post journal entry % into a % period.', NEW.number, lower((period_status)::text)
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_journal_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s text; n text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT je.status::text, je.number INTO s, n
      FROM journal_entries je WHERE je.id = OLD."entryId";
    IF s IN ('POSTED','REVERSED') THEN
      RAISE EXCEPTION 'Journal entry % is %; its lines cannot be changed or removed.',
        n, lower((s)::text) USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT je.status::text, je.number INTO s, n
      FROM journal_entries je WHERE je.id = NEW."entryId";
    IF s IN ('POSTED','REVERSED') THEN
      RAISE EXCEPTION 'Journal entry % is %; lines cannot be moved onto it.',
        n, lower((s)::text) USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
