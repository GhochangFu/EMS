-- E7.1a / ADR 0045 Amendment 2 (2026-08-24). Follows `0042`.
--
-- Makes the `bms_rollup` membership survive an operator who runs `pnpm
-- db:migrate` without `pnpm db:roles`.
--
-- `0042` moved the four continuous aggregates to `bms_rollup`, and `db:roles`
-- grants the membership that lets `bms_owner`, `bms_tenant` and `bms_fleet`
-- assume it. Compose and CI both run roles before migrate (decision 6), so both
-- are correct — but the two halves were separable, and the failure when they
-- separate is silent in exactly the way this item has been trying to remove:
-- the ownership move lands, the membership does not, and the API's refresh then
-- fails on `SET ROLE` with `permission denied` and is swallowed as a `WARN`.
--
-- `0042`'s `ALTER MATERIALIZED VIEW ... OWNER TO bms_rollup` already fails
-- loudly if the role itself is absent. It is only the membership that could go
-- missing quietly, so it is re-asserted here — idempotently, and atomically with
-- the migration chain rather than only from an operational command.
--
-- Runs as `bms_app`: `GRANT <role> TO <role>` needs `ADMIN OPTION` or the
-- superuser attribute, and `bms_owner` has neither over a role it is merely a
-- member of. There is deliberately no `SET ROLE` here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_rollup') THEN
    RAISE EXCEPTION
      'bms_rollup is missing. Run `pnpm --filter @bms/db roles` before `pnpm db:migrate` (ADR 0045 decision 6).';
  END IF;
END
$$;

GRANT bms_rollup TO bms_owner, bms_tenant, bms_fleet;
