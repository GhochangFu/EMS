-- E4.1c / ADR 0070 decision 8 — `bms.organizations.currency`, the ISO 4217
-- code every money figure for the organization is labelled with.
--
-- The tariff became a `bms.calc_parameters` row in E4.1a (`energy_tariff_per_kwh`,
-- a plain number), so "cost = kWh × tariff" has no currency of its own any
-- more: the CURRENCY is a property of the organization that pays the bill,
-- not of the parameter row and not of the deployment. The dashboard's and
-- the energy report's indicative cost, and every `energy_cost_*` money point
-- a stock template computes, read it from here (E4.1c plan §3.2, §3.5). A
-- read whose scope spans two currencies refuses a sum and shows a dash.
--
-- THE COLUMN IS NOT NULL WITH NO DEFAULT, deliberately — the argument `0075`
-- makes for a timezone: a defaulted currency would be a SILENT GUESS the money
-- points then label with, and a cost labelled with the wrong currency is
-- indistinguishable from a right one in the written value. So there is no
-- `DEFAULT`, and the backfill FAILS CLOSED: the two seeded organizations are
-- stamped by code (`ESKOM` → `ZAR`, the Eskom-era demo; `PHEWB` → `INR`, the
-- PHE pilot), and any OTHER row still `NULL` aborts the migration naming its
-- code BEFORE `SET NOT NULL` runs, so a deployed database with a third
-- organization stops here and an operator stamps it by hand rather than the
-- migration guessing. After this the SEED owns the value
-- (`hierarchy-seed.ts`: `ON CONFLICT (code) DO UPDATE SET … currency =
-- EXCLUDED.currency`) and the organization admin form writes it.
--
-- `char(3)` + `CHECK (currency ~ '^[A-Z]{3}$')`: the ISO 4217 SHAPE is what
-- Postgres can enforce cheaply; the MEMBERSHIP (is `XYZ` a currency?) is the
-- write path's job through `Intl.supportedValuesOf("currency")` (162 codes on
-- Node 20), the same split `0075` makes between a `CHECK` and
-- `pg_timezone_names`. A CHECK naming the full list would be a second copy of
-- a table the runtime already carries.
--
-- `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT` keeps the file
-- re-runnable; `ADD COLUMN IF NOT EXISTS` and the `currency IS NULL` guards on
-- the UPDATEs do the same for the column and the backfill.
--
-- `SET ROLE bms_owner` is the `0041` bracket (the table is owned by
-- `bms_owner`; the bracket keeps the ALTERs under the owner and is the shape
-- every migration since `0041` carries). No GRANT: column privileges follow
-- the table's. No `CREATE EXTENSION` (§4.4).
--
-- Forward-only and idempotent. Indexed 0076: `0051`-`0075` are committed and
-- frozen, and the journal `when` is strictly greater than `0075`'s
-- 1789791806391, or drizzle applies nothing and every check downstream passes
-- against a schema short one column (`0024`'s header records this).

SET ROLE bms_owner;

ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS currency char(3);

-- 1. Backfill the two seeded organizations by code. `currency IS NULL` keeps a
-- re-run from overwriting a value the seed or an administrator set since.
UPDATE bms.organizations SET currency = 'ZAR'
  WHERE code = 'ESKOM' AND currency IS NULL;

UPDATE bms.organizations SET currency = 'INR'
  WHERE code = 'PHEWB' AND currency IS NULL;

-- 2. Abort, naming the codes, on any organization still without a currency.
-- A guessed currency is a data error, not a default — fail loud so a human
-- stamps the row before the NOT NULL below.
DO $$
DECLARE
  n bigint;
  codes text[];
BEGIN
  SELECT count(*), array_agg(code ORDER BY code) INTO n, codes
  FROM bms.organizations WHERE currency IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'E4.1c 0076: % organization(s) have no currency and no seeded backfill applies: %. Stamp bms.organizations.currency (an ISO 4217 code) by hand, then re-run.',
      n, codes;
  END IF;
END
$$;

-- 3. Now every row carries a value.
ALTER TABLE bms.organizations ALTER COLUMN currency SET NOT NULL;

-- 4. The ISO 4217 shape: exactly three upper-case ASCII letters.
ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_currency_check;
ALTER TABLE bms.organizations
  ADD CONSTRAINT organizations_currency_check CHECK (currency ~ '^[A-Z]{3}$');

COMMENT ON COLUMN bms.organizations.currency IS
  'ISO 4217 code every money figure for this organization is labelled with (ADR 0070 decision 8). NOT NULL, no default: the seed stamps ESKOM/PHEWB and the admin form writes it; membership in ISO 4217 is checked on the write path.';

RESET ROLE;
