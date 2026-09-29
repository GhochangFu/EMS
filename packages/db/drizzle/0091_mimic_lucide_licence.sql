-- F3.32f / ADR 0086 decision 10 — the Lucide licence label reads "ISC and MIT".
--
-- WHY. 16 of the 126 curated Lucide icons are derived from the Feather project and carry
-- Feather's MIT licence beside Lucide's own ISC licence; the notice in
-- `apps/web/src/components/widgets/mimic-symbol-libraries/lucide.generated.ts` already ships
-- both texts, but `0090` seeded the label as plain "ISC". `0090` is frozen like every committed
-- migration, so the label is corrected here, and the shared registry, the generator and both
-- generated headers now say the same.
--
-- REPLAY-SAFE. An UPDATE to a literal is idempotent: a second run writes the same value.
--
-- WHO RUNS WHAT. The UPDATE runs inside `SET ROLE bms_owner`, the role that owns the table
-- (`0090`). `bms.mimic_symbol_libraries` has no row security, so no tenant GUC is needed. No
-- GRANT, no DDL, no policy. The `DO $$` block asserts the effect, per the 0059/0085/0090 idiom:
-- `IS DISTINCT FROM` also fails when the lucide row is missing (a NULL read), so an UPDATE that
-- matched no row cannot pass as success.

SET ROLE bms_owner;

UPDATE bms.mimic_symbol_libraries SET licence = 'ISC and MIT' WHERE code = 'lucide';

RESET ROLE;

DO $$
BEGIN
  IF (SELECT licence FROM bms.mimic_symbol_libraries WHERE code = 'lucide') IS DISTINCT FROM 'ISC and MIT' THEN
    RAISE EXCEPTION 'migration 0091: the lucide row does not read ISC and MIT';
  END IF;
END $$;
