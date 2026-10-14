-- F4.258 / ADR 0099 Amendment 2 — a committed onboarding session keeps no
-- encrypted RTU credentials.
--
-- WHY. Until F4.258 the commit set `status`, `committed_at`, `result` and
-- `checkpoints` but never rewrote `draft`, so `draft._secrets` (the RTU
-- credential ciphertext of ADR 0022) stayed on every committed row for good,
-- and the F4.255 purge deletes only `status = 'draft'` rows. The commit copied
-- each blob into `bms.rtu_connection_configs` already, so the copy on the
-- session was never read again — when the key was configured at commit time.
-- With `CREDENTIAL_ENCRYPTION_KEY` unset the commit wrote a NULL ciphertext and
-- reported success, so on such a row the session's blob is the only copy. Owner decision 2026-10-14, option A: the
-- commit now strips `_secrets` in the same update that sets `committed`
-- (`OnboardingCommitService`), and this file removes it from every session
-- that was committed before that change. ADR 0099 Amendment 2's closing note —
-- the ciphertext lives until "30 days without a write, or the commit" — is
-- then true of every draft or committed row this file can prove has a copy.
--
-- WHAT. `draft - '_secrets'` on committed rows that hold the key, and only
-- those. An open draft keeps its `_secrets`: its commit still needs them.
--
-- THE ONLY-COPY GUARD. A committed row is kept as it is when any RTU the commit
-- created (`result->'rtuIds'`, by position) has a blob in `_secrets` under the
-- code at the same position of `draft->'rtus'` (trimmed, as
-- `readEncryptedCredentials` reads it) and no `rtu_connection_configs` row
-- with a ciphertext. Stripping that row would erase the only copy of a
-- credential, so it stays for an operator; the NOTICE counts them. The join is
-- by position, never by `rtus.code`: an RTU renamed after the commit would
-- otherwise read as copied. The UPDATE and the DO check use the same predicate,
-- so a kept row never fails the migration. The
-- `jsonb_typeof` guard keeps the operator off a non-object draft (the column is
-- `NOT NULL` but a JSON `null` is legal), where `?` and `-` mean something else.
--
-- WHO RUNS WHAT. The UPDATE runs as the migration's own role
-- (`DATABASE_URL_SUPERUSER`, `bms_app`, `rolbypassrls = t`), outside any
-- `SET ROLE bms_owner` bracket — the 0071 rule. `bms.onboarding_sessions` is
-- `FORCE ROW LEVEL SECURITY` (0040/0041) with `tenant_isolation` on
-- `app.current_organization`, so `bms_owner` with no GUC sees no row and the
-- same statement inside the bracket would report `UPDATE 0` while stripping
-- nothing. As the migrator it reaches every organization's rows. No DDL, no
-- GRANT, no policy.
--
-- REPLAY-SAFE. Forward-only and idempotent: once a row has no `_secrets` the
-- `?` predicate no longer matches it, so a second run updates nothing. There is
-- no down migration — putting ciphertext back on a committed row is not a
-- recovery this repo should be able to perform. The `DO $$` block asserts the
-- effect, per the 0059/0085/0090/0091 idiom.

UPDATE bms.onboarding_sessions AS s
   SET draft = s.draft - '_secrets'
 WHERE s.status = 'committed'
   AND jsonb_typeof(s.draft) = 'object'
   AND s.draft ? '_secrets'
   AND NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(s.result -> 'rtuIds') = 'array'
                   THEN s.result -> 'rtuIds' ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS r(rtu_id, ord)
      WHERE s.draft -> '_secrets' ? btrim(s.draft -> 'rtus' -> (r.ord::int - 1) ->> 'code')
        AND NOT EXISTS (
          SELECT 1 FROM bms.rtu_connection_configs c
           WHERE c.rtu_id::text = r.rtu_id
             AND c.credentials_ciphertext IS NOT NULL));

DO $$
DECLARE
  kept integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM bms.onboarding_sessions AS s
     WHERE s.status = 'committed'
       AND jsonb_typeof(s.draft) = 'object'
       AND s.draft ? '_secrets'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(s.result -> 'rtuIds') = 'array'
                     THEN s.result -> 'rtuIds' ELSE '[]'::jsonb END
              ) WITH ORDINALITY AS r(rtu_id, ord)
        WHERE s.draft -> '_secrets' ? btrim(s.draft -> 'rtus' -> (r.ord::int - 1) ->> 'code')
          AND NOT EXISTS (
            SELECT 1 FROM bms.rtu_connection_configs c
             WHERE c.rtu_id::text = r.rtu_id
               AND c.credentials_ciphertext IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'migration 0108: a committed onboarding session still holds draft._secrets';
  END IF;
  SELECT count(*) INTO kept FROM bms.onboarding_sessions
   WHERE status = 'committed' AND jsonb_typeof(draft) = 'object' AND draft ? '_secrets';
  IF kept > 0 THEN
    RAISE NOTICE 'migration 0108: % committed onboarding session(s) keep draft._secrets as the only copy of a credential', kept;
  END IF;
END $$;
